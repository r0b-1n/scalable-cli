//! `POST /v1beta/models/:model_and_action` emulation (Google Gemini `generateContent`) — see spec
//! §5.4, §10.1, §10.4.
//!
//! The real path has a literal `:generateContent`/`:streamGenerateContent` suffix baked into its
//! last segment, which cannot be a separate axum path parameter — the whole `{model}:{action}`
//! tail is captured as one opaque `model_and_action` param and split apart here.
//!
//! Two asymmetries vs. the other three adapters:
//! - Google accepts a credential either as the `x-goog-api-key` header or as a `?key=` query
//!   parameter; the shared [`provider_error_response`] only knows about headers, so a query-param
//!   key is folded into a synthetic header before that check runs.
//! - An incoming `functionResponse` part carries its payload one level deeper than the other wire
//!   formats, wrapped as `{"response": {"content": <value>}}` (Gemini requires `response` to be a
//!   JSON object, so arbitrary tool results are wrapped under a fixed `content` key) — the neutral
//!   [`Turn::ToolResult`] carries the unwrapped `<value>`.
//!
//! Gemini has no finish reason of its own for tool calls — a `functionCall` part still reports
//! `finishReason: "STOP"`, and the real client tells tool-use apart from a plain answer by
//! inspecting the parts themselves, not the finish reason, so every mock response uses `"STOP"`.

use super::{next_action, provider_error_response, ModelAction, Turn, ToolCallRequest};
use crate::AppState;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

pub async fn generate_content(
    State(state): State<AppState>,
    Path(model_and_action): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let model = model_from_path_segment(&model_and_action).to_string();
    let auth_headers = headers_with_query_credential(&headers, &query);

    let mut ai = state.ai.write().await;
    if let Some((status, error_body)) = provider_error_response(&auth_headers, &model, ai.require_provider_auth) {
        return (status, Json(error_body));
    }

    let tools_offered = tool_names(&body);
    let history = history_from(&body);
    let action = next_action(&mut ai, &history, &tools_offered);
    drop(ai);

    let response = json!({
        "candidates": [{
            "content": { "role": "model", "parts": render_parts(action) },
            "finishReason": "STOP",
        }],
        "usageMetadata": { "promptTokenCount": 0, "candidatesTokenCount": 0, "totalTokenCount": 0 },
    });
    (StatusCode::OK, Json(response))
}

/// Strip the literal `:generateContent`/`:streamGenerateContent` action suffix off the combined
/// path segment, leaving just the model id.
fn model_from_path_segment(model_and_action: &str) -> &str {
    model_and_action.split_once(':').map(|(model, _action)| model).unwrap_or(model_and_action)
}

/// Fold a `?key=` query parameter into a synthetic `x-goog-api-key` header so the shared
/// credential check in [`provider_error_response`] — which only inspects headers — treats either
/// form as satisfying the requirement, matching the real API accepting both.
fn headers_with_query_credential(headers: &HeaderMap, query: &HashMap<String, String>) -> HeaderMap {
    let mut headers = headers.clone();
    if !headers.contains_key("x-goog-api-key") {
        if let Some(key) = query.get("key").filter(|key| !key.is_empty()) {
            if let Ok(value) = HeaderValue::from_str(key) {
                headers.insert("x-goog-api-key", value);
            }
        }
    }
    headers
}

/// Gemini's protobuf JSON mapping accepts a field under both its lowerCamelCase and its
/// snake_case spelling, and real clients send either, so every field this module reads is looked
/// up under both. Reading only one spelling silently yields an empty tool list, which would make
/// the decision engine fall back to a tool the caller never declared.
fn field<'a>(value: &'a Value, camel: &str, snake: &str) -> Option<&'a Value> {
    value.get(camel).or_else(|| value.get(snake))
}

fn tool_names(body: &Value) -> Vec<String> {
    body.get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|t| field(t, "functionDeclarations", "function_declarations").and_then(Value::as_array))
        .flatten()
        .filter_map(|f| f.get("name").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

fn history_from(body: &Value) -> Vec<Turn> {
    let mut history = Vec::new();
    if let Some(text) = field(body, "systemInstruction", "system_instruction")
        .and_then(|s| s.get("parts"))
        .and_then(Value::as_array)
        .and_then(|parts| parts.first())
        .and_then(|part| part.get("text"))
        .and_then(Value::as_str)
    {
        history.push(Turn::System(text.to_string()));
    }
    for content in body.get("contents").and_then(Value::as_array).into_iter().flatten() {
        let role = content.get("role").and_then(Value::as_str).unwrap_or("user");
        let parts = content.get("parts").and_then(Value::as_array).cloned().unwrap_or_default();
        if role == "model" {
            history.push(model_turn(&parts));
        } else {
            history.extend(user_turns(&parts));
        }
    }
    history
}

/// A `"model"` role turn: at most one `text` part and any number of `functionCall` parts, folded
/// into a single [`Turn::Assistant`] the way the neutral model expects.
fn model_turn(parts: &[Value]) -> Turn {
    let mut text = None;
    let mut tool_calls = Vec::new();
    for (index, part) in parts.iter().enumerate() {
        if let Some(part_text) = part.get("text").and_then(Value::as_str) {
            text = Some(part_text.to_string());
        }
        if let Some(call) = part.get("functionCall") {
            tool_calls.push(ToolCallRequest {
                // Gemini has no native call id on the wire; one is synthesized from position.
                id: format!("gcall_{index}"),
                name: call.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
                arguments: call.get("args").cloned().unwrap_or(Value::Null),
            });
        }
    }
    Turn::Assistant { text, tool_calls }
}

/// A `"user"` role turn's parts, each rendered independently: a `text` part becomes a
/// [`Turn::User`], a `functionResponse` part becomes a [`Turn::ToolResult`] with its payload
/// unwrapped out of the `{"response": {"content": <value>}}` envelope.
fn user_turns(parts: &[Value]) -> Vec<Turn> {
    let mut turns = Vec::new();
    for part in parts {
        if let Some(text) = part.get("text").and_then(Value::as_str) {
            turns.push(Turn::User(text.to_string()));
        }
        if let Some(function_response) = part.get("functionResponse") {
            turns.push(Turn::ToolResult {
                name: function_response.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
                content: function_response
                    .get("response")
                    .and_then(|response| response.get("content"))
                    .cloned()
                    .unwrap_or(Value::Null),
            });
        }
    }
    turns
}

/// Render a [`ModelAction`] into a `content.parts` array: one `functionCall` part for a tool call,
/// one `text` part for a final answer — the two shapes the real API's `parts[]` ever carries here.
fn render_parts(action: ModelAction) -> Value {
    match action {
        ModelAction::ToolCall { name, arguments } => json!([{ "functionCall": { "name": name, "args": arguments } }]),
        ModelAction::Text(text) => json!([{ "text": text }]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The request shape from spec §5.4, verbatim down to the `functionResponse` payload's
    /// `{"content": ...}` envelope.
    fn golden_request() -> Value {
        json!({
            "systemInstruction": { "parts": [{ "text": "You are a trading assistant." }] },
            "contents": [
                { "role": "user", "parts": [{ "text": "Check DE0007164600." }] },
                { "role": "model", "parts": [{ "functionCall": { "name": "quote", "args": { "isin": "DE0007164600" } } }] },
                { "role": "user", "parts": [{ "functionResponse": { "name": "quote", "response": { "content": { "price": 123.45 } } } }] },
            ],
            "tools": [{
                "functionDeclarations": [
                    { "name": "quote", "description": "Fetch a quote.", "parameters": { "type": "object" } },
                ],
            }],
            "generationConfig": { "temperature": 0.2, "maxOutputTokens": 4096 },
        })
    }

    #[test]
    fn model_from_path_segment_strips_the_action_suffix() {
        assert_eq!(model_from_path_segment("gemini-2.0-flash:generateContent"), "gemini-2.0-flash");
        assert_eq!(model_from_path_segment("gemini-2.0-flash:streamGenerateContent"), "gemini-2.0-flash");
        assert_eq!(model_from_path_segment("gemini-2.0-flash"), "gemini-2.0-flash");
    }

    #[test]
    fn tool_names_reads_function_declarations() {
        assert_eq!(tool_names(&golden_request()), vec!["quote".to_string()]);
    }

    /// Both spellings of every field Gemini's protobuf JSON mapping accepts must parse. A fixture
    /// and a parser that agree on one spelling pass while the other spelling silently yields an
    /// empty tool list, which makes the decision engine fall back to a tool the caller never
    /// offered — so both are pinned here explicitly.
    #[test]
    fn both_field_spellings_parse() {
        let snake = json!({
            "system_instruction": { "parts": [{ "text": "sys" }] },
            "contents": [{ "role": "user", "parts": [{ "text": "go" }] }],
            "tools": [{ "function_declarations": [{ "name": "holdings", "parameters": {} }] }],
        });
        assert_eq!(tool_names(&snake), vec!["holdings".to_string()]);
        assert!(matches!(&history_from(&snake)[0], Turn::System(text) if text == "sys"));

        let camel = json!({
            "systemInstruction": { "parts": [{ "text": "sys" }] },
            "contents": [{ "role": "user", "parts": [{ "text": "go" }] }],
            "tools": [{ "functionDeclarations": [{ "name": "holdings", "parameters": {} }] }],
        });
        assert_eq!(tool_names(&camel), vec!["holdings".to_string()]);
        assert!(matches!(&history_from(&camel)[0], Turn::System(text) if text == "sys"));
    }

    /// The decision engine must never name a tool the request did not declare. This is the
    /// end-to-end consequence of the spelling bug above: an unparsed tool list made Gemini answer
    /// with `quote` when only `holdings` was on offer.
    #[test]
    fn decision_never_names_an_undeclared_tool() {
        let offered = vec!["holdings".to_string()];
        for turn in 0..4u32 {
            if let super::super::NextStep::CallTool { name, .. } =
                super::super::decide_next_step(7, &format!("{turn}:conv"), &offered)
            {
                assert!(
                    offered.contains(&name),
                    "decide_next_step named {name}, which was never offered"
                );
            }
        }
    }

    /// Round-trips the golden request's `functionResponse` — payload wrapped one level deeper
    /// than every other wire format — into the neutral history, and checks every other message
    /// lands as the right `Turn` variant.
    #[test]
    fn history_from_unwraps_function_response_content_envelope() {
        let history = history_from(&golden_request());
        assert_eq!(history.len(), 4);

        match &history[0] {
            Turn::System(text) => assert_eq!(text, "You are a trading assistant."),
            other => panic!("expected Turn::System, got {other:?}"),
        }
        match &history[1] {
            Turn::User(text) => assert_eq!(text, "Check DE0007164600."),
            other => panic!("expected Turn::User, got {other:?}"),
        }
        match &history[2] {
            Turn::Assistant { text, tool_calls } => {
                assert!(text.is_none());
                assert_eq!(tool_calls.len(), 1);
                assert_eq!(tool_calls[0].id, "gcall_0");
                assert_eq!(tool_calls[0].name, "quote");
                assert_eq!(tool_calls[0].arguments, json!({ "isin": "DE0007164600" }));
            }
            other => panic!("expected Turn::Assistant, got {other:?}"),
        }
        match &history[3] {
            Turn::ToolResult { name, content } => {
                assert_eq!(name, "quote");
                // Unwrapped out of `{"response": {"content": ...}}` — never left as the envelope.
                assert_eq!(content, &json!({ "price": 123.45 }));
            }
            other => panic!("expected Turn::ToolResult, got {other:?}"),
        }
    }

    /// Golden-fixture round trip: render a tool-call decision into wire `parts`, then feed that
    /// same JSON back through the `"model"` role parser and check the neutral `ToolCallRequest` it
    /// recovers matches what was rendered.
    #[test]
    fn tool_call_action_round_trips_through_parts_rendering() {
        let arguments = json!({ "isin": "US0378331005", "timeframe": "3m" });
        let parts = render_parts(ModelAction::ToolCall { name: "chart".to_string(), arguments: arguments.clone() });
        assert_eq!(parts, json!([{ "functionCall": { "name": "chart", "args": arguments } }]));

        let parts_array = parts.as_array().expect("parts is always an array");
        match model_turn(parts_array) {
            Turn::Assistant { text, tool_calls } => {
                assert!(text.is_none());
                assert_eq!(tool_calls.len(), 1);
                assert_eq!(tool_calls[0].id, "gcall_0");
                assert_eq!(tool_calls[0].name, "chart");
                assert_eq!(tool_calls[0].arguments, arguments);
            }
            other => panic!("expected Turn::Assistant, got {other:?}"),
        }
    }

    /// Same round trip for the plain-text branch: a final answer renders as one `text` part, and
    /// parsing that part back recovers the original text with no tool calls.
    #[test]
    fn text_action_round_trips_through_parts_rendering() {
        let parts = render_parts(ModelAction::Text("no trade warranted".to_string()));
        assert_eq!(parts, json!([{ "text": "no trade warranted" }]));

        let parts_array = parts.as_array().expect("parts is always an array");
        match model_turn(parts_array) {
            Turn::Assistant { text, tool_calls } => {
                assert_eq!(text.as_deref(), Some("no trade warranted"));
                assert!(tool_calls.is_empty());
            }
            other => panic!("expected Turn::Assistant, got {other:?}"),
        }
    }

    /// A `?key=` query parameter satisfies the shared credential check exactly like the
    /// `x-goog-api-key` header does, and a request with neither is still rejected.
    #[test]
    fn query_param_key_satisfies_the_shared_credential_check() {
        let mut query = HashMap::new();
        query.insert("key".to_string(), "test-key".to_string());
        let headers = headers_with_query_credential(&HeaderMap::new(), &query);
        assert!(provider_error_response(&headers, "gemini-2.0-flash", true).is_none());

        let headers = headers_with_query_credential(&HeaderMap::new(), &HashMap::new());
        let (status, body) = provider_error_response(&headers, "gemini-2.0-flash", true)
            .expect("neither header nor query key must be rejected when auth is required");
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["error"]["type"], "authentication_error");
    }
}

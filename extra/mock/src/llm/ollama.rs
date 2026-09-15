//! `POST /api/chat` + `GET /api/tags` emulation (Ollama) — see spec §5.5, §10.1, §10.4.
//!
//! **Critical asymmetry vs. OpenAI:** `message.tool_calls[].function.arguments` is already a JSON
//! object on this wire, never a JSON-encoded string — it must not be `from_str`'d, only passed
//! through as-is, both when reading a request and when rendering this response.
//!
//! A request's `stream: true` is accepted and ignored — the real Ollama daemon would switch to
//! newline-delimited streaming chunks, but every mock response here is one complete `Json(...)`
//! body regardless, matching the sync-client constraint on the `sc` side.

use super::{function_tool_names, next_action, provider_error_response, ModelAction, Turn, ToolCallRequest};
use crate::AppState;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json};
use chrono::Utc;
use serde_json::{json, Value};

pub async fn chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let model = body.get("model").and_then(Value::as_str).unwrap_or("mock-model").to_string();
    let mut ai = state.ai.write().await;
    if let Some((status, error_body)) = provider_error_response(&headers, &model, ai.require_provider_auth) {
        return (status, Json(error_body));
    }

    let tools_offered = function_tool_names(body.get("tools"));
    let history = history_from(&body);
    let action = next_action(&mut ai, &history, &tools_offered);
    drop(ai);

    (StatusCode::OK, Json(render_response(&model, action)))
}

pub async fn list_models() -> impl IntoResponse {
    Json(json!({
        "models": [
            { "name": "llama3.1:70b", "model": "llama3.1:70b" },
            { "name": "rate-limited-test-model", "model": "rate-limited-test-model" },
            { "name": "error-test-model", "model": "error-test-model" },
        ],
    }))
}

/// Render a [`ModelAction`] into a full `/api/chat` response body. Ollama mints no id for a chat
/// turn on the wire (unlike `chatcmpl-{n}`/`msg_{n}`), so this never touches `AiState.next_id`.
/// `done_reason` is fixed at `"stop"` regardless of branch — real Ollama has no distinct reason
/// for a tool-calling turn, and the `sc`-side parser distinguishes `ToolUse` from `EndTurn` by the
/// presence of `message.tool_calls`, not by this field.
fn render_response(model: &str, action: ModelAction) -> Value {
    json!({
        "model": model,
        "created_at": Utc::now().to_rfc3339(),
        "message": render_message(action),
        "done": true,
        "done_reason": "stop",
        "prompt_eval_count": 0,
        "eval_count": 0,
    })
}

/// Render one [`ModelAction`] into `message`. A tool call's `arguments` stays a bare JSON object
/// (the asymmetry this module exists to get right) and `content` is `""` alongside it, matching a
/// real Ollama tool-calling turn; a final answer carries no `tool_calls` key at all.
fn render_message(action: ModelAction) -> Value {
    match action {
        ModelAction::ToolCall { name, arguments } => json!({
            "role": "assistant",
            "content": "",
            "tool_calls": [{ "function": { "name": name, "arguments": arguments } }],
        }),
        ModelAction::Text(text) => json!({ "role": "assistant", "content": text }),
    }
}

fn history_from(body: &Value) -> Vec<Turn> {
    let mut history = Vec::new();
    for message in body.get("messages").and_then(Value::as_array).into_iter().flatten() {
        match message.get("role").and_then(Value::as_str).unwrap_or("user") {
            "system" => push_text(&mut history, message, Turn::System),
            "user" => push_text(&mut history, message, Turn::User),
            "assistant" => history.push(assistant_turn(message)),
            "tool" => history.push(Turn::ToolResult {
                // A `tool` message carries neither a call id nor the function's name on this wire
                // (spec §5.5) — the decision engine never needs it back since it only counts
                // completed round-trips.
                name: String::new(),
                content: message.get("content").cloned().unwrap_or(Value::Null),
            }),
            _ => {}
        }
    }
    history
}

fn push_text(history: &mut Vec<Turn>, message: &Value, wrap: fn(String) -> Turn) {
    if let Some(text) = message.get("content").and_then(Value::as_str) {
        history.push(wrap(text.to_string()));
    }
}

fn assistant_turn(message: &Value) -> Turn {
    let text = message.get("content").and_then(Value::as_str).filter(|text| !text.is_empty()).map(str::to_string);
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, call)| {
            let function = call.get("function")?;
            Some(ToolCallRequest {
                // Ollama tool calls carry no id on the wire; one is synthesized from position.
                id: format!("ollama_call_{index}"),
                name: function.get("name")?.as_str()?.to_string(),
                arguments: function.get("arguments").cloned().unwrap_or(Value::Null),
            })
        })
        .collect();
    Turn::Assistant { text, tool_calls }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The request shape from spec §5.5, verbatim down to `arguments` staying a bare JSON object.
    fn golden_request() -> Value {
        json!({
            "model": "llama3.1:70b",
            "messages": [
                {"role": "system", "content": "You are a trading assistant."},
                {"role": "user", "content": "Check DE0007164600."},
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{ "function": { "name": "quote", "arguments": {"isin": "DE0007164600"} } }],
                },
                {"role": "tool", "content": "{\"price\":123.45}"},
            ],
            "tools": [{
                "type": "function",
                "function": { "name": "quote", "description": "Fetch a quote.", "parameters": {"type": "object"} },
            }],
            "stream": false,
            "options": {"temperature": 0.2},
        })
    }

    /// Round-trips the golden request's assistant `tool_calls[].function.arguments` — a bare JSON
    /// object on this wire, never a string — into the neutral `Value` the decision engine expects,
    /// and checks every other message lands as the right `Turn` variant.
    #[test]
    fn history_from_keeps_tool_arguments_as_a_json_object() {
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
                assert_eq!(tool_calls[0].id, "ollama_call_0");
                assert_eq!(tool_calls[0].name, "quote");
                assert_eq!(tool_calls[0].arguments, json!({"isin": "DE0007164600"}));
            }
            other => panic!("expected Turn::Assistant, got {other:?}"),
        }
        match &history[3] {
            Turn::ToolResult { name, content } => {
                assert_eq!(name, "");
                // The tool message's `content` stays an opaque string here — never re-parsed —
                // mirroring Invariant AG-2 (tool results are inert data, not instructions).
                assert_eq!(content, &json!("{\"price\":123.45}"));
            }
            other => panic!("expected Turn::ToolResult, got {other:?}"),
        }
    }

    /// Golden-fixture round trip the other direction: a neutral `ModelAction::ToolCall` renders
    /// into `arguments` as a bare object, which feeds straight back through the request parser to
    /// recover the same `ToolCallRequest` — proving `render_message` and `assistant_turn` are
    /// exact inverses for this wire shape, the same asymmetry the read-side test above checks.
    #[test]
    fn tool_call_action_round_trips_through_message_rendering() {
        let arguments = json!({"isin": "DE0007164600"});
        let action = ModelAction::ToolCall { name: "quote".to_string(), arguments: arguments.clone() };
        let response = render_response("llama3.1:70b", action);

        assert_eq!(response["model"], json!("llama3.1:70b"));
        assert!(response["created_at"].is_string());
        assert_eq!(response["done"], json!(true));
        assert_eq!(response["done_reason"], json!("stop"));
        assert_eq!(response["prompt_eval_count"], json!(0));
        assert_eq!(response["eval_count"], json!(0));

        let message = response["message"].clone();
        assert_eq!(message["role"], json!("assistant"));
        assert_eq!(message["content"], json!(""));
        let call = &message["tool_calls"][0];
        assert_eq!(call["function"]["name"], json!("quote"));
        // The critical asymmetry: this must be a JSON object, never a JSON-encoded string.
        assert_eq!(call["function"]["arguments"], arguments);
        assert!(call["function"]["arguments"].is_object());

        match assistant_turn(&message) {
            Turn::Assistant { text, tool_calls } => {
                assert!(text.is_none());
                assert_eq!(tool_calls.len(), 1);
                assert_eq!(tool_calls[0].name, "quote");
                assert_eq!(tool_calls[0].arguments, arguments);
            }
            other => panic!("expected Turn::Assistant, got {other:?}"),
        }
    }

    #[test]
    fn final_text_response_has_no_tool_calls_and_stop_reason() {
        let action = ModelAction::Text("no trade is warranted this run".to_string());
        let response = render_response("llama3.1:70b", action);

        assert_eq!(response["done"], json!(true));
        assert_eq!(response["done_reason"], json!("stop"));
        let message = &response["message"];
        assert_eq!(message["content"], json!("no trade is warranted this run"));
        assert!(message.get("tool_calls").is_none());
    }

    /// A request with `"stream": true` still gets one complete, non-streamed body back — the mock
    /// never inspects this field, matching the spec's "accepted but not enforced" leniency.
    #[test]
    fn streaming_flag_is_ignored() {
        let mut body = golden_request();
        body["stream"] = json!(true);
        let history = history_from(&body);
        assert_eq!(history.len(), 4);
    }

    /// A missing credential is rejected with a real 401 (not a 200-with-error-payload) once
    /// `--require-provider-auth` is set, matching the auth.rs REST convention §10.4 calls for.
    #[test]
    fn missing_credential_is_rejected_when_auth_required() {
        let headers = HeaderMap::new();
        let (status, body) = provider_error_response(&headers, "llama3.1:70b", true)
            .expect("a missing credential must be rejected when auth is required");
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["error"]["type"], "authentication_error");
    }
}

//! `POST /v1/chat/completions` + `GET /v1/models` emulation (OpenAI / OpenAI-compatible) — see
//! spec §5.3, §10.1, §10.4.
//!
//! **Critical asymmetry vs. Ollama:** `message.tool_calls[].function.arguments` is a
//! JSON-*encoded string* on this wire, never a bare object — callers of this response must
//! `serde_json::from_str` it, and this module mirrors that by encoding it the same way here.

use super::{function_tool_names, next_action, provider_error_response, ModelAction, Turn, ToolCallRequest};
use crate::AppState;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json};
use chrono::Utc;
use serde_json::{json, Value};

pub async fn chat_completions(
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
    let id = ai.next_id();
    drop(ai);

    (StatusCode::OK, Json(render_completion(&model, id, action)))
}

pub async fn list_models() -> impl IntoResponse {
    Json(models_body())
}

/// The `GET /v1/models` body, split out from [`list_models`] so its shape can be asserted on
/// directly in a test without going through an async handler call.
fn models_body() -> Value {
    json!({
        "object": "list",
        "data": [
            { "id": "gpt-4o", "object": "model", "created": Utc::now().timestamp(), "owned_by": "mock" },
            { "id": "rate-limited-test-model", "object": "model", "created": Utc::now().timestamp(), "owned_by": "mock" },
            { "id": "error-test-model", "object": "model", "created": Utc::now().timestamp(), "owned_by": "mock" },
        ],
    })
}

/// Render a [`ModelAction`] into a full `chat.completion` response body. Split out from
/// [`chat_completions`] so the wire shape can be exercised directly, without an `AppState` to
/// extract `id` from.
fn render_completion(model: &str, id: u64, action: ModelAction) -> Value {
    let (message, finish_reason) = render_message(id, action);
    json!({
        "id": format!("chatcmpl-{id}"),
        "object": "chat.completion",
        "created": Utc::now().timestamp(),
        "model": model,
        "choices": [{ "index": 0, "message": message, "finish_reason": finish_reason }],
        "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 },
    })
}

/// Render one [`ModelAction`] into `choices[0].message` plus its `finish_reason`. A tool call's
/// `arguments` is encoded as a JSON string here (never a bare object) — the asymmetry this module
/// exists to get right — and `content` is `null` alongside it, matching a real tool-calling
/// assistant turn.
fn render_message(id: u64, action: ModelAction) -> (Value, &'static str) {
    match action {
        ModelAction::ToolCall { name, arguments } => (
            json!({
                "role": "assistant",
                "content": Value::Null,
                "tool_calls": [{
                    "id": format!("call_{id}"),
                    "type": "function",
                    "function": { "name": name, "arguments": arguments.to_string() },
                }],
            }),
            "tool_calls",
        ),
        ModelAction::Text(text) => (json!({ "role": "assistant", "content": text }), "stop"),
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
                // A `tool` message carries `tool_call_id`, not the function's name — the real
                // name is only known from the matching earlier `tool_calls` entry, which the
                // decision engine never needs since it only counts completed round-trips.
                name: message.get("tool_call_id").and_then(Value::as_str).unwrap_or_default().to_string(),
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
    let text = message.get("content").and_then(Value::as_str).map(str::to_string);
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|call| {
            let function = call.get("function")?;
            let name = function.get("name")?.as_str()?.to_string();
            let arguments_str = function.get("arguments")?.as_str()?;
            let arguments = serde_json::from_str(arguments_str).unwrap_or(Value::Null);
            Some(ToolCallRequest {
                id: call.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
                name,
                arguments,
            })
        })
        .collect();
    Turn::Assistant { text, tool_calls }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The request shape from spec §5.3, verbatim down to the JSON-encoded `arguments` string.
    fn golden_request() -> Value {
        json!({
            "model": "gpt-4o",
            "messages": [
                {"role": "system", "content": "You are a trading assistant."},
                {"role": "user", "content": "Check DE0007164600."},
                {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": { "name": "quote", "arguments": "{\"isin\":\"DE0007164600\"}" },
                    }],
                },
                {"role": "tool", "tool_call_id": "call_1", "content": "{\"price\":123.45}"},
            ],
            "tools": [{
                "type": "function",
                "function": { "name": "quote", "description": "Fetch a quote.", "parameters": {"type": "object"} },
            }],
            "tool_choice": "auto",
            "stream": false,
            "temperature": 0.2,
        })
    }

    /// Round-trips the golden request's assistant `tool_calls[].function.arguments` — a
    /// JSON-*encoded string* on the wire — into the neutral `Value` the decision engine expects,
    /// and checks every other message lands as the right `Turn` variant.
    #[test]
    fn history_from_decodes_stringified_tool_arguments() {
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
                assert_eq!(tool_calls[0].id, "call_1");
                assert_eq!(tool_calls[0].name, "quote");
                assert_eq!(tool_calls[0].arguments, json!({"isin": "DE0007164600"}));
            }
            other => panic!("expected Turn::Assistant, got {other:?}"),
        }
        match &history[3] {
            Turn::ToolResult { name, content } => {
                assert_eq!(name, "call_1");
                // The tool message's `content` stays an opaque string here — never re-parsed —
                // mirroring Invariant AG-2 (tool results are inert data, not instructions).
                assert_eq!(content, &json!("{\"price\":123.45}"));
            }
            other => panic!("expected Turn::ToolResult, got {other:?}"),
        }
    }

    /// Round-trips a tool call the other direction: a neutral `ModelAction::ToolCall` renders
    /// into `arguments` as a JSON-encoded string, which must decode back to the original object —
    /// the same asymmetry `history_from_decodes_stringified_tool_arguments` checks on the way in.
    #[test]
    fn tool_call_response_encodes_arguments_as_json_string() {
        let action = ModelAction::ToolCall { name: "quote".to_string(), arguments: json!({"isin": "DE0007164600"}) };
        let response = render_completion("gpt-4o", 42, action);

        assert_eq!(response["id"], json!("chatcmpl-42"));
        assert_eq!(response["object"], json!("chat.completion"));
        assert!(response["created"].is_i64());
        assert_eq!(response["model"], json!("gpt-4o"));

        let message = &response["choices"][0]["message"];
        assert_eq!(response["choices"][0]["finish_reason"], json!("tool_calls"));
        assert_eq!(message["content"], Value::Null);
        let call = &message["tool_calls"][0];
        assert_eq!(call["id"], json!("call_42"));
        assert_eq!(call["type"], json!("function"));
        assert_eq!(call["function"]["name"], json!("quote"));

        let arguments = call["function"]["arguments"].as_str().expect("arguments must be a JSON-encoded string");
        let decoded: Value = serde_json::from_str(arguments).expect("arguments string must be valid JSON");
        assert_eq!(decoded, json!({"isin": "DE0007164600"}));
    }

    #[test]
    fn final_text_response_has_no_tool_calls_and_stop_reason() {
        let action = ModelAction::Text("no trade is warranted this run".to_string());
        let response = render_completion("gpt-4o", 7, action);

        assert_eq!(response["choices"][0]["finish_reason"], json!("stop"));
        let message = &response["choices"][0]["message"];
        assert_eq!(message["content"], json!("no trade is warranted this run"));
        assert!(message.get("tool_calls").is_none());
    }

    #[test]
    fn list_models_advertises_the_magic_error_scenario_models() {
        let body = models_body();
        let ids: Vec<&str> = body["data"].as_array().unwrap().iter().map(|m| m["id"].as_str().unwrap()).collect();
        assert!(ids.contains(&"gpt-4o"));
        assert!(ids.contains(&"rate-limited-test-model"));
        assert!(ids.contains(&"error-test-model"));
        assert_eq!(body["object"], json!("list"));
    }
}

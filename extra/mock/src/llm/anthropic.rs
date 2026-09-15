//! `POST /v1/messages` emulation (Anthropic Messages API) — see spec §5.2, §10.1, §10.4.
//!
//! Translates an Anthropic-shaped request body into the neutral [`Turn`] history, asks
//! [`next_action`] what the emulated model does next, and renders the result back as an
//! Anthropic `content` block.

use super::{next_action, provider_error_response, ModelAction, Turn, ToolCallRequest};
use crate::AppState;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json};
use serde_json::{json, Value};

pub async fn messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let model = body.get("model").and_then(Value::as_str).unwrap_or("mock-model").to_string();
    let mut ai = state.ai.write().await;
    if let Some((status, error_body)) = provider_error_response(&headers, &model, ai.require_provider_auth) {
        return (status, Json(error_body));
    }

    let tools_offered = tool_names(&body);
    let history = history_from(&body);
    let action = next_action(&mut ai, &history, &tools_offered);
    let id = ai.next_id();
    drop(ai);

    let content = render_content(action, id);
    let stop_reason = stop_reason_for(&content);

    let response = json!({
        "id": format!("msg_{id}"),
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": Value::Null,
        "usage": { "input_tokens": 0, "output_tokens": 0 },
    });
    (StatusCode::OK, Json(response))
}

/// Render a [`ModelAction`] into an Anthropic `content` block array, minting the one `tool_use`
/// id this turn needs from the monotonic counter (`toolu_{id}`).
fn render_content(action: ModelAction, id: u64) -> Value {
    match action {
        ModelAction::ToolCall { name, arguments } => json!([
            { "type": "tool_use", "id": format!("toolu_{id}"), "name": name, "input": arguments }
        ]),
        ModelAction::Text(text) => json!([{ "type": "text", "text": text }]),
    }
}

/// A response's `stop_reason`: `"tool_use"` when the sole content block is a tool call,
/// `"end_turn"` for a plain text reply — the two shapes [`render_content`] ever produces.
fn stop_reason_for(content: &Value) -> &'static str {
    if content[0]["type"] == "tool_use" { "tool_use" } else { "end_turn" }
}

fn tool_names(body: &Value) -> Vec<String> {
    body.get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|t| t.get("name").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

fn history_from(body: &Value) -> Vec<Turn> {
    let mut history = Vec::new();
    if let Some(system) = body.get("system").and_then(Value::as_str) {
        history.push(Turn::System(system.to_string()));
    }
    for message in body.get("messages").and_then(Value::as_array).into_iter().flatten() {
        let role = message.get("role").and_then(Value::as_str).unwrap_or("user");
        match message.get("content") {
            Some(Value::String(text)) => history.push(Turn::User(text.clone())),
            Some(Value::Array(blocks)) => history.extend(blocks_to_turns(role, blocks)),
            _ => {}
        }
    }
    history
}

fn blocks_to_turns(role: &str, blocks: &[Value]) -> Vec<Turn> {
    if role == "assistant" {
        let mut text = None;
        let mut tool_calls = Vec::new();
        for block in blocks {
            match block.get("type").and_then(Value::as_str) {
                Some("text") => text = block.get("text").and_then(Value::as_str).map(str::to_string),
                Some("tool_use") => tool_calls.push(ToolCallRequest {
                    id: block.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
                    name: block.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
                    arguments: block.get("input").cloned().unwrap_or(Value::Null),
                }),
                _ => {}
            }
        }
        vec![Turn::Assistant { text, tool_calls }]
    } else {
        // A `tool_result` block carries `tool_use_id`, not the tool's name — the real name is
        // only known from the matching earlier `tool_use` block, which the decision engine has
        // no need to re-derive since it only counts completed round-trips.
        blocks
            .iter()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"))
            .map(|block| Turn::ToolResult {
                name: block.get("tool_use_id").and_then(Value::as_str).unwrap_or_default().to_string(),
                content: block.get("content").cloned().unwrap_or(Value::Null),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A full request body in the exact shape spec §5.2 documents: a system prompt, a plain-text
    /// user turn, a prior `tool_use` assistant turn, and its matching `tool_result` — the one
    /// wire fixture every parsing test below is checked against.
    fn request_fixture() -> Value {
        json!({
            "model": "claude-sonnet-4-5",
            "max_tokens": 4096,
            "system": "You are a trading assistant.",
            "messages": [
                { "role": "user", "content": "What's the latest on Apple?" },
                { "role": "assistant", "content": [
                    { "type": "tool_use", "id": "toolu_1", "name": "quote", "input": { "isin": "US0378331005" } }
                ]},
                { "role": "user", "content": [
                    { "type": "tool_result", "tool_use_id": "toolu_1", "content": "{\"price\":227.5}" }
                ]}
            ],
            "tools": [
                { "name": "quote", "description": "Get a quote", "input_schema": { "type": "object", "properties": {} } }
            ],
            "temperature": 0.2,
        })
    }

    #[test]
    fn parses_full_request_into_neutral_history() {
        let body = request_fixture();
        assert_eq!(tool_names(&body), vec!["quote".to_string()]);

        let history = history_from(&body);
        assert_eq!(history.len(), 4);

        match &history[0] {
            Turn::System(text) => assert_eq!(text, "You are a trading assistant."),
            other => panic!("expected System turn, got {other:?}"),
        }
        match &history[1] {
            Turn::User(text) => assert_eq!(text, "What's the latest on Apple?"),
            other => panic!("expected User turn, got {other:?}"),
        }
        match &history[2] {
            Turn::Assistant { text, tool_calls } => {
                assert!(text.is_none());
                assert_eq!(tool_calls.len(), 1);
                assert_eq!(tool_calls[0].id, "toolu_1");
                assert_eq!(tool_calls[0].name, "quote");
                assert_eq!(tool_calls[0].arguments, json!({ "isin": "US0378331005" }));
            }
            other => panic!("expected Assistant turn, got {other:?}"),
        }
        match &history[3] {
            Turn::ToolResult { name, content } => {
                assert_eq!(name, "toolu_1");
                assert_eq!(content, &json!("{\"price\":227.5}"));
            }
            other => panic!("expected ToolResult turn, got {other:?}"),
        }
    }

    /// Golden-fixture round trip: render a tool-call decision into wire `content`, then feed that
    /// same JSON back through the assistant-turn parser and check the neutral `ToolCallRequest` it
    /// recovers matches what was rendered — proving `render_content` and `blocks_to_turns` are
    /// exact inverses for this wire shape, not just individually plausible.
    #[test]
    fn tool_call_action_round_trips_through_content_rendering() {
        let arguments = json!({ "isin": "US0378331005", "timeframe": "3m" });
        let content =
            render_content(ModelAction::ToolCall { name: "chart".to_string(), arguments: arguments.clone() }, 7);
        assert_eq!(
            content,
            json!([{ "type": "tool_use", "id": "toolu_7", "name": "chart", "input": arguments }])
        );
        assert_eq!(stop_reason_for(&content), "tool_use");

        let blocks = content.as_array().expect("content is always an array");
        let turns = blocks_to_turns("assistant", blocks);
        assert_eq!(turns.len(), 1);
        match &turns[0] {
            Turn::Assistant { text, tool_calls } => {
                assert!(text.is_none());
                assert_eq!(tool_calls.len(), 1);
                assert_eq!(tool_calls[0].id, "toolu_7");
                assert_eq!(tool_calls[0].name, "chart");
                assert_eq!(tool_calls[0].arguments, arguments);
            }
            other => panic!("expected Assistant turn, got {other:?}"),
        }
    }

    /// Same round trip for the plain-text branch: a final answer renders as one `text` block with
    /// `stop_reason: "end_turn"`, and parsing that block back recovers the original text.
    #[test]
    fn text_action_round_trips_through_content_rendering() {
        let content = render_content(ModelAction::Text("no trade warranted".to_string()), 3);
        assert_eq!(content, json!([{ "type": "text", "text": "no trade warranted" }]));
        assert_eq!(stop_reason_for(&content), "end_turn");

        let blocks = content.as_array().expect("content is always an array");
        let turns = blocks_to_turns("assistant", blocks);
        assert_eq!(turns.len(), 1);
        match &turns[0] {
            Turn::Assistant { text, tool_calls } => {
                assert_eq!(text.as_deref(), Some("no trade warranted"));
                assert!(tool_calls.is_empty());
            }
            other => panic!("expected Assistant turn, got {other:?}"),
        }
    }

    /// A missing `x-api-key` (and no other recognized credential header) under
    /// `--require-provider-auth` is rejected with the real Anthropic error envelope shape.
    #[test]
    fn missing_credential_is_rejected_with_anthropic_shaped_error() {
        let headers = HeaderMap::new();
        let (status, body) = provider_error_response(&headers, "claude-sonnet-4-5", true)
            .expect("a missing credential must be rejected when auth is required");
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["error"]["type"], "authentication_error");
    }
}

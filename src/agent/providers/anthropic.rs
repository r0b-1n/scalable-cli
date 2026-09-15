//! Anthropic `/v1/messages` wire adapter (`kind = "anthropic"`).
//!
//! **Wire asymmetry vs. OpenAI/Ollama:** a `tool_use` block's `input` is a
//! bare JSON object on this wire, never a JSON-encoded string, and it round-
//! trips as-is in both directions — nothing here ever calls
//! `serde_json::to_string`/`from_str` on a tool call's arguments.
//!
//! **Tool-result grouping:** Claude requires every `tool_result` answering
//! one assistant turn's `tool_use` blocks to arrive in a single following
//! `user` message, so consecutive `ChatMessage::Tool` entries are merged
//! into one message's `content` array rather than rendered one message
//! each (unlike the OpenAI/Ollama adapters, where a separate `tool`-role
//! message per call is valid wire shape on its own).

use std::collections::BTreeMap;
use std::time::Duration;

use anyhow::{Result, anyhow};
use serde_json::{Map, Value, json};

use crate::agent::config::{ProviderParams, ProviderProfile};
use crate::agent::providers::{
    ChatMessage, ChatProvider, ChatRequest, ChatResponse, StopReason, ToolCall, ToolSpec,
};
use crate::agent::{
    AGENT_PROVIDER_AUTH_ERROR_PREFIX, AGENT_PROVIDER_HTTP_ERROR_PREFIX,
    AGENT_PROVIDER_RATE_LIMITED_PREFIX, AGENT_PROVIDER_RESPONSE_INVALID_PREFIX,
};

pub(crate) struct AnthropicProvider {
    client: reqwest::blocking::Client,
    endpoint: String,
    api_version: String,
    model: String,
    api_key: Option<String>,
    extra_headers: BTreeMap<String, String>,
    max_retries: u8,
    params: ProviderParams,
}

impl AnthropicProvider {
    pub(crate) fn new(
        client: reqwest::blocking::Client,
        profile: &ProviderProfile,
        api_key: Option<String>,
    ) -> Result<Self> {
        let base_url = profile
            .base_url
            .clone()
            .unwrap_or_else(|| "https://api.anthropic.com".to_string());
        Ok(Self {
            client,
            endpoint: format!("{}/v1/messages", base_url.trim_end_matches('/')),
            api_version: profile
                .api_version
                .clone()
                .unwrap_or_else(|| "2023-06-01".to_string()),
            model: profile.default_model.clone(),
            api_key,
            extra_headers: profile.extra_headers.clone(),
            max_retries: profile.max_retries,
            params: profile.params.clone(),
        })
    }

    /// One HTTP attempt. Distinguishes transient failures (worth a retry —
    /// a connect/timeout transport error or a 5xx status) from everything
    /// else, which is returned as a terminal, already-prefixed error.
    fn send_once(&self, body: &Value) -> Result<Value, AttemptOutcome> {
        let mut builder = self
            .client
            .post(&self.endpoint)
            .header("anthropic-version", self.api_version.as_str());
        if let Some(key) = &self.api_key {
            builder = builder.header("x-api-key", key.as_str());
        }
        for (name, value) in &self.extra_headers {
            builder = builder.header(name.as_str(), value.as_str());
        }

        let response = builder.json(body).send().map_err(|err| {
            let message = anyhow!(
                "{AGENT_PROVIDER_HTTP_ERROR_PREFIX} request to '{}' failed: {err}",
                self.endpoint
            );
            if err.is_timeout() || err.is_connect() {
                AttemptOutcome::Retryable(message)
            } else {
                AttemptOutcome::Fatal(message)
            }
        })?;

        let status = response.status();
        if status.is_success() {
            return response.json::<Value>().map_err(|err| {
                AttemptOutcome::Fatal(anyhow!(
                    "{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} anthropic response body is not valid JSON: {err}"
                ))
            });
        }

        let code = status.as_u16();
        let detail = response.text().unwrap_or_default();
        let detail = detail.trim();
        if code == 401 || code == 403 {
            return Err(AttemptOutcome::Fatal(anyhow!(
                "{AGENT_PROVIDER_AUTH_ERROR_PREFIX} anthropic returned HTTP {code}: {detail}"
            )));
        }
        if code == 429 {
            return Err(AttemptOutcome::Fatal(anyhow!(
                "{AGENT_PROVIDER_RATE_LIMITED_PREFIX} anthropic returned HTTP {code}: {detail}"
            )));
        }
        let message =
            anyhow!("{AGENT_PROVIDER_HTTP_ERROR_PREFIX} anthropic returned HTTP {code}: {detail}");
        if status.is_server_error() {
            Err(AttemptOutcome::Retryable(message))
        } else {
            Err(AttemptOutcome::Fatal(message))
        }
    }

    /// Retries a transient failure up to `max_retries` times with
    /// `std::thread::sleep` backoff (100ms, 400ms, ...); a 4xx (other than
    /// the already-terminal 401/403/429 above) or a parsed-but-invalid body
    /// is never retried.
    fn send_with_retry(&self, body: &Value) -> Result<Value> {
        let mut attempt: u8 = 0;
        loop {
            match self.send_once(body) {
                Ok(value) => return Ok(value),
                Err(AttemptOutcome::Fatal(err)) => return Err(err),
                Err(AttemptOutcome::Retryable(err)) => {
                    if attempt >= self.max_retries {
                        return Err(err);
                    }
                    let backoff_ms = 100u64.saturating_mul(4u64.saturating_pow(u32::from(attempt)));
                    std::thread::sleep(Duration::from_millis(backoff_ms));
                    attempt += 1;
                }
            }
        }
    }
}

/// Outcome of one HTTP attempt inside [`AnthropicProvider::send_once`].
enum AttemptOutcome {
    Retryable(anyhow::Error),
    Fatal(anyhow::Error),
}

impl ChatProvider for AnthropicProvider {
    fn complete(&self, request: &ChatRequest<'_>) -> Result<ChatResponse> {
        let model = if request.model.is_empty() {
            self.model.as_str()
        } else {
            request.model
        };
        let body = build_request_body(model, request, &self.params);
        let raw = self.send_with_retry(&body)?;
        parse_response(raw)
    }
}

fn build_request_body(model: &str, request: &ChatRequest<'_>, params: &ProviderParams) -> Value {
    let mut body = Map::new();
    body.insert("model".to_string(), json!(model));
    if !request.system_prompt.is_empty() {
        body.insert("system".to_string(), json!(request.system_prompt));
    }
    body.insert(
        "messages".to_string(),
        Value::Array(render_messages(request.messages)),
    );

    let tools: Vec<Value> = request.tools.iter().map(render_tool_spec).collect();
    if !tools.is_empty() {
        body.insert("tools".to_string(), Value::Array(tools));
    }

    for (key, value) in params {
        body.insert(key.clone(), value.clone());
    }

    Value::Object(body)
}

/// Renders the neutral message history into Anthropic's `messages` array.
/// Consecutive `ChatMessage::Tool` entries are buffered and flushed as one
/// `user` message with one `tool_result` block per entry — see the module
/// doc's "Tool-result grouping" note.
fn render_messages(messages: &[ChatMessage]) -> Vec<Value> {
    let mut wire = Vec::with_capacity(messages.len());
    let mut pending_tool_results: Vec<Value> = Vec::new();
    for message in messages {
        match message {
            ChatMessage::Tool {
                tool_call_id,
                name: _,
                content,
            } => {
                pending_tool_results.push(json!({
                    "type": "tool_result",
                    "tool_use_id": tool_call_id,
                    "content": tool_result_content(content),
                }));
            }
            ChatMessage::User(text) => {
                flush_tool_results(&mut wire, &mut pending_tool_results);
                wire.push(json!({ "role": "user", "content": text }));
            }
            ChatMessage::Assistant { text, tool_calls } => {
                flush_tool_results(&mut wire, &mut pending_tool_results);
                wire.push(json!({
                    "role": "assistant",
                    "content": render_assistant_content(text, tool_calls),
                }));
            }
        }
    }
    flush_tool_results(&mut wire, &mut pending_tool_results);
    wire
}

fn flush_tool_results(wire: &mut Vec<Value>, pending: &mut Vec<Value>) {
    if !pending.is_empty() {
        wire.push(json!({ "role": "user", "content": std::mem::take(pending) }));
    }
}

/// A single assistant turn's `content` blocks: an optional leading `text`
/// block followed by one `tool_use` block per call, `input` carrying the
/// call's arguments as a bare JSON object (the argument-encoding quirk this
/// wire format never stringifies, unlike OpenAI's `function.arguments`).
fn render_assistant_content(text: &Option<String>, tool_calls: &[ToolCall]) -> Vec<Value> {
    let mut blocks = Vec::with_capacity(tool_calls.len() + 1);
    if let Some(text) = text {
        blocks.push(json!({ "type": "text", "text": text }));
    }
    for call in tool_calls {
        blocks.push(json!({
            "type": "tool_use",
            "id": call.id,
            "name": call.name,
            "input": call.arguments,
        }));
    }
    blocks
}

/// Anthropic's `tool_result.content` must be a string. A result that is
/// already a JSON string is sent through unchanged; any other JSON value
/// (object, array, number, bool, null) is rendered to its compact JSON
/// text, so the field is always a string either way rather than a
/// double-encoded one.
fn tool_result_content(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn render_tool_spec(tool: &ToolSpec) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.json_schema,
    })
}

fn parse_response(raw: Value) -> Result<ChatResponse> {
    let content = raw.get("content").and_then(Value::as_array).ok_or_else(|| {
        anyhow!("{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} anthropic response missing 'content' array")
    })?;

    let mut assistant_text = String::new();
    let mut tool_calls = Vec::new();
    for block in content {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    assistant_text.push_str(text);
                }
            }
            Some("tool_use") => {
                let id = block
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        anyhow!("{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} anthropic tool_use block missing 'id'")
                    })?
                    .to_string();
                let name = block
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        anyhow!(
                            "{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} anthropic tool_use block missing 'name'"
                        )
                    })?
                    .to_string();
                // `input` is a bare JSON object on this wire (never a JSON-encoded
                // string like OpenAI's `function.arguments`), so it is used as-is.
                let arguments = block.get("input").cloned().unwrap_or(Value::Null);
                tool_calls.push(ToolCall {
                    id,
                    name,
                    arguments,
                });
            }
            _ => {}
        }
    }

    let stop_reason = match raw
        .get("stop_reason")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "tool_use" => StopReason::ToolUse,
        "end_turn" | "stop_sequence" => StopReason::EndTurn,
        "max_tokens" => StopReason::MaxTokens,
        other => StopReason::Other(other.to_string()),
    };

    Ok(ChatResponse {
        assistant_text: (!assistant_text.is_empty()).then_some(assistant_text),
        tool_calls,
        stop_reason,
        raw,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::config::ProviderKind;

    fn test_profile(base_url: &str) -> ProviderProfile {
        ProviderProfile {
            id: "test-anthropic".to_string(),
            kind: ProviderKind::Anthropic,
            base_url: Some(base_url.to_string()),
            default_model: "claude-sonnet-4-5".to_string(),
            api_version: None,
            timeout_seconds: 5,
            max_retries: 1,
            allow_insecure_http: true,
            credential_backend: None,
            extra_headers: BTreeMap::new(),
            params: ProviderParams::new(),
        }
    }

    /// Golden-fixture round trip, outbound half: a full conversation (system
    /// prompt, a user turn, a replayed assistant tool call, and its tool
    /// result) renders into the exact wire shape spec §5.2 documents,
    /// including the tool-result round trip and the bare-object
    /// argument-encoding quirk on the way out.
    #[test]
    fn builds_request_body_with_system_prompt_history_and_tools() {
        let tools = vec![ToolSpec {
            name: "quote",
            description: "Get a quote",
            json_schema: json!({"type": "object", "properties": {}}),
        }];
        let messages = vec![
            ChatMessage::User("What's the latest on Apple?".to_string()),
            ChatMessage::Assistant {
                text: None,
                tool_calls: vec![ToolCall {
                    id: "toolu_1".to_string(),
                    name: "quote".to_string(),
                    arguments: json!({"isin": "US0378331005"}),
                }],
            },
            ChatMessage::Tool {
                tool_call_id: "toolu_1".to_string(),
                name: "quote".to_string(),
                content: json!({"price": 227.5}),
            },
        ];
        let mut params = ProviderParams::new();
        params.insert("temperature".to_string(), json!(0.2));
        let request = ChatRequest {
            system_prompt: "You are a trading assistant.",
            messages: &messages,
            tools: &tools,
            model: "claude-sonnet-4-5",
            params: &params,
        };

        let body = build_request_body(request.model, &request, &params);

        assert_eq!(body["model"], json!("claude-sonnet-4-5"));
        assert_eq!(body["system"], json!("You are a trading assistant."));
        assert_eq!(body["temperature"], json!(0.2));
        assert_eq!(
            body["messages"][0],
            json!({"role": "user", "content": "What's the latest on Apple?"})
        );

        let sent_input = &body["messages"][1]["content"][0]["input"];
        assert!(
            sent_input.is_object(),
            "tool_use input must stay a bare JSON object, not a string"
        );
        assert_eq!(
            body["messages"][1],
            json!({
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": "toolu_1", "name": "quote", "input": {"isin": "US0378331005"}}
                ],
            })
        );

        assert_eq!(
            body["messages"][2],
            json!({
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "toolu_1", "content": "{\"price\":227.5}"}
                ],
            })
        );

        assert_eq!(
            body["tools"][0],
            json!({
                "name": "quote",
                "description": "Get a quote",
                "input_schema": {"type": "object", "properties": {}},
            })
        );
    }

    /// `params` merges verbatim as top-level sibling keys of the body, and
    /// an empty system prompt / tool list is omitted rather than sent empty.
    #[test]
    fn merges_params_and_omits_empty_system_and_tools() {
        let mut params = ProviderParams::new();
        params.insert("max_tokens".to_string(), json!(4096));
        let messages = Vec::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "claude-sonnet-4-5",
            params: &params,
        };
        let body = build_request_body(request.model, &request, &params);
        assert_eq!(body["max_tokens"], json!(4096));
        assert!(body.get("system").is_none());
        assert!(body.get("tools").is_none());
    }

    /// Tool-result round trip, the Anthropic-specific half: two tool results
    /// answering the same assistant turn are merged into a single `user`
    /// turn carrying both `tool_result` blocks, since Claude rejects a
    /// `tool_use` batch whose results are split across multiple messages.
    #[test]
    fn coalesces_consecutive_tool_results_into_one_user_message() {
        let messages = vec![
            ChatMessage::Tool {
                tool_call_id: "toolu_1".to_string(),
                name: "quote".to_string(),
                content: Value::String("already text".to_string()),
            },
            ChatMessage::Tool {
                tool_call_id: "toolu_2".to_string(),
                name: "chart".to_string(),
                content: json!({"points": 3}),
            },
        ];
        let wire = render_messages(&messages);
        assert_eq!(wire.len(), 1);
        assert_eq!(
            wire[0],
            json!({
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "toolu_1", "content": "already text"},
                    {"type": "tool_result", "tool_use_id": "toolu_2", "content": "{\"points\":3}"},
                ],
            })
        );
    }

    /// The argument-encoding quirk on the tool-result side: an
    /// already-string result is sent through verbatim (not re-quoted),
    /// while any other JSON value is compact-encoded to text — Anthropic's
    /// `tool_result.content` must be a string either way.
    #[test]
    fn tool_result_content_avoids_double_encoding_a_string() {
        assert_eq!(tool_result_content(&json!("already text")), "already text");
        assert_eq!(
            tool_result_content(&json!({"price": 227.5})),
            "{\"price\":227.5}"
        );
        assert_eq!(tool_result_content(&json!(42)), "42");
    }

    /// Golden-fixture round trip, inbound half, plus tool-call extraction:
    /// `input` arrives, and stays, a bare JSON object.
    #[test]
    fn parses_tool_use_block_into_a_tool_call() {
        let raw = json!({
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-5",
            "content": [
                {"type": "tool_use", "id": "toolu_7", "name": "chart", "input": {"isin": "US0378331005", "timeframe": "3m"}}
            ],
            "stop_reason": "tool_use",
            "stop_sequence": Value::Null,
            "usage": {"input_tokens": 0, "output_tokens": 0},
        });
        let response = parse_response(raw).expect("parse response");
        assert!(response.assistant_text.is_none());
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].id, "toolu_7");
        assert_eq!(response.tool_calls[0].name, "chart");
        assert_eq!(
            response.tool_calls[0].arguments,
            json!({"isin": "US0378331005", "timeframe": "3m"})
        );
        assert!(matches!(response.stop_reason, StopReason::ToolUse));
    }

    #[test]
    fn parses_final_text_response_as_end_turn() {
        let raw = json!({
            "content": [{"type": "text", "text": "no trade warranted"}],
            "stop_reason": "end_turn",
        });
        let response = parse_response(raw).expect("parse response");
        assert_eq!(
            response.assistant_text.as_deref(),
            Some("no trade warranted")
        );
        assert!(response.tool_calls.is_empty());
        assert!(matches!(response.stop_reason, StopReason::EndTurn));
    }

    #[test]
    fn maps_max_tokens_stop_reason() {
        let raw = json!({
            "content": [{"type": "text", "text": "partial"}],
            "stop_reason": "max_tokens",
        });
        let response = parse_response(raw).expect("parse response");
        assert!(matches!(response.stop_reason, StopReason::MaxTokens));
    }

    #[test]
    fn rejects_response_missing_content() {
        let err = parse_response(json!({})).expect_err("missing content must error");
        assert!(
            err.to_string()
                .contains(AGENT_PROVIDER_RESPONSE_INVALID_PREFIX)
        );
    }

    #[test]
    fn complete_retries_once_on_transient_5xx_then_succeeds() {
        let mut server = mockito::Server::new();
        let profile = test_profile(&server.url());
        let first = server
            .mock("POST", "/v1/messages")
            .with_status(500)
            .expect(1)
            .create();
        let success_body = json!({
            "content": [{"type": "text", "text": "no trade warranted"}],
            "stop_reason": "end_turn",
        });
        let second = server
            .mock("POST", "/v1/messages")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(success_body.to_string())
            .expect(1)
            .create();

        let provider = AnthropicProvider::new(
            reqwest::blocking::Client::new(),
            &profile,
            Some("sk-test".to_string()),
        )
        .expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "You are a trading assistant.",
            messages: &messages,
            tools: &[],
            model: "claude-sonnet-4-5",
            params: &params,
        };

        let response = provider
            .complete(&request)
            .expect("should retry the 500 and then succeed");
        assert_eq!(
            response.assistant_text.as_deref(),
            Some("no trade warranted")
        );
        first.assert();
        second.assert();
    }

    #[test]
    fn complete_does_not_retry_on_4xx() {
        let mut server = mockito::Server::new();
        let profile = test_profile(&server.url());
        let mock = server
            .mock("POST", "/v1/messages")
            .with_status(400)
            .with_body("bad request")
            .expect(1)
            .create();

        let provider = AnthropicProvider::new(reqwest::blocking::Client::new(), &profile, None)
            .expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "claude-sonnet-4-5",
            params: &params,
        };

        let err = provider
            .complete(&request)
            .expect_err("a 4xx must not be retried");
        assert!(err.to_string().contains(AGENT_PROVIDER_HTTP_ERROR_PREFIX));
        mock.assert();
    }

    #[test]
    fn complete_maps_401_to_auth_error() {
        let mut server = mockito::Server::new();
        let profile = test_profile(&server.url());
        let mock = server
            .mock("POST", "/v1/messages")
            .with_status(401)
            .with_body("missing credential")
            .expect(1)
            .create();

        let provider = AnthropicProvider::new(reqwest::blocking::Client::new(), &profile, None)
            .expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "claude-sonnet-4-5",
            params: &params,
        };

        let err = provider
            .complete(&request)
            .expect_err("401 must map to the auth-error prefix");
        assert!(err.to_string().contains(AGENT_PROVIDER_AUTH_ERROR_PREFIX));
        mock.assert();
    }

    #[test]
    fn complete_maps_429_to_rate_limited_without_retry() {
        let mut server = mockito::Server::new();
        let profile = test_profile(&server.url());
        let mock = server
            .mock("POST", "/v1/messages")
            .with_status(429)
            .with_body("slow down")
            .expect(1)
            .create();

        let provider = AnthropicProvider::new(reqwest::blocking::Client::new(), &profile, None)
            .expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "claude-sonnet-4-5",
            params: &params,
        };

        let err = provider
            .complete(&request)
            .expect_err("429 must map to the rate-limited prefix");
        assert!(err.to_string().contains(AGENT_PROVIDER_RATE_LIMITED_PREFIX));
        mock.assert();
    }

    #[test]
    fn complete_sends_api_version_and_omits_x_api_key_when_no_credential_configured() {
        let mut server = mockito::Server::new();
        let profile = test_profile(&server.url());
        let body = json!({"content": [{"type": "text", "text": "ok"}], "stop_reason": "end_turn"});
        let mock = server
            .mock("POST", "/v1/messages")
            .match_header("anthropic-version", "2023-06-01")
            .match_header("x-api-key", mockito::Matcher::Missing)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(body.to_string())
            .expect(1)
            .create();

        let provider = AnthropicProvider::new(reqwest::blocking::Client::new(), &profile, None)
            .expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "claude-sonnet-4-5",
            params: &params,
        };

        provider
            .complete(&request)
            .expect("request without a stored credential should still succeed");
        mock.assert();
    }

    #[test]
    fn complete_forwards_extra_headers() {
        let mut server = mockito::Server::new();
        let mut profile = test_profile(&server.url());
        profile
            .extra_headers
            .insert("x-org-id".to_string(), "org-42".to_string());
        let body = json!({"content": [{"type": "text", "text": "ok"}], "stop_reason": "end_turn"});
        let mock = server
            .mock("POST", "/v1/messages")
            .match_header("x-org-id", "org-42")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(body.to_string())
            .expect(1)
            .create();

        let provider = AnthropicProvider::new(reqwest::blocking::Client::new(), &profile, None)
            .expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "claude-sonnet-4-5",
            params: &params,
        };

        provider
            .complete(&request)
            .expect("request should succeed with the extra header attached");
        mock.assert();
    }
}

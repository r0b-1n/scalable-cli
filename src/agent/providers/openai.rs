//! OpenAI `/v1/chat/completions` wire adapter (`kind = "openai"`), also
//! backing `kind = "openai_compatible"` endpoints — `base_url` is fully
//! configurable here and nothing assumes `api.openai.com`.
//!
//! **Wire asymmetry vs. Ollama:** an assistant `tool_calls[].function.arguments`
//! is a JSON-*encoded string* on this wire, never a bare object. Incoming
//! responses are decoded with `serde_json::from_str`, and outgoing history
//! (a prior model turn being replayed back into a later request) is
//! re-encoded with `serde_json::to_string` before it goes on the wire.

use std::collections::BTreeMap;
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use serde_json::{Map, Value, json};

use crate::agent::config::{ProviderParams, ProviderProfile};
use crate::agent::providers::{
    ChatMessage, ChatProvider, ChatRequest, ChatResponse, StopReason, ToolCall, ToolSpec,
};
use crate::agent::{
    AGENT_PROVIDER_AUTH_ERROR_PREFIX, AGENT_PROVIDER_HTTP_ERROR_PREFIX,
    AGENT_PROVIDER_RATE_LIMITED_PREFIX, AGENT_PROVIDER_RESPONSE_INVALID_PREFIX,
};

pub(crate) struct OpenAiProvider {
    client: reqwest::blocking::Client,
    endpoint: String,
    model: String,
    api_key: Option<String>,
    extra_headers: BTreeMap<String, String>,
    max_retries: u8,
}

impl OpenAiProvider {
    pub(crate) fn new(
        client: reqwest::blocking::Client,
        profile: &ProviderProfile,
        api_key: Option<String>,
    ) -> Result<Self> {
        let base_url = profile
            .base_url
            .clone()
            .unwrap_or_else(|| "https://api.openai.com".to_string());
        Ok(Self {
            client,
            endpoint: format!("{}/v1/chat/completions", base_url.trim_end_matches('/')),
            model: profile.default_model.clone(),
            api_key,
            extra_headers: profile.extra_headers.clone(),
            max_retries: profile.max_retries,
        })
    }

    /// One HTTP attempt. Distinguishes transient failures (worth a retry —
    /// a connect/timeout transport error or a 5xx status) from everything
    /// else, which is returned as a terminal, already-prefixed error.
    fn send_once(&self, body: &Value) -> Result<Value, AttemptOutcome> {
        let mut builder = self.client.post(&self.endpoint).json(body);
        if let Some(key) = &self.api_key {
            builder = builder.bearer_auth(key);
        }
        for (name, value) in &self.extra_headers {
            builder = builder.header(name.as_str(), value.as_str());
        }

        let response = builder.send().map_err(|err| {
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
                    "{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} openai response body is not valid JSON: {err}"
                ))
            });
        }

        let code = status.as_u16();
        let detail = response.text().unwrap_or_default();
        let detail = detail.trim();
        if code == 401 || code == 403 {
            return Err(AttemptOutcome::Fatal(anyhow!(
                "{AGENT_PROVIDER_AUTH_ERROR_PREFIX} openai returned HTTP {code}: {detail}"
            )));
        }
        if code == 429 {
            return Err(AttemptOutcome::Fatal(anyhow!(
                "{AGENT_PROVIDER_RATE_LIMITED_PREFIX} openai returned HTTP {code}: {detail}"
            )));
        }
        let message = anyhow!("{AGENT_PROVIDER_HTTP_ERROR_PREFIX} openai returned HTTP {code}: {detail}");
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

/// Outcome of one HTTP attempt inside [`OpenAiProvider::send_once`].
enum AttemptOutcome {
    Retryable(anyhow::Error),
    Fatal(anyhow::Error),
}

impl ChatProvider for OpenAiProvider {
    fn complete(&self, request: &ChatRequest<'_>) -> Result<ChatResponse> {
        let model = if request.model.is_empty() { self.model.as_str() } else { request.model };
        let body = build_request_body(model, request, request.params)?;
        let raw = self.send_with_retry(&body)?;
        parse_response(raw)
    }
}

fn build_request_body(model: &str, request: &ChatRequest<'_>, params: &ProviderParams) -> Result<Value> {
    let mut messages = Vec::with_capacity(request.messages.len() + 1);
    if !request.system_prompt.is_empty() {
        messages.push(json!({"role": "system", "content": request.system_prompt}));
    }
    for message in request.messages {
        messages.push(render_message(message)?);
    }

    let mut body: Map<String, Value> = Map::new();
    body.insert("model".to_string(), json!(model));
    body.insert("messages".to_string(), Value::Array(messages));

    let tools: Vec<Value> = request.tools.iter().map(render_tool_spec).collect();
    if !tools.is_empty() {
        body.insert("tools".to_string(), Value::Array(tools));
        body.insert("tool_choice".to_string(), json!("auto"));
    }

    body.insert("stream".to_string(), json!(false));

    for (key, value) in params {
        body.insert(key.clone(), value.clone());
    }

    Ok(Value::Object(body))
}

fn render_tool_spec(tool: &ToolSpec) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.json_schema.clone(),
        },
    })
}

fn render_message(message: &ChatMessage) -> Result<Value> {
    Ok(match message {
        ChatMessage::User(text) => json!({"role": "user", "content": text}),
        ChatMessage::Assistant { text, tool_calls } => {
            let content = text.as_deref().map_or(Value::Null, |t| json!(t));
            if tool_calls.is_empty() {
                json!({"role": "assistant", "content": content})
            } else {
                let rendered_calls =
                    tool_calls.iter().map(render_tool_call).collect::<Result<Vec<_>>>()?;
                json!({
                    "role": "assistant",
                    "content": content,
                    "tool_calls": rendered_calls,
                })
            }
        }
        ChatMessage::Tool { tool_call_id, name: _, content } => json!({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": tool_content_string(content),
        }),
    })
}

/// Encodes `call.arguments` as a JSON string (fix per §5.3's asymmetry) —
/// the one place on the outgoing side where this format diverges from
/// Ollama's bare-object encoding.
fn render_tool_call(call: &ToolCall) -> Result<Value> {
    let arguments = serde_json::to_string(&call.arguments)
        .with_context(|| format!("failed to encode arguments for tool call '{}' as JSON", call.name))?;
    Ok(json!({
        "id": call.id,
        "type": "function",
        "function": {"name": call.name, "arguments": arguments},
    }))
}

/// A tool result is already-inert data (Invariant AG-2): a string content
/// goes on the wire verbatim, anything else (the common case — a JSON
/// object from a read tool) is JSON-encoded rather than double-encoded.
fn tool_content_string(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn parse_response(raw: Value) -> Result<ChatResponse> {
    let choice = raw
        .get("choices")
        .and_then(|choices| choices.get(0))
        .ok_or_else(|| anyhow!("{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} openai response missing choices[0]"))?;
    let message = choice.get("message").ok_or_else(|| {
        anyhow!("{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} openai response missing choices[0].message")
    })?;

    let assistant_text = message.get("content").and_then(Value::as_str).map(str::to_string);

    let mut tool_calls = Vec::new();
    if let Some(calls) = message.get("tool_calls").and_then(Value::as_array) {
        for call in calls {
            let id = call.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
            let function = call.get("function").ok_or_else(|| {
                anyhow!("{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} openai tool_calls[] missing 'function'")
            })?;
            let name = function
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    anyhow!("{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} openai tool_calls[].function missing 'name'")
                })?
                .to_string();
            // The critical asymmetry: `arguments` MUST be a JSON-encoded string here, the
            // opposite of Ollama's bare object — a caller that already sent a bare object is
            // rejected rather than silently accepted.
            let arguments_json = function.get("arguments").and_then(Value::as_str).ok_or_else(|| {
                anyhow!(
                    "{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} openai tool_calls[].function.arguments must be a JSON-encoded string"
                )
            })?;
            let arguments: Value = serde_json::from_str(arguments_json).map_err(|err| {
                anyhow!(
                    "{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} openai tool_calls[].function.arguments is not valid JSON: {err}"
                )
            })?;
            tool_calls.push(ToolCall { id, name, arguments });
        }
    }

    let stop_reason = match choice.get("finish_reason").and_then(Value::as_str).unwrap_or_default() {
        "tool_calls" => StopReason::ToolUse,
        "stop" => StopReason::EndTurn,
        "length" => StopReason::MaxTokens,
        other => StopReason::Other(other.to_string()),
    };

    Ok(ChatResponse { assistant_text, tool_calls, stop_reason, raw })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::config::ProviderKind;

    fn test_profile(base_url: &str) -> ProviderProfile {
        ProviderProfile {
            id: "test-openai".to_string(),
            kind: ProviderKind::Openai,
            base_url: Some(base_url.to_string()),
            default_model: "gpt-4o".to_string(),
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
    /// result) renders into the exact wire shape spec §5.3 documents,
    /// including the tool-result round trip and the JSON-encoded-string
    /// argument quirk on the way out.
    #[test]
    fn builds_request_body_with_system_prompt_history_and_tools() {
        let tools = vec![ToolSpec {
            name: "quote",
            description: "Fetch a quote.",
            json_schema: json!({"type": "object", "properties": {"isin": {"type": "string"}}}),
        }];
        let messages = vec![
            ChatMessage::User("Check DE0007164600.".to_string()),
            ChatMessage::Assistant {
                text: None,
                tool_calls: vec![ToolCall {
                    id: "call_1".to_string(),
                    name: "quote".to_string(),
                    arguments: json!({"isin": "DE0007164600"}),
                }],
            },
            ChatMessage::Tool {
                tool_call_id: "call_1".to_string(),
                name: "quote".to_string(),
                content: json!({"price": 123.45}),
            },
        ];
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "You are a trading assistant.",
            messages: &messages,
            tools: &tools,
            model: "gpt-4o",
            params: &params,
        };

        let body = build_request_body(request.model, &request, &params).expect("build request body");

        assert_eq!(body["model"], json!("gpt-4o"));
        assert_eq!(
            body["messages"][0],
            json!({"role": "system", "content": "You are a trading assistant."})
        );
        assert_eq!(body["messages"][1], json!({"role": "user", "content": "Check DE0007164600."}));
        assert_eq!(body["messages"][2]["role"], json!("assistant"));
        assert_eq!(body["messages"][2]["content"], Value::Null);

        let sent_arguments = body["messages"][2]["tool_calls"][0]["function"]["arguments"]
            .as_str()
            .expect("arguments must be a JSON-encoded string, not a bare object");
        assert_eq!(
            serde_json::from_str::<Value>(sent_arguments).expect("arguments string must be valid JSON"),
            json!({"isin": "DE0007164600"})
        );

        assert_eq!(
            body["messages"][3],
            json!({"role": "tool", "tool_call_id": "call_1", "content": "{\"price\":123.45}"})
        );

        assert_eq!(
            body["tools"][0],
            json!({
                "type": "function",
                "function": {
                    "name": "quote",
                    "description": "Fetch a quote.",
                    "parameters": {"type": "object", "properties": {"isin": {"type": "string"}}},
                },
            })
        );
        assert_eq!(body["tool_choice"], json!("auto"));
        assert_eq!(body["stream"], json!(false));
    }

    /// `params` merges verbatim as top-level sibling keys of the body.
    #[test]
    fn merges_params_as_top_level_body_keys() {
        let mut params = ProviderParams::new();
        params.insert("temperature".to_string(), json!(0.2));
        let messages = Vec::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "gpt-4o",
            params: &params,
        };
        let body = build_request_body(request.model, &request, &params).expect("build request body");
        assert_eq!(body["temperature"], json!(0.2));
        assert!(body.get("tools").is_none());
        assert!(body.get("tool_choice").is_none());
    }

    /// Tool-result round trip: an already-string tool result is placed on
    /// the wire verbatim rather than being JSON-re-encoded (which would
    /// double-quote it).
    #[test]
    fn renders_tool_message_content_as_string_without_double_encoding() {
        let message = ChatMessage::Tool {
            tool_call_id: "call_9".to_string(),
            name: "quote".to_string(),
            content: Value::String("already text".to_string()),
        };
        let rendered = render_message(&message).expect("render tool message");
        assert_eq!(rendered["role"], json!("tool"));
        assert_eq!(rendered["tool_call_id"], json!("call_9"));
        assert_eq!(rendered["content"], json!("already text"));
    }

    /// Golden-fixture round trip, inbound half, plus tool-call extraction
    /// and the argument-encoding quirk: `function.arguments` arrives as a
    /// JSON-encoded string and must be decoded with `from_str`, never used
    /// as a bare object.
    #[test]
    fn parses_tool_calls_and_decodes_json_encoded_arguments() {
        let raw = json!({
            "id": "chatcmpl-1",
            "object": "chat.completion",
            "model": "gpt-4o",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": Value::Null,
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "quote", "arguments": "{\"isin\":\"DE0007164600\"}"},
                    }],
                },
                "finish_reason": "tool_calls",
            }],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        });

        let response = parse_response(raw).expect("parse response");
        assert!(response.assistant_text.is_none());
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].id, "call_1");
        assert_eq!(response.tool_calls[0].name, "quote");
        assert_eq!(response.tool_calls[0].arguments, json!({"isin": "DE0007164600"}));
        assert!(matches!(response.stop_reason, StopReason::ToolUse));
    }

    #[test]
    fn parses_final_text_response_as_end_turn() {
        let raw = json!({
            "choices": [{
                "message": {"role": "assistant", "content": "no trade is warranted this run"},
                "finish_reason": "stop",
            }],
        });
        let response = parse_response(raw).expect("parse response");
        assert_eq!(response.assistant_text.as_deref(), Some("no trade is warranted this run"));
        assert!(response.tool_calls.is_empty());
        assert!(matches!(response.stop_reason, StopReason::EndTurn));
    }

    #[test]
    fn maps_length_finish_reason_to_max_tokens() {
        let raw = json!({
            "choices": [{"message": {"role": "assistant", "content": "partial"}, "finish_reason": "length"}],
        });
        let response = parse_response(raw).expect("parse response");
        assert!(matches!(response.stop_reason, StopReason::MaxTokens));
    }

    /// The asymmetry enforced the other way: a bare object where the wire
    /// requires a JSON-encoded string is rejected, not silently accepted.
    #[test]
    fn rejects_tool_call_arguments_that_are_not_a_json_encoded_string() {
        let raw = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "quote", "arguments": {"isin": "DE0007164600"}},
                    }],
                },
                "finish_reason": "tool_calls",
            }],
        });
        let err = parse_response(raw).expect_err("bare object arguments must be rejected");
        assert!(err.to_string().contains(AGENT_PROVIDER_RESPONSE_INVALID_PREFIX));
    }

    #[test]
    fn rejects_response_missing_choices() {
        let err = parse_response(json!({})).expect_err("missing choices must error");
        assert!(err.to_string().contains(AGENT_PROVIDER_RESPONSE_INVALID_PREFIX));
    }

    #[test]
    fn complete_retries_once_on_transient_5xx_then_succeeds() {
        let mut server = mockito::Server::new();
        let profile = test_profile(&server.url());
        let first = server.mock("POST", "/v1/chat/completions").with_status(500).expect(1).create();
        let success_body = json!({
            "choices": [{
                "message": {"role": "assistant", "content": "no trade is warranted this run"},
                "finish_reason": "stop",
            }],
        });
        let second = server
            .mock("POST", "/v1/chat/completions")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(success_body.to_string())
            .expect(1)
            .create();

        let provider = OpenAiProvider::new(reqwest::blocking::Client::new(), &profile, Some("sk-test".to_string()))
            .expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "You are a trading assistant.",
            messages: &messages,
            tools: &[],
            model: "gpt-4o",
            params: &params,
        };

        let response = provider.complete(&request).expect("should retry the 500 and then succeed");
        assert_eq!(response.assistant_text.as_deref(), Some("no trade is warranted this run"));
        first.assert();
        second.assert();
    }

    #[test]
    fn complete_does_not_retry_on_4xx() {
        let mut server = mockito::Server::new();
        let profile = test_profile(&server.url());
        let mock = server
            .mock("POST", "/v1/chat/completions")
            .with_status(400)
            .with_body("bad request")
            .expect(1)
            .create();

        let provider =
            OpenAiProvider::new(reqwest::blocking::Client::new(), &profile, None).expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "gpt-4o",
            params: &params,
        };

        let err = provider.complete(&request).expect_err("a 4xx must not be retried");
        assert!(err.to_string().contains(AGENT_PROVIDER_HTTP_ERROR_PREFIX));
        mock.assert();
    }

    #[test]
    fn complete_maps_401_to_auth_error() {
        let mut server = mockito::Server::new();
        let profile = test_profile(&server.url());
        let mock = server
            .mock("POST", "/v1/chat/completions")
            .with_status(401)
            .with_body("missing credential")
            .expect(1)
            .create();

        let provider =
            OpenAiProvider::new(reqwest::blocking::Client::new(), &profile, None).expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "gpt-4o",
            params: &params,
        };

        let err = provider.complete(&request).expect_err("401 must map to the auth-error prefix");
        assert!(err.to_string().contains(AGENT_PROVIDER_AUTH_ERROR_PREFIX));
        mock.assert();
    }

    #[test]
    fn complete_maps_429_to_rate_limited_without_retry() {
        let mut server = mockito::Server::new();
        let profile = test_profile(&server.url());
        let mock = server
            .mock("POST", "/v1/chat/completions")
            .with_status(429)
            .with_body("slow down")
            .expect(1)
            .create();

        let provider =
            OpenAiProvider::new(reqwest::blocking::Client::new(), &profile, None).expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "gpt-4o",
            params: &params,
        };

        let err = provider.complete(&request).expect_err("429 must map to the rate-limited prefix");
        assert!(err.to_string().contains(AGENT_PROVIDER_RATE_LIMITED_PREFIX));
        mock.assert();
    }

    #[test]
    fn complete_omits_authorization_header_when_no_api_key_configured() {
        let mut server = mockito::Server::new();
        let profile = test_profile(&server.url());
        let body = json!({
            "choices": [{"message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
        });
        let mock = server
            .mock("POST", "/v1/chat/completions")
            .match_header("authorization", mockito::Matcher::Missing)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(body.to_string())
            .expect(1)
            .create();

        let provider =
            OpenAiProvider::new(reqwest::blocking::Client::new(), &profile, None).expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "gpt-4o",
            params: &params,
        };

        provider.complete(&request).expect("request without a stored credential should still succeed");
        mock.assert();
    }
}

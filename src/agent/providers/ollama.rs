//! Ollama `/api/chat` wire adapter (`kind = "ollama"`).
//!
//! Ollama is usually a local daemon with no auth of its own, so no
//! `Authorization` header is sent unless a credential happens to be
//! configured for this profile (some Ollama-compatible gateways require
//! one) — sent as `Authorization: Bearer <key>` when present, omitted
//! entirely otherwise. Its default `base_url` is a loopback `http://`
//! address, which `provider_http_client` only allows through when the
//! profile's `allow_insecure_http` is set.
//!
//! **Critical asymmetry vs. OpenAI:** an assistant `tool_calls[].function.arguments`
//! is already a bare JSON *object* on this wire, never a JSON-encoded
//! string — it is read and written as a `Value` directly, with no
//! `serde_json::to_string`/`from_str` step in either direction. Ollama also
//! mints no id for a tool call on the wire, so one is synthesized as
//! `format!("ollama_call_{n}")` from its position in the array, and
//! `params` merges under a nested `"options"` object rather than as
//! top-level sibling keys of the body.

use std::collections::BTreeMap;
use std::time::Duration;

use anyhow::{Result, anyhow};
use serde_json::{Map, Value, json};

use crate::agent::config::ProviderProfile;
use crate::agent::providers::{
    ChatMessage, ChatProvider, ChatRequest, ChatResponse, StopReason, ToolCall, ToolSpec,
};
use crate::agent::{
    AGENT_PROVIDER_AUTH_ERROR_PREFIX, AGENT_PROVIDER_HTTP_ERROR_PREFIX,
    AGENT_PROVIDER_RATE_LIMITED_PREFIX, AGENT_PROVIDER_RESPONSE_INVALID_PREFIX,
};

pub(crate) struct OllamaProvider {
    client: reqwest::blocking::Client,
    endpoint: String,
    model: String,
    api_key: Option<String>,
    extra_headers: BTreeMap<String, String>,
    max_retries: u8,
}

impl OllamaProvider {
    pub(crate) fn new(
        client: reqwest::blocking::Client,
        profile: &ProviderProfile,
        api_key: Option<String>,
    ) -> Result<Self> {
        let base_url = profile
            .base_url
            .clone()
            .unwrap_or_else(|| "http://127.0.0.1:11434".to_string());
        Ok(Self {
            client,
            endpoint: format!("{}/api/chat", base_url.trim_end_matches('/')),
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
                    "{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} ollama response body is not valid JSON: {err}"
                ))
            });
        }

        let code = status.as_u16();
        let detail = response.text().unwrap_or_default();
        let detail = detail.trim();
        if code == 401 || code == 403 {
            return Err(AttemptOutcome::Fatal(anyhow!(
                "{AGENT_PROVIDER_AUTH_ERROR_PREFIX} ollama returned HTTP {code}: {detail}"
            )));
        }
        if code == 429 {
            return Err(AttemptOutcome::Fatal(anyhow!(
                "{AGENT_PROVIDER_RATE_LIMITED_PREFIX} ollama returned HTTP {code}: {detail}"
            )));
        }
        let message = anyhow!("{AGENT_PROVIDER_HTTP_ERROR_PREFIX} ollama returned HTTP {code}: {detail}");
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

/// Outcome of one HTTP attempt inside [`OllamaProvider::send_once`].
enum AttemptOutcome {
    Retryable(anyhow::Error),
    Fatal(anyhow::Error),
}

impl ChatProvider for OllamaProvider {
    fn complete(&self, request: &ChatRequest<'_>) -> Result<ChatResponse> {
        let model = if request.model.is_empty() { self.model.as_str() } else { request.model };
        let body = build_request_body(model, request);
        let raw = self.send_with_retry(&body)?;
        parse_response(raw)
    }
}

fn build_request_body(model: &str, request: &ChatRequest<'_>) -> Value {
    let mut messages = Vec::with_capacity(request.messages.len() + 1);
    if !request.system_prompt.is_empty() {
        messages.push(json!({"role": "system", "content": request.system_prompt}));
    }
    for message in request.messages {
        messages.push(render_message(message));
    }

    let mut body: Map<String, Value> = Map::new();
    body.insert("model".to_string(), json!(model));
    body.insert("messages".to_string(), Value::Array(messages));

    if !request.tools.is_empty() {
        let tools: Vec<Value> = request.tools.iter().map(render_tool_spec).collect();
        body.insert("tools".to_string(), Value::Array(tools));
    }

    body.insert("stream".to_string(), json!(false));

    if !request.params.is_empty() {
        body.insert("options".to_string(), Value::Object(request.params.clone()));
    }

    Value::Object(body)
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

fn render_message(message: &ChatMessage) -> Value {
    match message {
        ChatMessage::User(text) => json!({"role": "user", "content": text}),
        ChatMessage::Assistant { text, tool_calls } => {
            let content = text.clone().unwrap_or_default();
            if tool_calls.is_empty() {
                json!({"role": "assistant", "content": content})
            } else {
                let rendered_calls: Vec<Value> = tool_calls.iter().map(render_tool_call).collect();
                json!({
                    "role": "assistant",
                    "content": content,
                    "tool_calls": rendered_calls,
                })
            }
        }
        ChatMessage::Tool { tool_call_id: _, name: _, content } => json!({
            "role": "tool",
            "content": tool_content_string(content),
        }),
    }
}

/// `call.arguments` stays a bare JSON object here (fix per the module
/// asymmetry note) — the one place on the outgoing side where this format
/// diverges from OpenAI's JSON-encoded-string encoding. Ollama tool calls
/// carry no `id` on the wire, so `call.id` has nothing to round-trip into.
fn render_tool_call(call: &ToolCall) -> Value {
    json!({"function": {"name": call.name, "arguments": call.arguments.clone()}})
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
    let message = raw
        .get("message")
        .ok_or_else(|| anyhow!("{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} ollama response missing 'message'"))?;

    let assistant_text =
        message.get("content").and_then(Value::as_str).filter(|text| !text.is_empty()).map(str::to_string);

    let mut tool_calls = Vec::new();
    if let Some(calls) = message.get("tool_calls").and_then(Value::as_array) {
        for (index, call) in calls.iter().enumerate() {
            let function = call.get("function").ok_or_else(|| {
                anyhow!("{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} ollama tool_calls[] missing 'function'")
            })?;
            let name = function
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    anyhow!("{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} ollama tool_calls[].function missing 'name'")
                })?
                .to_string();
            // The critical asymmetry: `arguments` is already a bare JSON object on this wire,
            // the opposite of OpenAI's JSON-encoded string — taken as-is, never `from_str`'d, so
            // a string value here (the OpenAI shape, fed to the wrong adapter) stays an opaque
            // string rather than being silently decoded into an object.
            let arguments = function.get("arguments").cloned().ok_or_else(|| {
                anyhow!("{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} ollama tool_calls[].function missing 'arguments'")
            })?;
            tool_calls.push(ToolCall { id: format!("ollama_call_{index}"), name, arguments });
        }
    }

    // Ollama's `done_reason` is fixed at `"stop"` for both a plain answer and a tool-calling
    // turn, so tool use is detected from the presence of `tool_calls`, never from that field.
    let stop_reason = if tool_calls.is_empty() { StopReason::EndTurn } else { StopReason::ToolUse };

    Ok(ChatResponse { assistant_text, tool_calls, stop_reason, raw })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::config::{ProviderKind, ProviderParams};

    fn test_profile(base_url: &str) -> ProviderProfile {
        ProviderProfile {
            id: "test-ollama".to_string(),
            kind: ProviderKind::Ollama,
            base_url: Some(base_url.to_string()),
            default_model: "llama3.1:70b".to_string(),
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
    /// result) renders into the exact wire shape spec §5.5 documents —
    /// `arguments` as a bare object, no `id` on the rendered tool call, and
    /// a tool message carrying only `role`/`content`.
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
                    id: "ollama_call_0".to_string(),
                    name: "quote".to_string(),
                    arguments: json!({"isin": "DE0007164600"}),
                }],
            },
            ChatMessage::Tool {
                tool_call_id: "ollama_call_0".to_string(),
                name: "quote".to_string(),
                content: json!({"price": 123.45}),
            },
        ];
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "You are a trading assistant.",
            messages: &messages,
            tools: &tools,
            model: "llama3.1:70b",
            params: &params,
        };

        let body = build_request_body(request.model, &request);

        assert_eq!(body["model"], json!("llama3.1:70b"));
        assert_eq!(
            body["messages"][0],
            json!({"role": "system", "content": "You are a trading assistant."})
        );
        assert_eq!(body["messages"][1], json!({"role": "user", "content": "Check DE0007164600."}));
        assert_eq!(body["messages"][2]["role"], json!("assistant"));
        assert_eq!(body["messages"][2]["content"], json!(""));

        let rendered_call = &body["messages"][2]["tool_calls"][0];
        assert!(rendered_call.get("id").is_none());
        assert_eq!(rendered_call["function"]["name"], json!("quote"));
        let sent_arguments = &rendered_call["function"]["arguments"];
        assert!(sent_arguments.is_object(), "arguments must stay a bare object, not a string");
        assert_eq!(sent_arguments, &json!({"isin": "DE0007164600"}));

        assert_eq!(body["messages"][3], json!({"role": "tool", "content": "{\"price\":123.45}"}));

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
        assert_eq!(body["stream"], json!(false));
    }

    /// `params` merges under a nested `"options"` object rather than as
    /// top-level sibling keys (unlike the OpenAI adapter).
    #[test]
    fn merges_params_under_nested_options_object() {
        let mut params = ProviderParams::new();
        params.insert("temperature".to_string(), json!(0.2));
        let messages = Vec::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "llama3.1:70b",
            params: &params,
        };
        let body = build_request_body(request.model, &request);
        assert_eq!(body["options"], json!({"temperature": 0.2}));
        assert!(body.get("temperature").is_none());
        assert!(body.get("tools").is_none());
    }

    #[test]
    fn omits_options_and_tools_when_empty() {
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "llama3.1:70b",
            params: &params,
        };
        let body = build_request_body(request.model, &request);
        assert!(body.get("options").is_none());
        assert!(body.get("tools").is_none());
    }

    /// Tool-result round trip: an already-string tool result is placed on
    /// the wire verbatim rather than being JSON-re-encoded (which would
    /// double-quote it), and a non-string result is JSON-encoded exactly
    /// once.
    #[test]
    fn renders_tool_message_content_as_string_without_double_encoding() {
        let string_result = ChatMessage::Tool {
            tool_call_id: "ollama_call_0".to_string(),
            name: "quote".to_string(),
            content: Value::String("already text".to_string()),
        };
        let rendered = render_message(&string_result);
        assert_eq!(rendered, json!({"role": "tool", "content": "already text"}));

        let object_result = ChatMessage::Tool {
            tool_call_id: "ollama_call_0".to_string(),
            name: "quote".to_string(),
            content: json!({"price": 123.45}),
        };
        let rendered = render_message(&object_result);
        assert_eq!(rendered, json!({"role": "tool", "content": "{\"price\":123.45}"}));
    }

    /// Golden-fixture round trip, inbound half, plus tool-call extraction:
    /// `message.tool_calls[].function.arguments` arrives as a bare JSON
    /// object and is used directly, with a synthesized `ollama_call_{n}` id.
    #[test]
    fn parses_tool_calls_and_reads_arguments_as_a_bare_object() {
        let raw = json!({
            "model": "llama3.1:70b",
            "created_at": "2026-09-15T00:00:00Z",
            "message": {
                "role": "assistant",
                "content": "",
                "tool_calls": [{"function": {"name": "quote", "arguments": {"isin": "DE0007164600"}}}],
            },
            "done": true,
            "done_reason": "stop",
            "prompt_eval_count": 10,
            "eval_count": 5,
        });

        let response = parse_response(raw).expect("parse response");
        assert!(response.assistant_text.is_none());
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].id, "ollama_call_0");
        assert_eq!(response.tool_calls[0].name, "quote");
        assert!(response.tool_calls[0].arguments.is_object());
        assert_eq!(response.tool_calls[0].arguments, json!({"isin": "DE0007164600"}));
        assert!(matches!(response.stop_reason, StopReason::ToolUse));
    }

    /// The asymmetry checked from the inbound side: an OpenAI-shaped,
    /// JSON-*encoded-string* `arguments` value must not be silently
    /// unwrapped into the object it encodes — this adapter never calls
    /// `serde_json::from_str` on it, so it comes through as an opaque
    /// string, which a caller expecting an object will then visibly fail
    /// on rather than being fed a wrong-looking-right value.
    #[test]
    fn does_not_decode_json_encoded_string_arguments_into_an_object() {
        let raw = json!({
            "message": {
                "role": "assistant",
                "content": "",
                "tool_calls": [{
                    "function": {"name": "quote", "arguments": "{\"isin\":\"DE0007164600\"}"},
                }],
            },
            "done": true,
            "done_reason": "stop",
        });

        let response = parse_response(raw).expect("parse response");
        assert_eq!(response.tool_calls.len(), 1);
        let arguments = &response.tool_calls[0].arguments;
        assert!(arguments.is_string(), "a string arguments value must stay a string, not be decoded");
        assert_ne!(arguments, &json!({"isin": "DE0007164600"}));
        assert_eq!(arguments, &json!("{\"isin\":\"DE0007164600\"}"));
    }

    #[test]
    fn parses_final_text_response_as_end_turn() {
        let raw = json!({
            "message": {"role": "assistant", "content": "no trade is warranted this run"},
            "done": true,
            "done_reason": "stop",
        });
        let response = parse_response(raw).expect("parse response");
        assert_eq!(response.assistant_text.as_deref(), Some("no trade is warranted this run"));
        assert!(response.tool_calls.is_empty());
        assert!(matches!(response.stop_reason, StopReason::EndTurn));
    }

    #[test]
    fn rejects_tool_call_missing_function_name() {
        let raw = json!({
            "message": {
                "role": "assistant",
                "content": "",
                "tool_calls": [{"function": {"arguments": {"isin": "DE0007164600"}}}],
            },
            "done": true,
        });
        let err = parse_response(raw).expect_err("missing function.name must error");
        assert!(err.to_string().contains(AGENT_PROVIDER_RESPONSE_INVALID_PREFIX));
    }

    #[test]
    fn rejects_response_missing_message() {
        let err = parse_response(json!({"done": true})).expect_err("missing message must error");
        assert!(err.to_string().contains(AGENT_PROVIDER_RESPONSE_INVALID_PREFIX));
    }

    #[test]
    fn complete_retries_once_on_transient_5xx_then_succeeds() {
        let mut server = mockito::Server::new();
        let profile = test_profile(&server.url());
        let first = server.mock("POST", "/api/chat").with_status(500).expect(1).create();
        let success_body = json!({
            "message": {"role": "assistant", "content": "no trade is warranted this run"},
            "done": true,
            "done_reason": "stop",
        });
        let second = server
            .mock("POST", "/api/chat")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(success_body.to_string())
            .expect(1)
            .create();

        let provider = OllamaProvider::new(reqwest::blocking::Client::new(), &profile, None)
            .expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "You are a trading assistant.",
            messages: &messages,
            tools: &[],
            model: "llama3.1:70b",
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
        let mock = server.mock("POST", "/api/chat").with_status(400).with_body("bad request").expect(1).create();

        let provider = OllamaProvider::new(reqwest::blocking::Client::new(), &profile, None)
            .expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "llama3.1:70b",
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
            .mock("POST", "/api/chat")
            .with_status(401)
            .with_body("missing credential")
            .expect(1)
            .create();

        let provider = OllamaProvider::new(reqwest::blocking::Client::new(), &profile, None)
            .expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "llama3.1:70b",
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
        let mock = server.mock("POST", "/api/chat").with_status(429).with_body("slow down").expect(1).create();

        let provider = OllamaProvider::new(reqwest::blocking::Client::new(), &profile, None)
            .expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "llama3.1:70b",
            params: &params,
        };

        let err = provider.complete(&request).expect_err("429 must map to the rate-limited prefix");
        assert!(err.to_string().contains(AGENT_PROVIDER_RATE_LIMITED_PREFIX));
        mock.assert();
    }

    /// The local-daemon default: no stored credential means no
    /// `Authorization` header is sent at all, rather than an empty one.
    #[test]
    fn complete_omits_authorization_header_when_no_api_key_configured() {
        let mut server = mockito::Server::new();
        let profile = test_profile(&server.url());
        let body = json!({"message": {"role": "assistant", "content": "ok"}, "done": true});
        let mock = server
            .mock("POST", "/api/chat")
            .match_header("authorization", mockito::Matcher::Missing)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(body.to_string())
            .expect(1)
            .create();

        let provider = OllamaProvider::new(reqwest::blocking::Client::new(), &profile, None)
            .expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "llama3.1:70b",
            params: &params,
        };

        provider.complete(&request).expect("request without a stored credential should still succeed");
        mock.assert();
    }

    /// A configured gateway credential is sent as a bearer token, matching
    /// the OpenAI adapter's header shape even though a bare local daemon
    /// never checks it.
    #[test]
    fn complete_sends_bearer_auth_when_api_key_configured() {
        let mut server = mockito::Server::new();
        let profile = test_profile(&server.url());
        let body = json!({"message": {"role": "assistant", "content": "ok"}, "done": true});
        let mock = server
            .mock("POST", "/api/chat")
            .match_header("authorization", "Bearer gw-secret")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(body.to_string())
            .expect(1)
            .create();

        let provider = OllamaProvider::new(reqwest::blocking::Client::new(), &profile, Some("gw-secret".to_string()))
            .expect("construct provider");
        let messages = Vec::new();
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "llama3.1:70b",
            params: &params,
        };

        provider.complete(&request).expect("request with a stored credential should still succeed");
        mock.assert();
    }
}

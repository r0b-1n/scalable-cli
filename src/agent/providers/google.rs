//! Google Gemini `:generateContent` wire adapter (`kind = "google"`).
//!
//! Gemini has no `"system"` or `"tool"` role: the system prompt is sent as a
//! separate `systemInstruction` field, and a tool result goes back as a
//! `"user"`-role content whose single part is a `functionResponse` (the
//! payload wrapped one level deeper, under a fixed `content` key, because
//! Gemini requires `functionResponse.response` to be a JSON object even
//! when the tool's own result is a scalar or an array). A model tool call
//! arrives as a `functionCall` part carrying `args` as a bare JSON object
//! (the opposite of OpenAI's JSON-encoded-string `arguments`), and Gemini
//! never assigns it a call id, so one is synthesized from the part's index.
//! `finishReason` is `"STOP"` for a tool call exactly as it is for a plain
//! answer, so tool use is detected from the presence of a `functionCall`
//! part, never from `finishReason`.

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

pub(crate) struct GoogleProvider {
    client: reqwest::blocking::Client,
    base_url: String,
    model: String,
    api_key: Option<String>,
    extra_headers: BTreeMap<String, String>,
    max_retries: u8,
}

impl GoogleProvider {
    pub(crate) fn new(
        client: reqwest::blocking::Client,
        profile: &ProviderProfile,
        api_key: Option<String>,
    ) -> Result<Self> {
        Ok(Self {
            client,
            base_url: profile
                .base_url
                .clone()
                .unwrap_or_else(|| "https://generativelanguage.googleapis.com".to_string()),
            model: profile.default_model.clone(),
            api_key,
            extra_headers: profile.extra_headers.clone(),
            max_retries: profile.max_retries,
        })
    }

    /// One HTTP attempt. Distinguishes transient failures (worth a retry —
    /// a connect/timeout transport error or a 5xx status) from everything
    /// else, which is returned as a terminal, already-prefixed error.
    fn send_once(&self, endpoint: &str, body: &Value) -> Result<Value, AttemptOutcome> {
        let mut builder = self.client.post(endpoint).json(body);
        if let Some(key) = &self.api_key {
            builder = builder.header("x-goog-api-key", key.as_str());
        }
        for (name, value) in &self.extra_headers {
            builder = builder.header(name.as_str(), value.as_str());
        }

        let response = builder.send().map_err(|err| {
            let message =
                anyhow!("{AGENT_PROVIDER_HTTP_ERROR_PREFIX} request to '{endpoint}' failed: {err}");
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
                    "{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} google response body is not valid JSON: {err}"
                ))
            });
        }

        let code = status.as_u16();
        let detail = response.text().unwrap_or_default();
        let detail = detail.trim();
        if code == 401 || code == 403 {
            return Err(AttemptOutcome::Fatal(anyhow!(
                "{AGENT_PROVIDER_AUTH_ERROR_PREFIX} google returned HTTP {code}: {detail}"
            )));
        }
        if code == 429 {
            return Err(AttemptOutcome::Fatal(anyhow!(
                "{AGENT_PROVIDER_RATE_LIMITED_PREFIX} google returned HTTP {code}: {detail}"
            )));
        }
        let message = anyhow!("{AGENT_PROVIDER_HTTP_ERROR_PREFIX} google returned HTTP {code}: {detail}");
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
    fn send_with_retry(&self, endpoint: &str, body: &Value) -> Result<Value> {
        let mut attempt: u8 = 0;
        loop {
            match self.send_once(endpoint, body) {
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

/// Outcome of one HTTP attempt inside [`GoogleProvider::send_once`].
enum AttemptOutcome {
    Retryable(anyhow::Error),
    Fatal(anyhow::Error),
}

impl ChatProvider for GoogleProvider {
    fn complete(&self, request: &ChatRequest<'_>) -> Result<ChatResponse> {
        let model = if request.model.is_empty() { self.model.as_str() } else { request.model };
        let endpoint = generate_content_endpoint(&self.base_url, model);
        let body = build_request_body(request);
        let raw = self.send_with_retry(&endpoint, &body)?;
        parse_response(raw)
    }
}

/// `{base_url}/v1beta/models/{model}:generateContent` — the model, not just
/// the provider, is part of the path, so unlike the other three adapters
/// this can't be precomputed once at construction time.
fn generate_content_endpoint(base_url: &str, model: &str) -> String {
    format!("{}/v1beta/models/{model}:generateContent", base_url.trim_end_matches('/'))
}

fn build_request_body(request: &ChatRequest<'_>) -> Value {
    let mut body: Map<String, Value> = Map::new();

    if !request.system_prompt.is_empty() {
        body.insert(
            "systemInstruction".to_string(),
            json!({"parts": [{"text": request.system_prompt}]}),
        );
    }

    let contents: Vec<Value> = request.messages.iter().map(render_message).collect();
    body.insert("contents".to_string(), Value::Array(contents));

    if !request.tools.is_empty() {
        let declarations: Vec<Value> = request.tools.iter().map(render_tool_spec).collect();
        body.insert("tools".to_string(), json!([{"functionDeclarations": declarations}]));
    }

    if !request.params.is_empty() {
        body.insert("generationConfig".to_string(), Value::Object(request.params.clone()));
    }

    Value::Object(body)
}

fn render_tool_spec(tool: &ToolSpec) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description,
        "parameters": tool.json_schema.clone(),
    })
}

fn render_message(message: &ChatMessage) -> Value {
    match message {
        ChatMessage::User(text) => json!({"role": "user", "parts": [{"text": text}]}),
        ChatMessage::Assistant { text, tool_calls } => {
            let mut parts = Vec::with_capacity(tool_calls.len() + 1);
            if let Some(text) = text {
                parts.push(json!({"text": text}));
            }
            for call in tool_calls {
                parts.push(json!({"functionCall": {"name": call.name, "args": call.arguments}}));
            }
            if parts.is_empty() {
                parts.push(json!({"text": ""}));
            }
            json!({"role": "model", "parts": parts})
        }
        ChatMessage::Tool { tool_call_id: _, name, content } => json!({
            "role": "user",
            "parts": [{"functionResponse": {"name": name, "response": {"content": content}}}],
        }),
    }
}

fn parse_response(raw: Value) -> Result<ChatResponse> {
    let candidate = raw.get("candidates").and_then(|candidates| candidates.get(0)).ok_or_else(|| {
        anyhow!("{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} google response missing candidates[0]")
    })?;
    let parts = candidate
        .get("content")
        .and_then(|content| content.get("parts"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut assistant_text = None;
    let mut tool_calls = Vec::new();
    for (index, part) in parts.iter().enumerate() {
        if let Some(text) = part.get("text").and_then(Value::as_str) {
            assistant_text = Some(text.to_string());
        }
        if let Some(call) = part.get("functionCall") {
            let name = call
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    anyhow!("{AGENT_PROVIDER_RESPONSE_INVALID_PREFIX} google functionCall part missing 'name'")
                })?
                .to_string();
            let arguments = call.get("args").cloned().unwrap_or(Value::Null);
            tool_calls.push(ToolCall { id: format!("gcall_{index}"), name, arguments });
        }
    }

    // A `functionCall` part, never `finishReason`, is what marks tool use — Gemini reports
    // "STOP" for a tool call exactly as it does for a plain answer.
    let stop_reason = if !tool_calls.is_empty() {
        StopReason::ToolUse
    } else {
        match candidate.get("finishReason").and_then(Value::as_str).unwrap_or_default() {
            "STOP" => StopReason::EndTurn,
            "MAX_TOKENS" => StopReason::MaxTokens,
            other => StopReason::Other(other.to_string()),
        }
    };

    Ok(ChatResponse { assistant_text, tool_calls, stop_reason, raw })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::config::{ProviderKind, ProviderParams};

    fn test_profile(base_url: &str) -> ProviderProfile {
        ProviderProfile {
            id: "test-google".to_string(),
            kind: ProviderKind::Google,
            base_url: Some(base_url.to_string()),
            default_model: "gemini-2.0-flash".to_string(),
            api_version: None,
            timeout_seconds: 5,
            max_retries: 1,
            allow_insecure_http: true,
            credential_backend: None,
            extra_headers: BTreeMap::new(),
            params: ProviderParams::new(),
        }
    }

    #[test]
    fn generate_content_endpoint_embeds_model_and_action() {
        assert_eq!(
            generate_content_endpoint("https://generativelanguage.googleapis.com", "gemini-2.0-flash"),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
        );
        assert_eq!(
            generate_content_endpoint("https://generativelanguage.googleapis.com/", "gemini-2.0-flash"),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
        );
    }

    /// Golden-fixture round trip, outbound half: a full conversation (system
    /// prompt, a user turn, a replayed assistant tool call, and its tool
    /// result) renders into the exact wire shape spec §5.4 documents,
    /// including the `systemInstruction` split, the bare-object `args`
    /// encoding (this format's argument-encoding quirk, the opposite of
    /// OpenAI's JSON-encoded string), and the tool-result round trip through
    /// the `functionResponse` / `{"response": {"content": ...}}` envelope.
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
                    id: "gcall_0".to_string(),
                    name: "quote".to_string(),
                    arguments: json!({"isin": "DE0007164600"}),
                }],
            },
            ChatMessage::Tool {
                tool_call_id: "gcall_0".to_string(),
                name: "quote".to_string(),
                content: json!({"price": 123.45}),
            },
        ];
        let params = ProviderParams::new();
        let request = ChatRequest {
            system_prompt: "You are a trading assistant.",
            messages: &messages,
            tools: &tools,
            model: "gemini-2.0-flash",
            params: &params,
        };

        let body = build_request_body(&request);

        assert_eq!(
            body["systemInstruction"],
            json!({"parts": [{"text": "You are a trading assistant."}]})
        );
        assert_eq!(
            body["contents"][0],
            json!({"role": "user", "parts": [{"text": "Check DE0007164600."}]})
        );

        let call_args = &body["contents"][1]["parts"][0]["functionCall"]["args"];
        assert!(call_args.is_object(), "Gemini args must be a bare object, not a JSON-encoded string");
        assert_eq!(call_args, &json!({"isin": "DE0007164600"}));
        assert_eq!(body["contents"][1]["role"], json!("model"));

        assert_eq!(
            body["contents"][2],
            json!({
                "role": "user",
                "parts": [{
                    "functionResponse": {
                        "name": "quote",
                        "response": {"content": {"price": 123.45}},
                    },
                }],
            })
        );

        assert_eq!(
            body["tools"],
            json!([{
                "functionDeclarations": [{
                    "name": "quote",
                    "description": "Fetch a quote.",
                    "parameters": {"type": "object", "properties": {"isin": {"type": "string"}}},
                }],
            }])
        );
        assert!(body.get("generationConfig").is_none());
        assert!(body.get("stream").is_none());
    }

    /// `params` nests under `generationConfig` rather than merging as
    /// top-level sibling keys (the divergence from Anthropic/OpenAI), and is
    /// omitted entirely when empty.
    #[test]
    fn merges_params_under_generation_config() {
        let mut params = ProviderParams::new();
        params.insert("temperature".to_string(), json!(0.2));
        params.insert("maxOutputTokens".to_string(), json!(4096));
        let messages = Vec::new();
        let request = ChatRequest {
            system_prompt: "",
            messages: &messages,
            tools: &[],
            model: "gemini-2.0-flash",
            params: &params,
        };
        let body = build_request_body(&request);
        assert_eq!(body["generationConfig"], json!({"temperature": 0.2, "maxOutputTokens": 4096}));
        assert!(body.get("temperature").is_none());
        assert!(body.get("systemInstruction").is_none());
    }

    /// Golden-fixture round trip, inbound half: a canned response carrying a
    /// `functionCall` part parses into a `ToolCall` with a synthesized id and
    /// `StopReason::ToolUse`, even though `finishReason` reads `"STOP"` —
    /// the same value a plain-text answer reports.
    #[test]
    fn parses_function_call_response_as_tool_use_despite_stop_finish_reason() {
        let raw = json!({
            "candidates": [{
                "content": {
                    "role": "model",
                    "parts": [{"functionCall": {"name": "quote", "args": {"isin": "US0378331005"}}}],
                },
                "finishReason": "STOP",
            }],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5, "totalTokenCount": 15},
        });

        let response = parse_response(raw).expect("parse response");
        assert!(response.assistant_text.is_none());
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].id, "gcall_0");
        assert_eq!(response.tool_calls[0].name, "quote");
        assert_eq!(response.tool_calls[0].arguments, json!({"isin": "US0378331005"}));
        assert!(matches!(response.stop_reason, StopReason::ToolUse));
    }

    /// A plain-text answer (no `functionCall` part) with `finishReason:
    /// "STOP"` parses as `EndTurn`.
    #[test]
    fn parses_text_response_as_end_turn() {
        let raw = json!({
            "candidates": [{
                "content": {"role": "model", "parts": [{"text": "no trade warranted"}]},
                "finishReason": "STOP",
            }],
        });

        let response = parse_response(raw).expect("parse response");
        assert_eq!(response.assistant_text.as_deref(), Some("no trade warranted"));
        assert!(response.tool_calls.is_empty());
        assert!(matches!(response.stop_reason, StopReason::EndTurn));
    }

    #[test]
    fn parses_max_tokens_finish_reason() {
        let raw = json!({
            "candidates": [{
                "content": {"role": "model", "parts": [{"text": "truncated"}]},
                "finishReason": "MAX_TOKENS",
            }],
        });

        let response = parse_response(raw).expect("parse response");
        assert!(matches!(response.stop_reason, StopReason::MaxTokens));
    }

    /// Two `functionCall` parts in one response each get a distinct
    /// synthesized id, positional in the `parts` array.
    #[test]
    fn synthesizes_distinct_ids_for_multiple_tool_calls_by_part_index() {
        let raw = json!({
            "candidates": [{
                "content": {
                    "role": "model",
                    "parts": [
                        {"functionCall": {"name": "quote", "args": {"isin": "A"}}},
                        {"functionCall": {"name": "chart", "args": {"isin": "A", "timeframe": "3m"}}},
                    ],
                },
                "finishReason": "STOP",
            }],
        });

        let response = parse_response(raw).expect("parse response");
        assert_eq!(response.tool_calls.len(), 2);
        assert_eq!(response.tool_calls[0].id, "gcall_0");
        assert_eq!(response.tool_calls[1].id, "gcall_1");
    }

    #[test]
    fn parse_response_rejects_missing_candidates() {
        let raw = json!({"candidates": []});
        let err = parse_response(raw).expect_err("empty candidates must error");
        assert!(err.to_string().starts_with(AGENT_PROVIDER_RESPONSE_INVALID_PREFIX));
    }

    #[test]
    fn new_defaults_base_url_when_profile_omits_it() {
        let mut profile = test_profile("https://generativelanguage.googleapis.com");
        profile.base_url = None;
        let client = reqwest::blocking::Client::builder().build().expect("build client");
        let provider = GoogleProvider::new(client, &profile, None).expect("construct provider");
        assert_eq!(provider.base_url, "https://generativelanguage.googleapis.com");
    }
}

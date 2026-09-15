//! `LlmProvider` trait, provider-agnostic chat request/response types, and
//! the shared HTTP client builder used by all four wire adapters
//! (`anthropic`, `openai`, `google`, `ollama`).

use std::time::Duration;

use anyhow::{Context, Result, bail};
use serde_json::Value;

use crate::agent::config::{ProviderKind, ProviderParams, ProviderProfile};

pub(crate) mod anthropic;
pub(crate) mod google;
pub(crate) mod ollama;
pub(crate) mod openai;

pub(crate) enum ChatMessage {
    User(String),
    Assistant { text: Option<String>, tool_calls: Vec<ToolCall> },
    Tool { tool_call_id: String, name: String, content: Value },
}

pub(crate) struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

pub(crate) struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub json_schema: Value,
}

pub(crate) struct ChatRequest<'a> {
    pub system_prompt: &'a str,
    pub messages: &'a [ChatMessage],
    pub tools: &'a [ToolSpec],
    pub model: &'a str,
    pub params: &'a ProviderParams,
}

pub(crate) enum StopReason {
    ToolUse,
    EndTurn,
    MaxTokens,
    Other(String),
}

pub(crate) struct ChatResponse {
    pub assistant_text: Option<String>,
    pub tool_calls: Vec<ToolCall>,
    pub stop_reason: StopReason,
    pub raw: Value,
}

pub(crate) trait ChatProvider {
    fn complete(&self, request: &ChatRequest<'_>) -> Result<ChatResponse>;
}

/// Dedicated HTTP client builder for provider traffic — deliberately NOT a
/// reuse of `transport_security`'s hardened, hardcoded-`https_only(true)`
/// builder (fix F16). `https://` is always allowed; `http://` is allowed
/// only when `allow_insecure_http` is true on that provider's profile AND
/// the URL's host is a literal loopback address (`127.0.0.1`, `::1`, or
/// `localhost`) — a non-loopback `http://` URL is rejected even with the
/// flag set, so the relaxation stays bounded to "local Ollama / local dev".
pub(crate) fn provider_http_client(
    base_url: &str,
    allow_insecure_http: bool,
    timeout_seconds: u64,
) -> Result<reqwest::blocking::Client> {
    let parsed = url::Url::parse(base_url).with_context(|| {
        format!("Agent input invalid: provider base_url '{base_url}' is not a valid URL")
    })?;
    match parsed.scheme() {
        "https" => {}
        "http" => {
            let is_loopback = matches!(
                parsed.host_str(),
                Some("127.0.0.1") | Some("::1") | Some("localhost")
            );
            if !allow_insecure_http || !is_loopback {
                bail!(
                    "Agent input invalid: provider base_url '{base_url}' uses http:// which is \
                     only permitted for a loopback host with allow_insecure_http = true"
                );
            }
        }
        other => bail!("Agent input invalid: unsupported provider base_url scheme '{other}'"),
    }
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .build()
        .context("Failed to build provider HTTP client")
}

pub(crate) fn build_provider(
    profile: &ProviderProfile,
    api_key: Option<String>,
) -> Result<Box<dyn ChatProvider>> {
    let client = provider_http_client(
        &effective_base_url(profile),
        profile.allow_insecure_http,
        profile.timeout_seconds,
    )?;
    Ok(match profile.kind {
        ProviderKind::Anthropic => Box::new(anthropic::AnthropicProvider::new(client, profile, api_key)?),
        ProviderKind::Openai | ProviderKind::OpenaiCompatible => {
            Box::new(openai::OpenAiProvider::new(client, profile, api_key)?)
        }
        ProviderKind::Google => Box::new(google::GoogleProvider::new(client, profile, api_key)?),
        ProviderKind::Ollama => Box::new(ollama::OllamaProvider::new(client, profile, api_key)?),
    })
}

fn effective_base_url(profile: &ProviderProfile) -> String {
    profile.base_url.clone().unwrap_or_else(|| match profile.kind {
        ProviderKind::Anthropic => "https://api.anthropic.com".into(),
        ProviderKind::Openai => "https://api.openai.com".into(),
        ProviderKind::Google => "https://generativelanguage.googleapis.com".into(),
        ProviderKind::Ollama => "http://127.0.0.1:11434".into(),
        ProviderKind::OpenaiCompatible => String::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_http_client_rejects_non_loopback_http_even_with_flag_set() {
        let result = provider_http_client("http://example.com", true, 60);
        assert!(result.is_err());
    }

    #[test]
    fn provider_http_client_rejects_http_without_flag_on_loopback() {
        let result = provider_http_client("http://127.0.0.1:11434", false, 60);
        assert!(result.is_err());
    }

    #[test]
    fn provider_http_client_allows_loopback_http_with_flag_set() {
        let result = provider_http_client("http://127.0.0.1:11434", true, 60);
        assert!(result.is_ok());
    }

    #[test]
    fn provider_http_client_allows_https_unconditionally() {
        let result = provider_http_client("https://api.anthropic.com", false, 60);
        assert!(result.is_ok());
    }
}

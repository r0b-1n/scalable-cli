//! Ollama `/api/chat` wire adapter (`kind = "ollama"`).

use anyhow::{Result, bail};

use crate::agent::config::{ProviderParams, ProviderProfile};
use crate::agent::providers::{ChatProvider, ChatRequest, ChatResponse};

pub(crate) struct OllamaProvider {
    client: reqwest::blocking::Client,
    base_url: String,
    model: String,
    api_key: Option<String>,
    params: ProviderParams,
}

impl OllamaProvider {
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
                .unwrap_or_else(|| "http://127.0.0.1:11434".to_string()),
            model: profile.default_model.clone(),
            api_key,
            params: profile.params.clone(),
        })
    }
}

impl ChatProvider for OllamaProvider {
    fn complete(&self, _request: &ChatRequest<'_>) -> Result<ChatResponse> {
        bail!("AGENT_PROVIDER_HTTP_ERROR: ollama provider adapter not implemented")
    }
}

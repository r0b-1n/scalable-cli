//! Anthropic `/v1/messages` wire adapter (`kind = "anthropic"`).

use anyhow::{Result, bail};

use crate::agent::config::{ProviderParams, ProviderProfile};
use crate::agent::providers::{ChatProvider, ChatRequest, ChatResponse};

pub(crate) struct AnthropicProvider {
    client: reqwest::blocking::Client,
    base_url: String,
    api_version: String,
    model: String,
    api_key: Option<String>,
    params: ProviderParams,
}

impl AnthropicProvider {
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
                .unwrap_or_else(|| "https://api.anthropic.com".to_string()),
            api_version: profile
                .api_version
                .clone()
                .unwrap_or_else(|| "2023-06-01".to_string()),
            model: profile.default_model.clone(),
            api_key,
            params: profile.params.clone(),
        })
    }
}

impl ChatProvider for AnthropicProvider {
    fn complete(&self, _request: &ChatRequest<'_>) -> Result<ChatResponse> {
        bail!("AGENT_PROVIDER_HTTP_ERROR: anthropic provider adapter not implemented")
    }
}

//! OpenAI `/v1/chat/completions` wire adapter (`kind = "openai"`), also
//! backing `kind = "openai_compatible"` endpoints.

use anyhow::{Result, bail};

use crate::agent::config::{ProviderParams, ProviderProfile};
use crate::agent::providers::{ChatProvider, ChatRequest, ChatResponse};

pub(crate) struct OpenAiProvider {
    client: reqwest::blocking::Client,
    base_url: String,
    model: String,
    api_key: Option<String>,
    params: ProviderParams,
}

impl OpenAiProvider {
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
                .unwrap_or_else(|| "https://api.openai.com".to_string()),
            model: profile.default_model.clone(),
            api_key,
            params: profile.params.clone(),
        })
    }
}

impl ChatProvider for OpenAiProvider {
    fn complete(&self, _request: &ChatRequest<'_>) -> Result<ChatResponse> {
        bail!("AGENT_PROVIDER_HTTP_ERROR: openai provider adapter not implemented")
    }
}

//! Google Gemini `:generateContent` wire adapter (`kind = "google"`).

use anyhow::{Result, bail};

use crate::agent::config::{ProviderParams, ProviderProfile};
use crate::agent::providers::{ChatProvider, ChatRequest, ChatResponse};

pub(crate) struct GoogleProvider {
    client: reqwest::blocking::Client,
    base_url: String,
    model: String,
    api_key: Option<String>,
    params: ProviderParams,
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
            params: profile.params.clone(),
        })
    }
}

impl ChatProvider for GoogleProvider {
    fn complete(&self, _request: &ChatRequest<'_>) -> Result<ChatResponse> {
        bail!("AGENT_PROVIDER_HTTP_ERROR: google provider adapter not implemented")
    }
}

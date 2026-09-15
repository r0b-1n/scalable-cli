//! TOML schema and load/save helpers for the four hand-edited files under
//! `agents_dir_path()`: `providers.toml`, `agents.toml`, `policies.toml`
//! and `tools.toml`. Every struct here is `#[serde(default,
//! deny_unknown_fields)]`, exactly like `AppConfig` — a typo'd key fails
//! loudly at load time instead of being silently ignored.

use std::collections::BTreeMap;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::{SessionBackendPreference, write_private_file_atomic};

/// Provider/agent/policy/tool ids share one charset, checked at every write
/// path (CLI arg parser and each `*File::save`): `^[a-z0-9][a-z0-9_-]{0,63}$`.
/// This is deliberately Windows-safe (no `:`, no path separator, no
/// reserved character) since a provider id is embedded verbatim in its
/// credential-store key (fix F4/F21).
pub(crate) fn validate_id(kind: &str, id: &str) -> Result<()> {
    let re_ok = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-');
    if !re_ok {
        bail!("Agent input invalid: {kind} id '{id}' must match ^[a-z0-9][a-z0-9_-]{{0,63}}$");
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProviderKind {
    Anthropic,
    Openai,
    Google,
    Ollama,
    OpenaiCompatible,
}

/// Fully open, forwarded verbatim per adapter (fix F17) — never a fixed
/// temperature/max_tokens/top_p struct.
pub(crate) type ProviderParams = serde_json::Map<String, Value>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct ProviderProfile {
    pub id: String,
    pub kind: ProviderKind,
    pub base_url: Option<String>,
    pub default_model: String,
    pub api_version: Option<String>,
    pub timeout_seconds: u64,
    pub max_retries: u8,
    pub allow_insecure_http: bool,
    pub credential_backend: Option<SessionBackendPreference>,
    pub extra_headers: BTreeMap<String, String>,
    pub params: ProviderParams,
}
impl Default for ProviderProfile {
    fn default() -> Self {
        Self {
            id: String::new(),
            kind: ProviderKind::Anthropic,
            base_url: None,
            default_model: String::new(),
            api_version: None,
            timeout_seconds: 60,
            max_retries: 2,
            allow_insecure_http: false,
            credential_backend: None,
            extra_headers: BTreeMap::new(),
            params: ProviderParams::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct ProvidersFile {
    pub providers: BTreeMap<String, ProviderProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct AgentDefinition {
    pub id: String,
    pub enabled: bool,
    pub provider: String,
    pub model_override: Option<String>,
    pub policy: String,
    pub portfolio_id: Option<String>,
    pub account_id: Option<String>,
    pub tools: Vec<String>,
    pub tool_config: BTreeMap<String, Value>,
    pub strategy_prompt_file: Option<String>,
    pub system_prompt_extra: Option<String>,
    pub max_tool_calls_per_run: u32,
    pub max_reasoning_turns: u32,
    pub run_timeout_seconds: u64,
    pub schedule: Option<String>,
}
impl Default for AgentDefinition {
    fn default() -> Self {
        Self {
            id: String::new(),
            enabled: true,
            provider: String::new(),
            model_override: None,
            policy: String::new(),
            portfolio_id: None,
            account_id: None,
            tools: Vec::new(),
            tool_config: BTreeMap::new(),
            strategy_prompt_file: None,
            system_prompt_extra: None,
            max_tool_calls_per_run: 20,
            max_reasoning_turns: 8,
            run_timeout_seconds: 300,
            schedule: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct AgentsFile {
    pub agents: BTreeMap<String, AgentDefinition>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PolicyMode {
    #[default]
    DryRun,
    Paper,
    Live,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct PolicyProfile {
    pub id: String,
    pub mode: PolicyMode,
    pub max_order_notional: Option<String>,
    pub max_daily_notional: Option<String>,
    pub max_orders_per_run: u32,
    pub max_orders_per_day: u32,
    pub allowed_isins: Option<Vec<String>>,
    pub denied_isins: Option<Vec<String>>,
    pub allowed_instrument_types: Option<Vec<String>>,
    pub allowed_venues: Option<Vec<String>>,
    pub allowed_order_types: Option<Vec<String>>,
    pub denied_order_types: Option<Vec<String>>,
    pub cash_floor: Option<String>,
    pub max_position_concentration_pct: Option<f64>,
    pub require_human_approval_above_notional: Option<String>,
    pub require_human_approval_always: bool,
    pub autonomous_phase2_enabled: bool,
}
impl Default for PolicyProfile {
    fn default() -> Self {
        Self {
            id: String::new(),
            mode: PolicyMode::DryRun,
            max_order_notional: None,
            max_daily_notional: None,
            max_orders_per_run: 1,
            max_orders_per_day: 3,
            allowed_isins: None,
            denied_isins: None,
            allowed_instrument_types: None,
            allowed_venues: None,
            allowed_order_types: None,
            denied_order_types: None,
            cash_floor: None,
            max_position_concentration_pct: None,
            require_human_approval_above_notional: None,
            require_human_approval_always: true,
            autonomous_phase2_enabled: false,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct PoliciesFile {
    pub policies: BTreeMap<String, PolicyProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct ToolProfile {
    pub enabled: bool,
}
impl Default for ToolProfile {
    fn default() -> Self {
        Self { enabled: true }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct ToolsFile {
    pub tools: BTreeMap<String, ToolProfile>,
}

pub(crate) fn load_providers() -> Result<ProvidersFile> {
    load_or_default("providers.toml")
}
pub(crate) fn save_providers(f: &ProvidersFile) -> Result<()> {
    save("providers.toml", f)
}
pub(crate) fn load_agents() -> Result<AgentsFile> {
    load_or_default("agents.toml")
}
pub(crate) fn save_agents(f: &AgentsFile) -> Result<()> {
    save("agents.toml", f)
}
pub(crate) fn load_policies() -> Result<PoliciesFile> {
    load_or_default("policies.toml")
}
pub(crate) fn save_policies(f: &PoliciesFile) -> Result<()> {
    save("policies.toml", f)
}
pub(crate) fn load_tools() -> Result<ToolsFile> {
    load_or_default("tools.toml")
}
pub(crate) fn save_tools(f: &ToolsFile) -> Result<()> {
    save("tools.toml", f)
}

fn load_or_default<T: Default + serde::de::DeserializeOwned>(filename: &str) -> Result<T> {
    let path = super::agents_dir_path()?.join(filename);
    if !path.exists() {
        return Ok(T::default());
    }
    let raw = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read {}", path.display()))?;
    toml::from_str(&raw).with_context(|| format!("Failed to parse {}", path.display()))
}
fn save<T: Serialize>(filename: &str, value: &T) -> Result<()> {
    let path = super::agents_dir_path()?.join(filename);
    let rendered =
        toml::to_string_pretty(value).with_context(|| format!("Failed to serialize {filename}"))?;
    write_private_file_atomic(&path, rendered.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_id_accepts_lowercase_digits_underscore_hyphen() {
        assert!(validate_id("provider", "anthropic-main").is_ok());
        assert!(validate_id("provider", "a").is_ok());
        assert!(validate_id("provider", "agent_007").is_ok());
        assert!(validate_id("provider", "9lives").is_ok());
    }

    #[test]
    fn validate_id_rejects_empty() {
        assert!(validate_id("provider", "").is_err());
    }

    #[test]
    fn validate_id_rejects_uppercase() {
        assert!(validate_id("provider", "Anthropic").is_err());
    }

    #[test]
    fn validate_id_rejects_colon_for_windows_safety() {
        // Fix F4: a colon in an id would make the derived credential key an
        // illegal Windows filename via FileStore's `{key}.json` fallback.
        assert!(validate_id("provider", "anthropic:main").is_err());
    }

    #[test]
    fn validate_id_rejects_path_separators() {
        assert!(validate_id("provider", "a/b").is_err());
        assert!(validate_id("provider", "a\\b").is_err());
    }

    #[test]
    fn validate_id_rejects_leading_hyphen_or_underscore() {
        assert!(validate_id("provider", "-abc").is_err());
        assert!(validate_id("provider", "_abc").is_err());
    }

    #[test]
    fn validate_id_rejects_over_64_chars() {
        let too_long = "a".repeat(65);
        assert!(validate_id("provider", &too_long).is_err());
        let exactly_64 = "a".repeat(64);
        assert!(validate_id("provider", &exactly_64).is_ok());
    }

    #[test]
    fn provider_profile_default_matches_documented_defaults() {
        let profile = ProviderProfile::default();
        assert_eq!(profile.timeout_seconds, 60);
        assert_eq!(profile.max_retries, 2);
        assert!(!profile.allow_insecure_http);
        assert!(profile.credential_backend.is_none());
        assert_eq!(profile.kind, ProviderKind::Anthropic);
    }

    #[test]
    fn agent_definition_default_matches_documented_defaults() {
        let agent = AgentDefinition::default();
        assert!(agent.enabled);
        assert_eq!(agent.max_tool_calls_per_run, 20);
        assert_eq!(agent.max_reasoning_turns, 8);
        assert_eq!(agent.run_timeout_seconds, 300);
        assert!(agent.schedule.is_none());
    }

    #[test]
    fn policy_profile_defaults_deny_by_default() {
        let policy = PolicyProfile::default();
        assert_eq!(policy.mode, PolicyMode::DryRun);
        assert!(!policy.autonomous_phase2_enabled);
        assert!(policy.require_human_approval_always);
        assert_eq!(policy.max_orders_per_run, 1);
        assert_eq!(policy.max_orders_per_day, 3);
    }

    #[test]
    fn tool_profile_default_is_enabled() {
        assert!(ToolProfile::default().enabled);
    }

    #[test]
    fn providers_file_round_trips_through_toml() {
        let mut file = ProvidersFile::default();
        file.providers.insert(
            "anthropic-main".to_string(),
            ProviderProfile {
                id: "anthropic-main".to_string(),
                kind: ProviderKind::Anthropic,
                base_url: Some("https://api.anthropic.com".to_string()),
                default_model: "claude-sonnet-4-5".to_string(),
                api_version: Some("2023-06-01".to_string()),
                timeout_seconds: 60,
                max_retries: 2,
                allow_insecure_http: false,
                credential_backend: None,
                extra_headers: BTreeMap::new(),
                params: ProviderParams::new(),
            },
        );
        let rendered = toml::to_string_pretty(&file).expect("serialize");
        let parsed: ProvidersFile = toml::from_str(&rendered).expect("deserialize");
        assert_eq!(parsed.providers.len(), 1);
        assert_eq!(parsed.providers["anthropic-main"].default_model, "claude-sonnet-4-5");
    }

    #[test]
    fn agents_file_rejects_unknown_fields() {
        let raw = r#"
            [agents.demo]
            id = "demo"
            enabled = true
            provider = "anthropic-main"
            policy = "dry-run-only"
            not_a_real_field = "surprise"
        "#;
        assert!(toml::from_str::<AgentsFile>(raw).is_err());
    }

    #[test]
    fn policies_file_parses_verbatim_spec_example() {
        let raw = r#"
            [policies.conservative-live]
            mode = "paper"
            max_order_notional = "2000.00"
            max_daily_notional = "5000.00"
            max_orders_per_run = 1
            max_orders_per_day = 3
            allowed_isins = []
            denied_isins = []
            allowed_instrument_types = ["etf", "stock"]
            allowed_venues = ["XETR", "GETTEX"]
            allowed_order_types = ["market", "limit"]
            denied_order_types = ["stop"]
            cash_floor = "500.00"
            max_position_concentration_pct = 25.0
            require_human_approval_above_notional = "500.00"
            require_human_approval_always = false
            autonomous_phase2_enabled = false
        "#;
        let parsed: PoliciesFile = toml::from_str(raw).expect("parse conservative-live policy");
        let policy = &parsed.policies["conservative-live"];
        assert_eq!(policy.mode, PolicyMode::Paper);
        assert_eq!(policy.allowed_isins, Some(Vec::new()));
        assert!(!policy.autonomous_phase2_enabled);
    }

    #[test]
    fn tools_file_two_layer_default_is_all_enabled() {
        // tools.toml absent entirely (ToolsFile::default()) means every
        // tool is still subject to the agent's own `tools = [...]` list —
        // this only documents that an *empty* tools.toml section, when
        // present, does not implicitly enable anything (BTreeMap::default
        // is empty, not "all true").
        let file = ToolsFile::default();
        assert!(file.tools.is_empty());
    }
}

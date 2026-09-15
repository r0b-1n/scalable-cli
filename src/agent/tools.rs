//! Read-only tool registry + adapters over the existing `execute_broker_*`
//! functions. No tool name that can mutate broker state is ever
//! registered here — the only channel from model output to trade
//! execution is the separate, non-network `propose_trade` tool defined by
//! `run_loop.rs` (Invariant AG-2 / fix F18).
//!
//! Every value a tool call returns is untrusted model-adjacent input: it
//! is broker data that flows back into the conversation as a `Tool`
//! message for the model to read, not a decision Rust makes anything of.
//! The policy engine (`src/agent/policy.rs`) never reads tool-result
//! content — everything it checks (ISIN legality, instrument type, venue,
//! notional) is re-derived from Rust-fetched ground truth, never from a
//! tool result or any other free-text field that passed through the model.
//!
//! No `Args` struct in this codebase derives `Default`; every adapter
//! constructs its target struct with every field named explicitly — no
//! `..` struct-update syntax anywhere in this module (fix F15).

use anyhow::{Result, anyhow, bail};
use serde_json::Value;

use crate::agent::config::ToolsFile;
use crate::config::AppConfig;
use crate::session::SessionManager;

pub(crate) struct ToolContext<'a> {
    pub config: &'a AppConfig,
    pub session_manager: &'a mut SessionManager,
    pub portfolio_id: Option<String>,
    pub account_id: Option<String>,
    pub budget: &'a mut ToolCallBudget,
}

pub(crate) struct ToolCallBudget {
    pub remaining: u32,
}
impl ToolCallBudget {
    pub(crate) fn consume(&mut self) -> Result<()> {
        if self.remaining == 0 {
            bail!("Agent input invalid: tool call budget exhausted for this run (max_tool_calls_per_run)");
        }
        self.remaining -= 1;
        Ok(())
    }
}

pub(crate) struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    pub schema: fn() -> Value,
    pub call: fn(&Value, &mut ToolContext) -> Result<Value>,
}

pub(crate) fn registry() -> &'static [ToolDef] {
    &[
        ToolDef { name: "quote", description: "Current quote (bid/ask/mid, currency, performance) for one ISIN.", schema: quote_schema, call: call_quote },
        ToolDef { name: "chart", description: "Historical price series for one ISIN over a timeframe.", schema: chart_schema, call: call_chart },
        ToolDef { name: "holdings", description: "Current portfolio holdings.", schema: holdings_schema, call: call_holdings },
        ToolDef { name: "overview", description: "Portfolio valuation and performance overview.", schema: empty_object_schema, call: call_overview },
        ToolDef { name: "analytics", description: "Portfolio risk/allocation analytics.", schema: empty_object_schema, call: call_analytics },
        ToolDef { name: "search", description: "Search securities by free text.", schema: search_schema, call: call_search },
        ToolDef { name: "derivatives_search", description: "Search knockouts/warrants/factor certificates for an underlying ISIN.", schema: derivatives_search_schema, call: call_derivatives_search },
        ToolDef { name: "security_news", description: "News summary and sources for one ISIN.", schema: security_news_schema, call: call_security_news },
        ToolDef { name: "transactions", description: "Recent portfolio transactions.", schema: transactions_schema, call: call_transactions },
        ToolDef { name: "watchlist", description: "Current watchlist contents.", schema: empty_object_schema, call: call_watchlist },
        ToolDef { name: "cash_breakdown", description: "Cash balance and buying power breakdown.", schema: empty_object_schema, call: call_cash_breakdown },
        ToolDef { name: "portfolio_groups", description: "Portfolio groups and their members.", schema: portfolio_groups_schema, call: call_portfolio_groups },
    ]
}

/// Intersection of: this agent's own `tools` list (`agents.toml`) AND the
/// global `tools.toml` enabled set. Both layers must allow a tool.
pub(crate) fn enabled_for(agent_tools: &[String], tools_cfg: &ToolsFile) -> Vec<&'static ToolDef> {
    registry()
        .iter()
        .filter(|t| agent_tools.iter().any(|n| n == t.name))
        .filter(|t| tools_cfg.tools.get(t.name).map(|p| p.enabled).unwrap_or(true))
        .collect()
}

fn empty_object_schema() -> Value {
    serde_json::json!({ "type": "object", "properties": {} })
}

/// A required string field, missing or non-string in `args`.
fn required_str(args: &Value, tool: &str, field: &str) -> Result<String> {
    args.get(field)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| anyhow!("Agent input invalid: tool '{tool}' requires string field '{field}'"))
}

/// An optional string field: `None` when absent or not a string.
fn optional_str(args: &Value, field: &str) -> Option<String> {
    args.get(field).and_then(Value::as_str).map(str::to_string)
}

/// An optional string array field: empty when absent or malformed, each
/// non-string element silently dropped (these feed free-text/enum filters
/// that the downstream `execute_broker_*` call validates itself).
fn optional_str_array(args: &Value, field: &str) -> Vec<String> {
    args.get(field)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// A required ISIN field: rejects a missing field, a non-string value, and
/// (via `normalize_broker_isin`) a string that is not a well-formed ISIN.
fn required_isin(args: &Value, tool: &str, field: &str) -> Result<String> {
    let raw = required_str(args, tool, field)?;
    crate::broker_queries::normalize_broker_isin(&raw, field)
        .map_err(|e| anyhow!("Agent input invalid: tool '{tool}' field '{field}' is malformed: {e}"))
}

/// A required `clap::ValueEnum` field, matched case-insensitively against
/// the enum's own value names (the same names its `--help` documents).
fn required_enum<T: clap::ValueEnum>(args: &Value, tool: &str, field: &str) -> Result<T> {
    let raw = required_str(args, tool, field)?;
    <T as clap::ValueEnum>::from_str(&raw, true).map_err(|_| {
        anyhow!("Agent input invalid: tool '{tool}' field '{field}' has invalid value '{raw}'")
    })
}

fn quote_schema() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": { "isin": {"type": "string", "description": "12-character ISIN"} },
        "required": ["isin"]
    })
}
fn call_quote(args: &Value, ctx: &mut ToolContext) -> Result<Value> {
    ctx.budget.consume()?;
    let isin = required_isin(args, "quote", "isin")?;
    let call_args = crate::cli::BrokerQuoteArgs {
        portfolio_id: ctx.portfolio_id.clone(),
        isin,
        include_year_to_date: false,
        quote_source: None,
        json: true,
    };
    crate::broker_query_execution::execute_broker_quote(call_args, ctx.config, ctx.session_manager)
}

fn chart_schema() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "isin": {"type": "string"},
            "timeframe": {"type": "string", "enum": ["1d", "7d", "1m", "3m", "6m", "ytd", "1y", "max"]}
        },
        "required": ["isin", "timeframe"]
    })
}
fn call_chart(args: &Value, ctx: &mut ToolContext) -> Result<Value> {
    ctx.budget.consume()?;
    let isin = required_isin(args, "chart", "isin")?;
    let timeframe = required_enum::<crate::cli::BrokerChartTimeframe>(args, "chart", "timeframe")?;
    let call_args = crate::cli::BrokerChartArgs { isin, timeframe, json: true };
    crate::broker_query_execution::execute_broker_chart(call_args, ctx.config, ctx.session_manager)
}

fn holdings_schema() -> Value {
    serde_json::json!({ "type": "object", "properties": {} })
}
fn call_holdings(_args: &Value, ctx: &mut ToolContext) -> Result<Value> {
    ctx.budget.consume()?;
    let call_args = crate::cli::BrokerHoldingsArgs {
        portfolio_id: ctx.portfolio_id.clone(),
        include_year_to_date: false,
        quote_source: None,
        json: true,
    };
    crate::broker_query_execution::execute_broker_holdings(call_args, ctx.config, ctx.session_manager)
}

fn call_overview(_args: &Value, ctx: &mut ToolContext) -> Result<Value> {
    ctx.budget.consume()?;
    let call_args = crate::cli::BrokerOverviewArgs {
        portfolio_id: ctx.portfolio_id.clone(),
        include_year_to_date: false,
        json: true,
    };
    crate::broker_query_execution::execute_broker_overview(call_args, ctx.config, ctx.session_manager)
}

fn call_analytics(_args: &Value, ctx: &mut ToolContext) -> Result<Value> {
    ctx.budget.consume()?;
    let call_args = crate::cli::BrokerAnalyticsArgs {
        portfolio_id: ctx.portfolio_id.clone(),
        json: true,
    };
    crate::broker_query_execution::execute_broker_analytics(call_args, ctx.config, ctx.session_manager)
}

fn search_schema() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": { "query": {"type": "string", "description": "Free-text security search"} },
        "required": ["query"]
    })
}
fn call_search(args: &Value, ctx: &mut ToolContext) -> Result<Value> {
    ctx.budget.consume()?;
    let query = required_str(args, "search", "query")?;
    let call_args = crate::cli::BrokerSearchArgs {
        query,
        portfolio_id: ctx.portfolio_id.clone(),
        include_year_to_date: false,
        quote_source: None,
        json: true,
    };
    crate::broker_query_execution::execute_broker_search(call_args, ctx.config, ctx.session_manager)
}

fn derivatives_search_schema() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "underlying": {"type": "string", "description": "Underlying security ISIN"},
            "derivative_type": {"type": "string", "enum": ["knockout", "warrant", "factor"]},
            "strategy": {"type": "string", "enum": ["long", "short", "put", "call"]}
        },
        "required": ["underlying", "derivative_type", "strategy"]
    })
}
fn call_derivatives_search(args: &Value, ctx: &mut ToolContext) -> Result<Value> {
    ctx.budget.consume()?;
    let underlying = required_isin(args, "derivatives_search", "underlying")?;
    let derivative_type =
        required_enum::<crate::cli::BrokerDerivativeType>(args, "derivatives_search", "derivative_type")?;
    let strategy =
        required_enum::<crate::cli::BrokerDerivativeStrategy>(args, "derivatives_search", "strategy")?;
    let call_args = crate::cli::BrokerDerivativesSearchArgs {
        portfolio_id: ctx.portfolio_id.clone(),
        underlying,
        derivative_type,
        limit: 50,
        offset: 0,
        issuer: Vec::new(),
        strategy,
        product_subcategory: Vec::new(),
        leverage_min: None,
        leverage_max: None,
        knockout_barrier_min: None,
        knockout_barrier_max: None,
        strike_min: None,
        strike_max: None,
        omega_min: None,
        omega_max: None,
        delta_min: None,
        delta_max: None,
        factor_min: None,
        factor_max: None,
        expiry_from: None,
        expiry_to: None,
        sort_field: None,
        sort_order: None,
        json: true,
    };
    crate::broker_query_execution::execute_broker_derivatives_search(call_args, ctx.config, ctx.session_manager)
}

fn security_news_schema() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "isin": {"type": "string"},
            "locale": {"type": "string", "description": "Locale, e.g. en_DE, de_DE"}
        },
        "required": ["isin"]
    })
}
fn call_security_news(args: &Value, ctx: &mut ToolContext) -> Result<Value> {
    ctx.budget.consume()?;
    let isin = required_isin(args, "security_news", "isin")?;
    let locale = optional_str(args, "locale");
    let call_args = crate::cli::BrokerSecurityNewsArgs { isin, locale, json: true };
    crate::broker_query_execution::execute_broker_security_news(call_args, ctx.config, ctx.session_manager)
}

fn transactions_schema() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "page_size": {"type": "integer", "description": "Results per page (1..100), default 20"},
            "cursor": {"type": "string", "description": "Pagination cursor from a previous response"},
            "isin": {"type": "string", "description": "Optional security ISIN filter"},
            "search_term": {"type": "string"},
            "from_time": {"type": "string", "description": "ISO-8601 timestamp"},
            "to_time": {"type": "string", "description": "ISO-8601 timestamp"},
            "type_filter": {"type": "array", "items": {"type": "string"}},
            "status": {"type": "array", "items": {"type": "string"}}
        }
    })
}
fn call_transactions(args: &Value, ctx: &mut ToolContext) -> Result<Value> {
    ctx.budget.consume()?;
    let page_size = args
        .get("page_size")
        .and_then(Value::as_u64)
        .and_then(|v| u16::try_from(v).ok())
        .unwrap_or(20);
    let call_args = crate::cli::BrokerTransactionsArgs {
        portfolio_id: ctx.portfolio_id.clone(),
        page_size,
        cursor: optional_str(args, "cursor"),
        type_filter: optional_str_array(args, "type_filter"),
        status: optional_str_array(args, "status"),
        search_term: optional_str(args, "search_term"),
        from_time: optional_str(args, "from_time"),
        to_time: optional_str(args, "to_time"),
        isin: optional_str(args, "isin"),
        include_reinvestment_subtypes: false,
        json: true,
    };
    crate::broker_query_execution::execute_broker_transactions(call_args, ctx.config, ctx.session_manager)
}

fn call_watchlist(_args: &Value, ctx: &mut ToolContext) -> Result<Value> {
    ctx.budget.consume()?;
    let call_args = crate::cli::BrokerWatchlistArgs {
        command: None,
        portfolio_id: ctx.portfolio_id.clone(),
        include_year_to_date: false,
        quote_source: None,
        json: true,
    };
    crate::broker_query_execution::execute_broker_watchlist(call_args, ctx.config, ctx.session_manager)
}

fn call_cash_breakdown(_args: &Value, ctx: &mut ToolContext) -> Result<Value> {
    ctx.budget.consume()?;
    let call_args = crate::cli::BrokerCashBreakdownArgs {
        portfolio_id: ctx.portfolio_id.clone(),
        json: true,
    };
    crate::broker_query_execution::execute_broker_cash_breakdown(call_args, ctx.config, ctx.session_manager)
}

fn portfolio_groups_schema() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "group_id": {"type": "string", "description": "Restrict to one portfolio group id"}
        }
    })
}
fn call_portfolio_groups(args: &Value, ctx: &mut ToolContext) -> Result<Value> {
    ctx.budget.consume()?;
    let call_args = crate::cli::BrokerPortfolioGroupsArgs {
        command: None,
        portfolio_id: ctx.portfolio_id.clone(),
        group_id: optional_str(args, "group_id"),
        json: true,
    };
    crate::broker_portfolio_groups::execute_broker_portfolio_groups(call_args, ctx.config, ctx.session_manager)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    use crate::config::{AppConfig, DpopKeyBackend, RuntimeAuthConfig, SessionBackendPreference};
    use crate::session::SessionManager;

    /// Holds the crate-wide test env lock for its lifetime. `SC_CONFIG_DIR` is
    /// process-global while the harness runs tests on parallel threads, so a guard
    /// that redirects it without this lock moves the config directory out from
    /// under whichever other test is mid-read.
    struct EnvGuard {
        previous: Option<OsString>,
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    impl EnvGuard {
        fn set_config_dir(path: &std::path::Path) -> Self {
            let _lock = crate::lock_test_env();
            let previous = std::env::var_os("SC_CONFIG_DIR");
            unsafe {
                std::env::set_var("SC_CONFIG_DIR", path);
            }
            Self { previous, _lock }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            unsafe {
                match &self.previous {
                    Some(value) => std::env::set_var("SC_CONFIG_DIR", value),
                    None => std::env::remove_var("SC_CONFIG_DIR"),
                }
            }
        }
    }

    fn sample_config() -> AppConfig {
        AppConfig {
            auth: RuntimeAuthConfig {
                session_backend: SessionBackendPreference::File,
                signing_key_backend: DpopKeyBackend::File,
                pkcs11: None,
            },
            trade_controls: None,
        }
    }

    /// A `ToolContext` wired to a throwaway on-disk session store. Every
    /// test below only exercises argument validation or budget accounting,
    /// both of which fail before any of these fields are ever read, so the
    /// session/config values themselves are never exercised.
    fn with_tool_context<T>(remaining: u32, f: impl FnOnce(&mut ToolContext) -> T) -> T {
        let tmp = tempfile::tempdir().expect("tempdir");
        let _guard = EnvGuard::set_config_dir(tmp.path());
        let config = sample_config();
        let mut session_manager = SessionManager::new(&config).expect("session manager");
        let mut budget = ToolCallBudget { remaining };
        let mut ctx = ToolContext {
            config: &config,
            session_manager: &mut session_manager,
            portfolio_id: None,
            account_id: None,
            budget: &mut budget,
        };
        f(&mut ctx)
    }

    #[test]
    fn tool_call_budget_exhausts_after_remaining_calls() {
        let mut budget = ToolCallBudget { remaining: 1 };
        assert!(budget.consume().is_ok());
        assert!(budget.consume().is_err());
    }

    #[test]
    fn budget_exhaustion_errors_cleanly_through_a_real_tool_call() {
        let err = with_tool_context(0, |ctx| call_holdings(&serde_json::json!({}), ctx)).unwrap_err();
        assert!(err.to_string().contains("tool call budget exhausted"));
    }

    #[test]
    fn registry_is_exactly_the_twelve_read_only_tools_with_no_mutation() {
        let names: Vec<&str> = registry().iter().map(|t| t.name).collect();
        assert_eq!(
            names,
            vec![
                "quote",
                "chart",
                "holdings",
                "overview",
                "analytics",
                "search",
                "derivatives_search",
                "security_news",
                "transactions",
                "watchlist",
                "cash_breakdown",
                "portfolio_groups",
            ]
        );
        const MUTATION_MARKERS: &[&str] = &[
            "add", "remove", "create", "update", "delete", "assign", "unassign", "buy", "sell",
            "cancel", "config",
        ];
        for name in &names {
            assert!(
                !MUTATION_MARKERS.iter().any(|marker| name.contains(marker)),
                "tool '{name}' looks like it could mutate broker state"
            );
        }
    }

    #[test]
    fn every_schema_is_well_formed_with_required_fields_present_in_properties() {
        for tool in registry() {
            let schema = (tool.schema)();
            let obj = schema
                .as_object()
                .unwrap_or_else(|| panic!("tool '{}' schema is not a JSON object", tool.name));
            assert_eq!(
                obj.get("type").and_then(Value::as_str),
                Some("object"),
                "tool '{}' schema must declare type=object",
                tool.name
            );
            let properties = obj
                .get("properties")
                .and_then(Value::as_object)
                .unwrap_or_else(|| panic!("tool '{}' schema missing 'properties'", tool.name));
            if let Some(required) = obj.get("required") {
                let required = required
                    .as_array()
                    .unwrap_or_else(|| panic!("tool '{}' schema 'required' is not an array", tool.name));
                for field in required {
                    let field_name = field.as_str().unwrap_or_else(|| {
                        panic!("tool '{}' schema 'required' entry is not a string", tool.name)
                    });
                    assert!(
                        properties.contains_key(field_name),
                        "tool '{}' declares required field '{}' absent from properties",
                        tool.name,
                        field_name
                    );
                }
            }
        }
    }

    #[test]
    fn call_quote_rejects_missing_isin() {
        let err = with_tool_context(5, |ctx| call_quote(&serde_json::json!({}), ctx)).unwrap_err();
        assert!(err.to_string().contains("requires string field 'isin'"));
    }

    #[test]
    fn call_quote_rejects_malformed_isin() {
        let err = with_tool_context(5, |ctx| {
            call_quote(&serde_json::json!({"isin": "not-an-isin"}), ctx)
        })
        .unwrap_err();
        assert!(err.to_string().contains("malformed"));
    }

    #[test]
    fn call_chart_rejects_missing_timeframe() {
        let err = with_tool_context(5, |ctx| {
            call_chart(&serde_json::json!({"isin": "US0378331005"}), ctx)
        })
        .unwrap_err();
        assert!(err.to_string().contains("requires string field 'timeframe'"));
    }

    #[test]
    fn call_derivatives_search_rejects_malformed_underlying() {
        let err = with_tool_context(5, |ctx| {
            call_derivatives_search(
                &serde_json::json!({
                    "underlying": "not-an-isin",
                    "derivative_type": "knockout",
                    "strategy": "long"
                }),
                ctx,
            )
        })
        .unwrap_err();
        assert!(err.to_string().contains("malformed"));
    }

    #[test]
    fn enabled_for_requires_both_agent_list_and_global_enable() {
        let mut tools_cfg = ToolsFile::default();
        tools_cfg.tools.insert(
            "quote".to_string(),
            crate::agent::config::ToolProfile { enabled: false },
        );
        let agent_tools = vec!["quote".to_string(), "chart".to_string()];
        let enabled = enabled_for(&agent_tools, &tools_cfg);
        assert!(enabled.iter().any(|t| t.name == "chart"));
        assert!(!enabled.iter().any(|t| t.name == "quote"));
    }
}

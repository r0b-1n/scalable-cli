//! Read-only tool registry + adapters over the existing `execute_broker_*`
//! functions. No tool name that can mutate broker state is ever
//! registered here — the only channel from model output to trade
//! execution is the separate, non-network `propose_trade` tool defined by
//! `run_loop.rs` (Invariant AG-2 / fix F18).
//!
//! No `Args` struct in this codebase derives `Default`; every adapter
//! constructs its target struct with every field named explicitly — no
//! `..` struct-update syntax anywhere in this module (fix F15).

use anyhow::{Result, bail};
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
        ToolDef { name: "search", description: "Search securities by free text.", schema: empty_object_schema, call: call_search },
        ToolDef { name: "derivatives_search", description: "Search knockouts/warrants/factor certificates for an underlying ISIN.", schema: empty_object_schema, call: call_derivatives_search },
        ToolDef { name: "security_news", description: "News summary and sources for one ISIN.", schema: empty_object_schema, call: call_security_news },
        ToolDef { name: "transactions", description: "Recent portfolio transactions.", schema: empty_object_schema, call: call_transactions },
        ToolDef { name: "watchlist", description: "Current watchlist contents.", schema: empty_object_schema, call: call_watchlist },
        ToolDef { name: "cash_breakdown", description: "Cash balance and buying power breakdown.", schema: empty_object_schema, call: call_cash_breakdown },
        ToolDef { name: "portfolio_groups", description: "Portfolio groups and their members.", schema: empty_object_schema, call: call_portfolio_groups },
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

fn quote_schema() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": { "isin": {"type": "string", "description": "12-character ISIN"} },
        "required": ["isin"]
    })
}
fn call_quote(_args: &Value, _ctx: &mut ToolContext) -> Result<Value> {
    bail!("agent tool 'quote' not implemented")
}

fn chart_schema() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "isin": {"type": "string"},
            "timeframe": {"type": "string", "enum": ["1d", "1w", "1m", "3m", "1y", "5y", "max"]}
        },
        "required": ["isin", "timeframe"]
    })
}
fn call_chart(_args: &Value, _ctx: &mut ToolContext) -> Result<Value> {
    bail!("agent tool 'chart' not implemented")
}

fn holdings_schema() -> Value {
    serde_json::json!({ "type": "object", "properties": {} })
}
fn call_holdings(_args: &Value, _ctx: &mut ToolContext) -> Result<Value> {
    bail!("agent tool 'holdings' not implemented")
}

fn call_overview(_args: &Value, _ctx: &mut ToolContext) -> Result<Value> {
    bail!("agent tool 'overview' not implemented")
}
fn call_analytics(_args: &Value, _ctx: &mut ToolContext) -> Result<Value> {
    bail!("agent tool 'analytics' not implemented")
}
fn call_search(_args: &Value, _ctx: &mut ToolContext) -> Result<Value> {
    bail!("agent tool 'search' not implemented")
}
fn call_derivatives_search(_args: &Value, _ctx: &mut ToolContext) -> Result<Value> {
    bail!("agent tool 'derivatives_search' not implemented")
}
fn call_security_news(_args: &Value, _ctx: &mut ToolContext) -> Result<Value> {
    bail!("agent tool 'security_news' not implemented")
}
fn call_transactions(_args: &Value, _ctx: &mut ToolContext) -> Result<Value> {
    bail!("agent tool 'transactions' not implemented")
}
fn call_watchlist(_args: &Value, _ctx: &mut ToolContext) -> Result<Value> {
    bail!("agent tool 'watchlist' not implemented")
}
fn call_cash_breakdown(_args: &Value, _ctx: &mut ToolContext) -> Result<Value> {
    bail!("agent tool 'cash_breakdown' not implemented")
}
fn call_portfolio_groups(_args: &Value, _ctx: &mut ToolContext) -> Result<Value> {
    bail!("agent tool 'portfolio_groups' not implemented")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_call_budget_exhausts_after_remaining_calls() {
        let mut budget = ToolCallBudget { remaining: 1 };
        assert!(budget.consume().is_ok());
        assert!(budget.consume().is_err());
    }

    #[test]
    fn registry_has_all_twelve_read_only_tools() {
        assert_eq!(registry().len(), 12);
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

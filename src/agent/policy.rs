//! Pure policy/guardrail evaluator. Every guardrail (mode, notional caps,
//! order caps, allow/deny lists, cash floor, concentration cap, approval
//! thresholds, kill switch) is decided here from `PolicyProfile` and
//! locked, on-disk usage counters — never from the model's free text or
//! self-reported numbers (Invariant AG-2).

use anyhow::{Result, anyhow, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent::{AGENT_POLICY_TRADE_CONTROL_VIOLATION_PREFIX, AGENT_PROPOSAL_INVALID_PREFIX};
use crate::agent::config::PolicyProfile;
use crate::agent::daily_usage::DailyUsage;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub(crate) enum PolicyDecision {
    Allow,
    RequireApproval { reasons: Vec<String> },
    Deny { reasons: Vec<String> },
}

/// "buy" | "sell", carried as a plain string rather than a dedicated enum
/// so a malformed value from the model surfaces as an
/// `AGENT_PROPOSAL_INVALID` validation failure rather than a serde error
/// that bypasses `parse_and_validate_proposal`'s own message.
pub(crate) type TradeSideStr = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct TradeProposal {
    pub side: TradeSideStr,
    pub isin: String,
    pub order_type: String,
    pub amount: Option<String>,
    pub shares: Option<String>,
    pub limit_price: Option<String>,
    pub stop_price: Option<String>,
    pub venue: Option<String>,
    /// Audit-only: never read by the policy engine or the trade-args
    /// mapper below (Invariant AG-2 / fix F18).
    pub rationale: String,
}

/// The context the pre-submit pass needs, all of it Rust-fetched ground
/// truth (fix F5) rather than anything the model reported.
pub(crate) struct SubmitContext<'a> {
    pub proposal: &'a TradeProposal,
    pub estimated_order_volume: f64,
    pub selected_venue: &'a str,
    pub security_type: &'a str,
    pub cash_balance: f64,
    pub position_valuation_after: f64,
    pub portfolio_valuation: f64,
    pub daily_usage: &'a DailyUsage,
    pub orders_submitted_this_run: u32,
}

/// Parses and validates a raw `propose_trade` tool-call payload before any
/// field is read for any other purpose (Invariant AG-2 / fix F18). Any
/// failure here ends the run `Failed` with `AGENT_PROPOSAL_INVALID:` —
/// never a best-effort/heuristic salvage.
pub(crate) fn parse_and_validate_proposal(raw: &Value) -> Result<TradeProposal> {
    let proposal: TradeProposal = serde_json::from_value(raw.clone()).map_err(|e| {
        anyhow!("{AGENT_PROPOSAL_INVALID_PREFIX} malformed propose_trade arguments: {e}")
    })?;
    if proposal.side != "buy" && proposal.side != "sell" {
        bail!("{AGENT_PROPOSAL_INVALID_PREFIX} side must be 'buy' or 'sell'");
    }
    if !["market", "limit", "stop"].contains(&proposal.order_type.as_str()) {
        bail!("{AGENT_PROPOSAL_INVALID_PREFIX} order_type must be market|limit|stop");
    }
    if proposal.side == "sell" && proposal.shares.is_none() {
        bail!("{AGENT_PROPOSAL_INVALID_PREFIX} sell requires shares");
    }
    if proposal.side == "buy" && proposal.amount.is_some() == proposal.shares.is_some() {
        bail!("{AGENT_PROPOSAL_INVALID_PREFIX} buy requires exactly one of amount or shares");
    }
    if proposal.isin.trim().len() != 12 {
        bail!("{AGENT_PROPOSAL_INVALID_PREFIX} isin must be 12 characters");
    }
    Ok(proposal)
}

fn parse_order_type(s: &str) -> Result<crate::cli::BrokerTradeOrderType> {
    match s {
        "market" => Ok(crate::cli::BrokerTradeOrderType::Market),
        "limit" => Ok(crate::cli::BrokerTradeOrderType::Limit),
        "stop" => Ok(crate::cli::BrokerTradeOrderType::Stop),
        other => bail!("{AGENT_PROPOSAL_INVALID_PREFIX} unknown order_type '{other}'"),
    }
}

/// The exact, field-by-field boundary that `assert_phase2_matches_phase1_input`
/// re-checks byte-for-byte (fix F6) — used identically to build the phase-1
/// call and, later, the phase-2 call for the same `proposal` (only
/// `confirm`/`accept_unsuitable` differ).
pub(crate) fn build_buy_args(
    proposal: &TradeProposal,
    portfolio_id: Option<String>,
    confirm: Option<String>,
    accept_unsuitable: bool,
) -> Result<crate::cli::BrokerTradeBuyArgs> {
    Ok(crate::cli::BrokerTradeBuyArgs {
        isin: Some(proposal.isin.clone()),
        amount: proposal.amount.clone(),
        shares: proposal.shares.clone(),
        order_type: parse_order_type(&proposal.order_type)?,
        limit_price: proposal.limit_price.clone(),
        stop_price: proposal.stop_price.clone(),
        venue: proposal.venue.clone(),
        confirm,
        accept_unsuitable,
        portfolio_id,
        json: true,
    })
}

pub(crate) fn build_sell_args(
    proposal: &TradeProposal,
    portfolio_id: Option<String>,
    confirm: Option<String>,
) -> Result<crate::cli::BrokerTradeSellArgs> {
    Ok(crate::cli::BrokerTradeSellArgs {
        isin: Some(proposal.isin.clone()),
        shares: proposal.shares.clone(),
        order_type: parse_order_type(&proposal.order_type)?,
        limit_price: proposal.limit_price.clone(),
        stop_price: proposal.stop_price.clone(),
        venue: proposal.venue.clone(),
        confirm,
        portfolio_id,
        json: true,
    })
}

/// Cheap, structural checks only (kill switch, order-type allow/deny, ISIN
/// allow/deny) — no network yet, so a plainly-forbidden proposal never
/// consumes a trade-slot reservation or a confirmation. See spec §8.1
/// rules 0/2/5.
pub(crate) fn check_pre_proposal(_policy: &PolicyProfile, _proposal: &TradeProposal) -> Result<PolicyDecision> {
    bail!(
        "{AGENT_POLICY_TRADE_CONTROL_VIOLATION_PREFIX} policy pre-proposal evaluation not implemented"
    )
}

/// Authoritative pass, run only after a successful phase-1 preview, over
/// Rust-fetched ground truth (instrument type, venue, cash, concentration,
/// daily usage) — never the model's numbers. See spec §8.1 rules
/// 3/4/6/7/8/9/10/11/12/13.
pub(crate) fn check_pre_submit(_policy: &PolicyProfile, _ctx: &SubmitContext<'_>) -> Result<PolicyDecision> {
    bail!(
        "{AGENT_POLICY_TRADE_CONTROL_VIOLATION_PREFIX} policy pre-submit evaluation not implemented"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_and_validate_proposal_rejects_missing_required_fields() {
        let raw = serde_json::json!({"side": "buy"});
        assert!(parse_and_validate_proposal(&raw).is_err());
    }

    #[test]
    fn parse_and_validate_proposal_rejects_buy_with_both_amount_and_shares() {
        let raw = serde_json::json!({
            "side": "buy", "isin": "US0378331005", "order_type": "market",
            "amount": "100.00", "shares": "1", "rationale": "test"
        });
        assert!(parse_and_validate_proposal(&raw).is_err());
    }

    #[test]
    fn parse_and_validate_proposal_rejects_sell_without_shares() {
        let raw = serde_json::json!({
            "side": "sell", "isin": "US0378331005", "order_type": "market", "rationale": "test"
        });
        assert!(parse_and_validate_proposal(&raw).is_err());
    }

    #[test]
    fn parse_and_validate_proposal_accepts_well_formed_buy() {
        let raw = serde_json::json!({
            "side": "buy", "isin": "US0378331005", "order_type": "market",
            "amount": "100.00", "rationale": "test"
        });
        assert!(parse_and_validate_proposal(&raw).is_ok());
    }
}

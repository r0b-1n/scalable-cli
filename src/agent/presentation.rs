//! Static leaf-path/section specs for the agent-run disclosure. Delegates
//! to `trade_presentation`'s existing, already-`pub(crate)` specs rather
//! than hand-duplicating them, so the agent workflow's capabilities
//! declaration and the actual phase-1 disclosure payload can never drift
//! apart (spec §8.4).

use serde_json::Value;

use crate::trade::TradeSide;
use crate::trade_presentation::{
    presentation_required_leaf_paths, presentation_section_order_keys, render_trade_buy_text,
    render_trade_sell_text,
};

pub(crate) fn agent_run_section_order(side: TradeSide) -> Vec<&'static str> {
    presentation_section_order_keys(side)
}

pub(crate) fn agent_run_required_leaf_paths(side: TradeSide) -> Vec<&'static str> {
    presentation_required_leaf_paths(side)
}

/// Renders a phase-1/phase-2 disclosure `payload` exactly as a manual
/// `sc broker trade buy/sell` preview would, so an audit record's
/// human-readable text is byte-identical to it, never a second,
/// independently-drifting rendering.
pub(crate) fn render_disclosure_text(side: TradeSide, payload: &Value) -> Vec<String> {
    match side {
        TradeSide::Buy => render_trade_buy_text(payload),
        TradeSide::Sell => render_trade_sell_text(payload),
    }
}

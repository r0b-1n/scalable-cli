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

/// The `section_order` an agent-run disclosure presents, for the same
/// `side` a manual `sc broker trade buy/sell` preview would use. This is
/// what `machine_capabilities()` and the desktop's `ApprovalQueue` need to
/// declare the agent workflow's `phase_1_presentation_requirement` — the
/// same shape already declared for `broker.trade.buy`/`sell` — without
/// re-deriving it from the disclosure payload themselves.
pub(crate) fn agent_run_section_order(side: TradeSide) -> Vec<&'static str> {
    presentation_section_order_keys(side)
}

/// The `required_leaf_paths` an agent-run disclosure must carry, for the
/// same `side` a manual `sc broker trade buy/sell` preview would use. Along
/// with [`agent_run_section_order`], this is the other half of the
/// capabilities declaration described there.
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

/// Regression guard for spec §8.4: these compare this module's outputs
/// against `trade_presentation`'s directly, side by side, rather than
/// against a hand-copied expected list — so a future edit that makes either
/// side stop delegating to the other (forking the disclosure spec instead
/// of reusing it) fails here instead of silently shipping an agent-run
/// disclosure that has quietly drifted from the interactive trade flow's.
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn section_order_matches_trade_presentation_for_buy() {
        assert_eq!(
            agent_run_section_order(TradeSide::Buy),
            presentation_section_order_keys(TradeSide::Buy)
        );
    }

    #[test]
    fn section_order_matches_trade_presentation_for_sell() {
        assert_eq!(
            agent_run_section_order(TradeSide::Sell),
            presentation_section_order_keys(TradeSide::Sell)
        );
    }

    #[test]
    fn required_leaf_paths_matches_trade_presentation_for_buy() {
        assert_eq!(
            agent_run_required_leaf_paths(TradeSide::Buy),
            presentation_required_leaf_paths(TradeSide::Buy)
        );
    }

    #[test]
    fn required_leaf_paths_matches_trade_presentation_for_sell() {
        assert_eq!(
            agent_run_required_leaf_paths(TradeSide::Sell),
            presentation_required_leaf_paths(TradeSide::Sell)
        );
    }

    /// The lockstep assertions above would also pass for two specs that
    /// both happened to be empty; this pins down that the reused specs
    /// actually carry a real disclosure body for both sides.
    #[test]
    fn required_leaf_paths_are_non_empty_for_both_sides() {
        assert!(!agent_run_required_leaf_paths(TradeSide::Buy).is_empty());
        assert!(!agent_run_required_leaf_paths(TradeSide::Sell).is_empty());
    }

    #[test]
    fn render_disclosure_text_matches_trade_presentation_rendering() {
        let payload = json!({});
        assert_eq!(
            render_disclosure_text(TradeSide::Buy, &payload),
            render_trade_buy_text(&payload)
        );
        assert_eq!(
            render_disclosure_text(TradeSide::Sell, &payload),
            render_trade_sell_text(&payload)
        );
    }
}

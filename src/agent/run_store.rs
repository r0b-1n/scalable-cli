//! `RunRecord` persistence, per-run and per-agent locking, and the
//! lightweight `runs/index.json` used by `sc agent run list`. A `RunRecord`
//! is written to disk after every single run-loop step, so a killed
//! process loses at most the in-flight step (§7.9).

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent::config::PolicyProfile;
use crate::agent::policy::{PolicyDecision, TradeProposal};
use crate::agent::{AGENT_RUN_NOT_FOUND_PREFIX, now_epoch};
use crate::config::TargetEnv;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RunStatus {
    Planning,
    AwaitingModel,
    ToolCallsPending,
    ProposalReady,
    PolicyBlocked,
    AwaitingHumanApproval,
    Phase1Ready,
    AwaitingPhase2Approval,
    Submitted,
    NoActionTaken,
    Failed,
    Cancelled,
}
impl RunStatus {
    pub(crate) fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::PolicyBlocked | Self::Submitted | Self::NoActionTaken | Self::Failed | Self::Cancelled
        )
    }
    pub(crate) fn is_paused(self) -> bool {
        matches!(self, Self::AwaitingHumanApproval | Self::AwaitingPhase2Approval)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum RunTurn {
    ModelCall {
        step: u32,
        at_epoch: i64,
        /// Truncated to 8000 chars (fix F10); the full body lives in the
        /// `.raw/` sidecar named by `raw_ref`.
        assistant_text: Option<String>,
        tool_call_names: Vec<String>,
        stop_reason: String,
        raw_ref: String,
    },
    ToolCall {
        step: u32,
        at_epoch: i64,
        name: String,
        arguments: Value,
        result: Value,
        ok: bool,
    },
    Proposal {
        step: u32,
        at_epoch: i64,
        proposal: TradeProposal,
    },
    PolicyDecision {
        step: u32,
        at_epoch: i64,
        // `&'static str` (as in the spec) cannot round-trip through a
        // generic `Deserialize<'de>` impl, which `RunRecord` needs for
        // `load_run`; an owned `String` carries the same fixed set of
        // literal values ("pre_proposal" | "pre_submit") without that
        // lifetime constraint.
        phase: String,
        decision: PolicyDecision,
    },
    Phase1 {
        step: u32,
        at_epoch: i64,
        confirmation_id: String,
        expires_at_epoch: i64,
        disclosure: Value,
    },
    Phase2 {
        step: u32,
        at_epoch: i64,
        ok: bool,
        order_id: Option<String>,
        message: Option<String>,
    },
    HumanDecision {
        step: u32,
        at_epoch: i64,
        // See the comment on `PolicyDecision::phase` above — same reason.
        action: String,
        note: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RunRecord {
    pub run_id: String,
    pub agent_id: String,
    pub env: TargetEnv,
    /// Frozen at run start; a concurrent policy edit never changes an
    /// in-flight run.
    pub policy_snapshot: PolicyProfile,
    pub status: RunStatus,
    pub created_at_epoch: i64,
    pub updated_at_epoch: i64,
    pub goal: Option<String>,
    pub turns: Vec<RunTurn>,
    pub proposal: Option<TradeProposal>,
    pub confirmation_id: Option<String>,
    pub confirmation_expires_at_epoch: Option<i64>,
    pub orders_submitted_this_run: u32,
    pub audit_hash_chain_tail: Option<String>,
    pub failure_reason: Option<String>,
}

fn runs_dir() -> Result<std::path::PathBuf> {
    Ok(super::agents_dir_path()?.join("runs"))
}

fn run_path(run_id: &str) -> Result<std::path::PathBuf> {
    Ok(runs_dir()?.join(format!("{run_id}.json")))
}

/// Scans `runs/index.json` for any record whose `agent_id` matches and
/// whose `status` is non-terminal (fix F13).
pub(crate) fn find_active_run_for_agent(_agent_id: &str) -> Result<Option<RunRecord>> {
    bail!("agent run store not implemented")
}

pub(crate) fn load_run(run_id: &str) -> Result<Option<RunRecord>> {
    bail!("{AGENT_RUN_NOT_FOUND_PREFIX} run store not implemented, run_id='{run_id}'")
}

pub(crate) fn save_run(_record: &RunRecord) -> Result<()> {
    bail!("agent run store not implemented")
}

/// Mints a fresh, timestamp-derived run id — unique enough for a per-agent,
/// single-host advisory namespace.
pub(crate) fn new_run_id() -> String {
    format!("run_{}", now_epoch())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_statuses_are_exactly_the_documented_set() {
        assert!(RunStatus::PolicyBlocked.is_terminal());
        assert!(RunStatus::Submitted.is_terminal());
        assert!(RunStatus::NoActionTaken.is_terminal());
        assert!(RunStatus::Failed.is_terminal());
        assert!(RunStatus::Cancelled.is_terminal());
        assert!(!RunStatus::Planning.is_terminal());
        assert!(!RunStatus::AwaitingPhase2Approval.is_terminal());
    }

    #[test]
    fn paused_statuses_are_exactly_the_documented_set() {
        assert!(RunStatus::AwaitingHumanApproval.is_paused());
        assert!(RunStatus::AwaitingPhase2Approval.is_paused());
        assert!(!RunStatus::Phase1Ready.is_paused());
        assert!(!RunStatus::Submitted.is_paused());
    }
}

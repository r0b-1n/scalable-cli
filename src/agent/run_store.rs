//! `RunRecord` persistence: one JSON file per run under `runs/<run_id>.json`
//! plus a lightweight `runs/index.json` used for per-agent exclusion and for
//! `sc agent run list`'s filtering — not a single mutable slot, since more
//! than one run (across agents, and across an agent's own history) must be
//! inspectable at once.
//!
//! Three lock files, each guarding exactly one store per §3.0's "never share
//! a lock file across unrelated stores":
//! - `runs/<run_id>.lock` — per-run: serializes readers and writers of one
//!   run's JSON file, and is the unit `append_turn` uses to make "load
//!   current state, append one step, save" atomic with respect to every
//!   other writer of the same run.
//! - `runs/index.json`'s own `runs/index.lock` — serializes the small
//!   index file that `find_active_run_for_agent`/`list_runs` scan instead of
//!   opening every run file on disk.
//! - `runs/<agent_id>.active_run.lock` — owned by `run_loop::start_run`
//!   (fix F13), not this module; `find_active_run_for_agent` only reads the
//!   index, it never takes that lock itself.
//!
//! A `RunRecord` is written to disk after every single run-loop step, so a
//! killed process loses at most the in-flight step (§7.9). Steps
//! (`RunTurn`s) are appended, never rewritten, so the persisted timeline —
//! what a human or an auditor reads back — can never be quietly edited out
//! from under them.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent::config::PolicyProfile;
use crate::agent::policy::{PolicyDecision, TradeProposal};
use crate::agent::{AGENT_RUN_NOT_FOUND_PREFIX, now_epoch};
use crate::config::{TargetEnv, with_exclusive_file_lock, write_private_file_atomic};

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

    /// The "Running"-equivalent statuses §7.9 stale-detection applies to —
    /// a run genuinely mid-step, as opposed to one paused on a human or
    /// already finished, both of which are expected to sit still.
    fn is_running_equivalent(self) -> bool {
        matches!(
            self,
            Self::Planning | Self::AwaitingModel | Self::ToolCallsPending | Self::ProposalReady
        )
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

/// A run's on-disk footprint whose `updated_at_epoch` has not moved in more
/// than this many seconds while its status is still "Running"-equivalent
/// (§7.9) is reported stale — a cheap heuristic ("its owning process
/// probably died") rather than a guarantee, since nothing here can actually
/// observe whether that process is still alive.
const STALE_THRESHOLD_SECS: i64 = 600;

/// One `runs/index.json` row: everything `find_active_run_for_agent` and
/// `list_runs` need without opening the run's own (potentially large,
/// full-turn-history) JSON file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RunIndexEntry {
    pub run_id: String,
    pub agent_id: String,
    pub env: TargetEnv,
    pub status: RunStatus,
    pub created_at_epoch: i64,
    pub updated_at_epoch: i64,
}

/// A `RunIndexEntry` plus the staleness flag computed against the current
/// wall clock at query time — never itself persisted, since "how long ago
/// was that" only means something relative to "now".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RunListEntry {
    pub run_id: String,
    pub agent_id: String,
    pub env: TargetEnv,
    pub status: RunStatus,
    pub created_at_epoch: i64,
    pub updated_at_epoch: i64,
    pub stale: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct RunIndex {
    #[serde(default)]
    entries: Vec<RunIndexEntry>,
}

fn runs_dir() -> Result<PathBuf> {
    Ok(super::agents_dir_path()?.join("runs"))
}

fn run_path(run_id: &str) -> Result<PathBuf> {
    Ok(runs_dir()?.join(format!("{run_id}.json")))
}

fn run_lock_path(run_id: &str) -> Result<PathBuf> {
    Ok(runs_dir()?.join(format!("{run_id}.lock")))
}

fn index_path() -> Result<PathBuf> {
    Ok(runs_dir()?.join("index.json"))
}

fn index_lock_path() -> Result<PathBuf> {
    Ok(runs_dir()?.join("index.lock"))
}

/// True when a "Running"-equivalent run's last recorded step is far enough
/// in the past that its owning process most likely no longer exists (§7.9).
/// Statuses that are meant to sit still — paused on a human, or already
/// terminal — are never stale regardless of age.
fn is_stale(status: RunStatus, updated_at_epoch: i64, now_epoch: i64) -> bool {
    status.is_running_equivalent() && now_epoch.saturating_sub(updated_at_epoch) > STALE_THRESHOLD_SECS
}

fn read_run_file_locked(run_id: &str) -> Result<Option<RunRecord>> {
    let path = run_path(run_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read run record {}", path.display()))?;
    let record = serde_json::from_str(&raw)
        .with_context(|| format!("Invalid run record JSON at {}", path.display()))?;
    Ok(Some(record))
}

fn write_run_file_locked(record: &RunRecord) -> Result<()> {
    let path = run_path(&record.run_id)?;
    let serialized = serde_json::to_string_pretty(record)?;
    write_private_file_atomic(&path, serialized.as_bytes())
        .with_context(|| format!("Failed to write run record {}", path.display()))
}

fn read_index_locked(path: &Path) -> Result<RunIndex> {
    if !path.exists() {
        return Ok(RunIndex::default());
    }
    let raw = fs::read_to_string(path)
        .with_context(|| format!("Failed to read run index {}", path.display()))?;
    if raw.trim().is_empty() {
        return Ok(RunIndex::default());
    }
    serde_json::from_str(&raw).with_context(|| format!("Invalid run index JSON at {}", path.display()))
}

/// Upserts `record`'s row in `runs/index.json`, matched by `run_id`, under
/// the index's own lock file — a separate acquisition from the per-run
/// lock a caller (`save_run`/`append_turn`) already released by this point,
/// so the two locks are never held nested/out of order.
fn upsert_index_entry(record: &RunRecord) -> Result<()> {
    let path = index_path()?;
    with_exclusive_file_lock(&index_lock_path()?, true, || {
        let mut index = read_index_locked(&path)?;
        let entry = RunIndexEntry {
            run_id: record.run_id.clone(),
            agent_id: record.agent_id.clone(),
            env: record.env,
            status: record.status,
            created_at_epoch: record.created_at_epoch,
            updated_at_epoch: record.updated_at_epoch,
        };
        match index.entries.iter_mut().find(|existing| existing.run_id == record.run_id) {
            Some(existing) => *existing = entry,
            None => index.entries.push(entry),
        }
        let serialized = serde_json::to_string_pretty(&index)?;
        write_private_file_atomic(&path, serialized.as_bytes())
            .with_context(|| format!("Failed to write run index {}", path.display()))
    })
}

/// Scans `runs/index.json` for any record whose `agent_id` matches and
/// whose `status` is non-terminal (fix F13). The index, not a directory
/// listing of `runs/*.json`, is the source of truth here — it is the same
/// file `list_runs` reads, so the two never disagree about what "active"
/// means.
pub(crate) fn find_active_run_for_agent(agent_id: &str) -> Result<Option<RunRecord>> {
    let path = index_path()?;
    let index = with_exclusive_file_lock(&index_lock_path()?, true, || read_index_locked(&path))?;
    let Some(entry) = index
        .entries
        .iter()
        .find(|entry| entry.agent_id == agent_id && !entry.status.is_terminal())
    else {
        return Ok(None);
    };
    load_run(&entry.run_id)
}

/// Lists index rows, optionally narrowed to one agent and/or one status,
/// each carrying a freshly computed `stale` flag (§7.9). Reads only the
/// index — never opens the individual run files — so listing a large run
/// history stays cheap.
pub(crate) fn list_runs(agent_id: Option<&str>, status: Option<RunStatus>) -> Result<Vec<RunListEntry>> {
    let path = index_path()?;
    let index = with_exclusive_file_lock(&index_lock_path()?, true, || read_index_locked(&path))?;
    let now = now_epoch();
    let mut entries: Vec<RunListEntry> = index
        .entries
        .into_iter()
        .filter(|entry| agent_id.is_none_or(|wanted| entry.agent_id == wanted))
        .filter(|entry| status.is_none_or(|wanted| entry.status == wanted))
        .map(|entry| RunListEntry {
            stale: is_stale(entry.status, entry.updated_at_epoch, now),
            run_id: entry.run_id,
            agent_id: entry.agent_id,
            env: entry.env,
            status: entry.status,
            created_at_epoch: entry.created_at_epoch,
            updated_at_epoch: entry.updated_at_epoch,
        })
        .collect();
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.created_at_epoch));
    Ok(entries)
}

/// Loads one run's full record, or `Ok(None)` if no such run has ever been
/// persisted — a missing run is not itself an error here; callers that
/// require the run to exist (e.g. `run_loop::approve_run`) turn `None` into
/// their own `AGENT_RUN_NOT_FOUND`-prefixed error, since only they know the
/// right message for their call site.
pub(crate) fn load_run(run_id: &str) -> Result<Option<RunRecord>> {
    with_exclusive_file_lock(&run_lock_path(run_id)?, true, || read_run_file_locked(run_id))
}

/// Persists `record` in full, overwriting whatever was previously on disk
/// for its `run_id`, then upserts its `runs/index.json` row. Suitable for a
/// caller that already holds the one authoritative in-memory copy of a run
/// (per-agent mutual exclusion, fix F13, is what makes that true in
/// practice) and is writing back the result of a whole step; a caller that
/// only wants to add one more step to whatever is currently on disk should
/// prefer [`append_turn`], which re-reads under the same lock instead of
/// trusting a possibly-stale in-memory copy.
pub(crate) fn save_run(record: &RunRecord) -> Result<()> {
    with_exclusive_file_lock(&run_lock_path(&record.run_id)?, true, || write_run_file_locked(record))?;
    upsert_index_entry(record)
}

/// Appends one step to `run_id`'s persisted turn list, atomically with
/// respect to every other `append_turn`/`save_run` call for the same
/// `run_id`: the load, the call to `build` (which sees the just-reloaded
/// record, not a caller-held stale copy), the push, and the save all happen
/// inside one `runs/<run_id>.lock` acquisition, so two concurrent appenders
/// always compose rather than one silently clobbering the other's step.
pub(crate) fn append_turn(run_id: &str, build: impl FnOnce(&RunRecord) -> RunTurn) -> Result<RunRecord> {
    let record = with_exclusive_file_lock(&run_lock_path(run_id)?, true, || {
        let mut record = read_run_file_locked(run_id)?
            .ok_or_else(|| anyhow!("{AGENT_RUN_NOT_FOUND_PREFIX} run '{run_id}' has no persisted record"))?;
        let turn = build(&record);
        record.turns.push(turn);
        record.updated_at_epoch = now_epoch();
        write_run_file_locked(&record)?;
        Ok(record)
    })?;
    upsert_index_entry(&record)?;
    Ok(record)
}

/// Mints a fresh, timestamp-derived run id — unique enough for a per-agent,
/// single-host advisory namespace.
pub(crate) fn new_run_id() -> String {
    format!("run_{}", now_epoch())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::config::PolicyMode;

    struct EnvGuard {
        key: &'static str,
        original: Option<String>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: String) -> Self {
            let original = std::env::var(key).ok();
            unsafe {
                std::env::set_var(key, value);
            }
            Self { key, original }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.original {
                Some(v) => unsafe {
                    std::env::set_var(self.key, v);
                },
                None => unsafe {
                    std::env::remove_var(self.key);
                },
            }
        }
    }

    fn temp_config_dir() -> (tempfile::TempDir, String) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let config_dir = tmp.path().to_string_lossy().to_string();
        (tmp, config_dir)
    }

    fn sample_policy(id: &str) -> PolicyProfile {
        PolicyProfile {
            id: id.to_string(),
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

    fn sample_proposal() -> TradeProposal {
        TradeProposal {
            side: "buy".to_string(),
            isin: "IE00B4L5Y983".to_string(),
            order_type: "market".to_string(),
            amount: Some("500.00".to_string()),
            shares: None,
            limit_price: None,
            stop_price: None,
            venue: Some("XETR".to_string()),
            rationale: "broad, cheap developed-market exposure".to_string(),
        }
    }

    fn sample_record(run_id: &str, agent_id: &str, status: RunStatus, at_epoch: i64) -> RunRecord {
        RunRecord {
            run_id: run_id.to_string(),
            agent_id: agent_id.to_string(),
            env: TargetEnv::Dev,
            policy_snapshot: sample_policy("conservative-dev"),
            status,
            created_at_epoch: at_epoch,
            updated_at_epoch: at_epoch,
            goal: Some("rebalance toward the target allocation".to_string()),
            turns: Vec::new(),
            proposal: None,
            confirmation_id: None,
            confirmation_expires_at_epoch: None,
            orders_submitted_this_run: 0,
            audit_hash_chain_tail: None,
            failure_reason: None,
        }
    }

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

    #[test]
    fn save_and_load_round_trip_a_full_run_record() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        let mut record = sample_record("run_1000", "momentum-eu-etfs", RunStatus::ProposalReady, 1_000);
        record.proposal = Some(sample_proposal());
        record.turns.push(RunTurn::ModelCall {
            step: 0,
            at_epoch: 1_000,
            assistant_text: Some("Looking at the EU ETF momentum signal now.".to_string()),
            tool_call_names: vec!["get_portfolio".to_string()],
            stop_reason: "tool_use".to_string(),
            raw_ref: "run_1000/step_0.raw.json".to_string(),
        });

        save_run(&record).expect("save_run");
        let reloaded = load_run("run_1000").expect("load_run").expect("run exists");

        assert_eq!(reloaded.run_id, record.run_id);
        assert_eq!(reloaded.agent_id, record.agent_id);
        assert_eq!(reloaded.status, RunStatus::ProposalReady);
        assert_eq!(reloaded.goal, record.goal);
        assert_eq!(reloaded.turns.len(), 1);
        assert!(reloaded.proposal.is_some());
        assert_eq!(reloaded.proposal.unwrap().isin, "IE00B4L5Y983");
        match &reloaded.turns[0] {
            RunTurn::ModelCall { assistant_text, .. } => {
                assert_eq!(
                    assistant_text.as_deref(),
                    Some("Looking at the EU ETF momentum signal now.")
                );
            }
            other => panic!("expected ModelCall, got {other:?}"),
        }
    }

    #[test]
    fn load_run_returns_none_rather_than_erroring_for_an_unknown_id() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        assert!(load_run("run_does_not_exist").expect("load_run").is_none());
    }

    #[test]
    fn list_runs_filters_by_agent_and_by_status() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        save_run(&sample_record("run_a1", "agent-a", RunStatus::ProposalReady, 100)).expect("save a1");
        save_run(&sample_record("run_a2", "agent-a", RunStatus::Submitted, 200)).expect("save a2");
        save_run(&sample_record("run_b1", "agent-b", RunStatus::ProposalReady, 300)).expect("save b1");

        let all = list_runs(None, None).expect("list all");
        assert_eq!(all.len(), 3);

        let agent_a = list_runs(Some("agent-a"), None).expect("list agent-a");
        let mut agent_a_ids: Vec<_> = agent_a.iter().map(|e| e.run_id.clone()).collect();
        agent_a_ids.sort();
        assert_eq!(agent_a_ids, vec!["run_a1".to_string(), "run_a2".to_string()]);

        let proposal_ready = list_runs(None, Some(RunStatus::ProposalReady)).expect("list status");
        let mut proposal_ready_ids: Vec<_> = proposal_ready.iter().map(|e| e.run_id.clone()).collect();
        proposal_ready_ids.sort();
        assert_eq!(proposal_ready_ids, vec!["run_a1".to_string(), "run_b1".to_string()]);

        let agent_a_submitted =
            list_runs(Some("agent-a"), Some(RunStatus::Submitted)).expect("list agent+status");
        assert_eq!(agent_a_submitted.len(), 1);
        assert_eq!(agent_a_submitted[0].run_id, "run_a2");
    }

    #[test]
    fn find_active_run_for_agent_ignores_terminal_runs_and_other_agents() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        // A terminal run for the same agent must not count as active.
        save_run(&sample_record("run_done", "momentum-eu-etfs", RunStatus::Submitted, 100))
            .expect("save terminal run");
        assert!(
            find_active_run_for_agent("momentum-eu-etfs")
                .expect("find")
                .is_none()
        );

        // A non-terminal run for a different agent must not count either.
        save_run(&sample_record("run_other", "value-us-equities", RunStatus::AwaitingModel, 200))
            .expect("save other agent's run");
        assert!(
            find_active_run_for_agent("momentum-eu-etfs")
                .expect("find")
                .is_none()
        );

        // Only a non-terminal run for the matching agent counts as active.
        save_run(&sample_record("run_live", "momentum-eu-etfs", RunStatus::AwaitingHumanApproval, 300))
            .expect("save active run");
        let active = find_active_run_for_agent("momentum-eu-etfs")
            .expect("find")
            .expect("one active run");
        assert_eq!(active.run_id, "run_live");
    }

    #[test]
    fn is_stale_applies_only_to_running_equivalent_statuses_past_the_threshold() {
        let now = 1_000_000;

        // A running-equivalent status well past the threshold is stale...
        assert!(is_stale(RunStatus::ProposalReady, now - STALE_THRESHOLD_SECS - 1, now));
        // ...exactly at the threshold is not yet...
        assert!(!is_stale(RunStatus::ProposalReady, now - STALE_THRESHOLD_SECS, now));
        // ...and a fresh update is not.
        assert!(!is_stale(RunStatus::Planning, now - 5, now));

        // A paused or terminal status is never stale, no matter how old.
        assert!(!is_stale(RunStatus::AwaitingHumanApproval, 0, now));
        assert!(!is_stale(RunStatus::Submitted, 0, now));
    }

    #[test]
    fn list_runs_marks_a_long_untouched_running_equivalent_run_stale() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        let ancient = now_epoch() - STALE_THRESHOLD_SECS - 3_600;
        save_run(&sample_record("run_stuck", "momentum-eu-etfs", RunStatus::ToolCallsPending, ancient))
            .expect("save stuck run");
        // A paused run left untouched for exactly as long must not be
        // flagged: §7.9 only ever applies staleness to the running states.
        save_run(&sample_record("run_paused", "momentum-eu-etfs", RunStatus::AwaitingPhase2Approval, ancient))
            .expect("save paused run");

        let entries = list_runs(Some("momentum-eu-etfs"), None).expect("list");
        let stuck = entries.iter().find(|e| e.run_id == "run_stuck").expect("stuck entry");
        let paused = entries.iter().find(|e| e.run_id == "run_paused").expect("paused entry");
        assert!(stuck.stale);
        assert!(!paused.stale);
    }

    #[test]
    fn append_turn_from_many_threads_never_drops_a_step() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        save_run(&sample_record("run_concurrent", "momentum-eu-etfs", RunStatus::ToolCallsPending, 1_000))
            .expect("save initial record");

        const WRITER_COUNT: usize = 16;
        let handles: Vec<_> = (0..WRITER_COUNT)
            .map(|writer_index| {
                std::thread::spawn(move || {
                    append_turn("run_concurrent", move |record| {
                        let step = u32::try_from(record.turns.len()).expect("turn count fits u32");
                        RunTurn::ToolCall {
                            step,
                            at_epoch: 1_000,
                            name: format!("writer_{writer_index}"),
                            arguments: serde_json::json!({ "writer_index": writer_index }),
                            result: serde_json::json!({ "ok": true }),
                            ok: true,
                        }
                    })
                    .expect("append_turn must not fail under contention")
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("worker thread panicked");
        }

        let reloaded = load_run("run_concurrent").expect("load").expect("run exists");
        assert_eq!(reloaded.turns.len(), WRITER_COUNT, "every writer's step must survive");

        let mut writer_indices: Vec<usize> = reloaded
            .turns
            .iter()
            .map(|turn| match turn {
                RunTurn::ToolCall { arguments, .. } => {
                    arguments["writer_index"].as_u64().expect("writer_index present") as usize
                }
                other => panic!("expected ToolCall, got {other:?}"),
            })
            .collect();
        writer_indices.sort_unstable();
        assert_eq!(writer_indices, (0..WRITER_COUNT).collect::<Vec<_>>(), "no writer's step was dropped");

        let mut steps: Vec<u32> = reloaded
            .turns
            .iter()
            .map(|turn| match turn {
                RunTurn::ToolCall { step, .. } => *step,
                other => panic!("expected ToolCall, got {other:?}"),
            })
            .collect();
        steps.sort_unstable();
        assert_eq!(steps, (0..WRITER_COUNT as u32).collect::<Vec<_>>(), "steps must be contiguous, not colliding");
    }
}

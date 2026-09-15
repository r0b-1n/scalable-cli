//! The resumable run state machine. The sole caller of
//! `execute_broker_trade_buy`/`execute_broker_trade_sell` for agent trades
//! — `prepare_trade`, `submit_order`, and the trade mutation are never
//! called directly from here (design principle 3).

use anyhow::{Result, bail};

use crate::agent::config::{AgentDefinition, PolicyProfile, ToolsFile};
use crate::agent::providers::ChatProvider;
use crate::agent::run_store::RunRecord;
use crate::agent::{AGENT_RUN_ALREADY_ACTIVE_PREFIX, AGENT_RUN_NOT_FOUND_PREFIX};
use crate::config::AppConfig;
use crate::session::SessionManager;

/// Per-agent mutual exclusion (fix F13): the lock is only held for the
/// "is one already active + create the new record" critical section, not
/// for the run's whole lifetime, since `resume` must be able to re-enter
/// later without deadlocking on its own lock.
pub(crate) fn start_run(
    agent_id: &str,
    _config: &AppConfig,
    _session_manager: &mut SessionManager,
) -> Result<RunRecord> {
    bail!("{AGENT_RUN_ALREADY_ACTIVE_PREFIX} run loop not implemented, agent_id='{agent_id}'")
}

/// Runs `run_step` up to `max_steps` times, or until the record reaches a
/// terminal or paused state, or `run_timeout_seconds` elapses.
pub(crate) fn drive_run(
    run_id: &str,
    _max_steps: u32,
    _config: &AppConfig,
    _session_manager: &mut SessionManager,
) -> Result<RunRecord> {
    bail!("{AGENT_RUN_NOT_FOUND_PREFIX} run loop not implemented, run_id='{run_id}'")
}

/// One step of the run state machine: kill-switch check, then dispatch on
/// `record.status` (model call, tool dispatch, proposal validation, policy
/// evaluation, phase 1/2 execution) per spec §7.5. Persists `record` after
/// every step so a killed process loses at most the in-flight step.
pub(crate) fn run_step(
    _record: &mut RunRecord,
    _agent: &AgentDefinition,
    _provider: &dyn ChatProvider,
    _tools: &ToolsFile,
    _policy: &PolicyProfile,
    _config: &AppConfig,
    _session_manager: &mut SessionManager,
) -> Result<()> {
    bail!("agent run loop step not implemented")
}

pub(crate) fn approve_run(
    run_id: &str,
    _config: &AppConfig,
    _session_manager: &mut SessionManager,
) -> Result<RunRecord> {
    bail!("{AGENT_RUN_NOT_FOUND_PREFIX} run loop not implemented, run_id='{run_id}'")
}

pub(crate) fn reject_run(run_id: &str, _reason: Option<String>) -> Result<RunRecord> {
    bail!("{AGENT_RUN_NOT_FOUND_PREFIX} run loop not implemented, run_id='{run_id}'")
}

pub(crate) fn cancel_run(run_id: &str) -> Result<RunRecord> {
    bail!("{AGENT_RUN_NOT_FOUND_PREFIX} run loop not implemented, run_id='{run_id}'")
}

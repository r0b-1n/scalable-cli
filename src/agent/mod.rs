//! Engine root for the autonomous trading-agent subsystem (`sc agent ...`).
//!
//! Agents propose, policy decides, Rust code executes: the LLM layer in
//! `providers`/`tools` never gets a tool that can move money, `policy` is
//! the only thing that turns a proposal into a go/no-go decision, and
//! `run_loop` is the only caller of the existing two-phase
//! `execute_broker_trade_buy`/`execute_broker_trade_sell` flow for agent
//! trades. Everything under `config.rs`'s `agents/` directory is plain,
//! hand-editable TOML — nothing here is hardcoded.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;

pub(crate) mod audit;
pub(crate) mod config;
pub(crate) mod credentials;
pub(crate) mod daily_usage;
pub(crate) mod kill_switch;
pub(crate) mod policy;
pub(crate) mod presentation;
pub(crate) mod providers;
pub(crate) mod run_loop;
pub(crate) mod run_store;
pub(crate) mod schedule;
pub(crate) mod tools;
pub(crate) mod trade_slot;

// Re-exports for `agent_commands.rs` (CLI glue, a later change): the pieces
// that module needs from each submodule without reaching through the full
// `agent::submodule::item` path everywhere. Unused until that module lands
// (tracked by the same `#[allow(dead_code)]` on `mod agent;` in lib.rs) —
// `unused_imports` isn't covered by that allow, so it's repeated here.
#[allow(unused_imports)]
pub(crate) use audit::{AuditActor, append as audit_append, verify_chain as audit_verify_chain};
#[allow(unused_imports)]
pub(crate) use config::{
    AgentDefinition, AgentsFile, PoliciesFile, PolicyProfile, ProviderProfile, ProvidersFile,
    ToolsFile, load_agents, load_policies, load_providers, load_tools, save_agents,
    save_policies, save_providers, save_tools,
};
#[allow(unused_imports)]
pub(crate) use kill_switch::KillSwitchState;
#[allow(unused_imports)]
pub(crate) use policy::{PolicyDecision, TradeProposal};
#[allow(unused_imports)]
pub(crate) use run_loop::{approve_run, cancel_run, reject_run, start_run};
#[allow(unused_imports)]
pub(crate) use run_store::{RunRecord, RunStatus};
#[allow(unused_imports)]
pub(crate) use schedule::ScheduleFormat;

/// `config_dir_path()/agents`, created 0700 on first use. Every TOML config
/// file, machine-written runtime state file, and lock file this subsystem
/// touches lives under this one directory.
pub(crate) fn agents_dir_path() -> Result<PathBuf> {
    let dir = crate::config::config_dir_path()?.join("agents");
    crate::config::ensure_private_dir(&dir)?;
    Ok(dir)
}

/// Current wall-clock time as a Unix epoch second count, saturating instead
/// of panicking on a clock before 1970 or a `u64` that overflows `i64`.
pub(crate) fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// All `AGENT_*` bail! prefixes used anywhere under `src/agent/**` and
/// (in a later change) `src/agent_commands.rs`. Centralized here, rather
/// than one per owning module, so `src/machine.rs`'s `classify_error` has a
/// single place to import them from — mirrors fix F19: every prefix here is
/// distinct and none of them re-emit an existing `LOCAL_TRADE_CONTROL:*`
/// substring verbatim.
pub(crate) const AGENT_LOCK_BUSY_PREFIX: &str = "AGENT_LOCK_BUSY:";
pub(crate) const AGENT_TRADE_SLOT_BUSY_PREFIX: &str = "AGENT_TRADE_SLOT_BUSY:";
pub(crate) const AGENT_KILL_SWITCH_ENGAGED_PREFIX: &str = "AGENT_KILL_SWITCH_ENGAGED:";
pub(crate) const AGENT_POLICY_BLOCKED_PREFIX: &str = "AGENT_POLICY_BLOCKED:";
pub(crate) const AGENT_POLICY_TRADE_CONTROL_VIOLATION_PREFIX: &str =
    "AGENT_POLICY_TRADE_CONTROL_VIOLATION:";
pub(crate) const AGENT_PROPOSAL_INVALID_PREFIX: &str = "AGENT_PROPOSAL_INVALID:";
pub(crate) const AGENT_PROVIDER_HTTP_ERROR_PREFIX: &str = "AGENT_PROVIDER_HTTP_ERROR:";
pub(crate) const AGENT_PROVIDER_AUTH_ERROR_PREFIX: &str = "AGENT_PROVIDER_AUTH_ERROR:";
pub(crate) const AGENT_PROVIDER_RATE_LIMITED_PREFIX: &str = "AGENT_PROVIDER_RATE_LIMITED:";
pub(crate) const AGENT_PROVIDER_RESPONSE_INVALID_PREFIX: &str =
    "AGENT_PROVIDER_RESPONSE_INVALID:";
pub(crate) const AGENT_RUN_NOT_FOUND_PREFIX: &str = "AGENT_RUN_NOT_FOUND:";
pub(crate) const AGENT_RUN_ALREADY_TERMINAL_PREFIX: &str = "AGENT_RUN_ALREADY_TERMINAL:";
pub(crate) const AGENT_RUN_ALREADY_ACTIVE_PREFIX: &str = "AGENT_RUN_ALREADY_ACTIVE:";
pub(crate) const AGENT_RUN_APPROVAL_EXPIRED_PREFIX: &str = "AGENT_RUN_APPROVAL_EXPIRED:";
pub(crate) const AGENT_NOT_FOUND_PREFIX: &str = "AGENT_NOT_FOUND:";
pub(crate) const AGENT_PROVIDER_NOT_FOUND_PREFIX: &str = "AGENT_PROVIDER_NOT_FOUND:";
pub(crate) const AGENT_POLICY_NOT_FOUND_PREFIX: &str = "AGENT_POLICY_NOT_FOUND:";

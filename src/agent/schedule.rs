//! Renders cron/systemd-timer/launchd/Task-Scheduler artifacts from an
//! `AgentDefinition.schedule` string (fix F11). `sc` remains a one-shot
//! synchronous binary with no in-process scheduler — this module only
//! prints the snippet an operator installs themselves (`crontab -e`,
//! `systemctl --user enable --now`, `launchctl load`, `schtasks /create`).

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ScheduleFormat {
    Cron,
    SystemdTimer,
    Launchd,
    TaskScheduler,
}

pub(crate) struct ScheduleArtifact {
    pub agent_id: String,
    pub format: ScheduleFormat,
    pub snippet: String,
    pub note: String,
}

/// `cron_expr` is `AgentDefinition.schedule` — an opaque, operator-authored
/// string never interpreted by an in-process scheduler.
pub(crate) fn export(agent_id: &str, _cron_expr: &str, _format: ScheduleFormat) -> Result<ScheduleArtifact> {
    bail!("agent schedule export not implemented, agent_id='{agent_id}'")
}

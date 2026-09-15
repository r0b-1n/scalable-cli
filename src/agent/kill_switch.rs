//! Global, always-fresh-read emergency stop. `load()` is called at the top
//! of every run-loop step and every policy evaluation — never cached, so
//! `sc agent kill-switch enable` takes effect on the very next step of
//! every in-flight run, including one already underway when the operator
//! engages it.

use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::config::write_private_file_atomic;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct KillSwitchState {
    pub engaged: bool,
    pub engaged_at_epoch: Option<i64>,
    pub reason: Option<String>,
    pub engaged_by: Option<String>,
}

fn state_path() -> Result<PathBuf> {
    Ok(super::agents_dir_path()?.join("kill_switch.json"))
}

/// Reads `agents/kill_switch.json` straight from disk on every call —
/// deliberately uncached, so a caller must invoke this fresh at each check
/// rather than holding a `KillSwitchState` across a step boundary. Defaults
/// to not-engaged when the file has never been written.
pub(crate) fn load() -> Result<KillSwitchState> {
    let path = state_path()?;
    if !path.exists() {
        return Ok(KillSwitchState::default());
    }
    let raw = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read {}", path.display()))?;
    serde_json::from_str(&raw).with_context(|| format!("Failed to parse {}", path.display()))
}

fn save(state: &KillSwitchState) -> Result<()> {
    let path = state_path()?;
    let rendered =
        serde_json::to_string_pretty(state).context("Failed to serialize kill switch state")?;
    write_private_file_atomic(&path, rendered.as_bytes())
}

/// Engages the kill switch, halting every in-flight and future agent run
/// from its very next step onward. `engaged_by` is a caller-supplied
/// identifier (e.g. `"cli"`) recorded for the audit trail as-is, not
/// verified against any identity system.
pub(crate) fn engage(reason: Option<String>, engaged_by: &str) -> Result<KillSwitchState> {
    let state = KillSwitchState {
        engaged: true,
        engaged_at_epoch: Some(super::now_epoch()),
        reason,
        engaged_by: Some(engaged_by.to_string()),
    };
    save(&state)?;
    Ok(state)
}

/// Disengages the kill switch, resetting to the not-engaged default so a
/// past incident's reason and actor don't linger into the next one.
pub(crate) fn disable() -> Result<KillSwitchState> {
    let state = KillSwitchState::default();
    save(&state)?;
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

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

    fn temp_config_dir() -> (TempDir, String) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let config_dir = tmp.path().to_string_lossy().to_string();
        (tmp, config_dir)
    }

    #[test]
    fn load_defaults_to_not_engaged_when_file_absent() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        let state = load().expect("load");
        assert!(!state.engaged);
        assert!(state.engaged_at_epoch.is_none());
        assert!(state.reason.is_none());
        assert!(state.engaged_by.is_none());
    }

    #[test]
    fn engage_persists_reason_timestamp_and_actor() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        let engaged = engage(Some("suspicious fills".to_string()), "operator@example.com")
            .expect("engage");
        assert!(engaged.engaged);
        assert_eq!(engaged.reason.as_deref(), Some("suspicious fills"));
        assert_eq!(engaged.engaged_by.as_deref(), Some("operator@example.com"));
        assert!(engaged.engaged_at_epoch.is_some());

        let reloaded = load().expect("load");
        assert_eq!(reloaded.engaged, engaged.engaged);
        assert_eq!(reloaded.reason, engaged.reason);
        assert_eq!(reloaded.engaged_by, engaged.engaged_by);
        assert_eq!(reloaded.engaged_at_epoch, engaged.engaged_at_epoch);
    }

    #[test]
    fn engage_with_no_reason_stores_none() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        let engaged = engage(None, "cli").expect("engage");
        assert!(engaged.reason.is_none());
        assert_eq!(engaged.engaged_by.as_deref(), Some("cli"));
    }

    #[test]
    fn disable_resets_to_default_state() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        engage(Some("incident".to_string()), "operator").expect("engage");
        let disabled = disable().expect("disable");
        assert!(!disabled.engaged);
        assert!(disabled.engaged_at_epoch.is_none());
        assert!(disabled.reason.is_none());
        assert!(disabled.engaged_by.is_none());

        let reloaded = load().expect("load");
        assert!(!reloaded.engaged);
    }

    #[test]
    fn disable_is_a_no_op_when_already_disengaged() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        let disabled = disable().expect("disable");
        assert!(!disabled.engaged);
    }

    /// Spec §8.1 rule 0: the kill switch is re-read fresh at every step, not
    /// cached across a run's lifetime. Simulate a run loop that checks
    /// `load()` at the top of two successive steps, with an operator
    /// engaging the switch strictly in between — the second step's check
    /// must observe it, exactly as if a live process had it happen mid-run.
    #[test]
    fn engaged_mid_run_is_observed_by_the_next_check() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        let step_one_check = load().expect("load before engage");
        assert!(!step_one_check.engaged, "run should start unblocked");

        engage(Some("operator halt".to_string()), "operator").expect("engage mid-run");

        let step_two_check = load().expect("load after engage");
        assert!(
            step_two_check.engaged,
            "the very next fresh read must observe the engage that happened between steps"
        );
    }

    #[test]
    fn re_engaging_overwrites_previous_reason_and_actor() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        engage(Some("first incident".to_string()), "operator-a").expect("first engage");
        let second = engage(Some("second incident".to_string()), "operator-b")
            .expect("second engage");
        assert_eq!(second.reason.as_deref(), Some("second incident"));
        assert_eq!(second.engaged_by.as_deref(), Some("operator-b"));

        let reloaded = load().expect("load");
        assert_eq!(reloaded.reason.as_deref(), Some("second incident"));
        assert_eq!(reloaded.engaged_by.as_deref(), Some("operator-b"));
    }
}

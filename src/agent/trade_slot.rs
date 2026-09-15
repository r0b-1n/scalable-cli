//! System-wide (per-env) advisory single-trade-in-flight reservation (fix
//! F8). `trade_confirmation.json`/`trade_attempt.json` are single-slot,
//! unlocked, process-wide files; every phase-1 caller, human or agent,
//! must hold this slot before calling `execute_broker_trade_buy`/`sell`
//! with `confirm: None`, so a second phase-1 call anywhere in the system
//! can never silently destroy another run's pending confirmation.
//!
//! The slot is a plain JSON file guarded by its own lock file (via
//! [`crate::config::with_exclusive_file_lock`]), not an in-process mutex —
//! it must serialize callers across separate `sc` invocations, since `sc`
//! is a synchronous, one-shot binary and a paused agent run's reservation
//! has to survive the process that created it exiting. A holder is
//! considered stale once `expires_at_epoch` has passed, so a crashed or
//! killed process (which never gets to call `release`) cannot wedge the
//! slot beyond its TTL — the next caller, whoever it is, simply takes over.

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

use crate::agent::AGENT_TRADE_SLOT_BUSY_PREFIX;
use crate::config::{TargetEnv, with_exclusive_file_lock, write_private_file_atomic};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct TradeSlotState {
    /// `"manual"` or `"agent:<agent_id>:<run_id>"`.
    pub holder: String,
    pub acquired_at_epoch: i64,
    /// Mirrors `CONFIRMATION_TTL_SECONDS` (900s) — the stale-holder cutoff:
    /// past this epoch the holder recorded here no longer blocks anyone.
    pub expires_at_epoch: i64,
}

fn slot_path(env: TargetEnv) -> Result<std::path::PathBuf> {
    Ok(super::agents_dir_path()?.join(format!("trade_slot.{}.json", env.as_str())))
}

fn lock_path() -> Result<std::path::PathBuf> {
    Ok(super::agents_dir_path()?.join("trade_slot.lock"))
}

fn read_state(path: &std::path::Path) -> Option<TradeSlotState> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

/// Acquires the slot for `holder`, or fails with `AGENT_TRADE_SLOT_BUSY:`
/// if a different, unexpired holder already has it. An expired holder —
/// stale because its process died, or its 900s TTL simply ran out without
/// an explicit `release` — is silently overwritten: the resource actually
/// being protected (`trade_confirmation.json`'s single pending slot) is
/// itself only valid for that same TTL, so there is nothing left to guard
/// once it has passed. Re-acquiring with the same `holder` that already
/// holds the slot refreshes its expiry rather than being treated as
/// contention.
pub(crate) fn try_acquire(
    env: TargetEnv,
    holder: &str,
    now_epoch: i64,
    ttl_secs: i64,
) -> Result<()> {
    with_exclusive_file_lock(&lock_path()?, true, || {
        let path = slot_path(env)?;
        if let Some(existing) = read_state(&path)
            && existing.holder != holder
            && existing.expires_at_epoch > now_epoch
        {
            bail!(
                "{AGENT_TRADE_SLOT_BUSY_PREFIX} trade slot is held by '{}' until epoch {} \
                 (only one trade preview/confirmation may be in flight per environment)",
                existing.holder,
                existing.expires_at_epoch
            );
        }
        let next = TradeSlotState {
            holder: holder.to_string(),
            acquired_at_epoch: now_epoch,
            expires_at_epoch: now_epoch + ttl_secs,
        };
        write_private_file_atomic(&path, serde_json::to_string_pretty(&next)?.as_bytes())
    })
}

/// Releases the slot iff still held by `holder` (no-op otherwise — an
/// already-expired or reassigned slot is left alone, and a missing slot
/// file is not an error).
pub(crate) fn release(env: TargetEnv, holder: &str) -> Result<()> {
    with_exclusive_file_lock(&lock_path()?, true, || {
        let path = slot_path(env)?;
        if let Some(existing) = read_state(&path)
            && existing.holder == holder
        {
            let _ = std::fs::remove_file(&path);
        }
        Ok(())
    })
}

/// RAII handle for a slot reservation whose lifetime is a single Rust
/// value rather than a run's whole, possibly multi-process lifespan. The
/// run loop and the manual trade dispatch (§7.2, §3.5) hold the slot
/// explicitly across process boundaries via the bare [`try_acquire`]/
/// [`release`] functions instead — this guard is for shorter-lived,
/// single-process holds (tests included), where "release when this value
/// goes out of scope, even on an early return" is the behavior wanted.
pub(crate) struct TradeSlotGuard {
    env: TargetEnv,
    holder: String,
    released: bool,
}

impl TradeSlotGuard {
    /// Acquires the slot and ties its release to the returned guard's
    /// lifetime.
    pub(crate) fn acquire(
        env: TargetEnv,
        holder: impl Into<String>,
        now_epoch: i64,
        ttl_secs: i64,
    ) -> Result<Self> {
        let holder = holder.into();
        try_acquire(env, &holder, now_epoch, ttl_secs)?;
        Ok(Self { env, holder, released: false })
    }

    pub(crate) fn holder(&self) -> &str {
        &self.holder
    }

    /// Releases the slot now instead of waiting for `Drop`, surfacing any
    /// I/O error instead of the silent best-effort release `Drop` falls
    /// back to.
    pub(crate) fn release(mut self) -> Result<()> {
        self.released = true;
        release(self.env, &self.holder)
    }
}

impl Drop for TradeSlotGuard {
    fn drop(&mut self) {
        if !self.released {
            let _ = release(self.env, &self.holder);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn acquire_on_an_empty_slot_succeeds() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        try_acquire(TargetEnv::Dev, "manual", 1_000, 900).expect("acquire");

        let state = read_state(&slot_path(TargetEnv::Dev).unwrap()).expect("state written");
        assert_eq!(state.holder, "manual");
        assert_eq!(state.acquired_at_epoch, 1_000);
        assert_eq!(state.expires_at_epoch, 1_900);
    }

    #[test]
    fn second_acquire_by_a_different_holder_before_expiry_fails_busy() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        try_acquire(TargetEnv::Dev, "manual", 1_000, 900).expect("first acquire");

        let err = try_acquire(TargetEnv::Dev, "agent:momentum:run_1", 1_100, 900)
            .expect_err("second holder must be refused while the first is still live");
        let message = err.to_string();
        assert!(message.starts_with(AGENT_TRADE_SLOT_BUSY_PREFIX));
        assert!(message.contains("manual"));
        assert!(message.contains("1900"));
    }

    #[test]
    fn reacquiring_with_the_same_holder_refreshes_the_expiry_instead_of_failing() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        try_acquire(TargetEnv::Dev, "manual", 1_000, 900).expect("first acquire");
        try_acquire(TargetEnv::Dev, "manual", 1_500, 900).expect("same holder re-acquires");

        let state = read_state(&slot_path(TargetEnv::Dev).unwrap()).expect("state written");
        assert_eq!(state.acquired_at_epoch, 1_500);
        assert_eq!(state.expires_at_epoch, 2_400);
    }

    #[test]
    fn a_different_holder_succeeds_once_the_prior_reservation_has_expired() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        try_acquire(TargetEnv::Dev, "manual", 1_000, 900).expect("first acquire");

        // now_epoch == expires_at_epoch is not "still live": a strictly
        // later now_epoch demonstrates the boundary unambiguously.
        try_acquire(TargetEnv::Dev, "agent:momentum:run_1", 1_901, 900)
            .expect("expired holder must not block a new one");

        let state = read_state(&slot_path(TargetEnv::Dev).unwrap()).expect("state written");
        assert_eq!(state.holder, "agent:momentum:run_1");
    }

    #[test]
    fn release_by_the_holder_clears_the_slot() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        try_acquire(TargetEnv::Dev, "manual", 1_000, 900).expect("acquire");
        release(TargetEnv::Dev, "manual").expect("release");

        assert!(read_state(&slot_path(TargetEnv::Dev).unwrap()).is_none());

        // A second, different holder no longer has to wait out the TTL.
        try_acquire(TargetEnv::Dev, "agent:momentum:run_1", 1_001, 900)
            .expect("slot is free immediately after release");
    }

    #[test]
    fn release_by_a_non_holder_is_a_no_op() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        try_acquire(TargetEnv::Dev, "manual", 1_000, 900).expect("acquire");
        release(TargetEnv::Dev, "agent:momentum:run_1").expect("release by non-holder is Ok");

        let state = read_state(&slot_path(TargetEnv::Dev).unwrap()).expect("slot untouched");
        assert_eq!(state.holder, "manual");
    }

    #[test]
    fn release_with_no_slot_file_present_is_ok() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        release(TargetEnv::Dev, "manual").expect("releasing an absent slot is not an error");
    }

    #[test]
    fn dev_and_prod_slots_are_independent() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        try_acquire(TargetEnv::Dev, "manual", 1_000, 900).expect("dev acquire");
        try_acquire(TargetEnv::Prod, "agent:momentum:run_1", 1_000, 900).expect("prod acquire");

        let dev_state = read_state(&slot_path(TargetEnv::Dev).unwrap()).expect("dev state");
        let prod_state = read_state(&slot_path(TargetEnv::Prod).unwrap()).expect("prod state");
        assert_eq!(dev_state.holder, "manual");
        assert_eq!(prod_state.holder, "agent:momentum:run_1");
    }

    #[test]
    fn guard_releases_the_slot_on_drop() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        {
            let slot = TradeSlotGuard::acquire(TargetEnv::Dev, "manual", 1_000, 900)
                .expect("guard acquire");
            assert_eq!(slot.holder(), "manual");
            assert!(read_state(&slot_path(TargetEnv::Dev).unwrap()).is_some());
        }

        assert!(
            read_state(&slot_path(TargetEnv::Dev).unwrap()).is_none(),
            "dropping the guard must release the slot"
        );
    }

    #[test]
    fn guard_explicit_release_reports_errors_and_skips_drops_second_attempt() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        let slot =
            TradeSlotGuard::acquire(TargetEnv::Dev, "manual", 1_000, 900).expect("guard acquire");
        slot.release().expect("explicit release");

        assert!(read_state(&slot_path(TargetEnv::Dev).unwrap()).is_none());

        // A second holder can take the slot right away; the guard's Drop
        // (already run above, since `release` consumed `self`) must not
        // have raced or re-fired to clobber it.
        try_acquire(TargetEnv::Dev, "agent:momentum:run_1", 1_001, 900)
            .expect("slot free after explicit release");
        let state = read_state(&slot_path(TargetEnv::Dev).unwrap()).expect("state written");
        assert_eq!(state.holder, "agent:momentum:run_1");
    }

    #[test]
    fn guard_dropped_after_a_second_holder_took_over_does_not_evict_them() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        let slot =
            TradeSlotGuard::acquire(TargetEnv::Dev, "manual", 1_000, 900).expect("guard acquire");
        // Simulate the manual holder's reservation expiring and a second
        // caller taking the slot before the first guard is ever dropped.
        try_acquire(TargetEnv::Dev, "agent:momentum:run_1", 1_901, 900)
            .expect("second holder takes over after expiry");

        drop(slot);

        let state = read_state(&slot_path(TargetEnv::Dev).unwrap())
            .expect("second holder's reservation must survive the first guard's drop");
        assert_eq!(state.holder, "agent:momentum:run_1");
    }
}

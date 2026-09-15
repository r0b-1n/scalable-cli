//! Hash-chained, append-only audit ledger (fix F9). Every append happens
//! under one held lock spanning the whole read-tail-hash → append critical
//! section, so no two processes can ever read the same tail and both
//! append from it. Reuses the crate's own `checksum_for_payload` primitive
//! verbatim rather than a new hashing scheme.
//!
//! Honest scope note: this chain detects accidental corruption and
//! concurrent-write forking. It is not a substitute for an external,
//! append-only log shipper if the threat model includes a compromised host
//! with local write access to `config_dir_path()`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::{TargetEnv, with_exclusive_file_lock};
use crate::payload_fingerprint::checksum_for_payload;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) enum AuditActor {
    Agent,
    Policy,
    Human,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct AuditRecord {
    pub seq: u64,
    pub prev_hash: String,
    pub hash: String,
    pub at_epoch: i64,
    pub run_id: Option<String>,
    pub agent_id: Option<String>,
    pub actor: AuditActor,
    pub event: String,
    pub detail: Value,
}

/// `prev_hash` of the very first record ever appended to a log.
const GENESIS_HASH: &str = "genesis";

fn lock_path() -> Result<PathBuf> {
    Ok(super::agents_dir_path()?.join("audit.lock"))
}

fn log_path(env: TargetEnv) -> Result<PathBuf> {
    Ok(super::agents_dir_path()?.join(format!("audit.{}.jsonl", env.as_str())))
}

/// The JSON shape a record's `hash` is a checksum of: the chain link
/// (`prev_hash`, named `prev` here) plus every record field except `hash`
/// itself. `append` and `verify_chain` both build this from an
/// `AuditRecord` through this one function, so the two can never
/// independently drift into hashing different fields.
fn hash_payload(record: &AuditRecord) -> Value {
    serde_json::json!({
        "prev": record.prev_hash,
        "record": {
            "seq": record.seq,
            "at_epoch": record.at_epoch,
            "run_id": record.run_id,
            "agent_id": record.agent_id,
            "event": record.event,
            "detail": record.detail,
        },
    })
}

/// Every record in `path`, oldest first, in append order. A missing file
/// (nothing ever appended to this env's log) is an empty ledger, not an
/// error.
fn read_all(path: &Path) -> Result<Vec<AuditRecord>> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err).with_context(|| format!("Failed to read {}", path.display())),
    };
    raw.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str(line)
                .with_context(|| format!("Failed to parse a record in {}", path.display()))
        })
        .collect()
}

/// The last record in `path`, if any — the tail `append` chains its new
/// record onto.
fn read_tail(path: &Path) -> Result<Option<AuditRecord>> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err).with_context(|| format!("Failed to read {}", path.display())),
    };
    raw.lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str(line)
                .with_context(|| format!("Failed to parse the tail record in {}", path.display()))
        })
        .transpose()
}

/// Appends one record to `audit.<env>.jsonl` under `audit.lock`, chaining
/// its `hash` from the previous line's `hash` (or `"genesis"` for the
/// first line ever written). The read-tail-hash step and the append
/// itself happen inside one held lock acquisition so two processes can
/// never both read the same tail and append from it (fix F9) — that
/// would fork the chain into two branches sharing a `prev_hash`, with
/// nothing in either branch able to tell which one is real.
pub(crate) fn append(
    env: TargetEnv,
    run_id: Option<&str>,
    agent_id: Option<&str>,
    actor: AuditActor,
    event: &str,
    detail: Value,
) -> Result<AuditRecord> {
    let path = log_path(env)?;
    with_exclusive_file_lock(&lock_path()?, true, || {
        let (prev_hash, seq) = match read_tail(&path)? {
            Some(tail) => (tail.hash, tail.seq + 1),
            None => (GENESIS_HASH.to_string(), 0),
        };

        let mut record = AuditRecord {
            seq,
            prev_hash,
            hash: String::new(),
            at_epoch: super::now_epoch(),
            run_id: run_id.map(str::to_string),
            agent_id: agent_id.map(str::to_string),
            actor,
            event: event.to_string(),
            detail,
        };
        record.hash = checksum_for_payload(&hash_payload(&record));

        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .with_context(|| format!("Failed to open {}", path.display()))?;
        writeln!(file, "{}", serde_json::to_string(&record)?)
            .with_context(|| format!("Failed to append to {}", path.display()))?;
        Ok(record)
    })
}

/// Records matching `agent_id`/`run_id` (an absent filter matches
/// everything), oldest first. `limit`, when given, keeps only the most
/// recently appended matches — the tail of the filtered list, not a cap
/// on how far back the scan looks.
pub(crate) fn list(
    env: TargetEnv,
    agent_id: Option<&str>,
    run_id: Option<&str>,
    limit: Option<usize>,
) -> Result<Vec<AuditRecord>> {
    let path = log_path(env)?;
    let mut records = with_exclusive_file_lock(&lock_path()?, true, || read_all(&path))?;
    if let Some(agent_id) = agent_id {
        records.retain(|record| record.agent_id.as_deref() == Some(agent_id));
    }
    if let Some(run_id) = run_id {
        records.retain(|record| record.run_id.as_deref() == Some(run_id));
    }
    if let Some(limit) = limit {
        let start = records.len().saturating_sub(limit);
        records.drain(..start);
    }
    Ok(records)
}

/// The single record at `seq`, or `None` if the ledger has no such entry
/// (never written, or `env`'s log is empty).
pub(crate) fn get_by_seq(env: TargetEnv, seq: u64) -> Result<Option<AuditRecord>> {
    let path = log_path(env)?;
    let records = with_exclusive_file_lock(&lock_path()?, true, || read_all(&path))?;
    Ok(records.into_iter().find(|record| record.seq == seq))
}

/// Walks every line, recomputing each record's `hash` from `{prev,
/// record}` and checking it both against that record's own stored `hash`
/// (catches content tampering) and against the previous record's already-
/// verified `hash` (catches reordering, deletion, or a forked
/// concurrent write). Returns `Ok(json!({"ok": true}))` or
/// `Ok(json!({"ok": false, "broken_at_seq": n}))` — a legitimate `Ok`
/// result, never an `anyhow::Err`, so `sc agent audit verify --json` lets
/// a CI/regulator check assert on `data.ok` directly, even against a log
/// containing a line so corrupted it no longer parses. An empty or
/// absent log verifies clean.
pub(crate) fn verify_chain(env: TargetEnv) -> Result<Value> {
    let path = log_path(env)?;
    with_exclusive_file_lock(&lock_path()?, true, || {
        let raw = match fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Ok(serde_json::json!({ "ok": true }));
            }
            Err(err) => {
                return Err(err).with_context(|| format!("Failed to read {}", path.display()));
            }
        };

        let mut expected_prev_hash = GENESIS_HASH.to_string();
        let mut next_seq = 0u64;
        for line in raw.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let record: AuditRecord = match serde_json::from_str(line) {
                Ok(record) => record,
                Err(_) => {
                    return Ok(serde_json::json!({ "ok": false, "broken_at_seq": next_seq }));
                }
            };
            let recomputed = checksum_for_payload(&hash_payload(&record));
            if record.prev_hash != expected_prev_hash || recomputed != record.hash {
                return Ok(serde_json::json!({ "ok": false, "broken_at_seq": record.seq }));
            }
            expected_prev_hash.clone_from(&record.hash);
            next_seq = record.seq + 1;
        }
        Ok(serde_json::json!({ "ok": true }))
    })
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
    fn verify_on_an_absent_log_is_ok() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        let result = verify_chain(TargetEnv::Dev).expect("verify");
        assert_eq!(result, serde_json::json!({ "ok": true }));
    }

    #[test]
    fn append_chains_hashes_and_verify_reports_clean() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        let first = append(
            TargetEnv::Dev,
            None,
            Some("momentum-eu-etfs"),
            AuditActor::System,
            "run_started",
            serde_json::json!({ "n": 0 }),
        )
        .expect("first append");
        assert_eq!(first.seq, 0);
        assert_eq!(first.prev_hash, GENESIS_HASH);

        let second = append(
            TargetEnv::Dev,
            Some("run_1"),
            Some("momentum-eu-etfs"),
            AuditActor::Policy,
            "phase1_preview",
            serde_json::json!({ "n": 1 }),
        )
        .expect("second append");
        assert_eq!(second.seq, 1);
        assert_eq!(second.prev_hash, first.hash);
        assert_ne!(second.hash, first.hash);

        let result = verify_chain(TargetEnv::Dev).expect("verify");
        assert_eq!(result, serde_json::json!({ "ok": true }));
    }

    #[test]
    fn get_by_seq_finds_the_matching_record_and_none_otherwise() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        append(
            TargetEnv::Dev,
            None,
            None,
            AuditActor::System,
            "run_started",
            serde_json::json!({}),
        )
        .expect("append");

        let found = get_by_seq(TargetEnv::Dev, 0).expect("get").expect("seq 0 exists");
        assert_eq!(found.event, "run_started");
        assert!(get_by_seq(TargetEnv::Dev, 1).expect("get").is_none());
    }

    #[test]
    fn list_filters_by_agent_and_run_and_applies_a_trailing_limit() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        append(
            TargetEnv::Dev,
            Some("run_1"),
            Some("agent-a"),
            AuditActor::Agent,
            "proposal",
            serde_json::json!({}),
        )
        .expect("append 0");
        append(
            TargetEnv::Dev,
            Some("run_1"),
            Some("agent-a"),
            AuditActor::Policy,
            "phase1_preview",
            serde_json::json!({}),
        )
        .expect("append 1");
        append(
            TargetEnv::Dev,
            Some("run_2"),
            Some("agent-b"),
            AuditActor::Agent,
            "proposal",
            serde_json::json!({}),
        )
        .expect("append 2");

        let for_agent_a = list(TargetEnv::Dev, Some("agent-a"), None, None).expect("list");
        assert_eq!(for_agent_a.iter().map(|r| r.seq).collect::<Vec<_>>(), vec![0, 1]);

        let for_run_1 = list(TargetEnv::Dev, None, Some("run_1"), None).expect("list");
        assert_eq!(for_run_1.iter().map(|r| r.seq).collect::<Vec<_>>(), vec![0, 1]);

        let last_one = list(TargetEnv::Dev, None, None, Some(1)).expect("list");
        assert_eq!(last_one.iter().map(|r| r.seq).collect::<Vec<_>>(), vec![2]);

        let everything = list(TargetEnv::Dev, None, None, None).expect("list");
        assert_eq!(everything.len(), 3);
    }

    #[test]
    fn tampering_with_a_middle_record_is_caught_at_its_own_seq() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        for n in 0..3 {
            append(
                TargetEnv::Dev,
                None,
                None,
                AuditActor::System,
                "step",
                serde_json::json!({ "n": n }),
            )
            .expect("append");
        }

        let path = log_path(TargetEnv::Dev).expect("log path");
        let raw = fs::read_to_string(&path).expect("read log");
        let mut lines: Vec<String> = raw.lines().map(str::to_string).collect();
        assert_eq!(lines.len(), 3);
        // Flip the middle record's `detail` without touching its stored
        // `hash`, exactly what "hand-corrupting" a line looks like.
        lines[1] = lines[1].replace("\"n\":1", "\"n\":999");
        assert_ne!(lines[1], raw.lines().nth(1).unwrap());
        fs::write(&path, format!("{}\n", lines.join("\n"))).expect("write tampered log");

        let result = verify_chain(TargetEnv::Dev).expect("verify");
        assert_eq!(result, serde_json::json!({ "ok": false, "broken_at_seq": 1 }));
    }

    #[test]
    fn tampering_with_the_chain_link_is_caught_even_when_the_forged_record_is_self_consistent() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        for n in 0..3 {
            append(
                TargetEnv::Dev,
                None,
                None,
                AuditActor::System,
                "step",
                serde_json::json!({ "n": n }),
            )
            .expect("append");
        }

        // Forge a replacement for the middle record whose own hash is
        // internally consistent (as if an attacker recomputed it after
        // editing `detail`), but which no longer chains from the first
        // record's real hash — simulating a rewritten/reordered entry
        // rather than a naive field edit.
        let path = log_path(TargetEnv::Dev).expect("log path");
        let records = read_all(&path).expect("read records");
        let mut forged = records[1].clone();
        forged.detail = serde_json::json!({ "n": 999 });
        forged.prev_hash = "not-the-real-parent-hash".to_string();
        forged.hash = checksum_for_payload(&hash_payload(&forged));

        let raw = fs::read_to_string(&path).expect("read log");
        let mut lines: Vec<String> = raw.lines().map(str::to_string).collect();
        lines[1] = serde_json::to_string(&forged).expect("serialize forged record");
        fs::write(&path, format!("{}\n", lines.join("\n"))).expect("write tampered log");

        let result = verify_chain(TargetEnv::Dev).expect("verify");
        assert_eq!(result, serde_json::json!({ "ok": false, "broken_at_seq": 1 }));
    }

    #[test]
    fn concurrent_appends_from_multiple_threads_never_fork_the_chain() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        append(
            TargetEnv::Dev,
            None,
            None,
            AuditActor::System,
            "existing",
            serde_json::json!({}),
        )
        .expect("seed append");

        const THREAD_COUNT: usize = 16;
        let handles: Vec<_> = (0..THREAD_COUNT)
            .map(|i| {
                std::thread::spawn(move || {
                    append(
                        TargetEnv::Dev,
                        None,
                        Some(&format!("agent-{i}")),
                        AuditActor::Agent,
                        "concurrent_event",
                        serde_json::json!({ "i": i }),
                    )
                    .expect("concurrent append must not fail under contention")
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("worker thread panicked");
        }

        let result = verify_chain(TargetEnv::Dev).expect("verify");
        assert_eq!(result, serde_json::json!({ "ok": true }));

        let records = list(TargetEnv::Dev, None, None, None).expect("list");
        assert_eq!(records.len(), THREAD_COUNT + 1);
        let mut seqs: Vec<u64> = records.iter().map(|r| r.seq).collect();
        seqs.sort_unstable();
        let expected: Vec<u64> = (0..(THREAD_COUNT + 1) as u64).collect();
        assert_eq!(
            seqs, expected,
            "every seq from 0..N must appear exactly once with no forked branch"
        );
    }
}

//! Per-agent, per-day locked usage counters (fix F14). Incremented only
//! after a successful phase-2 submit — a failed or rejected proposal never
//! counts against `policy.max_orders_per_day`/`max_daily_notional`.
//!
//! The calendar day that keys these counters is fixed at UTC (`today()`),
//! never the host machine's local timezone: a run loop and the CLI process
//! reading its usage back must agree on when "today" rolls over regardless
//! of where either one runs, and a UTC boundary is free of the ambiguity a
//! DST transition or an admin-configured local zone would otherwise add.
//! Every read-modify-write here is a load, mutate, save cycle wrapped in
//! [`crate::config::with_exclusive_file_lock`] on one shared lock file for
//! the whole `daily_usage/` tree: two concurrent runs racing to submit
//! against the same cap must never both observe the pre-increment count,
//! since that is a real-money overspend past `max_orders_per_day`/
//! `max_daily_notional`, not a cosmetic double-count.

use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct DailyUsage {
    pub orders_count: u32,
    pub notional_submitted: String,
}

/// Today's date at UTC. The single place the run loop and policy engine
/// should call to decide which `daily_usage/<agent_id>/<date>.json` file
/// governs the current step, so both agree on the same day boundary.
/// Derived from [`super::now_epoch`] (`std::time::SystemTime`) rather than
/// `chrono::Utc::now()`, since this crate builds `chrono` without its
/// `clock` feature.
pub(crate) fn today() -> chrono::NaiveDate {
    date_for_epoch(super::now_epoch())
}

fn date_for_epoch(epoch_seconds: i64) -> chrono::NaiveDate {
    chrono::DateTime::from_timestamp(epoch_seconds, 0)
        .map(|dt| dt.date_naive())
        .unwrap_or(chrono::NaiveDate::MAX)
}

fn usage_path(agent_id: &str, date: chrono::NaiveDate) -> Result<PathBuf> {
    Ok(super::agents_dir_path()?
        .join("daily_usage")
        .join(agent_id)
        .join(format!("{date}.json")))
}

fn lock_path() -> Result<PathBuf> {
    Ok(super::agents_dir_path()?.join("daily_usage.lock"))
}

fn load_unlocked(agent_id: &str, date: chrono::NaiveDate) -> Result<DailyUsage> {
    let path = usage_path(agent_id, date)?;
    if !path.exists() {
        return Ok(DailyUsage::default());
    }

    let raw = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read daily usage store {}", path.display()))?;
    serde_json::from_str::<DailyUsage>(&raw)
        .with_context(|| format!("Invalid daily usage JSON at {}", path.display()))
}

fn save_unlocked(agent_id: &str, date: chrono::NaiveDate, usage: &DailyUsage) -> Result<()> {
    let path = usage_path(agent_id, date)?;
    let serialized = serde_json::to_string_pretty(usage)?;
    crate::config::write_private_file_atomic(&path, serialized.as_bytes())
        .with_context(|| format!("Failed to write daily usage store {}", path.display()))
}

/// Reads today's-or-any-day's usage for `agent_id`, defaulting to zero
/// counters for a day with no recorded submissions yet. Still taken under
/// the shared lock (not a bare read) so a policy check can never observe a
/// half-written file from a concurrent `record_submitted`.
pub(crate) fn load(agent_id: &str, date: chrono::NaiveDate) -> Result<DailyUsage> {
    crate::config::with_exclusive_file_lock(&lock_path()?, true, || {
        load_unlocked(agent_id, date)
    })
}

/// Adds one order and `notional_added` to `agent_id`'s usage for `date`,
/// atomically with respect to every other `record_submitted`/`load` call
/// system-wide: the whole load-mutate-save cycle runs inside a single
/// `with_exclusive_file_lock` acquisition, so two threads or processes
/// racing to submit the last order under a cap always see each other's
/// increment rather than both reading the same pre-increment count.
pub(crate) fn record_submitted(
    agent_id: &str,
    date: chrono::NaiveDate,
    notional_added: &str,
) -> Result<DailyUsage> {
    crate::config::with_exclusive_file_lock(&lock_path()?, true, || {
        let mut usage = load_unlocked(agent_id, date)?;
        usage.orders_count += 1;
        usage.notional_submitted = add_decimal_strs(&usage.notional_submitted, notional_added);
        save_unlocked(agent_id, date, &usage)?;
        Ok(usage)
    })
}

/// Adds two non-negative fixed-point decimal strings (order notional
/// amounts) as exact digit arithmetic — money accumulated across a day's
/// worth of orders must never pick up binary-float rounding error, which a
/// `str -> f64 -> str` round-trip would risk. Never fails: an empty or
/// malformed operand (there should be none in practice — both sides
/// originate from already-validated proposal/config data) is defensively
/// read as zero rather than propagating an error into a submit path whose
/// caller cannot un-submit the order that just succeeded.
fn add_decimal_strs(left: &str, right: &str) -> String {
    let (left_int, left_frac) = split_unsigned_decimal(left);
    let (right_int, right_frac) = split_unsigned_decimal(right);

    let frac_len = left_frac.len().max(right_frac.len());
    let left_frac = pad_right(&left_frac, frac_len);
    let right_frac = pad_right(&right_frac, frac_len);

    let int_len = left_int.len().max(right_int.len());
    let left_int = pad_left(&left_int, int_len);
    let right_int = pad_left(&right_int, int_len);

    let left_digits = format!("{left_int}{left_frac}");
    let right_digits = format!("{right_int}{right_frac}");
    let sum_digits = add_digit_strs(&left_digits, &right_digits);

    let split_at = sum_digits.len() - frac_len;
    let (integer_part, fraction_part) = sum_digits.split_at(split_at);
    let integer_part = integer_part.trim_start_matches('0');
    let integer_part = if integer_part.is_empty() {
        "0"
    } else {
        integer_part
    };

    if fraction_part.is_empty() {
        integer_part.to_string()
    } else {
        format!("{integer_part}.{fraction_part}")
    }
}

/// Splits a decimal string into its unsigned integer and fraction digit
/// runs, discarding anything that is not an ASCII digit (a sign included —
/// notional amounts are never negative). `"12.50"` -> `("12", "50")`,
/// `""` -> `("0", "")`.
fn split_unsigned_decimal(raw: &str) -> (String, String) {
    let mut parts = raw.splitn(2, '.');
    let integer_digits: String = parts
        .next()
        .unwrap_or_default()
        .chars()
        .filter(char::is_ascii_digit)
        .collect();
    let fraction_digits: String = parts
        .next()
        .unwrap_or_default()
        .chars()
        .filter(char::is_ascii_digit)
        .collect();

    let integer_digits = if integer_digits.is_empty() {
        "0".to_string()
    } else {
        integer_digits
    };
    (integer_digits, fraction_digits)
}

fn pad_left(digits: &str, width: usize) -> String {
    format!("{digits:0>width$}")
}

fn pad_right(digits: &str, width: usize) -> String {
    format!("{digits:0<width$}")
}

/// Adds two equal-length ASCII-digit strings as plain unsigned integers,
/// returning a digit string one byte longer when the addition carries out
/// of the most significant digit.
fn add_digit_strs(left: &str, right: &str) -> String {
    debug_assert_eq!(left.len(), right.len());
    let left = left.as_bytes();
    let right = right.as_bytes();

    let mut result = Vec::with_capacity(left.len() + 1);
    let mut carry = 0u8;
    for index in (0..left.len()).rev() {
        let sum = (left[index] - b'0') + (right[index] - b'0') + carry;
        result.push(b'0' + sum % 10);
        carry = sum / 10;
    }
    if carry > 0 {
        result.push(b'0' + carry);
    }
    result.reverse();
    String::from_utf8(result).expect("digit bytes are always valid ASCII/UTF-8")
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

    fn a_date() -> chrono::NaiveDate {
        chrono::NaiveDate::from_ymd_opt(2026, 9, 15).unwrap()
    }

    #[test]
    fn add_decimal_strs_handles_the_spec_example() {
        assert_eq!(add_decimal_strs("", "1980.00"), "1980.00");
    }

    #[test]
    fn add_decimal_strs_aligns_mismatched_fraction_lengths() {
        assert_eq!(add_decimal_strs("10.5", "0.25"), "10.75");
    }

    #[test]
    fn add_decimal_strs_carries_across_the_decimal_point() {
        assert_eq!(add_decimal_strs("999.99", "0.01"), "1000.00");
    }

    #[test]
    fn add_decimal_strs_trims_leading_zeros_in_the_result() {
        assert_eq!(add_decimal_strs("007", "3"), "10");
    }

    #[test]
    fn add_decimal_strs_treats_a_bare_integer_as_zero_fraction() {
        assert_eq!(add_decimal_strs("100", "50"), "150");
    }

    #[test]
    fn add_decimal_strs_is_infallible_on_garbage_input() {
        assert_eq!(add_decimal_strs("not-a-number", ""), "0");
    }

    #[test]
    fn today_derives_the_utc_calendar_day_from_an_epoch_second() {
        // 2024-01-01T00:00:00Z, one second before, and one second after —
        // the UTC date must roll over exactly at the epoch second boundary,
        // not at some locale-shifted instant.
        assert_eq!(
            date_for_epoch(1_704_067_200),
            chrono::NaiveDate::from_ymd_opt(2024, 1, 1).unwrap()
        );
        assert_eq!(
            date_for_epoch(1_704_067_199),
            chrono::NaiveDate::from_ymd_opt(2023, 12, 31).unwrap()
        );
    }

    #[test]
    fn load_defaults_to_zero_when_no_file_has_ever_been_written() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        let usage = load("momentum-eu-etfs", a_date()).expect("load");
        assert_eq!(usage.orders_count, 0);
        assert_eq!(usage.notional_submitted, "");
    }

    #[test]
    fn record_submitted_increments_and_persists() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        let after_first = record_submitted("momentum-eu-etfs", a_date(), "1980.00").expect("first");
        assert_eq!(after_first.orders_count, 1);
        assert_eq!(after_first.notional_submitted, "1980.00");

        let after_second =
            record_submitted("momentum-eu-etfs", a_date(), "20.00").expect("second");
        assert_eq!(after_second.orders_count, 2);
        assert_eq!(after_second.notional_submitted, "2000.00");

        let reloaded = load("momentum-eu-etfs", a_date()).expect("reload");
        assert_eq!(reloaded.orders_count, 2);
        assert_eq!(reloaded.notional_submitted, "2000.00");
    }

    #[test]
    fn different_agents_and_different_days_are_independent() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        record_submitted("agent-a", a_date(), "100.00").expect("agent-a");
        record_submitted("agent-b", a_date(), "50.00").expect("agent-b");
        let other_day = a_date().succ_opt().unwrap();
        record_submitted("agent-a", other_day, "5.00").expect("agent-a other day");

        assert_eq!(
            load("agent-a", a_date()).unwrap().notional_submitted,
            "100.00"
        );
        assert_eq!(
            load("agent-b", a_date()).unwrap().notional_submitted,
            "50.00"
        );
        assert_eq!(
            load("agent-a", other_day).unwrap().notional_submitted,
            "5.00"
        );
    }

    #[test]
    fn concurrent_record_submitted_never_loses_an_increment() {
        let _lock = crate::lock_test_env();
        let (_tmp, config_dir) = temp_config_dir();
        let _guard = EnvGuard::set("SC_CONFIG_DIR", config_dir);

        const THREAD_COUNT: usize = 16;
        let date = a_date();

        let handles: Vec<_> = (0..THREAD_COUNT)
            .map(|_| {
                std::thread::spawn(move || {
                    record_submitted("concurrent-agent", date, "10.00")
                        .expect("record_submitted must not fail under contention")
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("worker thread panicked");
        }

        let final_usage = load("concurrent-agent", date).expect("final load");
        assert_eq!(final_usage.orders_count, THREAD_COUNT as u32);
        assert_eq!(final_usage.notional_submitted, "160.00");
    }
}

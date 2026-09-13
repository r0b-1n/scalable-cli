//! Deterministic price history + quote derivation for catalog instruments.
//!
//! Everything here is a pure function of `(seed, isin, timeframe, now)` — there is no
//! `Utc::now()` call anywhere in this module. Callers pass `now` in explicitly, which is what
//! makes the "same request => byte-identical response" guarantee possible: two calls with the
//! same arguments always produce the same points, down to the float bit pattern.
//!
//! Design: rather than simulating one giant historical path from a fixed epoch (which would
//! need to stay consistent across every possible timeframe window), each `series()` call
//! generates its own short geometric Brownian motion walk shaped for that timeframe's point
//! count/spacing, then rescales the whole walk so its last point lands exactly on
//! [`current_price`] — which is computed independently and is the one source of truth for "the
//! price right now". This keeps generation cheap (a handful to a few hundred steps, never a
//! multi-year day-by-day simulation) while guaranteeing chart/quote agreement.


use crate::catalog;
use crate::rng::Rng;
use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Utc, Weekday};

/// One point on a price chart.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub timestamp: DateTime<Utc>,
    pub mid: f64,
}

/// Timeframes the CLI can ask for, mapped from the GraphQL `TimeFrame` enum the CLI sends on
/// `BrokerChart` (`timeFrames: [TimeFrame!]!`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Timeframe {
    TwoDays,
    OneWeek,
    OneMonth,
    ThreeMonths,
    SixMonths,
    YearToDate,
    OneYear,
    Max,
}

impl Timeframe {
    /// Parse the GraphQL `TimeFrame` enum value the CLI sends. Unknown values fall back to
    /// `OneMonth` rather than panicking — a mock should degrade gracefully.
    pub fn from_graphql(s: &str) -> Timeframe {
        match s {
            "TWO_DAYS" => Timeframe::TwoDays,
            "ONE_WEEK" => Timeframe::OneWeek,
            "ONE_MONTH" => Timeframe::OneMonth,
            "THREE_MONTHS" => Timeframe::ThreeMonths,
            "SIX_MONTHS" => Timeframe::SixMonths,
            "YEAR_TO_DATE" => Timeframe::YearToDate,
            "ONE_YEAR" => Timeframe::OneYear,
            "MAX" => Timeframe::Max,
            _ => Timeframe::OneMonth,
        }
    }

    /// The canonical GraphQL enum string, for echoing `timeFrame` back in a response.
    pub fn as_graphql(&self) -> &'static str {
        match self {
            Timeframe::TwoDays => "TWO_DAYS",
            Timeframe::OneWeek => "ONE_WEEK",
            Timeframe::OneMonth => "ONE_MONTH",
            Timeframe::ThreeMonths => "THREE_MONTHS",
            Timeframe::SixMonths => "SIX_MONTHS",
            Timeframe::YearToDate => "YEAR_TO_DATE",
            Timeframe::OneYear => "ONE_YEAR",
            Timeframe::Max => "MAX",
        }
    }
}

/// Approximate Xetra/gettex trading window, in UTC. Real exchange hours vary by venue and DST;
/// this is a fixed, plausible stand-in — precision here doesn't matter for a mock.
const TRADING_OPEN_H: u32 = 7;
const TRADING_OPEN_M: u32 = 0;
const TRADING_CLOSE_H: u32 = 15;
const TRADING_CLOSE_M: u32 = 30;

fn is_weekend(d: NaiveDate) -> bool {
    matches!(d.weekday(), Weekday::Sat | Weekday::Sun)
}

fn is_crypto(isin: &str) -> bool {
    catalog::find(isin).map(|i| i.asset_class == "CRYPTO").unwrap_or(false)
}

fn instrument_params(isin: &str) -> (f64, f64, f64) {
    catalog::find(isin)
        .map(|i| (i.base_price, i.annual_vol, i.annual_drift))
        .unwrap_or((100.0, 0.20, 0.05))
}

/// Walk backward from `now`'s calendar date, collecting `count` dates (ascending order, last
/// one is `now`'s date when it qualifies). Weekends are skipped unless `include_weekends` (used
/// for crypto, which trades every day).
fn dates_back(now: DateTime<Utc>, count: usize, include_weekends: bool) -> Vec<NaiveDate> {
    let mut out = Vec::with_capacity(count);
    let mut d = now.date_naive();
    while out.len() < count {
        if include_weekends || !is_weekend(d) {
            out.push(d);
        }
        d -= Duration::days(1);
    }
    out.reverse();
    out
}

/// All dates from Jan 1st of `now`'s year through `now`'s date, inclusive (year-to-date).
fn ytd_dates(now: DateTime<Utc>, include_weekends: bool) -> Vec<NaiveDate> {
    let start = NaiveDate::from_ymd_opt(now.year(), 1, 1).expect("valid Jan 1st");
    let end = now.date_naive();
    let mut out = Vec::new();
    let mut d = start;
    while d <= end {
        if include_weekends || !is_weekend(d) {
            out.push(d);
        }
        d += Duration::days(1);
    }
    out
}

/// Expand a list of dates into intraday timestamps stepped every `step_minutes`, inside trading
/// hours for non-crypto instruments (or all day for crypto), dropping anything after `now`.
fn intraday_points(now: DateTime<Utc>, dates: &[NaiveDate], step_minutes: i64, crypto: bool) -> Vec<DateTime<Utc>> {
    let mut out = Vec::new();
    for &d in dates {
        let (open_h, open_m, close_h, close_m) = if crypto {
            (0, 0, 23, 55)
        } else {
            (TRADING_OPEN_H, TRADING_OPEN_M, TRADING_CLOSE_H, TRADING_CLOSE_M)
        };
        let day_open = Utc.from_utc_datetime(&d.and_hms_opt(open_h, open_m, 0).expect("valid time"));
        let day_close = Utc.from_utc_datetime(&d.and_hms_opt(close_h, close_m, 0).expect("valid time"));
        let mut t = day_open;
        while t <= day_close {
            if t <= now {
                out.push(t);
            }
            t += Duration::minutes(step_minutes);
        }
    }
    out
}

/// One representative timestamp per date (market close for non-crypto, midday for crypto),
/// clamped so today's point never lands in the future.
fn daily_points(now: DateTime<Utc>, dates: &[NaiveDate], crypto: bool) -> Vec<DateTime<Utc>> {
    let (h, m) = if crypto { (12, 0) } else { (TRADING_CLOSE_H, TRADING_CLOSE_M) };
    dates
        .iter()
        .map(|&d| {
            let t = Utc.from_utc_datetime(&d.and_hms_opt(h, m, 0).expect("valid time"));
            if t > now {
                now
            } else {
                t
            }
        })
        .collect()
}

/// One point per week going back `weeks` weeks from `now`, landing on Fridays for non-crypto
/// instruments (shifted off any weekend), clamped so the last point never lands in the future.
fn weekly_points(now: DateTime<Utc>, weeks: usize, crypto: bool) -> Vec<DateTime<Utc>> {
    let (h, m) = if crypto { (12, 0) } else { (TRADING_CLOSE_H, TRADING_CLOSE_M) };
    let mut out = Vec::with_capacity(weeks);
    for i in (0..weeks).rev() {
        let mut d = now.date_naive() - Duration::days(7 * i as i64);
        if !crypto && is_weekend(d) {
            d = match d.weekday() {
                Weekday::Sat => d - Duration::days(1),
                Weekday::Sun => d - Duration::days(2),
                _ => d,
            };
        }
        let t = Utc.from_utc_datetime(&d.and_hms_opt(h, m, 0).expect("valid time"));
        out.push(if t > now { now } else { t });
    }
    out
}

/// Thin a slice down to every `nth` element (keeping the first), e.g. for "every other day".
fn pick_every_nth<T: Copy>(items: &[T], nth: usize) -> Vec<T> {
    if nth == 0 {
        return items.to_vec();
    }
    items.iter().step_by(nth).copied().collect()
}

/// Build the ascending list of timestamps a given timeframe should show, ending at (or before)
/// `now`. Point counts and spacing intentionally differ per timeframe so a chart "looks real":
/// - `TwoDays`: 5-minute steps inside trading hours, ~2 sessions (~150-350 points).
/// - `OneWeek`: 30-minute steps, ~1 calendar week (~60-350 points).
/// - `OneMonth`/`ThreeMonths`/`SixMonths`: one point per trading day (weekends skipped for
///   non-crypto instruments) over ~1/3/6 months (~20-190 points).
/// - `YearToDate`: one point per trading day since Jan 1st of `now`'s year.
/// - `OneYear`: every other trading day over ~1 year (~120-185 points).
/// - `Max`: one point per week over ~5 years (~260 points).
fn timestamps_for(isin: &str, tf: Timeframe, now: DateTime<Utc>) -> Vec<DateTime<Utc>> {
    let crypto = is_crypto(isin);
    match tf {
        Timeframe::TwoDays => {
            let dates = dates_back(now, 2, crypto);
            intraday_points(now, &dates, 5, crypto)
        }
        Timeframe::OneWeek => {
            let dates = dates_back(now, if crypto { 7 } else { 5 }, crypto);
            intraday_points(now, &dates, 30, crypto)
        }
        Timeframe::OneMonth => {
            let dates = dates_back(now, if crypto { 30 } else { 22 }, crypto);
            daily_points(now, &dates, crypto)
        }
        Timeframe::ThreeMonths => {
            let dates = dates_back(now, if crypto { 90 } else { 64 }, crypto);
            daily_points(now, &dates, crypto)
        }
        Timeframe::SixMonths => {
            let dates = dates_back(now, if crypto { 182 } else { 128 }, crypto);
            daily_points(now, &dates, crypto)
        }
        Timeframe::YearToDate => {
            let dates = ytd_dates(now, crypto);
            daily_points(now, &dates, crypto)
        }
        Timeframe::OneYear => {
            let dates = dates_back(now, if crypto { 365 } else { 252 }, crypto);
            let thinned = pick_every_nth(&dates, 2);
            daily_points(now, &thinned, crypto)
        }
        Timeframe::Max => weekly_points(now, 260, crypto),
    }
}

/// A geometric brownian motion walk anchored so that the LAST point equals the instrument's
/// current price (see [`current_price`]) — charts must agree with quotes, always.
pub fn series(seed: u64, isin: &str, tf: Timeframe, now: DateTime<Utc>) -> Vec<Point> {
    let timestamps = timestamps_for(isin, tf, now);
    if timestamps.is_empty() {
        return Vec::new();
    }

    let (base_price, vol, drift) = instrument_params(isin);
    let mut rng = Rng::for_key(seed, &format!("{isin}|series|{}", tf.as_graphql()));

    // Unscaled walk: starts at the instrument's base_price purely as a numeraire — it gets
    // rescaled below, so its absolute starting level doesn't matter, only its shape does.
    let mut raw = Vec::with_capacity(timestamps.len());
    raw.push(base_price.max(0.01));
    for i in 1..timestamps.len() {
        let dt_seconds = (timestamps[i] - timestamps[i - 1]).num_seconds().max(1) as f64;
        let dt_years = dt_seconds / (365.25 * 24.0 * 3600.0);
        let z = rng.normal();
        let log_return = (drift - 0.5 * vol * vol) * dt_years + vol * dt_years.sqrt() * z;
        let prev = raw[i - 1];
        raw.push((prev * log_return.exp()).max(0.01));
    }

    let target_last = current_price(seed, isin, now);
    let raw_last = *raw.last().expect("non-empty by construction");
    let scale = if raw_last > 0.0 { target_last / raw_last } else { 1.0 };

    timestamps
        .into_iter()
        .zip(raw)
        .map(|(timestamp, raw_mid)| Point {
            timestamp,
            mid: raw_mid * scale,
        })
        .collect()
}

/// The instrument's "current" price: a deterministic function of `(seed, isin, day)` — stable
/// within a run/day (it hashes the calendar date, not the exact time-of-day) but differs per
/// instrument. Always equals `series(...).last().mid` for every timeframe.
pub fn current_price(seed: u64, isin: &str, now: DateTime<Utc>) -> f64 {
    let (base_price, vol, drift) = instrument_params(isin);
    let day_key = now.format("%Y-%m-%d").to_string();
    let mut rng = Rng::for_key(seed, &format!("{isin}|current|{day_key}"));

    // A single deterministic log-normal step (one trading day of drift + noise) away from the
    // instrument's reference price — enough to differ per instrument/day without needing a full
    // simulated history (that's what the per-timeframe walk in `series` is for).
    let dt_years = 1.0 / 252.0;
    let z = rng.normal();
    let log_return = (drift - 0.5 * vol * vol) * dt_years + vol * dt_years.sqrt() * z;
    (base_price * log_return.exp()).max(0.01)
}

/// Bid/ask around `mid`, using a realistic round-trip spread (in bps) per asset class.
pub fn spread(isin: &str, mid: f64) -> (f64, f64) {
    let inst = catalog::find(isin);
    let round_trip_bps: f64 = match inst {
        Some(i) if i.asset_class == "CRYPTO" => 15.0,
        Some(i) if i.is_derivative => 200.0, // knockouts/warrants: wide, leverage-driven spreads
        Some(i) if i.asset_class == "BOND" => 8.0,
        Some(i) if i.security_type == "ETF" => 6.0,
        Some(_) => 12.0, // single equities
        None => 10.0,
    };
    let half = mid * (round_trip_bps / 10_000.0) / 2.0;
    let bid = (mid - half).max(0.0001);
    let ask = mid + half;
    (bid, ask)
}

/// Simple absolute + relative return over a timeframe, derived from the same series (so it's
/// always consistent with what the chart itself shows): returns `(absolute, relative)`.
pub fn performance(seed: u64, isin: &str, tf: Timeframe, now: DateTime<Utc>) -> (f64, f64) {
    let points = series(seed, isin, tf, now);
    if points.len() < 2 {
        return (0.0, 0.0);
    }
    let first = points.first().expect("len >= 2").mid;
    let last = points.last().expect("len >= 2").mid;
    let absolute = last - first;
    let relative = if first != 0.0 { absolute / first } else { 0.0 };
    (absolute, relative)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fixed instant to generate against in tests, nudged onto a weekday so the "no weekend
    /// points for equities" assertions have a well-defined `now`.
    fn fixed_now() -> DateTime<Utc> {
        let mut now = Utc.with_ymd_and_hms(2025, 6, 11, 14, 30, 0).unwrap();
        while matches!(now.weekday(), Weekday::Sat | Weekday::Sun) {
            now -= Duration::days(1);
        }
        now
    }

    const APPLE: &str = "US0378331005";
    const BTC: &str = "XF000BTC0017";
    const SEED: u64 = 20260913;

    const ALL_TIMEFRAMES: [Timeframe; 8] = [
        Timeframe::TwoDays,
        Timeframe::OneWeek,
        Timeframe::OneMonth,
        Timeframe::ThreeMonths,
        Timeframe::SixMonths,
        Timeframe::YearToDate,
        Timeframe::OneYear,
        Timeframe::Max,
    ];

    #[test]
    fn from_graphql_round_trips_through_as_graphql() {
        for tf in ALL_TIMEFRAMES {
            assert_eq!(Timeframe::from_graphql(tf.as_graphql()), tf);
        }
    }

    #[test]
    fn from_graphql_falls_back_to_one_month_for_unknown_values() {
        assert_eq!(Timeframe::from_graphql("NOT_A_REAL_TIMEFRAME"), Timeframe::OneMonth);
    }

    #[test]
    fn determinism_same_args_same_series() {
        let now = fixed_now();
        for tf in ALL_TIMEFRAMES {
            let a = series(SEED, APPLE, tf, now);
            let b = series(SEED, APPLE, tf, now);
            assert_eq!(a.len(), b.len(), "{:?}: point count differs across identical calls", tf);
            for (pa, pb) in a.iter().zip(b.iter()) {
                assert_eq!(pa.timestamp, pb.timestamp);
                assert_eq!(pa.mid.to_bits(), pb.mid.to_bits(), "{:?}: mid differs across identical calls", tf);
            }
        }
    }

    #[test]
    fn last_point_equals_current_price() {
        let now = fixed_now();
        for isin in [APPLE, BTC] {
            let target = current_price(SEED, isin, now);
            for tf in ALL_TIMEFRAMES {
                let points = series(SEED, isin, tf, now);
                let last = points.last().expect("non-empty series").mid;
                assert!(
                    (last - target).abs() < 1e-6,
                    "{:?} {}: last point {last} != current_price {target}",
                    tf,
                    isin
                );
            }
        }
    }

    #[test]
    fn point_counts_in_expected_band_per_timeframe() {
        let now = fixed_now();
        let bands: [(Timeframe, usize, usize); 8] = [
            (Timeframe::TwoDays, 100, 400),
            (Timeframe::OneWeek, 40, 400),
            (Timeframe::OneMonth, 10, 35),
            (Timeframe::ThreeMonths, 45, 95),
            (Timeframe::SixMonths, 90, 190),
            (Timeframe::YearToDate, 1, 260),
            (Timeframe::OneYear, 80, 200),
            (Timeframe::Max, 200, 300),
        ];
        for (tf, lo, hi) in bands {
            let n = series(SEED, APPLE, tf, now).len();
            assert!((lo..=hi).contains(&n), "{:?}: {n} points not in expected [{lo}, {hi}]", tf);
        }
    }

    #[test]
    fn no_weekend_points_for_an_equity() {
        let now = fixed_now();
        for tf in ALL_TIMEFRAMES {
            for p in series(SEED, APPLE, tf, now) {
                assert!(
                    !is_weekend(p.timestamp.date_naive()),
                    "{:?}: equity series has a weekend point at {}",
                    tf,
                    p.timestamp
                );
            }
        }
    }

    #[test]
    fn crypto_can_have_weekend_points() {
        // Pick a `now` that itself falls on a weekend: intraday/daily windows (TwoDays,
        // OneWeek, OneMonth, ...) then must include weekend dates for crypto, since crypto
        // trades 24/7 and does not skip Saturdays/Sundays the way equities do.
        let mut now = Utc.with_ymd_and_hms(2025, 6, 14, 14, 30, 0).unwrap(); // a Saturday
        while !is_weekend(now.date_naive()) {
            now += Duration::days(1);
        }
        assert!(is_weekend(now.date_naive()), "test setup: `now` must be a weekend day");

        let has_weekend_point = series(SEED, BTC, Timeframe::OneMonth, now)
            .iter()
            .any(|p| is_weekend(p.timestamp.date_naive()));
        assert!(has_weekend_point, "expected at least one weekend point in crypto's OneMonth series");
    }

    #[test]
    fn no_future_timestamps() {
        let now = fixed_now();
        for isin in [APPLE, BTC] {
            for tf in ALL_TIMEFRAMES {
                for p in series(SEED, isin, tf, now) {
                    assert!(p.timestamp <= now, "{:?} {}: future timestamp {}", tf, isin, p.timestamp);
                }
            }
        }
    }

    #[test]
    fn prices_are_strictly_positive() {
        let now = fixed_now();
        for isin in [APPLE, BTC, "US88160R1014", "DE000HS4AC31"] {
            for tf in ALL_TIMEFRAMES {
                for p in series(SEED, isin, tf, now) {
                    assert!(p.mid > 0.0, "{:?} {}: non-positive mid {}", tf, isin, p.mid);
                }
            }
            assert!(current_price(SEED, isin, now) > 0.0);
        }
    }

    #[test]
    fn spread_brackets_mid_and_stays_positive() {
        for isin in [APPLE, BTC, "IE00B4L5Y983", "DE000HS4AC31"] {
            let mid = 100.0;
            let (bid, ask) = spread(isin, mid);
            assert!(bid < mid && mid < ask, "{isin}: spread does not bracket mid ({bid}, {mid}, {ask})");
            assert!(bid > 0.0);
        }
    }

    #[test]
    fn performance_matches_series_endpoints() {
        let now = fixed_now();
        let points = series(SEED, APPLE, Timeframe::OneMonth, now);
        let expected_abs = points.last().unwrap().mid - points.first().unwrap().mid;
        let (abs, rel) = performance(SEED, APPLE, Timeframe::OneMonth, now);
        assert!((abs - expected_abs).abs() < 1e-9);
        assert!((rel - abs / points.first().unwrap().mid).abs() < 1e-9);
    }

    #[test]
    fn unknown_isin_falls_back_to_defaults_without_panicking() {
        let now = fixed_now();
        let points = series(SEED, "ZZ0000000000", Timeframe::OneMonth, now);
        assert!(!points.is_empty());
        assert!(points.iter().all(|p| p.mid > 0.0));
    }
}

//! Builds the mock's one realistic, self-consistent dataset: a German retail persona, two
//! portfolios with non-round holdings, and a 3-year, 120+-entry transaction ledger that the
//! holdings are folded from (so quantity always equals the sum of that ISIN's settled buy/
//! savings-plan/sell transactions by construction, not by coincidence).
//!
//! Everything here is a pure function of `(seed, now)` — `now` is passed in once by `main.rs` at
//! process start (itself a single live `Utc::now()` call) and threaded through; no function in
//! this module calls `Utc::now()` itself, so the same `(seed, now)` always rebuilds byte-identical
//! fixtures.

use crate::catalog;
use crate::pricing;
use crate::rng::Rng;
use crate::state::{
    Holding, MockState, OvernightAccount, Portfolio, PortfolioGroup, PriceAlert, SavingsPlan,
    Transaction, TxnShape,
};
use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Utc, Weekday};
use std::cmp::Reverse;
use std::collections::HashMap;

// ------------------------------------------------------------------------------------------
// Small date helpers (no external crate features beyond what's already in Cargo.toml)
// ------------------------------------------------------------------------------------------

fn business_day(mut d: NaiveDate) -> NaiveDate {
    loop {
        match d.weekday() {
            Weekday::Sat => d -= Duration::days(1),
            Weekday::Sun => d -= Duration::days(1),
            _ => return d,
        }
    }
}

fn dt_at(d: NaiveDate, hour: u32, minute: u32) -> DateTime<Utc> {
    Utc.from_utc_datetime(&d.and_hms_opt(hour, minute, 0).expect("valid time"))
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    let (ny, nm) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    NaiveDate::from_ymd_opt(ny, nm, 1)
        .expect("valid first-of-month")
        .pred_opt()
        .expect("valid predecessor")
        .day()
}

fn nth_month_date(year: i32, month: u32, day: u32) -> NaiveDate {
    let last = last_day_of_month(year, month);
    NaiveDate::from_ymd_opt(year, month, day.min(last)).expect("valid clamped date")
}

/// Shift a date by `delta` whole months (positive or negative), clamping the day-of-month.
fn shift_months(d: NaiveDate, delta: i32, day_of_month: u32) -> NaiveDate {
    let m0 = d.month() as i32 - 1 + delta;
    let year = d.year() + m0.div_euclid(12);
    let month = (m0.rem_euclid(12) + 1) as u32;
    nth_month_date(year, month, day_of_month)
}

fn round4(x: f64) -> f64 {
    (x * 10_000.0).round() / 10_000.0
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

fn next_id(counter: &mut u64) -> String {
    let id = format!("txn-{:05}", *counter);
    *counter += 1;
    id
}

fn cash_txn(
    id: String,
    type_: &'static str,
    last_event: DateTime<Utc>,
    amount: f64,
    description: &str,
) -> Transaction {
    Transaction {
        id,
        currency: "EUR".to_string(),
        shape: TxnShape::Cash,
        type_,
        status: "SETTLED",
        is_cancellation: false,
        last_event,
        description: description.to_string(),
        isin: None,
        quantity: None,
        amount,
        side: None,
        limit_price: None,
        stop_price: None,
    }
}

// ------------------------------------------------------------------------------------------
// Per-holding generation
// ------------------------------------------------------------------------------------------

struct HoldingSpec {
    isin: &'static str,
    /// `Some((monthly_amount_eur, day_of_month))` for a savings-plan-funded position.
    savings_plan: Option<(f64, u32)>,
    /// Whether this holding should include a partial SELL (creates realistic winners/losers and
    /// exercises the SELL transaction type).
    allow_sell: bool,
}

/// Shape of a manually-traded position: how many buy lots to mint, the per-lot share-count
/// range, and whether part of one lot is sold back again.
struct LotPlan {
    lots: i64,
    qty: (f64, f64),
    allow_sell: bool,
}

fn build_manual_holding(
    seed: u64,
    isin: &'static str,
    now: DateTime<Utc>,
    plan: LotPlan,
    next: &mut u64,
) -> (Holding, Vec<Transaction>) {
    let inst = catalog::find(isin).expect("holding isin must exist in the catalog");
    let mut rng = Rng::for_key(seed, &format!("{isin}|manual-lots"));

    let mut offsets: Vec<i64> = (0..plan.lots).map(|_| rng.range_i64(30, 980)).collect();
    offsets.sort_unstable_by(|a, b| b.cmp(a)); // largest (oldest) first
    let mut lots: Vec<(f64, f64)> = Vec::new(); // (remaining qty, cost price)
    let mut txns = Vec::new();

    for &days_ago in &offsets {
        let date = business_day(now.date_naive() - Duration::days(days_ago));
        let dt = dt_at(date, 8 + rng.range_i64(0, 8) as u32, rng.range_i64(0, 59) as u32);
        let qty = round4(rng.range(plan.qty.0, plan.qty.1));
        let price = pricing::current_price(seed, isin, dt);
        lots.push((qty, price));
        txns.push(Transaction {
            id: next_id(next),
            currency: inst.currency.to_string(),
            shape: TxnShape::Security,
            type_: "BUY",
            status: "FILLED",
            is_cancellation: false,
            last_event: dt,
            description: format!("Kauf {qty} {}", inst.name),
            isin: Some(isin.to_string()),
            quantity: Some(qty),
            amount: round2(qty * price),
            side: Some("BUY"),
            limit_price: None,
            stop_price: None,
        });
    }

    if plan.allow_sell && lots.len() >= 2 {
        let most_recent_buy_days_ago = *offsets.iter().min().unwrap_or(&30);
        let sell_days_ago = (most_recent_buy_days_ago - rng.range_i64(5, most_recent_buy_days_ago.max(6))).max(3);
        let sell_date = business_day(now.date_naive() - Duration::days(sell_days_ago));
        let sell_dt = dt_at(sell_date, 8 + rng.range_i64(0, 8) as u32, rng.range_i64(0, 59) as u32);
        let sell_price = pricing::current_price(seed, isin, sell_dt);

        let total_qty: f64 = lots.iter().map(|l| l.0).sum();
        let sell_qty = round4((total_qty * rng.range(0.25, 0.55)).max(0.5).min(total_qty * 0.9));

        let mut remaining = sell_qty;
        let mut i = 0;
        while remaining > 1e-9 && i < lots.len() {
            let take = remaining.min(lots[i].0);
            lots[i].0 -= take;
            remaining -= take;
            if lots[i].0 <= 1e-9 {
                i += 1;
            }
        }
        lots.retain(|l| l.0 > 1e-9);

        txns.push(Transaction {
            id: next_id(next),
            currency: inst.currency.to_string(),
            shape: TxnShape::Security,
            type_: "SELL",
            status: "FILLED",
            is_cancellation: false,
            last_event: sell_dt,
            description: format!("Verkauf {sell_qty} {}", inst.name),
            isin: Some(isin.to_string()),
            quantity: Some(sell_qty),
            amount: round2(sell_qty * sell_price),
            side: Some("SELL"),
            limit_price: None,
            stop_price: None,
        });
    }

    let total_qty: f64 = lots.iter().map(|l| l.0).sum();
    let total_cost: f64 = lots.iter().map(|l| l.0 * l.1).sum();
    let fifo_price = if total_qty > 0.0 { total_cost / total_qty } else { 0.0 };
    (
        Holding { isin: isin.to_string(), quantity: round4(total_qty), fifo_price },
        txns,
    )
}

fn build_savings_plan_holding(
    seed: u64,
    isin: &'static str,
    now: DateTime<Utc>,
    amount: f64,
    day_of_month: u32,
    months_back: i64,
    next: &mut u64,
) -> (Holding, Vec<Transaction>, NaiveDate) {
    let inst = catalog::find(isin).expect("savings-plan isin must exist in the catalog");
    let today = now.date_naive();
    let this_month = nth_month_date(today.year(), today.month(), day_of_month);
    let last_occurrence = if this_month <= today { this_month } else { shift_months(this_month, -1, day_of_month) };
    let next_execution = shift_months(last_occurrence, 1, day_of_month);

    let mut dates = Vec::with_capacity(months_back as usize);
    let mut d = last_occurrence;
    for _ in 0..months_back {
        dates.push(d);
        d = shift_months(d, -1, day_of_month);
    }
    dates.reverse();

    let mut total_qty = 0.0;
    let mut total_cost = 0.0;
    let mut txns = Vec::new();
    for date in dates {
        let bd = business_day(date);
        let dt = dt_at(bd, 9, 0);
        let price = pricing::current_price(seed, isin, dt).max(0.01);
        let qty = round4(amount / price);
        total_qty += qty;
        total_cost += amount;
        txns.push(Transaction {
            id: next_id(next),
            currency: inst.currency.to_string(),
            shape: TxnShape::Security,
            type_: "SAVINGS_PLAN",
            status: "SETTLED",
            is_cancellation: false,
            last_event: dt,
            description: format!("Sparplanausführung {}", inst.name),
            isin: Some(isin.to_string()),
            quantity: Some(qty),
            amount: round2(amount),
            side: Some("BUY"),
            limit_price: None,
            stop_price: None,
        });
    }
    let fifo_price = if total_qty > 0.0 { total_cost / total_qty } else { 0.0 };
    (
        Holding { isin: isin.to_string(), quantity: round4(total_qty), fifo_price },
        txns,
        next_execution,
    )
}

fn build_distributions(
    seed: u64,
    isin: &'static str,
    quantity_now: f64,
    now: DateTime<Utc>,
    next: &mut u64,
) -> Vec<Transaction> {
    let inst = catalog::find(isin).expect("distribution isin must exist in the catalog");
    if !inst.distributing || quantity_now <= 0.0 {
        return Vec::new();
    }
    let mut rng = Rng::for_key(seed, &format!("{isin}|dividends"));
    let mut txns = Vec::new();
    let annual_per_share = inst.dividend_yield * inst.base_price;
    let withholding_rate = if inst.currency == "USD" { 0.15 } else { 0.26375 };

    for years_ago in [3i64, 2, 1] {
        let payments_this_year: i64 = if rng.chance(0.6) { 2 } else { 1 };
        for p in 0..payments_this_year {
            let days_ago = years_ago * 365 - p * 180 - rng.range_i64(5, 60);
            if days_ago < 10 {
                continue;
            }
            let date = business_day(now.date_naive() - Duration::days(days_ago));
            let dt = dt_at(date, 9, 0);
            let gross_per_share = annual_per_share / payments_this_year as f64;
            let gross = gross_per_share * quantity_now;
            let net = gross * (1.0 - withholding_rate);
            if net <= 0.0 {
                continue;
            }
            txns.push(Transaction {
                id: next_id(next),
                currency: inst.currency.to_string(),
                shape: TxnShape::NonTradeSecurity,
                type_: "DISTRIBUTION",
                status: "SETTLED",
                is_cancellation: false,
                last_event: dt,
                description: format!("Dividende {}", inst.name),
                isin: Some(isin.to_string()),
                quantity: Some(quantity_now),
                amount: round2(net),
                side: None,
                limit_price: None,
                stop_price: None,
            });
        }
    }
    txns
}

/// Deposits/withdrawals/fees/tax/interest sized so the portfolio's derived EUR cash balance
/// (folded from every settled transaction, see `Portfolio::cash_balance_eur`) lands on a plausible
/// positive figure — computed backward from the net cash already consumed by security activity,
/// never stored as a separate balance field.
fn build_cash_transactions(
    seed: u64,
    portfolio_tag: &str,
    now: DateTime<Utc>,
    security_net_eur: f64,
    target_balance_range: (f64, f64),
    next: &mut u64,
) -> Vec<Transaction> {
    let mut rng = Rng::for_key(seed, &format!("{portfolio_tag}|cash"));
    let mut txns = Vec::new();

    let mut other_net = 0.0;
    for m in 1..=8i64 {
        let days_ago = m * 45 + rng.range_i64(-6, 6);
        if days_ago < 10 {
            continue;
        }
        let date = business_day(now.date_naive() - Duration::days(days_ago));
        let amount = round2(rng.range(1.2, 6.5));
        txns.push(cash_txn(next_id(next), "INTEREST", dt_at(date, 3, 0), amount, "Zinsen Verrechnungskonto"));
        other_net += amount;
    }
    for _ in 0..rng.range_i64(2, 4) {
        let days_ago = rng.range_i64(30, 950);
        let date = business_day(now.date_naive() - Duration::days(days_ago));
        let amount = round2(rng.range(0.9, 4.5));
        txns.push(cash_txn(next_id(next), "FEE", dt_at(date, 9, 0), amount, "Fremdkostenpauschale"));
        other_net -= amount;
    }
    {
        let days_ago = rng.range_i64(80, 420);
        let date = business_day(now.date_naive() - Duration::days(days_ago));
        let amount = round2(rng.range(3.0, 18.0));
        txns.push(cash_txn(next_id(next), "TAX", dt_at(date, 9, 0), amount, "Vorabpauschale"));
        other_net -= amount;
    }

    let withdrawal_amount = round2(rng.range(150.0, 500.0));
    let target_balance = rng.range(target_balance_range.0, target_balance_range.1);
    let mut deposits_total = target_balance - security_net_eur - other_net + withdrawal_amount;
    if deposits_total < target_balance {
        deposits_total = target_balance;
    }

    {
        let days_ago = rng.range_i64(220, 720);
        let date = business_day(now.date_naive() - Duration::days(days_ago));
        txns.push(cash_txn(
            next_id(next),
            "WITHDRAWAL",
            dt_at(date, 14, 0),
            withdrawal_amount,
            "Auszahlung auf Referenzkonto",
        ));
    }

    let shares = [0.55, 0.20, 0.15, 0.10];
    let day_offsets = [1010i64, 640, 300, 55];
    let mut allocated = 0.0;
    for (i, (share, days_ago)) in shares.iter().zip(day_offsets.iter()).enumerate() {
        let amount = if i == shares.len() - 1 {
            round2(deposits_total - allocated)
        } else {
            round2(deposits_total * share)
        };
        allocated += amount;
        let date = business_day(now.date_naive() - Duration::days(*days_ago));
        txns.push(cash_txn(
            next_id(next),
            "DEPOSIT",
            dt_at(date, 10, 0),
            amount,
            "Einzahlung vom Referenzkonto",
        ));
    }

    txns
}

/// At least one PENDING and one CANCELLED order, so the transaction feature isn't only ever
/// exercised via freshly-placed orders.
fn build_order_markers(seed: u64, now: DateTime<Utc>, next: &mut u64) -> Vec<Transaction> {
    let mut rng = Rng::for_key(seed, "order-markers");
    let mut txns = Vec::new();

    {
        let isin = "DE0007236101"; // Siemens
        let inst = catalog::find(isin).expect("siemens in catalog");
        let mid = pricing::current_price(seed, isin, now);
        let limit = round2(mid * 0.95);
        let qty = round4(rng.range(2.0, 6.0));
        txns.push(Transaction {
            id: next_id(next),
            currency: inst.currency.to_string(),
            shape: TxnShape::Security,
            type_: "BUY",
            status: "PENDING",
            is_cancellation: false,
            last_event: dt_at(now.date_naive(), rng.range_i64(7, 20) as u32, rng.range_i64(0, 59) as u32).min(now),
            description: format!("Kauf {qty} {} (Limit)", inst.name),
            isin: Some(isin.to_string()),
            quantity: Some(qty),
            amount: round2(qty * limit),
            side: Some("BUY"),
            limit_price: Some(limit),
            stop_price: None,
        });
    }
    {
        let isin = "US88160R1014"; // Tesla
        let inst = catalog::find(isin).expect("tesla in catalog");
        let days_ago = rng.range_i64(3, 40);
        let date = business_day(now.date_naive() - Duration::days(days_ago));
        let dt = dt_at(date, 11, 0);
        let price = pricing::current_price(seed, isin, dt);
        let qty = round4(rng.range(1.0, 3.0));
        txns.push(Transaction {
            id: next_id(next),
            currency: inst.currency.to_string(),
            shape: TxnShape::Security,
            type_: "SELL",
            status: "CANCELLED",
            is_cancellation: true,
            last_event: dt,
            description: format!("Verkauf {qty} {} (storniert)", inst.name),
            isin: Some(isin.to_string()),
            quantity: Some(qty),
            amount: round2(qty * price),
            side: Some("SELL"),
            limit_price: None,
            stop_price: None,
        });
    }
    txns
}

// ------------------------------------------------------------------------------------------
// Portfolio assembly
// ------------------------------------------------------------------------------------------

fn build_holdings_and_txns(
    seed: u64,
    specs: &[HoldingSpec],
    now: DateTime<Utc>,
    next: &mut u64,
) -> (Vec<Holding>, Vec<SavingsPlan>, Vec<Transaction>) {
    let mut holdings = Vec::new();
    let mut savings_plans = Vec::new();
    let mut txns = Vec::new();

    for spec in specs {
        let (holding, mut htxns) = if let Some((amount, day)) = spec.savings_plan {
            let months_back = 22 + (fnv_pick(seed, spec.isin) % 14) as i64; // 22..=35 months
            let (holding, htxns, next_execution) =
                build_savings_plan_holding(seed, spec.isin, now, amount, day, months_back, next);
            savings_plans.push(SavingsPlan {
                isin: spec.isin.to_string(),
                amount,
                frequency: "MONTHLY".to_string(),
                day_of_month: day,
                dynamization_rate: 0.0,
                payment_method: "REFERENCE_ACCOUNT".to_string(),
                next_execution,
            });
            (holding, htxns)
        } else {
            let is_etf = catalog::find(spec.isin).map(|i| i.security_type == "ETF").unwrap_or(false);
            let plan = LotPlan {
                lots: 2 + (fnv_pick(seed, spec.isin) % 3) as i64, // 2..=4 lots
                // ETFs trade in larger share counts than single stocks at the same ticket size.
                qty: if is_etf { (2.0, 18.0) } else { (1.0, 9.0) },
                allow_sell: spec.allow_sell,
            };
            build_manual_holding(seed, spec.isin, now, plan, next)
        };

        let dividends = build_distributions(seed, spec.isin, holding.quantity, now, next);
        txns.append(&mut htxns);
        txns.extend(dividends);
        holdings.push(holding);
    }

    (holdings, savings_plans, txns)
}

/// A tiny deterministic pick derived from `(seed, key)`, used only to vary small integer
/// parameters (lot counts, month spans) per-instrument without needing a `Rng` at the call site.
fn fnv_pick(seed: u64, key: &str) -> u64 {
    let mut rng = Rng::for_key(seed, key);
    rng.next_u64()
}

/// A named group of holdings within a portfolio, as the seed data declares it.
struct GroupSpec {
    id: &'static str,
    name: &'static str,
    description: Option<&'static str>,
    items: &'static [&'static str],
}

/// A seeded price alert. Exactly one of `isin` / `ticker` is set: securities are addressed by
/// ISIN, crypto by ticker, which is what the real API accepts.
struct AlertSpec {
    isin: Option<&'static str>,
    ticker: Option<&'static str>,
    price: f64,
    direction: &'static str,
}

/// Everything that distinguishes one seeded portfolio from another.
///
/// This is a struct rather than a long parameter list because the call sites read as data:
/// positionally, a bare `(1200.0, 4500.0)` gives the reader no way to tell a cash range from
/// a price range without counting commas back to the signature.
struct PortfolioSpec {
    id: &'static str,
    holdings: &'static [HoldingSpec],
    watchlist: &'static [&'static str],
    groups: &'static [GroupSpec],
    /// Built at runtime: alert prices are anchored to the seeded live price.
    alerts: Vec<AlertSpec>,
    /// Range, in EUR, that the seeded cash balance is steered into.
    cash_target_range: (f64, f64),
}

// ------------------------------------------------------------------------------------------
// Seed data
//
// The two portfolios are deliberately different in character: portfolio-1 is a tech-heavy
// growth book with crypto alerts and two ETF savings plans, portfolio-2 a broader blue-chip
// and bond mix. Anything reading both should therefore see genuinely different allocations,
// risk profiles and transaction histories rather than the same shape twice.
// ------------------------------------------------------------------------------------------

const P1_HOLDINGS: &[HoldingSpec] = &[
    HoldingSpec { isin: "US0378331005", savings_plan: None, allow_sell: false }, // Apple
    HoldingSpec { isin: "DE0007164600", savings_plan: None, allow_sell: false }, // SAP
    HoldingSpec { isin: "DE0007100000", savings_plan: None, allow_sell: true },  // Mercedes-Benz (loser)
    HoldingSpec { isin: "US88160R1014", savings_plan: None, allow_sell: false }, // Tesla
    HoldingSpec { isin: "US67066G1040", savings_plan: None, allow_sell: false }, // NVIDIA
    HoldingSpec { isin: "DE0007236101", savings_plan: None, allow_sell: true },  // Siemens
    HoldingSpec { isin: "IE00B4L5Y983", savings_plan: Some((150.0, 1)), allow_sell: false }, // MSCI World
    HoldingSpec { isin: "IE00BK5BQT80", savings_plan: Some((100.0, 15)), allow_sell: false }, // Vanguard All-World
    HoldingSpec { isin: "IE00B4ND3602", savings_plan: None, allow_sell: false }, // Gold ETC
];

/// Rheinmetall, Amazon, Novo Nordisk — watched but not held.
const P1_WATCHLIST: &[&str] = &["DE0007030009", "US0231351067", "DK0062498333"];

const P1_GROUPS: &[GroupSpec] = &[
    GroupSpec {
        id: "group-1",
        name: "Tech & Wachstum",
        description: Some("Wachstumsstarke Einzeltitel"),
        items: &["US0378331005", "US67066G1040", "US88160R1014", "DE0007164600", "DE0007236101"],
    },
    GroupSpec {
        id: "group-2",
        name: "ETF Sparplan",
        description: None,
        items: &["IE00B4L5Y983", "IE00BK5BQT80"],
    },
];

const P2_HOLDINGS: &[HoldingSpec] = &[
    HoldingSpec { isin: "US5949181045", savings_plan: None, allow_sell: false }, // Microsoft
    HoldingSpec { isin: "NL0010273215", savings_plan: None, allow_sell: true },  // ASML
    HoldingSpec { isin: "IE00B5BMR087", savings_plan: Some((200.0, 5)), allow_sell: false }, // S&P 500
    HoldingSpec { isin: "IE00BTJRMP35", savings_plan: None, allow_sell: false }, // EM ETF
    HoldingSpec { isin: "DE0008404005", savings_plan: None, allow_sell: false }, // Allianz
    HoldingSpec { isin: "FR0000121014", savings_plan: None, allow_sell: true },  // LVMH
    HoldingSpec { isin: "IE00BDBRDM35", savings_plan: None, allow_sell: false }, // Global Agg Bond
];

/// Visa, Eli Lilly.
const P2_WATCHLIST: &[&str] = &["US92826C8394", "US5324571083"];

const P2_GROUPS: &[GroupSpec] = &[GroupSpec {
    id: "group-3",
    name: "Blue Chips",
    description: Some("Etablierte internationale Standardwerte"),
    items: &["US5949181045", "NL0010273215", "DE0008404005", "FR0000121014"],
}];

fn build_portfolio(seed: u64, spec: &PortfolioSpec, now: DateTime<Utc>, next: &mut u64) -> Portfolio {
    let (holdings, savings_plans, mut txns) =
        build_holdings_and_txns(seed, spec.holdings, now, next);

    let security_net: f64 = txns.iter().map(txn_cash_delta_eur).sum();
    let cash_txns = build_cash_transactions(
        seed,
        spec.id,
        now,
        security_net,
        spec.cash_target_range,
        next,
    );
    txns.extend(cash_txns);
    txns.extend(build_order_markers(seed, now, next));

    txns.sort_by_key(|t| Reverse(t.last_event));

    let group_structs = spec
        .groups
        .iter()
        .map(|g| PortfolioGroup {
            id: g.id.to_string(),
            name: g.name.to_string(),
            description: g.description.map(str::to_string),
            items: g.items.iter().map(|s| s.to_string()).collect(),
        })
        .collect();

    let price_alerts = spec
        .alerts
        .iter()
        .map(|a| PriceAlert {
            id: String::new(), // assigned below once we know a stable ordering
            isin: a.isin.map(str::to_string),
            ticker: a.ticker.map(str::to_string),
            price: a.price,
            direction: a.direction.to_string(),
            is_active: true,
        })
        .collect::<Vec<_>>();

    Portfolio {
        id: spec.id.to_string(),
        holdings,
        watchlist: spec.watchlist.iter().map(|s| s.to_string()).collect(),
        price_alerts,
        groups: group_structs,
        savings_plans,
        transactions: txns,
    }
}

/// Standalone copy of `Transaction::cash_delta_eur`'s logic usable before the struct is behind a
/// `Portfolio` (kept in sync deliberately: both read the same `type_`/`status`/`currency`/`amount`
/// fields, this one just doesn't require `pub(crate)` visibility gymnastics during generation).
fn txn_cash_delta_eur(t: &Transaction) -> f64 {
    if !t.is_settled() {
        return 0.0;
    }
    let amount_eur = crate::state::to_eur(t.amount, &t.currency);
    match t.type_ {
        "BUY" | "SAVINGS_PLAN" | "WITHDRAWAL" | "FEE" | "TAX" | "CASH_TRANSFER_OUT" => -amount_eur,
        "SELL" | "DISTRIBUTION" | "INTEREST" | "DEPOSIT" | "CASH_TRANSFER_IN" => amount_eur,
        _ => 0.0,
    }
}

fn build_overnight(seed: u64, now: DateTime<Utc>, next: &mut u64) -> OvernightAccount {
    let mut rng = Rng::for_key(seed, "overnight");
    let rate = 0.025_f64;
    let mut txns = Vec::new();

    let init_days_ago = rng.range_i64(210, 260);
    let init_amount = round2(rng.range(3000.0, 12000.0));
    {
        let date = business_day(now.date_naive() - Duration::days(init_days_ago));
        txns.push(cash_txn(next_id(next), "DEPOSIT", dt_at(date, 10, 0), init_amount, "Einzahlung Tagesgeldkonto"));
    }
    let topup_days_ago = init_days_ago - rng.range_i64(60, 120);
    let topup_amount = round2(rng.range(500.0, 2500.0));
    if topup_days_ago > 15 {
        let date = business_day(now.date_naive() - Duration::days(topup_days_ago));
        txns.push(cash_txn(next_id(next), "DEPOSIT", dt_at(date, 10, 0), topup_amount, "Einzahlung Tagesgeldkonto"));
    }
    let withdrawal_days_ago = (topup_days_ago - rng.range_i64(30, 80)).max(10);
    let withdrawal_amount = round2(rng.range(200.0, 1000.0));
    {
        let date = business_day(now.date_naive() - Duration::days(withdrawal_days_ago));
        txns.push(cash_txn(next_id(next), "WITHDRAWAL", dt_at(date, 14, 0), withdrawal_amount, "Auszahlung Tagesgeldkonto"));
    }

    let mut balance_estimate = init_amount;
    let mut d = init_days_ago - 30;
    while d > 5 {
        if d <= topup_days_ago {
            balance_estimate += topup_amount;
        }
        if d <= withdrawal_days_ago {
            balance_estimate -= withdrawal_amount;
        }
        let date = business_day(now.date_naive() - Duration::days(d));
        let interest = round2((balance_estimate * rate / 12.0).max(0.01));
        txns.push(cash_txn(next_id(next), "INTEREST", dt_at(date, 3, 0), interest, "Zinsgutschrift"));
        balance_estimate += interest;
        d -= 30;
    }

    txns.sort_by_key(|t| Reverse(t.last_event));
    OvernightAccount { id: "sav-1".to_string(), interest_rate: rate, transactions: txns }
}

pub fn build(seed: u64, now: DateTime<Utc>) -> MockState {
    let mut next: u64 = 1;

    let portfolio1 = build_portfolio(
        seed,
        &PortfolioSpec {
            id: "portfolio-1",
            holdings: P1_HOLDINGS,
            watchlist: P1_WATCHLIST,
            groups: P1_GROUPS,
            alerts: vec![
                AlertSpec {
                    isin: Some("US0378331005"),
                    ticker: None,
                    price: pricing::current_price(seed, "US0378331005", now) * 1.12,
                    direction: "ABOVE",
                },
                AlertSpec {
                    isin: Some("DE0007100000"),
                    ticker: None,
                    price: pricing::current_price(seed, "DE0007100000", now) * 0.85,
                    direction: "BELOW",
                },
                AlertSpec {
                    isin: None,
                    ticker: Some("BTC"),
                    price: pricing::current_price(seed, "XF000BTC0017", now) * 1.15,
                    direction: "ABOVE",
                },
                AlertSpec {
                    isin: None,
                    ticker: Some("ETH"),
                    price: pricing::current_price(seed, "XF000ETH0019", now) * 1.10,
                    direction: "ABOVE",
                },
            ],
            cash_target_range: (1200.0, 4500.0),
        },
        now,
        &mut next,
    );

    let portfolio2 = build_portfolio(
        seed,
        &PortfolioSpec {
            id: "portfolio-2",
            holdings: P2_HOLDINGS,
            watchlist: P2_WATCHLIST,
            groups: P2_GROUPS,
            alerts: vec![AlertSpec {
                isin: Some("US5949181045"),
                ticker: None,
                price: pricing::current_price(seed, "US5949181045", now) * 1.10,
                direction: "ABOVE",
            }],
            cash_target_range: (400.0, 2200.0),
        },
        now,
        &mut next,
    );

    let mut portfolio1 = portfolio1;
    let mut portfolio2 = portfolio2;
    assign_alert_ids(&mut portfolio1, &mut next);
    assign_alert_ids(&mut portfolio2, &mut next);

    let overnight = build_overnight(seed, now, &mut next);

    let portfolios_for_counter: Vec<String> = portfolio1
        .groups
        .iter()
        .chain(portfolio2.groups.iter())
        .map(|g| g.id.clone())
        .collect();

    MockState {
        seed,
        genesis: now,
        first_name: "Max".to_string(),
        last_name: "Mustermann".to_string(),
        locale: "de-DE".to_string(),
        person_id: "person-1".to_string(),
        account_id: "account-1".to_string(),
        default_portfolio_id: "portfolio-1".to_string(),
        portfolios: vec![portfolio1, portfolio2],
        overnight,
        // Start the group counter past every seeded group id, otherwise the
        // first `create` hands back an id that already belongs to a fixture
        // group and update/delete then act on the wrong one.
        next_group_id: next_group_id_after_fixtures(&portfolios_for_counter),
        next_alert_id: 1,
        next_order_id: 1,
        idempotency: HashMap::new(),
    }
}

/// One past the highest numeric suffix among seeded `group-<n>` ids, so runtime
/// group creation can never alias a fixture group.
fn next_group_id_after_fixtures(ids: &[String]) -> u64 {
    ids.iter()
        .filter_map(|id| id.strip_prefix("group-"))
        .filter_map(|n| n.parse::<u64>().ok())
        .max()
        .map_or(1, |max| max + 1)
}

fn assign_alert_ids(portfolio: &mut Portfolio, next: &mut u64) {
    for alert in portfolio.price_alerts.iter_mut() {
        alert.id = format!("alert-{:04}", *next);
        *next += 1;
    }
}

// ------------------------------------------------------------------------------------------
// Per-instrument news (a pure function of `(seed, isin, now)`, not stored on `MockState` — any
// catalog ISIN can be asked about, not just held/watched ones, so this generates on demand
// exactly like `pricing::series` does for charts).
// ------------------------------------------------------------------------------------------

pub struct NewsEntry {
    pub id: String,
    pub headline_en: String,
    pub headline_de: String,
    pub source: String,
    pub published: DateTime<Utc>,
}

const HEADLINE_TEMPLATES: &[(&str, &str)] = &[
    ("{name} shares rise after strong quarterly results", "{name}-Aktie steigt nach starken Quartalszahlen"),
    ("Analysts raise price target for {name}", "Analysten erhöhen Kursziel für {name}"),
    ("{name} announces new share buyback program", "{name} kündigt neues Aktienrückkaufprogramm an"),
    ("{name} beats earnings expectations, guidance raised", "{name} übertrifft Gewinnerwartungen, Prognose angehoben"),
    ("Market reacts cautiously to {name}'s latest outlook", "Markt reagiert verhalten auf Ausblick von {name}"),
    ("{name} expands into new markets, investors optimistic", "{name} expandiert in neue Märkte, Anleger zuversichtlich"),
    ("{name} faces regulatory scrutiny over recent disclosures", "{name} gerät wegen jüngster Offenlegungen unter Aufsicht"),
];

const NEWS_SOURCES: &[&str] = &[
    "Reuters", "Bloomberg", "dpa-AFX", "Handelsblatt", "Der Aktionär", "finanzen.net", "Börsen-Zeitung",
];

pub fn news_for(seed: u64, isin: &str, now: DateTime<Utc>) -> Vec<NewsEntry> {
    let inst = catalog::find(isin);
    let name = inst.map(|i| i.name).unwrap_or(isin);
    let mut rng = Rng::for_key(seed, &format!("{isin}|news"));
    let mut entries = Vec::new();
    for i in 0..3 {
        let (en, de) = HEADLINE_TEMPLATES[rng.range_i64(0, HEADLINE_TEMPLATES.len() as i64 - 1) as usize];
        let source = NEWS_SOURCES[rng.range_i64(0, NEWS_SOURCES.len() as i64 - 1) as usize];
        let days_ago = rng.range_i64(2, 45) + i * 3;
        let published = now - Duration::days(days_ago) - Duration::hours(rng.range_i64(0, 20));
        entries.push(NewsEntry {
            id: format!("news-{isin}-{i}"),
            headline_en: en.replace("{name}", name),
            headline_de: de.replace("{name}", name),
            source: source.to_string(),
            published,
        });
    }
    entries.sort_by_key(|e| Reverse(e.published));
    entries
}

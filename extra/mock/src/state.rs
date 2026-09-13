//! In-memory state for the mock backend: one seeded, self-consistent dataset (persona, two
//! portfolios, holdings, transactions, savings plans, alerts, groups, an overnight account) plus
//! the derivation/mutation logic every GraphQL handler reads and writes through.
//!
//! Design principles (see the audit in scratchpad/maps/map-mock-backend.md §4):
//! - Identity (`person_id`/`account_id`/portfolio ids) lives here once; handlers never hardcode it.
//! - Numbers that are logically a function of other state (portfolio valuation, cash balance,
//!   portfolio-group performance, total savings-plan amount) are computed on read from the
//!   underlying collections — never stored as a separate, driftable field.
//! - `Holding.quantity`/`fifo_price` are the one exception: like a real broker's position table
//!   they are maintained transactionally (built from the generated transaction ledger at
//!   startup, then kept in lock-step by `place_order`/`cancel_order`) rather than re-derived from
//!   full transaction history on every read — see `fixtures::build` and `MockState::place_order`.

use crate::catalog::{self, Instrument};
use crate::pricing;
use chrono::{DateTime, NaiveDate, Utc};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::RwLock;

/// EUR is the account's reference/settlement currency; USD instruments are converted for
/// aggregate figures (portfolio valuation, cash breakdown) using this fixed mock FX rate.
pub const USD_TO_EUR: f64 = 0.92;

pub fn to_eur(amount: f64, currency: &str) -> f64 {
    match currency {
        "USD" => amount * USD_TO_EUR,
        _ => amount,
    }
}

/// Collapse IEEE-754 negative zero to positive zero — `f64::sum()` over an empty iterator
/// legitimately yields `-0.0` (e.g. a portfolio group with no savings-plan members), and left
/// alone that prints as a confusing `"-0.00"` string or `-0.0` JSON number.
fn no_negative_zero(x: f64) -> f64 {
    if x == 0.0 {
        0.0
    } else {
        x
    }
}

pub fn money(x: f64) -> String {
    format!("{:.2}", no_negative_zero(x))
}

pub fn pct(x: f64) -> String {
    // Enough precision for a raw-fraction percentage (e.g. 0.0125 = 1.25%) without noisy floats.
    let rounded = no_negative_zero((x * 1_000_000.0).round() / 1_000_000.0);
    let s = format!("{:.6}", rounded);
    let trimmed = s.trim_end_matches('0');
    let trimmed = trimmed.trim_end_matches('.');
    if trimmed.is_empty() || trimmed == "-0" {
        "0".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn round2(x: f64) -> f64 {
    no_negative_zero((x * 100.0).round() / 100.0)
}

// ---------------------------------------------------------------------------------------------
// Fixture entity types
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct Holding {
    pub isin: String,
    pub quantity: f64,
    /// Cost basis per share (FIFO-style weighted average of remaining lots), in the instrument's
    /// own currency.
    pub fifo_price: f64,
}

#[derive(Clone, Debug)]
pub struct PriceAlert {
    pub id: String,
    pub isin: Option<String>,
    pub ticker: Option<String>,
    pub price: f64,
    pub direction: String, // "ABOVE" | "BELOW"
    pub is_active: bool,
}

#[derive(Clone, Debug)]
pub struct PortfolioGroup {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub items: Vec<String>, // ISINs
}

#[derive(Clone, Debug)]
pub struct SavingsPlan {
    pub isin: String,
    pub amount: f64,
    pub frequency: String,
    pub day_of_month: u32,
    pub dynamization_rate: f64,
    pub payment_method: String,
    pub next_execution: NaiveDate,
}

/// Which typed GraphQL union member a transaction summary/detail projects as.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TxnShape {
    /// `BrokerSecurityTransactionSummary` / `BrokerSecurityTransaction` — BUY/SELL/SAVINGS_PLAN.
    Security,
    /// `BrokerCashTransactionSummary` / `BrokerCashTransaction` — deposits, withdrawals, interest,
    /// fees, taxes.
    Cash,
    /// `BrokerNonTradeSecurityTransactionSummary` / `BrokerNonTradeSecurityTransaction` —
    /// dividends/distributions.
    NonTradeSecurity,
}

#[derive(Clone, Debug)]
pub struct Transaction {
    pub id: String,
    pub currency: String,
    pub shape: TxnShape,
    /// Top-level GraphQL `type` — one of the CLI's accepted `--type-filter` values (BUY, SELL,
    /// SAVINGS_PLAN, DISTRIBUTION, INTEREST, DEPOSIT, WITHDRAWAL, FEE, TAX, CASH_TRANSFER_IN,
    /// CASH_TRANSFER_OUT).
    pub type_: &'static str,
    pub status: &'static str,
    pub is_cancellation: bool,
    pub last_event: DateTime<Utc>,
    pub description: String,
    pub isin: Option<String>,
    pub quantity: Option<f64>,
    pub amount: f64,
    pub side: Option<&'static str>,
    pub limit_price: Option<f64>,
    pub stop_price: Option<f64>,
}

impl Transaction {
    /// Whether this transaction has actually settled (vs. still pending, cancelled, or rejected)
    /// — the only transactions that count toward cash balances or (for security trades) holdings.
    pub fn is_settled(&self) -> bool {
        matches!(self.status, "FILLED" | "SETTLED" | "CONFIRMED")
    }

    fn typename(&self) -> &'static str {
        match self.shape {
            TxnShape::Security => "BrokerSecurityTransactionSummary",
            TxnShape::Cash => "BrokerCashTransactionSummary",
            TxnShape::NonTradeSecurity => "BrokerNonTradeSecurityTransactionSummary",
        }
    }

    /// The signed cash impact of this transaction on the portfolio's EUR cash balance, or `0.0`
    /// if it hasn't settled.
    fn cash_delta_eur(&self) -> f64 {
        if !self.is_settled() {
            return 0.0;
        }
        let amount_eur = to_eur(self.amount, &self.currency);
        match self.type_ {
            "BUY" | "SAVINGS_PLAN" | "WITHDRAWAL" | "FEE" | "TAX" | "CASH_TRANSFER_OUT" => {
                -amount_eur
            }
            "SELL" | "DISTRIBUTION" | "INTEREST" | "DEPOSIT" | "CASH_TRANSFER_IN" => amount_eur,
            _ => 0.0,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Portfolio {
    pub id: String,
    pub holdings: Vec<Holding>,
    pub watchlist: Vec<String>, // ISINs
    pub price_alerts: Vec<PriceAlert>,
    pub groups: Vec<PortfolioGroup>,
    pub savings_plans: Vec<SavingsPlan>,
    /// Newest first.
    pub transactions: Vec<Transaction>,
}

impl Portfolio {
    pub fn holding(&self, isin: &str) -> Option<&Holding> {
        self.holdings.iter().find(|h| h.isin.eq_ignore_ascii_case(isin))
    }

    /// Sum of `quantity * current_price` per holding, in EUR — the one source of truth for
    /// "portfolio valuation" (no separately-stored total).
    pub fn valuation_eur(&self, seed: u64, now: DateTime<Utc>) -> (f64, f64, f64) {
        let mut securities = 0.0;
        let mut crypto = 0.0;
        for h in &self.holdings {
            let Some(inst) = catalog::find(&h.isin) else {
                continue;
            };
            let price = pricing::current_price(seed, &h.isin, now);
            let value_eur = to_eur(h.quantity * price, inst.currency);
            if inst.asset_class == "CRYPTO" {
                crypto += value_eur;
            } else {
                securities += value_eur;
            }
        }
        (securities, crypto, securities + crypto)
    }

    /// EUR cash balance, folded from every settled transaction's signed cash impact — never
    /// stored, always derived.
    pub fn cash_balance_eur(&self) -> f64 {
        self.transactions.iter().map(Transaction::cash_delta_eur).sum()
    }

    pub fn pending_buy_orders_amount_eur(&self) -> f64 {
        self.transactions
            .iter()
            .filter(|t| t.status == "PENDING" && t.type_ == "BUY")
            .map(|t| to_eur(t.amount, &t.currency))
            .sum()
    }

    pub fn pending_savings_plan_amount_eur(&self) -> f64 {
        self.savings_plans.iter().map(|sp| sp.amount).sum()
    }

    pub fn total_savings_plan_amount(&self) -> f64 {
        self.savings_plans.iter().map(|sp| sp.amount).sum()
    }
}

#[derive(Clone, Debug)]
pub struct OvernightAccount {
    pub id: String,
    pub interest_rate: f64,
    /// Newest first; a mix of DEPOSIT/WITHDRAWAL/INTEREST cash transactions.
    pub transactions: Vec<Transaction>,
}

impl OvernightAccount {
    pub fn balance(&self) -> f64 {
        self.transactions.iter().map(Transaction::cash_delta_eur).sum()
    }
}

#[derive(Clone, Debug)]
pub struct MockState {
    pub seed: u64,
    /// The instant fixtures were generated relative to — used only to build the frozen historical
    /// dataset at startup; handlers use their own live `Utc::now()` for "now"-relative fields.
    pub genesis: DateTime<Utc>,
    pub first_name: String,
    pub last_name: String,
    pub locale: String,
    pub person_id: String,
    pub account_id: String,
    pub default_portfolio_id: String,
    pub portfolios: Vec<Portfolio>,
    pub overnight: OvernightAccount,
    pub next_group_id: u64,
    pub next_alert_id: u64,
    pub next_order_id: u64,
    /// `X-SC-Idempotency-Id` -> order id already minted for it.
    pub idempotency: std::collections::HashMap<String, String>,
}

/// Filters and paging for a transaction listing, mirroring the `moreTransactions` GraphQL
/// input one-for-one so a new filter shows up here rather than as another parameter.
pub struct TransactionQuery<'a> {
    pub page_size: usize,
    pub cursor: usize,
    pub types: Option<&'a [String]>,
    pub statuses: Option<&'a [String]>,
    pub search_term: Option<&'a str>,
    pub isin: Option<&'a str>,
    /// Unix seconds; inclusive bounds on the transaction's last event.
    pub from_time: Option<i64>,
    pub to_time: Option<i64>,
}

/// The fields of a create-or-update savings plan request.
#[derive(Clone, Copy)]
pub struct SavingsPlanInput<'a> {
    pub isin: &'a str,
    pub amount: f64,
    pub frequency: &'a str,
    pub day_of_month: u32,
    pub dynamization_rate: f64,
    pub payment_method: &'a str,
    pub next_execution: NaiveDate,
}

/// The fields of a place-order request. `limit_price` / `stop_price` being `None` is what makes
/// an order marketable, so they are carried together rather than inferred at the call site.
#[derive(Clone, Copy)]
pub struct OrderRequest<'a> {
    pub isin: &'a str,
    pub side: &'a str,
    pub shares: f64,
    pub limit_price: Option<f64>,
    pub stop_price: Option<f64>,
    /// `x-sc-idempotency-id`: replaying it returns the original order id.
    pub idem_key: Option<&'a str>,
}

impl MockState {
    pub fn new(seed: u64, now: DateTime<Utc>) -> Self {
        crate::fixtures::build(seed, now)
    }

    pub fn portfolio_ids(&self) -> Vec<String> {
        self.portfolios.iter().map(|p| p.id.clone()).collect()
    }

    pub fn portfolio(&self, id: Option<&str>) -> &Portfolio {
        let target = id.unwrap_or(&self.default_portfolio_id);
        self.portfolios
            .iter()
            .find(|p| p.id.eq_ignore_ascii_case(target))
            .unwrap_or(&self.portfolios[0])
    }

    pub fn portfolio_mut(&mut self, id: Option<&str>) -> &mut Portfolio {
        let target = id.unwrap_or(&self.default_portfolio_id).to_string();
        let idx = self
            .portfolios
            .iter()
            .position(|p| p.id.eq_ignore_ascii_case(&target))
            .unwrap_or(0);
        &mut self.portfolios[idx]
    }

    // -----------------------------------------------------------------------------------------
    // Response builders — GraphQL-shaped JSON, built from state + catalog + pricing. Handlers in
    // graphql.rs stay thin wrappers around these.
    // -----------------------------------------------------------------------------------------

    fn quote_tick_value(&self, isin: &str, now: DateTime<Utc>) -> (Value, &'static Instrument, f64) {
        let inst = catalog::find(isin).unwrap_or(FALLBACK_INSTRUMENT);
        let mid = pricing::current_price(self.seed, isin, now);
        json!({
            "midPrice": mid,
            "currency": inst.currency,
            "timestampUtc": {"time": now.to_rfc3339()},
            "isOutdated": false
        });
        (
            json!({
                "midPrice": mid,
                "currency": inst.currency,
                "timestampUtc": {"time": now.to_rfc3339()},
                "isOutdated": false
            }),
            inst,
            mid,
        )
    }

    pub fn holdings_for_response(&self, portfolio_id: Option<&str>, now: DateTime<Utc>) -> Value {
        let portfolio = self.portfolio(portfolio_id);
        let items: Vec<Value> = portfolio
            .holdings
            .iter()
            .map(|h| {
                let (quote, inst, mid) = self.quote_tick_value(&h.isin, now);
                // `portfolioIsinPerformance` is this ISIN's contribution to *portfolio*-level
                // figures, so — like `valuation_eur` (overview) and the analytics allocations,
                // which this must foot to — it's in the account's base currency (EUR), not the
                // instrument's own trading currency. `quoteTick`/`fifoPrice` stay native: that's
                // the actual market price / per-share cost basis the instrument trades at.
                let valuation = to_eur(h.quantity * mid, inst.currency);
                json!({
                    "isin": h.isin,
                    "name": inst.name,
                    "type": inst.security_type,
                    "inventory": {
                        "position": {
                            "filled": h.quantity,
                            "pending": 0,
                            "blocked": 0,
                            "fifoPrice": h.fifo_price
                        }
                    },
                    "portfolioIsinPerformance": {
                        "valuation": valuation,
                        "currency": "EUR"
                    },
                    "quoteTick": quote
                })
            })
            .collect();
        json!(items)
    }

    pub fn watchlist_for_response(&self, portfolio_id: Option<&str>, now: DateTime<Utc>) -> Value {
        let portfolio = self.portfolio(portfolio_id);
        let items: Vec<Value> = portfolio
            .watchlist
            .iter()
            .map(|isin| {
                let (quote, inst, _mid) = self.quote_tick_value(isin, now);
                json!({
                    "isin": isin,
                    "name": inst.name,
                    "type": inst.security_type,
                    "quoteTick": quote
                })
            })
            .collect();
        json!(items)
    }

    pub fn search_for_response(&self, term: &str, now: DateTime<Utc>) -> Value {
        let matches = catalog::search(term);
        let items: Vec<Value> = matches
            .iter()
            .map(|inst| {
                let (quote, _inst, _mid) = self.quote_tick_value(inst.isin, now);
                json!({
                    "isin": inst.isin,
                    "name": inst.name,
                    "type": inst.security_type,
                    "quoteTick": quote
                })
            })
            .collect();
        json!(items)
    }

    pub fn price_alerts_for_response(&self, portfolio_id: Option<&str>, active_only: bool) -> Value {
        let portfolio = self.portfolio(portfolio_id);
        let mut by_instrument: std::collections::HashMap<String, Vec<&PriceAlert>> =
            std::collections::HashMap::new();
        for alert in portfolio
            .price_alerts
            .iter()
            .filter(|a| a.isin.is_some() && (!active_only || a.is_active))
        {
            let key = alert.isin.clone().unwrap_or_default();
            by_instrument.entry(key).or_default().push(alert);
        }
        let mut groups = Vec::new();
        for alerts in by_instrument.values() {
            let items: Vec<Value> = alerts
                .iter()
                .map(|a| {
                    let isin = a.isin.clone().unwrap_or_default();
                    let inst = catalog::find(&isin).unwrap_or(FALLBACK_INSTRUMENT);
                    json!({
                        "id": a.id,
                        "direction": a.direction,
                        "isActive": a.is_active,
                        "price": money(a.price),
                        "triggeredTimestamp": null,
                        "security": {"isin": isin, "name": inst.name, "type": inst.security_type}
                    })
                })
                .collect();
            groups.push(json!({"canAddNew": true, "items": items}));
        }
        if groups.is_empty() {
            groups.push(json!({"canAddNew": true, "items": []}));
        }
        json!(groups)
    }

    pub fn crypto_alerts_for_response(&self, portfolio_id: Option<&str>) -> Value {
        let portfolio = self.portfolio(portfolio_id);
        let mut by_ticker: std::collections::HashMap<String, Vec<&PriceAlert>> =
            std::collections::HashMap::new();
        for alert in portfolio.price_alerts.iter().filter(|a| a.ticker.is_some()) {
            by_ticker
                .entry(alert.ticker.clone().unwrap())
                .or_default()
                .push(alert);
        }
        if by_ticker.is_empty() {
            return json!([]);
        }
        let mut groups = Vec::new();
        for alerts in by_ticker.values() {
            let items: Vec<Value> = alerts
                .iter()
                .map(|a| {
                    let ticker = a.ticker.clone().unwrap_or_default();
                    let name = catalog::find_by_symbol(&ticker)
                        .map(|i| i.name)
                        .unwrap_or(&ticker);
                    json!({
                        "id": a.id,
                        "direction": a.direction,
                        "isActive": a.is_active,
                        "price": money(a.price),
                        "triggeredTimestamp": null,
                        "coin": {"ticker": ticker, "name": name}
                    })
                })
                .collect();
            groups.push(json!({"canAddNew": true, "items": items}));
        }
        json!(groups)
    }

    /// `savingsPlanAmount` per crypto coin in the catalog (0 for coins nobody has a plan on) — the
    /// shape `BrokerSavingsPlans.crypto.coins` needs.
    pub fn crypto_savings_plan_coins(&self, _portfolio_id: Option<&str>) -> Value {
        // The mock doesn't model crypto savings plans distinctly from security ones; no crypto
        // coin currently carries one, but the shape is still exercised (empty amounts).
        let coins: Vec<Value> = catalog::by_asset_class("CRYPTO")
            .iter()
            .map(|c| json!({"ticker": c.symbol, "name": c.name, "savingsPlanAmount": "0"}))
            .collect();
        json!(coins)
    }

    pub fn portfolio_groups_for_response(&self, portfolio_id: Option<&str>, seed: u64, now: DateTime<Utc>) -> Value {
        let portfolio = self.portfolio(portfolio_id);
        let groups: Vec<Value> = portfolio
            .groups
            .iter()
            .map(|g| {
                let mut valuation_eur = 0.0;
                let items: Vec<Value> = g
                    .items
                    .iter()
                    .map(|isin| {
                        let inst = catalog::find(isin).unwrap_or(FALLBACK_INSTRUMENT);
                        if let Some(h) = portfolio.holding(isin) {
                            let price = pricing::current_price(seed, isin, now);
                            valuation_eur += to_eur(h.quantity * price, inst.currency);
                        }
                        json!({"id": format!("sec-{isin}"), "isin": isin, "name": inst.name, "type": inst.security_type})
                    })
                    .collect();
                let (abs, rel) = group_since_buy_performance(portfolio, g, seed, now);
                json!({
                    "id": g.id,
                    "details": {"id": g.id, "name": g.name, "description": g.description},
                    "numberOfPendingOrders": portfolio.transactions.iter().filter(|t| t.status == "PENDING" && t.isin.as_deref().map(|i| g.items.iter().any(|gi| gi == i)).unwrap_or(false)).count(),
                    "savingsPlansAmount": money(portfolio.savings_plans.iter().filter(|sp| g.items.contains(&sp.isin)).map(|sp| sp.amount).sum()),
                    "performance": {
                        "id": format!("perf-{}", g.id),
                        "valuation": money(valuation_eur),
                        "currency": "EUR",
                        "performancesByTimeframe": [{"timeframe": "SINCE_BUY", "performance": pct(rel), "simpleAbsoluteReturn": money(abs)}]
                    },
                    "items": items
                })
            })
            .collect();
        let grouped: Vec<&String> = portfolio.groups.iter().flat_map(|g| g.items.iter()).collect();
        let ungrouped: Vec<Value> = portfolio
            .holdings
            .iter()
            .filter(|h| !grouped.contains(&&h.isin))
            .map(|h| {
                let inst = catalog::find(&h.isin).unwrap_or(FALLBACK_INSTRUMENT);
                json!({"id": format!("sec-{}", h.isin), "isin": h.isin, "name": inst.name, "type": inst.security_type})
            })
            .collect();
        json!({
            "portfolioGroups": {
                "offerAllowsAdditionalPortfolioGroup": portfolio.groups.len() < 10,
                "maxPortfolioGroupsPerPortfolioReached": portfolio.groups.len() >= 10,
                "items": groups
            },
            "ungroupedInventoryItems": {"items": ungrouped}
        })
    }

    pub fn savings_plans_for_response(&self, portfolio_id: Option<&str>) -> Value {
        let portfolio = self.portfolio(portfolio_id);
        let items: Vec<Value> = portfolio
            .savings_plans
            .iter()
            .map(|sp| {
                let inst = catalog::find(&sp.isin).unwrap_or(FALLBACK_INSTRUMENT);
                json!({
                    "isin": sp.isin,
                    "name": inst.name,
                    "type": inst.security_type,
                    "inventory": {
                        "savingsPlan": {
                            "isin": sp.isin,
                            "amount": money(sp.amount),
                            "frequency": sp.frequency,
                            "dayOfTheMonth": sp.day_of_month,
                            "dynamizationRate": pct(sp.dynamization_rate),
                            "paymentMethod": sp.payment_method,
                            "nextExecutionDate": {"date": sp.next_execution.format("%Y-%m-%d").to_string(), "epochDay": sp.next_execution.and_hms_opt(0,0,0).unwrap().and_utc().timestamp() / 86400}
                        }
                    }
                })
            })
            .collect();
        json!({
            "totalSavingsPlanAmount": money(portfolio.total_savings_plan_amount()),
            "inventory": {"items": items},
            "crypto": {"coins": self.crypto_savings_plan_coins(Some(&portfolio.id))}
        })
    }

    pub fn transactions_for_response(
        &self,
        portfolio_id: Option<&str>,
        query: &TransactionQuery<'_>,
    ) -> Value {
        let portfolio = self.portfolio(portfolio_id);
        let search_lc = query.search_term.map(|s| s.to_lowercase());
        let filtered: Vec<&Transaction> = portfolio
            .transactions
            .iter()
            .filter(|t| query.types.map(|f| f.iter().any(|v| v == t.type_)).unwrap_or(true))
            .filter(|t| query.statuses.map(|f| f.iter().any(|v| v == t.status)).unwrap_or(true))
            .filter(|t| query.isin.map(|i| t.isin.as_deref() == Some(i)).unwrap_or(true))
            .filter(|t| {
                search_lc
                    .as_ref()
                    .map(|s| t.description.to_lowercase().contains(s))
                    .unwrap_or(true)
            })
            .filter(|t| query.from_time.map(|f| t.last_event.timestamp() >= f).unwrap_or(true))
            .filter(|t| query.to_time.map(|f| t.last_event.timestamp() <= f).unwrap_or(true))
            .collect();
        let total = filtered.len();
        let cursor = query.cursor;
        let end = (cursor + query.page_size).min(total);
        let slice = if cursor < total { &filtered[cursor..end] } else { &[] };
        let next_cursor = if end < total { Some(end.to_string()) } else { None };
        let txns: Vec<Value> = slice.iter().map(|t| transaction_summary_json(t)).collect();
        json!({
            "cursor": next_cursor,
            "total": total,
            "transactions": txns
        })
    }

    pub fn find_transaction(&self, portfolio_id: Option<&str>, id: &str) -> Option<Transaction> {
        self.portfolio(portfolio_id)
            .transactions
            .iter()
            .find(|t| t.id == id)
            .cloned()
    }

    // -----------------------------------------------------------------------------------------
    // Mutations
    // -----------------------------------------------------------------------------------------

    pub fn add_watchlist(&mut self, portfolio_id: Option<&str>, isin: &str) {
        let p = self.portfolio_mut(portfolio_id);
        if !p.watchlist.iter().any(|w| w.eq_ignore_ascii_case(isin)) {
            p.watchlist.push(isin.to_string());
        }
    }

    pub fn remove_watchlist(&mut self, portfolio_id: Option<&str>, isin: &str) {
        let p = self.portfolio_mut(portfolio_id);
        p.watchlist.retain(|w| !w.eq_ignore_ascii_case(isin));
    }

    pub fn add_price_alert(
        &mut self,
        portfolio_id: Option<&str>,
        isin: Option<&str>,
        ticker: Option<&str>,
        price: f64,
    ) -> String {
        let id = format!("alert-{}", self.next_alert_id);
        self.next_alert_id += 1;
        let direction = {
            let p = self.portfolio(portfolio_id);
            let current = isin
                .and_then(|i| p.holding(i).map(|_| i))
                .map(|i| pricing::current_price(self.seed, i, self.genesis))
                .unwrap_or(price);
            if price >= current { "ABOVE" } else { "BELOW" }
        };
        let p = self.portfolio_mut(portfolio_id);
        p.price_alerts.push(PriceAlert {
            id: id.clone(),
            isin: isin.map(str::to_string),
            ticker: ticker.map(str::to_string),
            price,
            direction: direction.to_string(),
            is_active: true,
        });
        id
    }

    pub fn remove_price_alert(&mut self, portfolio_id: Option<&str>, alert_id: &str) -> bool {
        let p = self.portfolio_mut(portfolio_id);
        let before = p.price_alerts.len();
        p.price_alerts.retain(|a| a.id != alert_id);
        p.price_alerts.len() != before
    }

    pub fn upsert_savings_plan(&mut self, portfolio_id: Option<&str>, input: &SavingsPlanInput<'_>) {
        let SavingsPlanInput {
            isin,
            amount,
            frequency,
            day_of_month,
            dynamization_rate,
            payment_method,
            next_execution,
        } = *input;
        let p = self.portfolio_mut(portfolio_id);
        if let Some(existing) = p.savings_plans.iter_mut().find(|s| s.isin.eq_ignore_ascii_case(isin)) {
            existing.amount = amount;
            existing.frequency = frequency.to_string();
            existing.day_of_month = day_of_month;
            existing.dynamization_rate = dynamization_rate;
            existing.payment_method = payment_method.to_string();
            existing.next_execution = next_execution;
        } else {
            p.savings_plans.push(SavingsPlan {
                isin: isin.to_string(),
                amount,
                frequency: frequency.to_string(),
                day_of_month,
                dynamization_rate,
                payment_method: payment_method.to_string(),
                next_execution,
            });
        }
    }

    pub fn remove_savings_plan(&mut self, portfolio_id: Option<&str>, isin: &str) {
        let p = self.portfolio_mut(portfolio_id);
        p.savings_plans.retain(|s| !s.isin.eq_ignore_ascii_case(isin));
    }

    pub fn create_group(&mut self, portfolio_id: Option<&str>, name: &str, description: Option<String>) -> String {
        let id = format!("group-{}", self.next_group_id);
        self.next_group_id += 1;
        let p = self.portfolio_mut(portfolio_id);
        p.groups.push(PortfolioGroup {
            id: id.clone(),
            name: name.to_string(),
            description,
            items: Vec::new(),
        });
        id
    }

    pub fn update_group(
        &mut self,
        portfolio_id: Option<&str>,
        group_id: &str,
        name: Option<&str>,
        description: Option<Option<String>>,
    ) -> bool {
        let p = self.portfolio_mut(portfolio_id);
        if let Some(g) = p.groups.iter_mut().find(|g| g.id == group_id) {
            if let Some(name) = name {
                g.name = name.to_string();
            }
            if let Some(desc) = description {
                g.description = desc;
            }
            true
        } else {
            false
        }
    }

    pub fn delete_group(&mut self, portfolio_id: Option<&str>, group_id: &str) -> bool {
        let p = self.portfolio_mut(portfolio_id);
        let before = p.groups.len();
        p.groups.retain(|g| g.id != group_id);
        p.groups.len() != before
    }

    /// `Ok(())` on success; `Err(isin)` when that ISIN is already a member of the target group.
    pub fn assign_group_items(&mut self, portfolio_id: Option<&str>, group_id: &str, isins: &[String]) -> Result<bool, String> {
        let p = self.portfolio_mut(portfolio_id);
        if !p.groups.iter().any(|g| g.id == group_id) {
            return Ok(false);
        }
        for isin in isins {
            if p.groups.iter().find(|g| g.id == group_id).map(|g| g.items.contains(isin)).unwrap_or(false) {
                return Err(isin.clone());
            }
        }
        for isin in isins {
            for g in p.groups.iter_mut() {
                g.items.retain(|i| i != isin);
            }
            if let Some(target) = p.groups.iter_mut().find(|g| g.id == group_id) {
                target.items.push(isin.clone());
            }
        }
        Ok(true)
    }

    /// `Ok(())` on success; `Err(isin)` when that ISIN is not currently a member of the group.
    pub fn unassign_group_items(&mut self, portfolio_id: Option<&str>, group_id: &str, isins: &[String]) -> Result<bool, String> {
        let p = self.portfolio_mut(portfolio_id);
        let Some(g) = p.groups.iter_mut().find(|g| g.id == group_id) else {
            return Ok(false);
        };
        for isin in isins {
            if !g.items.contains(isin) {
                return Err(isin.clone());
            }
        }
        for isin in isins {
            g.items.retain(|i| i != isin);
        }
        Ok(true)
    }

    /// Places an order. Market orders (no limit/stop price) fill immediately and update the
    /// holding + cash balance; limit/stop orders stay PENDING. Honours idempotency: the same
    /// `idem_key` always returns the same order id without minting a new transaction.
    pub fn place_order(
        &mut self,
        portfolio_id: Option<&str>,
        req: &OrderRequest<'_>,
        now: DateTime<Utc>,
    ) -> (String, bool) {
        let OrderRequest { isin, side, shares, limit_price, stop_price, idem_key } = *req;
        if let Some(key) = idem_key {
            if let Some(existing) = self.idempotency.get(key) {
                let is_market = limit_price.is_none() && stop_price.is_none();
                return (existing.clone(), is_market);
            }
        }

        let inst = catalog::find(isin).unwrap_or(FALLBACK_INSTRUMENT);
        let mid = pricing::current_price(self.seed, isin, now);
        let (bid, ask) = pricing::spread(isin, mid);
        let is_market = limit_price.is_none() && stop_price.is_none();
        let fill_price = if side == "BUY" { ask } else { bid };
        let amount = round2(shares * fill_price);

        let order_id = format!("order-{}", self.next_order_id);
        self.next_order_id += 1;

        let status: &'static str = if is_market { "FILLED" } else { "PENDING" };
        let side_static: &'static str = if side == "SELL" { "SELL" } else { "BUY" };
        let type_static: &'static str = side_static;

        let txn = Transaction {
            id: order_id.clone(),
            currency: inst.currency.to_string(),
            shape: TxnShape::Security,
            type_: type_static,
            status,
            is_cancellation: false,
            last_event: now,
            description: format!("{} {} {}", if side_static == "BUY" { "Buy" } else { "Sell" }, shares, inst.name),
            isin: Some(isin.to_string()),
            quantity: Some(shares),
            amount,
            side: Some(side_static),
            limit_price,
            stop_price,
        };

        let p = self.portfolio_mut(portfolio_id);
        p.transactions.insert(0, txn);

        if is_market {
            if side_static == "BUY" {
                if let Some(h) = p.holdings.iter_mut().find(|h| h.isin.eq_ignore_ascii_case(isin)) {
                    let new_qty = h.quantity + shares;
                    h.fifo_price = (h.quantity * h.fifo_price + shares * fill_price) / new_qty;
                    h.quantity = new_qty;
                } else {
                    p.holdings.push(Holding { isin: isin.to_string(), quantity: shares, fifo_price: fill_price });
                }
            } else if let Some(h) = p.holdings.iter_mut().find(|h| h.isin.eq_ignore_ascii_case(isin)) {
                h.quantity = (h.quantity - shares).max(0.0);
            }
        }

        if let Some(key) = idem_key {
            self.idempotency.insert(key.to_string(), order_id.clone());
        }

        (order_id, is_market)
    }

    pub fn cancel_order(&mut self, portfolio_id: Option<&str>, order_id: &str) -> bool {
        let p = self.portfolio_mut(portfolio_id);
        if let Some(t) = p.transactions.iter_mut().find(|t| t.id == order_id) {
            if t.status == "PENDING" {
                t.status = "CANCELLED";
                t.is_cancellation = true;
                return true;
            }
        }
        false
    }
}

fn group_since_buy_performance(portfolio: &Portfolio, group: &PortfolioGroup, seed: u64, now: DateTime<Utc>) -> (f64, f64) {
    let mut cost = 0.0;
    let mut value = 0.0;
    for isin in &group.items {
        if let Some(h) = portfolio.holding(isin) {
            let inst = catalog::find(isin).unwrap_or(FALLBACK_INSTRUMENT);
            let price = pricing::current_price(seed, isin, now);
            cost += to_eur(h.quantity * h.fifo_price, inst.currency);
            value += to_eur(h.quantity * price, inst.currency);
        }
    }
    let abs = value - cost;
    let rel = if cost != 0.0 { abs / cost } else { 0.0 };
    (abs, rel)
}

fn transaction_summary_json(t: &Transaction) -> Value {
    let mut base = json!({
        "__typename": t.typename(),
        "id": t.id,
        "currency": t.currency,
        "type": t.type_,
        "status": t.status,
        "isCancellation": t.is_cancellation,
        "lastEventDateTime": t.last_event.to_rfc3339(),
        "description": t.description,
        "custodian": if t.shape == TxnShape::Cash { "BANK" } else { "BROKER" },
        "documents": []
    });
    let obj = base.as_object_mut().unwrap();
    match t.shape {
        TxnShape::Security => {
            obj.insert("isin".into(), json!(t.isin));
            obj.insert("securityTransactionType".into(), json!(t.side));
            obj.insert("quantity".into(), json!(t.quantity));
            obj.insert("amount".into(), json!(t.amount));
            obj.insert("side".into(), json!(t.side));
            obj.insert("limitPrice".into(), json!(t.limit_price));
            obj.insert("stopPrice".into(), json!(t.stop_price));
        }
        TxnShape::Cash => {
            obj.insert("relatedIsin".into(), json!(t.isin));
            obj.insert("cashTransactionType".into(), json!(t.type_));
            obj.insert("amount".into(), json!(t.amount));
        }
        TxnShape::NonTradeSecurity => {
            obj.insert("isin".into(), json!(t.isin));
            obj.insert("nonTradeSecurityTransactionType".into(), json!(t.type_));
            obj.insert("quantity".into(), json!(t.quantity));
            obj.insert("amount".into(), json!(t.amount));
        }
    }
    base
}

/// Fallback instrument used only when an ISIN outside the catalog is requested — keeps handlers
/// total functions instead of needing to thread `Option` everywhere for an edge case a real
/// backend would answer with `NOT_FOUND` (out of scope for this mock's error simulation).
static FALLBACK_INSTRUMENT: &Instrument = &Instrument {
    isin: "UNKNOWN0000",
    wkn: "UNKNOWN",
    symbol: "UNKNOWN",
    name: "Unknown Security",
    security_type: "EQ",
    asset_class: "EQUITY",
    sector: "DIVERSIFIED",
    region: "GLOBAL",
    currency: "EUR",
    base_price: 100.0,
    annual_vol: 0.2,
    annual_drift: 0.0,
    dividend_yield: 0.0,
    distributing: false,
    ter: 0.0,
    venues: &["GETTEX"],
    savings_plan_eligible: false,
    is_derivative: false,
    underlying_isin: None,
};

pub type SharedState = Arc<RwLock<MockState>>;

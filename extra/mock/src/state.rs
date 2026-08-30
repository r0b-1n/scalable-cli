use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Holding {
    pub isin: String,
    pub name: String,
    pub r#type: String,
    pub quantity: f64,
    pub fifo_price: f64,
    pub valuation: f64,
    pub currency: String,
    pub mid_price: f64,
    pub is_outdated: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WatchlistItem {
    pub isin: String,
    pub name: String,
    pub r#type: String,
    pub mid_price: f64,
    pub currency: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PriceAlert {
    pub id: String,
    pub isin: Option<String>,
    pub ticker: Option<String>,
    pub price: String,
    pub direction: String,
    pub is_active: bool,
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PortfolioGroup {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub items: Vec<String>, // ISINs
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SavingsPlan {
    pub isin: String,
    pub name: String,
    pub amount: String,
    pub frequency: String,
    pub day_of_month: u8,
    pub dynamization_rate: String,
    pub payment_method: String,
    pub next_execution_date: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Transaction {
    pub id: String,
    pub currency: String,
    pub r#type: String,
    pub status: String,
    pub is_cancellation: bool,
    pub last_event: String,
    pub description: String,
    pub isin: Option<String>,
    pub quantity: Option<f64>,
    pub amount: Option<f64>,
    pub side: Option<String>,
}

#[derive(Clone, Debug)]
pub struct MockState {
    pub person_id: String,
    pub account_id: String,
    pub portfolio_id: String,
    pub portfolios: Vec<String>,
    pub holdings: Vec<Holding>,
    pub watchlist: Vec<WatchlistItem>,
    pub price_alerts: Vec<PriceAlert>,
    pub portfolio_groups: Vec<PortfolioGroup>,
    pub savings_plans: Vec<SavingsPlan>,
    pub transactions: Vec<Transaction>,
    pub instruments: Vec<Holding>, // for search
    pub derivatives: Vec<Value>,
    pub next_group_id: usize,
    pub next_alert_id: usize,
    pub next_order_id: usize,
}

impl MockState {
    pub fn new() -> Self {
        let holdings = vec![
            Holding {
                isin: "US0378331005".to_string(),
                name: "Apple Inc.".to_string(),
                r#type: "EQ".to_string(),
                quantity: 10.0,
                fifo_price: 150.0,
                valuation: 1800.0,
                currency: "USD".to_string(),
                mid_price: 180.0,
                is_outdated: false,
            },
            Holding {
                isin: "IE00B4L5Y983".to_string(),
                name: "iShares Core MSCI World".to_string(),
                r#type: "ETF".to_string(),
                quantity: 25.0,
                fifo_price: 70.0,
                valuation: 2100.0,
                currency: "EUR".to_string(),
                mid_price: 84.0,
                is_outdated: false,
            },
            Holding {
                isin: "DE0007100000".to_string(),
                name: "Mercedes-Benz Group".to_string(),
                r#type: "EQ".to_string(),
                quantity: 5.0,
                fifo_price: 55.0,
                valuation: 290.0,
                currency: "EUR".to_string(),
                mid_price: 58.0,
                is_outdated: false,
            },
            Holding {
                isin: "US88160R1014".to_string(),
                name: "Tesla Inc.".to_string(),
                r#type: "EQ".to_string(),
                quantity: 3.0,
                fifo_price: 200.0,
                valuation: 750.0,
                currency: "USD".to_string(),
                mid_price: 250.0,
                is_outdated: false,
            },
            Holding {
                isin: "IE00B4ND3602".to_string(),
                name: "iShares Physical Gold".to_string(),
                r#type: "ETF".to_string(),
                quantity: 12.0,
                fifo_price: 35.0,
                valuation: 420.0,
                currency: "EUR".to_string(),
                mid_price: 35.5,
                is_outdated: false,
            },
        ];
        let instruments = holdings.clone();
        let watchlist = vec![
            WatchlistItem {
                isin: "US0378331005".to_string(),
                name: "Apple Inc.".to_string(),
                r#type: "EQ".to_string(),
                mid_price: 180.0,
                currency: "USD".to_string(),
            },
            WatchlistItem {
                isin: "DE0007100000".to_string(),
                name: "Mercedes-Benz Group".to_string(),
                r#type: "EQ".to_string(),
                mid_price: 58.0,
                currency: "EUR".to_string(),
            },
        ];
        let price_alerts = vec![
            PriceAlert {
                id: "alert-1".to_string(),
                isin: Some("US0378331005".to_string()),
                ticker: None,
                price: "200.00".to_string(),
                direction: "ABOVE".to_string(),
                is_active: true,
                name: "Apple Inc.".to_string(),
            },
            PriceAlert {
                id: "alert-2".to_string(),
                isin: None,
                ticker: Some("BTC".to_string()),
                price: "50000.00".to_string(),
                direction: "ABOVE".to_string(),
                is_active: true,
                name: "Bitcoin".to_string(),
            },
        ];
        let portfolio_groups = vec![
            PortfolioGroup {
                id: "group-1".to_string(),
                name: "Tech".to_string(),
                description: Some("Tech stocks".to_string()),
                items: vec!["US0378331005".to_string(), "US88160R1014".to_string()],
            },
            PortfolioGroup {
                id: "group-2".to_string(),
                name: "ETFs".to_string(),
                description: None,
                items: vec!["IE00B4L5Y983".to_string()],
            },
        ];
        let savings_plans = vec![SavingsPlan {
            isin: "IE00B4L5Y983".to_string(),
            name: "iShares Core MSCI World".to_string(),
            amount: "100".to_string(),
            frequency: "MONTHLY".to_string(),
            day_of_month: 1,
            dynamization_rate: "0".to_string(),
            payment_method: "REFERENCE_ACCOUNT".to_string(),
            next_execution_date: "2026-09-01".to_string(),
        }];
        let transactions = vec![
            Transaction {
                id: "txn-1".to_string(),
                currency: "EUR".to_string(),
                r#type: "TRADE".to_string(),
                status: "FILLED".to_string(),
                is_cancellation: false,
                last_event: "2026-03-10T12:00:00Z".to_string(),
                description: "Buy Apple".to_string(),
                isin: Some("US0378331005".to_string()),
                quantity: Some(2.0),
                amount: Some(360.0),
                side: Some("BUY".to_string()),
            },
            Transaction {
                id: "txn-2".to_string(),
                currency: "EUR".to_string(),
                r#type: "SAVINGS_PLAN".to_string(),
                status: "SETTLED".to_string(),
                is_cancellation: false,
                last_event: "2026-03-09T10:00:00Z".to_string(),
                description: "Savings plan".to_string(),
                isin: Some("IE00B4L5Y983".to_string()),
                quantity: Some(1.5),
                amount: Some(100.0),
                side: Some("BUY".to_string()),
            },
            Transaction {
                id: "order-123".to_string(),
                currency: "EUR".to_string(),
                r#type: "TRADE".to_string(),
                status: "PENDING".to_string(),
                is_cancellation: false,
                last_event: "2026-03-11T09:00:00Z".to_string(),
                description: "Pending order".to_string(),
                isin: Some("US0378331005".to_string()),
                quantity: Some(5.0),
                amount: Some(900.0),
                side: Some("BUY".to_string()),
            },
        ];
        let derivatives = vec![
            json!({
                "__typename": "KnockoutSearchResult",
                "id": "deriv-1",
                "isin": "DE000HS12345",
                "underlyingIsin": "US0378331005",
                "issuer": "HSBC",
                "strategy": "LONG",
                "productSubcategory": "TURBO",
                "leverage": 5.2,
                "knockoutBarrier": {"__typename": "Money", "currencyIsoCode": "USD", "value": 150.0},
                "distanceToKnockout": 0.12,
                "strike": {"__typename": "Money", "currencyIsoCode": "USD", "value": 145.0},
                "distanceToStrike": 0.15,
                "premiumAbsolute": {"currencyIsoCode": "EUR", "value": 2.5},
                "premiumPercentage": 0.014,
                "expiryDate": {"date": {"date": "2026-12-31", "epochDay": 20453}, "isOpenEnd": false}
            }),
            json!({
                "__typename": "WarrantSearchResult",
                "id": "deriv-2",
                "isin": "DE000HS54321",
                "underlyingIsin": "US0378331005",
                "issuer": "HSBC",
                "strategy": "CALL",
                "strike": {"__typename": "Money", "currencyIsoCode": "USD", "value": 190.0},
                "distanceToStrike": 0.05,
                "omega": 3.5,
                "delta": 0.6,
                "impliedVolatility": 0.3,
                "expiryDate": {"epochDay": 20453}
            }),
        ];
        Self {
            person_id: "person-1".to_string(),
            account_id: "account-1".to_string(),
            portfolio_id: "portfolio-1".to_string(),
            portfolios: vec!["portfolio-1".to_string(), "portfolio-2".to_string()],
            holdings,
            watchlist,
            price_alerts,
            portfolio_groups,
            savings_plans,
            transactions,
            instruments,
            derivatives,
            next_group_id: 3,
            next_alert_id: 3,
            next_order_id: 1000,
        }
    }

    pub fn holdings_for_response(&self) -> Value {
        let items: Vec<Value> = self
            .holdings
            .iter()
            .map(|h| {
                json!({
                    "isin": h.isin,
                    "name": h.name,
                    "type": h.r#type,
                    "inventory": {
                        "position": {
                            "filled": h.quantity,
                            "pending": 0,
                            "blocked": 0,
                            "fifoPrice": h.fifo_price
                        }
                    },
                    "portfolioIsinPerformance": {
                        "valuation": h.valuation,
                        "currency": h.currency
                    },
                    "quoteTick": {
                        "midPrice": h.mid_price,
                        "currency": h.currency,
                        "timestampUtc": {"time": Utc::now().to_rfc3339()},
                        "isOutdated": h.is_outdated
                    }
                })
            })
            .collect();
        json!(items)
    }

    pub fn watchlist_for_response(&self) -> Value {
        let items: Vec<Value> = self
            .watchlist
            .iter()
            .map(|w| {
                json!({
                    "isin": w.isin,
                    "name": w.name,
                    "type": w.r#type,
                    "quoteTick": {
                        "midPrice": w.mid_price,
                        "currency": w.currency,
                        "timestampUtc": {"time": Utc::now().to_rfc3339()},
                        "isOutdated": false
                    }
                })
            })
            .collect();
        json!(items)
    }

    pub fn price_alerts_for_response(&self, active_only: bool) -> Value {
        let filtered: Vec<&PriceAlert> = self
            .price_alerts
            .iter()
            .filter(|a| !active_only || a.is_active)
            .collect();
        // Group by isin/ticker
        let mut by_instrument: HashMap<String, Vec<&PriceAlert>> = HashMap::new();
        for alert in filtered {
            let key = alert.isin.clone().unwrap_or_else(|| alert.ticker.clone().unwrap_or_default());
            by_instrument.entry(key).or_default().push(alert);
        }
        let mut items_per_instrument = Vec::new();
        for alerts in by_instrument.values() {
            let items: Vec<Value> = alerts
                .iter()
                .map(|a| {
                    json!({
                        "id": a.id,
                        "direction": a.direction,
                        "isActive": a.is_active,
                        "price": a.price,
                        "triggeredTimestamp": null,
                        "security": {
                            "isin": a.isin,
                            "name": a.name,
                            "type": "EQ"
                        }
                    })
                })
                .collect();
            items_per_instrument.push(json!({
                "canAddNew": true,
                "items": items
            }));
        }
        if items_per_instrument.is_empty() {
            items_per_instrument.push(json!({
                "canAddNew": true,
                "items": []
            }));
        }
        json!(items_per_instrument)
    }

    pub fn crypto_alerts_for_response(&self) -> Value {
        // Filter ticker based
        let crypto: Vec<&PriceAlert> = self
            .price_alerts
            .iter()
            .filter(|a| a.ticker.is_some())
            .collect();
        if crypto.is_empty() {
            return json!([]);
        }
        let mut by_ticker: HashMap<String, Vec<&PriceAlert>> = HashMap::new();
        for alert in crypto {
            let key = alert.ticker.clone().unwrap();
            by_ticker.entry(key).or_default().push(alert);
        }
        let mut items_per_instrument = Vec::new();
        for alerts in by_ticker.values() {
            let items: Vec<Value> = alerts
                .iter()
                .map(|a| {
                    json!({
                        "id": a.id,
                        "direction": a.direction,
                        "isActive": a.is_active,
                        "price": a.price,
                        "triggeredTimestamp": null,
                        "coin": {
                            "ticker": a.ticker,
                            "name": a.name
                        }
                    })
                })
                .collect();
            items_per_instrument.push(json!({
                "canAddNew": true,
                "items": items
            }));
        }
        json!(items_per_instrument)
    }

    pub fn portfolio_groups_for_response(&self) -> Value {
        let groups: Vec<Value> = self
            .portfolio_groups
            .iter()
            .map(|g| {
                json!({
                    "id": g.id,
                    "details": {
                        "id": g.id,
                        "name": g.name,
                        "description": g.description
                    },
                    "numberOfPendingOrders": 0,
                    "savingsPlansAmount": "0",
                    "performance": {
                        "id": format!("perf-{}", g.id),
                        "valuation": "1000.00",
                        "currency": "EUR",
                        "performancesByTimeframe": [{"timeframe": "SINCE_BUY", "performance": "0.10", "simpleAbsoluteReturn": "100.00"}]
                    },
                    "items": g.items.iter().map(|isin| {
                        let h = self.holdings.iter().find(|h| &h.isin == isin);
                        json!({
                            "id": format!("sec-{}", isin),
                            "isin": isin,
                            "name": h.map(|h| h.name.clone()).unwrap_or_else(|| isin.clone()),
                            "type": h.map(|h| h.r#type.clone()).unwrap_or_else(|| "EQ".to_string())
                        })
                    }).collect::<Vec<_>>()
                })
            })
            .collect();
        // ungrouped: holdings not in any group
        let grouped_isins: Vec<String> = self.portfolio_groups.iter().flat_map(|g| g.items.clone()).collect();
        let ungrouped: Vec<Value> = self
            .holdings
            .iter()
            .filter(|h| !grouped_isins.contains(&h.isin))
            .map(|h| {
                json!({
                    "id": format!("sec-{}", h.isin),
                    "isin": h.isin,
                    "name": h.name,
                    "type": h.r#type
                })
            })
            .collect();
        json!({
            "portfolioGroups": {
                "offerAllowsAdditionalPortfolioGroup": true,
                "maxPortfolioGroupsPerPortfolioReached": false,
                "items": groups
            },
            "ungroupedInventoryItems": {
                "items": ungrouped
            }
        })
    }
}

pub type SharedState = Arc<RwLock<MockState>>;

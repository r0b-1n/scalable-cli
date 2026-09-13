//! The single `/graphql` endpoint: operation dispatch plus one `handle_*` function per GraphQL
//! operation the CLI sends (see scratchpad/maps/map-graphql-contract.md). Every handler is a thin
//! wrapper: it reads variables, calls into `state`/`catalog`/`pricing`, and shapes the result into
//! the exact selection set the CLI's projection code in `broker_projections.rs` expects.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json},
};
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::catalog::{self, Instrument};
use crate::fixtures;
use crate::pricing::{self, Timeframe};
use crate::rng::Rng;
use crate::state::{
    money, pct, round2, to_eur, OrderRequest, SavingsPlanInput, SharedState, TransactionQuery,
};

// =================================================================================================
// Dispatch
// =================================================================================================

/// The CLI sends the operation name as snake_case `operation_name` in the JSON body (see
/// map-graphql-contract.md §0) — NOT `operationName`. Both are accepted here since a hand-rolled
/// client might send either; the query-substring scan is kept only as a last-resort fallback for
/// truly anonymous requests.
fn detect_operation(query: &str, body: &Value) -> String {
    for key in ["operation_name", "operationName"] {
        if let Some(name) = body.get(key).and_then(Value::as_str) {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    let mapping: &[(&str, &str)] = &[
        ("BrokerOverview", "BrokerOverview"),
        ("BrokerAnalytics", "BrokerAnalytics"),
        ("BrokerLimits", "BrokerLimits"),
        ("BrokerHoldings", "BrokerHoldings"),
        ("BrokerWatchlist", "BrokerWatchlist"),
        ("BrokerSecuritySearch", "BrokerSecuritySearch"),
        ("BrokerDerivativesSearch", "BrokerDerivativesSearch"),
        ("BrokerQuote", "BrokerQuote"),
        ("BrokerChart", "BrokerChart"),
        ("BrokerSecurityNews", "BrokerSecurityNews"),
        ("BrokerPriceAlerts", "BrokerPriceAlerts"),
        ("BrokerCryptoPriceAlerts", "BrokerCryptoPriceAlerts"),
        ("BrokerTransactions", "BrokerTransactions"),
        ("BrokerTransactionDetails", "BrokerTransactionDetails"),
        ("BrokerSavingsPlans", "BrokerSavingsPlans"),
        ("BrokerSavingsPlanConfig", "BrokerSavingsPlanConfig"),
        ("BrokerSavingsPlanExAnteCost", "BrokerSavingsPlanExAnteCost"),
        ("BrokerSavingsPlanByIsin", "BrokerSavingsPlanByIsin"),
        ("BrokerPortfolioGroups", "BrokerPortfolioGroups"),
        ("ResolveBrokerIds", "ResolveBrokerIds"),
        ("WhoAmI", "WhoAmI"),
        ("Is2faOnLoginEnabled", "Is2faOnLoginEnabled"),
        ("Start2faOnLogin", "Start2faOnLogin"),
        ("Validate2faOnLogin", "Validate2faOnLogin"),
        ("getTradingTradability", "getTradingTradability"),
        ("getSecurityTick", "getSecurityTick"),
        ("getSingleTradeExAnteCost", "getSingleTradeExAnteCost"),
        ("getBrokerAppropriatenessWarning", "getBrokerAppropriatenessWarning"),
        ("createFillForecast", "createFillForecast"),
        ("placeOrder", "placeOrder"),
        ("BrokerCancelOrder", "BrokerCancelOrder"),
        ("revokeAuthAccessToken", "revokeAuthAccessToken"),
        ("DiscoverOvernightAccounts", "DiscoverOvernightAccounts"),
        ("OvernightSummary", "OvernightSummary"),
        ("OvernightTransactions", "OvernightTransactions"),
        ("BrokerAddToWatchlist", "BrokerAddToWatchlist"),
        ("BrokerRemoveFromWatchlist", "BrokerRemoveFromWatchlist"),
        ("BrokerAddPriceAlert", "BrokerAddPriceAlert"),
        ("BrokerAddCryptoPriceAlert", "BrokerAddCryptoPriceAlert"),
        ("BrokerRemovePriceAlert", "BrokerRemovePriceAlert"),
        ("BrokerRemoveCryptoPriceAlert", "BrokerRemoveCryptoPriceAlert"),
        ("BrokerRemoveSavingsPlan", "BrokerRemoveSavingsPlan"),
        ("BrokerCreateOrUpdateSavingsPlan", "BrokerCreateOrUpdateSavingsPlan"),
        ("BrokerCreatePortfolioGroup", "BrokerCreatePortfolioGroup"),
        ("BrokerUpdatePortfolioGroup", "BrokerUpdatePortfolioGroup"),
        ("BrokerDeletePortfolioGroup", "BrokerDeletePortfolioGroup"),
        ("BrokerAssignPortfolioGroupItems", "BrokerAssignPortfolioGroupItems"),
        ("BrokerUnassignPortfolioGroupItems", "BrokerUnassignPortfolioGroupItems"),
        ("addToWatchlist", "BrokerAddToWatchlist"),
        ("removeFromWatchlist", "BrokerRemoveFromWatchlist"),
        ("addPriceAlert", "BrokerAddPriceAlert"),
        ("addCryptoPriceAlert", "BrokerAddCryptoPriceAlert"),
        ("removePriceAlert", "BrokerRemovePriceAlert"),
        ("removeCryptoPriceAlert", "BrokerRemoveCryptoPriceAlert"),
        ("removeSavingsPlan", "BrokerRemoveSavingsPlan"),
        ("createOrUpdateSavingsPlan", "BrokerCreateOrUpdateSavingsPlan"),
        ("createPortfolioGroup", "BrokerCreatePortfolioGroup"),
        ("modifyPortfolioGroup", "modifyPortfolioGroup"),
        ("deletePortfolioGroup", "BrokerDeletePortfolioGroup"),
        ("cancelOrder", "BrokerCancelOrder"),
    ];
    for (needle, op) in mapping {
        if query.contains(needle) {
            return op.to_string();
        }
    }
    for keyword in ["query ", "mutation "] {
        if let Some(start) = query.find(keyword) {
            let rest = &query[start..];
            if let Some(name) = rest.split_whitespace().nth(1) {
                return name.trim_matches(|c| c == '{' || c == '(').to_string();
            }
        }
    }
    "Unknown".to_string()
}

fn graphql_error(message: impl Into<String>, code: &str) -> Value {
    json!({"errors": [{"message": message.into(), "extensions": {"code": code}}]})
}

pub async fn graphql_handler(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let query = body.get("query").and_then(Value::as_str).unwrap_or("");
    let variables = body.get("variables").cloned().unwrap_or_else(|| json!({}));
    let op = detect_operation(query, &body);
    let now = Utc::now();

    // The mock is deliberately lenient: Authorization/DPoP headers are accepted but not verified,
    // since it only ever serves fixture data on loopback.
    let _ = &headers;

    let response_data = match op.as_str() {
        "WhoAmI" => handle_whoami(&state, &variables).await,
        "ResolveBrokerIds" => handle_resolve_broker_ids(&state, &variables).await,
        "Is2faOnLoginEnabled" => json!({"is2faOnLoginEnabled": {"enabled": false, "hasApprovedSession": true}}),
        "Start2faOnLogin" => json!({"start2faOnLogin": {"mfaSessionId": "mock-mfa-1"}}),
        "Validate2faOnLogin" => json!({"validate2faOnLogin": {"status": "SUCCESS"}}),
        "revokeAuthAccessToken" => json!({"revokeAuthAccessToken": true}),
        "BrokerOverview" => handle_broker_overview(&state, &variables, now).await,
        "BrokerAnalytics" => handle_broker_analytics(&state, &variables, now).await,
        "BrokerLimits" => handle_broker_limits(&state, &variables).await,
        "BrokerHoldings" => handle_broker_holdings(&state, &variables, now).await,
        "BrokerWatchlist" => handle_broker_watchlist(&state, &variables, now).await,
        "BrokerSecuritySearch" => handle_broker_search(&state, &variables, now).await,
        "BrokerDerivativesSearch" => handle_derivatives_search(&state, &variables, now).await,
        "BrokerQuote" => handle_broker_quote(&state, &variables, now).await,
        "BrokerChart" => handle_broker_chart(&state, &variables, now).await,
        "BrokerSecurityNews" => handle_security_news(&state, &variables, now).await,
        "BrokerPriceAlerts" => handle_price_alerts(&state, &variables).await,
        "BrokerCryptoPriceAlerts" => handle_crypto_price_alerts(&state, &variables).await,
        "BrokerTransactions" => handle_broker_transactions(&state, &variables).await,
        "BrokerTransactionDetails" => handle_transaction_details(&state, &variables).await,
        "BrokerSavingsPlans" => handle_savings_plans(&state, &variables).await,
        "BrokerSavingsPlanConfig" => handle_savings_plan_config(&state, &variables).await,
        "BrokerSavingsPlanExAnteCost" => handle_savings_plan_ex_ante(&state, &variables).await,
        "BrokerSavingsPlanByIsin" => handle_savings_plan_by_isin(&state, &variables).await,
        "BrokerPortfolioGroups" => handle_portfolio_groups(&state, &variables, now).await,
        "DiscoverOvernightAccounts" => handle_discover_overnight(&state, &variables).await,
        "OvernightSummary" => handle_overnight_summary(&state, &variables, now).await,
        "OvernightTransactions" => handle_overnight_transactions(&state, &variables).await,
        "getTradingTradability" => handle_tradability(&state, &variables).await,
        "getSecurityTick" => handle_security_tick(&state, &variables, now).await,
        "getSingleTradeExAnteCost" => handle_single_ex_ante(&state, &variables).await,
        "getBrokerAppropriatenessWarning" => json!({
            "brokerAppropriatenessWarning": {
                "id": "warn-1",
                "version": "v1",
                "locale": "en-DE",
                "promptText": "This instrument is a leveraged product that can result in the total loss of your investment. Do you want to proceed?",
                "acknowledgementText": "I acknowledge the risk of a total loss and want to proceed."
            }
        }),
        "createFillForecast" => json!({
            "createFillForecast": {
                "statusCategory": "AVAILABLE",
                "fillForecastResponse": {
                    "id": "forecast-1",
                    "limitFillProbabilities": [0.9],
                    "limitRelativePrices": [1.0],
                    "stopFillProbabilities": [0.8],
                    "stopRelativePrices": [1.0],
                    "validUntil": {"epochSecond": (now + Duration::days(1)).timestamp()}
                }
            }
        }),
        "placeOrder" => handle_place_order(&state, &variables, &headers, now).await,
        "BrokerCancelOrder" | "cancelOrder" => handle_cancel_order(&state, &variables).await,
        "BrokerAddToWatchlist" | "addToWatchlist" => handle_add_watchlist(&state, &variables).await,
        "BrokerRemoveFromWatchlist" | "removeFromWatchlist" => handle_remove_watchlist(&state, &variables).await,
        "BrokerAddPriceAlert" | "addPriceAlert" => handle_add_price_alert(&state, &variables).await,
        "BrokerAddCryptoPriceAlert" | "addCryptoPriceAlert" => handle_add_crypto_alert(&state, &variables).await,
        "BrokerRemovePriceAlert" | "removePriceAlert" => handle_remove_price_alert(&state, &variables, true).await,
        "BrokerRemoveCryptoPriceAlert" | "removeCryptoPriceAlert" => handle_remove_price_alert(&state, &variables, false).await,
        "BrokerRemoveSavingsPlan" | "removeSavingsPlan" => handle_remove_savings_plan(&state, &variables).await,
        "BrokerCreateOrUpdateSavingsPlan" | "createOrUpdateSavingsPlan" => handle_create_savings_plan(&state, &variables).await,
        "BrokerCreatePortfolioGroup" | "createPortfolioGroup" => handle_create_group(&state, &variables).await,
        "BrokerUpdatePortfolioGroup" => handle_update_group(&state, &variables).await,
        "BrokerDeletePortfolioGroup" | "deletePortfolioGroup" => handle_delete_group(&state, &variables).await,
        "BrokerAssignPortfolioGroupItems" => handle_assign_group(&state, &variables).await,
        "BrokerUnassignPortfolioGroupItems" => handle_unassign_group(&state, &variables).await,
        "modifyPortfolioGroup" => handle_modify_group_dispatch(&state, &variables).await,
        _ => {
            tracing::warn!(operation = %op, query_snippet = %query.chars().take(200).collect::<String>(), "unknown GraphQL operation");
            graphql_error(format!("Unknown operation: {op}"), "UNKNOWN_OPERATION")
        }
    };

    if let Some(errors) = response_data.get("errors") {
        return (StatusCode::OK, Json(json!({"errors": errors, "data": null}))).into_response();
    }
    (StatusCode::OK, Json(json!({"data": response_data}))).into_response()
}

// =================================================================================================
// Variable extraction helpers
// =================================================================================================

fn var_str<'a>(variables: &'a Value, key: &str) -> Option<&'a str> {
    variables.get(key).and_then(Value::as_str)
}

fn portfolio_id_of(variables: &Value) -> Option<String> {
    var_str(variables, "portfolioId").map(str::to_string)
}

/// Numeric GraphQL scalars declared `BigDecimal`/`PositiveBigDecimal` travel as either a JSON
/// number or a decimal string depending on call site; accept both.
fn loose_f64(v: Option<&Value>) -> Option<f64> {
    v.and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok())))
}

fn str_array(v: Option<&Value>) -> Option<Vec<String>> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
}

// =================================================================================================
// Session / identity
// =================================================================================================

async fn handle_whoami(state: &SharedState, variables: &Value) -> Value {
    let st = state.read().await;
    let id = var_str(variables, "id").unwrap_or(&st.person_id);
    json!({
        "personOverview": {
            "id": id,
            "externalId": format!("ext-{}", st.person_id),
            "locale": st.locale,
            "personalDetails": {"firstName": st.first_name, "lastName": st.last_name}
        }
    })
}

async fn handle_resolve_broker_ids(state: &SharedState, _variables: &Value) -> Value {
    let st = state.read().await;
    json!({
        "account": {
            "id": st.account_id,
            "brokerPortfolios": st.portfolio_ids().iter().map(|id| json!({"id": id})).collect::<Vec<_>>()
        }
    })
}

// =================================================================================================
// Portfolio overview / analytics / limits
// =================================================================================================

fn portfolio_absolute_return(seed: u64, portfolio: &crate::state::Portfolio, tf: Timeframe, now: DateTime<Utc>) -> f64 {
    portfolio
        .holdings
        .iter()
        .filter_map(|h| {
            let inst = catalog::find(&h.isin)?;
            let (abs, _rel) = pricing::performance(seed, &h.isin, tf, now);
            Some(to_eur(abs * h.quantity, inst.currency))
        })
        .sum()
}

async fn handle_broker_overview(state: &SharedState, variables: &Value, now: DateTime<Utc>) -> Value {
    let st = state.read().await;
    let portfolio_id = portfolio_id_of(variables);
    let include_ytd = variables.get("includeYearToDate").and_then(Value::as_bool).unwrap_or(false);
    let portfolio = st.portfolio(portfolio_id.as_deref());
    let (securities, crypto, total) = portfolio.valuation_eur(st.seed, now);

    let mut timeframes = vec![
        json!({"timeframe": "ONE_DAY", "simpleAbsoluteReturn": round2(portfolio_absolute_return(st.seed, portfolio, Timeframe::TwoDays, now))}),
        json!({"timeframe": "ONE_WEEK", "simpleAbsoluteReturn": round2(portfolio_absolute_return(st.seed, portfolio, Timeframe::OneWeek, now))}),
        json!({"timeframe": "ONE_MONTH", "simpleAbsoluteReturn": round2(portfolio_absolute_return(st.seed, portfolio, Timeframe::OneMonth, now))}),
    ];
    if include_ytd {
        timeframes.push(json!({"timeframe": "YEAR_TO_DATE", "simpleAbsoluteReturn": round2(portfolio_absolute_return(st.seed, portfolio, Timeframe::YearToDate, now))}));
    }

    json!({
        "account": {
            "brokerPortfolio": {
                "valuation": {
                    "valuation": round2(total),
                    "securitiesValuation": round2(securities),
                    "cryptoValuation": round2(crypto),
                    "timestampUtc": {"time": now.to_rfc3339()},
                    "lastInventoryUpdateTimestampUtc": {"time": now.to_rfc3339()},
                    "timeWeightedReturnByTimeframe": timeframes
                }
            }
        }
    })
}

fn allocation_positions<F>(portfolio: &crate::state::Portfolio, seed: u64, now: DateTime<Utc>, key_fn: F) -> Vec<Value>
where
    F: Fn(&Instrument) -> &'static str,
{
    struct Member<'a> {
        isin: &'a str,
        quantity: f64,
        inst: &'static Instrument,
        value_eur: f64,
    }
    let mut groups: HashMap<&'static str, Vec<Member>> = HashMap::new();
    let mut total = 0.0;
    for h in &portfolio.holdings {
        let Some(inst) = catalog::find(&h.isin) else { continue };
        let price = pricing::current_price(seed, &h.isin, now);
        let value_eur = to_eur(h.quantity * price, inst.currency);
        total += value_eur;
        groups
            .entry(key_fn(inst))
            .or_default()
            .push(Member { isin: &h.isin, quantity: h.quantity, inst, value_eur });
    }
    let mut positions: Vec<(f64, Value)> = groups
        .into_iter()
        .map(|(name, members)| {
            let group_val: f64 = members.iter().map(|m| m.value_eur).sum();
            let weight = if total > 0.0 { group_val / total } else { 0.0 };
            let contributors: Vec<Value> = members
                .iter()
                .map(|m| {
                    json!({
                        "id": format!("contrib-{}", m.isin),
                        "weight": if group_val > 0.0 { m.value_eur / group_val } else { 0.0 },
                        "underlyingAsset": {
                            "isin": m.isin,
                            "name": m.inst.name,
                            "inventory": {"position": {"filled": m.quantity}}
                        }
                    })
                })
                .collect();
            (
                group_val,
                json!({
                    "id": format!("pos-{}", name.to_lowercase()),
                    "name": name,
                    "weight": weight,
                    "valuation": round2(group_val),
                    "contributors": contributors,
                    "subpositions": []
                }),
            )
        })
        .collect();
    positions.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    positions.into_iter().map(|(_, v)| v).collect()
}

async fn handle_broker_analytics(state: &SharedState, variables: &Value, now: DateTime<Utc>) -> Value {
    let st = state.read().await;
    let portfolio_id = portfolio_id_of(variables);
    let portfolio = st.portfolio(portfolio_id.as_deref());
    let (_securities, _crypto, total_valuation) = portfolio.valuation_eur(st.seed, now);

    let allocations = vec![
        json!({"id": "alloc-asset-class", "type": "ASSET_CLASS", "positions": allocation_positions(portfolio, st.seed, now, |i| i.asset_class)}),
        json!({"id": "alloc-sector", "type": "SECTOR", "positions": allocation_positions(portfolio, st.seed, now, |i| i.sector)}),
        json!({"id": "alloc-region", "type": "REGION", "positions": allocation_positions(portfolio, st.seed, now, |i| i.region)}),
        json!({"id": "alloc-currency", "type": "CURRENCY", "positions": allocation_positions(portfolio, st.seed, now, |i| i.currency)}),
    ];

    // Diversification health check: 1 - Herfindahl index over asset-class weights.
    let asset_class_weights: Vec<f64> = allocation_positions(portfolio, st.seed, now, |i| i.asset_class)
        .iter()
        .filter_map(|p| p.get("weight").and_then(Value::as_f64))
        .collect();
    let herfindahl: f64 = asset_class_weights.iter().map(|w| w * w).sum();
    let diversification_score = (1.0 - herfindahl).clamp(0.0, 1.0);
    let max_weight = asset_class_weights.iter().cloned().fold(0.0_f64, f64::max);
    let concentration_score = (1.0 - max_weight).clamp(0.0, 1.0);
    let cash_balance = portfolio.cash_balance_eur();
    let cash_ratio = if total_valuation + cash_balance > 0.0 { cash_balance / (total_valuation + cash_balance) } else { 0.0 };

    fn health_state(score: f64) -> (&'static str, &'static str) {
        if score > 0.7 {
            ("GOOD", "2ECC71")
        } else if score > 0.4 {
            ("OK", "F1C40F")
        } else {
            ("BAD", "E74C3C")
        }
    }
    let (div_state, div_color) = health_state(diversification_score);
    let (conc_state, conc_color) = health_state(concentration_score);
    let (cash_state, cash_color) = health_state(1.0 - (cash_ratio - 0.1).abs());

    let health_checks = vec![
        json!({"id": "hc-diversification", "type": "DIVERSIFICATION", "healthScore": round2(diversification_score), "state": div_state, "color": {"sixDigitNotationValue": div_color}, "numberOfItemsInPortfolio": portfolio.holdings.len(), "maxItems": 50}),
        json!({"id": "hc-concentration", "type": "CONCENTRATION", "healthScore": round2(concentration_score), "state": conc_state, "color": {"sixDigitNotationValue": conc_color}, "numberOfItemsInPortfolio": portfolio.holdings.len(), "maxItems": 50}),
        json!({"id": "hc-cash-ratio", "type": "CASH_RATIO", "healthScore": round2(1.0 - (cash_ratio - 0.1).abs()), "state": cash_state, "color": {"sixDigitNotationValue": cash_color}, "numberOfItemsInPortfolio": portfolio.holdings.len(), "maxItems": 50}),
    ];

    let mut by_valuation: Vec<(&crate::state::Holding, &'static Instrument, f64)> = portfolio
        .holdings
        .iter()
        .filter_map(|h| {
            let inst = catalog::find(&h.isin)?;
            let price = pricing::current_price(st.seed, &h.isin, now);
            Some((h, inst, to_eur(h.quantity * price, inst.currency)))
        })
        .collect();
    by_valuation.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    let top_securities: Vec<Value> = by_valuation
        .iter()
        .take(3)
        .map(|(h, inst, _)| json!({"id": format!("sec-{}", h.isin), "isin": h.isin, "name": inst.name, "type": inst.security_type}))
        .collect();
    let equity_share = allocation_positions(portfolio, st.seed, now, |i| i.asset_class)
        .iter()
        .find(|p| p.get("name").and_then(Value::as_str) == Some("EQUITY"))
        .and_then(|p| p.get("weight").and_then(Value::as_f64))
        .unwrap_or(0.0);
    let scenarios = vec![
        json!({"id": "scenario-crash", "type": "MARKET_CRASH", "portfolioPerformance": round2(-0.30 * equity_share), "benchmarkPerformance": -0.30, "securities": top_securities}),
        json!({"id": "scenario-rally", "type": "MARKET_RALLY", "portfolioPerformance": round2(0.20 * equity_share), "benchmarkPerformance": 0.20, "securities": top_securities}),
    ];

    let total_distributions: f64 = portfolio
        .transactions
        .iter()
        .filter(|t| t.type_ == "DISTRIBUTION" && t.is_settled())
        .map(|t| to_eur(t.amount, &t.currency))
        .sum();
    let total_interest: f64 = portfolio
        .transactions
        .iter()
        .filter(|t| t.type_ == "INTEREST" && t.is_settled())
        .map(|t| to_eur(t.amount, &t.currency))
        .sum();

    json!({
        "account": {
            "brokerPortfolio": {
                "portfolioAnalysis": {
                    "type": "VALID",
                    "portfolioCoverage": 1.0,
                    "invalidSecurities": [],
                    "result": {
                        "id": "analysis-1",
                        "lastUpdated": {"time": now.to_rfc3339()},
                        "healthChecks": {"id": "health-1", "items": health_checks},
                        "scenarios": {"id": "scenarios-1", "items": scenarios},
                        "allocations": {"id": "allocations-1", "items": allocations},
                        "equityCompanyStyles": null,
                        "fixedIncomeRatings": null,
                        "payments": {"id": "payments-1", "totalDistributions": round2(total_distributions), "totalInterest": round2(total_interest)},
                        "trialPeriod": null
                    }
                }
            }
        }
    })
}

async fn handle_broker_limits(state: &SharedState, variables: &Value) -> Value {
    let st = state.read().await;
    let portfolio_id = portfolio_id_of(variables);
    let portfolio = st.portfolio(portfolio_id.as_deref());

    let cash_balance = portfolio.cash_balance_eur();
    let pending_buy = portfolio.pending_buy_orders_amount_eur();
    let pending_savings_plan = portfolio.pending_savings_plan_amount_eur();
    let credit_line = 2000.0_f64;
    let estimated_taxes = round2((cash_balance * 0.01).max(0.0));
    let cash_available = (cash_balance + credit_line - pending_buy - pending_savings_plan).max(0.0);
    let cash_available_no_credit = (cash_balance - pending_buy - pending_savings_plan).max(0.0);

    json!({
        "account": {
            "brokerPortfolio": {
                "depositLimits": {"min": "1", "max": "100000"},
                "withdrawalLimits": {"min": "1", "max": "50000", "maxExcludingCredit": "40000"},
                "payments": {
                    "buyingPower": {
                        "cashBalance": money(cash_balance),
                        "liveLimit": money(credit_line),
                        "loaned": "0.00",
                        "pendingBuyOrdersAmount": money(pending_buy),
                        "pendingWithdrawalsAmount": "0.00",
                        "pendingSavingsPlanAmount": money(pending_savings_plan),
                        "pendingDividendsReinvestmentAmount": "0.00",
                        "pendingPocketMoneyAmount": "0.00",
                        "estimatedTaxes": money(estimated_taxes),
                        "directDebit": "0.00",
                        "cashAvailableToInvest": money(cash_available),
                        "cashAvailableToInvestWithoutCredit": money(cash_available_no_credit)
                    },
                    "derivativesBuyingPower": {
                        "cashAvailableToInvest": money(cash_available),
                        "derivativesDirectDebit": "0.00",
                        "pendingELTIFAmount": "0.00",
                        "cashAvailableForDerivatives": money(cash_available)
                    },
                    "withdrawalPower": {
                        "cashAvailableToInvest": money(cash_available_no_credit),
                        "sellTradesAmount": "0.00",
                        "withdrawalDirectDebit": "0.00",
                        "cashAvailableForWithdrawal": money(cash_balance.max(0.0))
                    }
                }
            }
        }
    })
}

// =================================================================================================
// Holdings / watchlist / search
// =================================================================================================

async fn handle_broker_holdings(state: &SharedState, variables: &Value, now: DateTime<Utc>) -> Value {
    let st = state.read().await;
    let portfolio_id = portfolio_id_of(variables);
    json!({"account": {"brokerPortfolio": {"inventory": {"items": st.holdings_for_response(portfolio_id.as_deref(), now)}}}})
}

async fn handle_broker_watchlist(state: &SharedState, variables: &Value, now: DateTime<Utc>) -> Value {
    let st = state.read().await;
    let portfolio_id = portfolio_id_of(variables);
    json!({"account": {"brokerPortfolio": {"watchlist": {"items": st.watchlist_for_response(portfolio_id.as_deref(), now)}}}})
}

async fn handle_broker_search(state: &SharedState, variables: &Value, now: DateTime<Utc>) -> Value {
    let st = state.read().await;
    let term = var_str(variables, "searchTerm").unwrap_or("");
    json!({"account": {"brokerPortfolio": {"simpleSecuritySearch": {"items": st.search_for_response(term, now)}}}})
}

async fn handle_broker_quote(state: &SharedState, variables: &Value, now: DateTime<Utc>) -> Value {
    let st = state.read().await;
    let isin = var_str(variables, "isin").unwrap_or("US0378331005");
    let inst = catalog::find(isin);
    let name = inst.map(|i| i.name).unwrap_or("Unknown Security");
    let security_type = inst.map(|i| i.security_type).unwrap_or("EQ");
    let mid = pricing::current_price(st.seed, isin, now);
    let (bid, ask) = pricing::spread(isin, mid);
    let currency = inst.map(|i| i.currency).unwrap_or("EUR");

    let performances: Vec<Value> = [
        ("ONE_DAY", Timeframe::TwoDays),
        ("ONE_WEEK", Timeframe::OneWeek),
        ("ONE_MONTH", Timeframe::OneMonth),
    ]
    .into_iter()
    .map(|(label, tf)| {
        let (abs, rel) = pricing::performance(st.seed, isin, tf, now);
        json!({"timeframe": label, "performance": rel, "simpleAbsoluteReturn": abs})
    })
    .collect();

    json!({
        "account": {
            "brokerPortfolio": {
                "security": {
                    "id": format!("sec-{isin}"),
                    "isin": isin,
                    "name": name,
                    "type": security_type,
                    "quoteTick": {
                        "id": format!("qt-{isin}"),
                        "isin": isin,
                        "midPrice": mid,
                        "currency": currency,
                        "bidPrice": bid,
                        "askPrice": ask,
                        "isOutdated": false,
                        "timestampUtc": {"time": now.to_rfc3339()},
                        "performanceDate": {"date": now.format("%Y-%m-%d").to_string()},
                        "performancesByTimeframe": performances
                    }
                }
            }
        }
    })
}

async fn handle_broker_chart(state: &SharedState, variables: &Value, now: DateTime<Utc>) -> Value {
    let st = state.read().await;
    let isin = var_str(variables, "isin").unwrap_or("US0378331005");
    let tf_str = variables
        .get("timeFrames")
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .and_then(Value::as_str)
        .unwrap_or("ONE_MONTH");
    let tf = Timeframe::from_graphql(tf_str);
    let points = pricing::series(st.seed, isin, tf, now);
    let currency = catalog::find(isin).map(|i| i.currency).unwrap_or("EUR");
    let last = points.last().cloned();
    let data_points: Vec<Value> = points
        .iter()
        .map(|p| json!({"midPrice": p.mid, "timestampUtc": {"time": p.timestamp.to_rfc3339()}}))
        .collect();

    json!({
        "timeSeriesBySecurity": [
            {
                "isin": isin,
                "timeFrame": tf.as_graphql(),
                "currency": currency,
                "source": "CONSOLIDATED",
                "closingReferencePoint": last.map(|p| json!({"midPrice": p.mid, "timestampUtc": {"time": p.timestamp.to_rfc3339()}})).unwrap_or(Value::Null),
                "dataPoints": data_points
            }
        ]
    })
}

async fn handle_security_news(state: &SharedState, variables: &Value, now: DateTime<Utc>) -> Value {
    let st = state.read().await;
    let isin = var_str(variables, "isin").unwrap_or("US0378331005");
    let locale = var_str(variables, "locale").unwrap_or("en_DE");
    let is_de = locale.to_lowercase().starts_with("de");
    let inst = catalog::find(isin);
    let name = inst.map(|i| i.name).unwrap_or(isin);
    let entries = fixtures::news_for(st.seed, isin, now);

    let sources: Vec<Value> = entries
        .iter()
        .map(|e| {
            let headline = if is_de { &e.headline_de } else { &e.headline_en };
            json!({"id": e.id, "headline": headline, "sourceName": e.source, "publicationTime": {"time": e.published.to_rfc3339()}})
        })
        .collect();

    let (short, long) = if is_de {
        (
            format!("{name}: aktuelle Marktnachrichten und Analysteneinschätzungen."),
            format!(
                "{name} steht weiter im Fokus von Analysten und Marktbeobachtern. Die letzten Meldungen umfassen Kursziele, \
                 Geschäftszahlen und strategische Ankündigungen; Anleger sollten die Originalquellen für Details prüfen."
            ),
        )
    } else {
        (
            format!("{name}: latest market news and analyst commentary."),
            format!(
                "{name} remains in focus for analysts and market watchers. Recent coverage spans price targets, \
                 earnings updates and strategic announcements; investors should consult the original sources for details."
            ),
        )
    };

    json!({
        "securityNews": {
            "isin": isin,
            "shortNewsSummary": short,
            "longNewsSummary": long,
            "lastUpdated": {"time": entries.first().map(|e| e.published.to_rfc3339()).unwrap_or_else(|| now.to_rfc3339())},
            "sources": sources
        }
    })
}

// =================================================================================================
// Price alerts
// =================================================================================================

async fn handle_price_alerts(state: &SharedState, variables: &Value) -> Value {
    let st = state.read().await;
    let portfolio_id = portfolio_id_of(variables);
    let active_only = variables.get("activeOnly").and_then(Value::as_bool).unwrap_or(false);
    json!({"account": {"brokerPortfolio": {"priceAlerts": {"itemsPerInstrument": st.price_alerts_for_response(portfolio_id.as_deref(), active_only)}}}})
}

async fn handle_crypto_price_alerts(state: &SharedState, variables: &Value) -> Value {
    let st = state.read().await;
    let portfolio_id = portfolio_id_of(variables);
    json!({"account": {"brokerPortfolio": {"crypto": {"priceAlerts": {"itemsPerInstrument": st.crypto_alerts_for_response(portfolio_id.as_deref())}}}}})
}

async fn handle_add_price_alert(state: &SharedState, variables: &Value) -> Value {
    let portfolio_id = portfolio_id_of(variables);
    let isin = var_str(variables, "isin").unwrap_or("US0378331005").to_string();
    let price = loose_f64(variables.get("price")).unwrap_or(0.0);
    let mut st = state.write().await;
    let id = st.add_price_alert(portfolio_id.as_deref(), Some(&isin), None, price);
    let inst = catalog::find(&isin);
    json!({
        "addPriceAlert": {
            "security": {
                "isin": isin,
                "priceAlerts": {
                    "canAddNew": true,
                    "items": [{"id": id, "direction": if price >= pricing::current_price(st.seed, &isin, st.genesis) {"ABOVE"} else {"BELOW"}, "isActive": true, "price": money(price), "triggeredTimestamp": null, "security": {"isin": isin, "name": inst.map(|i| i.name).unwrap_or(&isin), "type": inst.map(|i| i.security_type).unwrap_or("EQ")}}]
                }
            }
        }
    })
}

async fn handle_add_crypto_alert(state: &SharedState, variables: &Value) -> Value {
    let portfolio_id = portfolio_id_of(variables);
    let ticker = var_str(variables, "ticker").unwrap_or("BTC").to_string();
    let price = loose_f64(variables.get("price")).unwrap_or(0.0);
    let mut st = state.write().await;
    let id = st.add_price_alert(portfolio_id.as_deref(), None, Some(&ticker), price);
    let name = catalog::find_by_symbol(&ticker).map(|i| i.name).unwrap_or(&ticker);
    json!({
        "addCryptoPriceAlert": {
            "crypto": {
                "coin": {
                    "ticker": ticker,
                    "name": name,
                    "priceAlerts": {
                        "canAddNew": true,
                        "items": [{"id": id, "direction": "ABOVE", "isActive": true, "price": money(price), "triggeredTimestamp": null, "coin": {"ticker": ticker, "name": name}}]
                    }
                }
            }
        }
    })
}

async fn handle_remove_price_alert(state: &SharedState, variables: &Value, is_security: bool) -> Value {
    let portfolio_id = portfolio_id_of(variables);
    let alert_id = var_str(variables, "alertId").or_else(|| var_str(variables, "id")).unwrap_or("").to_string();
    let mut st = state.write().await;
    st.remove_price_alert(portfolio_id.as_deref(), &alert_id);
    if is_security {
        json!({"removePriceAlert": {"id": alert_id}})
    } else {
        json!({"removeCryptoPriceAlert": {"id": alert_id}})
    }
}

// =================================================================================================
// Watchlist mutations
// =================================================================================================

async fn handle_add_watchlist(state: &SharedState, variables: &Value) -> Value {
    let portfolio_id = portfolio_id_of(variables);
    let isin = var_str(variables, "isin")
        .or_else(|| variables.get("input").and_then(|v| v.get("isin")).and_then(Value::as_str))
        .unwrap_or("US0378331005")
        .to_string();
    let mut st = state.write().await;
    st.add_watchlist(portfolio_id.as_deref(), &isin);
    json!({"addToWatchlist": {"security": {"isin": isin, "isOnWatchlist": true}}})
}

async fn handle_remove_watchlist(state: &SharedState, variables: &Value) -> Value {
    let portfolio_id = portfolio_id_of(variables);
    let isin = var_str(variables, "isin")
        .or_else(|| variables.get("input").and_then(|v| v.get("isin")).and_then(Value::as_str))
        .unwrap_or("US0378331005")
        .to_string();
    let mut st = state.write().await;
    st.remove_watchlist(portfolio_id.as_deref(), &isin);
    json!({"removeFromWatchlist": {"security": {"isin": isin, "isOnWatchlist": false}}})
}

// =================================================================================================
// Transactions
// =================================================================================================

async fn handle_broker_transactions(state: &SharedState, variables: &Value) -> Value {
    let st = state.read().await;
    let portfolio_id = portfolio_id_of(variables);
    let input = variables.get("input").cloned().unwrap_or_else(|| json!({}));
    let page_size = input.get("pageSize").and_then(Value::as_u64).unwrap_or(20) as usize;
    let cursor = input.get("cursor").and_then(Value::as_str).and_then(|c| c.parse::<usize>().ok()).unwrap_or(0);
    let type_filter = str_array(input.get("type"));
    let status_filter = str_array(input.get("status"));
    let search_term = input.get("searchTerm").and_then(Value::as_str).map(str::to_string);
    let isin_filter = input.get("isin").and_then(Value::as_str).map(str::to_string);
    let from_time = input.get("fromTime").and_then(Value::as_i64);
    let to_time = input.get("toTime").and_then(Value::as_i64);

    json!({
        "account": {
            "brokerPortfolio": {
                "moreTransactions": st.transactions_for_response(
                    portfolio_id.as_deref(),
                    &TransactionQuery {
                        page_size: page_size.max(1),
                        cursor,
                        types: type_filter.as_deref(),
                        statuses: status_filter.as_deref(),
                        search_term: search_term.as_deref(),
                        isin: isin_filter.as_deref(),
                        from_time,
                        to_time,
                    },
                )
            }
        }
    })
}

fn compute_transaction_costs(t: &crate::state::Transaction) -> Value {
    let is_sell = t.type_ == "SELL";
    let is_usd = t.currency == "USD";
    let venue_fee = round2(t.amount * 0.0008);
    let transaction_fee = if t.type_ == "SAVINGS_PLAN" { 0.0 } else { round2(1.0 + t.amount * 0.0002) };
    let financial_transaction_tax = if t.isin.as_deref().map(|i| i.starts_with("FR")).unwrap_or(false) {
        round2(t.amount * 0.003)
    } else {
        0.0
    };
    let capital_gains_tax = if is_sell { round2(t.amount * 0.25 * 0.15) } else { 0.0 };
    let solidarity_tax = round2(capital_gains_tax * 0.055);
    let source_tax = if t.type_ == "DISTRIBUTION" && is_usd { round2(t.amount * 0.15) } else { 0.0 };
    let interest_tax = if t.type_ == "INTEREST" { round2(t.amount * 0.26375) } else { 0.0 };
    let total_tax = capital_gains_tax + solidarity_tax + source_tax + interest_tax + financial_transaction_tax;
    json!({
        "venue_fee": venue_fee,
        "transaction_fee": transaction_fee,
        "financial_transaction_tax": financial_transaction_tax,
        "capital_gains_tax": capital_gains_tax,
        "solidarity_tax": solidarity_tax,
        "source_tax": source_tax,
        "interest_tax": interest_tax,
        "total_tax": total_tax
    })
}

async fn handle_transaction_details(state: &SharedState, variables: &Value) -> Value {
    let st = state.read().await;
    let portfolio_id = portfolio_id_of(variables);
    let txn_id = var_str(variables, "transactionId").unwrap_or("");
    let Some(t) = st.find_transaction(portfolio_id.as_deref(), txn_id) else {
        return json!({"errors": [{"message": "Transaction not found", "extensions": {"code": "BAD_USER_INPUT", "validationErrors": {"errorCode": "TransactionNotFound"}}}]});
    };

    let inst = t.isin.as_deref().and_then(catalog::find);
    let costs = compute_transaction_costs(&t);
    let get = |k: &str| costs.get(k).and_then(Value::as_f64).unwrap_or(0.0);

    let security = json!({"isin": t.isin, "name": inst.map(|i| i.name).unwrap_or("Unknown Security"), "type": inst.map(|i| i.security_type).unwrap_or("EQ")});

    let mut detail = json!({
        "__typename": match t.shape {
            crate::state::TxnShape::Security => "BrokerSecurityTransaction",
            crate::state::TxnShape::Cash => "BrokerCashTransaction",
            crate::state::TxnShape::NonTradeSecurity => "BrokerNonTradeSecurityTransaction",
        },
        "id": t.id,
        "currency": t.currency,
        "type": t.type_,
        "documents": [],
        "lastEventDateTime": t.last_event.to_rfc3339(),
        "isPending": t.status == "PENDING",
        "isCancellation": t.is_cancellation,
        "security": security,
        "transactionReference": format!("ref-{}", t.id),
    });
    let obj = detail.as_object_mut().unwrap();

    match t.shape {
        crate::state::TxnShape::Security => {
            let average_price = t.quantity.filter(|q| *q > 0.0).map(|q| t.amount / q).unwrap_or(0.0);
            obj.insert("side".into(), json!(t.side));
            obj.insert("status".into(), json!(t.status));
            obj.insert("numberOfShares".into(), json!({"filled": t.quantity, "total": t.quantity}));
            obj.insert("averagePrice".into(), json!(round2(average_price)));
            obj.insert("totalAmount".into(), json!(t.amount));
            obj.insert("finalisationReason".into(), json!(null));
            obj.insert("limitPrice".into(), json!(t.limit_price));
            obj.insert("stopPrice".into(), json!(t.stop_price));
            obj.insert("validUntil".into(), json!(null));
            obj.insert("isCancellationRequested".into(), json!(false));
            obj.insert("tradeTransactionAmounts".into(), json!({
                "marketValuation": t.amount,
                "taxAmount": get("total_tax"),
                "transactionFee": get("transaction_fee"),
                "venueFee": get("venue_fee"),
                "cryptoSpreadFee": null
            }));
            obj.insert("tradingVenue".into(), json!("GETTEX"));
            obj.insert("fee".into(), json!(get("transaction_fee")));
            obj.insert("transactionalFee".into(), json!(get("transaction_fee")));
            obj.insert("taxes".into(), json!(get("total_tax")));
            obj.insert("aggregatedTransactionTaxes".into(), json!({
                "totalTax": get("total_tax"),
                "capitalGainsTax": get("capital_gains_tax"),
                "churchTax": 0.0,
                "solidarityTax": get("solidarity_tax"),
                "sourceTax": get("source_tax"),
                "financialTransactionTax": get("financial_transaction_tax")
            }));
            obj.insert("securityTransactionHistory".into(), json!([{
                "state": t.status,
                "time": {"time": t.last_event.to_rfc3339(), "epochSecond": t.last_event.timestamp(), "epochMillisecond": t.last_event.timestamp_millis()},
                "numberOfShares": {"filled": t.quantity, "total": t.quantity},
                "executionPrice": round2(average_price)
            }]));
            obj.insert("orderKind".into(), json!(if t.limit_price.is_some() {"LIMIT"} else if t.stop_price.is_some() {"STOP"} else {"MARKET"}));
            obj.insert("linkedTransactions".into(), json!([]));
            obj.insert("trailingStopInfo".into(), json!(null));
        }
        crate::state::TxnShape::Cash => {
            obj.insert("cashTransactionType".into(), json!(t.type_));
            obj.insert("amount".into(), json!(t.amount));
            obj.insert("description".into(), json!(t.description));
            obj.insert("taxDetails".into(), if get("interest_tax") > 0.0 {
                json!({"grossAmount": t.amount, "taxAmount": get("interest_tax")})
            } else { json!(null) });
            obj.insert("sddiDetails".into(), json!(null));
            obj.insert("linkedTransactions".into(), json!([]));
        }
        crate::state::TxnShape::NonTradeSecurity => {
            obj.insert("nonTradeSecurityTransactionType".into(), json!(t.type_));
            obj.insert("quantity".into(), json!(t.quantity));
            obj.insert("nonTradeAveragePrice".into(), json!(null));
            obj.insert("nonTradeSecurityAmount".into(), json!(t.amount));
            obj.insert("description".into(), json!(t.description));
            obj.insert("linkedTransactions".into(), json!([]));
        }
    }

    json!({"account": {"brokerPortfolio": {"transactionDetails": detail}}})
}

// =================================================================================================
// Savings plans
// =================================================================================================

async fn handle_savings_plans(state: &SharedState, variables: &Value) -> Value {
    let st = state.read().await;
    let portfolio_id = portfolio_id_of(variables);
    json!({"account": {"brokerPortfolio": st.savings_plans_for_response(portfolio_id.as_deref())}})
}

async fn handle_savings_plan_config(state: &SharedState, variables: &Value) -> Value {
    let st = state.read().await;
    let isin = var_str(variables, "isin").unwrap_or("IE00B4L5Y983");
    let inst = catalog::find(isin);
    let name = inst.map(|i| i.name).unwrap_or("Unknown Security");
    let security_type = inst.map(|i| i.security_type).unwrap_or("ETF");
    let min_amount = if security_type == "ETF" { 25.0 } else { 1.0 };
    json!({
        "account": {
            "brokerPortfolio": {
                "security": {
                    "isin": isin,
                    "name": name,
                    "type": security_type,
                    "savingsPlanConfiguration": {
                        "schedules": [
                            {"dayOfTheMonth": 1, "isEarliest": true, "isDefault": true, "yearMonths": [{"yearMonth": st.genesis.format("%Y-%m").to_string(), "isAvailable": true}]},
                            {"dayOfTheMonth": 15, "isEarliest": false, "isDefault": false, "yearMonths": [{"yearMonth": st.genesis.format("%Y-%m").to_string(), "isAvailable": true}]}
                        ],
                        "minSavingsPlanAmount": money(min_amount),
                        "maxSavingsPlanAmount": "25000",
                        "defaultMinSavingsPlanAmount": money(min_amount),
                        "dynamizationRates": [0, 1, 2.5, 5],
                        "defaultDynamizationRate": 0,
                        "paymentMethods": ["REFERENCE_ACCOUNT", "BUYING_POWER_WITH_REFERENCE_ACCOUNT_FALLBACK"],
                        "frequencies": ["MONTHLY", "BI_MONTHLY", "QUARTERLY"],
                        "nextInstructedExecutionDate": {"date": st.genesis.format("%Y-%m-%d").to_string(), "epochDay": epoch_day(st.genesis.date_naive())}
                    }
                }
            }
        }
    })
}

/// Ex-ante cost breakdown scaled by the requested order/plan volume and the instrument's own TER
/// — replaces the old constant literals.
fn ex_ante_cost_block(id: String, order_volume: f64, ter: f64) -> Value {
    let entry_product = round2(order_volume * 0.0010);
    let entry_service = round2(order_volume * 0.0005);
    let entry_total = entry_product + entry_service;
    let ongoing_product = round2(order_volume * ter);
    let ongoing_service = round2(order_volume * 0.0006);
    let ongoing_total = ongoing_product + ongoing_service;
    let exit_product = round2(order_volume * 0.0004);
    let exit_service = round2(order_volume * 0.0002);
    let exit_total = exit_product + exit_service;
    let initial_year = entry_total + ongoing_total;
    let following_years = ongoing_total;
    let final_year = ongoing_total + exit_total;
    let five_years = entry_total + ongoing_total * 5.0 + exit_total;
    let pct_of = |amount: f64| if order_volume > 0.0 { amount / order_volume } else { 0.0 };
    let cost = |amount: f64| json!({"amount": money(amount), "percentage": pct(pct_of(amount))});
    json!({
        "id": id,
        "entryCosts": {"productCosts": cost(entry_product), "serviceCosts": cost(entry_service), "total": cost(entry_total)},
        "ongoingCosts": {"productCosts": cost(ongoing_product), "serviceCosts": cost(ongoing_service), "total": cost(ongoing_total)},
        "exitCosts": {"productCosts": cost(exit_product), "serviceCosts": cost(exit_service), "total": cost(exit_total)},
        "effectOnReturn": {
            "initialYearCosts": cost(initial_year),
            "followingYearsCosts": cost(following_years),
            "finalYearCosts": cost(final_year)
        },
        "fiveYearsCosts": cost(five_years),
        "incidentalCosts": cost(0.0)
    })
}

async fn handle_savings_plan_ex_ante(_state: &SharedState, variables: &Value) -> Value {
    let isin = var_str(variables, "isin").unwrap_or("IE00B4L5Y983");
    let amount = loose_f64(variables.get("amount")).unwrap_or(100.0);
    let ter = catalog::find(isin).map(|i| i.ter).unwrap_or(0.002);
    json!({"account": {"brokerPortfolio": {"savingsPlanExAnteCosts": ex_ante_cost_block(format!("ex-ante-sp-{isin}"), amount, ter)}}})
}

async fn handle_savings_plan_by_isin(state: &SharedState, variables: &Value) -> Value {
    let st = state.read().await;
    let portfolio_id = portfolio_id_of(variables);
    let isin = var_str(variables, "isin").unwrap_or("IE00B4L5Y983");
    let portfolio = st.portfolio(portfolio_id.as_deref());
    let inst = catalog::find(isin);
    let plan = portfolio.savings_plans.iter().find(|p| p.isin.eq_ignore_ascii_case(isin));
    let savings_plan = plan.map(|sp| {
        json!({
            "isin": sp.isin,
            "amount": money(sp.amount),
            "frequency": sp.frequency,
            "dayOfTheMonth": sp.day_of_month,
            "dynamizationRate": pct(sp.dynamization_rate),
            "paymentMethod": sp.payment_method,
            "nextExecutionDate": {"date": sp.next_execution.format("%Y-%m-%d").to_string(), "epochDay": epoch_day(sp.next_execution)}
        })
    });
    json!({
        "account": {
            "brokerPortfolio": {
                "security": {
                    "isin": isin,
                    "name": inst.map(|i| i.name).unwrap_or("Unknown"),
                    "type": inst.map(|i| i.security_type).unwrap_or("ETF"),
                    "inventory": {"savingsPlan": savings_plan}
                }
            }
        }
    })
}

async fn handle_create_savings_plan(state: &SharedState, variables: &Value) -> Value {
    let portfolio_id = portfolio_id_of(variables);
    let input = variables.get("input").cloned().unwrap_or_else(|| json!({}));
    let isin = input.get("isin").and_then(Value::as_str).unwrap_or("IE00B4L5Y983").to_string();
    let amount = loose_f64(input.get("amount")).unwrap_or(100.0);
    let config = input.get("configuration").cloned().unwrap_or_else(|| json!({}));
    let frequency = config.get("frequency").and_then(Value::as_str).unwrap_or("MONTHLY").to_string();
    let day_of_month = config.get("dayOfTheMonth").and_then(Value::as_u64).unwrap_or(1) as u32;
    let dynamization_rate = loose_f64(config.get("dynamizationRate")).unwrap_or(0.0);
    let payment_method = config.get("paymentMethod").and_then(Value::as_str).unwrap_or("REFERENCE_ACCOUNT").to_string();

    if let Some(inst) = catalog::find(&isin) {
        if !inst.savings_plan_eligible {
            return graphql_error(
                format!("{} is not eligible for a savings plan", inst.name),
                "SAVINGS_PLAN_NOT_ELIGIBLE",
            );
        }
    }

    let mut st = state.write().await;
    let today = st.genesis.date_naive();
    let next_execution = {
        let last_day = {
            let (y, m) = if today.month() == 12 { (today.year() + 1, 1) } else { (today.year(), today.month() + 1) };
            NaiveDate::from_ymd_opt(y, m, 1).unwrap().pred_opt().unwrap().day()
        };
        NaiveDate::from_ymd_opt(today.year(), today.month(), day_of_month.min(last_day)).unwrap()
    };
    st.upsert_savings_plan(
        portfolio_id.as_deref(),
        &SavingsPlanInput {
            isin: &isin,
            amount,
            frequency: &frequency,
            day_of_month,
            dynamization_rate,
            payment_method: &payment_method,
            next_execution,
        },
    );
    json!({"createOrUpdateSavingsPlan": {"id": format!("savings-{isin}")}})
}

async fn handle_remove_savings_plan(state: &SharedState, variables: &Value) -> Value {
    let portfolio_id = portfolio_id_of(variables);
    let isin = var_str(variables, "isin").unwrap_or("IE00B4L5Y983").to_string();
    let mut st = state.write().await;
    st.remove_savings_plan(portfolio_id.as_deref(), &isin);
    json!({"removeSavingsPlan": {"id": format!("removed-{isin}")}})
}

fn epoch_day(d: NaiveDate) -> i64 {
    (d - NaiveDate::from_ymd_opt(1970, 1, 1).expect("valid epoch")).num_days()
}

// =================================================================================================
// Portfolio groups
// =================================================================================================

async fn handle_portfolio_groups(state: &SharedState, variables: &Value, now: DateTime<Utc>) -> Value {
    let st = state.read().await;
    let portfolio_id = portfolio_id_of(variables);
    json!({"account": {"brokerPortfolio": {"inventory": st.portfolio_groups_for_response(portfolio_id.as_deref(), st.seed, now)}}})
}

async fn handle_create_group(state: &SharedState, variables: &Value) -> Value {
    let portfolio_id = portfolio_id_of(variables);
    let input = variables.get("input").cloned().unwrap_or_else(|| json!({}));
    let name = input.get("name").and_then(Value::as_str).unwrap_or("New Group");
    let description = input.get("description").and_then(Value::as_str).map(str::to_string);
    let mut st = state.write().await;
    let id = st.create_group(portfolio_id.as_deref(), name, description);
    json!({"createPortfolioGroup": {"portfolioGroup": {"id": id}}})
}

fn group_id_from(variables: &Value) -> String {
    variables
        .get("input")
        .and_then(|v| v.get("id"))
        .and_then(Value::as_str)
        .or_else(|| var_str(variables, "groupId"))
        .unwrap_or("group-1")
        .to_string()
}

async fn handle_update_group(state: &SharedState, variables: &Value) -> Value {
    let portfolio_id = portfolio_id_of(variables);
    let input = variables.get("input").cloned().unwrap_or_else(|| json!({}));
    let group_id = group_id_from(variables);
    let details = input.get("portfolioGroupDetails").or_else(|| input.get("details"));
    let name = details.and_then(|d| d.get("name")).and_then(Value::as_str);
    let description: Option<Option<String>> = details.and_then(|d| d.get("description")).map(|v| v.as_str().map(str::to_string));
    let mut st = state.write().await;
    if st.update_group(portfolio_id.as_deref(), &group_id, name, description) {
        json!({"modifyPortfolioGroup": {"id": group_id}})
    } else {
        graphql_error(format!("Portfolio group '{group_id}' not found"), "PORTFOLIO_GROUP_NOT_FOUND")
    }
}

async fn handle_delete_group(state: &SharedState, variables: &Value) -> Value {
    let portfolio_id = portfolio_id_of(variables);
    let group_id = group_id_from(variables);
    let mut st = state.write().await;
    if st.delete_group(portfolio_id.as_deref(), &group_id) {
        json!({"deletePortfolioGroup": {"id": group_id}})
    } else {
        graphql_error(format!("Portfolio group '{group_id}' not found"), "PORTFOLIO_GROUP_NOT_FOUND")
    }
}

async fn handle_assign_group(state: &SharedState, variables: &Value) -> Value {
    let portfolio_id = portfolio_id_of(variables);
    let input = variables.get("input").cloned().unwrap_or_else(|| json!({}));
    let group_id = group_id_from(variables);
    let items: Vec<String> = str_array(input.get("portfolioGroupItems").and_then(|v| v.get("itemsToAdd"))).unwrap_or_default();
    let mut st = state.write().await;
    match st.assign_group_items(portfolio_id.as_deref(), &group_id, &items) {
        Ok(true) => json!({"modifyPortfolioGroup": {"id": group_id}}),
        Ok(false) => graphql_error(format!("Portfolio group '{group_id}' not found"), "PORTFOLIO_GROUP_NOT_FOUND"),
        Err(isin) => graphql_error(format!("ISIN {isin} is already assigned to group '{group_id}'"), "PORTFOLIO_GROUP_VALIDATION"),
    }
}

async fn handle_unassign_group(state: &SharedState, variables: &Value) -> Value {
    let portfolio_id = portfolio_id_of(variables);
    let input = variables.get("input").cloned().unwrap_or_else(|| json!({}));
    let group_id = group_id_from(variables);
    let items: Vec<String> = str_array(input.get("portfolioGroupItems").and_then(|v| v.get("itemsToRemove"))).unwrap_or_default();
    let mut st = state.write().await;
    match st.unassign_group_items(portfolio_id.as_deref(), &group_id, &items) {
        Ok(true) => json!({"modifyPortfolioGroup": {"id": group_id}}),
        Ok(false) => graphql_error(format!("Portfolio group '{group_id}' not found"), "PORTFOLIO_GROUP_NOT_FOUND"),
        Err(isin) => graphql_error(format!("ISIN {isin} is not assigned to group '{group_id}'"), "PORTFOLIO_GROUP_VALIDATION"),
    }
}

async fn handle_modify_group_dispatch(state: &SharedState, variables: &Value) -> Value {
    let input = variables.get("input").cloned().unwrap_or_else(|| json!({}));
    if let Some(items) = input.get("portfolioGroupItems") {
        let to_add = items.get("itemsToAdd").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0);
        let to_remove = items.get("itemsToRemove").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0);
        if to_add > 0 {
            return handle_assign_group(state, variables).await;
        }
        if to_remove > 0 {
            return handle_unassign_group(state, variables).await;
        }
    }
    handle_update_group(state, variables).await
}

// =================================================================================================
// Overnight savings account
// =================================================================================================

async fn handle_discover_overnight(state: &SharedState, _variables: &Value) -> Value {
    let st = state.read().await;
    json!({
        "account": {
            "savingsAccounts": [
                {"__typename": "OvernightSavingsAccount", "id": st.overnight.id, "owners": [{"firstName": st.first_name, "lastName": st.last_name}], "personalizations": {"name": "Tagesgeld"}, "state": "ACTIVE"}
            ]
        },
        "productList": {"minors": []}
    })
}

async fn handle_overnight_summary(state: &SharedState, _variables: &Value, now: DateTime<Utc>) -> Value {
    let st = state.read().await;
    let balance = st.overnight.balance();
    let monthly_interest = round2(balance * st.overnight.interest_rate / 12.0);
    let lifetime_interest: f64 = st
        .overnight
        .transactions
        .iter()
        .filter(|t| t.type_ == "INTEREST")
        .map(|t| t.amount)
        .sum();
    let next_payout = (now.date_naive() + Duration::days(30 - now.date_naive().day() as i64 % 30 + 1)).and_hms_opt(0, 0, 0).unwrap().and_utc();
    json!({
        "account": {
            "savingsAccount": {
                "id": st.overnight.id,
                "interests": {
                    "currentAccruedAmount": money(monthly_interest * 0.5),
                    "currentInterestBearingAmount": money(balance),
                    "depositAccruedLifetimeAmount": money(lifetime_interest),
                    "depositInterestRate": pct(st.overnight.interest_rate),
                    "estimatedNextPayoutAmount": money(monthly_interest),
                    "nextPayoutDate": {"epochSecond": next_payout.timestamp()}
                },
                "nextPayoutDate": {"epochSecond": next_payout.timestamp()},
                "totalAmount": money(balance)
            }
        }
    })
}

async fn handle_overnight_transactions(state: &SharedState, variables: &Value) -> Value {
    let st = state.read().await;
    let input = variables.get("input").cloned().unwrap_or_else(|| json!({}));
    let page_size = input.get("pageSize").and_then(Value::as_u64).unwrap_or(20) as usize;
    let cursor = input.get("cursor").and_then(Value::as_str).and_then(|c| c.parse::<usize>().ok()).unwrap_or(0);
    let type_filter = str_array(input.get("type"));
    let search_term = input.get("searchTerm").and_then(Value::as_str).map(str::to_lowercase);
    let from_time = input.get("fromTime").and_then(Value::as_i64);
    let to_time = input.get("toTime").and_then(Value::as_i64);

    let filtered: Vec<&crate::state::Transaction> = st
        .overnight
        .transactions
        .iter()
        .filter(|t| type_filter.as_ref().map(|f| f.iter().any(|v| v == t.type_)).unwrap_or(true))
        .filter(|t| search_term.as_ref().map(|s| t.description.to_lowercase().contains(s)).unwrap_or(true))
        .filter(|t| from_time.map(|f| t.last_event.timestamp() >= f).unwrap_or(true))
        .filter(|t| to_time.map(|f| t.last_event.timestamp() <= f).unwrap_or(true))
        .collect();
    let total = filtered.len();
    let end = (cursor + page_size.max(1)).min(total);
    let slice = if cursor < total { &filtered[cursor..end] } else { &[] };
    let next_cursor = if end < total { Some(end.to_string()) } else { None };

    let items: Vec<Value> = slice
        .iter()
        .map(|t| json!({
            "id": t.id,
            "currency": t.currency,
            "type": t.type_,
            "status": t.status,
            "isCancellation": t.is_cancellation,
            "lastEventDateTime": t.last_event.to_rfc3339(),
            "description": t.description,
            "cashTransactionType": t.type_,
            "amount": money(t.amount),
            "custodian": "SAVINGS",
            "relatedIsin": null,
            "documents": []
        }))
        .collect();

    json!({
        "account": {
            "savingsAccount": {
                "id": st.overnight.id,
                "moreTransactions": {"cursor": next_cursor, "total": total, "transactions": items}
            }
        }
    })
}

// =================================================================================================
// Trading: tradability / security tick / ex-ante cost / place & cancel order
// =================================================================================================

fn primary_venue_for(inst: &Instrument) -> &'static str {
    if inst.venues.contains(&"GETTEX") {
        "GETTEX"
    } else if inst.venues.contains(&"XETR") {
        "XETR"
    } else {
        inst.venues.first().copied().unwrap_or("GETTEX")
    }
}

async fn handle_tradability(state: &SharedState, variables: &Value) -> Value {
    let st = state.read().await;
    let isin = var_str(variables, "isin").unwrap_or("US0378331005");
    let portfolio_id = var_str(variables, "portfolioId").map(str::to_string);
    let portfolio = st.portfolio(portfolio_id.as_deref());
    let inst = catalog::find(isin).unwrap_or(FALLBACK);

    let status = if inst.is_derivative { "TRADABLE_WITH_APPROPRIATENESS" } else { "TRADABLE" };
    let venues: Vec<Value> = inst
        .venues
        .iter()
        .map(|v| json!({"venue": v, "tradabilityStatus": status, "unavailabilityReason": null}))
        .collect();
    let primary = primary_venue_for(inst);

    let sellable_qty = portfolio.holding(isin).map(|h| h.quantity).unwrap_or(0.0);
    let sellable_by_venue: Vec<Value> = inst.venues.iter().map(|v| json!({"venue": v, "sellable": sellable_qty})).collect();

    let (required_suitability, suitability_statuses) = if inst.security_type == "KNOCKOUT" {
        (
            json!({"suitabilityType": "KNOCKOUT", "actionWhenUnsuitable": "PROCEED_TO_ORDER_FLOW"}),
            json!([{"id": "suit-1", "suitabilityType": "KNOCKOUT", "result": "SUITABLE", "suitabilityId": "suit-id-1"}]),
        )
    } else {
        (Value::Null, json!([]))
    };

    json!({
        "account": {
            "id": st.account_id,
            "brokerPortfolio": {
                "id": portfolio.id,
                "appropriatenessInfo": {"id": "appr-1", "appropriatenessId": "appr-id-1", "result": if inst.is_derivative {"APPROPRIATE"} else {"NOT_REQUIRED"}},
                "suitabilityStatuses": suitability_statuses,
                "featureFlags": {"knockoutWarnings": true},
                "security": {
                    "id": format!("sec-{isin}"),
                    "requiredSuitability": required_suitability,
                    "buyTradabilityForTrading": {"id": "bt-1", "tradabilityStatus": status, "venues": venues.clone(), "primaryVenue": {"venue": primary, "status": status}},
                    "sellTradabilityForTrading": {"id": "st-1", "tradabilityStatus": status, "venues": venues, "primaryVenue": {"venue": primary, "status": status}},
                    "inventory": {"position": {"sellableByVenue": sellable_by_venue}}
                }
            }
        }
    })
}

async fn handle_security_tick(state: &SharedState, variables: &Value, now: DateTime<Utc>) -> Value {
    let st = state.read().await;
    let isin = var_str(variables, "isin").unwrap_or("US0378331005");
    let portfolio_id = var_str(variables, "portfolioId").unwrap_or("portfolio-1");
    let inst = catalog::find(isin).unwrap_or(FALLBACK);
    let mid = pricing::current_price(st.seed, isin, now);
    let (bid, ask) = pricing::spread(isin, mid);
    json!({
        "account": {
            "id": st.account_id,
            "brokerPortfolio": {
                "id": portfolio_id,
                "security": {
                    "id": format!("sec-{isin}"),
                    "isin": isin,
                    "quoteTick": {"askPrice": ask, "bidPrice": bid, "midPrice": mid, "currency": inst.currency, "isOutdated": false, "timestampUtc": {"time": now.to_rfc3339()}},
                    // Two locales for the secondary link so it resolves regardless of which
                    // locale the CLI's trade flow requests (it isn't part of this query's own
                    // variables — see `parse_security_issuer_document_links` in trade.rs).
                    "issuerLinks": {"kidLinks": [
                        {"isPrimary": true, "url": format!("https://mock.local/kid/{isin}-primary.pdf"), "locale": "en_DE"},
                        {"isPrimary": false, "url": format!("https://mock.local/kid/{isin}-secondary.pdf"), "locale": "en_DE"},
                        {"isPrimary": false, "url": format!("https://mock.local/kid/{isin}-secondary-de.pdf"), "locale": "de_DE"}
                    ]}
                }
            }
        }
    })
}

async fn handle_single_ex_ante(state: &SharedState, variables: &Value) -> Value {
    let st = state.read().await;
    let isin = var_str(variables, "isin").unwrap_or("US0378331005");
    let portfolio_id = var_str(variables, "portfolioId").unwrap_or("portfolio-1");
    let order_volume = loose_f64(variables.get("estimatedOrderVolume")).unwrap_or(500.0);
    let ter = catalog::find(isin).map(|i| i.ter).unwrap_or(0.0);
    json!({
        "account": {
            "id": st.account_id,
            "brokerPortfolio": {
                "id": portfolio_id,
                "singleTradeExAnteCosts": ex_ante_cost_block(format!("ex-ante-{isin}"), order_volume, ter)
            }
        }
    })
}

async fn handle_place_order(state: &SharedState, variables: &Value, headers: &HeaderMap, now: DateTime<Utc>) -> Value {
    let portfolio_id = portfolio_id_of(variables);
    let input = variables.get("input").cloned().unwrap_or_else(|| json!({}));
    let isin = input.get("isin").and_then(Value::as_str).unwrap_or("US0378331005").to_string();
    let side = input.get("side").and_then(Value::as_str).unwrap_or("BUY").to_uppercase();
    let shares = loose_f64(input.get("numberOfShares")).unwrap_or(1.0);
    let limit_price = loose_f64(input.get("limitPrice"));
    let stop_price = loose_f64(input.get("stopPrice"));
    let idem_key = headers.get("x-sc-idempotency-id").and_then(|v| v.to_str().ok()).map(str::to_string);

    let mut st = state.write().await;
    let (order_id, is_marketable) = st.place_order(
        portfolio_id.as_deref(),
        &OrderRequest {
            isin: &isin,
            side: &side,
            shares,
            limit_price,
            stop_price,
            idem_key: idem_key.as_deref(),
        },
        now,
    );
    json!({
        "placeOrder": {
            "brokerPortfolio": {"id": portfolio_id.unwrap_or_else(|| st.default_portfolio_id.clone())},
            "orderData": {"orderId": order_id, "isMarketable": is_marketable}
        }
    })
}

async fn handle_cancel_order(state: &SharedState, variables: &Value) -> Value {
    let portfolio_id = portfolio_id_of(variables);
    let order_id = var_str(variables, "orderId")
        .or_else(|| variables.get("input").and_then(|v| v.get("orderId")).and_then(Value::as_str))
        .unwrap_or("")
        .to_string();
    let mut st = state.write().await;
    st.cancel_order(portfolio_id.as_deref(), &order_id);
    json!({"cancelOrder": {"id": order_id}})
}

// =================================================================================================
// Derivatives search
// =================================================================================================

static FALLBACK: &Instrument = &Instrument {
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

const DERIVATIVE_ISSUERS: [&str; 5] = ["HSBC", "GOLDMAN_SACHS", "VONTOBEL", "MORGAN_STANLEY", "BNP"];

struct DerivRow {
    isin: String,
    issuer: &'static str,
    strategy: String,
    leverage: Option<f64>,
    knockout_barrier: Option<f64>,
    distance_to_knockout: Option<f64>,
    strike: Option<f64>,
    distance_to_strike: Option<f64>,
    product_subcategory: Option<&'static str>,
    premium_absolute: Option<f64>,
    premium_percentage: Option<f64>,
    omega: Option<f64>,
    delta: Option<f64>,
    implied_volatility: Option<f64>,
    factor: Option<f64>,
    expiry: NaiveDate,
    is_open_end: bool,
}

fn synth_derivative_isin(seed: u64, key: &str, i: usize) -> String {
    let mut rng = Rng::for_key(seed, &format!("deriv-isin|{key}|{i}"));
    let chars: Vec<char> = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ".chars().collect();
    let body: String = (0..7).map(|_| chars[rng.range_i64(0, chars.len() as i64 - 1) as usize]).collect();
    format!("DE000{body}")
}

fn generate_derivative_ladder(seed: u64, underlying: &str, kind: &str, strategy: &str, now: DateTime<Utc>) -> Vec<DerivRow> {
    let spot = pricing::current_price(seed, underlying, now);
    let mut rng = Rng::for_key(seed, &format!("deriv-ladder|{underlying}|{kind}|{strategy}"));
    let n = 12;
    let mut rows = Vec::with_capacity(n);
    for i in 0..n {
        let issuer = DERIVATIVE_ISSUERS[i % DERIVATIVE_ISSUERS.len()];
        let expiry = now.date_naive() + Duration::days(rng.range_i64(30, 720));
        let key = format!("{underlying}|{i}");
        let isin = synth_derivative_isin(seed, &kind_key(kind, strategy), i);
        match kind {
            "knockout" => {
                let long = strategy == "long";
                let leverage = rng.range(2.0, 15.0);
                let barrier_gap = spot / leverage;
                let barrier = if long { (spot - barrier_gap).max(0.01) } else { spot + barrier_gap };
                let distance = ((spot - barrier) / spot).abs();
                let premium_abs = round2((spot / leverage) * rng.range(0.9, 1.1));
                rows.push(DerivRow {
                    isin,
                    issuer,
                    strategy: if long { "LONG".to_string() } else { "SHORT".to_string() },
                    leverage: Some(round2(leverage)),
                    knockout_barrier: Some(round2(barrier)),
                    distance_to_knockout: Some(distance),
                    strike: Some(round2(barrier)),
                    distance_to_strike: Some(distance),
                    product_subcategory: Some(if rng.chance(0.5) { "TURBO" } else { "MINI_FUTURE" }),
                    premium_absolute: Some(premium_abs),
                    premium_percentage: Some(premium_abs / spot.max(0.01)),
                    omega: None,
                    delta: None,
                    implied_volatility: None,
                    factor: None,
                    expiry,
                    is_open_end: false,
                });
            }
            "factor" => {
                let long = strategy == "long";
                let factor = rng.range(2.0, 6.0) * if long { 1.0 } else { -1.0 };
                rows.push(DerivRow {
                    isin,
                    issuer,
                    strategy: if long { "LONG".to_string() } else { "SHORT".to_string() },
                    leverage: None,
                    knockout_barrier: None,
                    distance_to_knockout: None,
                    strike: None,
                    distance_to_strike: None,
                    product_subcategory: None,
                    premium_absolute: None,
                    premium_percentage: None,
                    omega: None,
                    delta: None,
                    implied_volatility: None,
                    factor: Some(round2(factor)),
                    expiry,
                    is_open_end: false,
                });
            }
            _ => {
                // warrant
                let call = strategy == "call";
                let moneyness = rng.range(0.82, 1.22);
                let strike = spot * moneyness;
                let distance = (spot - strike) / spot.max(0.01);
                let omega = rng.range(1.5, 9.0);
                let delta = if call { rng.range(0.15, 0.9) } else { -rng.range(0.15, 0.9) };
                let iv = rng.range(0.18, 0.65);
                rows.push(DerivRow {
                    isin,
                    issuer,
                    strategy: if call { "CALL".to_string() } else { "PUT".to_string() },
                    leverage: None,
                    knockout_barrier: None,
                    distance_to_knockout: None,
                    strike: Some(round2(strike)),
                    distance_to_strike: Some(distance),
                    product_subcategory: None,
                    premium_absolute: None,
                    premium_percentage: None,
                    omega: Some(round2(omega)),
                    delta: Some(round2(delta)),
                    implied_volatility: Some(round2(iv)),
                    factor: None,
                    expiry,
                    is_open_end: false,
                });
            }
        }
        let _ = key;
    }
    rows
}

fn kind_key(kind: &str, strategy: &str) -> String {
    format!("{kind}-{strategy}")
}

fn deriv_row_to_json(underlying: &str, kind: &str, row: &DerivRow) -> Value {
    let currency = "EUR";
    match kind {
        "knockout" => json!({
            "__typename": "KnockoutSearchResult",
            "id": row.isin,
            "isin": row.isin,
            "underlyingIsin": underlying,
            "issuer": row.issuer,
            "premiumPercentage": row.premium_percentage,
            "expiryDate": {"date": {"date": row.expiry.format("%Y-%m-%d").to_string(), "epochDay": epoch_day(row.expiry)}, "isOpenEnd": row.is_open_end},
            "leverage": row.leverage,
            "knockoutBarrier": {"__typename": "Money", "currencyIsoCode": currency, "value": row.knockout_barrier},
            "distanceToKnockout": row.distance_to_knockout,
            "strike": {"__typename": "Money", "currencyIsoCode": currency, "value": row.strike},
            "distanceToStrike": row.distance_to_strike,
            "productSubcategory": row.product_subcategory,
            "premiumAbsolute": {"currencyIsoCode": currency, "value": row.premium_absolute},
            "strategy": row.strategy
        }),
        "factor" => json!({
            "__typename": "FactorCertificateSearchResult",
            "id": row.isin,
            "isin": row.isin,
            "underlyingIsin": underlying,
            "issuer": row.issuer,
            "expiryDate": {"date": {"date": row.expiry.format("%Y-%m-%d").to_string(), "epochDay": epoch_day(row.expiry)}, "isOpenEnd": row.is_open_end},
            "strategy": row.strategy,
            "factor": row.factor
        }),
        _ => json!({
            "__typename": "WarrantSearchResult",
            "id": row.isin,
            "isin": row.isin,
            "underlyingIsin": underlying,
            "issuer": row.issuer,
            "expiryDate": {"epochDay": epoch_day(row.expiry)},
            "strike": {"__typename": "Money", "currencyIsoCode": currency, "value": row.strike},
            "distanceToStrike": row.distance_to_strike,
            "strategy": row.strategy,
            "omega": row.omega,
            "delta": row.delta,
            "impliedVolatility": row.implied_volatility
        }),
    }
}

fn sort_key(row: &DerivRow, field: &str) -> f64 {
    match field {
        "strike" => row.strike.unwrap_or(0.0),
        "leverage" => row.leverage.unwrap_or(0.0),
        "expiry-date" | "expiryDate" => epoch_day(row.expiry) as f64,
        "knockout-barrier" | "knockoutBarrier" => row.knockout_barrier.unwrap_or(0.0),
        "distance-to-knockout" | "distanceToKnockout" => row.distance_to_knockout.unwrap_or(0.0),
        "premium-absolute" | "premiumAbsolute" => row.premium_absolute.unwrap_or(0.0),
        "premium-relative" | "premiumRelative" => row.premium_percentage.unwrap_or(0.0),
        "distance-to-strike" | "distanceToStrike" => row.distance_to_strike.unwrap_or(0.0),
        "omega" => row.omega.unwrap_or(0.0),
        "delta" => row.delta.unwrap_or(0.0),
        "implied-volatility" | "impliedVolatility" => row.implied_volatility.unwrap_or(0.0),
        "factor" => row.factor.unwrap_or(0.0),
        _ => 0.0,
    }
}

fn in_range(value: Option<f64>, range: Option<&Value>) -> bool {
    let Some(range) = range else { return true };
    let Some(value) = value else { return true };
    let min = range.get("min").and_then(loose_num);
    let max = range.get("max").and_then(loose_num);
    min.map(|m| value >= m).unwrap_or(true) && max.map(|m| value <= m).unwrap_or(true)
}

fn loose_num(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
}

async fn handle_derivatives_search(state: &SharedState, variables: &Value, now: DateTime<Utc>) -> Value {
    let st = state.read().await;
    let input = variables.get("input").cloned().unwrap_or_else(|| json!({}));
    let (kind, sub_input) = ["knockoutInput", "warrantInput", "factorCertificateInput"]
        .iter()
        .find_map(|k| input.get(k).filter(|v| !v.is_null()).map(|v| (k.trim_end_matches("Input").replace("Input", ""), v.clone())))
        .unwrap_or(("knockout".to_string(), json!({})));
    let kind = match kind.as_str() {
        "knockout" => "knockout",
        "warrant" => "warrant",
        _ => "factor",
    };

    let underlying = sub_input.get("underlyingIsin").and_then(Value::as_str).unwrap_or("US0378331005").to_string();
    let strategy = sub_input.get("strategy").and_then(Value::as_str).unwrap_or("LONG").to_lowercase();
    let pagination = sub_input.get("pagination").cloned().unwrap_or_else(|| json!({}));
    let limit = pagination.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
    let offset = pagination.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
    let issuers = str_array(sub_input.get("issuers"));
    let subcategories = str_array(sub_input.get("productSubcategories"));
    let expiry_from = sub_input.get("expiryDate").and_then(|d| d.get("startDate")).and_then(Value::as_str).and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    let expiry_to = sub_input.get("expiryDate").and_then(|d| d.get("endDate")).and_then(Value::as_str).and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    let sort_field = sub_input.get("sortBy").and_then(|s| s.get("field")).and_then(Value::as_str).map(str::to_string);
    let sort_order = sub_input.get("sortBy").and_then(|s| s.get("order")).and_then(Value::as_str).unwrap_or("asc").to_lowercase();

    let mut rows = generate_derivative_ladder(st.seed, &underlying, kind, &strategy, now);
    rows.retain(|r| issuers.as_ref().map(|list| list.iter().any(|i| i == r.issuer)).unwrap_or(true));
    rows.retain(|r| {
        subcategories
            .as_ref()
            .map(|list| r.product_subcategory.map(|sc| list.iter().any(|i| i == sc)).unwrap_or(false))
            .unwrap_or(true)
    });
    rows.retain(|r| in_range(r.leverage, sub_input.get("leverageRange")));
    rows.retain(|r| in_range(r.knockout_barrier, sub_input.get("knockoutBarrier")));
    rows.retain(|r| in_range(r.strike, sub_input.get("strike").or_else(|| sub_input.get("strikeRange"))));
    rows.retain(|r| in_range(r.omega, sub_input.get("omegaRange")));
    rows.retain(|r| in_range(r.delta, sub_input.get("deltaRange")));
    rows.retain(|r| in_range(r.factor, sub_input.get("factorRange")));
    rows.retain(|r| expiry_from.map(|d| r.expiry >= d).unwrap_or(true));
    rows.retain(|r| expiry_to.map(|d| r.expiry <= d).unwrap_or(true));

    if let Some(field) = &sort_field {
        rows.sort_by(|a, b| {
            let ord = sort_key(a, field).partial_cmp(&sort_key(b, field)).unwrap_or(std::cmp::Ordering::Equal);
            if sort_order == "desc" { ord.reverse() } else { ord }
        });
    }

    let total_available = rows.len();
    let page: Vec<Value> = rows.into_iter().skip(offset).take(limit.max(1)).map(|r| deriv_row_to_json(&underlying, kind, &r)).collect();

    json!({
        "account": {
            "brokerPortfolio": {
                "derivativesSearch": {
                    "pagination": {"offset": offset, "limit": limit, "totalAvailable": total_available},
                    "results": page
                }
            }
        }
    })
}

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json},
};
use chrono::Utc;
use serde_json::{json, Value};

use crate::state::{PortfolioGroup, PriceAlert, SavingsPlan, SharedState, WatchlistItem};

// Helper to detect operation
fn detect_operation(query: &str, operation_name: Option<&str>) -> String {
    if let Some(name) = operation_name {
        if !name.trim().is_empty() {
            return name.trim().to_string();
        }
    }
    // Fallback to parsing query string contains
    let q = query;
    let mapping = [
        ("BrokerOverview", "BrokerOverview"),
        ("BrokerAnalytics", "BrokerAnalytics"),
        ("BrokerLimits", "BrokerLimits"),
        ("BrokerHoldings", "BrokerHoldings"),
        ("BrokerWatchlist", "BrokerWatchlist"),
        ("BrokerSearch", "BrokerSecuritySearch"),
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
        // Mutations
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
        ("modifyPortfolioGroup", "BrokerUpdatePortfolioGroup"), // assign/unassign also uses modify
        ("deletePortfolioGroup", "BrokerDeletePortfolioGroup"),
        ("cancelOrder", "BrokerCancelOrder"),
    ];
    for (needle, op) in mapping {
        if q.contains(needle) {
            return op.to_string();
        }
    }
    // Default: try to extract operationName from query
    if let Some(start) = q.find("query ") {
        let rest = &q[start..];
        if let Some(name) = rest.split_whitespace().nth(1) {
            return name.trim_matches(|c| c == '{' || c == '(').to_string();
        }
    }
    if let Some(start) = q.find("mutation ") {
        let rest = &q[start..];
        if let Some(name) = rest.split_whitespace().nth(1) {
            return name.trim_matches(|c| c == '{' || c == '(').to_string();
        }
    }
    "Unknown".to_string()
}

pub async fn graphql_handler(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let query = body.get("query").and_then(|v| v.as_str()).unwrap_or("");
    let operation_name = body.get("operationName").and_then(|v| v.as_str());
    let variables = body.get("variables").cloned().unwrap_or(json!({}));
    let op = detect_operation(query, operation_name);

    // The mock is deliberately lenient: Authorization/DPoP headers are accepted but not
    // verified, since it only ever serves fixture data on loopback.
    let _ = &headers;

    let response_data = match op.as_str() {
        "WhoAmI" => handle_whoami(&variables).await,
        "ResolveBrokerIds" => handle_resolve_broker_ids(State(state.clone()), &variables).await,
        "Is2faOnLoginEnabled" => json!({"is2faOnLoginEnabled": {"enabled": false, "hasApprovedSession": true}}),
        "Start2faOnLogin" => json!({"start2faOnLogin": {"mfaSessionId": "mock-mfa-1"}}),
        "Validate2faOnLogin" => json!({"validate2faOnLogin": {"status": "SUCCESS"}}),
        "revokeAuthAccessToken" => json!({"revokeAuthAccessToken": {"success": true}}),
        "BrokerOverview" => handle_broker_overview(State(state.clone()), &variables).await,
        "BrokerAnalytics" => handle_broker_analytics(State(state.clone()), &variables).await,
        "BrokerLimits" => handle_broker_limits(State(state.clone()), &variables).await,
        "BrokerHoldings" => handle_broker_holdings(State(state.clone()), &variables).await,
        "BrokerWatchlist" => handle_broker_watchlist(State(state.clone()), &variables).await,
        "BrokerSecuritySearch" => handle_broker_search(State(state.clone()), &variables).await,
        "BrokerDerivativesSearch" => handle_derivatives_search(State(state.clone()), &variables).await,
        "BrokerQuote" => handle_broker_quote(State(state.clone()), &variables).await,
        "BrokerChart" => handle_broker_chart(&variables).await,
        "BrokerSecurityNews" => handle_security_news(&variables).await,
        "BrokerPriceAlerts" => handle_price_alerts(State(state.clone()), &variables).await,
        "BrokerCryptoPriceAlerts" => handle_crypto_price_alerts(State(state.clone()), &variables).await,
        "BrokerTransactions" => handle_broker_transactions(State(state.clone()), &variables).await,
        "BrokerTransactionDetails" => handle_transaction_details(State(state.clone()), &variables).await,
        "BrokerSavingsPlans" => handle_savings_plans(State(state.clone()), &variables).await,
        "BrokerSavingsPlanConfig" => handle_savings_plan_config(State(state.clone()), &variables).await,
        "BrokerSavingsPlanExAnteCost" => handle_savings_plan_ex_ante(State(state.clone()), &variables).await,
        "BrokerSavingsPlanByIsin" => handle_savings_plan_by_isin(State(state.clone()), &variables).await,
        "BrokerPortfolioGroups" => handle_portfolio_groups(State(state.clone()), &variables).await,
        "DiscoverOvernightAccounts" => handle_discover_overnight(State(state.clone()), &variables).await,
        "OvernightSummary" => handle_overnight_summary(State(state.clone()), &variables).await,
        "OvernightTransactions" => handle_overnight_transactions(State(state.clone()), &variables).await,
        // Trading
        "getTradingTradability" => handle_tradability(State(state.clone()), &variables).await,
        "getSecurityTick" => handle_security_tick(State(state.clone()), &variables).await,
        "getSingleTradeExAnteCost" => handle_single_ex_ante(State(state.clone()), &variables).await,
        "getBrokerAppropriatenessWarning" => json!({
            "brokerAppropriatenessWarning": {
                "id": "warn-1",
                "version": "v1",
                "locale": "en-DE",
                "promptText": "This instrument is not suitable. Do you want to proceed?",
                "acknowledgementText": "I acknowledge the risk"
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
                    "validUntil": {"epochSecond": 9999999999i64}
                }
            }
        }),
        "placeOrder" => handle_place_order(State(state.clone()), &variables, &headers).await,
        "BrokerCancelOrder" | "cancelOrder" => handle_cancel_order(&variables).await,
        // Mutations
        "BrokerAddToWatchlist" | "addToWatchlist" => handle_add_watchlist(State(state.clone()), &variables).await,
        "BrokerRemoveFromWatchlist" | "removeFromWatchlist" => handle_remove_watchlist(State(state.clone()), &variables).await,
        "BrokerAddPriceAlert" | "addPriceAlert" => handle_add_price_alert(State(state.clone()), &variables).await,
        "BrokerAddCryptoPriceAlert" | "addCryptoPriceAlert" => handle_add_crypto_alert(State(state.clone()), &variables).await,
        "BrokerRemovePriceAlert" | "removePriceAlert" => handle_remove_price_alert(State(state.clone()), &variables).await,
        "BrokerRemoveCryptoPriceAlert" | "removeCryptoPriceAlert" => handle_remove_price_alert(State(state.clone()), &variables).await,
        "BrokerRemoveSavingsPlan" | "removeSavingsPlan" => handle_remove_savings_plan(State(state.clone()), &variables).await,
        "BrokerCreateOrUpdateSavingsPlan" | "createOrUpdateSavingsPlan" => handle_create_savings_plan(State(state.clone()), &variables).await,
        "BrokerCreatePortfolioGroup" | "createPortfolioGroup" => handle_create_group(State(state.clone()), &variables).await,
        "BrokerUpdatePortfolioGroup" => handle_update_group(State(state.clone()), &variables, &query).await,
        "BrokerDeletePortfolioGroup" | "deletePortfolioGroup" => handle_delete_group(State(state.clone()), &variables).await,
        "BrokerAssignPortfolioGroupItems" => handle_assign_group(State(state.clone()), &variables).await,
        "BrokerUnassignPortfolioGroupItems" => handle_unassign_group(State(state.clone()), &variables).await,
        // modifyPortfolioGroup is used for both assign/unassign/update - need to disambiguate by variables
        "modifyPortfolioGroup" => handle_modify_group_dispatch(State(state.clone()), &variables, &query).await,
        _ => {
            // Fallback: try to infer from query content
            eprintln!("[mock] Unknown operation: {} query snippet: {}", op, &query.chars().take(200).collect::<String>());
            json!(null)
        }
    };

    // If response_data is an error object with "errors", return it as GraphQL errors
    if response_data.get("errors").is_some() {
        return (StatusCode::OK, Json(json!({"errors": response_data["errors"], "data": null}))).into_response();
    }

    let full = json!({"data": response_data});
    (StatusCode::OK, Json(full)).into_response()
}

async fn handle_whoami(variables: &Value) -> Value {
    let id = variables.get("id").and_then(|v| v.as_str()).unwrap_or("person-1");
    json!({
        "personOverview": {
            "id": id,
            "locale": "de-DE",
            "personalDetails": {
                "firstName": "Max",
                "lastName": "Mustermann"
            }
        }
    })
}

async fn handle_resolve_broker_ids(State(state): State<SharedState>, variables: &Value) -> Value {
    let st = state.read().await;
    let _requested_id = variables.get("id").and_then(|v| v.as_str()).unwrap_or("person-1");
    // If requested is person_id, return account mapping
    // For simplicity, always return account-1 with both portfolios
    json!({
        "account": {
            "id": st.account_id,
            "brokerPortfolios": [
                {"id": "portfolio-1"},
                {"id": "portfolio-2"}
            ]
        }
    })
}

async fn handle_broker_overview(State(state): State<SharedState>, _variables: &Value) -> Value {
    let _st = state.read().await;
    json!({
        "account": {
            "brokerPortfolio": {
                "valuation": {
                    "valuation": 12345.67,
                    "securitiesValuation": 12000.0,
                    "cryptoValuation": 345.67,
                    "timestampUtc": {"time": Utc::now().to_rfc3339()},
                    "lastInventoryUpdateTimestampUtc": {"time": Utc::now().to_rfc3339()},
                    "timeWeightedReturnByTimeframe": [
                        {"timeframe": "ONE_DAY", "value": 0.01, "simpleAbsoluteReturn": 123.0},
                        {"timeframe": "ONE_WEEK", "value": 0.03, "simpleAbsoluteReturn": 345.0}
                    ]
                }
            }
        }
    })
}

async fn handle_broker_analytics(State(_state): State<SharedState>, _variables: &Value) -> Value {
    json!({
        "account": {
            "brokerPortfolio": {
                "portfolioAnalysis": {
                    "type": "VALID",
                    "portfolioCoverage": 1.0,
                    "invalidSecurities": [],
                    "result": {
                        "id": "analysis-1",
                        "lastUpdated": {"time": Utc::now().to_rfc3339()},
                        "healthChecks": {"items": []},
                        "scenarios": {"items": []},
                        "allocations": {"items": []},
                        "equityCompanyStyles": null,
                        "fixedIncomeRatings": null,
                        "payments": null,
                        "trialPeriod": null
                    }
                }
            }
        }
    })
}

async fn handle_broker_limits(State(_state): State<SharedState>, _variables: &Value) -> Value {
    json!({
        "account": {
            "brokerPortfolio": {
                "depositLimits": {"min": "1", "max": "100000"},
                "withdrawalLimits": {"min": "1", "max": "50000", "maxExcludingCredit": "40000"},
                "payments": {
                    "buyingPower": {
                        "cashBalance": "5000.00",
                        "liveLimit": "2000.00",
                        "loaned": "0.00",
                        "pendingBuyOrdersAmount": "100.00",
                        "pendingWithdrawalsAmount": "0.00",
                        "pendingSavingsPlanAmount": "100.00",
                        "pendingDividendsReinvestmentAmount": "0.00",
                        "pendingPocketMoneyAmount": "0.00",
                        "estimatedTaxes": "50.00",
                        "directDebit": "0.00",
                        "cashAvailableToInvest": "6900.00",
                        "cashAvailableToInvestWithoutCredit": "4900.00"
                    },
                    "derivativesBuyingPower": {
                        "cashAvailableToInvest": "6900.00",
                        "derivativesDirectDebit": "0.00",
                        "pendingELTIFAmount": "0.00",
                        "cashAvailableForDerivatives": "6900.00"
                    },
                    "withdrawalPower": {
                        "cashAvailableToInvest": "6900.00",
                        "sellTradesAmount": "0.00",
                        "withdrawalDirectDebit": "0.00",
                        "cashAvailableForWithdrawal": "6900.00"
                    }
                }
            }
        }
    })
}

async fn handle_broker_holdings(State(state): State<SharedState>, _variables: &Value) -> Value {
    let st = state.read().await;
    json!({
        "account": {
            "brokerPortfolio": {
                "inventory": {
                    "items": st.holdings_for_response()
                }
            }
        }
    })
}

async fn handle_broker_watchlist(State(state): State<SharedState>, _variables: &Value) -> Value {
    let st = state.read().await;
    json!({
        "account": {
            "brokerPortfolio": {
                "watchlist": {
                    "items": st.watchlist_for_response()
                }
            }
        }
    })
}

async fn handle_broker_search(State(state): State<SharedState>, variables: &Value) -> Value {
    let st = state.read().await;
    let term = variables.get("searchTerm").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
    let filtered: Vec<Value> = st
        .instruments
        .iter()
        .filter(|h| h.name.to_lowercase().contains(&term) || h.isin.to_lowercase().contains(&term) || term.is_empty())
        .map(|h| {
            json!({
                "isin": h.isin,
                "name": h.name,
                "type": h.r#type,
                "quoteTick": {
                    "midPrice": h.mid_price,
                    "currency": h.currency,
                    "timestampUtc": {"time": Utc::now().to_rfc3339()},
                    "isOutdated": false
                }
            })
        })
        .collect();
    json!({
        "account": {
            "brokerPortfolio": {
                "simpleSecuritySearch": {
                    "items": filtered
                }
            }
        }
    })
}

async fn handle_derivatives_search(State(state): State<SharedState>, variables: &Value) -> Value {
    let st = state.read().await;
    let input = variables.get("input").cloned().unwrap_or(json!({}));
    // For simplicity, ignore filters and return derivatives
    let filtered = st.derivatives.clone();
    // Handle pagination
    let limit = input
        .get("knockoutInput").and_then(|v| v.get("pagination")).and_then(|v| v.get("limit")).and_then(|v| v.as_u64()).unwrap_or(50);
    let offset = input
        .get("knockoutInput").and_then(|v| v.get("pagination")).and_then(|v| v.get("offset")).and_then(|v| v.as_u64())
        .or_else(|| input.get("warrantInput").and_then(|v| v.get("pagination")).and_then(|v| v.get("limit")).and_then(|v| v.as_u64()))
        .unwrap_or(0);
    let total = filtered.len() as u64;
    let paginated: Vec<Value> = filtered.into_iter().skip(offset as usize).take(limit as usize).collect();
    json!({
        "account": {
            "brokerPortfolio": {
                "derivativesSearch": {
                    "pagination": {"offset": offset, "limit": limit, "totalAvailable": total},
                    "results": paginated
                }
            }
        }
    })
}

async fn handle_broker_quote(State(state): State<SharedState>, variables: &Value) -> Value {
    let st = state.read().await;
    let isin = variables.get("isin").and_then(|v| v.as_str()).unwrap_or("US0378331005");
    let holding = st.holdings.iter().find(|h| h.isin == isin).cloned().unwrap_or_else(|| st.holdings[0].clone());
    json!({
        "account": {
            "brokerPortfolio": {
                "security": {
                    "id": format!("sec-{}", isin),
                    "isin": isin,
                    "name": holding.name,
                    "type": holding.r#type,
                    "quoteTick": {
                        "id": format!("qt-{}", isin),
                        "isin": isin,
                        "midPrice": holding.mid_price,
                        "currency": holding.currency,
                        "bidPrice": holding.mid_price - 0.05,
                        "askPrice": holding.mid_price + 0.05,
                        "isOutdated": false,
                        "timestampUtc": {"time": Utc::now().to_rfc3339()},
                        "performanceDate": {"date": Utc::now().format("%Y-%m-%d").to_string()},
                        "performancesByTimeframe": [
                            {"timeframe": "ONE_DAY", "performance": 0.01, "simpleAbsoluteReturn": 1.2}
                        ]
                    }
                }
            }
        }
    })
}

async fn handle_broker_chart(variables: &Value) -> Value {
    let isin = variables.get("isin").and_then(|v| v.as_str()).unwrap_or("US0378331005");
    let timeframe = variables.get("timeFrames").and_then(|v| v.as_array()).and_then(|a| a.get(0)).and_then(|v| v.as_str()).unwrap_or("ONE_MONTH");
    let points: Vec<Value> = (0..30).map(|i| json!({
        "midPrice": 180.0 + (i as f64)*0.3,
        "timestampUtc": {"time": Utc::now().to_rfc3339()}
    })).collect();
    json!({
        "timeSeriesBySecurity": [
            {
                "isin": isin,
                "timeFrame": timeframe,
                "currency": "USD",
                "source": "CONSOLIDATED",
                "closingReferencePoint": {"midPrice": 180.0, "timestampUtc": {"time": Utc::now().to_rfc3339()}},
                "dataPoints": points
            }
        ]
    })
}

async fn handle_security_news(variables: &Value) -> Value {
    let isin = variables.get("isin").and_then(|v| v.as_str()).unwrap_or("US0378331005");
    let locale = variables.get("locale").and_then(|v| v.as_str()).unwrap_or("en_DE");
    json!({
        "securityNews": {
            "isin": isin,
            "shortNewsSummary": format!("Mock news summary for {} ({})", isin, locale),
            "longNewsSummary": format!("Detailed mock news for {} in {} locale. This is synthetic data for testing.", isin, locale),
            "lastUpdated": {"time": Utc::now().to_rfc3339()},
            "sources": [
                {"id": "src-1", "headline": "Mock Headline 1", "sourceName": "Mock News", "publicationTime": {"time": Utc::now().to_rfc3339()}}
            ]
        }
    })
}

async fn handle_price_alerts(State(state): State<SharedState>, variables: &Value) -> Value {
    let active_only = variables.get("activeOnly").and_then(|v| v.as_bool()).unwrap_or(false);
    let st = state.read().await;
    json!({
        "account": {
            "brokerPortfolio": {
                "priceAlerts": {
                    "itemsPerInstrument": st.price_alerts_for_response(active_only)
                }
            }
        }
    })
}

async fn handle_crypto_price_alerts(State(state): State<SharedState>, _variables: &Value) -> Value {
    let st = state.read().await;
    json!({
        "account": {
            "brokerPortfolio": {
                "crypto": {
                    "priceAlerts": {
                        "itemsPerInstrument": st.crypto_alerts_for_response()
                    }
                }
            }
        }
    })
}

async fn handle_broker_transactions(State(state): State<SharedState>, variables: &Value) -> Value {
    let st = state.read().await;
    let input = variables.get("input").cloned().unwrap_or(json!({}));
    let page_size = input.get("pageSize").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
    let cursor = input.get("cursor").and_then(|v| v.as_str());
    let start = cursor.and_then(|c| c.parse::<usize>().ok()).unwrap_or(0);
    let filtered = st.transactions.clone();
    let total = filtered.len();
    let end = (start + page_size).min(total);
    let slice = &filtered[start..end];
    let next_cursor = if end < total { Some(end.to_string()) } else { None };
    let txns: Vec<Value> = slice.iter().map(|t| {
        let mut base = json!({
            "__typename": "BrokerSecurityTransactionSummary",
            "id": t.id,
            "currency": t.currency,
            "type": t.r#type,
            "status": t.status,
            "isCancellation": t.is_cancellation,
            "lastEventDateTime": t.last_event,
            "description": t.description,
            "custodian": "BROKER",
            "documents": [],
            "isin": t.isin,
            "securityTransactionType": "BUY",
            "quantity": t.quantity,
            "amount": t.amount,
            "side": t.side,
            "limitPrice": null,
            "stopPrice": null
        });
        // Handle cash types
        if t.r#type == "CASH_TRANSFER_IN" {
            base["__typename"] = json!("BrokerCashTransactionSummary");
            base["cashTransactionType"] = json!("DEPOSIT");
            base["relatedIsin"] = json!(null);
        }
        base
    }).collect();
    json!({
        "account": {
            "brokerPortfolio": {
                "moreTransactions": {
                    "cursor": next_cursor,
                    "total": total,
                    "transactions": txns
                }
            }
        }
    })
}

async fn handle_transaction_details(State(state): State<SharedState>, variables: &Value) -> Value {
    let st = state.read().await;
    let txn_id = variables.get("transactionId").and_then(|v| v.as_str()).unwrap_or("txn-1");
    let txn = st.transactions.iter().find(|t| t.id == txn_id).cloned().unwrap_or_else(|| st.transactions[0].clone());
    json!({
        "account": {
            "brokerPortfolio": {
                "transactionDetails": {
                    "__typename": "BrokerSecurityTransaction",
                    "id": txn.id,
                    "currency": txn.currency,
                    "type": txn.r#type,
                    "documents": [],
                    "lastEventDateTime": txn.last_event,
                    "isPending": txn.status == "PENDING",
                    "isCancellation": txn.is_cancellation,
                    "security": {"isin": txn.isin, "name": "Mock Security", "type": "EQ"},
                    "transactionReference": format!("ref-{}", txn.id),
                    "side": txn.side,
                    "status": txn.status,
                    "numberOfShares": {"filled": txn.quantity, "total": txn.quantity},
                    "averagePrice": 150.0,
                    "totalAmount": txn.amount,
                    "finalisationReason": null,
                    "limitPrice": null,
                    "stopPrice": null,
                    "validUntil": null,
                    "isCancellationRequested": false,
                    "tradeTransactionAmounts": {"marketValuation": 1000.0, "taxAmount": 10.0, "transactionFee": 1.0, "venueFee": 0.5, "cryptoSpreadFee": null},
                    "tradingVenue": "GETTEX",
                    "fee": 1.0,
                    "transactionalFee": 1.0,
                    "taxes": null,
                    "aggregatedTransactionTaxes": {"totalTax": 10.0, "capitalGainsTax": 5.0, "churchTax": 0.0, "solidarityTax": 0.5, "sourceTax": 4.5, "financialTransactionTax": 0.0},
                    "securityTransactionHistory": [{"state": "FILLED", "time": {"time": txn.last_event, "epochSecond": 1710000000i64, "epochMillisecond": 1710000000000i64}, "numberOfShares": {"filled": txn.quantity, "total": txn.quantity}, "executionPrice": 150.0}],
                    "orderKind": "MARKET",
                    "linkedTransactions": [],
                    "trailingStopInfo": null
                }
            }
        }
    })
}

async fn handle_savings_plans(State(state): State<SharedState>, _variables: &Value) -> Value {
    let st = state.read().await;
    let items: Vec<Value> = st.savings_plans.iter().map(|sp| {
        json!({
            "isin": sp.isin,
            "name": sp.name,
            "type": "ETF",
            "inventory": {
                "savingsPlan": {
                    "isin": sp.isin,
                    "amount": sp.amount,
                    "frequency": sp.frequency,
                    "dayOfTheMonth": sp.day_of_month,
                    "dynamizationRate": sp.dynamization_rate,
                    "paymentMethod": sp.payment_method,
                    "nextExecutionDate": {"date": sp.next_execution_date, "epochDay": 20100}
                }
            }
        })
    }).collect();
    json!({
        "account": {
            "brokerPortfolio": {
                "totalSavingsPlanAmount": "100",
                "inventory": {"items": items},
                "crypto": {"coins": []}
            }
        }
    })
}

async fn handle_savings_plan_config(State(state): State<SharedState>, variables: &Value) -> Value {
    let isin = variables.get("isin").and_then(|v| v.as_str()).unwrap_or("IE00B4L5Y983");
    let st = state.read().await;
    let holding = st.holdings.iter().find(|h| h.isin == isin).map(|h| h.name.clone()).unwrap_or_else(|| "Mock ETF".to_string());
    json!({
        "account": {
            "brokerPortfolio": {
                "security": {
                    "isin": isin,
                    "name": holding,
                    "type": "ETF",
                    "savingsPlanConfiguration": {
                        "schedules": [
                            {"dayOfTheMonth": 1, "isEarliest": true, "isDefault": true, "yearMonths": [{"yearMonth": "2026-09", "isAvailable": true}, {"yearMonth": "2026-10", "isAvailable": true}]},
                            {"dayOfTheMonth": 15, "isEarliest": false, "isDefault": false, "yearMonths": [{"yearMonth": "2026-09", "isAvailable": true}]}
                        ],
                        "minSavingsPlanAmount": "1",
                        "maxSavingsPlanAmount": "10000",
                        "defaultMinSavingsPlanAmount": "25",
                        "dynamizationRates": [0, 1, 1.5, 2],
                        "defaultDynamizationRate": 0,
                        "paymentMethods": ["REFERENCE_ACCOUNT", "BUYING_POWER_WITH_REFERENCE_ACCOUNT_FALLBACK"],
                        "frequencies": ["MONTHLY", "BI_MONTHLY", "QUARTERLY"],
                        "nextInstructedExecutionDate": {"date": "2026-09-01", "epochDay": 20100}
                    }
                }
            }
        }
    })
}

async fn handle_savings_plan_ex_ante(State(_state): State<SharedState>, variables: &Value) -> Value {
    let isin = variables.get("isin").and_then(|v| v.as_str()).unwrap_or("IE00B4L5Y983");
    json!({
        "account": {
            "brokerPortfolio": {
                "savingsPlanExAnteCosts": {
                    "id": format!("ex-ante-{}", isin),
                    "entryCosts": {"productCosts": {"amount": "0.50", "percentage": "0.005"}, "serviceCosts": {"amount": "0.30", "percentage": "0.003"}, "total": {"amount": "0.80", "percentage": "0.008"}},
                    "ongoingCosts": {"productCosts": {"amount": "1.20", "percentage": "0.012"}, "serviceCosts": {"amount": "0.80", "percentage": "0.008"}, "total": {"amount": "2.00", "percentage": "0.02"}},
                    "exitCosts": {"productCosts": {"amount": "0.10", "percentage": "0.001"}, "serviceCosts": {"amount": "0.10", "percentage": "0.001"}, "total": {"amount": "0.20", "percentage": "0.002"}},
                    "effectOnReturn": {
                        "initialYearCosts": {"amount": "2.80", "percentage": "0.028"},
                        "followingYearsCosts": {"amount": "2.00", "percentage": "0.02"},
                        "finalYearCosts": {"amount": "0.20", "percentage": "0.002"}
                    },
                    "fiveYearsCosts": {"amount": "10.80", "percentage": "0.021"},
                    "incidentalCosts": {"amount": "0.00", "percentage": "0.00"}
                }
            }
        }
    })
}

async fn handle_savings_plan_by_isin(State(state): State<SharedState>, variables: &Value) -> Value {
    let isin = variables.get("isin").and_then(|v| v.as_str()).unwrap_or("IE00B4L5Y983");
    let st = state.read().await;
    let plan = st.savings_plans.iter().find(|p| p.isin == isin);
    if let Some(sp) = plan {
        json!({
            "account": {
                "brokerPortfolio": {
                    "security": {
                        "isin": isin,
                        "name": sp.name,
                        "type": "ETF",
                        "inventory": {
                            "savingsPlan": {
                                "isin": sp.isin,
                                "amount": sp.amount,
                                "frequency": sp.frequency,
                                "dayOfTheMonth": sp.day_of_month,
                                "dynamizationRate": sp.dynamization_rate,
                                "paymentMethod": sp.payment_method,
                                "nextExecutionDate": {"date": sp.next_execution_date, "epochDay": 20100}
                            }
                        }
                    }
                }
            }
        })
    } else {
        json!({
            "account": {
                "brokerPortfolio": {
                    "security": {
                        "isin": isin,
                        "name": "Unknown",
                        "type": "ETF",
                        "inventory": {
                            "savingsPlan": null
                        }
                    }
                }
            }
        })
    }
}

async fn handle_portfolio_groups(State(state): State<SharedState>, _variables: &Value) -> Value {
    let st = state.read().await;
    json!({
        "account": {
            "brokerPortfolio": {
                "inventory": st.portfolio_groups_for_response()
            }
        }
    })
}

async fn handle_discover_overnight(State(state): State<SharedState>, _variables: &Value) -> Value {
    let _st = state.read().await;
    json!({
        "account": {
            "savingsAccounts": [
                {
                    "__typename": "OvernightSavingsAccount",
                    "id": "sav-1",
                    "owners": [{"firstName": "Max", "lastName": "Mustermann"}],
                    "personalizations": {"name": "Tagesgeld"},
                    "state": "ACTIVE"
                }
            ]
        },
        "productList": {
            "minors": []
        }
    })
}

async fn handle_overnight_summary(State(_state): State<SharedState>, _variables: &Value) -> Value {
    json!({
        "account": {
            "savingsAccount": {
                "id": "sav-1",
                "interests": {
                    "currentAccruedAmount": "12.34",
                    "currentInterestBearingAmount": "5000.00",
                    "depositAccruedLifetimeAmount": "123.45",
                    "depositInterestRate": "0.03",
                    "estimatedNextPayoutAmount": "12.34",
                    "nextPayoutDate": {"epochSecond": 1735689600i64}
                },
                "nextPayoutDate": {"epochSecond": 1735689600i64},
                "totalAmount": "5012.34"
            }
        }
    })
}

async fn handle_overnight_transactions(State(_state): State<SharedState>, variables: &Value) -> Value {
    let input = variables.get("input").cloned().unwrap_or(json!({}));
    let page_size = input.get("pageSize").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
    let transactions = vec![
        json!({"id": "otxn-1", "currency": "EUR", "type": "INTEREST", "status": "SETTLED", "isCancellation": false, "lastEventDateTime": Utc::now().to_rfc3339(), "description": "Interest payout", "cashTransactionType": "INTEREST", "amount": "12.34", "custodian": "SAVINGS", "relatedIsin": null, "documents": []}),
        json!({"id": "otxn-2", "currency": "EUR", "type": "DEPOSIT", "status": "SETTLED", "isCancellation": false, "lastEventDateTime": Utc::now().to_rfc3339(), "description": "Deposit", "cashTransactionType": "DEPOSIT", "amount": "1000.00", "custodian": "SAVINGS", "relatedIsin": null, "documents": []}),
    ];
    let total = transactions.len();
    let slice: Vec<Value> = transactions.into_iter().take(page_size).collect();
    json!({
        "account": {
            "savingsAccount": {
                "id": "sav-1",
                "moreTransactions": {
                    "cursor": null,
                    "total": total,
                    "transactions": slice
                }
            }
        }
    })
}

async fn handle_tradability(State(_state): State<SharedState>, variables: &Value) -> Value {
    let isin = variables.get("isin").and_then(|v| v.as_str()).unwrap_or("US0378331005");
    let portfolio_id = variables.get("portfolioId").and_then(|v| v.as_str()).unwrap_or("portfolio-1");
    // For demo, make everything tradable, no appropriateness required except for specific ISINs
    let requires_appropriateness = isin == "DE000HS12345"; // derivative underlying?
    let requires_suitability = isin == "DE000KG12345"; // knockout
    json!({
        "account": {
            "id": "person-1",
            "brokerPortfolio": {
                "id": portfolio_id,
                "appropriatenessInfo": {
                    "id": "appr-1",
                    "appropriatenessId": "appr-id-1",
                    "result": if requires_appropriateness { "NOT_APPROPRIATE" } else { "APPROPRIATE" }
                },
                "suitabilityStatuses": if requires_suitability {
                    json!([{"id": "suit-1", "suitabilityType": "KNOCKOUT", "result": "SUITABLE", "suitabilityId": "suit-id-1"}])
                } else { json!([]) },
                "featureFlags": {"knockoutWarnings": true},
                "security": {
                    "id": format!("sec-{}", isin),
                    "requiredSuitability": if requires_suitability {
                        json!({"suitabilityType": "KNOCKOUT", "actionWhenUnsuitable": "PROCEED_TO_ORDER_FLOW"})
                    } else { json!(null) },
                    "buyTradabilityForTrading": {
                        "id": "bt-1",
                        "tradabilityStatus": "TRADABLE",
                        "venues": [
                            {"venue": "GETTEX", "tradabilityStatus": "TRADABLE", "unavailabilityReason": null},
                            {"venue": "XETR", "tradabilityStatus": "TRADABLE", "unavailabilityReason": null}
                        ],
                        "primaryVenue": {"venue": "GETTEX", "status": "TRADABLE"}
                    },
                    "sellTradabilityForTrading": {
                        "id": "st-1",
                        "tradabilityStatus": "TRADABLE",
                        "venues": [
                            {"venue": "GETTEX", "tradabilityStatus": "TRADABLE", "unavailabilityReason": null},
                            {"venue": "XETR", "tradabilityStatus": "TRADABLE", "unavailabilityReason": null}
                        ],
                        "primaryVenue": {"venue": "GETTEX", "status": "TRADABLE"}
                    },
                    "inventory": {
                        "position": {
                            "sellableByVenue": [
                                {"venue": "GETTEX", "sellable": 10.0},
                                {"venue": "XETR", "sellable": 10.0}
                            ]
                        }
                    }
                }
            }
        }
    })
}

async fn handle_security_tick(State(state): State<SharedState>, variables: &Value) -> Value {
    let isin = variables.get("isin").and_then(|v| v.as_str()).unwrap_or("US0378331005");
    let st = state.read().await;
    let h = st.holdings.iter().find(|h| h.isin == isin).cloned().unwrap_or_else(|| st.holdings[0].clone());
    json!({
        "account": {
            "id": "person-1",
            "brokerPortfolio": {
                "id": "portfolio-1",
                "security": {
                    "id": format!("sec-{}", isin),
                    "isin": isin,
                    "quoteTick": {
                        "askPrice": h.mid_price + 0.05,
                        "bidPrice": h.mid_price - 0.05,
                        "midPrice": h.mid_price,
                        "currency": h.currency,
                        "isOutdated": false,
                        "timestampUtc": {"time": Utc::now().to_rfc3339()}
                    },
                    "issuerLinks": {
                        "kidLinks": [
                            {"isPrimary": true, "url": "https://example.com/kid.pdf", "locale": "en_DE"},
                            {"isPrimary": false, "url": "https://example.com/kid2.pdf", "locale": "en_DE"}
                        ]
                    }
                }
            }
        }
    })
}

async fn handle_single_ex_ante(State(_state): State<SharedState>, _variables: &Value) -> Value {
    json!({
        "account": {
            "id": "person-1",
            "brokerPortfolio": {
                "id": "portfolio-1",
                "singleTradeExAnteCosts": {
                    "id": "ex-ante-1",
                    "entryCosts": {"productCosts": {"amount": "1.00", "percentage": "0.01"}, "serviceCosts": {"amount": "0.50", "percentage": "0.005"}, "total": {"amount": "1.50", "percentage": "0.015"}},
                    "ongoingCosts": {"productCosts": {"amount": "0.20", "percentage": "0.002"}, "serviceCosts": {"amount": "0.10", "percentage": "0.001"}, "total": {"amount": "0.30", "percentage": "0.003"}},
                    "exitCosts": {"productCosts": {"amount": "0.10", "percentage": "0.001"}, "serviceCosts": {"amount": "0.10", "percentage": "0.001"}, "total": {"amount": "0.20", "percentage": "0.002"}},
                    "effectOnReturn": {
                        "initialYearCosts": {"amount": "1.80", "percentage": "0.018"},
                        "followingYearsCosts": {"amount": "0.30", "percentage": "0.003"},
                        "finalYearCosts": {"amount": "0.20", "percentage": "0.002"}
                    },
                    "fiveYearsCosts": {"amount": "3.10", "percentage": "0.006"},
                    "incidentalCosts": {"amount": "0.00", "percentage": "0.00"}
                }
            }
        }
    })
}

async fn handle_place_order(State(state): State<SharedState>, _variables: &Value, headers: &HeaderMap) -> Value {
    let mut st = state.write().await;
    let order_id = format!("order-{}", st.next_order_id);
    st.next_order_id += 1;
    // Check idempotency - if header present and we have seen it, we could return same id, but for simplicity always new
    let _idem = headers.get("x-sc-idempotency-id").and_then(|v| v.to_str().ok()).unwrap_or("none");
    json!({
        "placeOrder": {
            "brokerPortfolio": {"id": "portfolio-1"},
            "orderData": {"orderId": order_id, "isMarketable": true}
        }
    })
}

async fn handle_cancel_order(variables: &Value) -> Value {
    json!({
        "cancelOrder": {"id": variables.get("orderId").and_then(|v| v.as_str()).unwrap_or("order-123")}
    })
}

async fn handle_add_watchlist(State(state): State<SharedState>, variables: &Value) -> Value {
    let _portfolio_id = variables.get("portfolioId").and_then(|v| v.as_str()).unwrap_or("portfolio-1");
    let isin = variables.get("isin").and_then(|v| v.as_str()).or_else(|| variables.get("input").and_then(|v| v.get("isin")).and_then(|v| v.as_str())).unwrap_or("US0378331005");
    let mut st = state.write().await;
    if !st.watchlist.iter().any(|w| w.isin == isin) {
        let holding = st.holdings.iter().find(|h| h.isin == isin).cloned();
        st.watchlist.push(WatchlistItem {
            isin: isin.to_string(),
            name: holding.map(|h| h.name).unwrap_or_else(|| isin.to_string()),
            r#type: "EQ".to_string(),
            mid_price: 100.0,
            currency: "EUR".to_string(),
        });
    }
    json!({
        "addToWatchlist": {
            "security": {"isin": isin, "isOnWatchlist": true}
        }
    })
}

async fn handle_remove_watchlist(State(state): State<SharedState>, variables: &Value) -> Value {
    let isin = variables.get("isin").and_then(|v| v.as_str()).or_else(|| variables.get("input").and_then(|v| v.get("isin")).and_then(|v| v.as_str())).unwrap_or("US0378331005");
    let mut st = state.write().await;
    st.watchlist.retain(|w| w.isin != isin);
    json!({
        "removeFromWatchlist": {
            "security": {"isin": isin, "isOnWatchlist": false}
        }
    })
}

async fn handle_add_price_alert(State(state): State<SharedState>, variables: &Value) -> Value {
    let _portfolio_id = variables.get("portfolioId").and_then(|v| v.as_str()).unwrap_or("portfolio-1");
    let isin = variables.get("isin").and_then(|v| v.as_str()).unwrap_or("US0378331005");
    let price = variables.get("price").and_then(|v| v.as_str()).or_else(|| variables.get("price").and_then(|v| v.as_str())).unwrap_or("100");
    let price_val = variables.get("price").cloned().unwrap_or(json!("100"));
    let mut st = state.write().await;
    let id = format!("alert-{}", st.next_alert_id);
    st.next_alert_id += 1;
    st.price_alerts.push(PriceAlert {
        id: id.clone(),
        isin: Some(isin.to_string()),
        ticker: None,
        price: price.to_string(),
        direction: "ABOVE".to_string(),
        is_active: true,
        name: isin.to_string(),
    });
    json!({
        "addPriceAlert": {
            "security": {
                "isin": isin,
                "priceAlerts": {
                    "canAddNew": true,
                    "items": [{"id": id, "direction": "ABOVE", "isActive": true, "price": price_val, "triggeredTimestamp": null, "security": {"isin": isin, "name": isin, "type": "EQ"}}]
                }
            }
        }
    })
}

async fn handle_add_crypto_alert(State(state): State<SharedState>, variables: &Value) -> Value {
    let ticker = variables.get("ticker").and_then(|v| v.as_str()).unwrap_or("BTC");
    let price = variables.get("price").and_then(|v| v.as_str()).unwrap_or("50000");
    let price_val = variables.get("price").cloned().unwrap_or(json!("50000"));
    let mut st = state.write().await;
    let id = format!("alert-{}", st.next_alert_id);
    st.next_alert_id += 1;
    st.price_alerts.push(PriceAlert {
        id: id.clone(),
        isin: None,
        ticker: Some(ticker.to_string()),
        price: price.to_string(),
        direction: "ABOVE".to_string(),
        is_active: true,
        name: ticker.to_string(),
    });
    json!({
        "addCryptoPriceAlert": {
            "crypto": {
                "coin": {
                    "ticker": ticker,
                    "name": ticker,
                    "priceAlerts": {
                        "canAddNew": true,
                        "items": [{"id": id, "direction": "ABOVE", "isActive": true, "price": price_val, "triggeredTimestamp": null, "coin": {"ticker": ticker, "name": ticker}}]
                    }
                }
            }
        }
    })
}

async fn handle_remove_price_alert(State(state): State<SharedState>, variables: &Value) -> Value {
    let alert_id = variables.get("alertId").and_then(|v| v.as_str()).or_else(|| variables.get("id").and_then(|v| v.as_str())).unwrap_or("alert-1");
    let mut st = state.write().await;
    st.price_alerts.retain(|a| a.id != alert_id);
    json!({
        "removePriceAlert": {"id": alert_id},
        "removeCryptoPriceAlert": {"id": alert_id}
    })
}

async fn handle_remove_savings_plan(State(state): State<SharedState>, variables: &Value) -> Value {
    let isin = variables.get("isin").and_then(|v| v.as_str()).unwrap_or("IE00B4L5Y983");
    let mut st = state.write().await;
    st.savings_plans.retain(|s| s.isin != isin);
    json!({
        "removeSavingsPlan": {"id": format!("removed-{}", isin)}
    })
}

async fn handle_create_savings_plan(State(state): State<SharedState>, variables: &Value) -> Value {
    let _portfolio_id = variables.get("portfolioId").and_then(|v| v.as_str()).unwrap_or("portfolio-1");
    let input = variables.get("input").cloned().unwrap_or(json!({}));
    let isin = input.get("isin").and_then(|v| v.as_str()).unwrap_or("IE00B4L5Y983");
    let amount = input.get("amount").and_then(|v| v.as_str()).unwrap_or("100");
    let mut st = state.write().await;
    // Upsert
    if let Some(existing) = st.savings_plans.iter_mut().find(|s| s.isin == isin) {
        existing.amount = amount.to_string();
    } else {
        st.savings_plans.push(SavingsPlan {
            isin: isin.to_string(),
            name: isin.to_string(),
            amount: amount.to_string(),
            frequency: input.get("frequency").and_then(|v| v.as_str()).unwrap_or("MONTHLY").to_string(),
            day_of_month: input.get("dayOfTheMonth").and_then(|v| v.as_u64()).unwrap_or(1) as u8,
            dynamization_rate: input.get("dynamizationRate").and_then(|v| v.as_str()).unwrap_or("0").to_string(),
            payment_method: input.get("paymentMethod").and_then(|v| v.as_str()).unwrap_or("REFERENCE_ACCOUNT").to_string(),
            next_execution_date: "2026-09-01".to_string(),
        });
    }
    json!({
        "createOrUpdateSavingsPlan": {"id": format!("savings-{}", isin)}
    })
}

async fn handle_create_group(State(state): State<SharedState>, variables: &Value) -> Value {
    let input = variables.get("input").cloned().unwrap_or(json!({}));
    let name = input.get("name").and_then(|v| v.as_str()).unwrap_or("New Group");
    let description = input.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());
    let mut st = state.write().await;
    let id = format!("group-{}", st.next_group_id);
    st.next_group_id += 1;
    st.portfolio_groups.push(PortfolioGroup {
        id: id.clone(),
        name: name.to_string(),
        description,
        items: vec![],
    });
    json!({
        "createPortfolioGroup": {
            "portfolioGroup": {"id": id}
        }
    })
}

async fn handle_update_group(State(state): State<SharedState>, variables: &Value, _query: &str) -> Value {
    // Handles update via modifyPortfolioGroup with portfolioGroupDetails
    let input = variables.get("input").cloned().unwrap_or(json!({}));
    let group_id = input.get("id").and_then(|v| v.as_str()).or_else(|| variables.get("groupId").and_then(|v| v.as_str())).unwrap_or("group-1");
    let mut st = state.write().await;
    if let Some(group) = st.portfolio_groups.iter_mut().find(|g| g.id == group_id) {
        if let Some(details) = input.get("portfolioGroupDetails").or_else(|| input.get("details")) {
            if let Some(name) = details.get("name").and_then(|v| v.as_str()) {
                group.name = name.to_string();
            }
            if details.get("description").is_some() {
                let desc = details.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());
                group.description = desc;
            }
            // handle clear description via null
            if details.get("description").is_some() && details.get("description").unwrap().is_null() {
                group.description = None;
            }
        }
        // Also handle direct input.name
        if let Some(name) = input.get("name").and_then(|v| v.as_str()) {
            group.name = name.to_string();
        }
        json!({
            "modifyPortfolioGroup": {
                "id": group_id
            }
        })
    } else {
        // Return error as GraphQL error
        json!({
            "errors": [{"message": "PortfolioGroupNotFound: group not found", "extensions": {"code": "PORTFOLIO_GROUP_NOT_FOUND"}}]
        })
    }
}

async fn handle_delete_group(State(state): State<SharedState>, variables: &Value) -> Value {
    let input = variables.get("input").cloned().unwrap_or(json!({}));
    let group_id = input.get("id").and_then(|v| v.as_str()).or_else(|| variables.get("groupId").and_then(|v| v.as_str())).unwrap_or("group-1");
    let mut st = state.write().await;
    let before = st.portfolio_groups.len();
    st.portfolio_groups.retain(|g| g.id != group_id);
    if st.portfolio_groups.len() == before {
        return json!({
            "errors": [{"message": "PortfolioGroupNotFound", "extensions": {"code": "PORTFOLIO_GROUP_NOT_FOUND"}}]
        });
    }
    json!({
        "deletePortfolioGroup": {"id": group_id}
    })
}

async fn handle_assign_group(State(state): State<SharedState>, variables: &Value) -> Value {
    let input = variables.get("input").cloned().unwrap_or(json!({}));
    let group_id = input.get("id").and_then(|v| v.as_str()).unwrap_or("group-1");
    let items_to_add = input.get("portfolioGroupItems").and_then(|v| v.get("itemsToAdd")).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut st = state.write().await;
    // Validate and assign
    for val in &items_to_add {
        if let Some(isin) = val.as_str() {
            // Check if already in target group -> error
            if let Some(group) = st.portfolio_groups.iter().find(|g| g.id == group_id) {
                if group.items.contains(&isin.to_string()) {
                    return json!({
                        "errors": [{"message": format!("PortfolioGroupValidation: ISIN {} already in group", isin), "extensions": {"code": "PORTFOLIO_GROUP_VALIDATION"}}]
                    });
                }
            }
            // Remove from other groups
            for g in st.portfolio_groups.iter_mut() {
                g.items.retain(|i| i != isin);
            }
            // Add to target
            if let Some(target) = st.portfolio_groups.iter_mut().find(|g| g.id == group_id) {
                target.items.push(isin.to_string());
            }
        }
    }
    json!({
        "modifyPortfolioGroup": {
            "id": group_id
        }
    })
}

async fn handle_unassign_group(State(state): State<SharedState>, variables: &Value) -> Value {
    let input = variables.get("input").cloned().unwrap_or(json!({}));
    let group_id = input.get("id").and_then(|v| v.as_str()).unwrap_or("group-1");
    let items_to_remove = input.get("portfolioGroupItems").and_then(|v| v.get("itemsToRemove")).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut st = state.write().await;
    if let Some(group) = st.portfolio_groups.iter_mut().find(|g| g.id == group_id) {
        for val in &items_to_remove {
            if let Some(isin) = val.as_str() {
                if !group.items.contains(&isin.to_string()) {
                    return json!({
                        "errors": [{"message": format!("PortfolioGroupValidation: ISIN {} not in group", isin), "extensions": {"code": "PORTFOLIO_GROUP_VALIDATION"}}]
                    });
                }
                group.items.retain(|i| i != isin);
            }
        }
        json!({
            "modifyPortfolioGroup": {
                "id": group_id
            }
        })
    } else {
        json!({
            "errors": [{"message": "PortfolioGroupNotFound", "extensions": {"code": "PORTFOLIO_GROUP_NOT_FOUND"}}]
        })
    }
}

async fn handle_modify_group_dispatch(State(state): State<SharedState>, variables: &Value, query: &str) -> Value {
    // Distinguish between update vs assign/unassign based on variables
    let input = variables.get("input").cloned().unwrap_or(json!({}));
    if input.get("portfolioGroupItems").is_some() {
        let items_to_add = input.get("portfolioGroupItems").and_then(|v| v.get("itemsToAdd")).and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
        let items_to_remove = input.get("portfolioGroupItems").and_then(|v| v.get("itemsToRemove")).and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
        if items_to_add > 0 {
            return handle_assign_group(State(state), variables).await;
        }
        if items_to_remove > 0 {
            return handle_unassign_group(State(state), variables).await;
        }
    }
    if input.get("portfolioGroupDetails").is_some() || input.get("id").is_some() {
        return handle_update_group(State(state), variables, query).await;
    }
    handle_update_group(State(state), variables, query).await
}

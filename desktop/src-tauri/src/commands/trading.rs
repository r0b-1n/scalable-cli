use crate::sc::run_sc_command;
use serde_json::Value;

#[tauri::command]
pub async fn trade_preview(
    side: String,
    isin: String,
    amount: Option<String>,
    shares: Option<String>,
    order_type: Option<String>,
    limit_price: Option<String>,
    stop_price: Option<String>,
    venue: Option<String>,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    let mut args = vec!["broker", "trade", &side, "--isin", &isin];
    if let Some(a) = &amount {
        args.push("--amount");
        args.push(a);
    }
    if let Some(s) = &shares {
        args.push("--shares");
        args.push(s);
    }
    if let Some(ot) = &order_type {
        args.push("--order-type");
        args.push(ot);
    }
    if let Some(lp) = &limit_price {
        args.push("--limit-price");
        args.push(lp);
    }
    if let Some(sp) = &stop_price {
        args.push("--stop-price");
        args.push(sp);
    }
    if let Some(v) = &venue {
        args.push("--venue");
        args.push(v);
    }
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn trade_submit(
    side: String,
    confirmation_id: String,
    isin: Option<String>,
    amount: Option<String>,
    shares: Option<String>,
    order_type: Option<String>,
    limit_price: Option<String>,
    stop_price: Option<String>,
    venue: Option<String>,
    portfolio_id: Option<String>,
    accept_unsuitable: Option<bool>,
) -> Result<Value, String> {
    let mut args = vec!["broker", "trade", &side];
    if let Some(i) = &isin {
        args.push("--isin");
        args.push(i);
    }
    if let Some(a) = &amount {
        args.push("--amount");
        args.push(a);
    }
    if let Some(s) = &shares {
        args.push("--shares");
        args.push(s);
    }
    if let Some(ot) = &order_type {
        args.push("--order-type");
        args.push(ot);
    }
    if let Some(lp) = &limit_price {
        args.push("--limit-price");
        args.push(lp);
    }
    if let Some(sp) = &stop_price {
        args.push("--stop-price");
        args.push(sp);
    }
    if let Some(v) = &venue {
        args.push("--venue");
        args.push(v);
    }
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    args.push("--confirm");
    args.push(&confirmation_id);
    if accept_unsuitable.unwrap_or(false) {
        args.push("--accept-unsuitable");
    }
    run_sc_command(&args).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn trade_cancel(
    order_id: String,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    let mut args = vec!["broker", "trade", "cancel", "--order-id", &order_id];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).map_err(|e| e.to_string())
}

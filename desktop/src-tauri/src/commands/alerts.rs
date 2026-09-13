use crate::sc::run_sc_command;
use crate::validate;
use serde_json::Value;

#[tauri::command]
pub async fn get_price_alerts(
    portfolio_id: Option<String>,
    active_only: Option<bool>,
) -> Result<Value, String> {
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "price-alerts"];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    if active_only.unwrap_or(false) {
        args.push("--active-only");
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_price_alert(
    isin: Option<String>,
    ticker: Option<String>,
    price: String,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    validate::opt(&isin, validate::isin)?;
    validate::opt(&ticker, |v| validate::code(v, "ticker"))?;
    validate::decimal(&price, "price")?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "price-alerts", "add", "--price", &price];
    if let Some(i) = &isin {
        args.push("--isin");
        args.push(i);
    }
    if let Some(t) = &ticker {
        args.push("--ticker");
        args.push(t);
    }
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_price_alert(
    alert_id: String,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    validate::ident(&alert_id, "alert id")?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "price-alerts", "remove", "--alert-id", &alert_id];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

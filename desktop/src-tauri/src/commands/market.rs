use crate::sc::run_sc_command;
use serde_json::Value;

#[tauri::command]
pub async fn get_quote(isin: String, portfolio_id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["broker", "quote", "--isin", &isin];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_chart(isin: String, timeframe: String) -> Result<Value, String> {
    let args = vec!["broker", "chart", "--isin", &isin, "--timeframe", &timeframe];
    run_sc_command(&args).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_security_news(isin: String, locale: Option<String>) -> Result<Value, String> {
    let mut args = vec!["broker", "security-news", "--isin", &isin];
    if let Some(l) = &locale {
        args.push("--locale");
        args.push(l);
    }
    run_sc_command(&args).map_err(|e| e.to_string())
}

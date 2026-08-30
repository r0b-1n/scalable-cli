use crate::sc::run_sc_command;
use serde_json::Value;

#[tauri::command]
pub async fn get_watchlist(portfolio_id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["broker", "watchlist"];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_to_watchlist(isin: String, portfolio_id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["broker", "watchlist", "add", "--isin", &isin];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_from_watchlist(
    isin: String,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    let mut args = vec!["broker", "watchlist", "remove", "--isin", &isin];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).map_err(|e| e.to_string())
}

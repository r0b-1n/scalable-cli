use crate::sc::run_sc_command;
use crate::validate;
use serde_json::Value;

#[tauri::command]
pub async fn get_broker_context() -> Result<Value, String> {
    run_sc_command(&["broker", "context", "show"])
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_broker_portfolios() -> Result<Value, String> {
    run_sc_command(&["broker", "context", "list"])
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn select_broker_context(portfolio_id: String) -> Result<Value, String> {
    validate::ident(&portfolio_id, "portfolio id")?;

    run_sc_command(&["broker", "context", "select", "--portfolio-id", &portfolio_id])
        .await
        .map_err(|e| e.to_string())
}

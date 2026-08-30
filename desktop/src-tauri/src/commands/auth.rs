use crate::sc::run_sc_command;
use serde_json::{json, Value};

#[tauri::command]
pub async fn login() -> Result<Value, String> {
    run_sc_command(&["login"]).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn logout() -> Result<Value, String> {
    run_sc_command(&["logout"]).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_whoami() -> Result<Value, String> {
    run_sc_command(&["whoami"]).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_capabilities() -> Result<Value, String> {
    run_sc_command(&["capabilities"]).map_err(|e| e.to_string())
}

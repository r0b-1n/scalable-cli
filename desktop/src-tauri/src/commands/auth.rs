use crate::sc::{run_sc_command, run_sc_command_plain};
use serde_json::Value;

#[tauri::command]
pub async fn login() -> Result<Value, String> {
    // `sc login` has no --json mode: it runs the interactive device-code
    // flow and reports success via its exit status.
    run_sc_command_plain(&["login"])
        .await
        .map(|_| Value::Null)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn logout() -> Result<Value, String> {
    run_sc_command(&["logout"]).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_whoami() -> Result<Value, String> {
    run_sc_command(&["whoami"]).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_capabilities() -> Result<Value, String> {
    run_sc_command(&["capabilities"]).await.map_err(|e| e.to_string())
}

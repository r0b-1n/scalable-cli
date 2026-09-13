use crate::sc::{run_sc_command, run_sc_command_plain};
use serde_json::Value;

#[tauri::command]
pub async fn login(local_read_only: Option<bool>) -> Result<Value, String> {
    // `sc login` has no --json mode: it runs the interactive device-code
    // flow and reports success via its exit status.
    //
    // `--local-read-only` stores the session in a locally enforced read-only
    // mode. It does not change token permissions or backend access; it blocks
    // write commands in this CLI until the user logs in again without it.
    let mut args = vec!["login"];
    if local_read_only.unwrap_or(false) {
        args.push("--local-read-only");
    }
    run_sc_command_plain(&args)
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

use crate::sc::run_sc_command;
use crate::validate;
use serde_json::Value;
use std::path::{Path, PathBuf};
use crate::trade_controls_toml::apply_trade_controls;

/// The CLI's config.toml. Its directory is taken from the CLI itself —
/// `broker context show` reports a file inside it — so the app never
/// re-implements the per-platform / `SC_CONFIG_DIR` resolution.
async fn config_file() -> Result<PathBuf, String> {
    let ctx = run_sc_command(&["broker", "context", "show"])
        .await
        .map_err(|e| e.to_string())?;
    let context_file = ctx
        .get("context_file")
        .and_then(Value::as_str)
        .ok_or("CLI did not report its config directory")?;
    let dir = Path::new(context_file)
        .parent()
        .ok_or("CLI reported a context file without a directory")?;
    Ok(dir.join("config.toml"))
}

fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(&tmp, contents).map_err(|e| format!("Failed writing {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("Failed replacing {}: {e}", path.display()))
}

/// Writes the local trade controls, then lets the CLI validate the file
/// (`sc capabilities` refuses to run on an invalid config). If the CLI
/// rejects it, the previous file is restored. Returns the fresh capabilities.
#[tauri::command]
pub async fn set_trade_controls(
    allowed_isins: Option<Vec<String>>,
    denied_isins: Option<Vec<String>>,
    max_order_notional: Option<String>,
) -> Result<Value, String> {
    // Not `opt_each`: its 32-item cap is for argv filters, not config lists.
    for isin in allowed_isins.iter().chain(denied_isins.iter()).flatten() {
        validate::isin(isin)?;
    }
    validate::opt(&max_order_notional, |v| validate::decimal(v, "max order notional"))?;

    let path = config_file().await?;
    let previous = match std::fs::read_to_string(&path) {
        Ok(raw) => Some(raw),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Failed reading {}: {e}", path.display())),
    };
    let updated = apply_trade_controls(
        previous.as_deref().unwrap_or(""),
        &allowed_isins,
        &denied_isins,
        &max_order_notional,
    )?;
    write_atomic(&path, &updated)?;

    match run_sc_command(&["capabilities"]).await {
        Ok(capabilities) => Ok(capabilities),
        Err(err) => {
            let restored = match &previous {
                Some(raw) => write_atomic(&path, raw),
                None => std::fs::remove_file(&path).map_err(|e| e.to_string()),
            };
            Err(match restored {
                Ok(()) => format!("The CLI rejected the new trade controls; config.toml was restored.\n{err}"),
                Err(restore_err) => format!(
                    "The CLI rejected the new trade controls and restoring config.toml failed ({restore_err}).\n{err}"
                ),
            })
        }
    }
}

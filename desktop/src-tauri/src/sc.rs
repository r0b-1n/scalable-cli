use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct MachineEnvelope {
    pub ok: bool,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<MachineError>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hints: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MachineError {
    pub code: String,
    pub message: String,
}

/// Locate the `sc` CLI. Release builds only accept the binary that ships
/// next to the app executable — never the working directory or PATH, so a
/// planted binary in an attacker-writable CWD can not receive the broker
/// session. Dev builds additionally probe cargo target dirs and PATH.
fn find_sc_binary() -> anyhow::Result<PathBuf> {
    let name = if cfg!(windows) { "sc.exe" } else { "sc" };

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    #[cfg(debug_assertions)]
    {
        for dir in ["target/release", "../target/release", "../../target/release"] {
            let candidate = PathBuf::from(dir).join(name);
            if candidate.is_file() {
                if let Ok(absolute) = candidate.canonicalize() {
                    return Ok(absolute);
                }
            }
        }
        // Dev convenience only: bare name resolves via PATH lookup.
        return Ok(PathBuf::from(name));
    }

    #[allow(unreachable_code)]
    Err(anyhow::anyhow!(
        "The sc CLI was not found next to the application. Reinstall the app."
    ))
}

/// Cap process output that ends up in user-visible error messages so raw
/// CLI internals are not dumped wholesale into the UI.
fn truncate_output(raw: &str, max: usize) -> String {
    let trimmed = raw.trim();
    if trimmed.chars().count() <= max {
        trimmed.to_string()
    } else {
        let cut: String = trimmed.chars().take(max).collect();
        format!("{cut}…")
    }
}

pub async fn run_sc_command(args: &[&str]) -> anyhow::Result<Value> {
    let owned: Vec<String> = args.iter().map(ToString::to_string).collect();
    tauri::async_runtime::spawn_blocking(move || run_sc_command_blocking(&owned))
        .await
        .map_err(|e| anyhow::anyhow!("Failed to run sc: {e}"))?
}

fn run_sc_command_blocking(args: &[String]) -> anyhow::Result<Value> {
    let binary = find_sc_binary()?;
    let mut cmd_args: Vec<&str> = args.iter().map(String::as_str).collect();
    cmd_args.push("--json");

    let output = Command::new(&binary)
        .args(&cmd_args)
        .output()
        .map_err(|e| anyhow::anyhow!("Failed to run {}: {}", binary.display(), e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        // Failed sc commands still print a machine envelope on stdout —
        // surface its curated message instead of the raw JSON blob.
        if let Ok(envelope) = serde_json::from_str::<MachineEnvelope>(stdout.trim()) {
            if let Some(error) = envelope.error {
                let mut msg = truncate_output(&error.message, 500);
                if !envelope.hints.is_empty() {
                    msg.push_str(&format!("\nHints: {}", envelope.hints.join(", ")));
                }
                anyhow::bail!(msg);
            }
        }
        let msg = if !stdout.trim().is_empty() {
            truncate_output(&stdout, 500)
        } else if !stderr.trim().is_empty() {
            truncate_output(&stderr, 500)
        } else {
            format!("Process exited with code {:?}", output.status.code())
        };
        anyhow::bail!(msg);
    }

    let stdout = String::from_utf8(output.stdout)?;
    let envelope: MachineEnvelope = serde_json::from_str(&stdout).map_err(|e| {
        anyhow::anyhow!(
            "Unexpected CLI output ({}): {}",
            e,
            truncate_output(&stdout, 200)
        )
    })?;

    if !envelope.ok {
        // Envelope errors are the CLI's curated messages (with hints) and
        // are meant for display.
        let err_msg = envelope
            .error
            .map(|e| e.message)
            .unwrap_or_else(|| "Unknown error".to_string());
        let hints = envelope.hints;
        let mut full_msg = truncate_output(&err_msg, 500);
        if !hints.is_empty() {
            full_msg.push_str(&format!("\nHints: {}", hints.join(", ")));
        }
        anyhow::bail!(full_msg);
    }

    Ok(envelope.data.unwrap_or(Value::Null))
}

/// Run an sc command that has no --json mode (currently only `login`).
/// Success is the exit status; stdout/stderr become the error message.
pub async fn run_sc_command_plain(args: &[&str]) -> anyhow::Result<()> {
    let owned: Vec<String> = args.iter().map(ToString::to_string).collect();
    tauri::async_runtime::spawn_blocking(move || run_sc_command_plain_blocking(&owned))
        .await
        .map_err(|e| anyhow::anyhow!("Failed to run sc: {e}"))?
}

fn run_sc_command_plain_blocking(args: &[String]) -> anyhow::Result<()> {
    let binary = find_sc_binary()?;
    let output = Command::new(&binary)
        .args(args)
        .output()
        .map_err(|e| anyhow::anyhow!("Failed to run {}: {}", binary.display(), e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let msg = if !stdout.trim().is_empty() {
            truncate_output(&stdout, 500)
        } else if !stderr.trim().is_empty() {
            truncate_output(&stderr, 500)
        } else {
            format!("Process exited with code {:?}", output.status.code())
        };
        anyhow::bail!(msg);
    }
    Ok(())
}

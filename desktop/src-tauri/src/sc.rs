use serde::{Deserialize, Serialize};
use serde_json::Value;
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

fn find_sc_binary() -> String {
    let candidates = if cfg!(windows) {
        vec![
            "sc.exe",
            "target\\release\\sc.exe",
            "..\\target\\release\\sc.exe",
            "..\\..\\target\\release\\sc.exe",
        ]
    } else {
        vec![
            "sc",
            "target/release/sc",
            "../target/release/sc",
            "../../target/release/sc",
        ]
    };
    for candidate in &candidates {
        if std::path::Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }
    if cfg!(windows) {
        "sc.exe".to_string()
    } else {
        "sc".to_string()
    }
}

pub fn run_sc_command(args: &[&str]) -> anyhow::Result<Value> {
    let binary = find_sc_binary();
    let mut cmd_args: Vec<&str> = args.to_vec();
    cmd_args.push("--json");

    let output = Command::new(&binary)
        .args(&cmd_args)
        .output()
        .map_err(|e| anyhow::anyhow!("Failed to run {}: {}", binary, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let msg = if !stdout.is_empty() {
            stdout.to_string()
        } else if !stderr.is_empty() {
            stderr.to_string()
        } else {
            format!("Process exited with code {:?}", output.status.code())
        };
        anyhow::bail!(msg);
    }

    let stdout = String::from_utf8(output.stdout)?;
    let envelope: MachineEnvelope = serde_json::from_str(&stdout)
        .map_err(|e| anyhow::anyhow!("Failed to parse JSON: {}\nRaw: {}", e, stdout))?;

    if !envelope.ok {
        let err_msg = envelope
            .error
            .map(|e| e.message)
            .unwrap_or_else(|| "Unknown error".to_string());
        let hints = envelope.hints;
        let mut full_msg = err_msg;
        if !hints.is_empty() {
            full_msg.push_str(&format!("\nHints: {}", hints.join(", ")));
        }
        anyhow::bail!(full_msg);
    }

    Ok(envelope.data.unwrap_or(Value::Null))
}

pub fn run_sc_command_raw(args: &[&str]) -> anyhow::Result<String> {
    let binary = find_sc_binary();
    let mut cmd_args: Vec<&str> = args.to_vec();
    cmd_args.push("--json");

    let output = Command::new(&binary)
        .args(&cmd_args)
        .output()
        .map_err(|e| anyhow::anyhow!("Failed to run {}: {}", binary, e))?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

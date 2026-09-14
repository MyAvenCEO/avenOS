//! Desktop prototype adapter. The reviewed Python connector is embedded in the binary.
//! Credentials travel only over child stdin; no shell, script file, or credential file.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::Manager;

use crate::auth::{api_endpoint, session_identity, session_token, AuthState};

const CONNECTOR: &str = include_str!("../../../prototypes/imap-pdf/imap_pdf.py");
static RUNNING: AtomicBool = AtomicBool::new(false);

fn account_scope(user_id: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{}:{user_id}", api_endpoint("")).as_bytes())
    )
}

pub(crate) fn session_for_scope(
    state: &tauri::State<'_, AuthState>,
    scope: Option<&str>,
) -> Result<String, String> {
    let (session, user_id) = session_identity(state)?;
    if scope.is_some_and(|expected| expected != account_scope(&user_id)) {
        return Err("Your Aven account changed. Scan your mailbox again before importing.".into());
    }
    Ok(session)
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmailRequest {
    operation: String,
    host: String,
    port: u16,
    user: String,
    password: String,
    mailbox: String,
    since: Option<String>,
    before: Option<String>,
    max_messages: u32,
    snapshot_id: Option<String>,
    cursor: Option<u32>,
    expected_scope: Option<String>,
}

struct Running;
impl Drop for Running {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::Release);
    }
}

fn validate(request: &EmailRequest) -> Result<(), String> {
    if !matches!(
        request.operation.as_str(),
        "list" | "scan" | "demo" | "start" | "batch"
    ) || request.port == 0
        || !(1..=100).contains(&request.max_messages)
        || request.host.len() > 253
        || request.user.len() > 320
        || request.password.len() > 4096
        || request.mailbox.len() > 1024
        || request.since.as_ref().is_some_and(|v| v.len() != 10)
        || request.before.as_ref().is_some_and(|v| v.len() != 10)
        || [&request.host, &request.user, &request.mailbox]
            .iter()
            .any(|v| v.chars().any(char::is_control))
    {
        return Err("The email connection settings are invalid.".into());
    }
    if request.operation != "demo"
        && (request.host.is_empty() || request.user.is_empty() || request.password.is_empty())
    {
        return Err("Enter the IMAP hostname, login and password.".into());
    }
    Ok(())
}

fn execute(request: EmailRequest, output: &Path) -> Result<serde_json::Value, String> {
    validate(&request)?;
    let input = serde_json::to_vec(&request).map_err(|_| "Invalid email request.")?;
    let mut child = Command::new("python3")
        .args(["-I", "-c", CONNECTOR, "--tauri"])
        .arg(output)
        .env_remove("IMAP_PASSWORD")
        .env_remove("IMAP_ACCESS_TOKEN")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| {
            "The email prototype needs Python 3.11 or newer installed on this desktop.".to_string()
        })?;
    let stdin = child.stdin.take().ok_or("Email input is unavailable.")?;
    let stdout = child.stdout.take().ok_or("Email output is unavailable.")?;
    // Drain stdout while the process runs so larger result sets cannot block its exit.
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    if {
        let mut stdin = stdin;
        stdin.write_all(&input)
    }
    .is_err()
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Could not start the email import.".into());
    }
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() < Duration::from_secs(300) => {
                std::thread::sleep(Duration::from_millis(100));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Email scan stopped after five minutes. Retry to continue from the current message.".into());
            }
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| "Email output was interrupted.")?
        .map_err(|_| "Could not read email output.")?;
    if !status.success() || bytes.len() > 4 * 1024 * 1024 {
        return Err(
            "The email prototype could not complete. Check that Python 3.11 or newer is installed."
                .into(),
        );
    }
    let result: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| "The email prototype returned an invalid result.")?;
    if result["ok"] != true {
        return Err(result["error"]
            .as_str()
            .unwrap_or("Email import failed.")
            .to_string());
    }
    Ok(result["result"].clone())
}

#[tauri::command]
pub fn imap_account_scope(state: tauri::State<'_, AuthState>) -> Result<String, String> {
    let (_, user_id) = session_identity(&state)?;
    Ok(account_scope(&user_id))
}

#[tauri::command]
pub async fn imap_scan(
    request: EmailRequest,
    app: tauri::AppHandle,
    state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return Err("Email import is available in the Linux and macOS desktop prototype.".into());
    }
    let (session, user_id) = session_identity(&state)?;
    // Stable per-account and deployment cache; credentials are never an identity key.
    let scope = account_scope(&user_id);
    if request
        .expected_scope
        .as_ref()
        .is_some_and(|expected| expected != &scope)
    {
        return Err("Your Aven account changed. Start a new mailbox import.".into());
    }
    let output = app
        .path()
        .app_cache_dir()
        .map_err(|_| "Email cache is unavailable.")?
        .join("imap-prototype")
        .join(&scope);
    if RUNNING.swap(true, Ordering::AcqRel) {
        return Err("An email scan is already running. Wait for it to finish.".into());
    }
    let running = Running;
    let mut result = tauri::async_runtime::spawn_blocking(move || {
        let _running = running;
        execute(request, &output)
    })
    .await
    .map_err(|_| "Email scan was interrupted.")??;
    if session_token(&state)? != session {
        return Err("Your Aven session changed. Connect to the mailbox again.".into());
    }
    result["scope"] = scope.into();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> EmailRequest {
        EmailRequest {
            operation: "demo".into(),
            host: String::new(),
            port: 993,
            user: String::new(),
            password: String::new(),
            mailbox: "INBOX".into(),
            since: None,
            before: None,
            max_messages: 20,
            snapshot_id: None,
            cursor: None,
            expected_scope: None,
        }
    }

    #[test]
    fn admits_only_bounded_fixed_operations() {
        assert!(validate(&request()).is_ok());
        let mut value = request();
        value.operation = "shell".into();
        assert!(validate(&value).is_err());
        value.operation = "scan".into();
        assert!(validate(&value).is_err());
        value.host = "localhost\r\nLOGOUT".into();
        assert!(validate(&value).is_err());
    }

    #[test]
    fn embedded_connector_returns_demo_attachments() {
        let path = std::env::temp_dir().join(format!("aven-imap-rust-test-{}", std::process::id()));
        let value = execute(request(), &path).unwrap();
        assert_eq!(value["attachments"].as_array().unwrap().len(), 2);
        assert!(value["issues"].as_array().unwrap().is_empty());
        std::fs::remove_dir_all(path).unwrap();
    }
}

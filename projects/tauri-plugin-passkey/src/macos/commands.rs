#![cfg(target_os = "macos")]

use tauri::Window;
use crate::macos::{PasskeyRegistrationResult, PasskeyLoginResult, begin_registration_from_rust, begin_login_from_rust};

#[tauri::command]
pub async fn register_passkey(
    domain: String,
    challenge: Vec<u8>,
    username: String,
    user_id: Vec<u8>,
    salt: Vec<u8>,
    window: Window
) -> Result<PasskeyRegistrationResult, String> {
    let window_raw = window.ns_window().map_err(|_| "Missing ns_window")? as usize;
    begin_registration_from_rust(window_raw, &domain, &challenge, &username, &user_id, &salt).await
}

#[tauri::command]
pub async fn login_passkey(
    domain: String,
    challenge: Vec<u8>,
    salt: Vec<u8>,
    window: Window
) -> Result<PasskeyLoginResult, String> {
    let window_raw = window.ns_window().map_err(|_| "Missing ns_window")? as usize;
    begin_login_from_rust(window_raw, &domain, &challenge, &salt).await
}

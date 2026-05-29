#[cfg(target_os = "macos")]
mod macos;

/// Plugin entrypoint
#[cfg(target_os = "macos")]
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri::{generate_handler, plugin::Builder};
    use crate::macos::commands::{register_passkey, login_passkey};

    Builder::new("tauri-plugin-passkey")
        .invoke_handler(generate_handler![
            register_passkey,
            login_passkey
        ])
        .build()
}

// On non‑macOS: no-op
#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub fn init() {
    eprintln!("tauri-plugin-passkey: not supported on non-macOS");
}

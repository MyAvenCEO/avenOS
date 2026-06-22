use std::fs;
use tauri::{AppHandle, Manager};

// Device signer key for the secrets vault (board 0055). A random per-device seed, stored as a
// PLAIN file in the app data dir (non-Apple, like a `.env` — openly readable on disk). The
// client generates the seed (crypto.getRandomValues) and HKDFs it into the vault KEK, so the
// secret is genuinely server-blind (the key never leaves this machine, isn't in source or Neon)
// — but it is NOT protected against local disk access, by design. The passkey path is stronger;
// this is the fallback used in unsigned/local builds and for users without a passkey.
const SEED_FILE: &str = "vault-device-seed";

fn seed_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
	Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join(SEED_FILE))
}

/// Return the stored device seed (base64 text), or None if it hasn't been created yet.
#[tauri::command]
pub fn device_seed_load(app: AppHandle) -> Result<Option<String>, String> {
	match fs::read_to_string(seed_path(&app)?) {
		Ok(s) => Ok(Some(s.trim().to_string())),
		Err(_) => Ok(None),
	}
}

/// Persist the device seed (base64 text). Written once by the client on first vault use.
#[tauri::command]
pub fn device_seed_save(app: AppHandle, seed: String) -> Result<(), String> {
	let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
	fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
	fs::write(dir.join(SEED_FILE), seed).map_err(|e| e.to_string())?;
	Ok(())
}

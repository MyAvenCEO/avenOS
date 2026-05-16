//! `tauri-plugin-self` — hardware-rooted device identity, plus all keys derived from it.
//!
//! Conceptually:
//!     PEER_ID_<device>            P-256 keypair, private in Secure Enclave (macOS).
//!     device_root_secret          32 bytes, HKDF(ECDH(SE_priv, GENESIS_NETWORK_ID)). RAM only.
//!     PEER_ID_<device>_ED25519    HKDF-expanded from root_secret. Used for `sign` / `verify` /
//!                                 future Jazz agent + peeroxide Noise XX static key.
//!
//! There is no separate "identity" plugin: everything visible from JS is a self primitive.

pub mod commands;
pub mod derive;
pub mod state;

#[cfg(target_os = "macos")]
mod macos;

use state::SelfState;

#[cfg(target_os = "macos")]
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
	use tauri::{generate_handler, plugin::Builder};

	Builder::new("self")
		.setup(|app, _| {
			use tauri::Manager;
			app.manage(SelfState::default());
			Ok(())
		})
		.invoke_handler(generate_handler![
			macos::commands::register,
			macos::commands::public_key,
			macos::commands::unlock,
			macos::commands::peer_status,
			commands::signing_public_key,
			commands::sign,
			commands::verify,
			commands::lock,
		])
		.build()
}

#[cfg(not(target_os = "macos"))]
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PeerStatusStub {
	platform_supported: bool,
	registered: bool,
	unlocked: bool,
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn register(_slot: String) -> Result<(), String> {
	Err("tauri-plugin-self: macOS only in v1".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn public_key(_slot: String) -> Result<Vec<u8>, String> {
	Err("tauri-plugin-self: macOS only in v1".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn unlock(_slot: String, _genesis_network_id: Vec<u8>) -> Result<(), String> {
	Err("tauri-plugin-self: macOS only in v1".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn peer_status(
	_app: tauri::AppHandle,
	_slot: String,
	state: tauri::State<'_, SelfState>,
) -> Result<PeerStatusStub, String> {
	Ok(PeerStatusStub {
		platform_supported: false,
		registered: false,
		unlocked: state.is_unlocked(),
	})
}

#[cfg(not(target_os = "macos"))]
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
	use tauri::{generate_handler, plugin::Builder};

	Builder::new("self")
		.setup(|app, _| {
			use tauri::Manager;
			app.manage(SelfState::default());
			Ok(())
		})
		.invoke_handler(generate_handler![
			register,
			public_key,
			unlock,
			peer_status,
			commands::signing_public_key,
			commands::sign,
			commands::verify,
			commands::lock,
		])
		.build()
}

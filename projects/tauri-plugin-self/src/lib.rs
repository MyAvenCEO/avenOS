//! `tauri-plugin-self` — hardware-rooted device identity, plus all keys derived from it.
//!
//! Conceptually:
//!     PEER_ID_<device>            P-256 keypair, private in Secure Enclave (macOS).
//!     device_root_secret          32 bytes, HKDF(ECDH(SE_priv, GENESIS_NETWORK_ID)). RAM only.
//!     PEER_ID_<device>_ED25519    HKDF-expanded from root secret. Used for `sign` / `verify` /
//!                                 future Jazz agent + peeroxide Noise XX static key.
//!
//! There is no separate "identity" plugin: everything visible from JS is a self primitive.
//!
//! **Linux / Windows debug builds** use [`dev_insecure`] (plain `peer-id-{slot}.dev-root-secret` on disk).

pub mod commands;
pub mod derive;
pub mod did;
pub mod paths;
pub mod state;
pub mod unlock;
pub mod vault;
mod vault_commands;

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
mod dev_insecure;

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod macos;

use vault::ActiveVault;

use state::SelfState;

#[cfg(any(target_os = "macos", target_os = "ios"))]
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
	use tauri::{generate_handler, plugin::Builder};

	Builder::new("self")
		.setup(|app, _| {
			use tauri::Manager;
			app.manage(SelfState::default());
			app.manage(ActiveVault::default());
			Ok(())
		})
		.invoke_handler(generate_handler![
			macos::commands::register,
			macos::commands::public_key,
			macos::commands::unlock,
			macos::commands::peer_status,
			commands::device_peer_did,
			commands::signing_peer_did,
			commands::signing_public_key,
			commands::sign,
			commands::verify,
			commands::lock,
			commands::host_device_label,
			vault_commands::vault_list,
			vault_commands::vault_slug_preview,
			vault_commands::vault_select,
			vault_commands::vault_create,
			vault_commands::vault_selected_slug,
			vault_commands::active_identity,
		])
		.build()
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
	use tauri::{generate_handler, plugin::Builder};

	Builder::new("self")
		.setup(|app, _| {
			use tauri::Manager;
			dev_insecure::log_startup_banner();
			app.manage(SelfState::default());
			app.manage(ActiveVault::default());
			Ok(())
		})
		.invoke_handler(generate_handler![
			dev_insecure::register,
			dev_insecure::public_key,
			dev_insecure::unlock,
			dev_insecure::peer_status,
			commands::device_peer_did,
			commands::signing_peer_did,
			commands::signing_public_key,
			commands::sign,
			commands::verify,
			commands::lock,
			commands::host_device_label,
			vault_commands::vault_list,
			vault_commands::vault_slug_preview,
			vault_commands::vault_select,
			vault_commands::vault_create,
			vault_commands::vault_selected_slug,
			vault_commands::active_identity,
		])
		.build()
}

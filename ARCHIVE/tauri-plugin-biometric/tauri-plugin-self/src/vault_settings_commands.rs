//! Tauri commands for `vault_settings.json`.

use tauri::{AppHandle, State};

use crate::paths;
use crate::vault::ActiveVault;
use crate::vault_settings::{self, VaultP2pPrefs};

/// Always blind-relay — reload vault prefs and force relay-only on the live swarm flag.
pub fn reload_vault_p2p_prefs(
	_app: &AppHandle,
	_vault: &ActiveVault,
	prefs: &VaultP2pPrefs,
) -> Result<(), String> {
	prefs.set_prefer_relay_only(true);
	Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultUiSettingsReply {
	pub locale: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn vault_ui_settings_get(
	app: AppHandle,
	vault: State<'_, ActiveVault>,
) -> Result<VaultUiSettingsReply, String> {
	if paths::expand_override().is_some() {
		return Ok(VaultUiSettingsReply {
			locale: vault_settings::DEFAULT_UI_LOCALE.into(),
		});
	}
	let root = paths::aven_os_user_root(&app, &vault)?;
	let settings = vault_settings::read_merged(&root)?;
	Ok(VaultUiSettingsReply {
		locale: settings.ui.locale,
	})
}

#[tauri::command(rename_all = "camelCase")]
pub async fn vault_ui_settings_set_locale(
	app: AppHandle,
	vault: State<'_, ActiveVault>,
	locale: String,
) -> Result<(), String> {
	if paths::expand_override().is_some() {
		return Ok(());
	}
	let root = paths::aven_os_user_root(&app, &vault)?;
	vault_settings::write_ui_locale(&root, &locale)?;
	Ok(())
}

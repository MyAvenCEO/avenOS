//! Per-vault settings in `<identity>/secrets/settings.json` (device-local, not avenDB-synced).

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

/// Default: relay-only paths (stable cross-network sync while LAN heuristics mature).
pub const DEFAULT_PREFER_RELAY_ONLY: bool = true;

pub const DEFAULT_UI_LOCALE: &str = "en";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VaultSettings {
	pub p2p: VaultP2pSettings,
	pub ui: VaultUiSettings,
}

impl Default for VaultSettings {
	fn default() -> Self {
		Self {
			p2p: VaultP2pSettings::default(),
			ui: VaultUiSettings::default(),
		}
	}
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VaultUiSettings {
	/// UI locale: `"en"` or `"de"`.
	pub locale: String,
}

impl Default for VaultUiSettings {
	fn default() -> Self {
		Self {
			locale: DEFAULT_UI_LOCALE.into(),
		}
	}
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VaultP2pSettings {
	/// When true, pairing and sync use blind-relay only (no LAN/direct/holepunch upgrades).
	pub prefer_relay_only: bool,
}

impl Default for VaultP2pSettings {
	fn default() -> Self {
		Self {
			prefer_relay_only: DEFAULT_PREFER_RELAY_ONLY,
		}
	}
}

/// Normalize locale to supported values; unknown → `"en"`.
pub fn normalize_ui_locale(raw: &str) -> String {
	match raw.trim().to_lowercase().as_str() {
		"de" => "de".into(),
		_ => DEFAULT_UI_LOCALE.into(),
	}
}

/// In-memory mirror of the active vault's settings (legacy P2P prefs removed).
#[derive(Clone)]
pub struct VaultP2pPrefs(Arc<AtomicBool>);

impl VaultP2pPrefs {
	pub fn new() -> Self {
		Self(Arc::new(AtomicBool::new(DEFAULT_PREFER_RELAY_ONLY)))
	}

	#[must_use]
	pub fn prefer_relay_only(&self) -> bool {
		self.0.load(Ordering::Relaxed)
	}

	pub fn set_prefer_relay_only(&self, on: bool) {
		self.0.store(on, Ordering::Release);
	}

	/// Shared flag for aven-p2p (HyperDHT blind-relay-only connect path).
	pub fn relay_only_flag(&self) -> Arc<AtomicBool> {
		Arc::clone(&self.0)
	}
}

pub fn settings_path(vault_root: &Path) -> std::path::PathBuf {
	crate::paths::settings_path(vault_root)
}

pub fn read_merged(vault_root: &Path) -> Result<VaultSettings, String> {
	let path = settings_path(vault_root);
	if !path.is_file() {
		return Ok(VaultSettings::default());
	}
	let raw =
		fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
	let mut settings: VaultSettings = serde_json::from_str(&raw)
		.map_err(|e| format!("vault_settings parse {}: {e}", path.display()))?;
	if serde_json::from_str::<serde_json::Value>(&raw)
		.ok()
		.and_then(|v| v.get("p2p").cloned())
		.is_none()
	{
		settings.p2p = VaultP2pSettings::default();
	}
	settings.ui.locale = normalize_ui_locale(&settings.ui.locale);
	settings.p2p.prefer_relay_only = true;
	Ok(settings)
}

pub fn write_atomic(vault_root: &Path, settings: &VaultSettings) -> Result<(), String> {
	let crypto_dir = crate::paths::identity_crypto_dir(vault_root);
	fs::create_dir_all(&crypto_dir)
		.map_err(|e| format!("mkdir {}: {e}", crypto_dir.display()))?;
	let path = settings_path(vault_root);
	let tmp = path.with_extension("json.tmp");
	let json = serde_json::to_string_pretty(settings)
		.map_err(|e| format!("vault_settings serialize: {e}"))?;
	fs::write(&tmp, json.as_bytes()).map_err(|e| format!("write {}: {e}", tmp.display()))?;
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))
			.map_err(|e| format!("chmod {}: {e}", tmp.display()))?;
	}
	fs::rename(&tmp, &path).map_err(|e| format!("rename {}: {e}", path.display()))?;
	Ok(())
}

pub fn write_ui_locale(vault_root: &Path, locale: &str) -> Result<(), String> {
	let mut settings = read_merged(vault_root)?;
	settings.ui.locale = normalize_ui_locale(locale);
	write_atomic(vault_root, &settings)
}

pub fn ensure_default_file(vault_root: &Path) -> Result<(), String> {
	let path = settings_path(vault_root);
	if path.is_file() {
		return Ok(());
	}
	write_atomic(vault_root, &VaultSettings::default())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn default_prefers_relay_only() {
		let s = VaultSettings::default();
		assert!(s.p2p.prefer_relay_only);
	}

	#[test]
	fn normalize_ui_locale_maps_to_supported() {
		assert_eq!(normalize_ui_locale("de"), "de");
		assert_eq!(normalize_ui_locale("DE"), "de");
		assert_eq!(normalize_ui_locale("fr"), "en");
		assert_eq!(normalize_ui_locale(""), "en");
	}
}

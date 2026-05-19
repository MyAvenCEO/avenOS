//! Human-scoped vault selection — `vaults/<slug>/` under the AvenOS app base.
//!
//! Process memory only (cleared with [`crate::commands::lock`]); pick/create flows set it before
//! `register` / `unlock`.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Runtime};

use crate::paths;

#[derive(Default)]
pub struct ActiveVault(pub Mutex<Option<String>>);

impl ActiveVault {
	pub fn selected_slug(&self) -> Result<Option<String>, String> {
		self.0
			.lock()
			.map(|g| g.clone())
			.map_err(|_| "active_vault_poisoned".into())
	}

	pub fn clear(&self) -> Result<(), String> {
		let mut g = self.0.lock().map_err(|_| "active_vault_poisoned")?;
		*g = None;
		Ok(())
	}

	pub fn select(&self, slug: impl Into<String>) -> Result<(), String> {
		let s = slug.into();
		paths::validate_username_slug(&s)?;
		let mut g = self.0.lock().map_err(|_| "active_vault_poisoned")?;
		*g = Some(s);
		Ok(())
	}

	pub fn require_slug(&self) -> Result<String, String> {
		self.selected_slug()?.ok_or_else(|| {
			"no_active_vault: pick or create an identity vault first".to_string()
		})
	}
}

/// On-disk profile for onboarding copy (readable before Jazz/Groove).
pub const VAULT_MANIFEST_FILENAME: &str = "vault_manifest.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultManifest {
	pub first_name: String,
	pub username_slug: String,
	pub device_label: String,
	pub created_at_ms: i64,
}

impl VaultManifest {
	pub fn pairing_display(&self) -> String {
		format!(
			"{}/{}",
			self.first_name.trim(),
			self.device_label.trim(),
		)
	}
}

pub fn pairing_label_from_manifest_path(vault_root: &std::path::Path) -> Option<String> {
	let p = vault_root.join(VAULT_MANIFEST_FILENAME);
	let raw = std::fs::read_to_string(&p).ok()?;
	let m: VaultManifest = serde_json::from_str(&raw).ok()?;
	let s = m.pairing_display();
	if s.trim().is_empty() || s.ends_with('/') {
		return None;
	}
	Some(s)
}

pub fn pairing_label_for_app<R: Runtime>(
	app: &AppHandle<R>,
	vault: &ActiveVault,
) -> Option<String> {
	crate::paths::aven_os_user_root(app, vault).ok().and_then(|p| pairing_label_from_manifest_path(&p))
}

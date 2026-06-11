//! IPC: vault discovery / selection (cross-platform filesystem).

use std::fs;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::paths::{self, OVERRIDE_VAULT_SLUG};
use crate::state::SelfState;
use crate::vault::{
	pairing_label_for_app, ActiveVault, VaultManifest,
};
use crate::vault_settings;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultListEntry {
	pub username_slug: String,
	pub first_name: Option<String>,
	pub device_label: Option<String>,
	pub signer_type: Option<String>,
	pub has_identity_blob: bool,
	pub locale: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultCreateReply {
	pub username_slug: String,
}

fn vault_locale(vault_root: &std::path::Path) -> String {
	vault_settings::read_merged(vault_root)
		.map(|s| s.ui.locale)
		.unwrap_or_else(|_| vault_settings::DEFAULT_UI_LOCALE.into())
}

fn crypto_dir_has_se_blob(dir: &std::path::Path) -> bool {
	let Ok(rd) = fs::read_dir(dir) else {
		return false;
	};
	for ent in rd.flatten() {
		let name = ent.file_name();
		let s = name.to_string_lossy();
		if s.starts_with("peer-id-") && s.ends_with(".se-blob") {
			return true;
		}
	}
	false
}

fn crypto_dir_has_identity(dir: &std::path::Path) -> bool {
	if crypto_dir_has_se_blob(dir) {
		return true;
	}
	#[cfg(not(any(target_os = "macos", target_os = "ios")))]
	{
		return crate::dev_insecure::crypto_dir_has_dev_root(dir);
	}
	#[cfg(any(target_os = "macos", target_os = "ios"))]
	false
}

/// List identity folders under `<app-base>/vaults/`, or a synthetic entry when data-dir override is set.
#[tauri::command(rename_all = "camelCase")]
pub async fn vault_list(app: AppHandle, _vault_state: State<'_, ActiveVault>) -> Result<Vec<VaultListEntry>, String> {
	if paths::expand_override().is_some() {
		let root = paths::aven_os_app_base(&app)?;
		let man = vault_root_manifest(&root);
		return Ok(vec![VaultListEntry {
			username_slug: OVERRIDE_VAULT_SLUG.into(),
			first_name: man.as_ref().map(|m| m.first_name.clone()),
			device_label: man.as_ref().map(|m| m.device_label.clone()),
			signer_type: man.as_ref().and_then(|m| m.signer_type.clone()),
			has_identity_blob: paths::vault_is_complete(&root)
				&& crypto_dir_has_identity(&paths::identity_crypto_dir(&root)),
			locale: vault_locale(&root),
		}]);
	}

	let base = paths::vaults_dir(&app)?;
	fs::create_dir_all(&base).map_err(|e| format!("create_dir_all vaults {}: {e}", base.display()))?;

	let mut out = Vec::new();
	let rd = fs::read_dir(&base).map_err(|e| format!("read_dir vaults {}: {e}", base.display()))?;

	for ent in rd.flatten() {
		let mt = ent.metadata().ok();
		let is_dir = mt.map(|m| m.is_dir()).unwrap_or(false);
		if !is_dir {
			continue;
		}
		let name = ent.file_name().to_string_lossy().into_owned();
		if paths::validate_username_slug(&name).is_err() {
			continue;
		}
		let vr = base.join(&name);
		if !paths::vault_is_complete(&vr) {
			continue;
		}
		let man = vault_root_manifest(&vr);
		out.push(VaultListEntry {
			username_slug: name,
			first_name: man.as_ref().map(|m| m.first_name.clone()),
			device_label: man.as_ref().map(|m| m.device_label.clone()),
			signer_type: man.as_ref().and_then(|m| m.signer_type.clone()),
			has_identity_blob: crypto_dir_has_identity(&paths::identity_crypto_dir(&vr)),
			locale: vault_locale(&vr),
		});
	}
	out.sort_by(|a, b| a.username_slug.cmp(&b.username_slug));
	Ok(out)
}

/// Bind the active (staging) identity folder to its cryptographic identity: rename
/// `vaults/<staging-slug>` → `vaults/<identity_folder_id(key)>` and re-point the
/// pre-unlock selection at it. Called from each platform's `register` once device key
/// material exists. Idempotent (no-op once the folder is already canonically named) and a
/// no-op under the data-dir override sandbox (single shared root, no per-identity folder).
///
/// After this runs, an identity provably owns a folder no other identity can resolve to —
/// the foundation the connect-time owner check in `jazz` relies on.
pub(crate) fn finalize_identity_folder<R: tauri::Runtime>(
	app: &AppHandle<R>,
	vault: &ActiveVault,
	key_bytes: &[u8],
) -> Result<String, String> {
	if paths::expand_override().is_some() {
		return Ok(OVERRIDE_VAULT_SLUG.into());
	}
	let id = paths::identity_folder_id(key_bytes);
	let current = vault.require_slug()?;
	if current == id {
		return Ok(id);
	}

	let vaults = paths::vaults_dir(app)?;
	let from = vaults.join(&current);
	let to = vaults.join(&id);

	if to.exists() {
		// This identity already has its canonical folder (e.g. re-register after a
		// crash left a redundant staging dir). Adopt the canonical one; drop the dup.
		if from != to && from.exists() {
			let _ = fs::remove_dir_all(&from);
		}
	} else {
		fs::rename(&from, &to).map_err(|e| {
			format!(
				"rename identity folder {} -> {}: {e}",
				from.display(),
				to.display()
			)
		})?;
	}

	// Keep the manifest's slug field consistent with the (new) folder name.
	if let Some(mut m) = vault_root_manifest(&to) {
		if m.username_slug != id {
			m.username_slug = id.clone();
			let _ = write_manifest(&to, &m);
		}
	}

	// Re-point the pre-unlock selection at the canonical folder so the subsequent
	// `unlock` resolves blob/db under it.
	vault.select(&id)?;
	Ok(id)
}

fn vault_root_manifest(vault_root: &std::path::Path) -> Option<VaultManifest> {
	let p = paths::manifest_path(vault_root);
	let raw = fs::read_to_string(&p).ok()?;
	serde_json::from_str(&raw).ok()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn vault_select(
	app: AppHandle,
	vault_state: State<'_, ActiveVault>,
	prefs: State<'_, crate::VaultP2pPrefs>,
	slug: String,
) -> Result<(), String> {
	if paths::expand_override().is_some() {
		vault_state.clear()?;
		return Ok(());
	}

	paths::validate_username_slug(&slug)?;
	let vr = paths::vaults_dir(&app)?.join(&slug);
	if !paths::vault_is_complete(&vr) {
		return Err(format!("vault_missing_or_incomplete: {}", vr.display()));
	}
	vault_state.select(slug)?;
	crate::vault_settings_commands::reload_vault_p2p_prefs(&app, &vault_state, &prefs)?;
	Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSlugPreviewPayload {
	pub first_name: String,
}

/// Next free folder slug derived from trimmed `first_name` (e.g. `alice`, `alice2`).
#[tauri::command(rename_all = "camelCase")]
pub async fn vault_slug_preview(app: AppHandle, payload: VaultSlugPreviewPayload) -> Result<String, String> {
	if paths::expand_override().is_some() {
		return Ok(OVERRIDE_VAULT_SLUG.into());
	}
	let base = paths::slugify_first_name(&payload.first_name)?;
	let vaults_base = paths::vaults_dir(&app)?;
	fs::create_dir_all(&vaults_base).map_err(|e| format!("create_dir_all: {e}"))?;
	allocate_username_slug(&vaults_base, &base)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn vault_create(
	app: AppHandle,
	vault_state: State<'_, ActiveVault>,
	first_name: String,
	device_label: String,
	signer_type: Option<String>,
) -> Result<VaultCreateReply, String> {
	let first_name = first_name.trim().to_string();
	let device_label = device_label.trim().to_string();
	let signer_type = signer_type
		.map(|s| s.trim().to_string())
		.filter(|s| !s.is_empty())
		.or_else(|| Some("apple_se".to_string()));
	if first_name.is_empty() {
		return Err("first_name_required".into());
	}
	if device_label.is_empty() {
		return Err("device_label_required".into());
	}

	if paths::expand_override().is_some() {
		let root = paths::aven_os_app_base(&app)?;
		fs::create_dir_all(paths::db_dir(&root)).map_err(|e| format!("mkdir db: {e}"))?;
		fs::create_dir_all(paths::identity_crypto_dir(&root))
			.map_err(|e| format!("mkdir vault: {e}"))?;
		crate::vault_settings::ensure_default_file(&root)?;
		let now = unix_ms_i64();
		let m = VaultManifest {
			first_name: first_name.clone(),
			username_slug: OVERRIDE_VAULT_SLUG.into(),
			device_label: device_label.clone(),
			signer_type: signer_type.clone(),
			created_at_ms: now,
		};
		write_manifest(&root, &m)?;
		vault_state.clear()?;
		return Ok(VaultCreateReply {
			username_slug: OVERRIDE_VAULT_SLUG.into(),
		});
	}

	// The vault folder slug is NOT derived from the (free-form) device/signer name —
	// it's a transient staging id, renamed to the deterministic, key-derived
	// `identity_folder_id(signer pubkey)` at `finalize_identity_folder` once biometry
	// has produced the key. So the name can contain any characters (spaces, parens).
	let vaults_base = paths::vaults_dir(&app)?;
	fs::create_dir_all(&vaults_base).map_err(|e| format!("create_dir_all: {e}"))?;

	let slug = allocate_username_slug(&vaults_base, &paths::new_staging_slug())?;
	let vr = vaults_base.join(&slug);

	fs::create_dir_all(paths::db_dir(&vr)).map_err(|e| format!("mkdir identity db: {e}"))?;
	fs::create_dir_all(paths::identity_crypto_dir(&vr))
		.map_err(|e| format!("mkdir identity vault: {e}"))?;
	crate::vault_settings::ensure_default_file(&vr)?;

	let now = unix_ms_i64();
	let m = VaultManifest {
		first_name: first_name.clone(),
		username_slug: slug.clone(),
		device_label: device_label.clone(),
		signer_type: signer_type.clone(),
		created_at_ms: now,
	};
	write_manifest(&vr, &m)?;

	vault_state.select(&slug)?;

	Ok(VaultCreateReply {
		username_slug: slug,
	})
}

#[tauri::command(rename_all = "camelCase")]
pub async fn vault_selected_slug(vault_state: State<'_, ActiveVault>) -> Result<Option<String>, String> {
	vault_state.selected_slug()
}

/// Single source of truth for the currently unlocked identity.
///
/// Returns `Some` only when the vault is `Unlocked` AND `SelfState` holds a root —
/// i.e. the on-disk vault directory backing the cached ppK is pinned and consistent.
/// Returns `None` whenever locked. The frontend should read this (and re-fetch on
/// `self:did-unlock` / `self:did-lock` events) instead of polling the slug separately.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveIdentityReply {
	pub username_slug: String,
	pub pairing_label: Option<String>,
	pub ppk_hex: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn active_identity(
	app: AppHandle,
	vault: State<'_, ActiveVault>,
	state: State<'_, SelfState>,
) -> Result<Option<ActiveIdentityReply>, String> {
	if !state.is_unlocked() {
		return Ok(None);
	}
	let Some(slug) = vault.selected_slug()? else {
		return Ok(None);
	};
	let Some(ppk) = vault.pinned_ppk()? else {
		// SelfState says unlocked but vault is not pinned — invariant violation.
		// Surface as "not yet ready" rather than returning a half-resolved identity.
		return Ok(None);
	};
	Ok(Some(ActiveIdentityReply {
		username_slug: slug,
		pairing_label: pairing_label_for_app(&app, &*vault),
		ppk_hex: hex_lower(&ppk),
	}))
}

fn hex_lower(bytes: &[u8; 32]) -> String {
	const HEX: &[u8; 16] = b"0123456789abcdef";
	let mut out = String::with_capacity(64);
	for b in bytes {
		out.push(HEX[(b >> 4) as usize] as char);
		out.push(HEX[(b & 0x0f) as usize] as char);
	}
	out
}

fn write_manifest(dir: &std::path::Path, m: &VaultManifest) -> Result<(), String> {
	let dst = paths::manifest_path(dir);
	if let Some(parent) = dst.parent() {
		fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
	}
	let tmp = dst.with_extension("json.tmp");
	let json =
		serde_json::to_string_pretty(m).map_err(|e| format!("manifest json encode: {e}"))?;
	fs::write(&tmp, json.as_bytes()).map_err(|e| format!("manifest write {}: {e}", tmp.display()))?;
	fs::rename(&tmp, &dst).map_err(|e| format!("manifest rename: {e}"))?;
	Ok(())
}

fn unix_ms_i64() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
		.unwrap_or(0i64)
}

fn allocate_username_slug(vaults_base: &std::path::Path, base_name: &str) -> Result<String, String> {
	let mut candidate = base_name.to_string();
	let mut n = 2u32;
	while vaults_base.join(&candidate).exists() {
		candidate = format!("{base_name}{n}");
		n += 1;
		if n > 10_000 {
			return Err("vault_slug_collision_exceeded".into());
		}
		paths::validate_username_slug(&candidate)?;
	}
	Ok(candidate)
}

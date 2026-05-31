//! Canonical layout: `<Documents>/.avenOS/<network>/identities/<slug>/{vault,db}`.
//!
//! **Override**: `AVENOS_DATA_DIR_OVERRIDE` points at a **full identity root** (directory that directly
//! contains `vault/` and `db/`) for tests and tooling.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::vault::ActiveVault;

/// Slug used for synthetic entries when `AVENOS_DATA_DIR_OVERRIDE` is active.
pub const OVERRIDE_VAULT_SLUG: &str = "sandbox";

pub const IDENTITY_CRYPTO_DIR: &str = "vault";
pub const MANIFEST_FILENAME: &str = "manifest.json";
pub const SETTINGS_FILENAME: &str = "settings.json";
pub const STRONGHOLD_FILENAME: &str = "strong.hold";
pub const STORAGE_ROCKSDB_FILENAME: &str = "storage.rocksdb";
pub const LEGACY_ROCKSDB_FILENAME: &str = "jazz.rocksdb";

pub(crate) fn expand_override() -> Option<PathBuf> {
	let ok = std::env::var("AVENOS_DATA_DIR_OVERRIDE").ok()?;
	let p = PathBuf::from(shellexpand::tilde(&ok).as_ref());
	log::info!(
		target: "avenos::paths",
		"AVENOS_DATA_DIR_OVERRIDE active: using {}",
		p.display(),
	);
	Some(p)
}

/// User-local Documents directory (Tauri resolver, then `dirs` / XDG fallback).
pub fn user_documents_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
	match app.path().document_dir() {
		Ok(p) if !p.as_os_str().is_empty() => Ok(p),
		_ => dirs::document_dir().ok_or_else(|| {
			"could not resolve user Documents directory (set XDG_DOCUMENTS_DIR on Linux)".into()
		}),
	}
}

use crate::network::NETWORK_PATH_SEGMENTS;

/// `<Documents>/.avenOS/<network>` — parent of `identities/`.
pub fn aven_os_app_base<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
	if let Some(root) = expand_override() {
		fs::create_dir_all(&root).map_err(|e| format!("create_dir_all {}: {e}", root.display()))?;
		return Ok(root);
	}
	let docs = user_documents_dir(app)?;
	let mut base = docs.join(".avenOS");
	for seg in NETWORK_PATH_SEGMENTS {
		base = base.join(seg);
	}
	fs::create_dir_all(&base).map_err(|e| format!("create_dir_all {}: {e}", base.display()))?;
	Ok(base)
}

pub fn identities_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
	if expand_override().is_some() {
		return Err("identities_dir_unavailable_under_data_dir_override".into());
	}
	Ok(aven_os_app_base(app)?.join("identities"))
}

/// Legacy name — prefer [`identities_dir`].
pub fn vaults_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
	identities_dir(app)
}

/// Resolves the active identity directory (`…/identities/<slug>` or override root).
pub fn aven_os_user_root<R: tauri::Runtime>(
	app: &AppHandle<R>,
	vault: &ActiveVault,
) -> Result<PathBuf, String> {
	if let Some(root) = expand_override() {
		return Ok(root);
	}
	let slug = vault.require_slug()?;
	Ok(identities_dir(app)?.join(&slug))
}

/// `…/identities/<slug>/vault` — SE blobs, strong.hold, manifest, settings.
pub fn identity_crypto_dir(identity_root: &Path) -> PathBuf {
	identity_root.join(IDENTITY_CRYPTO_DIR)
}

pub fn manifest_path(identity_root: &Path) -> PathBuf {
	identity_crypto_dir(identity_root).join(MANIFEST_FILENAME)
}

pub fn settings_path(identity_root: &Path) -> PathBuf {
	identity_crypto_dir(identity_root).join(SETTINGS_FILENAME)
}

pub fn stronghold_path(identity_root: &Path) -> PathBuf {
	identity_crypto_dir(identity_root).join(STRONGHOLD_FILENAME)
}

pub fn db_dir(identity_root: &Path) -> PathBuf {
	identity_root.join("db")
}

pub fn slugify_first_name(raw: &str) -> Result<String, String> {
	let s = raw.trim();
	if s.is_empty() {
		return Err("first_name_required".into());
	}
	let mut out = String::new();
	let lower = s.to_lowercase();
	for ch in lower.chars() {
		match ch {
			'a'..='z' | '0'..='9' => out.push(ch),
			' ' | '-' | '_' | '.' => {}
			_ => return Err("first_name_contains_invalid_slug_characters".into()),
		}
	}
	if out.is_empty() {
		return Err("first_name_must_contain_alphanumeric_slug_characters".into());
	}
	validate_username_slug(&out)?;
	Ok(out)
}

pub fn validate_username_slug(slug: &str) -> Result<(), String> {
	if slug.is_empty() {
		return Err("username_slug_empty".into());
	}
	if slug == "." || slug == ".." || slug.contains('/') || slug.contains('\\') {
		return Err("unsafe_username_slug".into());
	}
	if !slug
		.chars()
		.all(|c| matches!(c, 'a'..='z' | '0'..='9' | '-' | '_'))
	{
		return Err(
			"username_slug_must_be_lowercase_alphanumeric_hyphen_or_underscore".into(),
		);
	}
	Ok(())
}

pub fn vault_is_complete(root: &Path) -> bool {
	identity_crypto_dir(root).is_dir() && db_dir(root).is_dir()
}

/// One-time migration: `vaults/` → `identities/`, `self/` → `vault/`, legacy filenames.
pub fn migrate_layout<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<(), String> {
	if expand_override().is_some() {
		return migrate_identity_root(&aven_os_app_base(app)?);
	}
	let base = aven_os_app_base(app)?;
	let legacy_vaults = base.join("vaults");
	let identities = base.join("identities");
	if legacy_vaults.is_dir() && !identities.exists() {
		fs::rename(&legacy_vaults, &identities)
			.map_err(|e| format!("migrate vaults→identities: {e}"))?;
		log::info!(target: "avenos::paths", "migrated {} → {}", legacy_vaults.display(), identities.display());
	}
	if !identities.is_dir() {
		fs::create_dir_all(&identities).map_err(|e| format!("mkdir identities: {e}"))?;
	}
	let rd = fs::read_dir(&identities).map_err(|e| format!("read_dir identities: {e}"))?;
	for ent in rd.flatten() {
		if ent.metadata().map(|m| m.is_dir()).unwrap_or(false) {
			migrate_identity_root(&ent.path())?;
		}
	}
	Ok(())
}

fn migrate_identity_root(root: &Path) -> Result<(), String> {
	let legacy_self = root.join("self");
	let crypto = identity_crypto_dir(root);
	if legacy_self.is_dir() && !crypto.exists() {
		fs::rename(&legacy_self, &crypto)
			.map_err(|e| format!("migrate self→vault {}: {e}", root.display()))?;
	}
	if crypto.is_dir() {
		let legacy_manifest_root = root.join("vault_manifest.json");
		let manifest = manifest_path(root);
		if legacy_manifest_root.is_file() && !manifest.is_file() {
			fs::create_dir_all(&crypto).ok();
			fs::rename(&legacy_manifest_root, &manifest)
				.map_err(|e| format!("migrate manifest: {e}"))?;
		}
		let legacy_manifest_in_crypto = crypto.join("vault_manifest.json");
		if legacy_manifest_in_crypto.is_file() && !manifest.is_file() {
			fs::rename(&legacy_manifest_in_crypto, &manifest)
				.map_err(|e| format!("migrate vault_manifest in crypto dir: {e}"))?;
		}
		let legacy_settings = crypto.join("vault_settings.json");
		let settings = settings_path(root);
		if legacy_settings.is_file() && !settings.is_file() {
			fs::rename(&legacy_settings, &settings)
				.map_err(|e| format!("migrate settings: {e}"))?;
		}
	}
	let db = db_dir(root);
	if db.is_dir() {
		let legacy_rocksdb = db.join(LEGACY_ROCKSDB_FILENAME);
		let storage = db.join(STORAGE_ROCKSDB_FILENAME);
		if legacy_rocksdb.is_file() && !storage.exists() {
			fs::rename(&legacy_rocksdb, &storage)
				.map_err(|e| format!("migrate jazz.rocksdb→storage.rocksdb: {e}"))?;
		}
	}
	Ok(())
}

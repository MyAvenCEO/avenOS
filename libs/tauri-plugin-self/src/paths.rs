//! Canonical layout: `<Documents>/.avenOS/<network>/vaults/<slug>/{vault,db}`.
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

/// `<Documents>/.avenOS/<network>` — parent of `vaults/`.
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

/// `<Documents>/.avenOS/<network>/vaults/` — the container of one `<slug>/` dir per
/// peer (every client device AND server node is a peer). On-disk name is `vaults`.
pub fn vaults_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
	if expand_override().is_some() {
		return Err("vaults_dir_unavailable_under_data_dir_override".into());
	}
	Ok(aven_os_app_base(app)?.join("vaults"))
}

/// `<Documents>/.avenOS/models` — shared on-device model cache (e.g. the Gemma 4
/// voice-transcription weights). Lives at the `.avenOS` ROOT, not under the
/// network/identity path, so the multi-GB weights are downloaded once and shared
/// across every network and identity. Created if missing.
pub fn models_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
	let dir = if let Some(root) = expand_override() {
		// Honour the data-dir override (dev instances / tests) at its root.
		root.join("models")
	} else {
		user_documents_dir(app)?.join(".avenOS").join("models")
	};
	fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all {}: {e}", dir.display()))?;
	Ok(dir)
}

/// Resolves the active vault directory (`…/vaults/<slug>` or override root).
pub fn aven_os_user_root<R: tauri::Runtime>(
	app: &AppHandle<R>,
	vault: &ActiveVault,
) -> Result<PathBuf, String> {
	if let Some(root) = expand_override() {
		return Ok(root);
	}
	let slug = vault.require_slug()?;
	Ok(vaults_dir(app)?.join(&slug))
}

/// `…/vaults/<slug>/vault` — SE blobs, strong.hold, manifest, settings.
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

/// Canonical identity-folder id derived from a device public key — the Secure-Enclave
/// P-256 pubkey on macOS, the Ed25519 account key in dev. Lowercase hex of a
/// domain-separated SHA-256 truncated to 128 bits (passes [`validate_username_slug`]).
///
/// This is what binds the on-disk identity folder to its cryptographic identity instead
/// of the human first-name slug, so two distinct identities can never resolve to (and
/// therefore brick) the same folder.
pub fn identity_folder_id(key_bytes: &[u8]) -> String {
	use sha2::{Digest, Sha256};
	let mut h = Sha256::new();
	h.update(b"ceo.aven.os/identity-folder-id-v1");
	h.update(key_bytes);
	let digest = h.finalize();
	let mut out = String::with_capacity(32);
	for b in &digest[..16] {
		out.push(char::from_digit(u32::from(b >> 4), 16).expect("hex nibble"));
		out.push(char::from_digit(u32::from(b & 0x0f), 16).expect("hex nibble"));
	}
	out
}

pub fn vault_is_complete(root: &Path) -> bool {
	identity_crypto_dir(root).is_dir() && db_dir(root).is_dir()
}

#[cfg(test)]
mod identity_folder_id_tests {
	use super::*;

	#[test]
	fn deterministic_and_valid_slug() {
		let key = [7u8; 65];
		let a = identity_folder_id(&key);
		let b = identity_folder_id(&key);
		assert_eq!(a, b, "same key must yield the same folder id");
		assert_eq!(a.len(), 32, "128-bit hex id");
		validate_username_slug(&a).expect("folder id must be a valid on-disk slug");
	}

	#[test]
	fn distinct_keys_yield_distinct_ids() {
		// The whole point: two different identities can never collide on one folder.
		let id_se = identity_folder_id(&[1u8; 65]); // macOS SE P-256 pubkey shape
		let id_ed = identity_folder_id(&[2u8; 32]); // dev Ed25519 account key shape
		assert_ne!(id_se, identity_folder_id(&[2u8; 65]));
		assert_ne!(id_ed, identity_folder_id(&[1u8; 32]));
		assert_ne!(id_se, id_ed);
	}
}


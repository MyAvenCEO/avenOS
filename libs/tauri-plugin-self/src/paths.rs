//! Canonical layout: `<user Documents>/.avenOS/<network>/vaults/<slug>/{db,self}` (OS-localized Documents folder).
//!
//! **Override**: `AVENOS_DATA_DIR_OVERRIDE` points at a **full vault root** (directory that directly
//! contains `db/` and `self/`) for tests and tooling — bypasses `vaults/` and [`ActiveVault`].

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::vault::ActiveVault;

/// Slug used for synthetic entries when `AVENOS_DATA_DIR_OVERRIDE` is active.
pub const OVERRIDE_VAULT_SLUG: &str = "sandbox";

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

/// `<Documents>/.avenOS/<network>` — parent of `vaults/` (not a vault root unless override).
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

pub fn vaults_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
	if expand_override().is_some() {
		return Err("vaults_dir_unavailable_under_data_dir_override".into());
	}
	Ok(aven_os_app_base(app)?.join("vaults"))
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
	let vr = vaults_dir(app)?.join(&slug);
	Ok(vr)
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
	root.join("self").is_dir() && root.join("db").is_dir()
}

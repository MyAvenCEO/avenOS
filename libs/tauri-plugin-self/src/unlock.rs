//! Shared post-unlock path: cache root secret, open Stronghold, pin vault ↔ Ed25519 ppK.

use tauri::{AppHandle, Emitter, Runtime};

use crate::derive;
use crate::paths;
use crate::state::SelfState;
use crate::stronghold_vault::StrongholdSession;
use crate::vault::ActiveVault;

pub(crate) fn unlock_with_root_secret<R: Runtime>(
	app: &AppHandle<R>,
	vault: &ActiveVault,
	state: &SelfState,
	stronghold: &StrongholdSession,
	root: [u8; 32],
) -> Result<(), String> {
	let slug = vault.require_slug()?;
	let identity_root = paths::aven_os_user_root(app, vault)?;
	let hold_path = paths::stronghold_path(&identity_root);
	stronghold.open_or_create(&hold_path, &root)?;
	let ppk = derive::ed25519_public(&root)?;
	state.set_root(root);
	if let Err(e) = vault.pin_unlocked(slug, ppk) {
		state.clear();
		let _ = stronghold.save_and_close();
		return Err(e);
	}
	let _ = app.emit("self:did-unlock", ());
	Ok(())
}

pub(crate) fn lock_identity<R: Runtime>(
	app: &AppHandle<R>,
	state: &SelfState,
	vault: &ActiveVault,
	stronghold: &StrongholdSession,
) -> Result<(), String> {
	stronghold.save_and_close()?;
	state.clear();
	vault.clear()?;
	let _ = app.emit("self:did-lock", ());
	Ok(())
}

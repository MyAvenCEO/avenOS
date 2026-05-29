//! Shared post-unlock path: cache root secret and pin vault ↔ Ed25519 ppK.

use tauri::{AppHandle, Emitter, Runtime};

use crate::derive;
use crate::state::SelfState;
use crate::vault::ActiveVault;

pub(crate) fn unlock_with_root_secret<R: Runtime>(
	app: &AppHandle<R>,
	vault: &ActiveVault,
	state: &SelfState,
	root: [u8; 32],
) -> Result<(), String> {
	let slug = vault.require_slug()?;
	let ppk = derive::ed25519_public(&root)?;
	state.set_root(root);
	if let Err(e) = vault.pin_unlocked(slug, ppk) {
		state.clear();
		return Err(e);
	}
	let _ = app.emit("self:did-unlock", ());
	Ok(())
}

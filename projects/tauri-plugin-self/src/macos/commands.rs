#![cfg(target_os = "macos")]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Runtime, State};

use crate::state::SelfState;
use crate::vault::ActiveVault;

/// Lock-screen reason shown in the Touch ID sheet.
const UNLOCK_REASON: &str = "Unlock AvenOS device identity";

/// User-facing surface of `peer_status`. **No biometry, no SE load.**
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerStatus {
	pub platform_supported: bool,
	pub registered: bool,
	pub unlocked: bool,
}

fn slot_dir<R: Runtime>(app: &AppHandle<R>, vault: &ActiveVault) -> Result<PathBuf, String> {
	let dir = crate::paths::aven_os_user_root(app, vault)?.join("self");
	fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all({}): {e}", dir.display()))?;
	Ok(dir)
}

fn blob_path<R: Runtime>(app: &AppHandle<R>, vault: &ActiveVault, slot: &str) -> Result<PathBuf, String> {
	Ok(slot_dir(app, vault)?.join(format!("peer-id-{slot}.se-blob")))
}

fn pub_path<R: Runtime>(app: &AppHandle<R>, vault: &ActiveVault, slot: &str) -> Result<PathBuf, String> {
	Ok(slot_dir(app, vault)?.join(format!("peer-id-{slot}.pub")))
}

/// Atomic write at `0600`. SE-wrapped blob is ciphertext; the `0600` is defence-in-depth only.
fn write_secure(path: &Path, data: &[u8]) -> Result<(), String> {
	let tmp = path.with_extension("se-blob.tmp");
	fs::write(&tmp, data).map_err(|e| format!("write {}: {e}", tmp.display()))?;
	fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))
		.map_err(|e| format!("chmod 0600 {}: {e}", tmp.display()))?;
	fs::rename(&tmp, path).map_err(|e| format!("rename {} -> {}: {e}", tmp.display(), path.display()))?;
	Ok(())
}

#[tauri::command]
pub async fn register(
	app: AppHandle,
	vault: State<'_, ActiveVault>,
	slot: String,
) -> Result<(), String> {
	let blob_p = blob_path(&app, &*vault, &slot)?;
	let pub_p = pub_path(&app, &*vault, &slot)?;

	if blob_p.exists() && pub_p.exists() {
		// Already registered for this slot — no-op, no biometric prompt.
		return Ok(());
	}

	let (blob, pub_bytes) = crate::macos::create_se_key().await?;
	if pub_bytes.len() < 65 {
		return Err(format!(
			"se_returned_malformed_pubkey: {} bytes",
			pub_bytes.len()
		));
	}

	write_secure(&blob_p, &blob)?;
	write_secure(&pub_p, &pub_bytes)?;

	Ok(())
}


pub(crate) async fn read_device_pubkey_file(
	app: &AppHandle,
	vault: &ActiveVault,
	slot: &str,
) -> Result<Vec<u8>, String> {
	let pub_p = pub_path(app, vault, slot)?;
	if pub_p.exists() {
		return fs::read(&pub_p).map_err(|e| format!("read {}: {e}", pub_p.display()));
	}

	let blob_p = blob_path(app, vault, slot)?;
	if !blob_p.exists() {
		return Err("not_registered: call register first".into());
	}
	let blob = fs::read(&blob_p).map_err(|e| format!("read {}: {e}", blob_p.display()))?;
	let pub_bytes = crate::macos::public_key_from_blob(&blob)?;
	write_secure(&pub_p, &pub_bytes)?;
	Ok(pub_bytes)
}

#[tauri::command]
pub async fn public_key(
	app: AppHandle,
	vault: State<'_, ActiveVault>,
	slot: String,
) -> Result<Vec<u8>, String> {
	read_device_pubkey_file(&app, &*vault, &slot).await
}

/// One Touch ID prompt, then the resulting 32-byte root secret is cached in `SelfState`.
/// **Never returned to JS** — only its derived public outputs (Ed25519 pubkey, signatures) cross IPC.
///
/// After the secret is cached, the active vault is **pinned** to the derived Ed25519 ppK
/// via [`ActiveVault::pin_unlocked`]. This is the single transition `Locked → Unlocked`;
/// once pinned, no `vault_select` IPC can swap to a different identity until `lock` runs.
#[tauri::command]
pub async fn unlock(
	app: AppHandle,
	vault: State<'_, ActiveVault>,
	slot: String,
	genesis_network_id: Vec<u8>,
	state: State<'_, SelfState>,
) -> Result<(), String> {
	if genesis_network_id.len() != 65 {
		return Err(format!(
			"invalid_genesis_network_id: expected 65-byte SEC1 uncompressed P-256 point, got {}",
			genesis_network_id.len()
		));
	}

	let blob_p = blob_path(&app, &*vault, &slot)?;
	if !blob_p.exists() {
		return Err("not_registered: call register first".into());
	}
	let blob = fs::read(&blob_p).map_err(|e| format!("read {}: {e}", blob_p.display()))?;

	let secret = crate::macos::derive_root_secret(&blob, &genesis_network_id, UNLOCK_REASON).await?;
	let bytes: [u8; 32] = secret
		.as_slice()
		.try_into()
		.map_err(|_| format!("se_ecdh_hkdf produced {} bytes, expected 32", secret.len()))?;
	crate::unlock::unlock_with_root_secret(&app, &vault, &state, bytes)
}

#[tauri::command]
pub async fn peer_status(
	app: AppHandle,
	vault: State<'_, ActiveVault>,
	slot: String,
	state: State<'_, SelfState>,
) -> Result<PeerStatus, String> {
	// Before pick/create onboarding, no vault is selected — report status without error.
	let registered = match crate::paths::aven_os_user_root(&app, &*vault) {
		Ok(root) => {
			let self_dir = root.join("self");
			let pub_p = self_dir.join(format!("peer-id-{slot}.pub"));
			let blob_p = self_dir.join(format!("peer-id-{slot}.se-blob"));
			pub_p.exists() && blob_p.exists()
		}
		Err(_) => false,
	};
	Ok(PeerStatus {
		platform_supported: true,
		registered,
		unlocked: state.is_unlocked(),
	})
}

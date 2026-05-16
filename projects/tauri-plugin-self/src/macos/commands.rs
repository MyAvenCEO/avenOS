#![cfg(target_os = "macos")]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::state::SelfState;

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

fn slot_dir(app: &AppHandle) -> Result<PathBuf, String> {
	let dir = app
		.path()
		.app_data_dir()
		.map_err(|e| format!("app_data_dir: {e}"))?
		.join("self");
	fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all({}): {e}", dir.display()))?;
	Ok(dir)
}

fn blob_path(app: &AppHandle, slot: &str) -> Result<PathBuf, String> {
	Ok(slot_dir(app)?.join(format!("peer-id-{slot}.se-blob")))
}

fn pub_path(app: &AppHandle, slot: &str) -> Result<PathBuf, String> {
	Ok(slot_dir(app)?.join(format!("peer-id-{slot}.pub")))
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
pub async fn register(app: AppHandle, slot: String) -> Result<(), String> {
	let blob_p = blob_path(&app, &slot)?;
	let pub_p = pub_path(&app, &slot)?;

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

#[tauri::command]
pub async fn public_key(app: AppHandle, slot: String) -> Result<Vec<u8>, String> {
	let pub_p = pub_path(&app, &slot)?;
	if pub_p.exists() {
		return fs::read(&pub_p).map_err(|e| format!("read {}: {e}", pub_p.display()));
	}

	// Cache missing but blob still there — repair by re-deriving.
	let blob_p = blob_path(&app, &slot)?;
	if !blob_p.exists() {
		return Err("not_registered: call register first".into());
	}
	let blob = fs::read(&blob_p).map_err(|e| format!("read {}: {e}", blob_p.display()))?;
	let pub_bytes = crate::macos::public_key_from_blob(&blob)?;
	write_secure(&pub_p, &pub_bytes)?;
	Ok(pub_bytes)
}

/// One Touch ID prompt, then the resulting 32-byte root secret is cached in `SelfState`.
/// **Never returned to JS** — only its derived public outputs (Ed25519 pubkey, signatures) cross IPC.
#[tauri::command]
pub async fn unlock(
	app: AppHandle,
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

	let blob_p = blob_path(&app, &slot)?;
	if !blob_p.exists() {
		return Err("not_registered: call register first".into());
	}
	let blob = fs::read(&blob_p).map_err(|e| format!("read {}: {e}", blob_p.display()))?;

	let secret = crate::macos::derive_root_secret(&blob, &genesis_network_id, UNLOCK_REASON).await?;
	let bytes: [u8; 32] = secret
		.as_slice()
		.try_into()
		.map_err(|_| format!("se_ecdh_hkdf produced {} bytes, expected 32", secret.len()))?;
	state.set_root(bytes);
	Ok(())
}

#[tauri::command]
pub async fn peer_status(
	app: AppHandle,
	slot: String,
	state: State<'_, SelfState>,
) -> Result<PeerStatus, String> {
	let pub_p = pub_path(&app, &slot)?;
	let blob_p = blob_path(&app, &slot)?;
	Ok(PeerStatus {
		platform_supported: true,
		registered: pub_p.exists() && blob_p.exists(),
		unlocked: state.is_unlocked(),
	})
}

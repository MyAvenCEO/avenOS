//! Cross-platform IPC commands. The macOS-specific surface (SE, blobs) lives in `macos::commands`.
//!
//! Everything here operates against `SelfState` — the Rust-resident root secret cache populated
//! by `unlock` (macOS) or `unlock_with_root` (dev bypass / future platforms).

use tauri::AppHandle;
use tauri::Emitter;
use tauri::State;

use crate::derive;
use crate::state::SelfState;
use crate::vault::ActiveVault;

/// Stable `did:key` for HKDF-derived **Ed25519** application signing (`PEER_ID_<device>_ED25519`).
#[tauri::command]
pub async fn signing_peer_did(state: State<'_, SelfState>) -> Result<String, String> {
	state.with_root(|root| {
		let pk = derive::ed25519_public(root)?;
		Ok(crate::did::signing_did_ed25519(&pk))
	})
}

/// `did:key` for the device's **P-256 Secure Enclave** credential transcript (needs macOS peer pub on disk).
#[tauri::command]
pub async fn device_peer_did(app: AppHandle, vault: State<'_, ActiveVault>, slot: String) -> Result<String, String> {
	#[cfg(target_os = "macos")]
	{
		let pk = crate::macos::commands::read_device_pubkey_file(&app, &*vault, &slot).await?;
		crate::did::device_did_from_sec1_public_key(&pk)
	}

	#[cfg(not(target_os = "macos"))]
	{
		let _ = (app, vault, slot);
		Err("device_peer_did (P-256 credential) is unavailable on this platform in v1".into())
	}
}

/// 32-byte Ed25519 public key derived from the cached root secret. No biometric prompt.
#[tauri::command]
pub async fn signing_public_key(state: State<'_, SelfState>) -> Result<Vec<u8>, String> {
	state.with_root(|root| Ok(derive::ed25519_public(root)?.to_vec()))
}

/// Sign `message` (raw bytes) with the cached identity. Returns a 64-byte Ed25519 signature.
#[tauri::command]
pub async fn sign(state: State<'_, SelfState>, message: Vec<u8>) -> Result<Vec<u8>, String> {
	state.with_root(|root| Ok(derive::sign(root, &message)?.to_vec()))
}

/// Verify a detached signature. Pure, no state required — exposed here for symmetry / dogfooding.
#[tauri::command]
pub async fn verify(
	public_key: Vec<u8>,
	message: Vec<u8>,
	signature: Vec<u8>,
) -> Result<bool, String> {
	let pk: [u8; 32] = public_key
		.as_slice()
		.try_into()
		.map_err(|_| format!("public_key: expected 32 bytes, got {}", public_key.len()))?;
	let sig: [u8; 64] = signature
		.as_slice()
		.try_into()
		.map_err(|_| format!("signature: expected 64 bytes, got {}", signature.len()))?;
	derive::verify(&pk, &message, &sig)
}

/// Zeroize the cached root secret. Frontend should call this on window close / explicit re-lock.
///
/// Emits **`self:did-lock`** so the shell can tear down dependents (e.g. Groove / Jazz runtime)
/// whose cache must never outlive this secret.
#[tauri::command]
pub async fn lock(
	app: AppHandle,
	state: State<'_, SelfState>,
	vault: State<'_, ActiveVault>,
) -> Result<(), String> {
	state.clear();
	let _ = vault.clear();
	let _ = app.emit("self:did-lock", ());
	Ok(())
}

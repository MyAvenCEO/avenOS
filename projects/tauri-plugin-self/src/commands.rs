//! Cross-platform IPC commands. The macOS-specific surface (SE, blobs) lives in `macos::commands`.
//!
//! Everything here operates against `SelfState` — the Rust-resident root secret cache populated
//! by `unlock` (macOS) or `unlock_with_root` (dev bypass / future platforms).

use tauri::State;

use crate::derive;
use crate::state::SelfState;

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
#[tauri::command]
pub async fn lock(state: State<'_, SelfState>) -> Result<(), String> {
	state.clear();
	Ok(())
}

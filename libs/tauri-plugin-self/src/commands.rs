//! Cross-platform IPC commands. The macOS-specific surface (SE, blobs) lives in `macos::commands`.
//!
//! Everything here operates against `SelfState` — the Rust-resident root secret cache populated
//! by `unlock` (macOS) or `unlock_with_root` (dev bypass / future platforms).

use tauri::AppHandle;
use tauri::State;

use crate::derive;
use crate::state::SelfState;
use crate::stronghold_vault::StrongholdSession;
use crate::vault::ActiveVault;

/// Stable `did:key` for HKDF-derived **Ed25519** application signing (`PEER_ID_<device>_ED25519`).
#[tauri::command]
pub async fn signer_did(state: State<'_, SelfState>) -> Result<String, String> {
	state.with_root(|root| {
		let pk = derive::ed25519_public(root)?;
		Ok(crate::did::signing_did_ed25519(&pk))
	})
}

/// 32-byte Ed25519 public key derived from the cached root secret. No biometric prompt.
#[tauri::command]
pub async fn signing_public_key(state: State<'_, SelfState>) -> Result<Vec<u8>, String> {
	state.with_root(|root| Ok(derive::ed25519_public(root)?.to_vec()))
}

// The generic `sign` / `verify` IPC commands were removed (audit #14/#10/#30): they signed
// arbitrary caller-supplied bytes with the device identity key and were reachable from the
// WebView, which made a compromised renderer a universal forging oracle for owner-bindings,
// edit-sigs, biscuits, and p2p auth challenges. No frontend flow used them (only
// `signing_public_key` / `signing_peer_did` are consumed by the UI; all real auth signing is
// Rust-side via `jazz_auth` → `signing_key_from_root`). The raw primitive is now private
// (`derive::sign_raw`); the public `derive::sign` domain-prefixes (`WEBVIEW_SIGN_DOMAIN`).

/// Friendly host device label for onboarding (e.g. macOS "Computer Name": MacBook Air).
#[tauri::command]
pub async fn host_device_label() -> Result<String, String> {
	Ok(host_device_label_inner())
}

fn host_device_label_inner() -> String {
	let label = whoami::devicename();
	let label = label.trim();
	let label = label.strip_suffix(".local").unwrap_or(label);
	if label.is_empty()
		|| label.eq_ignore_ascii_case("localhost")
		|| label.eq_ignore_ascii_case("LocalHost")
	{
		return String::new();
	}
	// Dev A/B harness: both instances run on the same physical device → same auto
	// name. `AVEN_PEER_SUFFIX` (e.g. " (B)") disambiguates so each peer is selectable
	// by name at sign-in. Empty in production.
	let suffix = std::env::var("AVEN_PEER_SUFFIX").unwrap_or_default();
	format!("{label}{suffix}")
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
	stronghold: State<'_, StrongholdSession>,
) -> Result<(), String> {
	crate::unlock::lock_identity(&app, &state, &vault, &stronghold)
}

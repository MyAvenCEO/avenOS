//! **Debug only.** Plain 32-byte `device_root_secret` on disk for local testing.
//!
//! Used on Linux/Windows debug builds and **iOS Simulator** (`target_abi = "sim"`).
//! Never used on macOS desktop or physical iOS / TestFlight (Secure Enclave). Emits loud warnings.

#![cfg(any(
	not(any(target_os = "macos", target_os = "ios")),
	all(target_os = "ios", target_abi = "sim")
))]

use std::fs;
use std::path::{Path, PathBuf};

use rand_core::{OsRng, RngCore};
use tauri::{AppHandle, Runtime, State};

use crate::paths;
use crate::state::SelfState;
use crate::unlock;
use crate::vault::ActiveVault;

const WARN: &str = "\x1b[1;31m";
const RESET: &str = "\x1b[0m";

/// `AVENOS_DEV_INSECURE_IDENTITY=1` forces this path even in release builds (local QA only).
pub fn enabled() -> bool {
	if std::env::var("AVENOS_DEV_INSECURE_IDENTITY")
		.ok()
		.is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
	{
		return true;
	}
	#[cfg(all(target_os = "ios", target_abi = "sim"))]
	{
		return cfg!(debug_assertions);
	}
	cfg!(debug_assertions)
}

pub fn log_startup_banner() {
	if !enabled() {
		return;
	}
	eprintln!(
		"{WARN}╔══════════════════════════════════════════════════════════════════════╗{RESET}"
	);
	eprintln!(
		"{WARN}║  AVENOS DEV INSECURE IDENTITY — plain root secret on disk (NOT SE)   ║{RESET}"
	);
	eprintln!(
		"{WARN}║  For local Linux/dev testing only. Never ship or use in production.  ║{RESET}"
	);
	eprintln!(
		"{WARN}╚══════════════════════════════════════════════════════════════════════╝{RESET}"
	);
	log::warn!(
		target: "avenos::self",
		"DEV INSECURE IDENTITY: P-256 Secure Enclave disabled; using peer-id-{{slot}}.dev-root-secret (0600)"
	);
}

fn warn_op(op: &str, path: &Path) {
	eprintln!(
		"{WARN}⚠ AVENOS DEV IDENTITY [{op}]: reading/writing PLAIN root secret at {}{RESET}",
		path.display()
	);
	log::warn!(
		target: "avenos::self",
		"DEV INSECURE IDENTITY {op}: {}",
		path.display()
	);
}

fn slot_dir<R: Runtime>(app: &AppHandle<R>, vault: &ActiveVault) -> Result<PathBuf, String> {
	let dir = paths::identity_crypto_dir(&paths::aven_os_user_root(app, vault)?);
	fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all({}): {e}", dir.display()))?;
	Ok(dir)
}

pub fn dev_root_secret_path(dir: &Path, slot: &str) -> PathBuf {
	dir.join(format!("peer-id-{slot}.dev-root-secret"))
}

pub fn write_secure(path: &Path, data: &[u8]) -> Result<(), String> {
	let tmp = path.with_extension("dev-root-secret.tmp");
	fs::write(&tmp, data).map_err(|e| format!("write {}: {e}", tmp.display()))?;
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))
			.map_err(|e| format!("chmod 0600 {}: {e}", tmp.display()))?;
	}
	fs::rename(&tmp, path).map_err(|e| format!("rename {} -> {}: {e}", tmp.display(), path.display()))?;
	Ok(())
}

pub fn crypto_dir_has_dev_root(dir: &Path) -> bool {
	let Ok(rd) = fs::read_dir(dir) else {
		return false;
	};
	for ent in rd.flatten() {
		let name = ent.file_name();
		let s = name.to_string_lossy();
		if s.starts_with("peer-id-") && s.ends_with(".dev-root-secret") {
			if ent.metadata().map(|m| m.len() == 32).unwrap_or(false) {
				return true;
			}
		}
	}
	false
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerStatus {
	pub platform_supported: bool,
	pub registered: bool,
	pub unlocked: bool,
}

#[tauri::command]
pub async fn register<R: Runtime>(
	app: AppHandle<R>,
	vault: State<'_, ActiveVault>,
	slot: String,
) -> Result<(), String> {
	if !enabled() {
		return Err("tauri-plugin-self: macOS only in v1 (set AVENOS_DEV_INSECURE_IDENTITY=1 for forced dev mode)".into());
	}
	let dir = slot_dir(&app, &vault)?;
	let path = dev_root_secret_path(&dir, &slot);
	let root: [u8; 32] = if path.is_file() {
		let bytes = fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
		bytes.as_slice().try_into().map_err(|_| {
			format!(
				"invalid dev root secret file (expected 32 bytes): {}",
				path.display()
			)
		})?
	} else {
		warn_op("register", &path);
		let mut root = [0u8; 32];
		OsRng.fill_bytes(&mut root);
		write_secure(&path, &root)?;
		root
	};
	// Dev has no SE device key — bind the folder to the Ed25519 account key instead.
	let ppk = crate::derive::ed25519_public(&root)?;
	crate::vault_commands::finalize_identity_folder(&app, &vault, &ppk)?;
	Ok(())
}

#[tauri::command]
pub async fn public_key<R: Runtime>(
	app: AppHandle<R>,
	vault: State<'_, ActiveVault>,
	slot: String,
) -> Result<Vec<u8>, String> {
	if !enabled() {
		return Err("public_key unavailable on this platform".into());
	}
	let _ = (app, vault, slot);
	Err("dev_insecure_identity: no P-256 device pubkey (plain root secret only)".into())
}

#[tauri::command]
pub async fn unlock<R: Runtime>(
	app: AppHandle<R>,
	vault: State<'_, ActiveVault>,
	slot: String,
	state: State<'_, SelfState>,
	stronghold: State<'_, crate::stronghold_vault::StrongholdSession>,
) -> Result<(), String> {
	if !enabled() {
		return Err("tauri-plugin-self: macOS only in v1".into());
	}
	let dir = slot_dir(&app, &vault)?;
	let path = dev_root_secret_path(&dir, &slot);
	if !path.is_file() {
		return Err("not_registered: call register first".into());
	}
	warn_op("unlock", &path);
	let bytes = fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
	let root: [u8; 32] = bytes
		.as_slice()
		.try_into()
		.map_err(|_| format!("dev root secret: expected 32 bytes, got {}", bytes.len()))?;
	unlock::unlock_with_root_secret(&app, &vault, &state, &stronghold, root)
}

#[tauri::command]
pub async fn peer_status<R: Runtime>(
	app: AppHandle<R>,
	vault: State<'_, ActiveVault>,
	slot: String,
	state: State<'_, SelfState>,
) -> Result<PeerStatus, String> {
	let _ = slot;
	let registered = match paths::aven_os_user_root(&app, &*vault) {
		Ok(root) => crypto_dir_has_dev_root(&paths::identity_crypto_dir(&root)),
		Err(_) => false,
	};
	Ok(PeerStatus {
		platform_supported: enabled(),
		registered,
		unlocked: state.is_unlocked(),
	})
}

//! Offline capability gates (biscuit) for spark-scoped IPC.
//!
//! The cap logic moved to the shared [`aven_caps::caps`] crate (single source of
//! truth, also used by the `aven-server`). Re-exported here so existing
//! `crate::spark_acc::…` call sites are unchanged. Only the **device-specific**
//! vault builder stays here (it derives the signing key from the device root via
//! tauri, which the shared crate must not depend on). See
//! `docs/ServerRootedAvenCeoPlan.md`.

pub use aven_caps::caps::*;

/// Build the cap vault from this device's 32-byte root (tauri-derived signing
/// key). The shared crate stays tauri-free; this wrapper supplies the key.
pub fn build_vault_from_root(root: &[u8; 32]) -> Result<BiscuitVault, String> {
	let sk = crate::jazz_auth::signing_key_from_device_root(root)?;
	build_vault_from_signing_key(&sk)
}

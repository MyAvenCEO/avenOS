//! Peer identity for AvenOS ACC + Jazz session shim.
//! `jwt_token` is left `None` — jazz-tools 2.0 alpha accepts it locally (see jazz_connect).

use ed25519_dalek::SigningKey;

/// The `did:key` ↔ Ed25519 codec now has a single source of truth in
/// `groove::did_key` (so the app, the device engine, and the `aven-p2p` transport
/// handshake all decode the same bytes — see board `0004-aven-node-mini`).
/// Re-exported here so existing `crate::jazz_auth::…` call sites are unchanged.
pub use groove::did_key::{ed25519_public_from_peer_did, peer_did_from_ed25519};

/// Deterministic jazz `PeerId`-style fingerprint (not a JWT claim for ACC).
#[must_use]
pub fn client_uuid_from_ed_pubkey(pubkey: &[u8; 32]) -> uuid::Uuid {
	use sha2::{Digest, Sha256};
	let mut digest = Sha256::new();
	digest.update(b"ceo.aven.os/jazz/client-id-v1");
	digest.update(pubkey.as_slice());
	let hash16: [u8; 16] = digest.finalize()[..16]
		.try_into()
		.expect("sha256 truncation");
	uuid::Uuid::from_bytes(hash16)
}

/// Build signing key matching `tauri_plugin_self::derive::signing_key_from_root(root)`.
pub fn signing_key_from_device_root(root: &[u8; 32]) -> Result<SigningKey, String> {
	tauri_plugin_self::derive::signing_key_from_root(root)
}

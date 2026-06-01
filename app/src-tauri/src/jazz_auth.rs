//! Peer identity for AvenOS ACC + Jazz session shim.
//! `jwt_token` is left `None` — jazz-tools 2.0 alpha accepts it locally (see jazz_connect).

use ed25519_dalek::{SigningKey, VerifyingKey};
use multibase::Base;

/// Multicodec prefix for raw Ed25519 public keys (RFC multicodec table).
/// https://github.com/multiformats/multicodec/blob/master/table.csv
pub const DID_KEY_ED25519_PREFIX: &[u8] = &[0xed, 0x01];

pub fn peer_did_from_ed25519(pubkey: &[u8; 32]) -> Result<String, String> {
	let mut buf = Vec::with_capacity(DID_KEY_ED25519_PREFIX.len() + 32);
	buf.extend_from_slice(DID_KEY_ED25519_PREFIX);
	buf.extend_from_slice(pubkey.as_slice());
	let mb = multibase::encode(Base::Base58Btc, &buf);
	if mb.is_empty() {
		return Err("multibase_encode_empty".into());
	}
	Ok(format!("did:key:{mb}"))
}

/// Reverse `did:key:` + multibase(Base58BTC, 0xed01 || ed25519 pub).
#[allow(dead_code)]
pub fn ed25519_public_from_peer_did(did: &str) -> Result<[u8; 32], String> {
	let rest = did
		.strip_prefix("did:key:")
		.ok_or_else(|| format!("did_key_expected_prefix:{did}"))?;
	let (_base, decoded) =
		multibase::decode(rest).map_err(|e| format!("did_key_decode:{e}"))?;
	if decoded.len() != DID_KEY_ED25519_PREFIX.len() + 32 {
		return Err(format!("did_key_wrong_length:{}", decoded.len()));
	}
	if &decoded[..2] != DID_KEY_ED25519_PREFIX {
		return Err("did_key_not_ed25519".into());
	}
	let pk: [u8; 32] = decoded[2..34]
		.try_into()
		.map_err(|_| "did_key_pubkey_slice".to_string())?;
	VerifyingKey::from_bytes(&pk).map_err(|e| format!("did_key_invalid_pubkey:{e}"))?;
	Ok(pk)
}

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

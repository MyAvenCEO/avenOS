//! Derive `did:key` from a Hyperswarm / Noise Ed25519 static public key (same encoding as Jazz / AvenOS).

use ed25519_dalek::VerifyingKey;
use multibase::Base;

/// Multicodec prefix for raw Ed25519 public keys (RFC multicodec table).
pub const DID_KEY_ED25519_PREFIX: &[u8] = &[0xed, 0x01];

#[must_use]
pub fn peer_did_from_ed25519(pubkey: &[u8; 32]) -> Result<String, String> {
	let mut buf = Vec::with_capacity(DID_KEY_ED25519_PREFIX.len() + 32);
	buf.extend_from_slice(DID_KEY_ED25519_PREFIX);
	buf.extend_from_slice(pubkey.as_slice());
	let mb = multibase::encode(Base::Base58Btc, &buf);
	if mb.is_empty() {
		return Err("multibase_encode_empty".into());
	}
	VerifyingKey::from_bytes(pubkey).map_err(|e| format!("did_key_invalid_pubkey:{e}"))?;
	Ok(format!("did:key:{mb}"))
}

/// Reverse `did:key:` + multibase(Base58BTC, 0xed01 || ed25519 pub).
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

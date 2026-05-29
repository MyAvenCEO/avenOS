//! Pure-Rust derivation of "self" primitives from the SE-rooted `device_root_secret`.
//!
//! The SE has already produced a 32-byte `device_root_secret` via:
//!   `HKDF-SHA256(ikm = ECDH(SE_priv, GENESIS_NETWORK_ID), salt = GENESIS_NETWORK_ID, info = "ceo.aven.os/root/v1")`
//!
//! From that root we run a second HKDF-Expand per derived primitive, using disjoint `info` strings.
//! Each branch is independent: compromise of a derived seed never reveals the root or its siblings.
//!
//! v1 only derives **`PEER_ID_<device>_ED25519`**, which Jazz will consume as its
//! agent signing key (one curve, two roles — also slated as the peeroxide Noise XX static key).

use ed25519_dalek::{Signature, SigningKey, Verifier, VerifyingKey, SECRET_KEY_LENGTH};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroizing;

/// HKDF info tag for the Ed25519 signing seed. Bumping `vN` rotates the keypair without
/// touching the SE root; until then this is stable across builds.
pub const ED25519_INFO: &[u8] = b"ceo.aven.os/identity/ed25519/v1";

/// Derive the Ed25519 seed from a 32-byte root secret using HKDF-Expand-SHA256.
/// Caller is expected to hold `root` in zeroizable storage; the returned seed is wrapped too.
pub fn derive_ed25519_seed(root: &[u8; 32]) -> Result<Zeroizing<[u8; SECRET_KEY_LENGTH]>, String> {
	let hk = Hkdf::<Sha256>::from_prk(root).map_err(|e| format!("hkdf from_prk: {e}"))?;
	let mut seed = Zeroizing::new([0u8; SECRET_KEY_LENGTH]);
	hk.expand(ED25519_INFO, seed.as_mut_slice())
		.map_err(|e| format!("hkdf expand ed25519: {e}"))?;
	Ok(seed)
}

/// Build an Ed25519 signing key from a root secret (HKDF on the fly, no caching).
pub fn signing_key_from_root(root: &[u8; 32]) -> Result<SigningKey, String> {
	let seed = derive_ed25519_seed(root)?;
	Ok(SigningKey::from_bytes(&seed))
}

/// 32-byte Ed25519 public key derived from the root secret.
pub fn ed25519_public(root: &[u8; 32]) -> Result<[u8; 32], String> {
	Ok(signing_key_from_root(root)?.verifying_key().to_bytes())
}

/// Sign `message` with the Ed25519 key derived from `root`. Returns the 64-byte signature.
pub fn sign(root: &[u8; 32], message: &[u8]) -> Result<[u8; 64], String> {
	let sk = signing_key_from_root(root)?;
	Ok(ed25519_dalek::Signer::sign(&sk, message).to_bytes())
}

/// Verify `signature` over `message` with a 32-byte Ed25519 public key.
pub fn verify(public_key: &[u8; 32], message: &[u8], signature: &[u8; 64]) -> Result<bool, String> {
	let vk =
		VerifyingKey::from_bytes(public_key).map_err(|e| format!("ed25519 vk decode: {e}"))?;
	let sig = Signature::from_bytes(signature);
	Ok(vk.verify(message, &sig).is_ok())
}

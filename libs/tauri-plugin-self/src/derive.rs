//! Pure-Rust derivation of "self" primitives from the SE-rooted `device_root_secret`.
//!
//! The SE has already produced a 32-byte `device_root_secret` via:
//!   `HKDF-SHA256(ikm = ECDH(SE_priv, network_anchor), salt = NETWORK_SEED, info = NETWORK_SEED)`
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

/// HKDF info tag for the Ed25519 signing seed (network-scoped).
pub fn ed25519_info_bytes() -> Vec<u8> {
	crate::network::ed25519_identity_info().into_bytes()
}

/// Derive the Ed25519 seed from a 32-byte root secret using HKDF-Expand-SHA256.
/// Caller is expected to hold `root` in zeroizable storage; the returned seed is wrapped too.
pub fn derive_ed25519_seed(root: &[u8; 32]) -> Result<Zeroizing<[u8; SECRET_KEY_LENGTH]>, String> {
	let hk = Hkdf::<Sha256>::from_prk(root).map_err(|e| format!("hkdf from_prk: {e}"))?;
	let mut seed = Zeroizing::new([0u8; SECRET_KEY_LENGTH]);
	hk.expand(&ed25519_info_bytes(), seed.as_mut_slice())
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

/// Reserved domain prefix for any signature produced through the generic [`sign`] path.
/// It is byte-disjoint from every protocol domain — owner-binding
/// (`avenos:owner-binding:v1\0`), edit-sig (`avenos:edit-sig:v1\0`), the un-prefixed p2p
/// challenge text, and the biscuit domain — so a signature minted here can NEVER be replayed
/// as a protocol attestation any verifier trusts (audit #14/#10/#30).
pub const WEBVIEW_SIGN_DOMAIN: &[u8] = b"avenos:webview-sign:v1\0";

/// Raw, un-prefixed Ed25519 signing primitive. **Private on purpose**: the only legitimate
/// signers (owner-bindings, edit-sigs, the p2p challenge, biscuits) sign through
/// `ed25519_dalek::SigningKey` directly via [`signing_key_from_root`], never through this
/// module, so a generic raw-signing entry point would only ever serve as a forging oracle.
fn sign_raw(root: &[u8; 32], message: &[u8]) -> Result<[u8; 64], String> {
	let sk = signing_key_from_root(root)?;
	Ok(ed25519_dalek::Signer::sign(&sk, message).to_bytes())
}

/// Sign `message` with the Ed25519 key derived from `root`, **unconditionally** prefixed
/// with [`WEBVIEW_SIGN_DOMAIN`]. Because that domain is disjoint from every protocol domain,
/// the resulting signature cannot be passed off as an owner-binding, edit-sig, challenge
/// response, or biscuit signature — even if the caller supplies the exact prefixed bytes of
/// one. Returns the 64-byte signature over `WEBVIEW_SIGN_DOMAIN ‖ message`.
pub fn sign(root: &[u8; 32], message: &[u8]) -> Result<[u8; 64], String> {
	let mut domained = Vec::with_capacity(WEBVIEW_SIGN_DOMAIN.len() + message.len());
	domained.extend_from_slice(WEBVIEW_SIGN_DOMAIN);
	domained.extend_from_slice(message);
	sign_raw(root, &domained)
}

/// Verify `signature` over `message` with a 32-byte Ed25519 public key.
pub fn verify(public_key: &[u8; 32], message: &[u8], signature: &[u8; 64]) -> Result<bool, String> {
	let vk =
		VerifyingKey::from_bytes(public_key).map_err(|e| format!("ed25519 vk decode: {e}"))?;
	let sig = Signature::from_bytes(signature);
	Ok(vk.verify(message, &sig).is_ok())
}

#[cfg(test)]
mod tests {
	use super::*;

	// Mirrors of the protocol domains (aven-caps owns the originals; asserted here without a
	// dependency on that crate). Kept in sync by intent.
	const OWNER_BINDING_DOMAIN: &[u8] = b"avenos:owner-binding:v1\0";
	const EDIT_SIG_DOMAIN: &[u8] = b"avenos:edit-sig:v1\0";

	fn is_prefix(needle: &[u8], haystack: &[u8]) -> bool {
		haystack.len() >= needle.len() && &haystack[..needle.len()] == needle
	}

	#[test]
	fn sign_prepends_reserved_domain_disjoint_from_protocols() {
		// Audit #14/#10/#30: the generic signing path must not be usable to forge a protocol
		// attestation. A WebView that asks `derive::sign` to sign the exact bytes of an
		// owner-binding must get back a signature that does NOT verify as that owner-binding.
		let root = [7u8; 32];
		let pk = ed25519_public(&root).unwrap();

		// The forged owner-binding payload a compromised renderer would submit.
		let mut payload = Vec::new();
		payload.extend_from_slice(OWNER_BINDING_DOMAIN);
		payload.extend_from_slice(&[0x11u8; 16]); // value_id
		payload.extend_from_slice(&[0x22u8; 16]); // owner

		let sig = sign(&root, &payload).unwrap();

		// The domain prefix is actually applied: the signature does NOT verify over the bare
		// owner-binding payload, so `verify_owner_binding`-style checks would reject it.
		assert_eq!(
			verify(&pk, &payload, &sig).unwrap(),
			false,
			"domained signature must NOT verify over the bare owner-binding payload"
		);
		// …and DOES verify over `WEBVIEW_SIGN_DOMAIN ‖ payload` (round-trip correctness).
		let mut domained = Vec::new();
		domained.extend_from_slice(WEBVIEW_SIGN_DOMAIN);
		domained.extend_from_slice(&payload);
		assert_eq!(
			verify(&pk, &domained, &sig).unwrap(),
			true,
			"domained signature verifies over WEBVIEW_SIGN_DOMAIN ‖ msg"
		);

		// The reserved domain is disjoint from every protocol domain (neither is a prefix of
		// the other), so a WebView-path signature can never collide with a protocol one.
		assert!(!is_prefix(WEBVIEW_SIGN_DOMAIN, OWNER_BINDING_DOMAIN));
		assert!(!is_prefix(OWNER_BINDING_DOMAIN, WEBVIEW_SIGN_DOMAIN));
		assert!(!is_prefix(WEBVIEW_SIGN_DOMAIN, EDIT_SIG_DOMAIN));
		assert!(!is_prefix(EDIT_SIG_DOMAIN, WEBVIEW_SIGN_DOMAIN));

		// A bare message no longer verifies under its own un-prefixed bytes.
		let msg = b"arbitrary-bytes";
		let s = sign(&root, msg).unwrap();
		assert_eq!(verify(&pk, msg, &s).unwrap(), false);
	}
}

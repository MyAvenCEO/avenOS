//! `did:key:` identifier for the HKDF-derived Ed25519 signer key.

use multibase::Base;

const DID_ED25519_PREFIX: &[u8] = &[0xed, 0x01];

/// `did:key` for an Ed25519 public key (HKDF-derived signer DID).
#[must_use]
pub fn signing_did_ed25519(pub_raw32: &[u8; 32]) -> String {
	let mut buf = Vec::with_capacity(DID_ED25519_PREFIX.len() + 32);
	buf.extend_from_slice(DID_ED25519_PREFIX);
	buf.extend_from_slice(pub_raw32);
	let mb = multibase::encode(Base::Base58Btc, &buf);
	format!("did:key:{mb}")
}

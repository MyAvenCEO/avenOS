//! Shared `did:key` ↔ Ed25519 codec.
//!
//! One implementation, three consumers (the app, the device engine, and the
//! `aven-p2p` transport) so the `did:key` representation can never diverge — the
//! transport handshake decodes the *same* bytes the app/biscuit subject encodes.
//! Lifted out of `app/src-tauri/src/jazz_auth.rs`, which now re-exports these.

use ed25519_dalek::VerifyingKey;
use multibase::Base;

/// Multicodec prefix for raw Ed25519 public keys (RFC multicodec table).
/// <https://github.com/multiformats/multicodec/blob/master/table.csv>
pub const DID_KEY_ED25519_PREFIX: &[u8] = &[0xed, 0x01];

/// Encode a 32-byte Ed25519 public key as `did:key:z…` (multibase Base58BTC of
/// `0xed01 || pubkey`).
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

/// Reverse `did:key:` + multibase(Base58BTC, `0xed01 || ed25519 pub`). Also
/// validates the bytes are a well-formed Ed25519 point.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_ed25519_did_key() {
        // Derive a *valid* Ed25519 public key from a seed: any 32 bytes are a
        // valid signing-key seed, but a raw [7u8; 32] is not a valid curve point
        // and now fails the decode-side `VerifyingKey::from_bytes` validation.
        let pk = ed25519_dalek::SigningKey::from_bytes(&[7u8; 32])
            .verifying_key()
            .to_bytes();
        let did = peer_did_from_ed25519(&pk).expect("encode");
        assert!(did.starts_with("did:key:z"));
        let back = ed25519_public_from_peer_did(&did).expect("decode");
        assert_eq!(back, pk);
    }

    #[test]
    fn rejects_non_did_key() {
        assert!(ed25519_public_from_peer_did("did:web:example.com").is_err());
        assert!(ed25519_public_from_peer_did("not-a-did").is_err());
    }
}

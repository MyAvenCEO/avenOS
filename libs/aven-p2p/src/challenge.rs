//! The did:key challenge — the client proves it controls its DID private key,
//! bound to the live TLS session.
//!
//! The signed message reuses the exact `aven-auth` challenge text
//! (`libs/aven-auth/.../challenge.ts`) so this transport handshake and the future
//! Rust auth server share one challenge primitive, plus a `Channel-Binding:` line
//! folded in from the TLS exporter (`export_keying_material`). Because the
//! exporter yields identical bytes on both ends of a TLS session, a signature
//! captured on one connection cannot be replayed onto another (anti-relay).

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Challenge validity window (matches `aven-auth`'s 5-minute TTL).
pub const CHALLENGE_TTL_SECS: u64 = 5 * 60;

/// Domain binding for the challenge message — set from the server's config.
#[derive(Debug, Clone)]
pub struct ChallengeParams {
    pub domain: String,
    pub uri: String,
    pub network_seed: String,
}

impl ChallengeParams {
    pub fn new(
        domain: impl Into<String>,
        uri: impl Into<String>,
        network_seed: impl Into<String>,
    ) -> Self {
        Self {
            domain: domain.into(),
            uri: uri.into(),
            network_seed: network_seed.into(),
        }
    }
}

/// Server → client: the nonce + the fields the client must sign over. The client
/// fills in its own `did` and the TLS channel binding to rebuild the exact
/// message bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerHello {
    pub domain: String,
    pub uri: String,
    pub network: String,
    pub nonce: String,
    pub issued_at: String,
    pub expiration_time: String,
}

/// Client → server: the proven identity + signature over the rebuilt message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientAuth {
    pub did: String,
    pub signature: String,
}

/// Server → client: handshake outcome + the server's own DID (so the client can
/// register it as the peer it syncs through).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResult {
    pub ok: bool,
    pub error: Option<String>,
    pub server_did: Option<String>,
}

/// True if the hello's expiration time has passed (the server's nonce TTL gate).
pub fn is_expired(hello: &ServerHello) -> bool {
    match hello.expiration_time.parse::<u64>() {
        Ok(exp) => unix_now_secs() > exp,
        Err(_) => true,
    }
}

/// A fresh 32-byte random nonce, base64.
pub fn random_nonce_b64() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    B64.encode(bytes)
}

/// Seconds since the Unix epoch (string form for the message).
pub fn unix_now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Build the canonical signed message. Identical on both ends → identical bytes.
pub fn build_message(hello: &ServerHello, did: &str, channel_binding_b64: &str) -> String {
    format!(
        "{domain} wants you to sign in with your Aven Self identity.\n\
         \n\
         URI: {uri}\n\
         Network: {network}\n\
         DID: {did}\n\
         Nonce: {nonce}\n\
         Issued At: {issued}\n\
         Expiration Time: {exp}\n\
         Channel-Binding: {cb}",
        domain = hello.domain,
        uri = hello.uri,
        network = hello.network,
        did = did,
        nonce = hello.nonce,
        issued = hello.issued_at,
        exp = hello.expiration_time,
        cb = channel_binding_b64,
    )
}

/// Sign the message with the device root signing key.
pub fn sign(signing_key: &SigningKey, message: &str) -> String {
    let sig = signing_key.sign(message.as_bytes());
    B64.encode(sig.to_bytes())
}

/// Verify a signature over `message` against the DID's Ed25519 public key.
pub fn verify(pubkey: &[u8; 32], message: &str, signature_b64: &str) -> Result<(), String> {
    let vk = VerifyingKey::from_bytes(pubkey).map_err(|e| format!("bad pubkey: {e}"))?;
    let sig_bytes = B64
        .decode(signature_b64)
        .map_err(|e| format!("bad signature b64: {e}"))?;
    let sig_arr: [u8; 64] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "signature wrong length".to_string())?;
    let sig = Signature::from_bytes(&sig_arr);
    vk.verify(message.as_bytes(), &sig)
        .map_err(|e| format!("signature verify failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    fn hello() -> ServerHello {
        let now = unix_now_secs();
        ServerHello {
            domain: "aven.test".into(),
            uri: "https://aven.test".into(),
            network: "testnet".into(),
            nonce: random_nonce_b64(),
            issued_at: now.to_string(),
            expiration_time: (now + CHALLENGE_TTL_SECS).to_string(),
        }
    }

    #[test]
    fn sign_then_verify_roundtrips() {
        let sk = SigningKey::from_bytes(&[3u8; 32]);
        let did = groove::did_key::peer_did_from_ed25519(&sk.verifying_key().to_bytes()).unwrap();
        let h = hello();
        let cb = "cb-value";
        let msg = build_message(&h, &did, cb);
        let sig = sign(&sk, &msg);
        let pk = groove::did_key::ed25519_public_from_peer_did(&did).unwrap();
        assert!(verify(&pk, &msg, &sig).is_ok());
    }

    #[test]
    fn stale_hello_is_expired() {
        let mut h = hello();
        h.expiration_time = (unix_now_secs() - 1).to_string();
        assert!(is_expired(&h));
        let fresh = hello();
        assert!(!is_expired(&fresh));
    }

    #[test]
    fn wrong_channel_binding_fails() {
        let sk = SigningKey::from_bytes(&[3u8; 32]);
        let did = groove::did_key::peer_did_from_ed25519(&sk.verifying_key().to_bytes()).unwrap();
        let h = hello();
        let signed = build_message(&h, &did, "client-cb");
        let sig = sign(&sk, &signed);
        // Server rebuilds with a *different* channel binding (a relayed session).
        let server_view = build_message(&h, &did, "server-cb");
        let pk = groove::did_key::ed25519_public_from_peer_did(&did).unwrap();
        assert!(verify(&pk, &server_view, &sig).is_err());
    }
}

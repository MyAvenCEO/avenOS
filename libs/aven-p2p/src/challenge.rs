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
///
/// `client_nonce` is a fresh client-chosen nonce folded into the signed message. On the
/// wss path (TLS terminates at the proxy, so there is no real channel binding) it is the
/// value the server must echo back under its own signature in [`AuthResult::signature`],
/// giving the client a mutual handshake that an on-path relay cannot complete on both
/// sides. The raw-TLS path leaves it empty (its anti-relay is the TLS exporter binding).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientAuth {
    pub did: String,
    pub signature: String,
    #[serde(default)]
    pub client_nonce: String,
}

/// Server → client: handshake outcome + the server's own DID (so the client can
/// register it as the peer it syncs through).
///
/// `signature` is the server's attestation over `(client_nonce, server_nonce, client_did)`
/// (see [`server_attestation_message`]). The client verifies it against `server_did` and
/// the nonces it itself saw — so a relay that forwarded the backend's `ServerHello` cannot
/// also convince the client the connection terminates at the real backend. `Option` for
/// serde tolerance toward older peers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResult {
    pub ok: bool,
    pub error: Option<String>,
    pub server_did: Option<String>,
    #[serde(default)]
    pub signature: Option<String>,
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
///
/// `client_nonce` is folded in as a trailing line so the client proof is bound to a value
/// the client picked (used by the wss mutual handshake). The raw-TLS path passes `""`,
/// keeping its signed bytes stable and its anti-relay anchored on the `Channel-Binding:`
/// exporter line — both ends still derive identical bytes from the same empty value.
pub fn build_message(
    hello: &ServerHello,
    did: &str,
    channel_binding_b64: &str,
    client_nonce: &str,
) -> String {
    format!(
        "{domain} wants you to sign in with your Aven Self identity.\n\
         \n\
         URI: {uri}\n\
         Network: {network}\n\
         DID: {did}\n\
         Nonce: {nonce}\n\
         Issued At: {issued}\n\
         Expiration Time: {exp}\n\
         Channel-Binding: {cb}\n\
         Client-Nonce: {client_nonce}",
        domain = hello.domain,
        uri = hello.uri,
        network = hello.network,
        did = did,
        nonce = hello.nonce,
        issued = hello.issued_at,
        exp = hello.expiration_time,
        cb = channel_binding_b64,
        client_nonce = client_nonce,
    )
}

/// Canonical bytes the **server** signs (and the client verifies) to prove the connection
/// terminates at the real backend. Binds the client-chosen nonce, the server's hello nonce,
/// and the client DID. A relay between client and backend runs two distinct connections
/// with two distinct `(client_nonce, server_nonce)` pairs: to make the backend accept the
/// client proof it must forward the backend's `server_nonce` to the client, but then it
/// cannot forge the backend's signature over the client-side tuple — so it cannot complete
/// both sides of the handshake.
pub fn server_attestation_message(
    client_nonce: &str,
    server_nonce: &str,
    client_did: &str,
) -> String {
    format!(
        "aven-server-attestation:v1\n\
         Client-Nonce: {client_nonce}\n\
         Server-Nonce: {server_nonce}\n\
         Client-DID: {client_did}",
    )
}

/// Verify the server's attestation signature against the nonces the client itself saw.
pub fn verify_server_attestation(
    server_pubkey: &[u8; 32],
    client_nonce: &str,
    server_nonce: &str,
    client_did: &str,
    sig_b64: &str,
) -> Result<(), String> {
    let msg = server_attestation_message(client_nonce, server_nonce, client_did);
    verify(server_pubkey, &msg, sig_b64)
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
        let msg = build_message(&h, &did, cb, "");
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
        let signed = build_message(&h, &did, "client-cb", "");
        let sig = sign(&sk, &signed);
        // Server rebuilds with a *different* channel binding (a relayed session).
        let server_view = build_message(&h, &did, "server-cb", "");
        let pk = groove::did_key::ed25519_public_from_peer_did(&did).unwrap();
        assert!(verify(&pk, &server_view, &sig).is_err());
    }

    #[test]
    fn wss_relay_cannot_complete_mutual_handshake() {
        // Audit #21: on the wss path TLS terminates at the proxy, so a relay can forward the
        // backend's ServerHello to the victim and try to relay the victim's ClientAuth to the
        // backend. The mutual handshake must make that impossible on at least one side.
        let client_sk = SigningKey::from_bytes(&[3u8; 32]);
        let client_did =
            groove::did_key::peer_did_from_ed25519(&client_sk.verifying_key().to_bytes()).unwrap();
        let client_pk = groove::did_key::ed25519_public_from_peer_did(&client_did).unwrap();
        let server_sk = SigningKey::from_bytes(&[7u8; 32]);
        let server_did =
            groove::did_key::peer_did_from_ed25519(&server_sk.verifying_key().to_bytes()).unwrap();
        let server_pk = groove::did_key::ed25519_public_from_peer_did(&server_did).unwrap();

        // (a) The client signs its proof bound to the ServerHello nonce A it saw + its own
        //     client nonce. A relay cannot move that proof onto a backend connection whose
        //     server nonce is B: the backend rebuilds the message with nonce B and the
        //     signature fails.
        let mut hello_a = hello();
        hello_a.nonce = "server-nonce-A".into();
        let client_nonce = "client-nonce-1";
        let client_msg = build_message(&hello_a, &client_did, "", client_nonce);
        let client_sig = sign(&client_sk, &client_msg);
        // Backend connection has a different server nonce B.
        let mut hello_b = hello();
        hello_b.nonce = "server-nonce-B".into();
        let backend_view = build_message(&hello_b, &client_did, "", client_nonce);
        assert!(
            verify(&client_pk, &backend_view, &client_sig).is_err(),
            "client proof bound to server nonce A must not verify under server nonce B"
        );

        // (b) The server attests over (client_nonce, server_nonce, client_did). The client
        //     verifies against the nonces IT saw. A relay that substitutes either nonce
        //     (its backend-side tuple differs from the client-side tuple) cannot make the
        //     attestation verify — and cannot forge the server's signature over the
        //     client-side tuple.
        let att = server_attestation_message(client_nonce, "server-nonce-A", &client_did);
        let att_sig = sign(&server_sk, &att);
        // Honest case: client verifies with exactly what it saw → ok.
        assert!(
            verify_server_attestation(&server_pk, client_nonce, "server-nonce-A", &client_did, &att_sig)
                .is_ok(),
            "honest server attestation must verify"
        );
        // Substituted server nonce (relay forwarded a different backend nonce) → reject.
        assert!(
            verify_server_attestation(&server_pk, client_nonce, "server-nonce-B", &client_did, &att_sig)
                .is_err(),
            "attestation must fail when the server nonce is substituted"
        );
        // Substituted client nonce → reject.
        assert!(
            verify_server_attestation(&server_pk, "client-nonce-2", "server-nonce-A", &client_did, &att_sig)
                .is_err(),
            "attestation must fail when the client nonce is substituted"
        );
    }
}

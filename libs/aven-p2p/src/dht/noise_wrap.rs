//! NoiseWrap — IK-pattern handshake with typed payload encoding.
//!
//! Combines [`HandshakeIK`](super::noise::HandshakeIK) with [`NoisePayload`](super::hyperdht_messages::NoisePayload) encoding/decoding.
//!
//! Reference: `hyperdht/lib/noise-wrap.js`.

use super::crypto::NS_PEER_HANDSHAKE;
use super::hyperdht_messages::{
    decode_noise_payload_from_bytes, encode_noise_payload_to_bytes, NoisePayload,
};
use super::noise::{HandshakeIK, Keypair};

// ─── Error type ──────────────────────────────────────────────────────────────

/// Errors from the [`NoiseWrap`] handshake layer.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum NoiseWrapError {
    /// The underlying Noise IK handshake failed.
    #[error("noise handshake failed: {0}")]
    Noise(#[from] super::noise::NoiseError),

    /// Payload compact-encoding or decoding failed.
    #[error("payload encoding failed: {0}")]
    Encoding(#[from] super::compact_encoding::EncodingError),

    /// [`NoiseWrap::finalize`] was called before both messages were exchanged.
    #[error("handshake not yet complete")]
    NotComplete,
}

// ─── Result types ────────────────────────────────────────────────────────────

/// Final output after a completed NoiseWrap handshake.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct NoiseWrapResult {
    /// Whether this side initiated the handshake.
    pub is_initiator: bool,
    /// Remote peer's static Ed25519 public key.
    pub remote_public_key: [u8; 32],
    /// Full handshake transcript hash (64 bytes).
    pub handshake_hash: [u8; 64],
    /// Session key for outbound encrypted messages.
    pub tx: [u8; 32],
    /// Session key for inbound encrypted messages.
    pub rx: [u8; 32],
}

// ─── NoiseWrap ───────────────────────────────────────────────────────────────

/// Wraps a Noise IK handshake with [`NoisePayload`] encode/decode.
///
/// # Usage
///
/// ## Initiator
/// ```ignore
/// let mut nw = NoiseWrap::new_initiator(keypair, remote_pub);
/// let m1 = nw.send(&payload)?;
/// // → send m1 to remote via PEER_HANDSHAKE relay
/// let remote_payload = nw.recv(&m2_bytes)?;
/// let result = nw.finalize()?;
/// ```
///
/// ## Responder
/// ```ignore
/// let mut nw = NoiseWrap::new_responder(keypair);
/// let remote_payload = nw.recv(&m1_bytes)?;
/// let m2 = nw.send(&payload)?;
/// let result = nw.finalize()?;
/// ```
pub struct NoiseWrap {
    handshake: HandshakeIK,
    is_initiator: bool,
}

impl NoiseWrap {
    /// Create an initiator wrapping a Noise IK handshake.
    ///
    /// `remote_public_key` is the responder's static key (obtained via findPeer).
    pub fn new_initiator(keypair: Keypair, remote_public_key: [u8; 32]) -> Self {
        let handshake =
            HandshakeIK::new_initiator(keypair, remote_public_key, &*NS_PEER_HANDSHAKE);
        NoiseWrap {
            handshake,
            is_initiator: true,
        }
    }

    /// Create a responder wrapping a Noise IK handshake.
    pub fn new_responder(keypair: Keypair) -> Self {
        let handshake = HandshakeIK::new_responder(keypair, &*NS_PEER_HANDSHAKE);
        NoiseWrap {
            handshake,
            is_initiator: false,
        }
    }

    /// Encode a [`NoisePayload`] and send it as the next Noise IK message.
    ///
    /// Returns the raw handshake bytes to transmit.
    pub fn send(&mut self, payload: &NoisePayload) -> Result<Vec<u8>, NoiseWrapError> {
        let encoded = encode_noise_payload_to_bytes(payload)?;
        let message = self.handshake.send(&encoded)?;
        Ok(message)
    }

    /// Receive a raw Noise IK message and decode the embedded [`NoisePayload`].
    pub fn recv(&mut self, buf: &[u8]) -> Result<NoisePayload, NoiseWrapError> {
        let plaintext = self.handshake.recv(buf)?;
        let payload = decode_noise_payload_from_bytes(&plaintext)?;
        Ok(payload)
    }

    /// Finalise the handshake.
    ///
    /// Must be called after both `send` and `recv` have completed (in either
    /// order depending on role).
    pub fn finalize(self) -> Result<NoiseWrapResult, NoiseWrapError> {
        let hr = self.handshake.result().ok_or(NoiseWrapError::NotComplete)?;

        Ok(NoiseWrapResult {
            is_initiator: self.is_initiator,
            remote_public_key: hr.remote_public_key,
            handshake_hash: hr.handshake_hash,
            tx: hr.tx,
            rx: hr.rx,
        })
    }

    /// Whether the handshake is complete (both messages exchanged).
    pub fn complete(&self) -> bool {
        self.handshake.complete()
    }

    /// Remote static public key once the first IK message has been received (responder)
    /// or at construction (initiator).
    pub fn remote_static_key(&self) -> Option<[u8; 32]> {
        self.handshake.remote_static_key().copied()
    }

    /// Pre-set the ephemeral keypair (for deterministic testing only).
    pub fn set_ephemeral(&mut self, keypair: Keypair) {
        self.handshake.set_ephemeral(keypair);
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use super::hyperdht_messages::NoisePayload;
    use super::noise::{generate_keypair, keypair_from_seed};

    fn minimal_payload(firewall: u64) -> NoisePayload {
        NoisePayload {
            version: 1,
            error: 0,
            firewall,
            addresses4: vec![],
            addresses6: vec![],
            udx: None,
            secret_stream: None,
            relay_through: None,
            relay_addresses: None,
        }
    }

    #[test]
    fn roundtrip_initiator_responder() {
        let kp_init = generate_keypair();
        let kp_resp = generate_keypair();
        let init_pub = kp_init.public_key;
        let resp_pub = kp_resp.public_key;

        let mut init = NoiseWrap::new_initiator(kp_init, resp_pub);
        let mut resp = NoiseWrap::new_responder(kp_resp);

        let m1 = init.send(&minimal_payload(1)).unwrap();

        let recv_payload = resp.recv(&m1).unwrap();
        assert_eq!(recv_payload.firewall, 1);

        let m2 = resp.send(&minimal_payload(2)).unwrap();

        let recv_payload2 = init.recv(&m2).unwrap();
        assert_eq!(recv_payload2.firewall, 2);

        assert!(init.complete());
        assert!(resp.complete());

        let init_result = init.finalize().unwrap();
        let resp_result = resp.finalize().unwrap();

        assert_eq!(init_result.remote_public_key, resp_pub);
        assert_eq!(resp_result.remote_public_key, init_pub);
        assert!(init_result.is_initiator);
        assert!(!resp_result.is_initiator);

        assert_eq!(init_result.tx, resp_result.rx);
        assert_eq!(init_result.rx, resp_result.tx);

        assert_eq!(init_result.handshake_hash, resp_result.handshake_hash);
    }

    #[test]
    fn deterministic_handshake_hash() {
        let seed_init = [0x11u8; 32];
        let seed_resp = [0x22u8; 32];
        let seed_e_init = [0x33u8; 32];
        let seed_e_resp = [0x44u8; 32];

        let kp_init = keypair_from_seed(&seed_init);
        let kp_resp = keypair_from_seed(&seed_resp);

        let mut init = NoiseWrap::new_initiator(kp_init.clone(), kp_resp.public_key);
        let mut resp = NoiseWrap::new_responder(kp_resp.clone());

        init.set_ephemeral(keypair_from_seed(&seed_e_init));
        resp.set_ephemeral(keypair_from_seed(&seed_e_resp));

        let m1 = init.send(&minimal_payload(1)).unwrap();
        resp.recv(&m1).unwrap();
        let m2 = resp.send(&minimal_payload(2)).unwrap();
        init.recv(&m2).unwrap();

        let r1 = init.finalize().unwrap();

        // Repeat with same seeds
        let kp_init2 = keypair_from_seed(&seed_init);
        let kp_resp2 = keypair_from_seed(&seed_resp);

        let mut init2 = NoiseWrap::new_initiator(kp_init2, kp_resp2.public_key);
        let mut resp2 = NoiseWrap::new_responder(kp_resp2);

        init2.set_ephemeral(keypair_from_seed(&seed_e_init));
        resp2.set_ephemeral(keypair_from_seed(&seed_e_resp));

        let m1b = init2.send(&minimal_payload(1)).unwrap();
        resp2.recv(&m1b).unwrap();
        let m2b = resp2.send(&minimal_payload(2)).unwrap();
        init2.recv(&m2b).unwrap();

        let r2 = init2.finalize().unwrap();

        assert_eq!(r1.handshake_hash, r2.handshake_hash);
        assert_eq!(r1.tx, r2.tx);
        assert_eq!(r1.rx, r2.rx);
    }

    #[test]
    fn finalize_before_complete_errors() {
        let kp_init = generate_keypair();
        let kp_resp = generate_keypair();
        let init = NoiseWrap::new_initiator(kp_init, kp_resp.public_key);
        let err = init.finalize().unwrap_err();
        assert!(matches!(err, NoiseWrapError::NotComplete));
    }

    #[test]
    fn payload_with_all_fields_roundtrips() {
        use super::hyperdht_messages::{RelayThroughInfo, SecretStreamInfo, UdxInfo};
        use super::messages::Ipv4Peer;

        let kp_init = generate_keypair();
        let kp_resp = generate_keypair();

        let mut init = NoiseWrap::new_initiator(kp_init, kp_resp.public_key);
        let mut resp = NoiseWrap::new_responder(kp_resp);

        let rich_payload = NoisePayload {
            version: 1,
            error: 0,
            firewall: 2,
            addresses4: vec![Ipv4Peer {
                host: "192.168.1.100".to_string(),
                port: 9999,
            }],
            addresses6: vec![],
            udx: Some(UdxInfo {
                version: 1,
                reusable_socket: false,
                id: 7,
                seq: 0,
            }),
            secret_stream: Some(SecretStreamInfo { version: 1 }),
            relay_through: Some(RelayThroughInfo {
                version: 1,
                public_key: [0xBBu8; 32],
                token: [0xCCu8; 32],
            }),
            relay_addresses: None,
        };

        let m1 = init.send(&rich_payload).unwrap();
        let decoded = resp.recv(&m1).unwrap();

        assert_eq!(decoded.firewall, 2);
        assert_eq!(decoded.addresses4.len(), 1);
        assert_eq!(decoded.addresses4[0].port, 9999);
        assert_eq!(decoded.udx.as_ref().unwrap().id, 7);
        assert_eq!(decoded.secret_stream.as_ref().unwrap().version, 1);
        assert_eq!(decoded.relay_through.as_ref().unwrap().public_key, [0xBBu8; 32]);
    }

    #[test]
    fn different_keypairs_different_session_keys() {
        let kp_init = generate_keypair();

        let kp_resp_a = generate_keypair();
        let kp_resp_b = generate_keypair();

        // Handshake A
        let mut init_a = NoiseWrap::new_initiator(kp_init.clone(), kp_resp_a.public_key);
        let mut resp_a = NoiseWrap::new_responder(kp_resp_a);
        let m1a = init_a.send(&minimal_payload(1)).unwrap();
        resp_a.recv(&m1a).unwrap();
        let m2a = resp_a.send(&minimal_payload(1)).unwrap();
        init_a.recv(&m2a).unwrap();
        let ra = init_a.finalize().unwrap();

        // Handshake B (different responder)
        let kp_init2 = generate_keypair();
        let mut init_b = NoiseWrap::new_initiator(kp_init2, kp_resp_b.public_key);
        let mut resp_b = NoiseWrap::new_responder(kp_resp_b);
        let m1b = init_b.send(&minimal_payload(1)).unwrap();
        resp_b.recv(&m1b).unwrap();
        let m2b = resp_b.send(&minimal_payload(1)).unwrap();
        init_b.recv(&m2b).unwrap();
        let rb = init_b.finalize().unwrap();

        // Different responders → different handshake transcripts
        assert_ne!(ra.handshake_hash, rb.handshake_hash);
    }
}

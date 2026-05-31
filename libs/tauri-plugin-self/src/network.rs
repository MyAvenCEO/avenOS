//! Hardcoded Aven network identity for this build.

use std::sync::OnceLock;

use hkdf::Hkdf;
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::SecretKey;
use sha2::Sha256;

/// User-facing network id (also HKDF root `info` + salt for device root).
pub const NETWORK_SEED: &str = "ceo.aven/testnet/abagana";

/// Path segments under `<Documents>/.avenOS/`.
pub const NETWORK_PATH_SEGMENTS: &[&str] = &["ceo.aven", "testnet", "abagana"];

/// Default hosted relay for this network.
pub const RELAY_URL: &str = "relay.aven.ceo";

const NETWORK_ANCHOR_INFO: &[u8] = b"ceo.aven/network-anchor/v1";

static ANCHOR_PUB: OnceLock<Vec<u8>> = OnceLock::new();

/// Deterministic 65-byte SEC1 uncompressed P-256 point for ECDH (internal only).
pub fn network_anchor_pubkey() -> &'static [u8] {
	ANCHOR_PUB.get_or_init(|| {
		let hk = Hkdf::<Sha256>::new(Some(NETWORK_SEED.as_bytes()), &[]);
		let mut okm = [0u8; 32];
		hk.expand(NETWORK_ANCHOR_INFO, &mut okm)
			.expect("network anchor hkdf expand");

		let sk = SecretKey::from_bytes((&okm).into()).unwrap_or_else(|_| {
			let hk2 = Hkdf::<Sha256>::new(Some(&okm), NETWORK_SEED.as_bytes());
			let mut okm2 = [0u8; 32];
			hk2.expand(NETWORK_ANCHOR_INFO, &mut okm2)
				.expect("network anchor hkdf retry");
			SecretKey::from_bytes((&okm2).into()).expect("network anchor scalar")
		});

		sk.public_key()
			.to_encoded_point(false)
			.as_bytes()
			.to_vec()
	})
}

/// HKDF info for Ed25519 signing seed derived from device root.
pub fn ed25519_identity_info() -> String {
	format!("{NETWORK_SEED}/identity/ed25519/v1")
}

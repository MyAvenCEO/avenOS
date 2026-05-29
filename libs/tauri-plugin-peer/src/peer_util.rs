//! Shared helpers for the peer plugin (time, coarse mesh signals).

#![cfg(any(target_os = "macos", target_os = "ios"))]

use groove::sync_manager::ClientId;
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub fn now_ms() -> u64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as u64)
		.unwrap_or(0)
}

/// Stable Groove client id derived from a remote Noise static key (matches bridge).
pub fn client_id_from_pubkey(pubkey: &[u8; 32]) -> ClientId {
	let mut digest = Sha256::new();
	digest.update(b"ceo.aven.os/jazz/client-id-v1");
	digest.update(pubkey.as_slice());
	let hash16: [u8; 16] = digest.finalize()[..16]
		.try_into()
		.expect("sha256 truncation");
	ClientId(Uuid::from_bytes(hash16))
}

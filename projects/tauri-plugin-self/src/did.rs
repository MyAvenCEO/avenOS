//! `did:key:` identifiers for AvenOS peers (Secure Enclave P‑256 credential + HKDF-derived Ed25519).

use multibase::Base;

const DID_ED25519_PREFIX: &[u8] = &[0xed, 0x01];

/// multicodec `p256-pub` (`0x1200`), unsigned‑varint bytes (constant for our codec tag).
#[cfg(target_os = "macos")]
const P256_PUB_CODEC_VARINT: [u8; 2] = [0x80, 0x24];

/// `did:key` for an Ed25519 public key (HKDF-derived application signing DID).
#[must_use]
pub fn signing_did_ed25519(pub_raw32: &[u8; 32]) -> String {
	let mut buf = Vec::with_capacity(DID_ED25519_PREFIX.len() + 32);
	buf.extend_from_slice(DID_ED25519_PREFIX);
	buf.extend_from_slice(pub_raw32);
	let mb = multibase::encode(Base::Base58Btc, &buf);
	format!("did:key:{mb}")
}

/// `did:key` for the device's Secure‑Enclave P‑256 credential (SEC1 pubkey bytes from disk).
///
/// Codec: multicodec `p256-pub`; value is the **compressed** SEC1 pubkey.
#[cfg(target_os = "macos")]
pub fn device_did_from_sec1_public_key(pub_sec1: &[u8]) -> Result<String, String> {
	use p256::elliptic_curve::sec1::ToEncodedPoint;
	use p256::PublicKey;

	let pk =
		PublicKey::from_sec1_bytes(pub_sec1).map_err(|e| format!("p256_sec1_parse:{e:?}"))?;
	let compressed = pk.to_encoded_point(true);
	let compressed_bytes = compressed.as_bytes();

	let mut payload = Vec::with_capacity(P256_PUB_CODEC_VARINT.len() + compressed_bytes.len());
	payload.extend_from_slice(&P256_PUB_CODEC_VARINT);
	payload.extend_from_slice(compressed_bytes);
	let mb = multibase::encode(Base::Base58Btc, &payload);
	Ok(format!("did:key:{mb}"))
}

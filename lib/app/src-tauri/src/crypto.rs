//! Per-spark DEK envelopes — X25519 ECDH unwrap + HKDF-SHA256 + XChaCha20-Poly1305.

use base64::Engine;

use chacha20poly1305::aead::Aead;
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use curve25519_dalek::edwards::CompressedEdwardsY;
use ed25519_dalek::SigningKey;
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256, Sha512};
use x25519_dalek::{PublicKey as XPub, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop};

const KEYSHARE_INFO: &[u8] = b"ceo.aven.os/spark/keyshare/v1";
pub const CELL_ENVELOPE_V1: &str = "v1";

static BASE64_ENC: base64::engine::general_purpose::GeneralPurpose =
	base64::engine::general_purpose::URL_SAFE_NO_PAD;

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct Dek([u8; 32]);

impl Dek {
	#[must_use]
	pub fn expose(&self) -> &[u8; 32] {
		&self.0
	}

	#[must_use]
	pub fn from_plain_32(raw: [u8; 32]) -> Self {
		Self(raw)
	}
}

#[must_use]
pub fn random_spark_dek() -> Dek {
	let mut b = [0u8; 32];
	OsRng.fill_bytes(&mut b);
	Dek(b)
}

fn ed_secret_to_x25519_static(secret_key: &[u8; 32]) -> StaticSecret {
	let h = Sha512::digest(secret_key.as_slice());
	let mut out = [0u8; 32];
	out.copy_from_slice(&h[..32]);
	out[0] &= 248;
	out[31] &= 127;
	out[31] |= 64;
	StaticSecret::from(out)
}

#[must_use]
pub fn ed25519_pk_to_curve25519_pk(ed25519_pk: &[u8; 32]) -> Option<[u8; 32]> {
	let y = CompressedEdwardsY(*ed25519_pk);
	let pt = y.decompress()?;
	Some(pt.to_montgomery().to_bytes())
}

pub fn hkdf_kek(shared_secret: &[u8]) -> [u8; 32] {
	let hk = Hkdf::<Sha256>::new(Some(&[]), shared_secret);
	let mut okm = [0u8; 32];
	hk.expand(KEYSHARE_INFO, &mut okm).expect("hkdf-expand-32");
	okm
}

pub fn derive_kek_x25519(
	my_ed_sk: &SigningKey,
	peer_ed_pk: &[u8; 32],
) -> Result<[u8; 32], String> {
	let my_x25519 = ed_secret_to_x25519_static(my_ed_sk.as_bytes());
	let peer_montgomery =
		ed25519_pk_to_curve25519_pk(peer_ed_pk).ok_or_else(|| "ed25519_to_curve25519".to_string())?;
	let shared = my_x25519.diffie_hellman(&XPub::from(peer_montgomery));
	Ok(hkdf_kek(shared.as_bytes()))
}

pub fn encrypt_keyshare_payload(
	kek32: &[u8; 32],
	plaintext_dek32: &[u8; 32],
	aad: &[u8],
) -> Result<String, String> {
	let cipher =
		XChaCha20Poly1305::new_from_slice(kek32.as_slice()).map_err(|e| format!("kek:{e}"))?;
	let mut nonce = [0u8; 24];
	OsRng.fill_bytes(&mut nonce);
	let ct = cipher
		.encrypt(
			XNonce::from_slice(&nonce),
			chacha20poly1305::aead::Payload {
				msg: plaintext_dek32,
				aad,
			},
		)
		.map_err(|e| format!("wrap_dek:{e}"))?;

	let mut raw = Vec::with_capacity(24 + ct.len());
	raw.extend_from_slice(&nonce);
	raw.extend_from_slice(&ct);
	Ok(BASE64_ENC.encode(raw))
}

pub fn decrypt_keyshare_payload(
	enc_b64_url: &str,
	kek32: &[u8; 32],
	aad: &[u8],
) -> Result<[u8; 32], String> {
	let raw =
		BASE64_ENC.decode(enc_b64_url.as_bytes()).map_err(|e| format!("wrap_decode:{e}"))?;
	if raw.len() < 24 + 16 {
		return Err("wrap_short".into());
	}
	let (nonce, ct) = raw.split_at(24);
	let cipher =
		XChaCha20Poly1305::new_from_slice(kek32.as_slice()).map_err(|e| format!("kek:{e}"))?;
	let pt = cipher
		.decrypt(
			XNonce::from_slice(nonce),
			chacha20poly1305::aead::Payload {
				msg: ct,
				aad,
			},
		)
		.map_err(|_| "unwrap_fail".to_string())?;

	if pt.len() != 32 {
		return Err("unwrap_plain_len".into());
	}
	let mut o = [0u8; 32];
	o.copy_from_slice(&pt);
	Ok(o)
}

#[must_use]
pub fn seal_text_cell_payload(
	dek32: &[u8; 32],
	aad_plain: &[u8],
	pt_utf8: &str,
) -> Result<String, String> {
	let cipher =
		XChaCha20Poly1305::new_from_slice(dek32.as_slice()).map_err(|e| format!("dek_cipher:{e}"))?;
	let mut nonce = [0u8; 24];
	OsRng.fill_bytes(&mut nonce);
	let ct = cipher
		.encrypt(
			XNonce::from_slice(&nonce),
			chacha20poly1305::aead::Payload {
				msg: pt_utf8.as_bytes(),
				aad: aad_plain,
			},
		)
		.map_err(|e| format!("seal_fail:{e}"))?;

	let s = format!(
		"v1.{0}.{1}.{2}",
		BASE64_ENC.encode(nonce),
		BASE64_ENC.encode(aad_plain),
		BASE64_ENC.encode(ct)
	);
	Ok(s)
}

pub fn open_text_cell_payload(dek32: &[u8; 32], envelope: &str) -> Result<(String, u64), String> {
	let mut it = envelope.splitn(5, '.');
	let ver = it.next().ok_or_else(|| "env:ver".to_string())?;
	if ver != CELL_ENVELOPE_V1 {
		return Err("env:v1_expected".into());
	}
	let nb64 = it.next().ok_or_else(|| "env:nonce".to_string())?;
	let aad_b64 = it.next().ok_or_else(|| "env:aad".to_string())?;
	let ct_b64 = it.next().ok_or_else(|| "env:ct".to_string())?;
	if it.next().is_some() {
		return Err("env:extra_dots".into());
	}

	let nonce_raw = BASE64_ENC.decode(nb64.as_bytes()).map_err(|_| "nonce_b64".to_string())?;
	let aad_plain = BASE64_ENC.decode(aad_b64.as_bytes()).map_err(|_| "aad_b64".to_string())?;
	let ct_raw = BASE64_ENC.decode(ct_b64.as_bytes()).map_err(|_| "ct_b64".to_string())?;

	let nonce: [u8; 24] = nonce_raw.as_slice().try_into().map_err(|_| "nonce_len".to_string())?;

	let cipher =
		XChaCha20Poly1305::new_from_slice(dek32.as_slice()).map_err(|e| format!("dek:{e}"))?;
	let pt = cipher
		.decrypt(
			XNonce::from_slice(&nonce),
			chacha20poly1305::aead::Payload {
				msg: ct_raw.as_slice(),
				aad: &aad_plain,
			},
		)
		.map_err(|_| "open_fail".to_string())?;

	let s =
		std::str::from_utf8(&pt).map_err(|_| "cell_utf8".to_string())?.to_string();

	let dek_ver_line = dek_version_from_aad_bytes(&aad_plain)?;
	Ok((s, dek_ver_line))
}

#[must_use]
pub fn dek_version_from_aad_bytes(aad_plain: &[u8]) -> Result<u64, String> {
	let s =
		std::str::from_utf8(aad_plain).map_err(|_| "aad_utf8".to_string())?;
	let last = s.split('|').next_back().ok_or_else(|| "aad_pipe".to_string())?;
	last
		.parse::<u64>()
		.map_err(|_| format!("aad_dek_version:{last}"))
}

#[must_use]
pub fn keyshare_wrap_aad(spark_urn: &str, recipient_did: &str, dek_version: i64) -> Vec<u8> {
	format!("keyshare|{spark_urn}|{recipient_did}|{dek_version}").into_bytes()
}

#[cfg(test)]
mod tests {
	use super::{open_text_cell_payload, random_spark_dek, seal_text_cell_payload};

	#[test]
	fn envelope_roundtrip() {
		let dek = random_spark_dek();
		let spark = uuid::Uuid::nil();
		let row = uuid::Uuid::nil();
		let spark_urn = format!("spark:{spark}");
		let aad_plain = format!("{spark_urn}|todos|title|{row}|1").into_bytes();

		let enc = seal_text_cell_payload(dek.expose(), &aad_plain, "hello").unwrap();
		let (out, dv) = open_text_cell_payload(dek.expose(), &enc).unwrap();
		assert_eq!(out, "hello");
		assert_eq!(dv, 1u64);
	}
}

//! Per-spark DEK envelopes — X25519 ECDH unwrap + HKDF-SHA256 + XChaCha20-Poly1305.

use base64::Engine;

use chacha20poly1305::aead::Aead;
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use curve25519_dalek::edwards::CompressedEdwardsY;
use ed25519_dalek::SigningKey;
use groove::query_manager::types::ColumnType;
use groove::{ObjectId, Value};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use serde_json::{json, Number, Value as JsonValue};
use sha2::{Digest, Sha256, Sha512};
use x25519_dalek::{PublicKey as XPub, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop};

const KEYSHARE_INFO: &[u8] = b"ceo.aven.os/spark/keyshare/v1";
pub const CELL_ENVELOPE_V1: &str = "v1";
pub const CELL_CANON_SCHEMA_V: u64 = 2;
pub const CELL_PAYLOAD_MSV: u32 = 2;

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
pub fn column_type_slug(ty: &ColumnType) -> &'static str {
	match ty {
		ColumnType::Text => "text",
		ColumnType::Boolean => "boolean",
		ColumnType::Integer => "integer",
		ColumnType::BigInt => "bigint",
		ColumnType::Timestamp => "timestamp",
		ColumnType::Uuid => "uuid",
		ColumnType::Array(_) => "array",
		ColumnType::Row(_) => "row",
	}
}

#[must_use]
pub fn cell_seal_aad(
	spark_urn: &str,
	table: &str,
	column: &str,
	row: uuid::Uuid,
	dek_version_line: i64,
	storage_ty_slug: &str,
) -> Vec<u8> {
	format!(
		"{spark_urn}|{table}|{column}|{row}|{dek_version_line}|ty:{storage_ty_slug}|msv:{}",
		CELL_PAYLOAD_MSV
	)
	.into_bytes()
}

pub fn groove_value_to_canonical_utf8(val: &Value) -> Result<String, String> {
	let j = match val {
		Value::Null => json!({"schema_v": CELL_CANON_SCHEMA_V, "t": "null"}),
		Value::Text(s) => json!({"schema_v": CELL_CANON_SCHEMA_V, "t": "text", "v": s}),
		Value::Boolean(b) => json!({"schema_v": CELL_CANON_SCHEMA_V, "t": "boolean", "v": *b}),
		Value::Integer(i) => json!({"schema_v": CELL_CANON_SCHEMA_V, "t": "integer", "v": *i}),
		Value::BigInt(i) => json!({"schema_v": CELL_CANON_SCHEMA_V, "t": "bigint", "v": *i}),
		Value::Timestamp(ts) => json!({"schema_v": CELL_CANON_SCHEMA_V, "t": "timestamp", "v": *ts}),
		Value::Uuid(oid) => {
			json!({"schema_v": CELL_CANON_SCHEMA_V, "t": "uuid", "v": oid.uuid().to_string()})
		}
		Value::Array(_) | Value::Row(_) => return Err("canon_nested_unsupported".into()),
	};
	Ok(j.to_string())
}

fn canonical_json_to_grove(j: &JsonValue) -> Result<Value, String> {
	let t = j
		.get("t")
		.and_then(JsonValue::as_str)
		.ok_or_else(|| "canon_t".to_string())?;
	Ok(match t {
		"null" => Value::Null,
		"text" => Value::Text(
			j.get("v")
				.and_then(JsonValue::as_str)
				.ok_or_else(|| "canon_v_text".to_string())?
				.to_string(),
		),
		"boolean" => Value::Boolean(
			j.get("v")
				.and_then(JsonValue::as_bool)
				.ok_or_else(|| "canon_v_bool".to_string())?,
		),
		"integer" => Value::Integer(
			j.get("v")
				.and_then(JsonValue::as_i64)
				.and_then(|v| i32::try_from(v).ok())
				.ok_or_else(|| "canon_v_i32".to_string())?,
		),
		"bigint" => {
			Value::BigInt(
				j.get("v")
					.and_then(JsonValue::as_i64)
					.ok_or_else(|| "canon_v_i64".to_string())?,
			)
		}
		"timestamp" => {
			Value::Timestamp(
				j.get("v")
					.and_then(JsonValue::as_u64)
					.ok_or_else(|| "canon_v_ts".to_string())?,
			)
		}
		"uuid" => {
			let s = j
				.get("v")
				.and_then(JsonValue::as_str)
				.ok_or_else(|| "canon_v_uuid_str".to_string())?;
			let u = uuid::Uuid::parse_str(s).map_err(|_| "canon_uuid".to_string())?;
			Value::Uuid(ObjectId::from_uuid(u))
		}
		_ => return Err(format!("canon_tag:{t}")),
	})
}

fn groove_value_to_ipc_json(cell: &Value) -> JsonValue {
	match cell {
		Value::Integer(i) => JsonValue::Number(Number::from(*i)),
		Value::BigInt(i) => JsonValue::Number(Number::from(*i)),
		Value::Boolean(b) => JsonValue::Bool(*b),
		Value::Text(s) => JsonValue::String(s.clone()),
		Value::Timestamp(ts) => JsonValue::Number(Number::from(*ts)),
		Value::Uuid(oid) => JsonValue::String(oid.uuid().to_string()),
		Value::Null => JsonValue::Null,
		Value::Array(items) => JsonValue::Array(items.iter().map(groove_value_to_ipc_json).collect()),
		Value::Row(items) => JsonValue::Array(items.iter().map(groove_value_to_ipc_json).collect()),
	}
}

fn legacy_plain_to_ipc(opened_plain: &str, storage_ty: &ColumnType) -> Result<JsonValue, String> {
	match storage_ty {
		ColumnType::Text => Ok(JsonValue::String(opened_plain.into())),
		ColumnType::Boolean => match opened_plain.trim() {
			"true" => Ok(JsonValue::Bool(true)),
			"false" => Ok(JsonValue::Bool(false)),
			other => Err(format!("legacy_boolean:{other}")),
		},
		ColumnType::Integer => {
			let n: i32 = opened_plain
				.trim()
				.parse()
				.map_err(|_| "legacy_i32".to_string())?;
			Ok(JsonValue::Number(Number::from(n)))
		}
		ColumnType::BigInt => {
			let n: i64 = opened_plain
				.trim()
				.parse()
				.map_err(|_| "legacy_i64".to_string())?;
			Ok(JsonValue::Number(Number::from(n)))
		}
		ColumnType::Timestamp => {
			let n: u64 = opened_plain
				.trim()
				.parse()
				.map_err(|_| "legacy_ts".to_string())?;
			Ok(JsonValue::Number(Number::from(n)))
		}
		ColumnType::Uuid => {
			let u = uuid::Uuid::parse_str(opened_plain.trim()).map_err(|_| "legacy_uuid".to_string())?;
			Ok(JsonValue::String(u.to_string()))
		}
		ColumnType::Array(_) | ColumnType::Row(_) => Err("legacy_nested".into()),
	}
}

/// Interprets post-decrypt plaintext: typed canonical JSON preferred, UTF-8 legacy fallback for migration.
pub fn ipc_json_from_opened_sensitive_plaintext(
	opened_plain: &str,
	storage_ty: &ColumnType,
) -> Result<JsonValue, String> {
	if let Ok(v) = serde_json::from_str::<JsonValue>(opened_plain) {
		if v.get("schema_v").and_then(JsonValue::as_u64) == Some(CELL_CANON_SCHEMA_V) {
			let gv = canonical_json_to_grove(&v)?;
			return Ok(groove_value_to_ipc_json(&gv));
		}
	}
	legacy_plain_to_ipc(opened_plain, storage_ty)
}

#[must_use]
pub fn dek_version_from_aad_bytes(aad_plain: &[u8]) -> Result<u64, String> {
	let s = std::str::from_utf8(aad_plain).map_err(|_| "aad_utf8".to_string())?;
	let parts: Vec<&str> = s.split('|').collect();
	let seg = parts
		.get(4)
		.ok_or_else(|| "aad_segments".to_string())?;
	seg.parse::<u64>()
		.map_err(|_| format!("aad_dek_version:{seg}"))
}

#[must_use]
pub fn keyshare_wrap_aad(spark_urn: &str, recipient_did: &str, dek_version: i64) -> Vec<u8> {
	format!("keyshare|{spark_urn}|{recipient_did}|{dek_version}").into_bytes()
}

#[cfg(test)]
mod tests {
	use super::{
		column_type_slug, decrypt_keyshare_payload, dek_version_from_aad_bytes,
		derive_kek_x25519, encrypt_keyshare_payload, groove_value_to_canonical_utf8,
		ipc_json_from_opened_sensitive_plaintext, keyshare_wrap_aad, open_text_cell_payload,
		random_spark_dek, seal_text_cell_payload, cell_seal_aad, ColumnType, Value,
	};
	use ed25519_dalek::SigningKey;

	#[test]
	fn delegated_keyshare_wrap_unwrap() {
		let granter = SigningKey::from_bytes(&[7u8; 32]);
		let recipient = SigningKey::from_bytes(&[9u8; 32]);
		let granter_pk = granter.verifying_key().to_bytes();
		let recipient_pk = recipient.verifying_key().to_bytes();

		let spark_id = uuid::Uuid::new_v4();
		let urn = format!("spark:{spark_id}");
		let recipient_did = "did:key:zRecipient";
		let dek_ver = 1i64;
		let dek_plain = random_spark_dek();

		let kek_wrap = derive_kek_x25519(&granter, &recipient_pk).unwrap();
		let aad = keyshare_wrap_aad(&urn, recipient_did, dek_ver);
		let wrapped =
			encrypt_keyshare_payload(&kek_wrap, dek_plain.expose(), &aad).unwrap();

		let kek_unwrap = derive_kek_x25519(&recipient, &granter_pk).unwrap();
		let opened = decrypt_keyshare_payload(&wrapped, &kek_unwrap, &aad).unwrap();
		assert_eq!(opened, *dek_plain.expose());
	}

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
		assert_eq!(dek_version_from_aad_bytes(&aad_plain).unwrap(), 1);
	}

	#[test]
	fn envelope_roundtrip_extended_aad() {
		let dek = random_spark_dek();
		let spark = uuid::Uuid::nil();
		let row = uuid::Uuid::nil();
		let spark_urn = format!("spark:{spark}");
		let aad_plain = cell_seal_aad(&spark_urn, "todos", "done", row, 2, column_type_slug(&ColumnType::Text));
		assert_eq!(
			dek_version_from_aad_bytes(&aad_plain).unwrap(),
			2u64
		);

		let canon =
			groove_value_to_canonical_utf8(&Value::Boolean(true)).unwrap();

		let enc = seal_text_cell_payload(dek.expose(), &aad_plain, &canon).unwrap();
		let (out, dv) = open_text_cell_payload(dek.expose(), &enc).unwrap();
		let j =
			ipc_json_from_opened_sensitive_plaintext(&out, &ColumnType::Text).unwrap();
		assert_eq!(j, serde_json::json!(true));
		assert_eq!(dv, 2u64);
	}
}

//! Per-identity DEK envelopes — X25519 ECDH unwrap + HKDF-SHA256 + XChaCha20-Poly1305.

use base64::Engine;

use chacha20poly1305::aead::Aead;
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use curve25519_dalek::edwards::CompressedEdwardsY;
use ed25519_dalek::SigningKey;
use aven_db::query_manager::types::ColumnType;
use aven_db::{ObjectId, Value};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use serde_json::{json, Number, Value as JsonValue};
use sha2::{Digest, Sha256, Sha512};
use x25519_dalek::{PublicKey as XPub, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop};

const KEYSHARE_INFO: &[u8] = b"ceo.aven.os/identity/keyshare/v1";
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
pub fn random_identity_dek() -> Dek {
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
	// Reject low-order / small-subgroup peer keys. A non-contributory exchange yields the
	// all-zero X25519 output, which would make the KEK independent of our secret — fail
	// closed rather than derive a predictable key from a crafted peer point.
	if !shared.was_contributory() {
		return Err("kek_non_contributory_peer_key".to_string());
	}
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

/// M9 group key — a 32-byte symmetric key forming the **2-level key hierarchy**. A group's
/// value DEKs are wrapped UNDER its group key; the group key is wrapped once to each member
/// AND to the group's PARENT group key. So a parent member, holding only the parent group
/// key, unwraps the child group key, then any value DEK beneath it — inheriting the whole
/// subtree with no per-value seal. A per-row group therefore costs ONE seal (to its parent),
/// not N (one per member). Built on the same AEAD envelope as the keyshare wrap.
pub type GroupKey = [u8; 32];

#[must_use]
pub fn random_group_key() -> GroupKey {
	let mut b = [0u8; 32];
	OsRng.fill_bytes(&mut b);
	b
}

/// Wrap a 32-byte secret (a value DEK, or a child group key) under `group_key`.
pub fn wrap_under_group_key(group_key: &GroupKey, inner32: &[u8; 32], aad: &[u8]) -> Result<String, String> {
	encrypt_keyshare_payload(group_key, inner32, aad)
}

/// Unwrap a secret previously wrapped with [`wrap_under_group_key`].
pub fn unwrap_under_group_key(group_key: &GroupKey, wrapped: &str, aad: &[u8]) -> Result<[u8; 32], String> {
	decrypt_keyshare_payload(wrapped, group_key, aad)
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

	// Wire layout `v1.{nonce}.{ct}` — the AAD is NOT stored. It is fully reconstructible
	// from the cell's coordinates (identity|table|column|row|dek_version|ty|msv), and it is
	// the very value an attacker controls if it rides on the wire. The reader recomputes the
	// expected AAD for the slot it is decoding and authenticates against THAT (see
	// `open_text_cell_payload`), so a relocated/rolled-back envelope fails the AEAD tag.
	let s = format!(
		"v1.{0}.{1}",
		BASE64_ENC.encode(nonce),
		BASE64_ENC.encode(ct)
	);
	Ok(s)
}

/// Open a sealed cell, authenticating the ciphertext against the caller-supplied
/// `expected_aad` — the `cell_seal_aad` the *reader* recomputes for the exact
/// (identity, table, column, row, dek_version, type) slot it is decoding. The AEAD tag was
/// computed over the AAD at seal time, so decryption succeeds ONLY when `expected_aad`
/// equals it: a relay that relocated the envelope to a different cell (or replayed an
/// old-version one) supplies coordinates that don't match and the open fails. The recovered
/// `dek_version` is read from `expected_aad`.
pub fn open_text_cell_payload(
	dek32: &[u8; 32],
	envelope: &str,
	expected_aad: &[u8],
) -> Result<(String, u64), String> {
	let mut it = envelope.splitn(4, '.');
	let ver = it.next().ok_or_else(|| "env:ver".to_string())?;
	if ver != CELL_ENVELOPE_V1 {
		return Err("env:v1_expected".into());
	}
	let nb64 = it.next().ok_or_else(|| "env:nonce".to_string())?;
	let ct_b64 = it.next().ok_or_else(|| "env:ct".to_string())?;
	if it.next().is_some() {
		return Err("env:extra_dots".into());
	}

	let nonce_raw = BASE64_ENC.decode(nb64.as_bytes()).map_err(|_| "nonce_b64".to_string())?;
	let ct_raw = BASE64_ENC.decode(ct_b64.as_bytes()).map_err(|_| "ct_b64".to_string())?;

	let nonce: [u8; 24] = nonce_raw.as_slice().try_into().map_err(|_| "nonce_len".to_string())?;

	let cipher =
		XChaCha20Poly1305::new_from_slice(dek32.as_slice()).map_err(|e| format!("dek:{e}"))?;
	let pt = cipher
		.decrypt(
			XNonce::from_slice(&nonce),
			chacha20poly1305::aead::Payload {
				msg: ct_raw.as_slice(),
				aad: expected_aad,
			},
		)
		.map_err(|_| "open_fail".to_string())?;

	let s =
		std::str::from_utf8(&pt).map_err(|_| "cell_utf8".to_string())?.to_string();

	let dek_ver_line = dek_version_from_aad_bytes(expected_aad)?;
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
		ColumnType::Double => "double",
		ColumnType::Enum { .. } => "enum",
		ColumnType::BatchId => "batch_id",
		ColumnType::Bytea => "bytea",
		ColumnType::Json { .. } => "json",
		ColumnType::Array { .. } => "array",
		ColumnType::Row { .. } => "row",
		ColumnType::Vector { .. } => "vector",
	}
}

#[must_use]
pub fn cell_seal_aad(
	identity_urn: &str,
	table: &str,
	column: &str,
	row: uuid::Uuid,
	dek_version_line: i64,
	storage_ty_slug: &str,
) -> Vec<u8> {
	format!(
		"{identity_urn}|{table}|{column}|{row}|{dek_version_line}|ty:{storage_ty_slug}|msv:{}",
		CELL_PAYLOAD_MSV
	)
	.into_bytes()
}

pub fn avendb_value_to_canonical_utf8(val: &Value) -> Result<String, String> {
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
		Value::Double(d) => {
			let n = Number::from_f64(*d).ok_or_else(|| "canon_f64".to_string())?;
			json!({"schema_v": CELL_CANON_SCHEMA_V, "t": "double", "v": n})
		}
		Value::BatchId(id) => {
			json!({"schema_v": CELL_CANON_SCHEMA_V, "t": "batch_id", "v": hex::encode(id)})
		}
		Value::Bytea(b) => {
			json!({"schema_v": CELL_CANON_SCHEMA_V, "t": "bytea", "v": BASE64_ENC.encode(b)})
		}
		Value::Array(_) | Value::Row { .. } | Value::Vector(_) => {
			return Err("canon_nested_unsupported".into())
		}
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
		"double" => {
			let n = j
				.get("v")
				.and_then(JsonValue::as_f64)
				.ok_or_else(|| "canon_v_f64".to_string())?;
			Value::Double(n)
		}
		"batch_id" => {
			let s = j
				.get("v")
				.and_then(JsonValue::as_str)
				.ok_or_else(|| "canon_v_batch_id".to_string())?;
			let raw = hex::decode(s).map_err(|_| "canon_batch_id_hex".to_string())?;
			let id: [u8; 16] = raw
				.try_into()
				.map_err(|_| "canon_batch_id_len".to_string())?;
			Value::BatchId(id)
		}
		"bytea" => {
			let s = j
				.get("v")
				.and_then(JsonValue::as_str)
				.ok_or_else(|| "canon_v_bytea".to_string())?;
			let b = BASE64_ENC
				.decode(s)
				.map_err(|_| "canon_bytea_b64".to_string())?;
			Value::Bytea(b)
		}
		_ => return Err(format!("canon_tag:{t}")),
	})
}

fn avendb_value_to_ipc_json(cell: &Value) -> JsonValue {
	match cell {
		Value::Integer(i) => JsonValue::Number(Number::from(*i)),
		Value::BigInt(i) => JsonValue::Number(Number::from(*i)),
		Value::Boolean(b) => JsonValue::Bool(*b),
		Value::Text(s) => JsonValue::String(s.clone()),
		Value::Timestamp(ts) => JsonValue::Number(Number::from(*ts)),
		Value::Uuid(oid) => JsonValue::String(oid.uuid().to_string()),
		Value::Null => JsonValue::Null,
		Value::Array(items) => JsonValue::Array(items.iter().map(avendb_value_to_ipc_json).collect()),
		Value::Row { values: items, .. } => {
			JsonValue::Array(items.iter().map(avendb_value_to_ipc_json).collect())
		}
		Value::Double(d) => JsonValue::Number(
			Number::from_f64(*d).unwrap_or_else(|| Number::from(0)),
		),
		Value::BatchId(id) => JsonValue::String(hex::encode(id)),
		Value::Bytea(b) => JsonValue::String(
			base64::engine::general_purpose::STANDARD.encode(b),
		),
		Value::Vector(v) => JsonValue::Array(
			v.iter()
				.map(|f| {
					Number::from_f64(*f as f64)
						.map(JsonValue::Number)
						.unwrap_or(JsonValue::Null)
				})
				.collect(),
		),
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
		ColumnType::Enum { .. } => Ok(JsonValue::String(opened_plain.into())),
		ColumnType::Double => {
			let n: f64 = opened_plain
				.trim()
				.parse()
				.map_err(|_| "legacy_f64".to_string())?;
			Ok(JsonValue::Number(
				Number::from_f64(n).ok_or_else(|| "legacy_f64_nan".to_string())?,
			))
		}
		ColumnType::BatchId => Ok(JsonValue::String(opened_plain.trim().to_string())),
		ColumnType::Bytea => Ok(JsonValue::String(opened_plain.into())),
		ColumnType::Json { .. } => serde_json::from_str(opened_plain).map_err(|_| "legacy_json".to_string()),
		ColumnType::Array { .. } | ColumnType::Row { .. } | ColumnType::Vector { .. } => {
			Err("legacy_nested".into())
		}
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
			return Ok(avendb_value_to_ipc_json(&gv));
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

/// AAD binding a keyshare envelope to its (identity, recipient, **wrapper**, version).
/// Binding `wrapper_did` pins the granter the unwrap derives its KEK from, closing a
/// wrapper-confusion gap. The single keyshare AAD form — no legacy/downgrade variant.
#[must_use]
pub fn keyshare_wrap_aad(
	identity_urn: &str,
	recipient_did: &str,
	wrapper_did: &str,
	dek_version: i64,
) -> Vec<u8> {
	format!("keyshare|{identity_urn}|{recipient_did}|{wrapper_did}|{dek_version}").into_bytes()
}

#[cfg(test)]
mod tests {
	use super::{
		column_type_slug, decrypt_keyshare_payload, dek_version_from_aad_bytes,
		derive_kek_x25519, encrypt_keyshare_payload, avendb_value_to_canonical_utf8,
		ipc_json_from_opened_sensitive_plaintext, keyshare_wrap_aad, open_text_cell_payload,
		random_group_key, random_identity_dek, seal_text_cell_payload, cell_seal_aad,
		unwrap_under_group_key, wrap_under_group_key, ColumnType, Value,
	};
	use ed25519_dalek::SigningKey;

	#[test]
	fn derive_kek_rejects_low_order_shared_secret() {
		// Audit #1: a peer Ed25519 key that is a small-order point forces an all-zero
		// (non-contributory) X25519 output, which would make the KEK independent of our
		// secret — a constant the attacker can compute offline. `derive_kek_x25519` must
		// reject such a peer key instead of deriving a predictable KEK. The guard is the
		// `was_contributory()` check (the all-zero shared secret is the canonical witness of
		// every small-order peer point under RFC 7748).
		let me = SigningKey::from_bytes(&[5u8; 32]);

		// `[0u8; 32]` is a well-known small-order Ed25519 point encoding (it appears on
		// libsodium's low-order blocklist). It must NOT yield a usable KEK.
		assert!(
			derive_kek_x25519(&me, &[0u8; 32]).is_err(),
			"a small-order peer key must not yield a usable KEK"
		);

		// Positive control: a normal high-order peer key still derives a KEK, so the guard
		// rejects only the attack and does not break legitimate key agreement.
		let good_peer = SigningKey::from_bytes(&[9u8; 32]).verifying_key().to_bytes();
		assert!(
			derive_kek_x25519(&me, &good_peer).is_ok(),
			"a normal peer key must still derive a KEK"
		);
	}

	#[test]
	fn genesis_issuer_root_downgrade_and_swap_rejected() {
		// Audit #31. genesis_b64 / issuer_pubkey_b64 are SEALED biscuit-trust-root inputs.
		// This proves the crypto primitives the hydrate path relies on:
		//  (a) a cleartext-downgraded (non-`v1`) value is rejected by the opener — the app's
		//      `require_sealed` refusal at the genesis/issuer reads is built on this; and
		//  (c) a cross-cell swap into the genesis/issuer coordinate fails AEAD authentication,
		//      because the reader recomputes the expected coordinate AAD (board 0011).
		// (b) Pinning the issuer to the identity UUID is deferred: a relay can no longer forge
		//      or tamper these cells (board 0010 signs the row, 0011 binds the coordinate), so
		//      the residual is issuer-immutability — see the board card.
		let dek = random_identity_dek();
		let identity = uuid::Uuid::nil();
		let row = uuid::Uuid::nil();
		let urn = format!("identity:{identity}");
		let slug = column_type_slug(&ColumnType::Text);

		// A legitimate, sealed genesis cell at its coordinate opens honestly.
		let genesis_aad = cell_seal_aad(&urn, "identities", "genesis_b64", row, 1, slug);
		let env = seal_text_cell_payload(dek.expose(), &genesis_aad, "GENESIS-CHAIN-B64").unwrap();
		assert_eq!(
			open_text_cell_payload(dek.expose(), &env, &genesis_aad).unwrap().0,
			"GENESIS-CHAIN-B64"
		);

		// (a) Cleartext downgrade: a stripped / non-`v1` value is refused by the opener
		//     (what the app's require_sealed=true at the genesis/issuer reads enforces).
		assert!(
			open_text_cell_payload(dek.expose(), "attacker-plaintext-root", &genesis_aad).is_err(),
			"a non-v1 (envelope-stripped) trust-root value must be refused"
		);

		// (c) Cross-cell swap: an envelope sealed for the issuer coordinate must NOT open at
		//     the genesis coordinate (or vice versa), even under the same identity DEK.
		let issuer_aad = cell_seal_aad(&urn, "identities", "issuer_pubkey_b64", row, 1, slug);
		let issuer_env = seal_text_cell_payload(dek.expose(), &issuer_aad, "ISSUER-PK").unwrap();
		assert!(
			open_text_cell_payload(dek.expose(), &issuer_env, &genesis_aad).is_err(),
			"an issuer-coordinate envelope must not open at the genesis coordinate"
		);
		assert!(
			open_text_cell_payload(dek.expose(), &env, &issuer_aad).is_err(),
			"a genesis-coordinate envelope must not open at the issuer coordinate"
		);
	}

	#[test]
	fn profile_seal_registry_dek_separation() {
		// Board 0049: a SEALED `profile` row lives in the avenCEO REGISTRY sub-group and is sealed
		// under that sub-group's OWN dek (distinct from the avenCEO content dek). This proves the
		// two-key separation that backs TIER-0: a member holding ONLY the registry dek opens the
		// directory, while the avenCEO content dek (held by full members) cannot — and a blind relay
		// holding NEITHER decrypts nothing.
		let registry_dek = random_identity_dek();
		let avenceo_content_dek = random_identity_dek();
		let registry = uuid::Uuid::from_u128(0x5e9_15418);
		let urn = format!("safe:{registry}");
		let row = uuid::Uuid::from_u128(0x0f11e); // any profile row
		let slug = column_type_slug(&ColumnType::Text);

		// Seal a profile cell under the REGISTRY dek at its sub-group coordinate.
		let aad = cell_seal_aad(&urn, "profile", "display_name", row, 1, slug);
		let env = seal_text_cell_payload(registry_dek.expose(), &aad, "Abagana").unwrap();

		// The registry dek (the TIER-0 grant) opens the directory cell.
		assert_eq!(
			open_text_cell_payload(registry_dek.expose(), &env, &aad).unwrap().0,
			"Abagana"
		);
		// The avenCEO CONTENT dek must NOT open a registry-sealed profile — distinct key domains.
		assert!(
			open_text_cell_payload(avenceo_content_dek.expose(), &env, &aad).is_err(),
			"the avenCEO content dek must not open a registry-sub-group-sealed profile cell"
		);
	}

	#[test]
	fn group_key_two_level_inheritance() {
		// The 2-level hierarchy that makes per-row groups affordable:
		// parent group key -> child group key -> a value DEK.
		let parent_gk = random_group_key();
		let child_gk = random_group_key();
		let value_dek = random_identity_dek();
		let aad = b"m9-group-key";

		// Wrap downward: the child group key under the parent; the value DEK under the child.
		let child_wrapped = wrap_under_group_key(&parent_gk, &child_gk, aad).unwrap();
		let dek_wrapped = wrap_under_group_key(&child_gk, value_dek.expose(), aad).unwrap();

		// A PARENT member holds ONLY `parent_gk` and walks the chain to the value DEK —
		// inheriting the whole subtree with no per-value seal.
		let child_recovered = unwrap_under_group_key(&parent_gk, &child_wrapped, aad).unwrap();
		assert_eq!(child_recovered, child_gk, "parent key -> child group key");
		let dek_recovered = unwrap_under_group_key(&child_recovered, &dek_wrapped, aad).unwrap();
		assert_eq!(dek_recovered, *value_dek.expose(), "child key -> value DEK (inherited)");

		// A NON-member (a different key) cannot even start the chain.
		let outsider = random_group_key();
		assert!(unwrap_under_group_key(&outsider, &child_wrapped, aad).is_err());
	}

	#[test]
	fn delegated_keyshare_wrap_unwrap() {
		let granter = SigningKey::from_bytes(&[7u8; 32]);
		let recipient = SigningKey::from_bytes(&[9u8; 32]);
		let granter_pk = granter.verifying_key().to_bytes();
		let recipient_pk = recipient.verifying_key().to_bytes();

		let owner = uuid::Uuid::new_v4();
		let urn = format!("safe:{owner}");
		let recipient_did = "did:key:zRecipient";
		let granter_did = "did:key:zGranter";
		let dek_ver = 1i64;
		let dek_plain = random_identity_dek();

		let kek_wrap = derive_kek_x25519(&granter, &recipient_pk).unwrap();
		let aad = keyshare_wrap_aad(&urn, recipient_did, granter_did, dek_ver);
		let wrapped =
			encrypt_keyshare_payload(&kek_wrap, dek_plain.expose(), &aad).unwrap();

		let kek_unwrap = derive_kek_x25519(&recipient, &granter_pk).unwrap();
		let opened = decrypt_keyshare_payload(&wrapped, &kek_unwrap, &aad).unwrap();
		assert_eq!(opened, *dek_plain.expose());
	}

	#[test]
	fn envelope_roundtrip() {
		let dek = random_identity_dek();
		let identity = uuid::Uuid::nil();
		let row = uuid::Uuid::nil();
		let identity_urn = format!("safe:{identity}");
		let aad_plain = format!("{identity_urn}|todos|title|{row}|1").into_bytes();

		let enc = seal_text_cell_payload(dek.expose(), &aad_plain, "hello").unwrap();
		let (out, dv) = open_text_cell_payload(dek.expose(), &enc, &aad_plain).unwrap();
		assert_eq!(out, "hello");
		assert_eq!(dv, 1u64);
		assert_eq!(dek_version_from_aad_bytes(&aad_plain).unwrap(), 1);
	}

	#[test]
	fn envelope_roundtrip_extended_aad() {
		let dek = random_identity_dek();
		let identity = uuid::Uuid::nil();
		let row = uuid::Uuid::nil();
		let identity_urn = format!("safe:{identity}");
		let aad_plain = cell_seal_aad(&identity_urn, "todos", "done", row, 2, column_type_slug(&ColumnType::Text));
		assert_eq!(
			dek_version_from_aad_bytes(&aad_plain).unwrap(),
			2u64
		);

		let canon =
			avendb_value_to_canonical_utf8(&Value::Boolean(true)).unwrap();

		let enc = seal_text_cell_payload(dek.expose(), &aad_plain, &canon).unwrap();
		let (out, dv) = open_text_cell_payload(dek.expose(), &enc, &aad_plain).unwrap();
		let j =
			ipc_json_from_opened_sensitive_plaintext(&out, &ColumnType::Text).unwrap();
		assert_eq!(j, serde_json::json!(true));
		assert_eq!(dv, 2u64);
	}

	#[test]
	fn dek_rotation_version_isolation() {
		// Core of v2 revoke: data sealed under DEK v1 CANNOT be opened with the
		// rotated DEK v2 (a revoked peer that only has v2-less/old keys cannot
		// read across the rotation boundary; new data under v2 is unreadable
		// without the v2 keyshare).
		let dek_v1 = random_identity_dek();
		let dek_v2 = random_identity_dek();
		let identity = uuid::Uuid::new_v4();
		let row = uuid::Uuid::new_v4();
		let urn = format!("safe:{identity}");

		// Old cell, sealed under v1.
		let aad_v1 = cell_seal_aad(&urn, "messages", "body", row, 1, column_type_slug(&ColumnType::Text));
		let old_cell = seal_text_cell_payload(dek_v1.expose(), &aad_v1, "before rotation").unwrap();

		// New cell, sealed under the rotated v2 DEK.
		let aad_v2 = cell_seal_aad(&urn, "messages", "body", row, 2, column_type_slug(&ColumnType::Text));
		let new_cell = seal_text_cell_payload(dek_v2.expose(), &aad_v2, "after rotation").unwrap();

		// Correct version opens; cross-version DEK fails (authenticated decryption).
		assert_eq!(open_text_cell_payload(dek_v1.expose(), &old_cell, &aad_v1).unwrap().0, "before rotation");
		assert_eq!(open_text_cell_payload(dek_v2.expose(), &new_cell, &aad_v2).unwrap().0, "after rotation");
		assert!(
			open_text_cell_payload(dek_v2.expose(), &old_cell, &aad_v1).is_err(),
			"v2 DEK must NOT open a v1 cell"
		);
		assert!(
			open_text_cell_payload(dek_v1.expose(), &new_cell, &aad_v2).is_err(),
			"v1 DEK (all a revoked peer keeps) must NOT open a post-rotation v2 cell"
		);
	}

	#[test]
	fn rotation_full_flow_keyshare_excludes_revoked() {
		// End-to-end rotation invariant (the crypto half of v2 revoke):
		// after rotating to a new DEK and keysharing it to the REMAINING member
		// only, that member can derive the new key and read new data, while the
		// revoked peer — which never received the v+1 keyshare and keeps only the
		// old DEK — cannot read anything sealed under the new key.
		let owner = SigningKey::from_bytes(&[1u8; 32]); // wrapper (this device)
		let carol = SigningKey::from_bytes(&[3u8; 32]); // remaining member
		let owner_pk = owner.verifying_key().to_bytes();
		let carol_pk = carol.verifying_key().to_bytes();

		let identity = uuid::Uuid::new_v4();
		let row = uuid::Uuid::new_v4();
		let urn = format!("safe:{identity}");
		let carol_did = "did:key:zCarol";

		let old_dek = random_identity_dek(); // v1 — everyone (incl. revoked Bob) had this
		let new_dek = random_identity_dek(); // v2 — minted at rotation

		// Owner keyshares the NEW dek (v2) to Carol only.
		let owner_did = "did:key:zOwner";
		let wrap_aad = keyshare_wrap_aad(&urn, carol_did, owner_did, 2);
		let kek_wrap = derive_kek_x25519(&owner, &carol_pk).unwrap();
		let carol_keyshare = encrypt_keyshare_payload(&kek_wrap, new_dek.expose(), &wrap_aad).unwrap();

		// Carol unwraps her v2 keyshare → recovers the new DEK.
		let kek_unwrap = derive_kek_x25519(&carol, &owner_pk).unwrap();
		let carol_new_dek = decrypt_keyshare_payload(&carol_keyshare, &kek_unwrap, &wrap_aad).unwrap();
		assert_eq!(&carol_new_dek, new_dek.expose(), "Carol derives the rotated DEK");

		// New data sealed under v2.
		let v2_aad = cell_seal_aad(&urn, "messages", "body", row, 2, column_type_slug(&ColumnType::Text));
		let new_cell = seal_text_cell_payload(new_dek.expose(), &v2_aad, "after rotation").unwrap();

		// Carol (rotated key) reads it; Bob (only the old v1 DEK) cannot.
		assert_eq!(open_text_cell_payload(&carol_new_dek, &new_cell, &v2_aad).unwrap().0, "after rotation");
		assert!(
			open_text_cell_payload(old_dek.expose(), &new_cell, &v2_aad).is_err(),
			"revoked peer with only the old DEK cannot read post-rotation data"
		);

		// And old data (v1) remains readable to anyone holding the old DEK.
		let v1_aad = cell_seal_aad(&urn, "messages", "body", row, 1, column_type_slug(&ColumnType::Text));
		let old_cell = seal_text_cell_payload(old_dek.expose(), &v1_aad, "before rotation").unwrap();
		assert_eq!(open_text_cell_payload(old_dek.expose(), &old_cell, &v1_aad).unwrap().0, "before rotation");
	}

	#[test]
	fn reader_authoritative_cell_aad() {
		// Audit #3/#28: the reader must authenticate a sealed cell against the AAD it
		// recomputes for the slot being decoded — NOT an AAD carried in the (relay-supplied)
		// envelope. So a relocated or rolled-back envelope fails to open.
		let dek = random_identity_dek();
		let identity = uuid::Uuid::nil();
		let row = uuid::Uuid::nil();
		let urn = format!("identity:{identity}");
		let slug = column_type_slug(&ColumnType::Text);

		// Seal cell A (column "secret_a", dek_version 1).
		let aad_a = cell_seal_aad(&urn, "vault", "secret_a", row, 1, slug);
		let env = seal_text_cell_payload(dek.expose(), &aad_a, "A-plaintext").unwrap();

		// Honest read of cell A with the matching expected AAD succeeds.
		let (pt, ver) = open_text_cell_payload(dek.expose(), &env, &aad_a).unwrap();
		assert_eq!(pt, "A-plaintext");
		assert_eq!(ver, 1u64);

		// The wire envelope carries NO AAD field: exactly `v1.nonce.ct` (3 dotted fields).
		assert_eq!(env.split('.').count(), 3, "AAD must not be stored in the envelope");

		// RELOCATION: same DEK, same row, different column → reader supplies B's AAD → reject.
		let aad_b = cell_seal_aad(&urn, "vault", "secret_b", row, 1, slug);
		assert!(
			open_text_cell_payload(dek.expose(), &env, &aad_b).is_err(),
			"relocated envelope (different column) must fail AEAD authentication"
		);

		// RELOCATION across rows: same DEK, different row → reject.
		let other_row = uuid::Uuid::from_u128(0x9999);
		let aad_other_row = cell_seal_aad(&urn, "vault", "secret_a", other_row, 1, slug);
		assert!(
			open_text_cell_payload(dek.expose(), &env, &aad_other_row).is_err(),
			"relocated envelope (different row) must fail AEAD authentication"
		);

		// ROLLBACK: same DEK, same coordinate, bumped version → reject.
		let aad_v2 = cell_seal_aad(&urn, "vault", "secret_a", row, 2, slug);
		assert!(
			open_text_cell_payload(dek.expose(), &env, &aad_v2).is_err(),
			"rolled-back/old-version envelope must fail against current-version AAD"
		);
	}
}

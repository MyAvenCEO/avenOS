//! Server-owned **avenCEO** control spark — the network's root of trust.
//!
//! The aven-server is the sole author/owner of the well-known avenCEO spark: it
//! mints the genesis with its own biscuit key (S.3) and auto-grants the first
//! connecting peer admin (S.4, `ws_server`). No client ever mints avenCEO, so
//! there is no claim race. See `docs/ServerRootedAvenCeoPlan.md`.

use aven_caps::caps::{encode_issuer_pubkey_b64, mint_genesis_spark, BiscuitVault};
use aven_caps::crypto::{
	derive_kek_x25519, encrypt_keyshare_payload, keyshare_wrap_aad, random_spark_dek,
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::SigningKey;
use groove::{JazzClient, ObjectId, QueryBuilder, TableName, TableSchema, Value};
use uuid::Uuid;

fn now_ms() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0)
}

/// Build a row's `Vec<Value>` in the table's column order from named cells
/// (missing columns → `Null`). The server's only row-construction path — it has
/// no JSON/IPC machinery like the device app's `insert_values`.
fn row_in_order(tbl: &TableSchema, cells: &[(&str, Value)]) -> Vec<Value> {
	tbl.columns
		.columns
		.iter()
		.map(|c| {
			cells
				.iter()
				.find(|(n, _)| *n == c.name_str())
				.map(|(_, v)| v.clone())
				.unwrap_or(Value::Null)
		})
		.collect()
}

fn col_ix(tbl: &TableSchema, name: &str) -> Result<usize, String> {
	tbl.columns
		.columns
		.iter()
		.position(|c| c.name_str() == name)
		.ok_or_else(|| format!("avenceo: missing col {name}"))
}

/// The avenCEO `sparks` row's `genesis_b64` if it exists in the engine, else None.
pub async fn avenceo_genesis_b64(engine: &JazzClient, avenceo_id: Uuid) -> Result<Option<String>, String> {
	let schema = engine.schema().await.map_err(|e| format!("schema:{e:?}"))?;
	let tbl = schema
		.get(&TableName::new("sparks"))
		.ok_or("avenceo: no sparks table")?;
	let sid_ix = col_ix(tbl, "spark_id")?;
	let gen_ix = col_ix(tbl, "genesis_b64")?;
	let q = QueryBuilder::new(TableName::new("sparks")).build();
	let rows = engine.query(q, None).await.map_err(|e| format!("query:{e:?}"))?;
	for (_oid, vals) in rows {
		let matches = match vals.get(sid_ix) {
			Some(Value::Uuid(o)) => *o.uuid() == avenceo_id,
			Some(Value::Text(s)) => Uuid::parse_str(s.trim()).map(|u| u == avenceo_id).unwrap_or(false),
			_ => false,
		};
		if matches {
			return Ok(vals.get(gen_ix).and_then(|v| match v {
				Value::Text(s) => Some(s.clone()),
				_ => None,
			}));
		}
	}
	Ok(None)
}

/// Ensure the server owns avenCEO: mint its genesis (server = owner) + a self
/// keyshare if not already present. Idempotent — safe to call on every boot.
pub async fn ensure_avenceo_owned(
	engine: &JazzClient,
	vault: &BiscuitVault,
	signing: &SigningKey,
	avenceo_id: Uuid,
) -> Result<(), String> {
	if avenceo_genesis_b64(engine, avenceo_id).await?.is_some() {
		tracing::info!(%avenceo_id, "avenCEO already minted (server-owned)");
		return Ok(());
	}
	let schema = engine.schema().await.map_err(|e| format!("schema:{e:?}"))?;

	let genesis = mint_genesis_spark(vault, avenceo_id)?;
	let genesis_b64 =
		URL_SAFE_NO_PAD.encode(genesis.to_vec().map_err(|e| format!("genesis_encode:{e:?}"))?);
	let issuer_b64 = encode_issuer_pubkey_b64(&vault.biscuit_kp.public());
	let dek_ver = 1i64;

	let sparks_tbl = schema.get(&TableName::new("sparks")).ok_or("avenceo: no sparks table")?;
	let sparks_row = row_in_order(
		sparks_tbl,
		&[
			("spark_id", Value::Uuid(ObjectId::from_uuid(avenceo_id))),
			("name", Value::Text("avenCEO".into())),
			("issuer_pubkey_b64", Value::Text(issuer_b64)),
			("genesis_b64", Value::Text(genesis_b64)),
			("current_dek_version", Value::BigInt(dek_ver)),
			("created_at_ms", Value::BigInt(now_ms())),
		],
	);
	engine
		.create("sparks", sparks_row)
		.await
		.map_err(|e| format!("create sparks:{e:?}"))?;

	// Self keyshare (the spark's DEK wrapped to the server, so it can read avenCEO).
	let dek = random_spark_dek();
	let kek = derive_kek_x25519(signing, &vault.ed25519_public)?;
	let urn = format!("spark:{avenceo_id}");
	let aad = keyshare_wrap_aad(&urn, &vault.peer_did, dek_ver);
	let wrapped = encrypt_keyshare_payload(&kek, dek.expose(), &aad)?;
	let ks_tbl = schema
		.get(&TableName::new("keyshares"))
		.ok_or("avenceo: no keyshares table")?;
	let ks_row = row_in_order(
		ks_tbl,
		&[
			("spark_id", Value::Uuid(ObjectId::from_uuid(avenceo_id))),
			("dek_version", Value::BigInt(dek_ver)),
			("recipient_did", Value::Text(vault.peer_did.clone())),
			("wrapper_did", Value::Text(vault.peer_did.clone())),
			("wrapped_dek", Value::Text(wrapped)),
		],
	);
	engine
		.create("keyshares", ks_row)
		.await
		.map_err(|e| format!("create keyshares:{e:?}"))?;

	tracing::info!(%avenceo_id, owner_did = %vault.peer_did, "minted avenCEO genesis — server is owner");
	Ok(())
}

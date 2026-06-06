//! Server-owned **avenCEO** control identity — the network's root of trust.
//!
//! The aven-node is the sole author/owner of the well-known avenCEO identity: it
//! mints the genesis with its own biscuit key (S.3) and auto-grants the first
//! connecting peer admin (S.4, `ws_server`). No client ever mints avenCEO, so
//! there is no claim race. See `docs/ServerRootedAvenCeoPlan.md`.

use aven_caps::caps::{
	attenuate_add_owner_third_party, biscuit_from_storage, build_vault_from_signing_key,
	decode_issuer_pubkey_b64, encode_issuer_pubkey_b64, mint_genesis_identity, identity_admins, BiscuitVault,
};
use aven_caps::crypto::{
	decrypt_keyshare_payload, derive_kek_x25519, encrypt_keyshare_payload, keyshare_wrap_aad,
	random_identity_dek,
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::SigningKey;
use groove::{JazzClient, ObjectId, PeerId, QueryBuilder, TableName, TableSchema, Value};
use uuid::Uuid;

fn text_at(vals: &[Value], ix: usize) -> String {
	match vals.get(ix) {
		Some(Value::Text(s)) => s.clone(),
		_ => String::new(),
	}
}
fn bigint_at(vals: &[Value], ix: usize) -> i64 {
	match vals.get(ix) {
		Some(Value::BigInt(i)) => *i,
		Some(Value::Integer(i)) => *i as i64,
		_ => 0,
	}
}
fn uuid_matches(vals: &[Value], ix: usize, want: Uuid) -> bool {
	match vals.get(ix) {
		Some(Value::Uuid(o)) => *o.uuid() == want,
		Some(Value::Text(s)) => Uuid::parse_str(s.trim()).map(|u| u == want).unwrap_or(false),
		_ => false,
	}
}

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

/// The avenCEO `identities` row's `genesis_b64` if it exists in the engine, else None.
pub async fn avenceo_genesis_b64(engine: &JazzClient, avenceo_id: Uuid) -> Result<Option<String>, String> {
	let schema = engine.schema().await.map_err(|e| format!("schema:{e:?}"))?;
	let tbl = schema
		.get(&TableName::new("identities"))
		.ok_or("avenceo: no identities table")?;
	let sid_ix = col_ix(tbl, "owner")?;
	let gen_ix = col_ix(tbl, "genesis_b64")?;
	let q = QueryBuilder::new(TableName::new("identities")).build();
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
/// Mint a signed owner-binding for a freshly generated server row id, as the metadata
/// entry to stamp at create — so the server's avenCEO control rows carry a binding and
/// pass the same verify-on-apply gate as everything else (no exclusions).
fn owner_binding_meta(
	signing: &SigningKey,
	row_id: ObjectId,
	owner: Uuid,
) -> Result<std::collections::HashMap<String, String>, String> {
	let binding = aven_caps::ownership::mint_owner_binding(signing, *row_id.uuid(), owner)?;
	let mut meta = std::collections::HashMap::new();
	meta.insert(
		aven_caps::ownership::OWNER_BINDING_META_KEY.to_string(),
		binding.to_meta_string(),
	);
	Ok(meta)
}

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

	let genesis = mint_genesis_identity(vault, avenceo_id)?;
	let genesis_b64 =
		URL_SAFE_NO_PAD.encode(genesis.to_vec().map_err(|e| format!("genesis_encode:{e:?}"))?);
	let issuer_b64 = encode_issuer_pubkey_b64(&vault.biscuit_kp.public());
	let dek_ver = 1i64;

	let sparks_tbl = schema.get(&TableName::new("identities")).ok_or("avenceo: no identities table")?;
	let sparks_row = row_in_order(
		sparks_tbl,
		&[
			("owner", Value::Uuid(ObjectId::from_uuid(avenceo_id))),
			("type", Value::Text("aven".into())),
			("name", Value::Text("avenCEO".into())),
			("issuer_pubkey_b64", Value::Text(issuer_b64)),
			("genesis_b64", Value::Text(genesis_b64)),
			("current_dek_version", Value::BigInt(dek_ver)),
			("created_at_ms", Value::BigInt(now_ms())),
		],
	);
	let sparks_oid = ObjectId::new();
	let sparks_meta = owner_binding_meta(signing, sparks_oid, avenceo_id)?;
	engine
		.create_with_id_and_metadata("identities", sparks_oid, sparks_row, sparks_meta)
		.await
		.map_err(|e| format!("create identities:{e:?}"))?;

	// Self keyshare (the identity's DEK wrapped to the server, so it can read avenCEO).
	let dek = random_identity_dek();
	let kek = derive_kek_x25519(signing, &vault.ed25519_public)?;
	let urn = format!("identity:{avenceo_id}");
	let aad = keyshare_wrap_aad(&urn, &vault.peer_did, dek_ver);
	let wrapped = encrypt_keyshare_payload(&kek, dek.expose(), &aad)?;
	let ks_tbl = schema
		.get(&TableName::new("keyshares"))
		.ok_or("avenceo: no keyshares table")?;
	let ks_row = row_in_order(
		ks_tbl,
		&[
			("owner", Value::Uuid(ObjectId::from_uuid(avenceo_id))),
			("dek_version", Value::BigInt(dek_ver)),
			("recipient_did", Value::Text(vault.peer_did.clone())),
			("wrapper_did", Value::Text(vault.peer_did.clone())),
			("wrapped_dek", Value::Text(wrapped)),
		],
	);
	let ks_oid = ObjectId::new();
	let ks_meta = owner_binding_meta(signing, ks_oid, avenceo_id)?;
	engine
		.create_with_id_and_metadata("keyshares", ks_oid, ks_row, ks_meta)
		.await
		.map_err(|e| format!("create keyshares:{e:?}"))?;

	tracing::info!(%avenceo_id, owner_did = %vault.peer_did, "minted avenCEO genesis — server is owner");
	Ok(())
}

/// The avenCEO `identities` row: `(object id, genesis_b64, issuer_pubkey_b64, dek_version)`.
async fn read_avenceo_identity(
	engine: &JazzClient,
	avenceo_id: Uuid,
) -> Result<Option<(ObjectId, String, String, i64)>, String> {
	let schema = engine.schema().await.map_err(|e| format!("schema:{e:?}"))?;
	let tbl = schema.get(&TableName::new("identities")).ok_or("avenceo: no identities table")?;
	let sid_ix = col_ix(tbl, "owner")?;
	let gen_ix = col_ix(tbl, "genesis_b64")?;
	let iss_ix = col_ix(tbl, "issuer_pubkey_b64")?;
	let ver_ix = col_ix(tbl, "current_dek_version")?;
	let q = QueryBuilder::new(TableName::new("identities")).build();
	for (oid, vals) in engine.query(q, None).await.map_err(|e| format!("query:{e:?}"))? {
		if uuid_matches(&vals, sid_ix, avenceo_id) {
			return Ok(Some((oid, text_at(&vals, gen_ix), text_at(&vals, iss_ix), bigint_at(&vals, ver_ix))));
		}
	}
	Ok(None)
}

/// Read + unwrap the server's own avenCEO DEK from its keyshare row (self-wrap).
async fn read_server_dek(
	engine: &JazzClient,
	vault: &BiscuitVault,
	signing: &SigningKey,
	avenceo_id: Uuid,
	dek_ver: i64,
) -> Result<[u8; 32], String> {
	let schema = engine.schema().await.map_err(|e| format!("schema:{e:?}"))?;
	let tbl = schema.get(&TableName::new("keyshares")).ok_or("avenceo: no keyshares table")?;
	let sid_ix = col_ix(tbl, "owner")?;
	let ver_ix = col_ix(tbl, "dek_version")?;
	let recip_ix = col_ix(tbl, "recipient_did")?;
	let wrap_ix = col_ix(tbl, "wrapped_dek")?;
	let q = QueryBuilder::new(TableName::new("keyshares")).build();
	for (_oid, vals) in engine.query(q, None).await.map_err(|e| format!("query:{e:?}"))? {
		if uuid_matches(&vals, sid_ix, avenceo_id)
			&& bigint_at(&vals, ver_ix) == dek_ver
			&& text_at(&vals, recip_ix) == vault.peer_did
		{
			let wrapped = text_at(&vals, wrap_ix);
			let kek = derive_kek_x25519(signing, &vault.ed25519_public)?;
			let urn = format!("identity:{avenceo_id}");
			let aad = keyshare_wrap_aad(&urn, &vault.peer_did, dek_ver);
			return decrypt_keyshare_payload(&wrapped, &kek, &aad);
		}
	}
	Err("avenceo: server keyshare not found".into())
}

/// S.4 — auto-grant the **first** connecting peer admin on avenCEO. If avenCEO has
/// no non-server owner yet, the server appends `owns(peerDid)` to the chain
/// (server-signed) + wraps a keyshare to the peer, then persists. The peer now
/// holds an avenCEO cap → it is a network member (the device gates on this). Idempotent
/// per peer; once any admin exists, later peers must be invited.
pub async fn maybe_grant_first_admin(
	engine: &JazzClient,
	signing: &SigningKey,
	avenceo_id: Uuid,
	peer: PeerId,
) -> Result<(), String> {
	let vault = build_vault_from_signing_key(signing)?;
	let peer_did = groove::did_key::peer_did_from_ed25519(&peer.0)?;
	if peer_did == vault.peer_did {
		return Ok(());
	}
	let Some((sparks_oid, genesis_b64, issuer_b64, dek_ver)) = read_avenceo_identity(engine, avenceo_id).await? else {
		return Ok(());
	};
	let issuer_pk = decode_issuer_pubkey_b64(&issuer_b64)?;
	let chain = biscuit_from_storage(&genesis_b64, issuer_pk)?;
	let owners = identity_admins(&chain, avenceo_id)?;
	if owners.iter().any(|d| d.trim() != vault.peer_did) {
		tracing::debug!(%peer_did, "avenCEO already has an admin — not auto-granting");
		return Ok(());
	}

	// Append owns(peer) (server-signed) and persist the new genesis.
	let new_chain = attenuate_add_owner_third_party(&vault.biscuit_kp, &chain, avenceo_id, &peer_did)?;
	let new_genesis_b64 =
		URL_SAFE_NO_PAD.encode(new_chain.to_vec().map_err(|e| format!("genesis_encode:{e:?}"))?);
	let upd_meta = owner_binding_meta(signing, sparks_oid, avenceo_id)?;
	engine
		.update_with_metadata(
			sparks_oid,
			vec![("genesis_b64".to_string(), Value::Text(new_genesis_b64))],
			upd_meta,
		)
		.await
		.map_err(|e| format!("update genesis:{e:?}"))?;

	// Wrap the avenCEO DEK to the peer so it can read the identity (→ becomes a member).
	let dek = read_server_dek(engine, &vault, signing, avenceo_id, dek_ver).await?;
	let kek = derive_kek_x25519(signing, &peer.0)?;
	let urn = format!("identity:{avenceo_id}");
	let aad = keyshare_wrap_aad(&urn, &peer_did, dek_ver);
	let wrapped = encrypt_keyshare_payload(&kek, &dek, &aad)?;
	let schema = engine.schema().await.map_err(|e| format!("schema:{e:?}"))?;
	let ks_tbl = schema.get(&TableName::new("keyshares")).ok_or("avenceo: no keyshares table")?;
	let ks_row = row_in_order(
		ks_tbl,
		&[
			("owner", Value::Uuid(ObjectId::from_uuid(avenceo_id))),
			("dek_version", Value::BigInt(dek_ver)),
			("recipient_did", Value::Text(peer_did.clone())),
			("wrapper_did", Value::Text(vault.peer_did.clone())),
			("wrapped_dek", Value::Text(wrapped)),
		],
	);
	let ks_oid = ObjectId::new();
	let ks_meta = owner_binding_meta(signing, ks_oid, avenceo_id)?;
	engine
		.create_with_id_and_metadata("keyshares", ks_oid, ks_row, ks_meta)
		.await
		.map_err(|e| format!("create keyshares:{e:?}"))?;

	// Re-announce our frontier so the just-authorized peer re-pulls avenCEO. The
	// identity's genesis + keyshare batches were announced-and-DENIED before this
	// grant (the peer held no cap), so without a re-announce they never re-ship and
	// the device stays stuck at the invite gate even though it is now an owner.
	// Mirrors the device-side grant path (`finish_spark_admin_grant`).
	if let Err(e) = engine.rebroadcast_all_peer_clients_and_flush().await {
		tracing::warn!(%peer_did, "avenCEO post-grant re-announce failed: {e}");
	}

	tracing::info!(%peer_did, %avenceo_id, "auto-granted FIRST peer admin on avenCEO (server-signed)");
	Ok(())
}

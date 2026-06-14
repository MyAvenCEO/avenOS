//! Server-owned **avenCEO** control identity — the network's root of trust.
//!
//! The aven-node is the sole author/owner of the well-known avenCEO identity: it
//! mints the genesis with its own biscuit key (S.3) and auto-grants the first
//! connecting peer admin (S.4, `ws_server`). No client ever mints avenCEO, so
//! there is no claim race. See `docs/ServerRootedAvenCeoPlan.md`.

use aven_caps::caps::{
	attenuate_add_owner_third_party, biscuit_from_storage, build_vault_from_signing_key,
	decode_issuer_pubkey_b64, encode_issuer_pubkey_b64, identity_admins, mint_safe_genesis, safe_did,
	BiscuitVault,
};
use aven_caps::crypto::{
	cell_seal_aad, column_type_slug, decrypt_keyshare_payload, derive_kek_x25519,
	encrypt_keyshare_payload, keyshare_wrap_aad, open_text_cell_payload, random_identity_dek,
	seal_text_cell_payload,
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::SigningKey;
use aven_db::{AvenDbClient, ObjectId, QueryBuilder, TableName, TableSchema, Value};
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

fn now_ms() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0)
}

/// Named cells → the universal schema-checked create input (board 0020). Unknown
/// columns error and missing nullable columns are Null-filled by aven-db's
/// `resolve_named_row` — the server has no positional row path.
fn named_row(cells: &[(&str, Value)]) -> std::collections::HashMap<String, Value> {
	cells.iter().map(|(n, v)| ((*n).to_string(), v.clone())).collect()
}

fn col_ix(tbl: &TableSchema, name: &str) -> Result<usize, String> {
	tbl.columns
		.columns
		.iter()
		.position(|c| c.name_str() == name)
		.ok_or_else(|| format!("avenceo: missing col {name}"))
}

/// The avenCEO `identities` row's `genesis_b64` if it exists in the engine, else None.
pub async fn avenceo_genesis_b64(engine: &AvenDbClient, avenceo_id: Uuid) -> Result<Option<String>, String> {
	let schema = engine.schema().await.map_err(|e| format!("schema:{e:?}"))?;
	let tbl = schema
		.get(&TableName::new("safes"))
		.ok_or("avenceo: no safes table")?;
	let gen_ix = col_ix(tbl, "genesis_b64")?;
	let q = QueryBuilder::new(TableName::new("safes")).build();
	let rows = engine.query(q, None).await.map_err(|e| format!("query:{e:?}"))?;
	for (oid, vals) in rows {
		let owner: Option<Uuid> = match engine.owner_binding_for("safes", oid).map_err(|e| format!("owner_binding:{e:?}"))? {
			Some(meta) => aven_db::capability::owner_uuid_from_binding_meta(&meta),
			None => None,
		};
		if owner == Some(avenceo_id) {
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

/// Seal a trust-root identity cell (`genesis_b64` / `issuer_pubkey_b64`) under the avenCEO
/// DEK, byte-identically to the app's `seal_column_plain` so the hardened client can open it.
/// Board 0015 makes the client REFUSE a cleartext trust root (`cleartext_downgrade`), so the
/// server — the avenCEO author — must seal these cells, not write them in the clear.
fn seal_identity_cell(
	dek32: &[u8; 32],
	avenceo_id: Uuid,
	sparks_tbl: &TableSchema,
	column: &str,
	dek_ver: i64,
	plaintext: &str,
) -> Result<String, String> {
	let col = sparks_tbl
		.columns
		.column(column)
		.ok_or_else(|| format!("seal: safes has no {column} column"))?;
	let urn = format!("safe:{avenceo_id}");
	let slug = column_type_slug(&col.column_type);
	let aad = cell_seal_aad(&urn, "safes", column, avenceo_id, dek_ver, slug);
	seal_text_cell_payload(dek32, &aad, plaintext)
}

/// Inverse of [`seal_identity_cell`] — open a sealed trust-root cell back to cleartext so the
/// server can rebuild the biscuit chain (the grant reads its own sealed genesis/issuer).
fn unseal_identity_cell(
	dek32: &[u8; 32],
	avenceo_id: Uuid,
	sparks_tbl: &TableSchema,
	column: &str,
	dek_ver: i64,
	sealed: &str,
) -> Result<String, String> {
	let col = sparks_tbl
		.columns
		.column(column)
		.ok_or_else(|| format!("unseal: safes has no {column} column"))?;
	let urn = format!("safe:{avenceo_id}");
	let slug = column_type_slug(&col.column_type);
	let aad = cell_seal_aad(&urn, "safes", column, avenceo_id, dek_ver, slug);
	let (plaintext, _ver) = open_text_cell_payload(dek32, sealed, &aad)?;
	Ok(plaintext)
}

pub async fn ensure_avenceo_owned(
	engine: &AvenDbClient,
	vault: &BiscuitVault,
	signing: &SigningKey,
	avenceo_id: Uuid,
	aven_name: &str,
) -> Result<(), String> {
	if avenceo_genesis_b64(engine, avenceo_id).await?.is_some() {
		tracing::info!(%avenceo_id, "avenCEO already minted (server-owned)");
		return Ok(());
	}
	let schema = engine.schema().await.map_err(|e| format!("schema:{e:?}"))?;

	let genesis = mint_safe_genesis(vault, avenceo_id)?;
	let genesis_b64 =
		URL_SAFE_NO_PAD.encode(genesis.to_vec().map_err(|e| format!("genesis_encode:{e:?}"))?);
	let issuer_b64 = encode_issuer_pubkey_b64(&vault.biscuit_kp.public());
	let dek_ver = 1i64;

	// The identity's content DEK. Seal the trust-root cells (genesis_b64, issuer_pubkey_b64)
	// under it so the hardened client accepts them (board 0015 refuses a cleartext trust root);
	// the same DEK is wrapped to the server below so it can re-read avenCEO.
	let dek = random_identity_dek();

	let sparks_tbl = schema.get(&TableName::new("safes")).ok_or("avenceo: no safes table")?;
	let sealed_genesis =
		seal_identity_cell(dek.expose(), avenceo_id, sparks_tbl, "genesis_b64", dek_ver, &genesis_b64)?;
	let sealed_issuer =
		seal_identity_cell(dek.expose(), avenceo_id, sparks_tbl, "issuer_pubkey_b64", dek_ver, &issuer_b64)?;
	let sparks_row = named_row(&[
			// avenCEO is an aven SAFE (autonomous network control identity) owned directly
			// by this node's env-seed server signer; it admits human owners via did:safe.
			("type", Value::Text("aven".into())),
			("safe_did", Value::Text(safe_did(avenceo_id))),
			// The aven's default identity is named after the aven itself (per-aven
			// config, e.g. avenCEO / avenMAIA) — not a hardcoded constant.
			("name", Value::Text(aven_name.into())),
			("issuer_pubkey_b64", Value::Text(sealed_issuer)),
			("genesis_b64", Value::Text(sealed_genesis)),
			("current_dek_version", Value::BigInt(dek_ver)),
			("created_at_ms", Value::BigInt(now_ms())),
		],
	);
	let sparks_oid = ObjectId::new();
	engine
		.create("safes", avenceo_id, Some(sparks_oid), sparks_row)
		.await
		.map_err(|e| format!("create safes:{e:?}"))?;

	// Self keyshare (the identity's DEK wrapped to the server, so it can read avenCEO).
	let kek = derive_kek_x25519(signing, &vault.ed25519_public)?;
	let urn = format!("safe:{avenceo_id}");
	let aad = keyshare_wrap_aad(&urn, &vault.signer_did, &vault.signer_did, dek_ver);
	let wrapped = encrypt_keyshare_payload(&kek, dek.expose(), &aad)?;
	let ks_row = named_row(&[
			("dek_version", Value::BigInt(dek_ver)),
			("recipient_did", Value::Text(vault.signer_did.clone())),
			("wrapper_did", Value::Text(vault.signer_did.clone())),
			("wrapped_dek", Value::Text(wrapped)),
		],
	);
	let ks_oid = ObjectId::new();
	engine
		.create("keyshares", avenceo_id, Some(ks_oid), ks_row)
		.await
		.map_err(|e| format!("create keyshares:{e:?}"))?;

	// Publish the server's own signer into avenCEO's roster, tagged signer_type=env_seed
	// (key held from AVEN_SERVER_SEED, not a human's Secure Enclave). This both labels the
	// owner in the Members UI and lets the device-side ≥1-human-owner guard recognise the
	// server signer as NON-human. Owned by avenCEO so it syncs to its members.
	if schema.get(&TableName::new("signers")).is_some() {
		let signers_row = named_row(&[
				("signer_did", Value::Text(vault.signer_did.clone())),
				("device_label", Value::Text(aven_name.into())),
				("kind", Value::Text("remote".into())),
				("signer_type", Value::Text("env_seed".into())),
				("added_at_ms", Value::BigInt(now_ms())),
				("status", Value::Text("active".into())),
			],
		);
		let signers_oid = ObjectId::new();
		engine
			.create("signers", avenceo_id, Some(signers_oid), signers_row)
			.await
			.map_err(|e| format!("create signers:{e:?}"))?;
	}

	tracing::info!(%avenceo_id, owner_did = %vault.signer_did, "minted avenCEO genesis — server is owner");
	Ok(())
}

/// The avenCEO `identities` row: `(object id, genesis_b64, issuer_pubkey_b64, dek_version)`.
async fn read_avenceo_identity(
	engine: &AvenDbClient,
	avenceo_id: Uuid,
) -> Result<Option<(ObjectId, String, String, i64)>, String> {
	let schema = engine.schema().await.map_err(|e| format!("schema:{e:?}"))?;
	let tbl = schema.get(&TableName::new("safes")).ok_or("avenceo: no safes table")?;
	let gen_ix = col_ix(tbl, "genesis_b64")?;
	let iss_ix = col_ix(tbl, "issuer_pubkey_b64")?;
	let ver_ix = col_ix(tbl, "current_dek_version")?;
	let q = QueryBuilder::new(TableName::new("safes")).build();
	for (oid, vals) in engine.query(q, None).await.map_err(|e| format!("query:{e:?}"))? {
		let owner: Option<Uuid> = match engine.owner_binding_for("safes", oid).map_err(|e| format!("owner_binding:{e:?}"))? {
			Some(meta) => aven_db::capability::owner_uuid_from_binding_meta(&meta),
			None => None,
		};
		if owner == Some(avenceo_id) {
			return Ok(Some((oid, text_at(&vals, gen_ix), text_at(&vals, iss_ix), bigint_at(&vals, ver_ix))));
		}
	}
	Ok(None)
}

/// Read + unwrap the server's own avenCEO DEK from its keyshare row (self-wrap).
async fn read_server_dek(
	engine: &AvenDbClient,
	vault: &BiscuitVault,
	signing: &SigningKey,
	avenceo_id: Uuid,
	dek_ver: i64,
) -> Result<[u8; 32], String> {
	let schema = engine.schema().await.map_err(|e| format!("schema:{e:?}"))?;
	let tbl = schema.get(&TableName::new("keyshares")).ok_or("avenceo: no keyshares table")?;
	let ver_ix = col_ix(tbl, "dek_version")?;
	let recip_ix = col_ix(tbl, "recipient_did")?;
	let wrap_ix = col_ix(tbl, "wrapped_dek")?;
	let q = QueryBuilder::new(TableName::new("keyshares")).build();
	for (oid, vals) in engine.query(q, None).await.map_err(|e| format!("query:{e:?}"))? {
		let owner: Option<Uuid> = match engine.owner_binding_for("keyshares", oid).map_err(|e| format!("owner_binding:{e:?}"))? {
			Some(meta) => aven_db::capability::owner_uuid_from_binding_meta(&meta),
			None => None,
		};
		if owner == Some(avenceo_id)
			&& bigint_at(&vals, ver_ix) == dek_ver
			&& text_at(&vals, recip_ix) == vault.signer_did
		{
			let wrapped = text_at(&vals, wrap_ix);
			let kek = derive_kek_x25519(signing, &vault.ed25519_public)?;
			let urn = format!("safe:{avenceo_id}");
			// Self-keyshare: wrapper == this server. Prefer the wrapper-bound AAD, fall back
			// to the legacy form so a keyshare minted before the binding still opens.
			let aad = keyshare_wrap_aad(&urn, &vault.signer_did, &vault.signer_did, dek_ver);
			return decrypt_keyshare_payload(&wrapped, &kek, &aad);
		}
	}
	Err("avenceo: server keyshare not found".into())
}

/// Grant the network's FIRST human SAFE admin on avenCEO — the human, never a device key.
/// avenCEO is owned by the env-seed server signer; this adds the first human SAFE that has
/// synced in (a `type=human` row) as a co-owner and wraps the avenCEO DEK to that SAFE's
/// `wrap_did`, so the person's devices read avenCEO + manage the network through SAFE
/// membership. The bootstrap device signer is NEVER granted. Idempotent: once avenCEO has
/// any non-server owner it is done. Driven by a periodic tick + per peer connect, so it
/// fires whenever the human SAFE lands (it is created AFTER the device first connects).
pub async fn grant_first_human_admin(
	engine: &AvenDbClient,
	signing: &SigningKey,
	avenceo_id: Uuid,
) -> Result<(), String> {
	let vault = build_vault_from_signing_key(signing)?;
	let Some((sparks_oid, sealed_genesis, sealed_issuer, dek_ver)) =
		read_avenceo_identity(engine, avenceo_id).await?
	else {
		return Ok(());
	};
	let dek = read_server_dek(engine, &vault, signing, avenceo_id, dek_ver).await?;
	let schema = engine.schema().await.map_err(|e| format!("schema:{e:?}"))?;
	let sparks_tbl = schema.get(&TableName::new("safes")).ok_or("avenceo: no safes table")?;
	let genesis_b64 =
		unseal_identity_cell(&dek, avenceo_id, sparks_tbl, "genesis_b64", dek_ver, &sealed_genesis)?;
	let issuer_b64 =
		unseal_identity_cell(&dek, avenceo_id, sparks_tbl, "issuer_pubkey_b64", dek_ver, &sealed_issuer)?;
	let issuer_pk = decode_issuer_pubkey_b64(&issuer_b64)?;
	let chain = biscuit_from_storage(&genesis_b64, issuer_pk)?;

	// Already has a non-server owner (a human SAFE was granted earlier) -> done.
	let owners = identity_admins(&chain, avenceo_id)?;
	if owners.iter().any(|d| d.trim() != vault.signer_did) {
		return Ok(());
	}

	// Find the first synced HUMAN SAFE. type/owner/wrap_did are PLAINTEXT routing columns,
	// so the blind server reads them without the SAFE's DEK. wrap_did is required to deliver
	// the avenCEO DEK to the SAFE's members.
	let type_ix = col_ix(sparks_tbl, "type")?;
	let wrap_ix = col_ix(sparks_tbl, "wrap_did")?;
	let q = QueryBuilder::new(TableName::new("safes")).build();
	let mut human: Option<(Uuid, String)> = None;
	for (oid, vals) in engine.query(q, None).await.map_err(|e| format!("query:{e:?}"))? {
		if text_at(&vals, type_ix) != "human" {
			continue;
		}
		let owner: Option<Uuid> = match engine.owner_binding_for("safes", oid).map_err(|e| format!("owner_binding:{e:?}"))? {
			Some(meta) => aven_db::capability::owner_uuid_from_binding_meta(&meta),
			None => None,
		};
		let Some(owner_uuid) = owner else { continue };
		let wrap_did = text_at(&vals, wrap_ix);
		if wrap_did.is_empty() {
			continue;
		}
		human = Some((owner_uuid, wrap_did));
		break;
	}
	let Some((human_uuid, wrap_did)) = human else {
		return Ok(()); // no human SAFE synced yet — wait for the next tick
	};
	let human_did = safe_did(human_uuid);

	// Append owns(humanSAFE) (server-signed) and persist re-sealed genesis.
	let new_chain = attenuate_add_owner_third_party(&vault.biscuit_kp, &chain, avenceo_id, &human_did)?;
	let new_genesis_b64 =
		URL_SAFE_NO_PAD.encode(new_chain.to_vec().map_err(|e| format!("genesis_encode:{e:?}"))?);
	let resealed_genesis =
		seal_identity_cell(&dek, avenceo_id, sparks_tbl, "genesis_b64", dek_ver, &new_genesis_b64)?;
	engine
		.update(
			sparks_oid,
			vec![("genesis_b64".to_string(), Value::Text(resealed_genesis))],
		)
		.await
		.map_err(|e| format!("update genesis:{e:?}"))?;

	// Wrap the avenCEO DEK to the human SAFE's wrap_did so its members can decrypt avenCEO.
	// Members open the (sealed) wrap seed with the SAFE DEK, then unwrap this keyshare.
	let wrap_pk = aven_db::did_key::ed25519_public_from_signer_did(&wrap_did)?;
	let kek = derive_kek_x25519(signing, &wrap_pk)?;
	let urn = format!("safe:{avenceo_id}");
	let aad = keyshare_wrap_aad(&urn, &wrap_did, &vault.signer_did, dek_ver);
	let wrapped = encrypt_keyshare_payload(&kek, &dek, &aad)?;
	let ks_row = named_row(&[
			("dek_version", Value::BigInt(dek_ver)),
			("recipient_did", Value::Text(wrap_did.clone())),
			("wrapper_did", Value::Text(vault.signer_did.clone())),
			("wrapped_dek", Value::Text(wrapped)),
		],
	);
	let ks_oid = ObjectId::new();
	engine
		.create("keyshares", avenceo_id, Some(ks_oid), ks_row)
		.await
		.map_err(|e| format!("create keyshares:{e:?}"))?;

	// Re-announce so the device re-pulls the updated avenCEO genesis + keyshare and its gate
	// opens (its earlier pulls were denied before it held a cap).
	if let Err(e) = engine.rebroadcast_all_peer_clients_and_flush().await {
		tracing::warn!("avenCEO human-admin re-announce failed: {e}");
	}
	tracing::info!(%avenceo_id, %human_did, "granted FIRST human SAFE admin on avenCEO (server-signed); DEK wrapped to wrap_did");
	Ok(())
}

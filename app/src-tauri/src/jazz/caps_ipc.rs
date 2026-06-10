//! Capability / keyshare / identity admin IPC.

use std::sync::Arc;

use groove::{JazzClient, ObjectId, PeerId, Value};
use serde_json::{Map, Value as JsonValue};
use tauri_plugin_self::state::SelfState;
use uuid::Uuid;

use super::*;

/// Wrap a keyshare of EVERY DEK version the granter currently holds for `identity_uuid`
/// to `recipient_did`. A grantee needs ALL historical versions, not just the current
/// one: data written before a DEK rotation (e.g. a prior revoke) stays sealed under the
/// OLD version, so a single current-version keyshare would leave that data permanently
/// undecryptable — the member→revoke→regrant "poison" (a clean-slate grant works only
/// because the identity has a single version). Idempotent: versions the recipient
/// already holds a keyshare for are skipped, so a re-grant never duplicates rows.
async fn wrap_all_dek_versions_to_recipient(
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
	identity_uuid: Uuid,
	recipient_did: &str,
) -> Result<(), String> {
	let recipient_pk = crate::jazz_auth::ed25519_public_from_peer_did(recipient_did)?;
	let kek = crate::crypto::derive_kek_x25519(&shell.signing_key, &recipient_pk)?;
	let urn = jazz_engine::identity_urn(identity_uuid);

	let ks_schema = jazz_engine::resolved_table_schema(client, "keyshares").await?;
	let ks_spark_ix = jazz_engine::col_ix(&ks_schema, "owner")?;
	let ks_ver_ix = jazz_engine::col_ix(&ks_schema, "dek_version")?;
	let ks_recip_ix = jazz_engine::col_ix(&ks_schema, "recipient_did")?;

	// Versions the recipient ALREADY has → skip (idempotent re-grant; no duplicate rows).
	let mut have: std::collections::BTreeSet<i64> = std::collections::BTreeSet::new();
	for (_oid, vals) in jazz_engine::exec_list_rows(client, "keyshares").await? {
		if jazz_engine::uuid_cell_at(vals.as_slice(), ks_spark_ix)? != identity_uuid {
			continue;
		}
		match vals.get(ks_recip_ix) {
			Some(Value::Text(s)) if s == recipient_did => {}
			_ => continue,
		}
		have.insert(jazz_engine::bigint_i64(
			vals.get(ks_ver_ix).ok_or("ks_ver_missing")?,
		)?);
	}

	// Every DEK version the granter holds for this identity, oldest first.
	let mut versions: Vec<i64> = shell
		.deks
		.keys()
		.filter(|(sid, _)| *sid == identity_uuid)
		.map(|(_, v)| *v)
		.collect();
	versions.sort_unstable();
	if versions.is_empty() {
		return Err(format!("no DEK held for identity {identity_uuid}"));
	}

	for v in versions {
		if have.contains(&v) {
			continue;
		}
		let dek = shell
			.deks
			.get(&(identity_uuid, v))
			.ok_or_else(|| format!("missing DEK for identity {identity_uuid} v{v}"))?;
		let aad = crate::crypto::keyshare_wrap_aad(&urn, recipient_did, &shell.peer_did, v);
		let wrapped = crate::crypto::encrypt_keyshare_payload(&kek, dek.expose(), &aad)?;
		let mut ks = Map::new();
		ks.insert("owner".into(), JsonValue::String(identity_uuid.to_string()));
		ks.insert("dek_version".into(), JsonValue::Number(v.into()));
		ks.insert("recipient_did".into(), JsonValue::String(recipient_did.to_string()));
		ks.insert("wrapper_did".into(), JsonValue::String(shell.peer_did.clone()));
		ks.insert("wrapped_dek".into(), JsonValue::String(wrapped));
		let ks_vals = insert_values("keyshares", &ks_schema, ks)?;
		let ks_oid = ObjectId::new();
		let ks_meta = owner_binding_meta(&shell.signing_key, ks_oid, identity_uuid)?;
		client
			.create_with_id_and_metadata("keyshares", ks_oid, ks_vals, ks_meta)
			.await
			.map_err(format_jazz_err)?;
	}
	Ok(())
}

/// Append biscuit third-party `owns` for `peerDid`, persist updated `genesis_b64`, and add a DEK keyshare row so the peer can decrypt ciphertext for this identity after sync.
pub(crate) async fn groove_ipc_spark_admin_add(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	owner: String,
	peer_did: String,
) -> Result<(), String> {
	use base64::engine::general_purpose::URL_SAFE_NO_PAD;
	use base64::Engine;

	let identity_uuid =
		Uuid::parse_str(owner.trim()).map_err(|e| format!("invalid owner UUID: {e}"))?;
	let peer_did = peer_did.trim().to_string();
	if peer_did.is_empty() {
		return Err("peer_did is empty".into());
	}

	let client = with_connected_client(jazz, app, self_state).await?;

	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();

	if peer_did == shell.peer_did {
		return Err("cannot grant a identity to your own DID".into());
	}

	let peer_pk = crate::jazz_auth::ed25519_public_from_peer_did(&peer_did)?;

	// Biscuit-driven sharing: the grant IS the trust act — no separate pairing
	// step or allowlist gate. Materialize the grantee in the local roster and
	// register it for sync so the grant takes effect end-to-end. The roster
	// ("synced with") is thus derived from grants, not hand-managed.
	crate::peers::add_remote_peer(client.as_ref(), &peer_did, "").await?;
	if let Err(e) = client.register_peer_sync_client(PeerId(peer_pk)) {
		log::warn!(target: "avenos::jazz", "identity_admin_add register {peer_did}: {e}");
	}

	jazz_engine::authorize_gate(
		shell,
		"identities",
		crate::identity_acc::AccOp::Write,
		identity_uuid,
		None,
	)?;

	let bisc_identity = shell
		.vault
		.identities
		.get(&identity_uuid)
		.ok_or_else(|| format!("identity {identity_uuid} not loaded in vault"))?;

	let already_owner =
		crate::identity_acc::identity_peer_is_owner(&bisc_identity.biscuit, identity_uuid, &peer_did)?;

	let _ = client.flush_peer_sync().await;

	// Keyshare(s) before genesis so peers often have the DEK before the biscuit/catalogue
	// rows land. Wrap EVERY held DEK version (not just the current one) so the grantee can
	// also decrypt data sealed under pre-rotation versions — this is what lets a re-grant
	// after a revoke (which rotated the DEK) read the identity's pre-revoke data. Idempotent.
	wrap_all_dek_versions_to_recipient(client.as_ref(), shell, identity_uuid, &peer_did).await?;

	if !already_owner {
		let new_biscuit = crate::identity_acc::attenuate_add_owner_third_party(
			&shell.vault.biscuit_kp,
			&bisc_identity.biscuit,
			identity_uuid,
			&peer_did,
		)?;

		let genesis_vec = new_biscuit
			.to_vec()
			.map_err(|e| format!("biscuit_encode:{e:?}"))?;
		let genesis_b64 = URL_SAFE_NO_PAD.encode(genesis_vec);

		let sparks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "identities").await?;
		let identity_id_ix = jazz_engine::col_ix(&sparks_schema, "owner")?;

		let sparks_rows = jazz_engine::exec_list_rows(client.as_ref(), "identities").await?;
		let mut sparks_oid: Option<ObjectId> = None;
		for (oid, vals) in sparks_rows {
			let sid = jazz_engine::uuid_cell_at(vals.as_slice(), identity_id_ix)?;
			if sid == identity_uuid {
				sparks_oid = Some(oid);
				break;
			}
		}
		let sparks_oid =
			sparks_oid.ok_or_else(|| format!("no identities row for owner={identity_uuid}"))?;

		let mut patch_sparks = Map::new();
		patch_sparks.insert(
			"genesis_b64".into(),
			JsonValue::String(genesis_b64),
		);
		let sparks_ops = patch_updates(&sparks_schema, patch_sparks)?;
		let upd_meta = owner_binding_meta(&shell.signing_key, sparks_oid, identity_uuid)?;
		client
			.update_with_metadata(sparks_oid, sparks_ops, upd_meta)
			.await
			.map_err(format_jazz_err)?;
	}

	finish_spark_admin_grant(app, jazz, self_state, client, identity_uuid).await?;

	Ok(())
}

/// Append biscuit third-party `replicate` for `peerDid`, persist updated
/// `genesis_b64`, and register the peer for sync. The grantee gets the **SYNC bundle**
/// (single-source caps, all in the biscuit): table-scoped `read` on the REGISTRY
/// (`identities:` + `peers:`) + a keyshare to hydrate it (member of the directory — can
/// see the aven + member names) + blind `replicate` of the DATA (NO keyshare for the
/// user-data identities, so it relays their ciphertext unread). The 10 MB quota +
/// rate-limit are node-enforced and reported alongside `replicate`. Admin only.
pub(crate) async fn groove_ipc_spark_replicate_add(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	owner: String,
	peer_did: String,
) -> Result<(), String> {
	use base64::engine::general_purpose::URL_SAFE_NO_PAD;
	use base64::Engine;

	let identity_uuid =
		Uuid::parse_str(owner.trim()).map_err(|e| format!("invalid owner UUID: {e}"))?;
	let peer_did = peer_did.trim().to_string();
	if peer_did.is_empty() {
		return Err("peer_did is empty".into());
	}

	let client = with_connected_client(jazz, app, self_state).await?;
	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();

	if peer_did == shell.peer_did {
		return Err("cannot grant replication to your own DID".into());
	}
	let peer_pk = crate::jazz_auth::ed25519_public_from_peer_did(&peer_did)?;

	// Register the replica as a sync peer so the grant takes effect end-to-end.
	crate::peers::add_remote_peer(client.as_ref(), &peer_did, "").await?;
	if let Err(e) = client.register_peer_sync_client(PeerId(peer_pk)) {
		log::warn!(target: "avenos::jazz", "identity_replicate_add register {peer_did}: {e}");
	}

	// Only a identity admin may grant replication (same gate as admin-add: the local
	// vault must be authorized to write this identity's catalogue).
	jazz_engine::authorize_gate(
		shell,
		"identities",
		crate::identity_acc::AccOp::Write,
		identity_uuid,
		None,
	)?;

	let bisc_identity = shell
		.vault
		.identities
		.get(&identity_uuid)
		.ok_or_else(|| format!("identity {identity_uuid} not loaded in vault"))?;

	let already_replica = crate::identity_acc::identity_replicas(&bisc_identity.biscuit, identity_uuid)?
		.iter()
		.any(|d| d.trim() == peer_did.as_str());
	if already_replica {
		finish_spark_admin_grant(app, jazz, self_state, client, identity_uuid).await?;
		return Ok(());
	}

	let _ = client.flush_peer_sync().await;

	// Registry keyshare: `genesis_b64` + `name` are sealed, so without the identity DEK
	// the peer can't even hydrate the biscuit to USE its read grant. Wrap the DEK to the
	// peer so it can hydrate + decrypt the REGISTRY (member names). This makes the peer a
	// member of the aven's directory — it stays BLIND to user-data identities, for which it
	// never receives a keyshare (it only store-and-forwards their ciphertext).
	let dek_ver = shell
		.identity_versions
		.get(&identity_uuid)
		.copied()
		.ok_or_else(|| format!("missing dek version for identity {identity_uuid}"))?;
	let dek = shell
		.deks
		.get(&(identity_uuid, dek_ver))
		.ok_or_else(|| format!("missing DEK for identity {identity_uuid} v{dek_ver}"))?;
	let kek = crate::crypto::derive_kek_x25519(&shell.signing_key, &peer_pk)?;
	let ks_urn = jazz_engine::identity_urn(identity_uuid);
	let ks_aad = crate::crypto::keyshare_wrap_aad(&ks_urn, &peer_did, &shell.peer_did, dek_ver);
	let wrapped = crate::crypto::encrypt_keyshare_payload(&kek, dek.expose(), &ks_aad)?;
	let ks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "keyshares").await?;
	let mut ks = Map::new();
	ks.insert("owner".into(), JsonValue::String(identity_uuid.to_string()));
	ks.insert("dek_version".into(), JsonValue::Number(dek_ver.into()));
	ks.insert("recipient_did".into(), JsonValue::String(peer_did.clone()));
	ks.insert("wrapper_did".into(), JsonValue::String(shell.peer_did.clone()));
	ks.insert("wrapped_dek".into(), JsonValue::String(wrapped));
	let ks_vals = insert_values("keyshares", &ks_schema, ks)?;
	let ks_oid = ObjectId::new();
	let ks_meta = owner_binding_meta(&shell.signing_key, ks_oid, identity_uuid)?;
	client
		.create_with_id_and_metadata("keyshares", ks_oid, ks_vals, ks_meta)
		.await
		.map_err(format_jazz_err)?;

	// The SYNC bundle — all caps in the biscuit (single source of truth): blind
	// `replicate` (relay the encrypted DATA, no keyshare) + a TABLE-SCOPED `read` on the
	// registry tables ONLY (`identities:` + `peers:`) so the peer can see the aven + its
	// members but CANNOT read any data table (messages/todos stay blind — the E2E
	// boundary). The 10 MB quota + rate-limit ride the replicate cap-report (node-enforced).
	let chain = crate::identity_acc::attenuate_add_replicate_third_party(
		&shell.vault.biscuit_kp,
		&bisc_identity.biscuit,
		identity_uuid,
		&peer_did,
	)?;
	let chain = crate::identity_acc::attenuate_add_grant_third_party(
		&shell.vault.biscuit_kp,
		&chain,
		&peer_did,
		"read",
		&format!("identity:{identity_uuid}:identities:"),
	)?;
	let new_biscuit = crate::identity_acc::attenuate_add_grant_third_party(
		&shell.vault.biscuit_kp,
		&chain,
		&peer_did,
		"read",
		&format!("identity:{identity_uuid}:peers:"),
	)?;
	let genesis_vec = new_biscuit
		.to_vec()
		.map_err(|e| format!("biscuit_encode:{e:?}"))?;
	let genesis_b64 = URL_SAFE_NO_PAD.encode(genesis_vec);

	let sparks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "identities").await?;
	let identity_id_ix = jazz_engine::col_ix(&sparks_schema, "owner")?;
	let sparks_rows = jazz_engine::exec_list_rows(client.as_ref(), "identities").await?;
	let mut sparks_oid: Option<ObjectId> = None;
	for (oid, vals) in sparks_rows {
		let sid = jazz_engine::uuid_cell_at(vals.as_slice(), identity_id_ix)?;
		if sid == identity_uuid {
			sparks_oid = Some(oid);
			break;
		}
	}
	let sparks_oid =
		sparks_oid.ok_or_else(|| format!("no identities row for owner={identity_uuid}"))?;

	let mut patch_sparks = Map::new();
	patch_sparks.insert("genesis_b64".into(), JsonValue::String(genesis_b64));
	let sparks_ops = patch_updates(&sparks_schema, patch_sparks)?;
	let upd_meta = owner_binding_meta(&shell.signing_key, sparks_oid, identity_uuid)?;
	client
		.update_with_metadata(sparks_oid, sparks_ops, upd_meta)
		.await
		.map_err(format_jazz_err)?;

	finish_spark_admin_grant(app, jazz, self_state, client, identity_uuid).await?;

	Ok(())
}

/// Append biscuit third-party `reads` for `peerDid`, wrap the identity DEK to its
/// pubkey (a keyshare), and persist the updated `genesis_b64`. The grantee is a
/// **delegated reader / member**: it may decrypt and read this identity's rows but
/// holds **no `owns`** — it cannot write. This is how an onboarded peer is added
/// to `admin-identity` (its `reads` grant is the membership credential; its keyshare
/// lets it read the roster). Only a identity admin may grant it. Mirrors
/// `groove_ipc_spark_admin_add` but grants `reads` instead of `owns`.
pub(crate) async fn groove_ipc_spark_reader_add(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	owner: String,
	peer_did: String,
) -> Result<(), String> {
	use base64::engine::general_purpose::URL_SAFE_NO_PAD;
	use base64::Engine;

	let identity_uuid =
		Uuid::parse_str(owner.trim()).map_err(|e| format!("invalid owner UUID: {e}"))?;
	let peer_did = peer_did.trim().to_string();
	if peer_did.is_empty() {
		return Err("peer_did is empty".into());
	}

	let client = with_connected_client(jazz, app, self_state).await?;
	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();

	if peer_did == shell.peer_did {
		return Err("cannot grant read to your own DID".into());
	}
	let peer_pk = crate::jazz_auth::ed25519_public_from_peer_did(&peer_did)?;

	crate::peers::add_remote_peer(client.as_ref(), &peer_did, "").await?;
	if let Err(e) = client.register_peer_sync_client(PeerId(peer_pk)) {
		log::warn!(target: "avenos::jazz", "identity_reader_add register {peer_did}: {e}");
	}

	// Only a identity admin may grant read (same gate as admin/replicate add).
	jazz_engine::authorize_gate(shell, "identities", crate::identity_acc::AccOp::Write, identity_uuid, None)?;

	let bisc_identity = shell
		.vault
		.identities
		.get(&identity_uuid)
		.ok_or_else(|| format!("identity {identity_uuid} not loaded in vault"))?;
	let already_reader = crate::identity_acc::identity_readers(&bisc_identity.biscuit, identity_uuid)?
		.iter()
		.any(|d| d.trim() == peer_did.as_str());

	let _ = client.flush_peer_sync().await;

	// Wrap EVERY held DEK version to the reader (see admin_add) so a post-rotation re-grant
	// can read pre-rotation data. Idempotent — skips versions the reader already holds.
	wrap_all_dek_versions_to_recipient(client.as_ref(), shell, identity_uuid, &peer_did).await?;

	if !already_reader {
		let new_biscuit = crate::identity_acc::attenuate_add_reader_third_party(
			&shell.vault.biscuit_kp,
			&bisc_identity.biscuit,
			identity_uuid,
			&peer_did,
		)?;
		let genesis_vec = new_biscuit.to_vec().map_err(|e| format!("biscuit_encode:{e:?}"))?;
		let genesis_b64 = URL_SAFE_NO_PAD.encode(genesis_vec);

		let sparks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "identities").await?;
		let identity_id_ix = jazz_engine::col_ix(&sparks_schema, "owner")?;
		let sparks_rows = jazz_engine::exec_list_rows(client.as_ref(), "identities").await?;
		let mut sparks_oid: Option<ObjectId> = None;
		for (oid, vals) in sparks_rows {
			let sid = jazz_engine::uuid_cell_at(vals.as_slice(), identity_id_ix)?;
			if sid == identity_uuid {
				sparks_oid = Some(oid);
				break;
			}
		}
		let sparks_oid = sparks_oid.ok_or_else(|| format!("no identities row for owner={identity_uuid}"))?;
		let mut patch_sparks = Map::new();
		patch_sparks.insert("genesis_b64".into(), JsonValue::String(genesis_b64));
		let sparks_ops = patch_updates(&sparks_schema, patch_sparks)?;
		let upd_meta = owner_binding_meta(&shell.signing_key, sparks_oid, identity_uuid)?;
		client.update_with_metadata(sparks_oid, sparks_ops, upd_meta).await.map_err(format_jazz_err)?;
	}

	finish_spark_admin_grant(app, jazz, self_state, client, identity_uuid).await?;
	Ok(())
}

/// Claim the well-known **avenCEO** control identity (the network roster/membership
/// identity). Deterministic id from the network seed — every device sees the same
/// one. Claim-once: if a `identities` row already exists for it, it is already claimed
/// and this errors. Otherwise this device mints the genesis (becomes owner),
/// creates the `identities` row + a self keyshare, and re-hydrates. Mirrors the
/// bootstrap identity mint (`hydrate_shell`) but for a fixed id + name.
pub(crate) async fn groove_ipc_aven_ceo_claim(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
) -> Result<String, String> {
	use base64::engine::general_purpose::URL_SAFE_NO_PAD;
	use base64::Engine;

	let client = with_connected_client(jazz, app, self_state).await?;
	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();

	let identity_uuid = crate::identity_acc::aven_ceo_identity(tauri_plugin_self::network::NETWORK_SEED);

	let sparks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "identities").await?;
	let identity_id_ix = jazz_engine::col_ix(&sparks_schema, "owner")?;
	let issuer_ix = jazz_engine::col_ix(&sparks_schema, "issuer_pubkey_b64")?;
	let sparks_rows = jazz_engine::exec_list_rows(client.as_ref(), "identities").await?;
	let my_issuer = crate::identity_acc::encode_issuer_pubkey_b64(&shell.vault.biscuit_kp.public());
	for (_oid, vals) in &sparks_rows {
		if jazz_engine::uuid_cell_at(vals.as_slice(), identity_id_ix)? == identity_uuid {
			let issuer = match vals.get(issuer_ix) {
				Some(Value::Text(s)) => s.clone(),
				_ => String::new(),
			};
			if issuer == my_issuer {
				// Already claimed BY THIS DEVICE (e.g. after a restart) — idempotent:
				// ensure the owner roster row + re-hydrate so the app shows. NOT an error.
				ensure_aven_ceo_owner_row(client.as_ref(), &shell.peer_did, &shell.signing_key, identity_uuid).await?;
				finish_spark_admin_grant(app, jazz, self_state, client, identity_uuid).await?;
				return Ok(identity_uuid.to_string());
			}
			return Err("avenCEO is already claimed by another identity".into());
		}
	}

	// Mint genesis — this device's biscuit key roots the chain → it is the owner.
	let genesis = crate::identity_acc::mint_genesis_identity(&shell.vault, identity_uuid)?;
	let genesis_b64 =
		URL_SAFE_NO_PAD.encode(genesis.to_vec().map_err(|e| format!("genesis_encode:{e:?}"))?);
	let issuer_b64 = crate::identity_acc::encode_issuer_pubkey_b64(&shell.vault.biscuit_kp.public());
	let now_ms: i64 = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0);
	let dek_ver = 1i64;

	let mut row = Map::new();
	row.insert("owner".into(), JsonValue::String(identity_uuid.to_string()));
	row.insert("type".into(), JsonValue::String("aven".into()));
	row.insert(
		"name".into(),
		JsonValue::String(crate::identity_acc::AVEN_CEO_IDENTITY_NAME.to_string()),
	);
	row.insert("issuer_pubkey_b64".into(), JsonValue::String(issuer_b64));
	row.insert("genesis_b64".into(), JsonValue::String(genesis_b64));
	row.insert("current_dek_version".into(), JsonValue::Number(dek_ver.into()));
	row.insert("created_at_ms".into(), JsonValue::Number(now_ms.into()));
	let sparks_vals = insert_values("identities", &sparks_schema, row)?;
	let sparks_oid = ObjectId::new();
	let sparks_meta = owner_binding_meta(&shell.signing_key, sparks_oid, identity_uuid)?;
	client.create_with_id_and_metadata("identities", sparks_oid, sparks_vals, sparks_meta).await.map_err(format_jazz_err)?;

	// Self keyshare: wrap a fresh DEK to this device so the owner can read sealed
	// columns later (the roster is plaintext today, but keep the shape consistent).
	let dek_plain = crate::crypto::random_identity_dek();
	let urn = jazz_engine::identity_urn(identity_uuid);
	let kek = crate::crypto::derive_kek_x25519(&shell.signing_key, &shell.vault.ed25519_public)?;
	let aad = crate::crypto::keyshare_wrap_aad(&urn, &shell.peer_did, &shell.peer_did, dek_ver);
	let wrapped = crate::crypto::encrypt_keyshare_payload(&kek, dek_plain.expose(), &aad)?;
	let ks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "keyshares").await?;
	let mut ks = Map::new();
	ks.insert("owner".into(), JsonValue::String(identity_uuid.to_string()));
	ks.insert("dek_version".into(), JsonValue::Number(dek_ver.into()));
	ks.insert("recipient_did".into(), JsonValue::String(shell.peer_did.clone()));
	ks.insert("wrapper_did".into(), JsonValue::String(shell.peer_did.clone()));
	ks.insert("wrapped_dek".into(), JsonValue::String(wrapped));
	let ks_vals = insert_values("keyshares", &ks_schema, ks)?;
	let ks_oid = ObjectId::new();
	let ks_meta = owner_binding_meta(&shell.signing_key, ks_oid, identity_uuid)?;
	client.create_with_id_and_metadata("keyshares", ks_oid, ks_vals, ks_meta).await.map_err(format_jazz_err)?;

	// The owner is the first member: give it a roster row (populated from identity).
	ensure_aven_ceo_owner_row(client.as_ref(), &shell.peer_did, &shell.signing_key, identity_uuid).await?;

	finish_spark_admin_grant(app, jazz, self_state, client, identity_uuid).await?;
	Ok(identity_uuid.to_string())
}

/// Create a new user-owned identity (`type=aven` — a group/workspace). This device
/// mints a fresh genesis biscuit (→ owner) + DEK + self-keyshare + stamped `identities`
/// row + owner roster row, then re-hydrates. Backs the "+ create identity" grid action.
pub(crate) async fn groove_ipc_create_identity(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	name: String,
	kind: String,
) -> Result<String, String> {
	use base64::engine::general_purpose::URL_SAFE_NO_PAD;
	use base64::Engine;

	let name = name.trim().to_string();
	if name.is_empty() {
		return Err("identity name required".into());
	}
	let kind = if kind.trim() == "human" { "human" } else { "aven" };
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();

	let identity_uuid = uuid::Uuid::new_v4();
	let sparks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "identities").await?;

	let genesis = crate::identity_acc::mint_genesis_identity(&shell.vault, identity_uuid)?;
	let genesis_b64 =
		URL_SAFE_NO_PAD.encode(genesis.to_vec().map_err(|e| format!("genesis_encode:{e:?}"))?);
	let issuer_b64 = crate::identity_acc::encode_issuer_pubkey_b64(&shell.vault.biscuit_kp.public());
	let now_ms: i64 = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0);
	let dek_ver = 1i64;

	let mut row = Map::new();
	row.insert("owner".into(), JsonValue::String(identity_uuid.to_string()));
	row.insert("type".into(), JsonValue::String(kind.into()));
	row.insert("name".into(), JsonValue::String(name.clone()));
	if kind == "human" {
		let slug: String = name
			.to_lowercase()
			.chars()
			.map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
			.collect::<String>()
			.trim_matches('-')
			.to_string();
		row.insert("username_slug".into(), JsonValue::String(slug));
	}
	row.insert("issuer_pubkey_b64".into(), JsonValue::String(issuer_b64));
	row.insert("genesis_b64".into(), JsonValue::String(genesis_b64));
	row.insert("current_dek_version".into(), JsonValue::Number(dek_ver.into()));
	row.insert("created_at_ms".into(), JsonValue::Number(now_ms.into()));
	let sparks_vals = insert_values("identities", &sparks_schema, row)?;
	let sparks_oid = ObjectId::new();
	let sparks_meta = owner_binding_meta(&shell.signing_key, sparks_oid, identity_uuid)?;
	client
		.create_with_id_and_metadata("identities", sparks_oid, sparks_vals, sparks_meta)
		.await
		.map_err(format_jazz_err)?;

	// Self keyshare: wrap a fresh DEK to this device so the owner can read sealed columns.
	let dek_plain = crate::crypto::random_identity_dek();
	let urn = jazz_engine::identity_urn(identity_uuid);
	let kek = crate::crypto::derive_kek_x25519(&shell.signing_key, &shell.vault.ed25519_public)?;
	let aad = crate::crypto::keyshare_wrap_aad(&urn, &shell.peer_did, &shell.peer_did, dek_ver);
	let wrapped = crate::crypto::encrypt_keyshare_payload(&kek, dek_plain.expose(), &aad)?;
	let ks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "keyshares").await?;
	let mut ks = Map::new();
	ks.insert("owner".into(), JsonValue::String(identity_uuid.to_string()));
	ks.insert("dek_version".into(), JsonValue::Number(dek_ver.into()));
	ks.insert("recipient_did".into(), JsonValue::String(shell.peer_did.clone()));
	ks.insert("wrapper_did".into(), JsonValue::String(shell.peer_did.clone()));
	ks.insert("wrapped_dek".into(), JsonValue::String(wrapped));
	let ks_vals = insert_values("keyshares", &ks_schema, ks)?;
	let ks_oid = ObjectId::new();
	let ks_meta = owner_binding_meta(&shell.signing_key, ks_oid, identity_uuid)?;
	client
		.create_with_id_and_metadata("keyshares", ks_oid, ks_vals, ks_meta)
		.await
		.map_err(format_jazz_err)?;

	ensure_aven_ceo_owner_row(client.as_ref(), &shell.peer_did, &shell.signing_key, identity_uuid)
		.await?;
	finish_spark_admin_grant(app, jazz, self_state, client, identity_uuid).await?;
	Ok(identity_uuid.to_string())
}

/// **M9-3/M9-4** — create (idempotently) a **sub-group** of `identity` labeled `label`: a
/// collection group (`label = "todos"`) or a row group (`label = <row_id>`). The group is a
/// hydratable owner with its OWN DEK and a genesis that **extends** the parent, so the
/// parent's members inherit access (authorize recurses to the parent) while its rows seal
/// under the group's own key. Granularity is purely the `label` you pass — the data model is
/// identical to an identity. Only the parent's owner may create it. Returns the deterministic
/// group id (`derive_subgroup_id(identity, label)`). Additive: existing rows are untouched
/// and still default to the identity group.
pub(crate) async fn groove_ipc_create_collection_group(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	identity: String,
	label: String,
) -> Result<String, String> {
	use base64::engine::general_purpose::URL_SAFE_NO_PAD;
	use base64::Engine;

	let parent_id =
		Uuid::parse_str(identity.trim()).map_err(|e| format!("invalid identity UUID: {e}"))?;
	let label = label.trim().to_string();
	if label.is_empty() {
		return Err("group label required".into());
	}
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();

	// Only the parent identity's owner may carve out a sub-group.
	jazz_engine::authorize_gate(shell, "identities", crate::identity_acc::AccOp::Write, parent_id, None)?;

	let group_id = crate::identity_acc::derive_subgroup_id(parent_id, &label);

	let sparks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "identities").await?;
	let id_ix = jazz_engine::col_ix(&sparks_schema, "owner")?;
	// Idempotent: if the group's row already exists, return it (deterministic id).
	for (_oid, vals) in jazz_engine::exec_list_rows(client.as_ref(), "identities").await? {
		if jazz_engine::uuid_cell_at(vals.as_slice(), id_ix)? == group_id {
			return Ok(group_id.to_string());
		}
	}

	let genesis = crate::identity_acc::mint_group_genesis_extending(&shell.vault, group_id, parent_id)?;
	let genesis_b64 =
		URL_SAFE_NO_PAD.encode(genesis.to_vec().map_err(|e| format!("genesis_encode:{e:?}"))?);
	let issuer_b64 = crate::identity_acc::encode_issuer_pubkey_b64(&shell.vault.biscuit_kp.public());
	let now_ms: i64 = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0);
	let dek_ver = 1i64;

	let mut row = Map::new();
	row.insert("owner".into(), JsonValue::String(group_id.to_string()));
	row.insert("type".into(), JsonValue::String("group".into()));
	row.insert("name".into(), JsonValue::String(label.clone()));
	row.insert("issuer_pubkey_b64".into(), JsonValue::String(issuer_b64));
	row.insert("genesis_b64".into(), JsonValue::String(genesis_b64));
	row.insert("current_dek_version".into(), JsonValue::Number(dek_ver.into()));
	row.insert("created_at_ms".into(), JsonValue::Number(now_ms.into()));
	let sparks_vals = insert_values("identities", &sparks_schema, row)?;
	let sparks_oid = ObjectId::new();
	let sparks_meta = owner_binding_meta(&shell.signing_key, sparks_oid, group_id)?;
	client
		.create_with_id_and_metadata("identities", sparks_oid, sparks_vals, sparks_meta)
		.await
		.map_err(format_jazz_err)?;

	// The group's OWN DEK, keyshared to the creator. Parent members inherit it via the
	// 2-level key hierarchy (the group key wrapped under the parent group key).
	let dek_plain = crate::crypto::random_identity_dek();
	let urn = jazz_engine::identity_urn(group_id);
	let kek = crate::crypto::derive_kek_x25519(&shell.signing_key, &shell.vault.ed25519_public)?;
	let aad = crate::crypto::keyshare_wrap_aad(&urn, &shell.peer_did, &shell.peer_did, dek_ver);
	let wrapped = crate::crypto::encrypt_keyshare_payload(&kek, dek_plain.expose(), &aad)?;
	let ks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "keyshares").await?;
	let mut ks = Map::new();
	ks.insert("owner".into(), JsonValue::String(group_id.to_string()));
	ks.insert("dek_version".into(), JsonValue::Number(dek_ver.into()));
	ks.insert("recipient_did".into(), JsonValue::String(shell.peer_did.clone()));
	ks.insert("wrapper_did".into(), JsonValue::String(shell.peer_did.clone()));
	ks.insert("wrapped_dek".into(), JsonValue::String(wrapped));
	let ks_vals = insert_values("keyshares", &ks_schema, ks)?;
	let ks_oid = ObjectId::new();
	let ks_meta = owner_binding_meta(&shell.signing_key, ks_oid, group_id)?;
	client
		.create_with_id_and_metadata("keyshares", ks_oid, ks_vals, ks_meta)
		.await
		.map_err(format_jazz_err)?;

	finish_spark_admin_grant(app, jazz, self_state, client, group_id).await?;
	Ok(group_id.to_string())
}

/// Idempotently ensure THIS device has its own avenCEO roster row, populated from
/// identity (name from `humans`, device label from the local peer). No-op if the
/// row already exists. Used at claim and idempotent re-claim.
async fn ensure_aven_ceo_owner_row(
	client: &JazzClient,
	peer_did: &str,
	signing_key: &ed25519_dalek::SigningKey,
	identity_uuid: Uuid,
) -> Result<(), String> {
	let peers_schema = jazz_engine::resolved_table_schema(client, "peers").await?;
	let identity_ix = jazz_engine::col_ix(&peers_schema, "owner")?;
	let did_ix = jazz_engine::col_ix(&peers_schema, "peer_did")?;
	let rows = jazz_engine::exec_list_rows(client, "peers").await?;
	for (_o, vals) in &rows {
		let sid = jazz_engine::uuid_cell_at(vals.as_slice(), identity_ix).ok();
		let d = match vals.get(did_ix) {
			Some(Value::Text(s)) => s.as_str(),
			_ => "",
		};
		if sid == Some(identity_uuid) && d == peer_did {
			return Ok(());
		}
	}
	let (name, label) = read_own_profile(client, peer_did).await;
	let now_ms: i64 = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0);
	let mut prow = Map::new();
	prow.insert("owner".into(), JsonValue::String(identity_uuid.to_string()));
	prow.insert("peer_did".into(), JsonValue::String(peer_did.to_string()));
	prow.insert("kind".into(), JsonValue::String("member".into()));
	prow.insert("status".into(), JsonValue::String("active".into()));
	prow.insert("account_name".into(), JsonValue::String(name));
	prow.insert("device_label".into(), JsonValue::String(label));
	prow.insert("added_at_ms".into(), JsonValue::Number(now_ms.into()));
	let prow_vals = insert_values("peers", &peers_schema, prow)?;
	let prow_oid = ObjectId::new();
	let prow_meta = owner_binding_meta(signing_key, prow_oid, identity_uuid)?;
	client.create_with_id_and_metadata("peers", prow_oid, prow_vals, prow_meta).await.map_err(format_jazz_err)?;
	Ok(())
}

/// Read this device's self profile for auto-publishing into the roster: display
/// name from the singleton `humans.first_name`, device label from this device's
/// own (`kind=local`/own-DID) `peers` row. Both best-effort (empty if unset).
async fn read_own_profile(client: &JazzClient, peer_did: &str) -> (String, String) {
	let mut name = String::new();
	let mut label = String::new();
	// Display name from this device's own (human-typed) identity. `name` is sealed,
	// so the roster uses the plaintext `username_slug` handle (best-effort).
	if let Ok(schema) = jazz_engine::resolved_table_schema(client, "identities").await {
		if let (Ok(type_ix), Ok(slug_ix)) = (
			jazz_engine::col_ix(&schema, "type"),
			jazz_engine::col_ix(&schema, "username_slug"),
		) {
			if let Ok(rows) = jazz_engine::exec_list_rows(client, "identities").await {
				for (_o, vals) in rows {
					let is_human =
						matches!(vals.get(type_ix), Some(Value::Text(t)) if t.trim() == "human");
					if is_human {
						if let Some(Value::Text(s)) = vals.get(slug_ix) {
							if !s.trim().is_empty() {
								name = s.trim().to_string();
								break;
							}
						}
					}
				}
			}
		}
	}
	if let Ok(schema) = jazz_engine::resolved_table_schema(client, "peers").await {
		if let (Ok(did_ix), Ok(label_ix)) = (
			jazz_engine::col_ix(&schema, "peer_did"),
			jazz_engine::col_ix(&schema, "device_label"),
		) {
			if let Ok(rows) = jazz_engine::exec_list_rows(client, "peers").await {
				for (_o, vals) in rows {
					let d = match vals.get(did_ix) {
						Some(Value::Text(s)) => s.as_str(),
						_ => "",
					};
					if d == peer_did {
						if let Some(Value::Text(s)) = vals.get(label_ix) {
							if !s.trim().is_empty() {
								label = s.trim().to_string();
							}
						}
						break;
					}
				}
			}
		}
	}
	(name, label)
}

/// Add a member to the avenCEO roster — the inverted-invite / DID-push onboarding.
/// The owner pastes a candidate DID and grants the membership BUNDLE: `reads` on
/// avenCEO (read the whole roster) + a keyshare + a ROW-SCOPED `write` on the
/// member's OWN roster row (so it can self-publish its profile, nothing else). The
/// row is created here so its object id can scope the write grant. Owner-only.
pub(crate) async fn groove_ipc_aven_ceo_add_member(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	peer_did: String,
) -> Result<(), String> {
	use base64::engine::general_purpose::URL_SAFE_NO_PAD;
	use base64::Engine;

	let peer_did = peer_did.trim().to_string();
	if peer_did.is_empty() {
		return Err("peer_did is empty".into());
	}
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();
	if peer_did == shell.peer_did {
		return Err("cannot add yourself as a member".into());
	}
	let peer_pk = crate::jazz_auth::ed25519_public_from_peer_did(&peer_did)?;
	let identity_uuid = crate::identity_acc::aven_ceo_identity(tauri_plugin_self::network::NETWORK_SEED);

	crate::peers::add_remote_peer(client.as_ref(), &peer_did, "").await?;
	if let Err(e) = client.register_peer_sync_client(PeerId(peer_pk)) {
		log::warn!(target: "avenos::jazz", "aven_ceo_add_member register {peer_did}: {e}");
	}

	// Only the avenCEO owner may add members.
	jazz_engine::authorize_gate(shell, "identities", crate::identity_acc::AccOp::Write, identity_uuid, None)?;

	// Fail fast (before creating the roster row) if this device doesn't hold the avenCEO
	// DEK — without it we can't mint the member's keyshare.
	if !shell.deks.keys().any(|(sid, _)| *sid == identity_uuid) {
		return Err("avenCEO identity not claimed / not loaded on this device".to_string());
	}

	let _ = client.flush_peer_sync().await;

	// 1. Create the member's roster row — its object id scopes the write grant.
	let now_ms: i64 = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0);
	let peers_schema = jazz_engine::resolved_table_schema(client.as_ref(), "peers").await?;
	let mut prow = Map::new();
	prow.insert("owner".into(), JsonValue::String(identity_uuid.to_string()));
	prow.insert("peer_did".into(), JsonValue::String(peer_did.clone()));
	prow.insert("kind".into(), JsonValue::String("member".into()));
	prow.insert("status".into(), JsonValue::String("active".into()));
	prow.insert("added_at_ms".into(), JsonValue::Number(now_ms.into()));
	let prow_vals = insert_values("peers", &peers_schema, prow)?;
	let member_oid = ObjectId::new();
	let prow_meta = owner_binding_meta(&shell.signing_key, member_oid, identity_uuid)?;
	client.create_with_id_and_metadata("peers", member_oid, prow_vals, prow_meta).await.map_err(format_jazz_err)?;

	// 2. Keyshare: wrap EVERY held avenCEO DEK version to the member so it can decrypt the
	//    sealed roster fields (and prior-version data after any rotation). Idempotent.
	wrap_all_dek_versions_to_recipient(client.as_ref(), shell, identity_uuid, &peer_did).await?;

	// 3. Membership bundle in the biscuit: reads (whole roster) + write (own row only).
	let bisc = shell
		.vault
		.identities
		.get(&identity_uuid)
		.ok_or_else(|| "avenCEO identity not loaded in vault".to_string())?;
	let row_prefix = format!("identity:{identity_uuid}:peers:{}", member_oid.uuid());
	let chain = crate::identity_acc::attenuate_add_reader_third_party(
		&shell.vault.biscuit_kp,
		&bisc.biscuit,
		identity_uuid,
		&peer_did,
	)?;
	let chain = crate::identity_acc::attenuate_add_grant_third_party(
		&shell.vault.biscuit_kp,
		&chain,
		&peer_did,
		"write",
		&row_prefix,
	)?;
	let genesis_b64 =
		URL_SAFE_NO_PAD.encode(chain.to_vec().map_err(|e| format!("biscuit_encode:{e:?}"))?);

	let sparks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "identities").await?;
	let identity_id_ix = jazz_engine::col_ix(&sparks_schema, "owner")?;
	let sparks_rows = jazz_engine::exec_list_rows(client.as_ref(), "identities").await?;
	let mut sparks_oid: Option<ObjectId> = None;
	for (oid, vals) in sparks_rows {
		if jazz_engine::uuid_cell_at(vals.as_slice(), identity_id_ix)? == identity_uuid {
			sparks_oid = Some(oid);
			break;
		}
	}
	let sparks_oid = sparks_oid.ok_or_else(|| "no avenCEO identities row".to_string())?;
	let mut patch = Map::new();
	patch.insert("genesis_b64".into(), JsonValue::String(genesis_b64));
	let ops = patch_updates(&sparks_schema, patch)?;
	let upd_meta = owner_binding_meta(&shell.signing_key, sparks_oid, identity_uuid)?;
	client.update_with_metadata(sparks_oid, ops, upd_meta).await.map_err(format_jazz_err)?;

	finish_spark_admin_grant(app, jazz, self_state, client, identity_uuid).await?;
	Ok(())
}

/// Member self-publishes its profile into its OWN avenCEO roster row (the row the
/// owner created at `add_member`). Finds the row by this device's DID and updates
/// `account_name` + `device_label`; the local biscuit gate authorizes the write
/// via the row-scoped `grant(did,"write",identity:avenCEO:peers:<ownRow>)`.
pub(crate) async fn groove_ipc_aven_ceo_publish_profile(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	account_name: String,
	device_label: String,
) -> Result<(), String> {
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();
	let identity_uuid = crate::identity_acc::aven_ceo_identity(tauri_plugin_self::network::NETWORK_SEED);

	let peers_schema = jazz_engine::resolved_table_schema(client.as_ref(), "peers").await?;
	let identity_ix = jazz_engine::col_ix(&peers_schema, "owner")?;
	let did_ix = jazz_engine::col_ix(&peers_schema, "peer_did")?;
	let rows = jazz_engine::exec_list_rows(client.as_ref(), "peers").await?;
	let mut own_oid: Option<ObjectId> = None;
	for (oid, vals) in rows {
		let sid = jazz_engine::uuid_cell_at(vals.as_slice(), identity_ix).ok();
		let did = match vals.get(did_ix) {
			Some(Value::Text(s)) => s.as_str(),
			_ => "",
		};
		if sid == Some(identity_uuid) && did == shell.peer_did.as_str() {
			own_oid = Some(oid);
			break;
		}
	}
	let own_oid = own_oid
		.ok_or_else(|| "no avenCEO roster row for this device yet — ask an admin to add your DID".to_string())?;

	// Biscuit gate: this device holds write on its own row (and nothing else).
	jazz_engine::authorize_gate(
		shell,
		"peers",
		crate::identity_acc::AccOp::Write,
		identity_uuid,
		Some(*own_oid.uuid()),
	)?;

	// Auto-publish from this device's identity when the caller passes blanks
	// (name from humans.first_name, label from the local device peer row).
	let (def_name, def_label) = read_own_profile(client.as_ref(), &shell.peer_did).await;
	let name = if account_name.trim().is_empty() {
		def_name
	} else {
		account_name.trim().to_string()
	};
	let label = if device_label.trim().is_empty() {
		def_label
	} else {
		device_label.trim().to_string()
	};

	let mut patch = Map::new();
	patch.insert("account_name".into(), JsonValue::String(name));
	patch.insert("device_label".into(), JsonValue::String(label));
	let ops = patch_updates(&peers_schema, patch)?;
	let upd_meta = owner_binding_meta(&shell.signing_key, own_oid, identity_uuid)?;
	client.update_with_metadata(own_oid, ops, upd_meta).await.map_err(format_jazz_err)?;
	Ok(())
}

/// Network membership for the invite-only gate: does this device hold an avenCEO
/// cap in its **vault**? Returns `owner` | `member` | `none`. A pure local vault
/// check (no sync/store dependency) — the server is the authority that grants
/// caps (auto-grants the first peer, invites the rest); this just reads what the
/// device already holds. The gate flips to `owner`/`member` once the server's
/// grant + keyshare have synced and hydrated avenCEO into the vault.
pub(crate) async fn groove_ipc_aven_ceo_membership(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
) -> Result<String, String> {
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();
	let identity_uuid = crate::identity_acc::aven_ceo_identity(tauri_plugin_self::network::NETWORK_SEED);
	let Some(bisc) = shell.vault.identities.get(&identity_uuid) else {
		return Ok("none".to_string());
	};
	if crate::identity_acc::identity_peer_is_owner(&bisc.biscuit, identity_uuid, &shell.peer_did)? {
		return Ok("owner".to_string());
	}
	// Merely HYDRATING the avenCEO genesis is NOT membership — the genesis syncs widely, so a
	// device can hold the identity in its vault with no grant at all. Membership requires an
	// actual cap to THIS device (a `reads` or `replicate` grant). Without one, the device has
	// only *seen* avenCEO and must stay on the invite gate — no auto-progress without caps.
	let did = shell.peer_did.trim();
	let is_reader = crate::identity_acc::identity_readers(&bisc.biscuit, identity_uuid)?
		.iter()
		.any(|d| d.trim() == did);
	let is_replica = crate::identity_acc::identity_replicas(&bisc.biscuit, identity_uuid)?
		.iter()
		.any(|d| d.trim() == did);
	if is_reader || is_replica {
		Ok("member".to_string())
	} else {
		Ok("none".to_string())
	}
}

/// Re-hydrate vault shell + sync ACL, push grant to peers, refresh identities catalogue in the webview.
async fn finish_spark_admin_grant(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	client: Arc<JazzClient>,
	_spark_uuid: uuid::Uuid,
) -> Result<(), String> {
	jazz.invalidate_vault_shell();
	let shell = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;

	// The grant just changed authorization (the peer is now `owns` in our
	// biscuit). Re-announce our frontier to every peer so the newly-authorized
	// peer re-pulls and the gate — now `Allow` — ships the identity's existing data
	// (§1.4: grant routes through the one forwarding path, like revoke). Without
	// this, data created before the grant was announced-and-denied and never
	// re-ships. Generic: re-announce covers every identity/table, not just one type.
	if let Err(e) = client.rebroadcast_all_peer_clients_and_flush().await {
		log::warn!(target: "avenos::jazz", "post-grant peer re-announce failed: {e}");
	}

	let _ = jazz
		.publish_table_snapshot_force(app, client.as_ref(), shell.as_ref(), "identities")
		.await;

	// Republish the trusted-peer roster + mesh snapshot so the member's chip
	// reflects the now-registered peer immediately (otherwise it stays stale on
	// "Connecting" even though the peer is a live sync client).
	let _ = publish_trusted_peers_ui(app, jazz, self_state).await;

	enqueue_vault_catalogue_drain(app).await;

	Ok(())
}

/// One subject's caps on a identity, read straight from the biscuit — the single
/// source of truth the UI renders (no hardcoded cap lists client-side).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectCapsDto {
	pub did: String,
	/// `owns` | `reads` | `replicate`
	pub grant: String,
	/// Effective caps (e.g. `read`, `write`, `delete`, `admit`, `rotate_dek`, `replicate`).
	pub caps: Vec<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityAdminListReply {
	pub admin_dids: Vec<String>,
	/// Server avens granted a blind `replicate` cap on this identity (store-and-forward
	/// backups; not members). Persisted in the identity biscuit, so they survive
	/// reloads and surface alongside members in the access list.
	pub replica_dids: Vec<String>,
	/// THE cap source of truth: every subject (owner/reader/replica) with its grant
	/// and effective caps, derived from the biscuit by `identity_acc::identity_cap_report`.
	/// The Members UI renders these directly; it defines no cap vocabulary of its own.
	pub subjects: Vec<SubjectCapsDto>,
}

/// Who can access this identity: administrators (biscuit `owns`) + blind replication
/// peers (biscuit `replicate`).
pub(crate) async fn groove_ipc_spark_admin_list(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	owner: String,
) -> Result<IdentityAdminListReply, String> {
	let identity_uuid =
		Uuid::parse_str(owner.trim()).map_err(|e| format!("invalid owner UUID: {e}"))?;

	let client = with_connected_client(jazz, app, self_state).await?;
	let shell = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let bs = shell
		.vault
		.identities
		.get(&identity_uuid)
		.ok_or_else(|| format!("identity {identity_uuid} not in vault"))?;
	let mut admin_dids: Vec<String> = crate::identity_acc::identity_admins(&bs.biscuit, identity_uuid)?
		.into_iter()
		.collect();
	admin_dids.sort();
	let mut replica_dids: Vec<String> =
		crate::identity_acc::identity_replicas(&bs.biscuit, identity_uuid)?
			.into_iter()
			.collect();
	replica_dids.sort();
	// Single source of truth: derive every subject's caps from the biscuit chain.
	let subjects = crate::identity_acc::identity_cap_report(&bs.biscuit, identity_uuid)?
		.into_iter()
		.map(|s| SubjectCapsDto {
			did: s.did,
			grant: s.grant.to_string(),
			caps: s.caps.iter().map(|c| c.to_string()).collect(),
		})
		.collect();
	Ok(IdentityAdminListReply {
		admin_dids,
		replica_dids,
		subjects,
	})
}

/// v2 per-identity revoke = **key rotation**. Removes `peer_did` from `owner`:
///  1. re-mint the identity biscuit WITHOUT the peer (the gate now denies it new
///     frames for this identity — it stays a peer for any OTHER shared identities),
///  2. rotate the DEK to v+1 and keyshare v+1 to the REMAINING members ONLY, so
///     the revoked peer never receives the new key → cannot decrypt new data,
///  3. delete the revoked peer's keyshare rows (cooperative cleanup of old keys),
///  4. bump `identities.current_dek_version` so future writes seal under v+1.
///
/// Old data stays readable to remaining members (they keep the old DEK); the
/// revoked peer keeps only what it already decrypted (not retroactive — physics).
/// Owner-scoped: the re-mint re-roots the chain to this device's biscuit key and
/// updates the stored issuer (the common case is This device = OWNER).
pub(crate) async fn groove_ipc_spark_admin_revoke(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	owner: String,
	peer_did: String,
) -> Result<(), String> {
	use base64::engine::general_purpose::URL_SAFE_NO_PAD;
	use base64::Engine;

	let identity_uuid =
		Uuid::parse_str(owner.trim()).map_err(|e| format!("invalid owner UUID: {e}"))?;
	let peer_did = peer_did.trim().to_string();
	if peer_did.is_empty() {
		return Err("peer_did is empty".into());
	}

	let client = with_connected_client(jazz, app, self_state).await?;
	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();

	if peer_did == shell.peer_did {
		return Err("cannot revoke your own access".into());
	}

	// Must hold write on this identity to manage its members.
	jazz_engine::authorize_gate(shell, "identities", crate::identity_acc::AccOp::Write, identity_uuid, None)?;

	let cur_v = shell
		.identity_versions
		.get(&identity_uuid)
		.copied()
		.ok_or_else(|| format!("missing dek version for identity {identity_uuid}"))?;
	// Who actually HOLDS the DEK for this identity = keyshare recipients (owner +
	// readers + admins). A blind `replicate` relay is NOT here — it never got a keyshare.
	let ks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "keyshares").await?;
	let ks_spark_ix = jazz_engine::col_ix(&ks_schema, "owner")?;
	let ks_recip_ix = jazz_engine::col_ix(&ks_schema, "recipient_did")?;
	let ks_rows_now = jazz_engine::exec_list_rows(client.as_ref(), "keyshares").await?;
	let mut prior_holders: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
	for (_oid, vals) in &ks_rows_now {
		if jazz_engine::uuid_cell_at(vals.as_slice(), ks_spark_ix)? == identity_uuid {
			if let Some(Value::Text(s)) = vals.get(ks_recip_ix) {
				prior_holders.insert(s.clone());
			}
		}
	}

	// 1. Re-mint biscuit excluding the revoked peer (drops its grant from the chain).
	let new_biscuit =
		crate::identity_acc::rebuild_identity_biscuit_excluding(&shell.vault, identity_uuid, &peer_did)?;

	// 2. ALWAYS rotate the DEK — revoke = remove + rotate (forward secrecy by default,
	//    no per-peer special-casing). Re-wrap the fresh v+1 key to every remaining
	//    keyshare-holder (owner + readers + admins) MINUS the revoked peer — NOT just
	//    admins (the prior bug dropped `reads`-members from v+1, so their follow-up
	//    messages stopped decrypting). A blind `replicate` relay isn't a holder, so it's
	//    simply never re-wrapped; the rotated ciphertext still flows through it and
	//    members decrypt at v+1.
	let new_v = cur_v + 1;
	let new_dek = crate::crypto::random_identity_dek();
	let urn = jazz_engine::identity_urn(identity_uuid);
	for recip_did in prior_holders.iter().filter(|d| d.as_str() != peer_did.as_str()) {
		let recip_pk = crate::jazz_auth::ed25519_public_from_peer_did(recip_did)?;
		let kek = crate::crypto::derive_kek_x25519(&shell.signing_key, &recip_pk)?;
		let aad = crate::crypto::keyshare_wrap_aad(&urn, recip_did, &shell.peer_did, new_v);
		let wrapped = crate::crypto::encrypt_keyshare_payload(&kek, new_dek.expose(), &aad)?;
		let mut ks = Map::new();
		ks.insert("owner".into(), JsonValue::String(identity_uuid.to_string()));
		ks.insert("dek_version".into(), JsonValue::Number(new_v.into()));
		ks.insert("recipient_did".into(), JsonValue::String(recip_did.clone()));
		ks.insert("wrapper_did".into(), JsonValue::String(shell.peer_did.clone()));
		ks.insert("wrapped_dek".into(), JsonValue::String(wrapped));
		let ks_vals = insert_values("keyshares", &ks_schema, ks)?;
		let ks_oid = ObjectId::new();
		let ks_meta = owner_binding_meta(&shell.signing_key, ks_oid, identity_uuid)?;
		client
			.create_with_id_and_metadata("keyshares", ks_oid, ks_vals, ks_meta)
			.await
			.map_err(format_jazz_err)?;
	}

	// 3. Update the identities row: new biscuit + issuer + bumped current version.
	let genesis_b64 = URL_SAFE_NO_PAD.encode(
		new_biscuit
			.to_vec()
			.map_err(|e| format!("biscuit_encode:{e:?}"))?,
	);
	let issuer_b64 = crate::identity_acc::encode_issuer_pubkey_b64(&shell.vault.biscuit_kp.public());
	let sparks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "identities").await?;
	let identity_id_ix = jazz_engine::col_ix(&sparks_schema, "owner")?;
	let sparks_rows = jazz_engine::exec_list_rows(client.as_ref(), "identities").await?;
	let mut sparks_oid: Option<ObjectId> = None;
	for (oid, vals) in sparks_rows {
		if jazz_engine::uuid_cell_at(vals.as_slice(), identity_id_ix)? == identity_uuid {
			sparks_oid = Some(oid);
			break;
		}
	}
	let sparks_oid =
		sparks_oid.ok_or_else(|| format!("no identities row for owner={identity_uuid}"))?;
	let mut patch = Map::new();
	patch.insert("genesis_b64".into(), JsonValue::String(genesis_b64));
	patch.insert("issuer_pubkey_b64".into(), JsonValue::String(issuer_b64));
	patch.insert("current_dek_version".into(), JsonValue::Number(new_v.into()));
	let ops = patch_updates(&sparks_schema, patch)?;
	let upd_meta = owner_binding_meta(&shell.signing_key, sparks_oid, identity_uuid)?;
	client
		.update_with_metadata(sparks_oid, ops, upd_meta)
		.await
		.map_err(format_jazz_err)?;

	// 4. Cooperative cleanup: delete the revoked peer's keyshare rows (all
	//    versions) so honest peers drop them. (The peer keeps only whatever it
	//    already decrypted; it never gets v+1.)
	let ks_spark_ix = jazz_engine::col_ix(&ks_schema, "owner")?;
	let ks_recip_ix = jazz_engine::col_ix(&ks_schema, "recipient_did")?;
	let ks_rows = jazz_engine::exec_list_rows(client.as_ref(), "keyshares").await?;
	for (oid, vals) in ks_rows {
		let sid = jazz_engine::uuid_cell_at(vals.as_slice(), ks_spark_ix)?;
		let recip = match vals.get(ks_recip_ix) {
			Some(Value::Text(s)) => s.as_str(),
			_ => continue,
		};
		if sid == identity_uuid && recip == peer_did.as_str() {
			let del_meta = owner_binding_meta(&shell.signing_key, oid, identity_uuid)?;
			let _ = client.delete_with_metadata(oid, del_meta).await;
		}
	}

	// Rehydrate (load v+1 DEK from our keyshare; identity_versions → v+1) and
	// re-announce so remaining peers pull the new biscuit + v+1 keyshares; the
	// revoked peer's gate now denies this identity. Reuses the grant finish path.
	finish_spark_admin_grant(app, jazz, self_state, client, identity_uuid).await?;

	Ok(())
}

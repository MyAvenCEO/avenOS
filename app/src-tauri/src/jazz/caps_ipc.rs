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
	let recipient_pk = crate::jazz_auth::ed25519_public_from_signer_did(recipient_did)?;
	let kek = crate::crypto::derive_kek_x25519(&shell.signing_key, &recipient_pk)?;
	let urn = jazz_engine::safe_urn(identity_uuid);

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
		let aad = crate::crypto::keyshare_wrap_aad(&urn, recipient_did, &shell.signer_did, v);
		let wrapped = crate::crypto::encrypt_keyshare_payload(&kek, dek.expose(), &aad)?;
		log::info!(
			target: "avenos::jazz",
			"keyshare wrap: identity={identity_uuid} v={v} → {recipient_did}",
		);
		let mut ks = Map::new();
		ks.insert("owner".into(), JsonValue::String(identity_uuid.to_string()));
		ks.insert("dek_version".into(), JsonValue::Number(v.into()));
		ks.insert("recipient_did".into(), JsonValue::String(recipient_did.to_string()));
		ks.insert("wrapper_did".into(), JsonValue::String(shell.signer_did.clone()));
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
/// The shared grant ritual: locate an identity's row, seal the new `genesis_b64` under the
/// identity DEK, sign the owner-binding, and persist it. Every admin/member/replicate grant
/// funnels through here, so the seal coordinate + owner-binding are applied in exactly one place.
async fn update_identity_genesis(
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
	identity: Uuid,
	genesis_b64: String,
) -> Result<(), String> {
	let sparks_schema = jazz_engine::resolved_table_schema(client, "safes").await?;
	let sparks_oid = jazz_engine::find_identity_oid(client, &sparks_schema, identity).await?;
	let mut patch = Map::new();
	patch.insert("genesis_b64".into(), JsonValue::String(genesis_b64));
	jazz_engine::seal_sensitive_in_patch(
		shell,
		"safes",
		&sparks_schema,
		identity,
		*sparks_oid.uuid(),
		&mut patch,
	)?;
	let ops = patch_updates(&sparks_schema, patch)?;
	let upd_meta = owner_binding_meta(&shell.signing_key, sparks_oid, identity)?;
	client
		.update_with_metadata(sparks_oid, ops, upd_meta)
		.await
		.map_err(format_jazz_err)?;
	Ok(())
}

/// Wrap a freshly-minted identity/group DEK to the creating device and write the
/// self-keyshare row, so the owner can read sealed columns later. Shared by the three
/// mint IPCs (`create_identity`, `aven_ceo_claim`, `create_collection_group`).
async fn wrap_self_keyshare(
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
	identity: Uuid,
	dek_plain: &crate::crypto::Dek,
	dek_ver: i64,
) -> Result<(), String> {
	let urn = jazz_engine::safe_urn(identity);
	let kek = crate::crypto::derive_kek_x25519(&shell.signing_key, &shell.vault.ed25519_public)?;
	let aad = crate::crypto::keyshare_wrap_aad(&urn, &shell.signer_did, &shell.signer_did, dek_ver);
	let wrapped = crate::crypto::encrypt_keyshare_payload(&kek, dek_plain.expose(), &aad)?;
	let ks_schema = jazz_engine::resolved_table_schema(client, "keyshares").await?;
	let mut ks = Map::new();
	ks.insert("owner".into(), JsonValue::String(identity.to_string()));
	ks.insert("dek_version".into(), JsonValue::Number(dek_ver.into()));
	ks.insert("recipient_did".into(), JsonValue::String(shell.signer_did.clone()));
	ks.insert("wrapper_did".into(), JsonValue::String(shell.signer_did.clone()));
	ks.insert("wrapped_dek".into(), JsonValue::String(wrapped));
	let ks_vals = insert_values("keyshares", &ks_schema, ks)?;
	let ks_oid = ObjectId::new();
	let ks_meta = owner_binding_meta(&shell.signing_key, ks_oid, identity)?;
	client
		.create_with_id_and_metadata("keyshares", ks_oid, ks_vals, ks_meta)
		.await
		.map_err(format_jazz_err)?;
	Ok(())
}

/// The public wrap-DID of a SAFE, read from its `safes` row (plaintext routing material —
/// readable even when the row's sealed cells are not, which is exactly the foreign-SAFE
/// grant case). `None` for pre-wrap-key rows.
async fn find_safe_wrap_did(client: &JazzClient, safe_id: Uuid) -> Result<Option<String>, String> {
	let schema = jazz_engine::resolved_table_schema(client, "safes").await?;
	let id_ix = jazz_engine::col_ix(&schema, "owner")?;
	let Ok(wd_ix) = jazz_engine::col_ix(&schema, "wrap_did") else {
		return Ok(None);
	};
	for (_oid, vals) in jazz_engine::exec_list_rows(client, "safes").await? {
		if jazz_engine::uuid_cell_at(vals.as_slice(), id_ix)? != safe_id {
			continue;
		}
		return Ok(match vals.get(wd_ix) {
			Some(Value::Text(s)) if !s.trim().is_empty() => Some(s.trim().to_string()),
			_ => None,
		});
	}
	Ok(None)
}

async fn propagate_keyshares_for_member(
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
	target_safe: Uuid,
	member_did: &str,
	include_downstream: bool,
) -> Result<(), String> {
	let member_safe = crate::identity_acc::resolve_safe_did(member_did);
	let mut recipients: Vec<String> = match member_safe {
		Some(safe_id) => crate::identity_acc::safe_transitive_signers(&shell.vault, safe_id)
			.into_iter()
			.collect(),
		None => vec![member_did.to_string()],
	};
	// did:safe: member — ALSO wrap to the member SAFE's wrap key. The transitive-signer
	// enumeration above only works when we can read the member SAFE's biscuit (we hold its
	// DEK); for a FOREIGN SAFE (sealed genesis, no DEK) it is empty and the grant would
	// silently deliver no keys. The wrap_did is plaintext routing material on the SAFE's
	// row, so it is always resolvable — and only that SAFE's members (DEK holders) can open
	// the sealed wrap seed to unwrap. E2E holds; ordering and foreignness stop mattering.
	let mut member_wrap_did: Option<String> = None;
	if let Some(safe_id) = member_safe {
		match find_safe_wrap_did(client, safe_id).await? {
			Some(wd) => {
				member_wrap_did = Some(wd.clone());
				recipients.push(wd);
			}
			None => log::warn!(
				target: "avenos::jazz",
				"keyshare propagation: member SAFE {safe_id} has no wrap_did — only locally-resolvable signers receive keys",
			),
		}
	}
	let downstream: Vec<Uuid> = if include_downstream {
		shell
			.vault
			.safes
			.keys()
			.copied()
			.filter(|&oid| {
				oid != target_safe
					&& crate::identity_acc::safe_controlled_by(&shell.vault, oid, target_safe)
			})
			.collect()
	} else {
		Vec::new()
	};

	for recip in &recipients {
		if recip == &shell.signer_did {
			continue;
		}
		// A wrap-DID names a SAFE's key, not a device — never register it as a sync peer.
		let is_wrap_recipient = member_wrap_did.as_deref() == Some(recip.as_str());
		if member_safe.is_some() && !is_wrap_recipient {
			let Ok(pk) = crate::jazz_auth::ed25519_public_from_signer_did(recip) else {
				log::warn!(target: "avenos::jazz", "keyshare propagation: bad signer DID {recip}");
				continue;
			};
			crate::signers::add_remote_signer(client, recip, "").await?;
			if let Err(e) = client.register_peer_sync_client(PeerId(pk)) {
				log::warn!(target: "avenos::jazz", "keyshare propagation register {recip}: {e}");
			}
		}
		wrap_all_dek_versions_to_recipient(client, shell, target_safe, recip).await?;
		for &oid in &downstream {
			if !shell.deks.keys().any(|(sid, _)| *sid == oid) {
				continue;
			}
			wrap_all_dek_versions_to_recipient(client, shell, oid, recip).await?;
		}
	}
	Ok(())
}

async fn upsert_controller_copy_row(
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
	owner_safe: Uuid,
	controller_id: Uuid,
	genesis_b64: &str,
	role: &str,
	fresh_dek: Option<(&[u8; 32], i64)>,
) -> Result<(), String> {
	let issuer_b64 = shell.issuers.get(&controller_id).cloned().unwrap_or_else(|| {
		crate::identity_acc::encode_issuer_pubkey_b64(&shell.vault.biscuit_kp.public())
	});
	let ctrl_did = crate::identity_acc::safe_did(controller_id);
	let sc_schema = jazz_engine::resolved_table_schema(client, "safe_controllers").await?;
	let own_ix = jazz_engine::col_ix(&sc_schema, "owner")?;
	let did_ix = jazz_engine::col_ix(&sc_schema, "controller_did")?;
	let mut existing: Option<ObjectId> = None;
	for (oid, vals) in jazz_engine::exec_list_rows(client, "safe_controllers").await? {
		if jazz_engine::uuid_cell_at(vals.as_slice(), own_ix)? == owner_safe
			&& matches!(vals.get(did_ix), Some(Value::Text(s)) if s == &ctrl_did)
		{
			existing = Some(oid);
			break;
		}
	}
	// Private-by-default: the chain copy is a trust-root input for the owning SAFE's
	// members — seal genesis/issuer under the OWNING SAFE's DEK (the hardened hydrate
	// refuses a cleartext copy, mirroring board 0015 for primary `safes` rows).
	// `fresh_dek` covers the mint path where the owner SAFE's DEK isn't in the shell yet.
	let seal_copy_cells = |map: &mut Map<String, JsonValue>, object_row: Uuid| -> Result<(), String> {
		match fresh_dek {
			Some((dek32, dek_ver)) => jazz_engine::seal_sensitive_in_row_with_dek(
				dek32,
				"safe_controllers",
				&sc_schema,
				owner_safe,
				object_row,
				dek_ver,
				map,
			),
			None => jazz_engine::seal_sensitive_in_patch(
				shell,
				"safe_controllers",
				&sc_schema,
				owner_safe,
				object_row,
				map,
			),
		}
	};
	if let Some(oid) = existing {
		let mut patch = Map::new();
		patch.insert("genesis_b64".into(), JsonValue::String(genesis_b64.to_string()));
		patch.insert("issuer_pubkey_b64".into(), JsonValue::String(issuer_b64));
		seal_copy_cells(&mut patch, *oid.uuid())?;
		let ops = patch_updates(&sc_schema, patch)?;
		let meta = owner_binding_meta(&shell.signing_key, oid, owner_safe)?;
		client.update_with_metadata(oid, ops, meta).await.map_err(format_jazz_err)?;
	} else {
		let now_ms: i64 = std::time::SystemTime::now()
			.duration_since(std::time::UNIX_EPOCH)
			.map(|d| d.as_millis() as i64)
			.unwrap_or(0);
		let mut row = Map::new();
		row.insert("owner".into(), JsonValue::String(owner_safe.to_string()));
		row.insert("controller_did".into(), JsonValue::String(ctrl_did));
		row.insert("role".into(), JsonValue::String(role.to_string()));
		row.insert("genesis_b64".into(), JsonValue::String(genesis_b64.to_string()));
		row.insert("issuer_pubkey_b64".into(), JsonValue::String(issuer_b64));
		row.insert("added_at_ms".into(), JsonValue::Number(now_ms.into()));
		let oid = ObjectId::new();
		seal_copy_cells(&mut row, *oid.uuid())?;
		let vals = insert_values("safe_controllers", &sc_schema, row)?;
		let meta = owner_binding_meta(&shell.signing_key, oid, owner_safe)?;
		client
			.create_with_id_and_metadata("safe_controllers", oid, vals, meta)
			.await
			.map_err(format_jazz_err)?;
	}
	Ok(())
}

async fn write_controller_closure_copies(
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
	owner_safe: Uuid,
	root_controller: Uuid,
	role: &str,
) -> Result<(), String> {
	write_controller_closure_copies_with_dek(client, shell, owner_safe, root_controller, role, None)
		.await
}

/// `write_controller_closure_copies` with an explicit owner-SAFE DEK for the mint path
/// (the freshly created SAFE's DEK is not in `ShellState.deks` yet).
async fn write_controller_closure_copies_with_dek(
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
	owner_safe: Uuid,
	root_controller: Uuid,
	role: &str,
	fresh_dek: Option<(&[u8; 32], i64)>,
) -> Result<(), String> {
	use base64::engine::general_purpose::URL_SAFE_NO_PAD;
	use base64::Engine;
	for cid in crate::identity_acc::safe_controller_closure(&shell.vault, root_controller) {
		let Some(b) = shell.vault.safes.get(&cid) else {
			continue;
		};
		let gen_b64 = URL_SAFE_NO_PAD
			.encode(b.biscuit.to_vec().map_err(|e| format!("chain_encode:{e:?}"))?);
		let r = if cid == root_controller { role } else { "owner" };
		upsert_controller_copy_row(client, shell, owner_safe, cid, &gen_b64, r, fresh_dek).await?;
	}
	Ok(())
}

async fn refresh_downstream_controller_copies(
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
	safe: Uuid,
	new_chain_b64: &str,
) -> Result<(), String> {
	let downstream: Vec<Uuid> = shell
		.vault
		.safes
		.keys()
		.copied()
		.filter(|&oid| {
			oid != safe && crate::identity_acc::safe_controlled_by(&shell.vault, oid, safe)
		})
		.collect();
	for x in downstream {
		if let Err(e) = upsert_controller_copy_row(client, shell, x, safe, new_chain_b64, "owner", None).await {
			log::warn!(target: "avenos::jazz", "controller copy refresh {safe} → {x}: {e}");
		}
	}
	Ok(())
}

async fn cascade_rotate_one(
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
	safe_id: Uuid,
	parent: Uuid,
	parent_new_chain: &crate::identity_acc::Biscuit,
) -> Result<(), String> {
	let Some(cur_v) = shell.identity_versions.get(&safe_id).copied() else {
		return Ok(());
	};
	let Some(bisc) = shell.vault.safes.get(&safe_id) else {
		return Ok(());
	};

	let ks_schema = jazz_engine::resolved_table_schema(client, "keyshares").await?;
	let ks_spark_ix = jazz_engine::col_ix(&ks_schema, "owner")?;
	let ks_recip_ix = jazz_engine::col_ix(&ks_schema, "recipient_did")?;
	let mut prior_holders: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
	let mut stale_rows: Vec<(ObjectId, String)> = Vec::new();
	for (oid, vals) in jazz_engine::exec_list_rows(client, "keyshares").await? {
		if jazz_engine::uuid_cell_at(vals.as_slice(), ks_spark_ix)? != safe_id {
			continue;
		}
		if let Some(Value::Text(s)) = vals.get(ks_recip_ix) {
			prior_holders.insert(s.clone());
			stale_rows.push((oid, s.clone()));
		}
	}

	let new_v = cur_v + 1;
	let new_dek = crate::crypto::random_identity_dek();
	let urn = jazz_engine::safe_urn(safe_id);
	let keeper = |did: &str| {
		crate::identity_acc::chain_still_member_with(
			&shell.vault,
			&bisc.biscuit,
			safe_id,
			did,
			parent,
			parent_new_chain,
		)
	};
	for recip_did in prior_holders.iter().filter(|d| keeper(d.as_str())) {
		let recip_pk = crate::jazz_auth::ed25519_public_from_signer_did(recip_did)?;
		let kek = crate::crypto::derive_kek_x25519(&shell.signing_key, &recip_pk)?;
		let aad = crate::crypto::keyshare_wrap_aad(&urn, recip_did, &shell.signer_did, new_v);
		let wrapped = crate::crypto::encrypt_keyshare_payload(&kek, new_dek.expose(), &aad)?;
		let mut ks = Map::new();
		ks.insert("owner".into(), JsonValue::String(safe_id.to_string()));
		ks.insert("dek_version".into(), JsonValue::Number(new_v.into()));
		ks.insert("recipient_did".into(), JsonValue::String(recip_did.clone()));
		ks.insert("wrapper_did".into(), JsonValue::String(shell.signer_did.clone()));
		ks.insert("wrapped_dek".into(), JsonValue::String(wrapped));
		let ks_vals = insert_values("keyshares", &ks_schema, ks)?;
		let ks_oid = ObjectId::new();
		let ks_meta = owner_binding_meta(&shell.signing_key, ks_oid, safe_id)?;
		client
			.create_with_id_and_metadata("keyshares", ks_oid, ks_vals, ks_meta)
			.await
			.map_err(format_jazz_err)?;
	}

	let sparks_schema = jazz_engine::resolved_table_schema(client, "safes").await?;
	let id_ix = jazz_engine::col_ix(&sparks_schema, "owner")?;
	for (oid, vals) in jazz_engine::exec_list_rows(client, "safes").await? {
		if jazz_engine::uuid_cell_at(vals.as_slice(), id_ix)? == safe_id {
			let mut patch = Map::new();
			patch.insert("current_dek_version".into(), JsonValue::Number(new_v.into()));
			let ops = patch_updates(&sparks_schema, patch)?;
			let upd_meta = owner_binding_meta(&shell.signing_key, oid, safe_id)?;
			client.update_with_metadata(oid, ops, upd_meta).await.map_err(format_jazz_err)?;
			break;
		}
	}

	for (oid, recip) in stale_rows {
		if !keeper(&recip) {
			let del_meta = owner_binding_meta(&shell.signing_key, oid, safe_id)?;
			let _ = client.delete_with_metadata(oid, del_meta).await;
		}
	}
	Ok(())
}

async fn safe_type_of(client: &JazzClient, safe_uuid: Uuid) -> Result<Option<String>, String> {
	let schema = jazz_engine::resolved_table_schema(client, "safes").await?;
	let id_ix = jazz_engine::col_ix(&schema, "owner")?;
	let type_ix = jazz_engine::col_ix(&schema, "type")?;
	for (_oid, vals) in jazz_engine::exec_list_rows(client, "safes").await? {
		if jazz_engine::uuid_cell_at(vals.as_slice(), id_ix)? == safe_uuid {
			return Ok(match vals.get(type_ix) {
				Some(Value::Text(s)) => Some(s.trim().to_string()),
				_ => None,
			});
		}
	}
	Ok(None)
}

async fn enforce_member_type_rule(
	client: &JazzClient,
	target_safe: Uuid,
	member_did: &str,
) -> Result<(), String> {
	let target_type = safe_type_of(client, target_safe)
		.await?
		.unwrap_or_else(|| "aven".to_string());
	match target_type.as_str() {
		"aven" | "spark" => {
			let want = if target_type == "aven" { "human" } else { "aven" };
			let Some(member_id) = crate::identity_acc::resolve_safe_did(member_did) else {
				return Err(format!(
					"a {target_type} SAFE admits {want} SAFE DIDs (did:safe:…) — signers join through a {want} SAFE"
				));
			};
			let member_type = safe_type_of(client, member_id).await?;
			if member_type.as_deref() != Some(want) {
				return Err(format!(
					"a {target_type} SAFE admits {want} SAFEs only — {member_did} is {}",
					member_type.as_deref().unwrap_or("unknown (no local safes row)")
				));
			}
			Ok(())
		}
		_ => {
			if member_did.starts_with(crate::identity_acc::SAFE_DID_PREFIX) {
				return Err(format!(
					"a {target_type} SAFE admits signer DIDs (did:key:…) only — a SAFE cannot be a member of a {target_type} SAFE"
				));
			}
			Ok(())
		}
	}
}

async fn find_controlled_safe_of_type(
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
	want_type: &str,
) -> Result<Option<Uuid>, String> {
	let avenceo = crate::identity_acc::aven_ceo_identity(tauri_plugin_self::network::NETWORK_SEED);
	let schema = jazz_engine::resolved_table_schema(client, "safes").await?;
	let id_ix = jazz_engine::col_ix(&schema, "owner")?;
	let type_ix = jazz_engine::col_ix(&schema, "type")?;
	let created_ix = jazz_engine::col_ix(&schema, "created_at_ms")?;
	let mut candidates: Vec<(i64, Uuid)> = Vec::new();
	for (_oid, vals) in jazz_engine::exec_list_rows(client, "safes").await? {
		let sid = jazz_engine::uuid_cell_at(vals.as_slice(), id_ix)?;
		if sid == avenceo {
			continue;
		}
		let ty = match vals.get(type_ix) {
			Some(Value::Text(s)) => s.trim().to_string(),
			_ => continue,
		};
		if ty != want_type {
			continue;
		}
		if !crate::identity_acc::subject_controls_safe(&shell.vault, sid, &shell.signer_did) {
			continue;
		}
		let at = match vals.get(created_ix) {
			Some(Value::BigInt(i)) => *i,
			Some(Value::Integer(i)) => *i as i64,
			_ => i64::MAX,
		};
		candidates.push((at, sid));
	}
	candidates.sort();
	Ok(candidates.first().map(|(_, sid)| *sid))
}

pub(crate) async fn groove_ipc_spark_admin_add(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	owner: String,
	signer_did: String,
) -> Result<(), String> {
	use base64::engine::general_purpose::URL_SAFE_NO_PAD;
	use base64::Engine;

	let identity_uuid =
		Uuid::parse_str(owner.trim()).map_err(|e| format!("invalid owner UUID: {e}"))?;
	let signer_did = signer_did.trim().to_string();
	if signer_did.is_empty() {
		return Err("signer_did is empty".into());
	}

	let client = with_connected_client(jazz, app, self_state).await?;

	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();

	if signer_did == shell.signer_did {
		return Err("cannot grant a identity to your own DID".into());
	}

	enforce_member_type_rule(client.as_ref(), identity_uuid, &signer_did).await?;
	let is_safe_member = signer_did.starts_with(crate::identity_acc::SAFE_DID_PREFIX);

	if !is_safe_member {
		let peer_pk = crate::jazz_auth::ed25519_public_from_signer_did(&signer_did)?;

		crate::signers::add_remote_signer(client.as_ref(), &signer_did, "").await?;
		if let Err(e) = client.register_peer_sync_client(PeerId(peer_pk)) {
			log::warn!(target: "avenos::jazz", "identity_admin_add register {signer_did}: {e}");
		}
	}

	jazz_engine::authorize_gate(
		shell,
		"safes",
		crate::identity_acc::AccOp::Write,
		identity_uuid,
		None,
	)?;

	let bisc_identity = shell
		.vault
		.safes
		.get(&identity_uuid)
		.ok_or_else(|| format!("identity {identity_uuid} not loaded in vault"))?;

	let already_owner =
		crate::identity_acc::identity_peer_is_owner(&bisc_identity.biscuit, identity_uuid, &signer_did)?;

	let _ = client.flush_peer_sync().await;

	propagate_keyshares_for_member(client.as_ref(), shell, identity_uuid, &signer_did, true).await?;

	if !already_owner {
		let new_biscuit = crate::identity_acc::attenuate_add_owner_third_party(
			&shell.vault.biscuit_kp,
			&bisc_identity.biscuit,
			identity_uuid,
			&signer_did,
		)?;

		let genesis_vec = new_biscuit
			.to_vec()
			.map_err(|e| format!("biscuit_encode:{e:?}"))?;
		let genesis_b64 = URL_SAFE_NO_PAD.encode(genesis_vec);

		// Sealed write (private-by-default): genesis_b64 never ships cleartext —
		// the hardened hydrate refuses a cleartext trust root (board 0015).
		update_identity_genesis(client.as_ref(), shell, identity_uuid, genesis_b64.clone()).await?;

		refresh_downstream_controller_copies(client.as_ref(), shell, identity_uuid, &genesis_b64)
			.await?;
	}

	if let Some(member_safe) = crate::identity_acc::resolve_safe_did(&signer_did) {
		write_controller_closure_copies(client.as_ref(), shell, identity_uuid, member_safe, "owner")
			.await?;
	}

	finish_spark_admin_grant(app, jazz, self_state, client, identity_uuid).await?;

	Ok(())
}

/// Append biscuit third-party `replicate` for `peerDid`, persist updated
/// `genesis_b64`, and register the peer for sync. The grantee gets the **SYNC bundle**
/// (single-source caps, all in the biscuit): table-scoped `read` on the REGISTRY
/// (`safes:` + `peers:`) + a keyshare to hydrate it (member of the directory — can
/// see the aven + member names) + blind `replicate` of the DATA (NO keyshare for the
/// user-data identities, so it relays their ciphertext unread). The 10 MB quota +
/// rate-limit are node-enforced and reported alongside `replicate`. Admin only.
pub(crate) async fn groove_ipc_spark_replicate_add(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	owner: String,
	signer_did: String,
) -> Result<(), String> {
	use base64::engine::general_purpose::URL_SAFE_NO_PAD;
	use base64::Engine;

	let identity_uuid =
		Uuid::parse_str(owner.trim()).map_err(|e| format!("invalid owner UUID: {e}"))?;
	let signer_did = signer_did.trim().to_string();
	if signer_did.is_empty() {
		return Err("signer_did is empty".into());
	}

	let client = with_connected_client(jazz, app, self_state).await?;
	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();

	if signer_did == shell.signer_did {
		return Err("cannot grant replication to your own DID".into());
	}
	// A replication relay is a concrete node — always a signer, never a SAFE.
	if signer_did.starts_with(crate::identity_acc::SAFE_DID_PREFIX) {
		return Err("replication peers are signers (did:key:…) — a SAFE cannot relay".into());
	}
	let peer_pk = crate::jazz_auth::ed25519_public_from_signer_did(&signer_did)?;

	// Register the replica as a sync peer so the grant takes effect end-to-end.
	crate::signers::add_remote_signer(client.as_ref(), &signer_did, "").await?;
	if let Err(e) = client.register_peer_sync_client(PeerId(peer_pk)) {
		log::warn!(target: "avenos::jazz", "identity_replicate_add register {signer_did}: {e}");
	}

	// Only a identity admin may grant replication (same gate as admin-add: the local
	// vault must be authorized to write this identity's catalogue).
	jazz_engine::authorize_gate(
		shell,
		"safes",
		crate::identity_acc::AccOp::Write,
		identity_uuid,
		None,
	)?;

	let bisc_identity = shell
		.vault
		.safes
		.get(&identity_uuid)
		.ok_or_else(|| format!("identity {identity_uuid} not loaded in vault"))?;

	let already_replica = crate::identity_acc::identity_replicas(&bisc_identity.biscuit, identity_uuid)?
		.iter()
		.any(|d| d.trim() == signer_did.as_str());
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
	let ks_urn = jazz_engine::safe_urn(identity_uuid);
	let ks_aad = crate::crypto::keyshare_wrap_aad(&ks_urn, &signer_did, &shell.signer_did, dek_ver);
	let wrapped = crate::crypto::encrypt_keyshare_payload(&kek, dek.expose(), &ks_aad)?;
	let ks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "keyshares").await?;
	let mut ks = Map::new();
	ks.insert("owner".into(), JsonValue::String(identity_uuid.to_string()));
	ks.insert("dek_version".into(), JsonValue::Number(dek_ver.into()));
	ks.insert("recipient_did".into(), JsonValue::String(signer_did.clone()));
	ks.insert("wrapper_did".into(), JsonValue::String(shell.signer_did.clone()));
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
	// registry tables ONLY (`safes:` + `peers:`) so the peer can see the aven + its
	// members but CANNOT read any data table (messages/todos stay blind — the E2E
	// boundary). The 10 MB quota + rate-limit ride the replicate cap-report (node-enforced).
	let chain = crate::identity_acc::attenuate_add_replicate_third_party(
		&shell.vault.biscuit_kp,
		&bisc_identity.biscuit,
		identity_uuid,
		&signer_did,
	)?;
	let chain = crate::identity_acc::attenuate_add_grant_third_party(
		&shell.vault.biscuit_kp,
		&chain,
		&signer_did,
		"read",
		&format!("safe:{identity_uuid}:safes:"),
	)?;
	let new_biscuit = crate::identity_acc::attenuate_add_grant_third_party(
		&shell.vault.biscuit_kp,
		&chain,
		&signer_did,
		"read",
		&format!("safe:{identity_uuid}:signers:"),
	)?;
	let genesis_vec = new_biscuit
		.to_vec()
		.map_err(|e| format!("biscuit_encode:{e:?}"))?;
	let genesis_b64 = URL_SAFE_NO_PAD.encode(genesis_vec);

	// Sealed write (private-by-default; board 0015 — see admin_add).
	update_identity_genesis(client.as_ref(), shell, identity_uuid, genesis_b64).await?;

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
	signer_did: String,
) -> Result<(), String> {
	use base64::engine::general_purpose::URL_SAFE_NO_PAD;
	use base64::Engine;

	let identity_uuid =
		Uuid::parse_str(owner.trim()).map_err(|e| format!("invalid owner UUID: {e}"))?;
	let signer_did = signer_did.trim().to_string();
	if signer_did.is_empty() {
		return Err("signer_did is empty".into());
	}

	let client = with_connected_client(jazz, app, self_state).await?;
	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();

	if signer_did == shell.signer_did {
		return Err("cannot grant read to your own DID".into());
	}

	enforce_member_type_rule(client.as_ref(), identity_uuid, &signer_did).await?;
	let is_safe_member = signer_did.starts_with(crate::identity_acc::SAFE_DID_PREFIX);

	if !is_safe_member {
		let peer_pk = crate::jazz_auth::ed25519_public_from_signer_did(&signer_did)?;

		crate::signers::add_remote_signer(client.as_ref(), &signer_did, "").await?;
		if let Err(e) = client.register_peer_sync_client(PeerId(peer_pk)) {
			log::warn!(target: "avenos::jazz", "identity_reader_add register {signer_did}: {e}");
		}
	}

	jazz_engine::authorize_gate(shell, "safes", crate::identity_acc::AccOp::Write, identity_uuid, None)?;

	let bisc_identity = shell
		.vault
		.safes
		.get(&identity_uuid)
		.ok_or_else(|| format!("identity {identity_uuid} not loaded in vault"))?;
	let already_reader = crate::identity_acc::identity_readers(&bisc_identity.biscuit, identity_uuid)?
		.iter()
		.any(|d| d.trim() == signer_did.as_str());

	let _ = client.flush_peer_sync().await;

	propagate_keyshares_for_member(client.as_ref(), shell, identity_uuid, &signer_did, false).await?;

	if !already_reader {
		let new_biscuit = crate::identity_acc::attenuate_add_reader_third_party(
			&shell.vault.biscuit_kp,
			&bisc_identity.biscuit,
			identity_uuid,
			&signer_did,
		)?;
		let genesis_vec = new_biscuit.to_vec().map_err(|e| format!("biscuit_encode:{e:?}"))?;
		let genesis_b64 = URL_SAFE_NO_PAD.encode(genesis_vec);

		// Sealed write (private-by-default; board 0015 — see admin_add).
		update_identity_genesis(client.as_ref(), shell, identity_uuid, genesis_b64).await?;
	}

	if let Some(member_safe) = crate::identity_acc::resolve_safe_did(&signer_did) {
		write_controller_closure_copies(client.as_ref(), shell, identity_uuid, member_safe, "reader")
			.await?;
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

	let sparks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "safes").await?;
	let identity_id_ix = jazz_engine::col_ix(&sparks_schema, "owner")?;
	let issuer_ix = jazz_engine::col_ix(&sparks_schema, "issuer_pubkey_b64")?;
	let sparks_rows = jazz_engine::exec_list_rows(client.as_ref(), "safes").await?;
	let my_issuer = crate::identity_acc::encode_issuer_pubkey_b64(&shell.vault.biscuit_kp.public());
	for (_oid, vals) in &sparks_rows {
		if jazz_engine::uuid_cell_at(vals.as_slice(), identity_id_ix)? == identity_uuid {
			let issuer = match vals.get(issuer_ix) {
				Some(Value::Text(s)) => s.clone(),
				_ => String::new(),
			};
			if issuer == my_issuer {
				ensure_aven_ceo_owner_row(client.as_ref(), shell, identity_uuid, None).await?;
				finish_spark_admin_grant(app, jazz, self_state, client, identity_uuid).await?;
				return Ok(identity_uuid.to_string());
			}
			return Err("avenCEO is already claimed by another identity".into());
		}
	}

	let genesis = crate::identity_acc::mint_safe_genesis(&shell.vault, identity_uuid)?;
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
	row.insert("type".into(), JsonValue::String("human".into()));
	row.insert(
		"safe_did".into(),
		JsonValue::String(crate::identity_acc::safe_did(identity_uuid)),
	);
	let (wrap_did, wrap_seed_b64) = jazz_engine::mint_safe_wrap_keypair()?;
	row.insert("wrap_did".into(), JsonValue::String(wrap_did));
	row.insert("wrap_privkey_b64".into(), JsonValue::String(wrap_seed_b64));
	row.insert(
		"name".into(),
		JsonValue::String(crate::identity_acc::AVEN_CEO_IDENTITY_NAME.to_string()),
	);
	row.insert("issuer_pubkey_b64".into(), JsonValue::String(issuer_b64));
	row.insert("genesis_b64".into(), JsonValue::String(genesis_b64));
	row.insert("current_dek_version".into(), JsonValue::Number(dek_ver.into()));
	row.insert("created_at_ms".into(), JsonValue::Number(now_ms.into()));
	// Generate the identity DEK up-front and seal the trust-root + name cells under it BEFORE
	// the row is written (private-by-default); the same DEK is wrapped to this device below.
	let dek_plain = crate::crypto::random_identity_dek();
	let sparks_oid = ObjectId::new();
	jazz_engine::seal_sensitive_in_row_with_dek(
		dek_plain.expose(),
		"safes",
		&sparks_schema,
		identity_uuid,
		*sparks_oid.uuid(),
		dek_ver,
		&mut row,
	)?;
	let sparks_vals = insert_values("safes", &sparks_schema, row)?;
	let sparks_meta = owner_binding_meta(&shell.signing_key, sparks_oid, identity_uuid)?;
	client.create_with_id_and_metadata("safes", sparks_oid, sparks_vals, sparks_meta).await.map_err(format_jazz_err)?;

	wrap_self_keyshare(client.as_ref(), shell, identity_uuid, &dek_plain, dek_ver).await?;

	ensure_aven_ceo_owner_row(
		client.as_ref(),
		shell,
		identity_uuid,
		Some((dek_plain.expose(), dek_ver)),
	)
	.await?;

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
	let kind = match kind.trim() {
		"human" => "human",
		"spark" => "spark",
		_ => "aven",
	};
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();

	let identity_uuid = uuid::Uuid::new_v4();
	let sparks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "safes").await?;

	let controller: Option<Uuid> = match kind {
		"aven" => Some(
			find_controlled_safe_of_type(client.as_ref(), shell, "human")
				.await?
				.ok_or("create a Human SAFE first — an Aven SAFE is controlled by a Human SAFE")?,
		),
		"spark" => Some(
			find_controlled_safe_of_type(client.as_ref(), shell, "aven")
				.await?
				.ok_or("create an Aven SAFE first — a Spark SAFE is controlled by an Aven SAFE")?,
		),
		_ => None,
	};
	let genesis = match controller {
		Some(ctrl) => crate::identity_acc::mint_safe_genesis_with_controller(
			&shell.vault,
			identity_uuid,
			&crate::identity_acc::safe_did(ctrl),
		)?,
		None => crate::identity_acc::mint_safe_genesis(&shell.vault, identity_uuid)?,
	};
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
	row.insert(
		"safe_did".into(),
		JsonValue::String(crate::identity_acc::safe_did(identity_uuid)),
	);
	// SAFE wrap keypair: public wrap_did (routing), seed sealed under the SAFE DEK below.
	// This is what makes a grant TO this SAFE (did:safe: member) able to deliver keys —
	// the granter wraps to wrap_did; any member opens the seed and unwraps.
	let (wrap_did, wrap_seed_b64) = jazz_engine::mint_safe_wrap_keypair()?;
	row.insert("wrap_did".into(), JsonValue::String(wrap_did));
	row.insert("wrap_privkey_b64".into(), JsonValue::String(wrap_seed_b64));
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
	// Generate the identity DEK up-front and seal the trust-root + name cells under it BEFORE
	// the row is written (private-by-default); the same DEK is wrapped to this device below.
	let dek_plain = crate::crypto::random_identity_dek();
	let sparks_oid = ObjectId::new();
	jazz_engine::seal_sensitive_in_row_with_dek(
		dek_plain.expose(),
		"safes",
		&sparks_schema,
		identity_uuid,
		*sparks_oid.uuid(),
		dek_ver,
		&mut row,
	)?;
	let sparks_vals = insert_values("safes", &sparks_schema, row)?;
	let sparks_meta = owner_binding_meta(&shell.signing_key, sparks_oid, identity_uuid)?;
	client
		.create_with_id_and_metadata("safes", sparks_oid, sparks_vals, sparks_meta)
		.await
		.map_err(format_jazz_err)?;

	let urn = jazz_engine::safe_urn(identity_uuid);
	let ks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "keyshares").await?;
	wrap_self_keyshare(client.as_ref(), shell, identity_uuid, &dek_plain, dek_ver).await?;

	if let Some(ctrl) = controller {
		// Controller wrap-key first: every member of the controlling SAFE — including
		// signers we cannot enumerate locally — can unwrap via the SAFE's sealed seed.
		// The per-signer wraps below stay as the direct fast path.
		let mut recipients: Vec<String> =
			crate::identity_acc::safe_transitive_signers(&shell.vault, ctrl)
				.into_iter()
				.collect();
		if let Some(wd) = find_safe_wrap_did(client.as_ref(), ctrl).await? {
			recipients.push(wd);
		}
		for recip in recipients {
			if recip == shell.signer_did {
				continue;
			}
			let Ok(recip_pk) = crate::jazz_auth::ed25519_public_from_signer_did(&recip) else {
				log::warn!(target: "avenos::jazz", "create: bad controller signer DID {recip}");
				continue;
			};
			let kek = crate::crypto::derive_kek_x25519(&shell.signing_key, &recip_pk)?;
			let aad = crate::crypto::keyshare_wrap_aad(&urn, &recip, &shell.signer_did, dek_ver);
			let wrapped = crate::crypto::encrypt_keyshare_payload(&kek, dek_plain.expose(), &aad)?;
			let mut ks = Map::new();
			ks.insert("owner".into(), JsonValue::String(identity_uuid.to_string()));
			ks.insert("dek_version".into(), JsonValue::Number(dek_ver.into()));
			ks.insert("recipient_did".into(), JsonValue::String(recip.clone()));
			ks.insert("wrapper_did".into(), JsonValue::String(shell.signer_did.clone()));
			ks.insert("wrapped_dek".into(), JsonValue::String(wrapped));
			let ks_vals = insert_values("keyshares", &ks_schema, ks)?;
			let ks_oid = ObjectId::new();
			let ks_meta = owner_binding_meta(&shell.signing_key, ks_oid, identity_uuid)?;
			client
				.create_with_id_and_metadata("keyshares", ks_oid, ks_vals, ks_meta)
				.await
				.map_err(format_jazz_err)?;
		}
		write_controller_closure_copies_with_dek(
			client.as_ref(),
			shell,
			identity_uuid,
			ctrl,
			"owner",
			Some((dek_plain.expose(), dek_ver)),
		)
		.await?;
	}

	ensure_aven_ceo_owner_row(
		client.as_ref(),
		shell,
		identity_uuid,
		Some((dek_plain.expose(), dek_ver)),
	)
	.await?;
	finish_spark_admin_grant(app, jazz, self_state, client, identity_uuid).await?;
	// Blind relay sync from birth: without the relay's `replicate` cap this identity's
	// (encrypted) rows never leave this device when peers have no direct P2P link —
	// a member grant on the controlling SAFE then "works" for the SAFE itself but the
	// controlled aven/spark SAFEs silently never reach the invitee. Same E2E bundle as
	// the manual ⚡ quick-relay action: ciphertext store-and-forward, no keyshare.
	auto_relay_sync_on_create(app, jazz, self_state, identity_uuid).await;
	Ok(identity_uuid.to_string())
}

/// Default-grant the connected relay a blind-sync (`replicate`) cap on a freshly-created
/// identity. The relay can only forward an identity it holds, so doing this at creation makes
/// later member/owner grants reach invited devices REACTIVELY in any order — without it, granting
/// a member before the relay-sync cap doesn't propagate until the invitee manually refreshes.
/// Non-fatal + idempotent: if no relay is connected, skip; the user can still sync manually.
async fn auto_relay_sync_on_create(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	identity: Uuid,
) {
	let relay_did = jazz
		.connected_relay_did
		.read()
		.ok()
		.and_then(|g| g.as_ref().cloned());
	let Some(relay_did) = relay_did else {
		return;
	};
	if let Err(e) =
		groove_ipc_spark_replicate_add(app, jazz, self_state, identity.to_string(), relay_did).await
	{
		log::warn!(target: "avenos::jazz", "auto relay-sync on create failed: {e}");
	}
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
	jazz_engine::authorize_gate(shell, "safes", crate::identity_acc::AccOp::Write, parent_id, None)?;

	let group_id = crate::identity_acc::derive_subgroup_id(parent_id, &label);

	let sparks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "safes").await?;
	let id_ix = jazz_engine::col_ix(&sparks_schema, "owner")?;
	// Idempotent: if the group's row already exists, return it (deterministic id).
	for (_oid, vals) in jazz_engine::exec_list_rows(client.as_ref(), "safes").await? {
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
	// Seal the trust-root + name cells under the group's fresh DEK BEFORE the row is
	// written (private-by-default); the same DEK is keyshared to the creator below.
	let dek_plain = crate::crypto::random_identity_dek();
	let sparks_oid = ObjectId::new();
	jazz_engine::seal_sensitive_in_row_with_dek(
		dek_plain.expose(),
		"safes",
		&sparks_schema,
		group_id,
		*sparks_oid.uuid(),
		dek_ver,
		&mut row,
	)?;
	let sparks_vals = insert_values("safes", &sparks_schema, row)?;
	let sparks_meta = owner_binding_meta(&shell.signing_key, sparks_oid, group_id)?;
	client
		.create_with_id_and_metadata("safes", sparks_oid, sparks_vals, sparks_meta)
		.await
		.map_err(format_jazz_err)?;

	// The group's OWN DEK (generated above), keyshared to the creator. Parent members inherit
	// it via the 2-level key hierarchy (the group key wrapped under the parent group key).
	wrap_self_keyshare(client.as_ref(), shell, group_id, &dek_plain, dek_ver).await?;

	finish_spark_admin_grant(app, jazz, self_state, client, group_id).await?;
	auto_relay_sync_on_create(app, jazz, self_state, group_id).await;
	Ok(group_id.to_string())
}

/// Idempotently ensure THIS device has its own avenCEO roster row, populated from
/// identity (name from `humans`, device label from the local peer). No-op if the
/// row already exists. Used at claim and idempotent re-claim. `fresh_dek` carries a
/// just-minted identity DEK (mint paths: the DEK isn't in `ShellState` yet); when
/// `None` the identity's current DEK is read from the shell.
async fn ensure_aven_ceo_owner_row(
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
	identity_uuid: Uuid,
	fresh_dek: Option<(&[u8; 32], i64)>,
) -> Result<(), String> {
	let signer_did = shell.signer_did.as_str();
	let signers_schema = jazz_engine::resolved_table_schema(client, "signers").await?;
	let identity_ix = jazz_engine::col_ix(&signers_schema, "owner")?;
	let did_ix = jazz_engine::col_ix(&signers_schema, "signer_did")?;
	let rows = jazz_engine::exec_list_rows(client, "signers").await?;
	for (_o, vals) in &rows {
		let sid = jazz_engine::uuid_cell_at(vals.as_slice(), identity_ix).ok();
		let d = match vals.get(did_ix) {
			Some(Value::Text(s)) => s.as_str(),
			_ => "",
		};
		if sid == Some(identity_uuid) && d == signer_did {
			return Ok(());
		}
	}
	let (name, label) = read_own_profile(client, signer_did).await;
	let now_ms: i64 = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0);
	let mut prow = Map::new();
	prow.insert("owner".into(), JsonValue::String(identity_uuid.to_string()));
	prow.insert("signer_did".into(), JsonValue::String(signer_did.to_string()));
	prow.insert("kind".into(), JsonValue::String("member".into()));
	prow.insert("status".into(), JsonValue::String("active".into()));
	prow.insert("account_name".into(), JsonValue::String(name));
	prow.insert("device_label".into(), JsonValue::String(label));
	prow.insert("added_at_ms".into(), JsonValue::Number(now_ms.into()));
	let prow_oid = ObjectId::new();
	// Private-by-default: seal account_name/device_label under the identity DEK before
	// materializing the row (routing columns stay plaintext). owner = identity_uuid,
	// object row = this freshly created roster row's oid.
	match fresh_dek {
		Some((dek32, dek_ver)) => jazz_engine::seal_sensitive_in_row_with_dek(
			dek32,
			"signers",
			&signers_schema,
			identity_uuid,
			*prow_oid.uuid(),
			dek_ver,
			&mut prow,
		)?,
		None => jazz_engine::seal_sensitive_in_patch(
			shell,
			"signers",
			&signers_schema,
			identity_uuid,
			*prow_oid.uuid(),
			&mut prow,
		)?,
	}
	let prow_vals = insert_values("signers", &signers_schema, prow)?;
	let prow_meta = owner_binding_meta(&shell.signing_key, prow_oid, identity_uuid)?;
	client.create_with_id_and_metadata("signers", prow_oid, prow_vals, prow_meta).await.map_err(format_jazz_err)?;
	Ok(())
}

/// Read this device's self profile for auto-publishing into the roster: display
/// name from the singleton `humans.first_name`, device label from this device's
/// own (`kind=local`/own-DID) `peers` row. Both best-effort (empty if unset).
async fn read_own_profile(client: &JazzClient, signer_did: &str) -> (String, String) {
	let mut name = String::new();
	let mut label = String::new();
	// Display name from this device's own (human-typed) identity. `name` is sealed,
	// so the roster uses the plaintext `username_slug` handle (best-effort).
	if let Ok(schema) = jazz_engine::resolved_table_schema(client, "safes").await {
		if let (Ok(type_ix), Ok(slug_ix)) = (
			jazz_engine::col_ix(&schema, "type"),
			jazz_engine::col_ix(&schema, "username_slug"),
		) {
			if let Ok(rows) = jazz_engine::exec_list_rows(client, "safes").await {
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
	if let Ok(schema) = jazz_engine::resolved_table_schema(client, "signers").await {
		if let (Ok(did_ix), Ok(label_ix)) = (
			jazz_engine::col_ix(&schema, "signer_did"),
			jazz_engine::col_ix(&schema, "device_label"),
		) {
			if let Ok(rows) = jazz_engine::exec_list_rows(client, "signers").await {
				for (_o, vals) in rows {
					let d = match vals.get(did_ix) {
						Some(Value::Text(s)) => s.as_str(),
						_ => "",
					};
					if d == signer_did {
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
	signer_did: String,
) -> Result<(), String> {
	use base64::engine::general_purpose::URL_SAFE_NO_PAD;
	use base64::Engine;

	let signer_did = signer_did.trim().to_string();
	if signer_did.is_empty() {
		return Err("signer_did is empty".into());
	}
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();
	if signer_did == shell.signer_did {
		return Err("cannot add yourself as a member".into());
	}
	let peer_pk = crate::jazz_auth::ed25519_public_from_signer_did(&signer_did)?;
	let identity_uuid = crate::identity_acc::aven_ceo_identity(tauri_plugin_self::network::NETWORK_SEED);

	crate::signers::add_remote_signer(client.as_ref(), &signer_did, "").await?;
	if let Err(e) = client.register_peer_sync_client(PeerId(peer_pk)) {
		log::warn!(target: "avenos::jazz", "aven_ceo_add_member register {signer_did}: {e}");
	}

	// Only the avenCEO owner may add members.
	jazz_engine::authorize_gate(shell, "safes", crate::identity_acc::AccOp::Write, identity_uuid, None)?;

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
	let signers_schema = jazz_engine::resolved_table_schema(client.as_ref(), "signers").await?;
	let mut prow = Map::new();
	prow.insert("owner".into(), JsonValue::String(identity_uuid.to_string()));
	prow.insert("signer_did".into(), JsonValue::String(signer_did.clone()));
	prow.insert("kind".into(), JsonValue::String("member".into()));
	prow.insert("status".into(), JsonValue::String("active".into()));
	prow.insert("added_at_ms".into(), JsonValue::Number(now_ms.into()));
	let prow_vals = insert_values("signers", &signers_schema, prow)?;
	let member_oid = ObjectId::new();
	let prow_meta = owner_binding_meta(&shell.signing_key, member_oid, identity_uuid)?;
	client.create_with_id_and_metadata("signers", member_oid, prow_vals, prow_meta).await.map_err(format_jazz_err)?;

	// 2. Keyshare: wrap EVERY held avenCEO DEK version to the member so it can decrypt the
	//    sealed roster fields (and prior-version data after any rotation). Idempotent.
	wrap_all_dek_versions_to_recipient(client.as_ref(), shell, identity_uuid, &signer_did).await?;

	// 3. Membership bundle in the biscuit: reads (whole roster) + write (own row only).
	let bisc = shell
		.vault
		.safes
		.get(&identity_uuid)
		.ok_or_else(|| "avenCEO identity not loaded in vault".to_string())?;
	let row_prefix = format!("safe:{identity_uuid}:signers:{}", member_oid.uuid());
	let chain = crate::identity_acc::attenuate_add_reader_third_party(
		&shell.vault.biscuit_kp,
		&bisc.biscuit,
		identity_uuid,
		&signer_did,
	)?;
	let chain = crate::identity_acc::attenuate_add_grant_third_party(
		&shell.vault.biscuit_kp,
		&chain,
		&signer_did,
		"write",
		&row_prefix,
	)?;
	let genesis_b64 =
		URL_SAFE_NO_PAD.encode(chain.to_vec().map_err(|e| format!("biscuit_encode:{e:?}"))?);

	// Sealed write (private-by-default; board 0015 — see admin_add).
	update_identity_genesis(client.as_ref(), shell, identity_uuid, genesis_b64).await?;

	finish_spark_admin_grant(app, jazz, self_state, client, identity_uuid).await?;
	Ok(())
}

/// Member self-publishes its profile into its OWN avenCEO roster row (the row the
/// owner created at `add_member`). Finds the row by this device's DID and updates
/// `account_name` + `device_label`; the local biscuit gate authorizes the write
/// via the row-scoped `grant(did,"write",identity:avenCEO:signers:<ownRow>)`.
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

	let signers_schema = jazz_engine::resolved_table_schema(client.as_ref(), "signers").await?;
	let identity_ix = jazz_engine::col_ix(&signers_schema, "owner")?;
	let did_ix = jazz_engine::col_ix(&signers_schema, "signer_did")?;
	let rows = jazz_engine::exec_list_rows(client.as_ref(), "signers").await?;
	let mut own_oid: Option<ObjectId> = None;
	for (oid, vals) in rows {
		let sid = jazz_engine::uuid_cell_at(vals.as_slice(), identity_ix).ok();
		let did = match vals.get(did_ix) {
			Some(Value::Text(s)) => s.as_str(),
			_ => "",
		};
		if sid == Some(identity_uuid) && did == shell.signer_did.as_str() {
			own_oid = Some(oid);
			break;
		}
	}
	let own_oid = own_oid
		.ok_or_else(|| "no avenCEO roster row for this device yet — ask an admin to add your DID".to_string())?;

	// Biscuit gate: this device holds write on its own row (and nothing else).
	jazz_engine::authorize_gate(
		shell,
		"signers",
		crate::identity_acc::AccOp::Write,
		identity_uuid,
		Some(*own_oid.uuid()),
	)?;

	// Auto-publish from this device's identity when the caller passes blanks
	// (name from humans.first_name, label from the local device peer row).
	let (def_name, def_label) = read_own_profile(client.as_ref(), &shell.signer_did).await;
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
	// Private-by-default: seal account_name/device_label under the identity DEK, scoped
	// to this member's own roster row, before building the patch ops.
	jazz_engine::seal_sensitive_in_patch(
		shell,
		"signers",
		&signers_schema,
		identity_uuid,
		*own_oid.uuid(),
		&mut patch,
	)?;
	let ops = patch_updates(&signers_schema, patch)?;
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
	let Some(bisc) = shell.vault.safes.get(&identity_uuid) else {
		return Ok("none".to_string());
	};
	let owner = crate::identity_acc::identity_peer_is_owner(&bisc.biscuit, identity_uuid, &shell.signer_did)?;
	if owner {
		return Ok("owner".to_string());
	}
	// Merely HYDRATING the avenCEO genesis is NOT membership — the genesis syncs widely, so a
	// device can hold the identity in its vault with no grant at all. Membership requires an
	// actual cap to THIS device (a `reads` or `replicate` grant). Without one, the device has
	// only *seen* avenCEO and must stay on the invite gate — no auto-progress without caps.
	let did = shell.signer_did.trim();
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

/// Self-healing keyshare invariant: every transitive OWNS signer of a SAFE this
/// device controls must hold a keyshare for every DEK version we hold of it.
/// The one-shot wraps (create-time controller wrap, grant-time downstream
/// propagation) cover the common orders, but any missed/raced wrap used to be
/// permanent — a member of the controlling SAFE then "had access" in the biscuit
/// yet could never decrypt the controlled SAFE (the avenMAIA-invisible-to-baba
/// bug). Idempotent (`wrap_all_dek_versions_to_recipient` skips held versions)
/// and owner-side only: it wraps to the biscuit's owns-closure, never wider.
async fn reconcile_owner_keyshares(
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
) -> Result<(), String> {
	let safe_ids: Vec<Uuid> = shell.vault.safes.keys().copied().collect();
	for sid in safe_ids {
		if !shell.deks.keys().any(|(s, _)| *s == sid) {
			continue;
		}
		if jazz_engine::authorize_gate(shell, "safes", crate::identity_acc::AccOp::Write, sid, None)
			.is_err()
		{
			continue;
		}
		let mut recipients: Vec<String> =
			crate::identity_acc::safe_transitive_signers(&shell.vault, sid)
				.into_iter()
				.collect();
		// Every did:safe: member (owner-grade) also gets its WRAP-KEY share — this is the
		// path that works even when the member SAFE is foreign (its signer set unreadable).
		if let Some(bisc) = shell.vault.safes.get(&sid) {
			if let Ok(admins) = crate::identity_acc::identity_admins(&bisc.biscuit, sid) {
				for admin in admins {
					let Some(member_safe) = crate::identity_acc::resolve_safe_did(&admin) else {
						continue;
					};
					if member_safe == sid {
						continue;
					}
					if let Some(wd) = find_safe_wrap_did(client, member_safe).await? {
						recipients.push(wd);
					}
				}
			}
		}
		for recip in recipients {
			if recip == shell.signer_did {
				continue;
			}
			wrap_all_dek_versions_to_recipient(client, shell, sid, &recip).await?;
		}
	}
	Ok(())
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

	// Repair pass over the FRESH shell (post-grant biscuits): wrap any keyshare a
	// transitive owns-signer is still missing, so cascade correctness never depends
	// on the order of create vs. grant. Non-fatal — the grant itself already landed.
	if let Err(e) = reconcile_owner_keyshares(client.as_ref(), shell.as_ref()).await {
		log::warn!(target: "avenos::jazz", "post-grant keyshare reconcile failed: {e}");
	}

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
		.publish_table_snapshot_force(app, client.as_ref(), shell.as_ref(), "safes")
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
	/// Whether THIS device may manage the identity (grant/revoke) — the same
	/// `authorize_gate(Write)` the grant IPCs enforce, so the UI's owner-only form
	/// follows the biscuit's full N-hop SAFE-in-SAFE walk instead of guessing from
	/// DID string equality (which misses transitive control, e.g. a human-SAFE
	/// signer managing the aven SAFE that human SAFE owns).
	pub viewer_owns: bool,
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
		.safes
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
	let viewer_owns = jazz_engine::authorize_gate(
		shell.as_ref(),
		"safes",
		crate::identity_acc::AccOp::Write,
		identity_uuid,
		None,
	)
	.is_ok();
	Ok(IdentityAdminListReply {
		admin_dids,
		replica_dids,
		subjects,
		viewer_owns,
	})
}

/// v2 per-identity revoke = **key rotation**. Removes `signer_did` from `owner`:
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
	signer_did: String,
) -> Result<(), String> {
	use base64::engine::general_purpose::URL_SAFE_NO_PAD;
	use base64::Engine;

	let identity_uuid =
		Uuid::parse_str(owner.trim()).map_err(|e| format!("invalid owner UUID: {e}"))?;
	let signer_did = signer_did.trim().to_string();
	if signer_did.is_empty() {
		return Err("signer_did is empty".into());
	}

	let client = with_connected_client(jazz, app, self_state).await?;
	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();

	if signer_did == shell.signer_did {
		return Err("cannot revoke your own access".into());
	}

	jazz_engine::authorize_gate(shell, "safes", crate::identity_acc::AccOp::Write, identity_uuid, None)?;

	let cur_v = shell
		.identity_versions
		.get(&identity_uuid)
		.copied()
		.ok_or_else(|| format!("missing dek version for identity {identity_uuid}"))?;
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

	let new_biscuit =
		crate::identity_acc::rebuild_identity_biscuit_excluding(&shell.vault, identity_uuid, &signer_did)?;

	let new_v = cur_v + 1;
	let new_dek = crate::crypto::random_identity_dek();
	let urn = jazz_engine::safe_urn(identity_uuid);
	for recip_did in prior_holders.iter().filter(|d| {
		d.as_str() != signer_did.as_str()
			&& crate::identity_acc::chain_still_member(&shell.vault, &new_biscuit, identity_uuid, d.as_str())
	}) {
		let recip_pk = crate::jazz_auth::ed25519_public_from_signer_did(recip_did)?;
		let kek = crate::crypto::derive_kek_x25519(&shell.signing_key, &recip_pk)?;
		let aad = crate::crypto::keyshare_wrap_aad(&urn, recip_did, &shell.signer_did, new_v);
		let wrapped = crate::crypto::encrypt_keyshare_payload(&kek, new_dek.expose(), &aad)?;
		let mut ks = Map::new();
		ks.insert("owner".into(), JsonValue::String(identity_uuid.to_string()));
		ks.insert("dek_version".into(), JsonValue::Number(new_v.into()));
		ks.insert("recipient_did".into(), JsonValue::String(recip_did.clone()));
		ks.insert("wrapper_did".into(), JsonValue::String(shell.signer_did.clone()));
		ks.insert("wrapped_dek".into(), JsonValue::String(wrapped));
		let ks_vals = insert_values("keyshares", &ks_schema, ks)?;
		let ks_oid = ObjectId::new();
		let ks_meta = owner_binding_meta(&shell.signing_key, ks_oid, identity_uuid)?;
		client
			.create_with_id_and_metadata("keyshares", ks_oid, ks_vals, ks_meta)
			.await
			.map_err(format_jazz_err)?;
	}

	let genesis_b64 = URL_SAFE_NO_PAD.encode(
		new_biscuit
			.to_vec()
			.map_err(|e| format!("biscuit_encode:{e:?}"))?,
	);
	let revoke_genesis_b64 = genesis_b64.clone();
	let issuer_b64 = crate::identity_acc::encode_issuer_pubkey_b64(&shell.vault.biscuit_kp.public());
	let sparks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "safes").await?;
	let identity_id_ix = jazz_engine::col_ix(&sparks_schema, "owner")?;
	let sparks_rows = jazz_engine::exec_list_rows(client.as_ref(), "safes").await?;
	let mut sparks_oid: Option<ObjectId> = None;
	for (oid, vals) in sparks_rows {
		if jazz_engine::uuid_cell_at(vals.as_slice(), identity_id_ix)? == identity_uuid {
			sparks_oid = Some(oid);
			break;
		}
	}
	let sparks_oid =
		sparks_oid.ok_or_else(|| format!("no safes row for owner={identity_uuid}"))?;
	let mut patch = Map::new();
	patch.insert("genesis_b64".into(), JsonValue::String(genesis_b64));
	patch.insert("issuer_pubkey_b64".into(), JsonValue::String(issuer_b64));
	patch.insert("current_dek_version".into(), JsonValue::Number(new_v.into()));
	// Sealed write (private-by-default): genesis/issuer are trust-root cells — never
	// cleartext (board 0015). Sealed under the still-current version; members open
	// with any held version (`current_dek_version` is plaintext routing).
	jazz_engine::seal_sensitive_in_patch(
		shell,
		"safes",
		&sparks_schema,
		identity_uuid,
		*sparks_oid.uuid(),
		&mut patch,
	)?;
	let ops = patch_updates(&sparks_schema, patch)?;
	let upd_meta = owner_binding_meta(&shell.signing_key, sparks_oid, identity_uuid)?;
	client
		.update_with_metadata(sparks_oid, ops, upd_meta)
		.await
		.map_err(format_jazz_err)?;

	let ks_spark_ix = jazz_engine::col_ix(&ks_schema, "owner")?;
	let ks_recip_ix = jazz_engine::col_ix(&ks_schema, "recipient_did")?;
	let ks_rows = jazz_engine::exec_list_rows(client.as_ref(), "keyshares").await?;
	for (oid, vals) in ks_rows {
		let sid = jazz_engine::uuid_cell_at(vals.as_slice(), ks_spark_ix)?;
		let recip = match vals.get(ks_recip_ix) {
			Some(Value::Text(s)) => s.as_str(),
			_ => continue,
		};
		if sid == identity_uuid
			&& (recip == signer_did.as_str()
				|| !crate::identity_acc::chain_still_member(&shell.vault, &new_biscuit, identity_uuid, recip))
		{
			let del_meta = owner_binding_meta(&shell.signing_key, oid, identity_uuid)?;
			let _ = client.delete_with_metadata(oid, del_meta).await;
		}
	}

	refresh_downstream_controller_copies(client.as_ref(), shell, identity_uuid, &revoke_genesis_b64)
		.await?;
	if signer_did.starts_with(crate::identity_acc::SAFE_DID_PREFIX) {
		if let Ok(sc_schema) = jazz_engine::resolved_table_schema(client.as_ref(), "safe_controllers").await {
			let own_ix = jazz_engine::col_ix(&sc_schema, "owner")?;
			let did_ix = jazz_engine::col_ix(&sc_schema, "controller_did")?;
			for (oid, vals) in jazz_engine::exec_list_rows(client.as_ref(), "safe_controllers").await? {
				if jazz_engine::uuid_cell_at(vals.as_slice(), own_ix)? == identity_uuid
					&& matches!(vals.get(did_ix), Some(Value::Text(s)) if s.as_str() == signer_did.as_str())
				{
					let del_meta = owner_binding_meta(&shell.signing_key, oid, identity_uuid)?;
					let _ = client.delete_with_metadata(oid, del_meta).await;
				}
			}
		}
	}

	let downstream: Vec<Uuid> = shell
		.vault
		.safes
		.keys()
		.copied()
		.filter(|&oid| {
			oid != identity_uuid
				&& crate::identity_acc::safe_controlled_by(&shell.vault, oid, identity_uuid)
		})
		.collect();
	for x in downstream {
		if let Err(e) = cascade_rotate_one(client.as_ref(), shell, x, identity_uuid, &new_biscuit).await {
			log::warn!(target: "avenos::jazz", "cascade rotate of downstream SAFE {x}: {e}");
		}
	}

	finish_spark_admin_grant(app, jazz, self_state, client, identity_uuid).await?;

	Ok(())
}


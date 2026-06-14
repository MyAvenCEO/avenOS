//! Row CRUD IPC over the avenDB-backed AvenDb client.

use aven_db::{AvenDbClient, ObjectId};
use serde_json::Value as JsonValue;
use tauri_plugin_self::state::SelfState;
use uuid::Uuid;

use crate::identity_sync;

use super::*;

pub(crate) async fn avendb_ipc_avendb_list(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	self_state: &SelfState,
	table: String,
) -> Result<Vec<JsonRow>, String> {
	let client = with_connected_client(avendb, app, self_state).await?;
	let shell = avendb_shell_ready(app, avendb, self_state, client.clone()).await?;
	let (rows, _) =
		engine::query_table_publish(client.as_ref(), &shell, &table, ENCRYPTED_META).await?;
	Ok(rows)
}

pub(crate) async fn avendb_ipc_avendb_explorer_list(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	self_state: &SelfState,
	table: String,
) -> Result<AvenDbExplorerListReply, String> {
	let client = with_connected_client(avendb, app, self_state).await?;
	let shell = avendb_shell_ready(app, avendb, self_state, client.clone()).await?;
	let (rows, skipped_unauthorized_rows) =
		engine::query_table_publish(client.as_ref(), &shell, &table, ENCRYPTED_META).await?;
	Ok(AvenDbExplorerListReply {
		rows,
		skipped_unauthorized_rows,
	})
}

pub(crate) async fn avendb_ipc_avendb_get(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	self_state: &SelfState,
	table: String,
	id: String,
) -> Result<JsonRow, String> {
	let client = with_connected_client(avendb, app, self_state).await?;
	let shell = avendb_shell_ready(app, avendb, self_state, client.clone()).await?;
	let uuid = Uuid::parse_str(&id).map_err(|e| format!("invalid id UUID: {e}"))?;

	let tbl = engine::resolved_table_schema(client.as_ref(), &table).await?;
	match engine::find_row_snapshot(client.as_ref(), &table, &tbl, uuid).await? {
		Some((oid, vals)) => {
			let identity_row = engine::identity_uuid_row(&tbl, &vals).unwrap_or(shell.default_identity);
			engine::authorize_gate(
				&shell,
				&table,
				crate::identity_acc::AccOp::Read,
				identity_row,
				Some(*oid.uuid()),
			)?;
			engine::row_to_public_map(
				&shell,
				&table,
				&tbl,
				oid,
				&vals,
				ENCRYPTED_META,
			)
		}
		None => Err(format!("row not found table={table} id={uuid}")),
	}
}

/// Mint a signed owner-binding for a freshly generated `row_id` and return it as the
/// row-metadata entry to stamp at create. EVERY identity-scoped create (data AND
/// control-plane) routes a binding through this, so the row carries its proof on the
/// wire and is verified on apply — the basis for deny-by-default (private by default).
pub(crate) fn owner_binding_meta(
	signing_key: &ed25519_dalek::SigningKey,
	row_id: ObjectId,
	owner: Uuid,
) -> Result<std::collections::HashMap<String, String>, String> {
	let binding =
		aven_caps::ownership::mint_owner_binding(signing_key, *row_id.uuid(), owner)?;
	let mut meta = std::collections::HashMap::new();
	meta.insert(
		aven_caps::ownership::OWNER_BINDING_META_KEY.to_string(),
		binding.to_meta_string(),
	);
	Ok(meta)
}

async fn finish_spark_data_write(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	client: &AvenDbClient,
	shell: &engine::ShellState,
	table: &str,
) {
	if !identity_sync::is_spark_data_table(table) {
		return;
	}
	let _ = avendb
		.snapshot_broadcast(app, client, shell, table)
		.await;
}

pub(crate) async fn avendb_ipc_avendb_create(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	self_state: &SelfState,
	table: String,
	mut values: JsonRow,
) -> Result<JsonRow, String> {
	let client = with_connected_client(avendb, app, self_state).await?;
	let shell = avendb_shell_ready(app, avendb, self_state, client.clone()).await?;
	let tbl = engine::resolved_table_schema(client.as_ref(), &table).await?;

	if table == "signers" {
		let identity = engine::identity_uuid_from_json_row(&tbl, &values)?;
		let vals = insert_values("signers", &tbl, values)?;
		let oid = ObjectId::new();
		client
			.create(&table, identity, Some(oid), vals.clone())
			.await
			.map_err(format_avendb_err)?;

		let (_, vals_fresh) =
			engine::find_row_snapshot(client.as_ref(), &table, &tbl, *oid.uuid())
				.await?
				.ok_or_else(|| "create_reread_missing".to_string())?;

		let reply = engine::row_to_public_map(
			&shell,
			&table,
			&tbl,
			oid,
			&vals_fresh,
			ENCRYPTED_META,
		)?;

		let _ = avendb.change_tx.send(table.clone());

		#[cfg(any(target_os = "macos", target_os = "ios"))]
		{
			let _ = execute_mesh_refresh_full(app, avendb).await?;
		}

		return Ok(reply);
	}

	let mut plaintext = std::collections::HashMap::new();

	engine::inject_default_identity(&mut values, &tbl, shell.default_identity)?;
	let identity_gate = engine::identity_uuid_from_json_row(&tbl, &values)?;
	engine::authorize_gate(
		&shell,
		&table,
		crate::identity_acc::AccOp::Write,
		identity_gate,
		None,
	)?;
	engine::place_secrets_for_insert(
		&tbl,
		&table,
		&mut values,
		&mut plaintext,
		PHASE1_SECRET_PLACEHOLDER,
	)?;

		let vals = insert_values(&table, &tbl, values)?;
		// Stamp a signed owner-binding (digest-covered) so every peer verifies it on
		// apply; the id is fixed up-front so the binding's value_id == the row id.
		let oid = ObjectId::new();
		let oid = client
			.create(&table, identity_gate, Some(oid), vals.clone())
			.await
			.map_err(format_avendb_err)?;

	if identity_sync::needs_acl_object_map_refresh_after_create(&table) {
		let _ = avendb.refresh_sync_acl_object_map(client.as_ref()).await;
	}

	if !plaintext.is_empty() {
		let identity = engine::identity_uuid_named(&vals)?;
		let mut ph = JsonRow::new();
		for (col, pt) in plaintext {
			let cd = tbl
				.columns
				.column(&col)
				.ok_or_else(|| format!("manifest_missing_col:{col}"))?;
			ph.insert(
				col.clone(),
				JsonValue::String(engine::seal_column_plain(
					&shell,
					&table,
					&col,
					&cd.column_type,
					identity,
					*oid.uuid(),
					&pt,
				)?),
			);
		}
		let ops = patch_updates(&tbl, ph)?;
		let upd_meta = owner_binding_meta(&shell.signing_key, oid, identity)?;
		client
			.update_with_metadata(oid, ops, upd_meta)
			.await
			.map_err(format_avendb_err)?;
	}

	let (_, vals_fresh) =
		engine::find_row_snapshot(client.as_ref(), &table, &tbl, *oid.uuid())
			.await?
			.ok_or_else(|| "create_reread_missing".to_string())?;

	let reply = engine::row_to_public_map(
		&shell,
		&table,
		&tbl,
		oid,
		&vals_fresh,
		ENCRYPTED_META,
	)?;

	let _ = avendb.change_tx.send(table.clone());

	finish_spark_data_write(app, avendb, client.as_ref(), shell.as_ref(), &table).await;

	Ok(reply)
}

pub(crate) async fn avendb_ipc_avendb_update(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	self_state: &SelfState,
	table: String,
	id: String,
	patch: JsonRow,
) -> Result<JsonRow, String> {
	let client = with_connected_client(avendb, app, self_state).await?;
	let shell = avendb_shell_ready(app, avendb, self_state, client.clone()).await?;
	let tbl = engine::resolved_table_schema(client.as_ref(), &table).await?;
	let uuid =
		uuid::Uuid::parse_str(&id).map_err(|e| format!("invalid id UUID parse: {e}"))?;

	// Owner is write-once. The signed owner-binding pins a row's identity and
	// `verify_on_apply` rejects any relabel at every peer (relay-proof). Refuse a
	// local relabel too, so the field is truly immutable: a user-data update must
	// never carry the owning-identity column.
	if patch.contains_key("owner") {
		return Err(
			"owner is immutable: a row's owning identity cannot be changed via update".into(),
		);
	}

	// `find_row_snapshot` reads without `.branch()` so jazz-tools auto-loads the
	// row's `Object` on **every** known schema-version branch into ObjectManager.
	// Important: keep using `oid` from the query result — `ObjectId::from_uuid`
	// produces a non-interned id that misses the pointer-keyed in-memory map.
	let (oid, old_vals) = engine::find_row_snapshot(client.as_ref(), &table, &tbl, uuid)
		.await?
		.ok_or_else(|| {
			log::warn!(
				target: "avenos::avendb",
				"avendb_update row missing in any known schema branch table={table} uuid={uuid} avendb_branch={}",
				shell.avendb_write_branch
			);
			format!(
				"row_not_found:{uuid} (table={table}). Row is not visible on any known schema-version branch \
				— it may have been hard-deleted, or this client has no lens path to its schema yet."
			)
		})?;
	let runtime_branch = engine::avendb_write_branch_from_connected_schema_or_log(client.as_ref()).await;
	log::debug!(
		target: "avenos::avendb",
		"avendb_update resolved row table={table} uuid={uuid} cached_branch={} runtime_branch={runtime_branch} oid_uuid={}",
		shell.avendb_write_branch,
		oid.uuid()
	);
	let identity = engine::identity_uuid_row(&tbl, &old_vals)?;

	engine::authorize_gate(
		&shell,
		&table,
		crate::identity_acc::AccOp::Write,
		identity,
		Some(uuid),
	)?;

	let mut sealed_patch = patch;
	if let Some(sec) = engine::secrets_for_table(&table) {
		for col in sec.iter() {
			if let Some(js) = sealed_patch.get(col.as_str()).cloned() {
				if js.is_null() {
					continue;
				}
				let cd = tbl
					.columns
					.column(col)
					.ok_or_else(|| format!("unknown_sensitive_col:{col}"))?;
				let gv = if let Some(expose) =
					crate::schema_manifest::expose_ts_for(&table, col)
				{
					json_cell_to_avendb(&js, expose, cd.nullable)?
				} else {
					json_cell_to_avendb(&js, &cd.column_type, cd.nullable)?
				};
				let canon = crate::crypto::avendb_value_to_canonical_utf8(&gv)?;
				let ct = engine::seal_column_plain(
					&shell,
					&table,
					col,
					&cd.column_type,
					identity,
					uuid,
					&canon,
				)?;
				sealed_patch.insert(col.clone(), JsonValue::String(ct));
			}
		}
	}

	let ops = patch_updates(&tbl, sealed_patch)?;

	let upd_meta = owner_binding_meta(&shell.signing_key, oid, identity)?;
	client
		.update_with_metadata(oid, ops, upd_meta)
		.await
		.map_err(|e| {
			let msg = format_avendb_err(e);
			log::warn!(
				target: "avenos::avendb",
				"avendb_update avenDB write failed table={table} uuid={uuid} write_branch={} runtime_branch={runtime_branch} oid_uuid={} err={}",
				shell.avendb_write_branch,
				oid.uuid(),
				msg
			);
			format!(
				"{msg} (table={table} id={uuid} write_branch={} runtime_branch={runtime_branch})",
				shell.avendb_write_branch
			)
		})?;

	let _ = avendb.change_tx.send(table.clone());

	finish_spark_data_write(app, avendb, client.as_ref(), shell.as_ref(), &table).await;

	avendb_ipc_avendb_get(app, avendb, self_state, table, id.to_string()).await
}

pub(crate) async fn avendb_ipc_avendb_delete(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	self_state: &SelfState,
	table: String,
	id: String,
) -> Result<(), String> {
	let client = with_connected_client(avendb, app, self_state).await?;
	let shell = avendb_shell_ready(app, avendb, self_state, client.clone()).await?;
	let tbl = engine::resolved_table_schema(client.as_ref(), &table).await?;
	let uuid =
		uuid::Uuid::parse_str(&id).map_err(|e| format!("invalid UUID: {e}"))?;
	// See avendb_update: read across all known schema branches so the row's
	// `Object` is loaded into ObjectManager on every branch it lives on. Use
	// the interned `oid` from the query (never `ObjectId::from_uuid`).
	let (oid, row_vals) = engine::find_row_snapshot(client.as_ref(), &table, &tbl, uuid)
		.await?
		.ok_or_else(|| {
			log::warn!(
				target: "avenos::avendb",
				"avendb_delete row missing in any known schema branch table={table} uuid={uuid} avendb_branch={}",
				shell.avendb_write_branch
			);
			format!(
				"row_not_found:{uuid} (table={table}). Row is not visible on any known schema-version branch."
			)
		})?;
	let runtime_branch = engine::avendb_write_branch_from_connected_schema_or_log(client.as_ref()).await;
	log::debug!(
		target: "avenos::avendb",
		"avendb_delete resolved row table={table} uuid={uuid} cached_branch={} runtime_branch={runtime_branch} oid_uuid={}",
		shell.avendb_write_branch,
		oid.uuid()
	);
	let identity = engine::identity_uuid_row(&tbl, &row_vals)?;

	engine::authorize_gate(
		&shell,
		&table,
		crate::identity_acc::AccOp::Delete,
		identity,
		Some(uuid),
	)?;

	let del_meta = owner_binding_meta(&shell.signing_key, oid, identity)?;
	client
		.delete_with_metadata(oid, del_meta)
		.await
		.map_err(|e| {
			let msg = format_avendb_err(e);
			log::warn!(
				target: "avenos::avendb",
				"avendb_delete avenDB write failed table={table} uuid={uuid} write_branch={} runtime_branch={runtime_branch} oid_uuid={} err={}",
				shell.avendb_write_branch,
				oid.uuid(),
				msg
			);
			format!(
				"{msg} (table={table} id={uuid} write_branch={} runtime_branch={runtime_branch})",
				shell.avendb_write_branch
			)
		})?;
	let _ = avendb.change_tx.send(table.clone());
	Ok(())
}

pub(crate) async fn avendb_ipc_avendb_subscribe(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	self_state: &SelfState,
	table: String,
) -> Result<(), String> {
	let _n = avendb.bump_table_ui_ref(&table).await;
	if table == "signers" {
		let client = with_connected_client(avendb, app, self_state).await?;
		let rows = crate::signers::list_signer_rows(client.as_ref()).await?;
		emit_avenos_runtime(
			app,
			serde_json::json!({
				"kind": "table",
				"table": &table,
				"rows": rows,
			}),
		);
		return Ok(());
	}
	let client = with_connected_client(avendb, app, self_state).await?;
	let shell = avendb_shell_ready(app, avendb, self_state, client.clone()).await?;
	let (snap, _) =
		engine::query_table_publish(client.as_ref(), &shell, &table, ENCRYPTED_META).await?;
	emit_avenos_runtime(
		app,
		serde_json::json!({
			"kind": "table",
			"table": &table,
			"rows": snap,
		}),
	);
	Ok(())
}

pub(crate) async fn avendb_ipc_avendb_unsubscribe(avendb: &ManagedAvenDb, table: String) -> Result<(), String> {
	avendb.drop_table_ui_ref(&table).await;
	Ok(())
}

pub(super) fn pj_opt_str(p: &serde_json::Value, key: &str) -> Option<String> {
	p.get(key)
		.and_then(|v| v.as_str())
		.map(|s| s.trim().to_string())
		.filter(|s| !s.is_empty())
}

pub(super) fn pj_str(p: &serde_json::Value, key: &str) -> Result<String, String> {
	p.get(key)
		.and_then(|v| v.as_str())
		.map(|s| s.trim().to_string())
		.filter(|s| !s.is_empty())
		.ok_or_else(|| format!("avendb_runtime: missing or empty string field `{key}`"))
}

/// Announce our frontier to peers after a local identity-scoped write so they pull
/// the change **live**. The engine seal publishes rows locally but does not
/// announce to peers on its own — without this, peers only converge on the next
/// reconnect/catch-up ("syncs on restart, not on the fly"). Idempotent: peers
/// diff our heads and pull only what they're owed + authorized for.
pub(super) async fn announce_local_write_to_peers(
	app: &tauri::AppHandle,
	mj: &ManagedAvenDb,
	ss: &SelfState,
	table: &str,
) {
	if !identity_sync::is_spark_scoped_table(table) {
		return; // local-only tables (peers/humans) are never P2P-forwarded
	}
	let Ok(client) = with_connected_client(mj, app, ss).await else {
		return;
	};
	if let Err(e) = client.rebroadcast_all_peer_clients_and_flush().await {
		log::debug!(target: "avenos::avendb", "announce local write to peers ({table}): {e}");
	}
}

//! Generic Jazz CRUD over Tauri IPC. Schema mirrors `libs/jazz-schema/schema.manifest.json`.

mod jazz_engine;

use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::RwLock;

use groove::{
	query_manager::types::{ColumnType, TableSchema},
	AppContext,
	AppId,
	ClientId,
	JazzClient,
	JazzError,
	ObjectId,
	Value,
};
use serde_json::{Map, Value as JsonValue};
use tauri::{Emitter, Manager};
use tauri_plugin_self::derive::ed25519_public;
use tauri_plugin_self::state::SelfState;
use tokio::sync::{broadcast, Mutex};
use uuid::Uuid;

pub type JsonRow = Map<String, JsonValue>;

pub(super) const PHASE1_SECRET_PLACEHOLDER: &str = "\u{feff}";
pub(super) const ENCRYPTED_META: &str = "_encryptedColumns";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JazzStatusReply {
	pub ready: bool,
	pub tables: Vec<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JazzSessionReply {
	pub peer_did: String,
	pub peer_did_short: String,
	pub default_spark_urn: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JazzExplorerListReply {
	pub rows: Vec<JsonRow>,
	pub skipped_unauthorized_rows: usize,
}

/// Groove-backed Jazz client lifecycle. Clearing on lock / fingerprint mismatch avoids serving
/// a stale SurrealKV view after `SelfState` changes.
pub struct ManagedJazz {
	client: Mutex<Option<std::sync::Arc<JazzClient>>>,
	table_txs: RwLock<HashMap<String, broadcast::Sender<Vec<JsonRow>>>>,
	shell: Mutex<Option<std::sync::Arc<jazz_engine::ShellState>>>,
	/// Jazz Groove persistence [`ClientId`](groove::ClientId)`s UUID`; must track the unlocked shell.
	connected_client_uuid: Mutex<Option<Uuid>>,
}

impl Default for ManagedJazz {
	fn default() -> Self {
		Self {
			client: Mutex::new(None),
			table_txs: RwLock::new(HashMap::new()),
			shell: Mutex::new(None),
			connected_client_uuid: Mutex::new(None),
		}
	}
}

async fn shutdown_jazz_holder(old: Option<std::sync::Arc<JazzClient>>) {
	let Some(arc) = old else {
		return;
	};
	match std::sync::Arc::try_unwrap(arc) {
		Ok(client) => {
			if let Err(e) = client.shutdown().await {
				log::warn!(target: "avenos::jazz", "JazzClient shutdown failed (flush/sync): {e}");
			}
		}
		Err(remaining) => {
			log::warn!(
				target: "avenos::jazz",
				"JazzClient shutdown skipped: {} Arc holder(s) still alive; SurrealKV may delay lock release until process exit",
				std::sync::Arc::strong_count(&remaining)
			);
		}
	}
}

/// Normalize [`JazzError`] for IPC strings and structured logs (avoids `Write error: Write error:` layering).
#[must_use]
pub(super) fn format_jazz_err(err: JazzError) -> String {
	match &err {
		JazzError::Write(msg) => {
			log::warn!(
				target: "avenos::jazz",
				"groove write (display): {msg} | debug: {:?}",
				err
			);
			msg.clone()
		}
		JazzError::Query(msg) => {
			log::warn!(
				target: "avenos::jazz",
				"groove query (display): {msg} | debug: {:?}",
				err
			);
			msg.clone()
		}
		other => {
			let msg = other.to_string();
			log::warn!(target: "avenos::jazz", "{msg}; debug: {:?}", other);
			msg
		}
	}
}

fn desired_root_client_uuid(self_state: &SelfState) -> Result<Uuid, String> {
	let root = self_state
		.with_root(|r| Ok(*r))
		.map_err(|_| "locked: unlock AvenOS identity first".to_string())?;
	let pk = ed25519_public(&root)?;
	Ok(crate::jazz_auth::client_uuid_from_ed_pubkey(&pk))
}

const SCHEMA_FINGERPRINT_FILE: &str = "schema_fingerprint";

/// Stable signature of the **current** `libs/jazz-schema/schema.manifest.json`. Used to detect a
/// schema-shape change between app launches. Any change of column names / types / order changes
/// Groove's `SchemaHash`, which changes the **branch name** every existing row was committed
/// under. Old commits then live on a branch that the new schema cannot read (`load_branch =
/// Ok(None)`), and `update`/`delete` on those `ObjectId`s return `ObjectNotFound` because they
/// require `current_branch()` tip-ids that simply don't exist for those rows.
fn schema_manifest_fingerprint() -> Result<[u8; 32], String> {
	use sha2::Digest;
	let path = crate::schema_manifest::jazz_schema_manifest_path();
	let bytes =
		fs::read(&path).map_err(|e| format!("read schema manifest {}: {e}", path.display()))?;
	let mut h = sha2::Sha256::new();
	h.update(b"ceo.aven.os/jazz/schema-fingerprint-v1");
	h.update(&bytes);
	Ok(h.finalize().into())
}

/// Wipe Groove storage when **either** identity (Ed25519 → ClientId) **or** schema shape
/// changed since the last successful boot. Both situations leave old commits/index entries
/// stranded on a key prefix the new client can never reach, producing `ObjectNotFound` on every
/// write to a row that does still appear in `list`. Dev-mode safety net: in production this
/// should be a real schema migration with `add_live_schema` + lens transforms.
fn reconcile_jazz_identity_cache_dir(
	jazz_dir: &Path,
	desired_uuid: Uuid,
	current_schema_fp: &[u8; 32],
) -> Result<(), String> {
	let mut reason: Option<String> = None;

	let client_path = jazz_dir.join("client_id");
	match fs::read_to_string(&client_path) {
		Ok(s) => {
			if let Some(cid) = ClientId::parse(s.trim()) {
				if cid.0 != desired_uuid {
					reason = Some(format!(
						"persisted client_id {:?} != current identity {:?}",
						cid.0, desired_uuid
					));
				}
			}
		}
		Err(e) if e.kind() == ErrorKind::NotFound => {}
		Err(e) => return Err(format!("read {}: {e}", client_path.display())),
	}

	let fp_path = jazz_dir.join(SCHEMA_FINGERPRINT_FILE);
	if reason.is_none() {
		match fs::read(&fp_path) {
			Ok(bytes) if bytes == current_schema_fp => {}
			Ok(bytes) => {
				reason = Some(format!(
					"schema fingerprint changed (on-disk={}, current={})",
					hex_short(&bytes),
					hex_short(current_schema_fp)
				));
			}
			Err(e) if e.kind() == ErrorKind::NotFound => {
				// First boot, or upgrade from an older AvenOS that didn't track this.
				// If client_id already exists from such an older boot we cannot tell whether the
				// schema matches the data on disk; treat that as a mismatch and wipe.
				if client_path.exists() {
					reason = Some("schema fingerprint missing while groove data present".into());
				}
			}
			Err(e) => return Err(format!("read {}: {e}", fp_path.display())),
		}
	}

	if let Some(why) = reason {
		log::warn!(
			target: "avenos::jazz",
			"Purging {}: {why}; Groove partition mismatch causes ObjectNotFound-style write failures.",
			jazz_dir.display(),
		);
		if jazz_dir.exists() {
			fs::remove_dir_all(jazz_dir)
				.map_err(|e| format!("remove {}: {e}", jazz_dir.display()))?;
		}
	}

	fs::create_dir_all(jazz_dir).map_err(|e| format!("recreate jazz dir: {e}"))?;
	fs::write(&fp_path, current_schema_fp)
		.map_err(|e| format!("write {}: {e}", fp_path.display()))?;
	Ok(())
}

fn hex_short(bytes: &[u8]) -> String {
	let n = bytes.len().min(6);
	let mut s = String::with_capacity(n * 2);
	for b in &bytes[..n] {
		use std::fmt::Write;
		let _ = write!(s, "{b:02x}");
	}
	s
}

impl ManagedJazz {
	/// Drops cached Groove runtime + biscuit shell (`SelfState`-derived). Prefer calling this whenever
	/// [`SelfState`] is cleared (vault lock).
	pub(crate) async fn reset_connection(&self) {
		let old_client = {
			*self.connected_client_uuid.lock().await = None;
			self.shell.lock().await.take();
			self.client.lock().await.take()
		};
		shutdown_jazz_holder(old_client).await;
	}

	fn broadcaster(&self, table: &str) -> broadcast::Sender<Vec<JsonRow>> {
		let mut w = self.table_txs.write().expect("table_txs poisoned");
		if let Some(tx) = w.get(table).cloned() {
			return tx;
		}
		let (tx, _rx) = broadcast::channel(64);
		w.insert(table.to_string(), tx.clone());
		tx
	}

	pub async fn snapshot_broadcast(
		&self,
		client: &JazzClient,
		shell: &jazz_engine::ShellState,
		table: &str,
	) -> Result<(), String> {
		let (snap, _) = jazz_engine::query_table_publish(client, shell, table, ENCRYPTED_META).await?;
		let r = self.table_txs.read().expect("table_txs poisoned");
		if let Some(tx) = r.get(table) {
			if tx.receiver_count() > 0 {
				let _ = tx.send(snap);
			}
		}
		Ok(())
	}
}

pub(super) fn json_cell_to_jazz(cell: &JsonValue, col_ty: &ColumnType, nullable: bool) -> Result<Value, String> {
	if cell.is_null() || *cell == JsonValue::Null {
		return nullable
			.then(|| Ok(Value::Null))
			.unwrap_or_else(|| Err("null not permitted".into()));
	}
	match col_ty {
		ColumnType::Text => cell
			.as_str()
			.map(|s| Value::Text(s.to_string()))
			.ok_or_else(|| "expected JSON string column".into()),
		ColumnType::Boolean => cell
			.as_bool()
			.map(Value::Boolean)
			.ok_or_else(|| "expected JSON boolean column".into()),
		ColumnType::Integer => cell
			.as_i64()
			.and_then(|n| i32::try_from(n).ok())
			.map(Value::Integer)
			.ok_or_else(|| "expected JSON i32-compatible integer column".into()),
		ColumnType::BigInt => cell
			.as_i64()
			.map(Value::BigInt)
			.ok_or_else(|| "expected JSON i64-compatible integer column".into()),
		ColumnType::Timestamp => cell
			.as_u64()
			.map(Value::Timestamp)
			.ok_or_else(|| "expected JSON u64 timestamp column".into()),
		ColumnType::Uuid => cell
			.as_str()
			.and_then(|s| Uuid::parse_str(s).ok())
			.map(|u| Value::Uuid(ObjectId::from_uuid(u)))
			.ok_or_else(|| "expected UUID string column".into()),
		ColumnType::Array(_) | ColumnType::Row(_) => Err(format!(
			"nested {:?} unsupported through JSON IPC for now",
			col_ty,
		)),
	}
}

/// Same as [`json_cell_to_jazz`] for non-`Text`. For `Text` storage, accepts bool/number payloads as well
/// as strings so IPC can keep logical scalars (e.g. `done: true`) while Groove stores ciphertext in a `Text` cell.
pub(super) fn loose_json_to_sealable_value(
	cell: &JsonValue,
	storage_ty: &ColumnType,
	nullable: bool,
) -> Result<Value, String> {
	if cell.is_null() || *cell == JsonValue::Null {
		return nullable
			.then(|| Ok(Value::Null))
			.unwrap_or_else(|| Err("null not permitted".into()));
	}
	match storage_ty {
		ColumnType::Text => {
			if let Some(s) = cell.as_str() {
				return Ok(Value::Text(s.to_string()));
			}
			if let Some(b) = cell.as_bool() {
				return Ok(Value::Boolean(b));
			}
			if let Some(n) = cell.as_i64() {
				if let Ok(i) = i32::try_from(n) {
					return Ok(Value::Integer(i));
				}
				return Ok(Value::BigInt(n));
			}
			if let Some(n) = cell.as_u64() {
				return Ok(Value::Timestamp(n));
			}
			Err("expected JSON string, boolean, or integer for text-storage column".into())
		}
		_ => json_cell_to_jazz(cell, storage_ty, nullable),
	}
}

pub(super) fn insert_values(table_schema: &TableSchema, values: JsonRow) -> Result<Vec<Value>, String> {
	let cols = &table_schema.descriptor.columns;
	let mut row = Vec::with_capacity(cols.len());
	for cd in cols {
		let key = cd.name_str();
		let cv = values.get(key);
		let val = match cv {
			None if cd.nullable => Value::Null,
			None => return Err(format!("missing column `{key}`")),
			Some(js) => json_cell_to_jazz(js, &cd.column_type, cd.nullable)?,
		};
		row.push(val);
	}
	Ok(row)
}

fn patch_updates(table_schema: &TableSchema, patch: JsonRow) -> Result<Vec<(String, Value)>, String> {
	let mut ops = Vec::new();
	let desc = &table_schema.descriptor;

	for (k, raw_js) in &patch {
		if k == "id" {
			continue;
		}
		let col = desc.column(k).ok_or_else(|| format!("unknown_column: {k}"))?;
		let v = json_cell_to_jazz(raw_js, &col.column_type, col.nullable)?;
		ops.push((k.clone(), v));
	}
	if ops.is_empty() {
		return Err("empty patch".into());
	}
	Ok(ops)
}

async fn jazz_connect(
	app: &tauri::AppHandle,
	self_state: &SelfState,
) -> Result<JazzClient, String> {
	let root = self_state
		.with_root(|r| Ok(*r))
		.map_err(|_| "locked: unlock AvenOS identity first".to_string())?;

	let schema = crate::schema_manifest::load_jazz_schema_from_manifest()?;
	let pk = ed25519_public(&root)?;
	let deterministic = crate::jazz_auth::client_uuid_from_ed_pubkey(&pk);
	let schema_fp = schema_manifest_fingerprint()?;

	let data_dir = app
		.path()
		.app_data_dir()
		.map_err(|e| e.to_string())?
		.join("jazz");
	reconcile_jazz_identity_cache_dir(&data_dir, deterministic, &schema_fp)?;

	let ctx = AppContext {
		app_id: AppId::from_name("ceo.aven.os"),
		client_id: Some(ClientId(deterministic)),
		schema,
		server_url: String::new(),
		data_dir,
		jwt_token: None,
		backend_secret: None,
		admin_secret: None,
	};

	JazzClient::connect(ctx)
		.await
		.map_err(format_jazz_err)
}

async fn ensure_arc(
	app: &tauri::AppHandle,
	self_state: &SelfState,
	mj: &ManagedJazz,
) -> Result<std::sync::Arc<JazzClient>, String> {
	if !self_state.is_unlocked() {
		mj.reset_connection().await;
		return Err("locked: unlock AvenOS identity first".into());
	}
	let desired = desired_root_client_uuid(self_state)?;

	let existing = mj.client.lock().await.clone();
	let linked = mj.connected_client_uuid.lock().await.clone();

	if let (Some(arc), Some(uuid)) = (&existing, &linked) {
		if *uuid == desired {
			return Ok(std::sync::Arc::clone(arc));
		}
	}

	mj.reset_connection().await;

	let client = jazz_connect(app, self_state).await?;
	let arc = std::sync::Arc::new(client);
	{
		let mut slot = mj.client.lock().await;
		*slot = Some(std::sync::Arc::clone(&arc));
	}
	*mj.connected_client_uuid.lock().await = Some(desired);

	Ok(arc)
}

async fn jazz_shell_ready(
	mj: &ManagedJazz,
	self_state: &SelfState,
	client: &std::sync::Arc<JazzClient>,
) -> Result<std::sync::Arc<jazz_engine::ShellState>, String> {
	let mut slot = mj.shell.lock().await;
	if let Some(s) = slot.as_ref() {
		return Ok(std::sync::Arc::clone(s));
	}
	let root = self_state
		.with_root(|r| Ok(*r))
		.map_err(|_| "locked: unlock AvenOS identity first".to_string())?;
	let hydrated =
		jazz_engine::hydrate_shell(std::sync::Arc::as_ref(client), &root).await?;
	let arc = std::sync::Arc::new(hydrated);
	*slot = Some(std::sync::Arc::clone(&arc));
	Ok(arc)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_status(
	_app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
) -> Result<JazzStatusReply, String> {
	if !self_state.is_unlocked() {
		jazz.reset_connection().await;
		return Ok(JazzStatusReply {
			ready: false,
			tables: vec![],
		});
	}

	let desired = desired_root_client_uuid(&self_state)?;

	let arc_opt = jazz.client.lock().await.clone();
	let linked = jazz.connected_client_uuid.lock().await.clone();

	if linked != Some(desired) {
		if arc_opt.is_some() || linked.is_some() {
			jazz.reset_connection().await;
		}
		return Ok(JazzStatusReply {
			ready: false,
			tables: vec![],
		});
	}

	if let Some(c) = arc_opt {
		let sch = c.schema().await.map_err(format_jazz_err)?;
		let mut names: Vec<String> = sch.keys().map(|k| k.to_string()).collect();
		names.sort();
		return Ok(JazzStatusReply {
			ready: true,
			tables: names,
		});
	}

	Ok(JazzStatusReply {
		ready: false,
		tables: vec![],
	})
}

#[tauri::command(rename_all = "camelCase")]
	pub async fn jazz_bootstrap(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
) -> Result<JazzStatusReply, String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;
	let _ = jazz_shell_ready(&jazz, &self_state, &c).await?;

	let sch = c.schema().await.map_err(format_jazz_err)?;
	let mut tables: Vec<String> = sch.keys().map(|k| k.to_string()).collect();
	tables.sort();
	Ok(JazzStatusReply {
		ready: true,
		tables,
	})
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_session(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
) -> Result<JazzSessionReply, String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;
	let shell = jazz_shell_ready(&jazz, &self_state, &c).await?;
	Ok(JazzSessionReply {
		peer_did: shell.peer_did.clone(),
		peer_did_short: jazz_engine::short_peer_did(&shell.peer_did),
		default_spark_urn: jazz_engine::spark_urn(shell.default_spark),
	})
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_list(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	table: String,
) -> Result<Vec<JsonRow>, String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;
	let shell = jazz_shell_ready(&jazz, &self_state, &c).await?;
	let (rows, _) = jazz_engine::query_table_publish(
		std::sync::Arc::as_ref(&c),
		&shell,
		&table,
		ENCRYPTED_META,
	)
	.await?;
	Ok(rows)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_explorer_list(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	table: String,
) -> Result<JazzExplorerListReply, String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;
	let shell = jazz_shell_ready(&jazz, &self_state, &c).await?;
	let (rows, skipped_unauthorized_rows) = jazz_engine::query_table_publish(
		std::sync::Arc::as_ref(&c),
		&shell,
		&table,
		ENCRYPTED_META,
	)
	.await?;
	Ok(JazzExplorerListReply {
		rows,
		skipped_unauthorized_rows,
	})
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_get(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	table: String,
	id: String,
) -> Result<JsonRow, String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;
	let shell = jazz_shell_ready(&jazz, &self_state, &c).await?;
	let uuid = Uuid::parse_str(&id).map_err(|e| format!("invalid id UUID: {e}"))?;

	let tbl = jazz_engine::resolved_table_schema(std::sync::Arc::as_ref(&c), &table).await?;
	match jazz_engine::find_row_snapshot(std::sync::Arc::as_ref(&c), &table, &tbl, uuid).await? {
		Some((oid, vals)) => {
			let spark_row = jazz_engine::spark_uuid_row(&tbl, &vals).unwrap_or(shell.default_spark);
			jazz_engine::authorize_gate(
				&shell,
				&table,
				crate::spark_acc::AccOp::Read,
				spark_row,
				Some(*oid.uuid()),
			)?;
			jazz_engine::row_to_public_map(
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

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_create(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	table: String,
	mut values: JsonRow,
) -> Result<JsonRow, String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;
	let shell = jazz_shell_ready(&jazz, &self_state, &c).await?;
	let tbl = jazz_engine::resolved_table_schema(std::sync::Arc::as_ref(&c), &table).await?;

	let mut plaintext = std::collections::HashMap::new();

	jazz_engine::inject_default_spark(&mut values, &tbl, shell.default_spark)?;
	let spark_gate = jazz_engine::spark_uuid_from_json_row(&tbl, &values)?;
	jazz_engine::authorize_gate(
		&shell,
		&table,
		crate::spark_acc::AccOp::Write,
		spark_gate,
		None,
	)?;
	jazz_engine::place_secrets_for_insert(
		&tbl,
		&table,
		&mut values,
		&mut plaintext,
		PHASE1_SECRET_PLACEHOLDER,
	)?;

	let vals = insert_values(&tbl, values)?;
	let oid = std::sync::Arc::as_ref(&c)
		.create(&table, vals.clone())
		.await
		.map_err(format_jazz_err)?;

	if !plaintext.is_empty() {
		let spark = jazz_engine::spark_uuid_row(&tbl, &vals)?;
		let mut ph = JsonRow::new();
		for (col, pt) in plaintext {
			let cd = tbl
				.descriptor
				.column(&col)
				.ok_or_else(|| format!("manifest_missing_col:{col}"))?;
			ph.insert(
				col.clone(),
				JsonValue::String(jazz_engine::seal_column_plain(
					&shell,
					&table,
					&col,
					&cd.column_type,
					spark,
					*oid.uuid(),
					&pt,
				)?),
			);
		}
		let ops = patch_updates(&tbl, ph)?;
		std::sync::Arc::as_ref(&c)
			.update(oid, ops)
			.await
			.map_err(format_jazz_err)?;
	}

	let (_, vals_fresh) =
		jazz_engine::find_row_snapshot(std::sync::Arc::as_ref(&c), &table, &tbl, *oid.uuid())
			.await?
			.ok_or_else(|| "create_reread_missing".to_string())?;

	let reply = jazz_engine::row_to_public_map(
		&shell,
		&table,
		&tbl,
		oid,
		&vals_fresh,
		ENCRYPTED_META,
	)?;

	jazz.snapshot_broadcast(std::sync::Arc::as_ref(&c), &shell, &table)
		.await?;

	Ok(reply)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_update(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	table: String,
	id: String,
	patch: JsonRow,
) -> Result<JsonRow, String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;
	let shell = jazz_shell_ready(&jazz, &self_state, &c).await?;
	let tbl =
		jazz_engine::resolved_table_schema(std::sync::Arc::as_ref(&c), &table).await?;
	let uuid =
		uuid::Uuid::parse_str(&id).map_err(|e| format!("invalid id UUID parse: {e}"))?;

	// Important: Use `oid` from Groove queries, not `ObjectId::from_uuid` — interned IDs use pointer hashing.
	let (oid, old_vals) =
		jazz_engine::find_row_snapshot(std::sync::Arc::as_ref(&c), &table, &tbl, uuid)
			.await?
			.ok_or_else(|| format!("row_not_found:{uuid}"))?;
	let spark = jazz_engine::spark_uuid_row(&tbl, &old_vals)?;

	jazz_engine::authorize_gate(
		&shell,
		&table,
		crate::spark_acc::AccOp::Write,
		spark,
		Some(uuid),
	)?;

	let mut sealed_patch = patch;
	if let Some(sec) = jazz_engine::secrets_for_table(&table) {
		for col in sec.iter() {
			if let Some(js) = sealed_patch.get(col.as_str()).cloned() {
				if js.is_null() {
					continue;
				}
				let cd = tbl
					.descriptor
					.column(col)
					.ok_or_else(|| format!("unknown_sensitive_col:{col}"))?;
				let gv = loose_json_to_sealable_value(&js, &cd.column_type, cd.nullable)?;
				let canon = crate::crypto::groove_value_to_canonical_utf8(&gv)?;
				let ct = jazz_engine::seal_column_plain(
					&shell,
					&table,
					col,
					&cd.column_type,
					spark,
					uuid,
					&canon,
				)?;
				sealed_patch.insert(col.clone(), JsonValue::String(ct));
			}
		}
	}

	let ops = patch_updates(&tbl, sealed_patch)?;

	std::sync::Arc::as_ref(&c)
		.update(oid, ops)
		.await
		.map_err(format_jazz_err)?;

	jazz.snapshot_broadcast(std::sync::Arc::as_ref(&c), &shell, &table).await?;

	jazz_get(app.clone(), jazz, self_state, table, id.to_string()).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_delete(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	table: String,
	id: String,
) -> Result<(), String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;
	let shell = jazz_shell_ready(&jazz, &self_state, &c).await?;
	let tbl =
		jazz_engine::resolved_table_schema(std::sync::Arc::as_ref(&c), &table).await?;
	let uuid =
		uuid::Uuid::parse_str(&id).map_err(|e| format!("invalid UUID: {e}"))?;
	// Important: Use `oid` returned by Groove scans, not `ObjectId::from_uuid(id)` —
	// Jazz uses pointer-based hashing for interned IDs; reconstructed ids can miss the map edge.
	let (oid, row_vals) =
		jazz_engine::find_row_snapshot(std::sync::Arc::as_ref(&c), &table, &tbl, uuid)
			.await?
			.ok_or_else(|| format!("row_not_found:{uuid}"))?;
	let spark = jazz_engine::spark_uuid_row(&tbl, &row_vals)?;

	jazz_engine::authorize_gate(
		&shell,
		&table,
		crate::spark_acc::AccOp::Delete,
		spark,
		Some(uuid),
	)?;

	std::sync::Arc::as_ref(&c)
		.delete(oid)
		.await
		.map_err(format_jazz_err)?;
	jazz.snapshot_broadcast(std::sync::Arc::as_ref(&c), &shell, &table).await?;
	Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_subscribe(
	window: tauri::Window,
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	table: String,
) -> Result<(), String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;
	let shell = jazz_shell_ready(&jazz, &self_state, &c).await?;

	let evt = format!("jazz:{}:changed", table);
	let (first, _) = jazz_engine::query_table_publish(
		std::sync::Arc::as_ref(&c),
		&shell,
		&table,
		ENCRYPTED_META,
	)
	.await?;
	window.emit(&evt, first).map_err(|e| e.to_string())?;

	let tx = jazz.broadcaster(&table);
	let mut rx = tx.subscribe();
	let window_emit = window.clone();

	tauri::async_runtime::spawn(async move {
		let evt_owned = evt;
		loop {
			match rx.recv().await {
				Ok(snap) => {
					if window_emit.emit(&evt_owned, snap).is_err() {
						break;
					}
				}
				Err(broadcast::error::RecvError::Closed) => break,
				Err(broadcast::error::RecvError::Lagged(_)) => continue,
			}
		}
	});

	Ok(())
}

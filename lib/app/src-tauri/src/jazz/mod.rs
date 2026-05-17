//! Generic Jazz CRUD over Tauri IPC. Schema mirrors `libs/jazz-schema/schema.manifest.json`.

mod jazz_engine;

use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::RwLock;

use groove::{
	query_manager::types::{ColumnType, ComposedBranchName, SchemaHash, TableSchema},
	AppContext,
	AppId,
	ClientId,
	JazzClient,
	JazzError,
	ObjectId,
	Value,
};
use serde_json::{Map, Value as JsonValue};
use tauri::Emitter;
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
struct JazzConn {
	client: Option<JazzClient>,
	/// Device root → Groove [`ClientId`](groove::ClientId) UUID; `Some` iff `client` is populated.
	linked_identity: Option<Uuid>,
}

impl Default for JazzConn {
	fn default() -> Self {
		Self {
			client: None,
			linked_identity: None,
		}
	}
}

pub struct ManagedJazz {
	conn: Mutex<JazzConn>,
	table_txs: RwLock<HashMap<String, broadcast::Sender<Vec<JsonRow>>>>,
	shell: Mutex<Option<std::sync::Arc<jazz_engine::ShellState>>>,
}

impl Default for ManagedJazz {
	fn default() -> Self {
		Self {
			conn: Mutex::new(JazzConn::default()),
			table_txs: RwLock::new(HashMap::new()),
			shell: Mutex::new(None),
		}
	}
}

async fn shutdown_owned_client(old: Option<JazzClient>) {
	let Some(client) = old else {
		return;
	};
	if let Err(e) = client.shutdown().await {
		log::warn!(target: "avenos::jazz", "JazzClient shutdown failed (flush/sync): {e}");
	}
}

/// Normalize [`JazzError`] for IPC strings and structured logs (avoids `Write error: Write error:` layering).
///
/// jazz-tools' `update_with_session` / `delete_with_session` collapse every
/// failure inside `add_commit` (including `BranchNotFound`, `ParentNotFound`,
/// and `StorageError`) into `QueryError::ObjectNotFound(id)`. The message
/// `ObjectNotFound(...)` therefore tells you very little about the real cause.
/// We surface the raw text unchanged so the caller can wrap it with its own
/// context (`table`, `write_branch`, `runtime_branch`) and so any "fix"
/// suggestion isn't fabricated from a misread of the upstream error code.
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

/// Persisted Groove [`SchemaHash`] as 32-byte SHA digest from `SchemaHash::compute(schema)`.
/// This is the **same value** Groove uses to derive its composed write branch
/// (`ComposedBranchName::new(env, schema_hash, user_branch)`). If on-disk != current,
/// old rows live on a stale branch that `current_branch()` cannot resolve — every
/// `update`/`delete` will return `ObjectNotFound`/`BranchNotFound`. We wipe in that case.
///
/// Replaces the old raw-manifest SHA256 fingerprint: byte-identical manifest JSON
/// can still produce a different `SchemaHash` if jazz-tools' Schema-build
/// changes shape between versions.
const GROOVE_SCHEMA_HASH_FILE: &str = "groove_schema_hash";
/// Legacy manifest-JSON fingerprint file. Kept only so old installs can be migrated/cleaned.
const LEGACY_SCHEMA_FINGERPRINT_FILE: &str = "schema_fingerprint";

const JAZZ_LANE_FILE: &str = "jazz_lane";

/// Must stay aligned with JazzClient `SchemaManager::new(.., env, user_branch)` in jazz-tools (`client.rs`).
pub(super) const GROOVE_CLIENT_ENV: &str = "client";
pub(super) const GROOVE_USER_BRANCH_MAIN: &str = "main";

/// Composed Groove branch string derived from the **raw** manifest JSON (before Jazz normalizes schemas).
/// Prefer `groove_write_branch_from_connected_schema` for list/write queries so branch matches persisted Groove state.
pub(super) fn groove_write_branch_for_manifest_schema() -> Result<String, String> {
	let schema = crate::schema_manifest::load_jazz_schema_from_manifest()?;
	let h = SchemaHash::compute(&schema);
	let bn = ComposedBranchName::new(
		GROOVE_CLIENT_ENV,
		h,
		GROOVE_USER_BRANCH_MAIN,
	)
	.to_branch_name();
	Ok(bn.as_str().to_string())
}

/// Branch string **exactly** as Groove resolves it from the connected client's normalized schema.
/// List/write queries must use this; deriving only from the manifest JSON can drift after Jazz normalizes/persists schemas.
pub(super) async fn groove_write_branch_from_connected_schema(
	client: &JazzClient,
) -> Result<String, String> {
	let sch = client.schema().await.map_err(format_jazz_err)?;
	let bn = ComposedBranchName::from_schema(
		GROOVE_CLIENT_ENV,
		&sch,
		GROOVE_USER_BRANCH_MAIN,
	)
	.to_branch_name();
	Ok(bn.as_str().to_string())
}

/// Groove durable files live here (was `.avenOS/jazz` before AvenOS renamed the folder).
const AVEN_OS_GROOVE_DATA_DIR: &str = "db";
const LEGACY_JAZZ_DATA_DIR: &str = "jazz";

fn migrate_legacy_jazz_dir_to_db(user_root: &Path) -> Result<(), String> {
	let db = user_root.join(AVEN_OS_GROOVE_DATA_DIR);
	if db.exists() {
		return Ok(());
	}
	let legacy = user_root.join(LEGACY_JAZZ_DATA_DIR);
	if legacy.exists() {
		fs::rename(&legacy, &db).map_err(|e| {
			format!(
				"migrate Groove dir {} -> {}: {e}",
				legacy.display(),
				db.display()
			)
		})?;
		log::info!(
			target: "avenos::jazz",
			"Migrated legacy Groove directory {} -> {}",
			legacy.display(),
			db.display()
		);
	}
	Ok(())
}

const CURRENT_JAZZ_LANE: &str = "lane-v1;env=client;user_branch=main";

/// Wipe and re-stamp the Groove data dir when **any** of these disagree with the previous boot:
/// 1. `client_id` — different device identity.
/// 2. Groove `SchemaHash` — different writable branch derivation; existing rows would be
///    unreachable on `current_branch()`, causing `ObjectNotFound` on every update/delete
///    even though scans on multi-branch fallback still see them. See
///    [`current_groove_schema_hash_bytes`] for rationale.
/// 3. Jazz lane stamp — env/user_branch mismatch.
///
/// This is the **once-and-for-all** safeguard against the
/// "old session todos can be read but not edited" failure mode.
fn reconcile_jazz_identity_cache_dir(
	jazz_dir: &Path,
	desired_uuid: Uuid,
	current_groove_hash: &[u8; 32],
) -> Result<(), String> {
	let mut reason: Option<String> = None;

	let client_path = jazz_dir.join("client_id");
	let groove_db_path = jazz_dir.join("groove.surrealkv");
	let has_prior_groove_data =
		client_path.exists() || groove_db_path.exists();
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

	let hash_path = jazz_dir.join(GROOVE_SCHEMA_HASH_FILE);
	if reason.is_none() {
		match fs::read(&hash_path) {
			Ok(bytes) if bytes == current_groove_hash => {}
			Ok(bytes) => {
				reason = Some(format!(
					"groove SchemaHash changed (on-disk={}, current={}); writable branch derivation drifted, old rows would be unreachable on current_branch()",
					hex_short(&bytes),
					hex_short(current_groove_hash)
				));
			}
			Err(e) if e.kind() == ErrorKind::NotFound => {
				if has_prior_groove_data {
					reason = Some(
						"groove SchemaHash file missing while groove data present (older AvenOS install or aborted write); cannot prove writable branch matches on-disk rows".into(),
					);
				}
			}
			Err(e) => return Err(format!("read {}: {e}", hash_path.display())),
		}
	}

	let lane_path = jazz_dir.join(JAZZ_LANE_FILE);
	if reason.is_none() {
		match fs::read_to_string(&lane_path) {
			Ok(stored) => {
				let stored = stored.trim();
				if stored != CURRENT_JAZZ_LANE {
					reason = Some(format!(
						"jazz lane mismatch (on-disk={stored:?}, current={CURRENT_JAZZ_LANE:?})"
					));
				}
			}
			Err(e) if e.kind() == ErrorKind::NotFound => {
				// Older AvenOS: migrate without wiping by writing the canonical lane stamp below.
			}
			Err(e) => return Err(format!("read {}: {e}", lane_path.display())),
		}
	}

	if let Some(why) = reason {
		log::warn!(
			target: "avenos::jazz",
			"Purging {}: {why}",
			jazz_dir.display(),
		);
		if jazz_dir.exists() {
			fs::remove_dir_all(jazz_dir)
				.map_err(|e| format!("remove {}: {e}", jazz_dir.display()))?;
		}
	}

	fs::create_dir_all(jazz_dir).map_err(|e| format!("recreate jazz dir: {e}"))?;
	fs::write(&hash_path, current_groove_hash)
		.map_err(|e| format!("write {}: {e}", hash_path.display()))?;
	fs::write(jazz_dir.join(JAZZ_LANE_FILE), CURRENT_JAZZ_LANE.as_bytes()).map_err(|e| {
		format!(
			"write {}: {e}",
			jazz_dir.join(JAZZ_LANE_FILE).display()
		)
	})?;

	// Best-effort cleanup of the legacy manifest-fingerprint file (kept for diagnostics only).
	let legacy_fp = jazz_dir.join(LEGACY_SCHEMA_FINGERPRINT_FILE);
	if legacy_fp.exists() {
		let _ = fs::remove_file(&legacy_fp);
	}

	let composed = ComposedBranchName::new(
		GROOVE_CLIENT_ENV,
		SchemaHash::from_bytes(*current_groove_hash),
		GROOVE_USER_BRANCH_MAIN,
	)
	.to_branch_name();
	log::info!(
		target: "avenos::jazz",
		"groove cache stamped: dir={} groove_hash={} composed_branch={}",
		jazz_dir.display(),
		hex_short(current_groove_hash),
		composed.as_str()
	);
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
			let mut jc = self.conn.lock().await;
			jc.linked_identity = None;
			self.shell.lock().await.take();
			jc.client.take()
		};
		shutdown_owned_client(old_client).await;
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
	let groove_hash = *SchemaHash::compute(&schema).as_bytes();

	let user_root = tauri_plugin_self::paths::aven_os_user_root(app)?;
	migrate_legacy_jazz_dir_to_db(&user_root)?;
	let data_dir = user_root.join(AVEN_OS_GROOVE_DATA_DIR);
	reconcile_jazz_identity_cache_dir(&data_dir, deterministic, &groove_hash)?;

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

async fn ensure_jazz_connection(
	jc: &mut JazzConn,
	jazz: &ManagedJazz,
	app: &tauri::AppHandle,
	self_state: &SelfState,
) -> Result<(), String> {
	if !self_state.is_unlocked() {
		let old = jc.client.take();
		jc.linked_identity = None;
		jazz.shell.lock().await.take();
		shutdown_owned_client(old).await;
		return Err("locked: unlock AvenOS identity first".into());
	}
	let desired = desired_root_client_uuid(self_state)?;
	if let (Some(_), Some(linked)) = (&jc.client, &jc.linked_identity) {
		if *linked == desired {
			return Ok(());
		}
	}
	let old = jc.client.take();
	jc.linked_identity = None;
	jazz.shell.lock().await.take();
	shutdown_owned_client(old).await;

	let client = jazz_connect(app, self_state).await?;
	jc.client = Some(client);
	jc.linked_identity = Some(desired);
	Ok(())
}

async fn jazz_shell_ready(
	mj: &ManagedJazz,
	self_state: &SelfState,
	client: &JazzClient,
) -> Result<std::sync::Arc<jazz_engine::ShellState>, String> {
	let mut slot = mj.shell.lock().await;
	if let Some(s) = slot.as_ref() {
		return Ok(std::sync::Arc::clone(s));
	}
	let root = self_state
		.with_root(|r| Ok(*r))
		.map_err(|_| "locked: unlock AvenOS identity first".to_string())?;
	let hydrated = jazz_engine::hydrate_shell(client, &root).await?;
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

	let jc = jazz.conn.lock().await;
	if jc.linked_identity != Some(desired) {
		let stale = jc.client.is_some() || jc.linked_identity.is_some();
		drop(jc);
		if stale {
			jazz.reset_connection().await;
		}
		return Ok(JazzStatusReply {
			ready: false,
			tables: vec![],
		});
	}

	if let Some(ref c) = jc.client {
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
	let mut jc = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc, &jazz, &app, &self_state).await?;
	let client = jc.client.as_ref().expect("jazz connected");
	let _ = jazz_shell_ready(&jazz, &self_state, client).await?;

	let sch = client.schema().await.map_err(format_jazz_err)?;
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
	let mut jc = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc, &jazz, &app, &self_state).await?;
	let client = jc.client.as_ref().expect("jazz connected");
	let shell = jazz_shell_ready(&jazz, &self_state, client).await?;
	drop(jc);
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
	let mut jc = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc, &jazz, &app, &self_state).await?;
	let client = jc.client.as_ref().expect("jazz connected");
	let shell = jazz_shell_ready(&jazz, &self_state, client).await?;
	let (rows, _) =
		jazz_engine::query_table_publish(client, &shell, &table, ENCRYPTED_META).await?;
	Ok(rows)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_explorer_list(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	table: String,
) -> Result<JazzExplorerListReply, String> {
	let mut jc = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc, &jazz, &app, &self_state).await?;
	let client = jc.client.as_ref().expect("jazz connected");
	let shell = jazz_shell_ready(&jazz, &self_state, client).await?;
	let (rows, skipped_unauthorized_rows) =
		jazz_engine::query_table_publish(client, &shell, &table, ENCRYPTED_META).await?;
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
	let mut jc = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc, &jazz, &app, &self_state).await?;
	let client = jc.client.as_ref().expect("jazz connected");
	let shell = jazz_shell_ready(&jazz, &self_state, client).await?;
	let uuid = Uuid::parse_str(&id).map_err(|e| format!("invalid id UUID: {e}"))?;

	let tbl = jazz_engine::resolved_table_schema(client, &table).await?;
	match jazz_engine::find_row_snapshot(client, &table, &tbl, uuid).await? {
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
	let mut jc = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc, &jazz, &app, &self_state).await?;
	let client = jc.client.as_ref().expect("jazz connected");
	let shell = jazz_shell_ready(&jazz, &self_state, client).await?;
	let tbl = jazz_engine::resolved_table_schema(client, &table).await?;

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
	let oid = client
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
		client
			.update(oid, ops)
			.await
			.map_err(format_jazz_err)?;
	}

	let (_, vals_fresh) =
		jazz_engine::find_row_snapshot(client, &table, &tbl, *oid.uuid())
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

	jazz.snapshot_broadcast(client, &shell, &table).await?;

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
	let mut jc = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc, &jazz, &app, &self_state).await?;
	let client = jc.client.as_ref().expect("jazz connected");
	let shell = jazz_shell_ready(&jazz, &self_state, client).await?;
	let tbl = jazz_engine::resolved_table_schema(client, &table).await?;
	let uuid =
		uuid::Uuid::parse_str(&id).map_err(|e| format!("invalid id UUID parse: {e}"))?;

	// `find_row_snapshot` reads without `.branch()` so jazz-tools auto-loads the
	// row's `Object` on **every** known schema-version branch into ObjectManager.
	// Important: keep using `oid` from the query result — `ObjectId::from_uuid`
	// produces a non-interned id that misses the pointer-keyed in-memory map.
	let (oid, old_vals) = jazz_engine::find_row_snapshot(client, &table, &tbl, uuid)
		.await?
		.ok_or_else(|| {
			log::warn!(
				target: "avenos::jazz",
				"jazz_update row missing in any known schema branch table={table} uuid={uuid} groove_branch={}",
				shell.groove_write_branch
			);
			format!(
				"row_not_found:{uuid} (table={table}). Row is not visible on any known schema-version branch \
				— it may have been hard-deleted, or this client has no lens path to its schema yet."
			)
		})?;
	let runtime_branch = jazz_engine::groove_write_branch_from_connected_schema_or_log(client).await;
	log::debug!(
		target: "avenos::jazz",
		"jazz_update resolved row table={table} uuid={uuid} cached_branch={} runtime_branch={runtime_branch} oid_uuid={}",
		shell.groove_write_branch,
		oid.uuid()
	);
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

	client
		.update(oid, ops)
		.await
		.map_err(|e| {
			let msg = format_jazz_err(e);
			log::warn!(
				target: "avenos::jazz",
				"jazz_update Groove write failed table={table} uuid={uuid} write_branch={} runtime_branch={runtime_branch} oid_uuid={} err={}",
				shell.groove_write_branch,
				oid.uuid(),
				msg
			);
			format!(
				"{msg} (table={table} id={uuid} write_branch={} runtime_branch={runtime_branch})",
				shell.groove_write_branch
			)
		})?;

	jazz.snapshot_broadcast(client, &shell, &table).await?;

	drop(jc);
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
	let mut jc = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc, &jazz, &app, &self_state).await?;
	let client = jc.client.as_ref().expect("jazz connected");
	let shell = jazz_shell_ready(&jazz, &self_state, client).await?;
	let tbl = jazz_engine::resolved_table_schema(client, &table).await?;
	let uuid =
		uuid::Uuid::parse_str(&id).map_err(|e| format!("invalid UUID: {e}"))?;
	// See jazz_update: read across all known schema branches so the row's
	// `Object` is loaded into ObjectManager on every branch it lives on. Use
	// the interned `oid` from the query (never `ObjectId::from_uuid`).
	let (oid, row_vals) = jazz_engine::find_row_snapshot(client, &table, &tbl, uuid)
		.await?
		.ok_or_else(|| {
			log::warn!(
				target: "avenos::jazz",
				"jazz_delete row missing in any known schema branch table={table} uuid={uuid} groove_branch={}",
				shell.groove_write_branch
			);
			format!(
				"row_not_found:{uuid} (table={table}). Row is not visible on any known schema-version branch."
			)
		})?;
	let runtime_branch = jazz_engine::groove_write_branch_from_connected_schema_or_log(client).await;
	log::debug!(
		target: "avenos::jazz",
		"jazz_delete resolved row table={table} uuid={uuid} cached_branch={} runtime_branch={runtime_branch} oid_uuid={}",
		shell.groove_write_branch,
		oid.uuid()
	);
	let spark = jazz_engine::spark_uuid_row(&tbl, &row_vals)?;

	jazz_engine::authorize_gate(
		&shell,
		&table,
		crate::spark_acc::AccOp::Delete,
		spark,
		Some(uuid),
	)?;

	client
		.delete(oid)
		.await
		.map_err(|e| {
			let msg = format_jazz_err(e);
			log::warn!(
				target: "avenos::jazz",
				"jazz_delete Groove write failed table={table} uuid={uuid} write_branch={} runtime_branch={runtime_branch} oid_uuid={} err={}",
				shell.groove_write_branch,
				oid.uuid(),
				msg
			);
			format!(
				"{msg} (table={table} id={uuid} write_branch={} runtime_branch={runtime_branch})",
				shell.groove_write_branch
			)
		})?;
	jazz.snapshot_broadcast(client, &shell, &table).await?;
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
	let mut jc = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc, &jazz, &app, &self_state).await?;
	let client = jc.client.as_ref().expect("jazz connected");
	let shell = jazz_shell_ready(&jazz, &self_state, client).await?;

	let evt = format!("jazz:{}:changed", table);
	let (first, _) =
		jazz_engine::query_table_publish(client, &shell, &table, ENCRYPTED_META).await?;
	drop(jc);
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

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfStoragePathsReply {
	pub root: String,
	pub db_dir: String,
	pub self_identity_dir: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn self_storage_paths(app: tauri::AppHandle) -> Result<SelfStoragePathsReply, String> {
	let root = tauri_plugin_self::paths::aven_os_user_root(&app)?;
	let db_dir = root.join(AVEN_OS_GROOVE_DATA_DIR);
	let self_identity_dir = root.join("self");
	Ok(SelfStoragePathsReply {
		root: root.to_string_lossy().into_owned(),
		db_dir: db_dir.to_string_lossy().into_owned(),
		self_identity_dir: self_identity_dir.to_string_lossy().into_owned(),
	})
}

/// Deletes the local Groove store (`db/` under AvenOS user root, plus legacy `jazz/` if present).
#[tauri::command(rename_all = "camelCase")]
pub async fn self_clear_jazz_database(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
) -> Result<(), String> {
	jazz.reset_connection().await;
	let root = tauri_plugin_self::paths::aven_os_user_root(&app)?;
	for rel in [AVEN_OS_GROOVE_DATA_DIR, LEGACY_JAZZ_DATA_DIR] {
		let p = root.join(rel);
		if p.exists() {
			fs::remove_dir_all(&p).map_err(|e| format!("remove {}: {e}", p.display()))?;
		}
	}
	Ok(())
}

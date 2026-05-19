//! Generic Jazz CRUD over Tauri IPC. Schema mirrors `libs/jazz-schema/schema.manifest.json`.

pub(crate) mod jazz_engine;

use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

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
use crate::peer_sync_gate::{self, BiscuitGatedPeerTransport, PeerClientIdMap, SyncAclSnapshot};
use serde_json::{Map, Value as JsonValue};
use tauri::{Emitter, Manager};
use tauri_plugin_self::derive::ed25519_public;
use tauri_plugin_self::state::SelfState;
use tauri_plugin_self::vault::ActiveVault;
use tokio::sync::{broadcast, Mutex};
use uuid::Uuid;

fn vault_user_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
	let v = app.state::<ActiveVault>();
	tauri_plugin_self::paths::aven_os_user_root(app, &*v)
}

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
pub struct JazzPeerMeshRefreshReply {
	pub registered_count: u32,
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
	/// Shared with [`BiscuitGatedPeerTransport`] — spark biscuit snapshot for outbound sync policy.
	pub(crate) sync_acl: Arc<RwLock<Option<SyncAclSnapshot>>>,
	/// MPSC sender for **all** UI-facing table deltas: paired peer inbound sync and local
	/// IPC writes both post `(table)` here. The drain task [`run_table_change_drain`] is
	/// the sole caller of [`ManagedJazz::snapshot_broadcast`], keeping one code path from
	/// "row changed somewhere" → `jazz:<table>:changed` for the webview.
	pub(crate) change_tx: tokio::sync::mpsc::UnboundedSender<String>,
	/// Receiver moved out of here by [`take_change_rx`] once at startup; afterwards this
	/// stays `None`. Kept inside `std::sync::Mutex` so we can extract it from
	/// `tauri::setup` without an async runtime.
	change_rx: std::sync::Mutex<Option<tokio::sync::mpsc::UnboundedReceiver<String>>>,
}

impl Default for ManagedJazz {
	fn default() -> Self {
		let (change_tx, change_rx) = tokio::sync::mpsc::unbounded_channel();
		Self {
			conn: Mutex::new(JazzConn::default()),
			table_txs: RwLock::new(HashMap::new()),
			shell: Mutex::new(None),
			sync_acl: Arc::new(RwLock::new(None)),
			change_tx,
			change_rx: std::sync::Mutex::new(Some(change_rx)),
		}
	}
}

impl ManagedJazz {
	/// Consumes the receiver once. Subsequent calls return `None`. Called from
	/// `tauri::Builder::setup` so the drain task can own the receiver for the
	/// lifetime of the process.
	pub fn take_change_rx(&self) -> Option<tokio::sync::mpsc::UnboundedReceiver<String>> {
		self.change_rx
			.lock()
			.expect("change_rx poisoned")
			.take()
	}
}

/// Background loop that coalesces table-change notifications into one `snapshot_broadcast`
/// per table per ~25ms window. Spawned once from `tauri::Builder::setup`.
///
/// Why coalesce: a single inbound sync delta from a peer can fire many `ObjectUpdated`
/// commits in quick succession for the same table; without coalescing we'd re-query the
/// store and serialize the snapshot once per commit, which is wasted work and noisy on
/// the event channel.
///
/// Why on a separate task: peer-sync's `recv_inbound` is called from inside the Groove
/// sync loop, which holds its own locks. Doing the snapshot query inline would risk
/// re-entering the `JazzConn` mutex and stalling Groove. Posting to an unbounded MPSC
/// keeps `recv_inbound` non-blocking; the drain task takes the locks at its own pace.
pub async fn run_table_change_drain(
	app: tauri::AppHandle,
	mut rx: tokio::sync::mpsc::UnboundedReceiver<String>,
) {
	use std::collections::HashSet;
	use std::time::Duration;

	const COALESCE_WINDOW: Duration = Duration::from_millis(25);

	loop {
		let Some(first) = rx.recv().await else {
			log::debug!(
				target: "avenos::jazz",
				"table-change drain: channel closed, exiting",
			);
			return;
		};
		let mut pending: HashSet<String> = HashSet::new();
		pending.insert(first);

		let sleep = tokio::time::sleep(COALESCE_WINDOW);
		tokio::pin!(sleep);
		loop {
			tokio::select! {
				_ = &mut sleep => break,
				next = rx.recv() => match next {
					Some(t) => { pending.insert(t); }
					None => return,
				}
			}
		}

		let jazz = app.state::<ManagedJazz>();
		let self_state = app.state::<SelfState>();

		// Snapshot needs `&JazzClient + &ShellState`. Acquire the jazz conn lock once
		// for the whole batch — held briefly because `query_table_publish` only reads.
		let mut jc = jazz.conn.lock().await;
		if ensure_jazz_connection(&mut jc, &jazz, &app, &self_state)
			.await
			.is_err()
		{
			// Locked or no identity: nothing to publish; drop the batch.
			continue;
		}
		let Some(ref client) = jc.client else { continue };
		let shell = match jazz_shell_ready(&app, &jazz, &self_state, client).await {
			Ok(s) => s,
			Err(e) => {
				log::debug!(
					target: "avenos::jazz",
					"table-change drain: shell not ready ({e}); skip batch ({} table(s))",
					pending.len(),
				);
				continue;
			}
		};

		for table in pending {
			match jazz
				.snapshot_broadcast(client, shell.as_ref(), &table)
				.await
			{
				Ok(()) => log::debug!(
					target: "avenos::jazz",
					"table-change drain: republished {table}",
				),
				Err(e) => log::warn!(
					target: "avenos::jazz",
					"table-change drain: snapshot_broadcast({table}) failed: {e}",
				),
			}
		}
		drop(jc);
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
			*self.sync_acl.write().expect("sync_acl poisoned") = None;
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

	/// Re-query `table` through the shell and push the JSON snapshot to every
	/// `jazz:<table>:changed` subscriber via the in-process broadcast channel.
	///
	/// **Sole production caller:** [`run_table_change_drain`]. Local IPC and
	/// peer-sync both notify through [`ManagedJazz::change_tx`] so the webview
	/// has one code path from "row changed somewhere" to Tauri emit.
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
		ColumnType::Array(inner) => {
			let arr = cell
				.as_array()
				.ok_or_else(|| format!("expected JSON array column (inner={inner:?})"))?;
			let mut elems = Vec::with_capacity(arr.len());
			for item in arr {
				elems.push(json_cell_to_jazz(item, inner.as_ref(), false)?);
			}
			Ok(Value::Array(elems))
		}
		ColumnType::Row(_) => Err(format!(
			"row {:?} unsupported through JSON IPC for now",
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

pub(crate) fn patch_updates(table_schema: &TableSchema, patch: JsonRow) -> Result<Vec<(String, Value)>, String> {
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
	mj: &ManagedJazz,
) -> Result<JazzClient, String> {
	let root = self_state
		.with_root(|r| Ok(*r))
		.map_err(|_| "locked: unlock AvenOS identity first".to_string())?;

	let schema = crate::schema_manifest::load_jazz_schema_from_manifest()?;
	let pk = ed25519_public(&root)?;
	let deterministic = crate::jazz_auth::client_uuid_from_ed_pubkey(&pk);
	let groove_hash = *SchemaHash::compute(&schema).as_bytes();

	let user_root = vault_user_root(app)?;
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

	#[cfg(target_os = "macos")]
	{
		use std::sync::Arc;

		let bridge = app.state::<tauri_plugin_peer::HyperswarmGrooveBridge>();
		let peer_ctl = app.state::<Arc<tauri_plugin_peer::PeerCtl>>();
		let local_cid = ClientId(deterministic);
		bridge.configure_local_party(local_cid).await;

		let cid_map = PeerClientIdMap::from_shared(bridge.shared_client_id_to_did());
		let inner_transport = bridge.arc_transport_dyn();
		let gated = Arc::new(BiscuitGatedPeerTransport::new(
			inner_transport,
			cid_map,
			Arc::clone(&mj.sync_acl),
			Some(mj.change_tx.clone()),
		));

		let client = JazzClient::connect_with_peer_transport(ctx, gated)
			.await
			.map_err(format_jazz_err)?;

		let root2 = self_state
			.with_root(|r| Ok(*r))
			.map_err(|_| "locked: unlock AvenOS identity first".to_string())?;
		let pk = ed25519_public(&root2)?;
		let local_did = crate::jazz_auth::peer_did_from_ed25519(&pk)?;

		let allow = crate::peers::list_active_peer_dids(&client).await?;
		peer_ctl
			.set_allowlist_and_join_pair_topics(&local_did, &allow)
			.await?;

		let bridge_cids = bridge.snapshot_remote_clients().await;
		let m = bridge.shared_client_id_to_did();
		for p in bridge_cids {
			let did_opt = m.read().expect("cid map poisoned").get(&p).cloned();
			if let Some(did) = did_opt {
				if allow.iter().any(|a| a == &did) {
					let _ = client.register_peer_sync_client(p).map_err(format_jazz_err)?;
				}
			}
		}
		return Ok(client);
	}

	#[cfg(not(target_os = "macos"))]
	{
		JazzClient::connect(ctx).await.map_err(format_jazz_err)
	}
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

	let client = jazz_connect(app, self_state, jazz).await?;
	jc.client = Some(client);
	jc.linked_identity = Some(desired);
	Ok(())
}

async fn jazz_shell_ready(
	app: &tauri::AppHandle,
	mj: &ManagedJazz,
	self_state: &SelfState,
	client: &JazzClient,
) -> Result<std::sync::Arc<jazz_engine::ShellState>, String> {
	let root = self_state
		.with_root(|r| Ok(*r))
		.map_err(|_| "locked: unlock AvenOS identity first".to_string())?;
	let vault_files = vault_user_root(app)?;
	// Always rehydrate from live Groove. P2P sync can merge new `sparks` / `keyshares` rows without
	// restarting the Jazz client; an earlier implementation cached ShellState permanently, so
	// `authorize_gate` still used a vault snapshot from before replication and hid remote sparks.
	// Performance note: many IPC handlers call here; costly `hydrate_shell` work amplifies navigation
	// churn. Prefer a cached shell keyed by replicated epoch / table versions when correctness allows.
	let hydrated = jazz_engine::hydrate_shell(client, &root, &vault_files).await?;
	let arc = std::sync::Arc::new(hydrated);
	let mut slot = mj.shell.lock().await;
	*slot = Some(std::sync::Arc::clone(&arc));
	let snap = peer_sync_gate::load_acl_snapshot(&arc.vault)?;
	*mj.sync_acl.write().expect("sync_acl poisoned") = Some(snap);
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
	let _ = jazz_shell_ready(&app, &jazz, &self_state, client).await?;

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
	let shell = jazz_shell_ready(&app, &jazz, &self_state, client).await?;
	drop(jc);
	Ok(JazzSessionReply {
		peer_did: shell.peer_did.clone(),
		peer_did_short: jazz_engine::short_peer_did(&shell.peer_did),
		default_spark_urn: jazz_engine::spark_urn(shell.default_spark),
	})
}

/// Re-register Groove P2P sync clients + Hyperswarm allowlist + per-pair topics after the peer table changes.
#[cfg(target_os = "macos")]
#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_peer_mesh_refresh(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
) -> Result<JazzPeerMeshRefreshReply, String> {
	if !self_state.is_unlocked() {
		return Ok(JazzPeerMeshRefreshReply { registered_count: 0 });
	}
	let mut jc = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc, &jazz, &app, &self_state).await?;
	drop(jc);
	let n = refresh_peer_mesh_primitives(&app, &jazz).await?;
	Ok(JazzPeerMeshRefreshReply {
		registered_count: n,
	})
}

#[cfg(not(target_os = "macos"))]
#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_peer_mesh_refresh() -> Result<JazzPeerMeshRefreshReply, String> {
	Ok(JazzPeerMeshRefreshReply { registered_count: 0 })
}

/// Append biscuit third-party `owns` for `peerDid`, persist updated `genesis_b64`, and add a DEK keyshare row so the peer can decrypt ciphertext for this spark after sync.
#[tauri::command(rename_all = "camelCase")]
pub async fn spark_admin_add(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	spark_id: String,
	peer_did: String,
) -> Result<(), String> {
	use base64::engine::general_purpose::URL_SAFE_NO_PAD;
	use base64::Engine;

	let spark_uuid =
		Uuid::parse_str(spark_id.trim()).map_err(|e| format!("invalid spark_id UUID: {e}"))?;
	let peer_did = peer_did.trim().to_string();
	if peer_did.is_empty() {
		return Err("peer_did is empty".into());
	}

	let mut jc = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc, &jazz, &app, &self_state).await?;
	let client = jc.client.as_ref().expect("jazz connected");

	let shell_arc = jazz_shell_ready(&app, &jazz, &self_state, client).await?;
	let shell = shell_arc.as_ref();

	if peer_did == shell.peer_did {
		return Err("cannot grant a spark to your own DID".into());
	}

	crate::jazz_auth::ed25519_public_from_peer_did(&peer_did)?;

	if !crate::peers::is_allowlisted(client, &peer_did).await? {
		return Err(
			"This DID is not in My Network — connect the peer first (invite flow).".into(),
		);
	}

	jazz_engine::authorize_gate(
		shell,
		"sparks",
		crate::spark_acc::AccOp::Write,
		spark_uuid,
		None,
	)?;

	let dek_ver = shell
		.spark_versions
		.get(&spark_uuid)
		.copied()
		.ok_or_else(|| format!("missing dek version for spark {spark_uuid}"))?;
	let dek = shell
		.deks
		.get(&(spark_uuid, dek_ver))
		.ok_or_else(|| format!("missing DEK for spark {spark_uuid} v{dek_ver}"))?;

	let ks_schema_pre = jazz_engine::resolved_table_schema(client, "keyshares").await?;
	let ks_spark_ix_pre = jazz_engine::col_ix(&ks_schema_pre, "spark_id")?;
	let ks_ver_ix_pre = jazz_engine::col_ix(&ks_schema_pre, "dek_version")?;
	let ks_recip_ix_pre = jazz_engine::col_ix(&ks_schema_pre, "recipient_did")?;

	let ks_rows_pre = jazz_engine::exec_list_rows(client, "keyshares").await?;
	let mut ks_exists = false;
	for (_oid, vals) in ks_rows_pre {
		let sid = jazz_engine::uuid_cell_at(vals.as_slice(), ks_spark_ix_pre)?;
		let dv = jazz_engine::bigint_i64(vals.get(ks_ver_ix_pre).ok_or("ks_ver_missing")?)?;
		let recip = match vals.get(ks_recip_ix_pre).ok_or("ks_recip_missing")? {
			Value::Text(s) => s.as_str(),
			_ => continue,
		};
		if sid == spark_uuid && dv == dek_ver && recip == peer_did.as_str() {
			ks_exists = true;
			break;
		}
	}

	let bisc_spark = shell
		.vault
		.sparks
		.get(&spark_uuid)
		.ok_or_else(|| format!("spark {spark_uuid} not loaded in vault"))?;

	let already_owner =
		crate::spark_acc::spark_peer_is_owner(&bisc_spark.biscuit, spark_uuid, &peer_did)?;

	if already_owner && ks_exists {
		return Ok(());
	}

	if !already_owner {
		let new_biscuit = crate::spark_acc::attenuate_add_owner_third_party(
			&shell.vault.biscuit_kp,
			&bisc_spark.biscuit,
			spark_uuid,
			&peer_did,
		)?;

		let genesis_vec = new_biscuit
			.to_vec()
			.map_err(|e| format!("biscuit_encode:{e:?}"))?;
		let genesis_b64 = URL_SAFE_NO_PAD.encode(genesis_vec);

		let sparks_schema = jazz_engine::resolved_table_schema(client, "sparks").await?;
		let spark_id_ix = jazz_engine::col_ix(&sparks_schema, "spark_id")?;

		let sparks_rows = jazz_engine::exec_list_rows(client, "sparks").await?;
		let mut sparks_oid: Option<ObjectId> = None;
		for (oid, vals) in sparks_rows {
			let sid = jazz_engine::uuid_cell_at(vals.as_slice(), spark_id_ix)?;
			if sid == spark_uuid {
				sparks_oid = Some(oid);
				break;
			}
		}
		let sparks_oid =
			sparks_oid.ok_or_else(|| format!("no sparks row for spark_id={spark_uuid}"))?;

		let mut patch_sparks = Map::new();
		patch_sparks.insert(
			"genesis_b64".into(),
			JsonValue::String(genesis_b64),
		);
		let sparks_ops = patch_updates(&sparks_schema, patch_sparks)?;
		client
			.update(sparks_oid, sparks_ops)
			.await
			.map_err(format_jazz_err)?;
	}

	if !ks_exists {
		let recipient_pk = crate::jazz_auth::ed25519_public_from_peer_did(&peer_did)?;
		let kek = crate::crypto::derive_kek_x25519(&shell.signing_key, &recipient_pk)?;
		let urn = jazz_engine::spark_urn(spark_uuid);
		let aad = crate::crypto::keyshare_wrap_aad(&urn, &peer_did, dek_ver);
		let wrapped = crate::crypto::encrypt_keyshare_payload(&kek, dek.expose(), &aad)?;

		let ks_schema = jazz_engine::resolved_table_schema(client, "keyshares").await?;
		let mut ks = Map::new();
		ks.insert(
			"spark_id".into(),
			JsonValue::String(spark_uuid.to_string()),
		);
		ks.insert("dek_version".into(), JsonValue::Number(dek_ver.into()));
		ks.insert(
			"recipient_did".into(),
			JsonValue::String(peer_did.clone()),
		);
		ks.insert(
			"wrapped_dek".into(),
			JsonValue::String(wrapped),
		);
		let ks_vals = insert_values(&ks_schema, ks)?;
		client
			.create("keyshares", ks_vals)
			.await
			.map_err(format_jazz_err)?;
	}

	drop(jc);
	jazz.shell.lock().await.take();
	let mut jc2 = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc2, &jazz, &app, &self_state).await?;
	let client2 = jc2.client.as_ref().expect("jazz connected");
	let _shell_new = jazz_shell_ready(&app, &jazz, &self_state, client2).await?;
	drop(jc2);
	let _ = jazz.change_tx.send("sparks".to_string());
	let _ = jazz.change_tx.send("keyshares".to_string());

	Ok(())
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SparkAdminListReply {
	pub admin_dids: Vec<String>,
}

/// Who can administer this spark (from biscuit `owns` facts).
#[tauri::command(rename_all = "camelCase")]
pub async fn spark_admin_list(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	spark_id: String,
) -> Result<SparkAdminListReply, String> {
	let spark_uuid =
		Uuid::parse_str(spark_id.trim()).map_err(|e| format!("invalid spark_id UUID: {e}"))?;

	let mut jc = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc, &jazz, &app, &self_state).await?;
	let client = jc.client.as_ref().expect("jazz connected");
	let shell = jazz_shell_ready(&app, &jazz, &self_state, client).await?;
	let bs = shell
		.vault
		.sparks
		.get(&spark_uuid)
		.ok_or_else(|| format!("spark {spark_uuid} not in vault"))?;
	let mut admin_dids: Vec<String> = crate::spark_acc::spark_admins(&bs.biscuit, spark_uuid)?
		.into_iter()
		.collect();
	admin_dids.sort();
	Ok(SparkAdminListReply { admin_dids })
}

/// Placeholder for v2 admin removal (requires key rotation).
#[tauri::command(rename_all = "camelCase")]
pub async fn spark_admin_revoke(
	_spark_id: String,
	_peer_did: String,
) -> Result<(), String> {
	Err("spark_admin_revoke is not implemented yet (planned: v2 key rotation).".into())
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
	let shell = jazz_shell_ready(&app, &jazz, &self_state, client).await?;
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
	let shell = jazz_shell_ready(&app, &jazz, &self_state, client).await?;
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
	let shell = jazz_shell_ready(&app, &jazz, &self_state, client).await?;
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
	let shell = jazz_shell_ready(&app, &jazz, &self_state, client).await?;
	let tbl = jazz_engine::resolved_table_schema(client, &table).await?;

	if table == "peers" {
		let vals = insert_values(&tbl, values)?;
		let oid = client
			.create(&table, vals.clone())
			.await
			.map_err(format_jazz_err)?;

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

		let _ = jazz.change_tx.send(table.clone());

		#[cfg(target_os = "macos")]
		{
			let _ = refresh_peer_mesh_primitives(&app, &jazz).await?;
		}

		return Ok(reply);
	}

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

	let _ = jazz.change_tx.send(table.clone());

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
	let shell = jazz_shell_ready(&app, &jazz, &self_state, client).await?;
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

	let _ = jazz.change_tx.send(table.clone());

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
	let shell = jazz_shell_ready(&app, &jazz, &self_state, client).await?;
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
	let _ = jazz.change_tx.send(table.clone());
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
	let shell = jazz_shell_ready(&app, &jazz, &self_state, client).await?;

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

/// Reconcile allowlisted DIDs, Hyperswarm topics, and Groove `register_peer_sync_client` (macOS).
#[cfg(target_os = "macos")]
pub(crate) async fn refresh_peer_mesh_primitives(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
) -> Result<u32, String> {
	use std::sync::Arc;

	let self_state: tauri::State<'_, SelfState> = app.state();
	let jc = jazz.conn.lock().await;
	let Some(ref client) = jc.client else {
		return Ok(0);
	};
	let bridge = app.state::<tauri_plugin_peer::HyperswarmGrooveBridge>();
	let peer_ctl = app.state::<Arc<tauri_plugin_peer::PeerCtl>>();
	let root = self_state
		.with_root(|r| Ok(*r))
		.map_err(|_| "locked: unlock identity first".to_string())?;
	let pk = ed25519_public(&root)?;
	let local_did = crate::jazz_auth::peer_did_from_ed25519(&pk)?;
	let allow = crate::peers::list_active_peer_dids(client).await?;
	drop(jc);

	peer_ctl
		.set_allowlist_and_join_pair_topics(&local_did, &allow)
		.await?;

	let jc = jazz.conn.lock().await;
	let Some(ref client) = jc.client else {
		return Ok(0);
	};

	let mut n = 0u32;
	for p in bridge.snapshot_remote_clients().await {
		let m = bridge.shared_client_id_to_did();
		let did_opt = m.read().expect("cid map").get(&p).cloned();
		if let Some(did) = did_opt {
			if allow.iter().any(|a| a == &did) {
				match client.register_peer_sync_client(p) {
					Ok(()) => {
						n += 1;
						log::info!(
							target: "avenos::jazz",
							"register_peer_sync_client ok peer={p:?} did={did}",
						);
					}
					Err(e) => {
						log::warn!(
							target: "avenos::jazz",
							"register_peer_sync_client failed peer={p:?} did={did} err={e}",
						);
					}
				}
			}
		}
	}
	if n > 0 {
		log::info!(target: "avenos::jazz", "peer-mesh reconcile: {n} peer client(s) registered");
	}
	Ok(n)
}

#[cfg(not(target_os = "macos"))]
pub(crate) async fn refresh_peer_mesh_primitives(
	_app: &tauri::AppHandle,
	_jazz: &ManagedJazz,
) -> Result<u32, String> {
	Ok(0)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeerInvitePairedPayload {
	remote_did: String,
	#[serde(default)]
	label: Option<String>,
	#[serde(default)]
	remote_display_label: Option<String>,
}

fn peer_invite_device_label(p: &PeerInvitePairedPayload, remote_did: &str) -> String {
	p.remote_display_label
		.as_deref()
		.or(p.label.as_deref())
		.map(str::trim)
		.filter(|s| !s.is_empty())
		.map(|s| s.to_string())
		.unwrap_or_else(|| jazz_engine::short_peer_did(remote_did))
}

pub(crate) async fn apply_peer_invite_paired(
	app: &tauri::AppHandle,
	payload: &str,
) -> Result<(), String> {
	let p: PeerInvitePairedPayload =
		serde_json::from_str(payload).map_err(|e| format!("peer:invite-paired json: {e}"))?;
	let jazz = app.state::<ManagedJazz>();
	let self_state = app.state::<SelfState>();
	let mut jc = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc, &jazz, app, &self_state).await?;
	let client = jc.client.as_ref().expect("jazz connected");
	let device_label = peer_invite_device_label(&p, &p.remote_did);
	crate::peers::upsert_remote_peer_row(client, &p.remote_did, &device_label, "active")
		.await?;
	drop(jc);

	#[cfg(target_os = "macos")]
	{
		use std::sync::Arc;
		let ctl = app.state::<Arc<tauri_plugin_peer::PeerCtl>>();
		let _ = ctl.peer_invite_cancel().await;
	}

	let _ = refresh_peer_mesh_primitives(app, &jazz).await?;
	Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn peer_list(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
) -> Result<Vec<crate::peers::PeerRowReply>, String> {
	let mut jc = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc, &jazz, &app, &self_state).await?;
	let client = jc.client.as_ref().expect("jazz connected");
	crate::peers::list_peer_rows(client).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn peer_revoke(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	peer_did: String,
) -> Result<(), String> {
	let mut jc = jazz.conn.lock().await;
	ensure_jazz_connection(&mut jc, &jazz, &app, &self_state).await?;
	let client = jc.client.as_ref().expect("jazz connected");
	crate::peers::set_peer_status(client, &peer_did, "revoked").await?;
	drop(jc);
	let _ = refresh_peer_mesh_primitives(&app, &jazz).await?;
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
	let root = vault_user_root(&app)?;
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
	let root = vault_user_root(&app)?;
	for rel in [AVEN_OS_GROOVE_DATA_DIR, LEGACY_JAZZ_DATA_DIR] {
		let p = root.join(rel);
		if p.exists() {
			fs::remove_dir_all(&p).map_err(|e| format!("remove {}: {e}", p.display()))?;
		}
	}
	Ok(())
}

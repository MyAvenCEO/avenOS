//! Generic Jazz CRUD over Tauri IPC. Schema mirrors `libs/aven-schema/schema.manifest.json`.

pub(crate) mod jazz_engine;
pub mod runtime;
pub mod ui_drain;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use groove::{
	query_manager::types::{ColumnType, ComposedBranchName, SchemaHash, TableSchema},
	AppContext,
	AppId,
	PeerId,
	DevRole,
	JazzClient,
	JazzError,
	ObjectId,
	SyncTransport,
	TcpSyncTransport,
	Value,
};
use crate::demo_mesh::PeerMeshStatusReply;
use crate::spark_sync::{self, SyncAclSnapshot};
use serde_json::{Map, Value as JsonValue};
use tauri::{Emitter, Manager};
use tauri_plugin_self::derive::ed25519_public;
use tauri_plugin_self::state::SelfState;
use tauri_plugin_self::vault::ActiveVault;
use tokio::sync::{Mutex, Notify};
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
	#[serde(skip_serializing_if = "Option::is_none")]
	pub session: Option<JazzSessionReply>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub message: Option<String>,
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
	client: Option<Arc<JazzClient>>,
	/// Device root → Groove [`PeerId`](groove::PeerId) UUID; `Some` iff `client` is populated.
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
	/// Webview `subscribe` ref-count per table — drives [`Self::snapshot_broadcast`] + `avenos:runtime` `{ kind: "table" }`.
	table_ui_refs: Mutex<HashMap<String, u32>>,
	shell: Mutex<Option<std::sync::Arc<jazz_engine::ShellState>>>,
	/// Serializes full `hydrate_shell` so parallel IPC does not stampede.
	shell_hydrate: Mutex<()>,
	/// When false, [`jazz_shell_ready`] may return the cached shell (todos CRUD, drain, etc.).
	shell_vault_stale: AtomicBool,
	/// Bumped on every Groove client replace/reset so background tasks never touch a stale `Arc`.
	conn_epoch: AtomicU64,
	/// Opens after [`jazz_shell_ready`] succeeds (cached or hydrated). Hyperswarm/mesh work must wait.
	mesh_local_shell_gate: AtomicBool,
	/// One Groove catch-up rebroadcast per conn epoch (not per shell invalidation).
	mesh_acl_rebroadcast_done: AtomicBool,
	/// Spark biscuit snapshot for outbound sync policy.
	pub(crate) sync_acl: Arc<RwLock<Option<SyncAclSnapshot>>>,
	/// MPSC sender for **all** UI-facing table deltas: paired peer inbound sync and local
	/// IPC writes both post `(table)` here. The drain task [`run_table_change_drain`] is
	/// the sole caller of [`ManagedJazz::snapshot_broadcast`], keeping one code path from
	/// "row changed somewhere" → `jazz:<table>:changed` for the webview.
	pub(crate) change_tx: tokio::sync::mpsc::UnboundedSender<String>,
	/// Skip identical table snapshots so the webview does not repaint every drain tick.
	last_table_snapshots: RwLock<HashMap<String, String>>,
	/// Skip identical mesh snapshots so connect sub-states do not repaint the webview.
	last_mesh_snapshot: RwLock<Option<String>>,
	/// Receiver moved out of here by [`take_change_rx`] once at startup; afterwards this
	/// stays `None`. Kept inside `std::sync::Mutex` so we can extract it from
	/// `tauri::setup` without an async runtime.
	change_rx: std::sync::Mutex<Option<tokio::sync::mpsc::UnboundedReceiver<String>>>,
	/// Coalesce parallel `jazz_connect` attempts (actor-serialized, belt-and-suspenders).
	connect_in_progress: Mutex<bool>,
	connect_done: Notify,
}

impl Default for ManagedJazz {
	fn default() -> Self {
		let (change_tx, change_rx) = tokio::sync::mpsc::unbounded_channel();
		Self {
			conn: Mutex::new(JazzConn::default()),
			table_ui_refs: Mutex::new(HashMap::new()),
			shell: Mutex::new(None),
			shell_hydrate: Mutex::new(()),
			shell_vault_stale: AtomicBool::new(true),
			conn_epoch: AtomicU64::new(0),
			mesh_local_shell_gate: AtomicBool::new(false),
			mesh_acl_rebroadcast_done: AtomicBool::new(false),
			sync_acl: Arc::new(RwLock::new(None)),
			change_tx,
			last_table_snapshots: RwLock::new(HashMap::new()),
			last_mesh_snapshot: RwLock::new(None),
			change_rx: std::sync::Mutex::new(Some(change_rx)),
			connect_in_progress: Mutex::new(false),
			connect_done: Notify::new(),
		}
	}
}

pub(super) fn emit_avenos_runtime(app: &tauri::AppHandle, payload: serde_json::Value) {
	use tauri::Emitter;
	let _ = app.emit("avenos:runtime", &payload);
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

const TABLE_DRAIN_FOLLOW_UP: Duration = Duration::from_millis(120);

/// Second drain pass after peer sync apply — row-batch frames can land after the first flush.
fn schedule_table_drain_follow_up(app: tauri::AppHandle, tables: HashSet<String>) {
	tauri::async_runtime::spawn(async move {
		tokio::time::sleep(TABLE_DRAIN_FOLLOW_UP).await;
		let drain = ui_drain::ui_table_drain(&app);
		if let Err(e) = drain.enqueue(tables).await {
			log::trace!(
				target: "avenos::jazz",
				"table-change drain follow-up enqueue failed: {e}",
			);
		}
	});
}

/// Runs one coalesced UI drain batch (shell hydrate + snapshots). Never enqueued on the Groove actor.
pub(crate) async fn execute_drain_batch(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	mut pending: std::collections::HashSet<String>,
) {
	let vault_shell_dirty = pending
		.iter()
		.any(|t| spark_sync::is_vault_shell_table(t));
	if vault_shell_dirty {
		jazz.invalidate_vault_shell();
	}

	let peers_pending = pending.remove("peers");
	if peers_pending {
		if let Err(e) = publish_trusted_peers_ui(app, jazz, self_state).await {
			log::warn!(
				target: "avenos::jazz",
				"table-change drain: publish_trusted_peers_ui failed: {e}",
			);
		}
	}

	let want_snapshots = !pending.is_empty() && jazz.any_ui_subscriber(&pending).await;
	// Vault-shell re-hydrate (e.g. keyshare before catalogue row) must republish `sparks` even
	// when the batch only named `keyshares` — otherwise grantees stay on an empty grid.
	let push_sparks_catalogue = vault_shell_dirty && !pending.contains("sparks");
	if !vault_shell_dirty && !want_snapshots && !push_sparks_catalogue {
		if !pending.is_empty() {
			log::trace!(
				target: "avenos::jazz",
				"table-change drain: no UI subscribers for {} table(s), skip",
				pending.len(),
			);
		}
		return;
	}

	let client = match with_connected_client(jazz, app, self_state).await {
		Ok(c) => c,
		Err(_) => return,
	};

	// Row-batch sync parks inbound frames until `batched_tick`; `recv_inbound` posts to this
	// drain earlier. Flush first so re-hydrate / list queries see peer grant deltas.
	let pairing_active = pairing_session_active(app).await;
	if (vault_shell_dirty || want_snapshots) && !pairing_active {
		if let Err(e) = client.flush_peer_sync().await {
			log::debug!(
				target: "avenos::jazz",
				"table-change drain: flush_peer_sync before shell/snapshot: {e}",
			);
		}
	} else if (vault_shell_dirty || want_snapshots) && pairing_active {
		log::trace!(
			target: "avenos::jazz",
			"table-change drain: defer flush_peer_sync — pairing active",
		);
	}

	if pending
		.iter()
		.any(|t| spark_sync::is_spark_data_table(t))
	{
		if let Err(e) = jazz.refresh_sync_acl_object_map(client.as_ref()).await {
			log::debug!(
				target: "avenos::jazz",
				"table-change drain: refresh_sync_acl_object_map failed: {e}",
			);
		}
	}

	let mut shell_hydrate_ok = !vault_shell_dirty;
	if vault_shell_dirty {
		match jazz_shell_for_ui(app, jazz, self_state, client.clone()).await {
			Ok(_) => shell_hydrate_ok = true,
			Err(e) => {
				log::warn!(
					target: "avenos::jazz",
					"table-change drain: vault shell re-hydrate failed: {e}",
				);
			}
		}
	}

	if !shell_hydrate_ok {
		return;
	}

	if !want_snapshots && !push_sparks_catalogue {
		return;
	}

	let shell = match jazz_shell_for_ui(app, jazz, self_state, client.clone()).await {
		Ok(s) => s,
		Err(e) => {
			log::debug!(
				target: "avenos::jazz",
				"table-change drain: shell not ready ({e}); skip batch ({} table(s))",
				pending.len(),
			);
			return;
		}
	};

	let snapshot_tables: HashSet<String> = pending.iter().cloned().collect();
	if want_snapshots {
		{
			let mut last = jazz
				.last_table_snapshots
				.write()
				.expect("last_table_snapshots poisoned");
			for t in &snapshot_tables {
				last.remove(t);
			}
		}
	}
	for table in pending {
		match jazz
			.snapshot_broadcast(app, client.as_ref(), shell.as_ref(), &table)
			.await
		{
			Ok(true) => log::debug!(
				target: "avenos::jazz",
				"table-change drain: republished {table}",
			),
			Ok(false) => {}
			Err(e) => log::warn!(
				target: "avenos::jazz",
				"table-change drain: snapshot_broadcast({table}) failed: {e}",
			),
		}
	}

	if push_sparks_catalogue {
		{
			let mut last = jazz
				.last_table_snapshots
				.write()
				.expect("last_table_snapshots poisoned");
			last.remove("sparks");
		}
		match jazz
			.snapshot_broadcast(app, client.as_ref(), shell.as_ref(), "sparks")
			.await
		{
			Ok(true) => log::debug!(
				target: "avenos::jazz",
				"table-change drain: republished sparks (vault catalogue after grant)",
			),
			Ok(false) => {}
			Err(e) => log::warn!(
				target: "avenos::jazz",
				"table-change drain: snapshot_broadcast(sparks) failed: {e}",
			),
		}
	}

	if !snapshot_tables.is_empty() {
		schedule_table_drain_follow_up(app.clone(), snapshot_tables);
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

	// Headroom for peer `push_sync_inbox` → `batched_tick` apply before we flush + re-query.
	const COALESCE_WINDOW: Duration = Duration::from_millis(50);

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

		let drain = app.state::<ui_drain::UiTableDrainHandle>();
		if let Err(e) = drain.enqueue(pending).await {
			log::warn!(
				target: "avenos::jazz",
				"table-change drain: failed to enqueue batch on ui drain: {e}",
			);
		}
	}
}

async fn shutdown_owned_client(old: Option<Arc<JazzClient>>) {
	let Some(client) = old else {
		return;
	};
	match Arc::try_unwrap(client) {
		Ok(c) => {
			if let Err(e) = c.shutdown().await {
				log::warn!(target: "avenos::jazz", "JazzClient shutdown failed (flush/sync): {e}");
			}
		}
		Err(arc) => {
			log::warn!(
				target: "avenos::jazz",
				"JazzClient shutdown skipped: {} outstanding Arc ref(s)",
				Arc::strong_count(&arc),
			);
		}
	}
}

/// Open Groove if needed and return a shared client. **`conn` is not held during `jazz_connect`.**
async fn with_connected_client(
	jazz: &ManagedJazz,
	app: &tauri::AppHandle,
	self_state: &SelfState,
) -> Result<Arc<JazzClient>, String> {
	if !self_state.is_unlocked() {
		jazz.reset_connection().await;
		return Err("locked: unlock AvenOS identity first".into());
	}
	let desired = desired_root_client_uuid(self_state)?;

	loop {
		{
			let jc = jazz.conn.lock().await;
			if let (Some(c), Some(linked)) = (&jc.client, &jc.linked_identity) {
				if *linked == desired {
					return Ok(Arc::clone(c));
				}
			}
			if *jazz.connect_in_progress.lock().await {
				drop(jc);
				jazz.connect_done.notified().await;
				continue;
			}
		}

		*jazz.connect_in_progress.lock().await = true;

		let connect_result: Result<Arc<JazzClient>, String> = async {
			{
				let mut jc = jazz.conn.lock().await;
				if let (Some(c), Some(linked)) = (&jc.client, &jc.linked_identity) {
					if *linked == desired {
						return Ok(Arc::clone(c));
					}
				}
				let old = jc.client.take();
				jc.linked_identity = None;
				jazz.shell.lock().await.take();
				let _epoch = jazz.bump_conn_epoch();
				jazz.reset_mesh_acl_catchup();
				drop(jc);
				shutdown_owned_client(old).await;
			}
			let client = jazz_connect(app, self_state, jazz).await?;
			Ok(Arc::new(client))
		}
		.await;

		*jazz.connect_in_progress.lock().await = false;
		jazz.connect_done.notify_waiters();

		match connect_result {
			Ok(client) => {
				let mut jc = jazz.conn.lock().await;
				jc.client = Some(Arc::clone(&client));
				jc.linked_identity = Some(desired);
				return Ok(client);
			}
			Err(e) => return Err(e),
		}
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

/// Re-stamp the Groove data dir. Wipes only when **identity** disagrees (`client_id` or lane).
///
/// Schema hash changes use Jazz v2 lenses ([`schema_migrations`]) — data stays on older branches
/// and remains readable/writable via composed lenses (see <https://jazz.tools/docs/schemas/migrations>).
fn reconcile_jazz_identity_cache_dir(
	jazz_dir: &Path,
	desired_uuid: Uuid,
	current_groove_hash: &[u8; 32],
	current_schema: &groove::Schema,
) -> Result<Vec<groove::Schema>, String> {
	let mut reason: Option<String> = None;

	let client_path = jazz_dir.join("client_id");
	let rocksdb_path = jazz_dir.join("storage.rocksdb");
	let legacy_rocksdb_path = jazz_dir.join("jazz.rocksdb");
	let legacy_surrealkv_path = jazz_dir.join("groove.surrealkv");
	if legacy_rocksdb_path.is_file() && !rocksdb_path.exists() {
		if let Err(e) = fs::rename(&legacy_rocksdb_path, &rocksdb_path) {
			log::warn!(
				target: "avenos::jazz",
				"migrate jazz.rocksdb→storage.rocksdb: {e}",
			);
		}
	}
	let has_prior_groove_data = client_path.exists()
		|| rocksdb_path.exists()
		|| legacy_rocksdb_path.exists()
		|| legacy_surrealkv_path.exists();
	if legacy_surrealkv_path.exists() && !rocksdb_path.exists() {
		reason = Some(
			"storage backend migration: SurrealKV (groove.surrealkv) → RocksDB (storage.rocksdb); wiping local vault".into(),
		);
	}
	match fs::read_to_string(&client_path) {
		Ok(s) => {
			if let Some(cid) = PeerId::parse(s.trim()) {
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
	let mut live_schemas: Vec<groove::Schema> = Vec::new();
	if reason.is_none() {
		match fs::read(&hash_path) {
			Ok(bytes) if bytes.len() == 32 && bytes.as_slice() == current_groove_hash => {}
			Ok(bytes) if bytes.len() == 32 => {
				let stored: [u8; 32] = bytes.try_into().expect("length checked");
				live_schemas =
					crate::schema_migrations::live_schemas_for_stored_hash(jazz_dir, &stored, current_schema)?;
			}
			Ok(bytes) => {
				reason = Some(format!(
					"invalid groove SchemaHash file ({} bytes, expected 32)",
					bytes.len()
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
		"groove cache stamped: dir={} groove_hash={} composed_branch={} live_schemas={}",
		jazz_dir.display(),
		hex_short(current_groove_hash),
		composed.as_str(),
		live_schemas.len()
	);
	Ok(live_schemas)
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
	fn bump_conn_epoch(&self) -> u64 {
		self.conn_epoch.fetch_add(1, Ordering::AcqRel) + 1
	}

	fn invalidate_vault_shell(&self) {
		self.shell_vault_stale.store(true, Ordering::Release);
		self.last_table_snapshots
			.write()
			.expect("last_table_snapshots poisoned")
			.clear();
		// Keep sync_acl until re-hydrate replaces it — clearing it re-triggers catch-up rebroadcast storms.
	}

	/// Refresh `(table, object_id) → spark_id` in the outbound sync gate without a full shell hydrate.
	pub(crate) async fn refresh_sync_acl_object_map(
		&self,
		client: &JazzClient,
	) -> Result<(), String> {
		let object_spark_ids = jazz_engine::build_object_spark_id_map(client).await?;
		let mut guard = self.sync_acl.write().expect("sync_acl poisoned");
		if let Some(snap) = guard.as_mut() {
			snap.object_spark_ids = object_spark_ids;
		}
		Ok(())
	}

	fn reset_mesh_acl_catchup(&self) {
		self.mesh_acl_rebroadcast_done.store(false, Ordering::Release);
	}

	/// Drops cached Groove runtime + biscuit shell (`SelfState`-derived). Prefer calling this whenever
	/// [`SelfState`] is cleared (vault lock).
	pub(crate) async fn reset_connection(&self) {
		self.bump_conn_epoch();
		self.reset_mesh_acl_catchup();
		let old_client = {
			let mut jc = self.conn.lock().await;
			jc.linked_identity = None;
			self.shell.lock().await.take();
			self.shell_vault_stale.store(true, Ordering::Release);
			self.mesh_local_shell_gate.store(false, Ordering::Release);
			*self.sync_acl.write().expect("sync_acl poisoned") = None;
			self.last_table_snapshots.write().expect("last_table_snapshots poisoned").clear();
			*self.last_mesh_snapshot.write().expect("last_mesh_snapshot poisoned") = None;
			self.table_ui_refs.lock().await.clear();
			*self.connect_in_progress.lock().await = false;
			self.connect_done.notify_waiters();
			jc.client.take()
		};
		shutdown_owned_client(old_client).await;
	}

	async fn bump_table_ui_ref(&self, table: &str) -> u32 {
		let mut m = self.table_ui_refs.lock().await;
		let n = m.entry(table.to_string()).or_insert(0);
		*n += 1;
		*n
	}

	async fn drop_table_ui_ref(&self, table: &str) -> u32 {
		let mut m = self.table_ui_refs.lock().await;
		let n = m
			.get_mut(table)
			.map(|c| {
				*c = c.saturating_sub(1);
				*c
			})
			.unwrap_or(0);
		if n == 0 {
			m.remove(table);
		}
		n
	}

	async fn table_ui_ref_count(&self, table: &str) -> u32 {
		self.table_ui_refs
			.lock()
			.await
			.get(table)
			.copied()
			.unwrap_or(0)
	}

	/// At least one active `subscribe` ref for any of `tables`.
	async fn any_ui_subscriber(&self, tables: &std::collections::HashSet<String>) -> bool {
		let m = self.table_ui_refs.lock().await;
		tables
			.iter()
			.any(|t| m.get(t).copied().unwrap_or(0) > 0)
	}

	/// Re-query `table` and emit `avenos:runtime` `{ kind: "table", table, rows }` (deduped).
	///
	/// **Callers:** [`execute_drain_batch`], local CRUD [`change_tx`] path.
	pub async fn snapshot_broadcast(
		&self,
		app: &tauri::AppHandle,
		client: &JazzClient,
		shell: &jazz_engine::ShellState,
		table: &str,
	) -> Result<bool, String> {
		if self.table_ui_ref_count(table).await == 0 {
			return Ok(false);
		}
		if table == "peers" {
			let rows = crate::peers::list_peer_rows(client).await?;
			return emit_peers_table_snapshot(self, app, &rows);
		}
		let (snap, _) = jazz_engine::query_table_publish(client, shell, table, ENCRYPTED_META).await?;
		let encoded = serde_json::to_string(&snap).map_err(|e| e.to_string())?;
		{
			let mut last = self
				.last_table_snapshots
				.write()
				.expect("last_table_snapshots poisoned");
			if last.get(table).is_some_and(|prev| prev == &encoded) {
				return Ok(false);
			}
			last.insert(table.to_string(), encoded);
		}
		emit_avenos_runtime(
			app,
			serde_json::json!({
				"kind": "table",
				"table": table,
				"rows": snap,
			}),
		);
		Ok(true)
	}

	/// Bootstrap / subscribe initial paint — emits even when no `subscribe` ref yet.
	pub async fn publish_table_snapshot_force(
		&self,
		app: &tauri::AppHandle,
		client: &JazzClient,
		shell: &jazz_engine::ShellState,
		table: &str,
	) -> Result<(), String> {
		if table == "peers" {
			let rows = crate::peers::list_peer_rows(client).await?;
			let _ = emit_peers_table_snapshot(self, app, &rows)?;
			return Ok(());
		}
		let (snap, _) =
			jazz_engine::query_table_publish(client, shell, table, ENCRYPTED_META).await?;
		if table == "sparks" && snap.is_empty() {
			log::warn!(
				target: "avenos::jazz",
				"bootstrap: sparks table empty after hydrate — UI may seed on next write",
			);
		}
		let encoded = serde_json::to_string(&snap).map_err(|e| e.to_string())?;
		{
			let mut last = self
				.last_table_snapshots
				.write()
				.expect("last_table_snapshots poisoned");
			last.insert(table.to_string(), encoded);
		}
		emit_avenos_runtime(
			app,
			serde_json::json!({
				"kind": "table",
				"table": table,
				"rows": snap,
			}),
		);
		Ok(())
	}
}

/// Emit `{ kind: "table", table: "peers" }` from canonical allowlisted remote rows.
fn emit_peers_table_snapshot(
	jazz: &ManagedJazz,
	app: &tauri::AppHandle,
	rows: &[crate::peers::PeerRowReply],
) -> Result<bool, String> {
	let encoded = serde_json::to_string(rows).map_err(|e| e.to_string())?;
	{
		let mut last = jazz
			.last_table_snapshots
			.write()
			.expect("last_table_snapshots poisoned");
		if last.get("peers").is_some_and(|prev| prev == &encoded) {
			return Ok(false);
		}
		last.insert("peers".to_string(), encoded);
	}
	emit_avenos_runtime(
		app,
		serde_json::json!({
			"kind": "table",
			"table": "peers",
			"rows": rows,
		}),
	);
	Ok(true)
}

/// Single fetch of trusted remote peers → table push (if subscribed) + mesh snapshot.
pub(crate) async fn publish_trusted_peers_ui(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	ss: &SelfState,
) -> Result<(), String> {
	let rows = if ss.is_unlocked() {
		let client = with_connected_client(jazz, app, ss).await?;
		crate::peers::list_peer_rows(client.as_ref()).await?
	} else {
		vec![]
	};

	if jazz.table_ui_ref_count("peers").await > 0 {
		let _ = emit_peers_table_snapshot(jazz, app, &rows);
	}

	emit_mesh_snapshot_from_rows(app, jazz, rows).await
}

async fn emit_mesh_snapshot_from_rows(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	_rows: Vec<crate::peers::PeerRowReply>,
) -> Result<(), String> {
	let snap = crate::demo_mesh::demo_mesh_status_reply();
	let encoded = serde_json::to_string(&snap).map_err(|e| e.to_string())?;
	{
		let mut last = jazz
			.last_mesh_snapshot
			.write()
			.expect("last_mesh_snapshot poisoned");
		if last.as_ref() == Some(&encoded) {
			return Ok(());
		}
		*last = Some(encoded);
	}
	emit_avenos_runtime(
		app,
		serde_json::json!({ "kind": "mesh", "snapshot": snap }),
	);
	Ok(())
}

fn decode_json_bytea(s: &str) -> Result<Vec<u8>, String> {
	use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};
	use base64::Engine;

	if s == PHASE1_SECRET_PLACEHOLDER || s.starts_with(crate::crypto::CELL_ENVELOPE_V1) {
		return Ok(s.as_bytes().to_vec());
	}
	if let Ok(b) = URL_SAFE_NO_PAD.decode(s) {
		return Ok(b);
	}
	if let Ok(b) = STANDARD.decode(s) {
		return Ok(b);
	}
	if let Ok(b) = URL_SAFE.decode(s) {
		return Ok(b);
	}
	Err("expected base64 bytea column".to_string())
}

fn is_sealed_or_phase1_storage_string(s: &str) -> bool {
	s == PHASE1_SECRET_PLACEHOLDER || s.starts_with(crate::crypto::CELL_ENVELOPE_V1)
}

pub(super) fn json_cell_to_jazz(cell: &JsonValue, col_ty: &ColumnType, nullable: bool) -> Result<Value, String> {
	if cell.is_null() || *cell == JsonValue::Null {
		return nullable
			.then(|| Ok(Value::Null))
			.unwrap_or_else(|| Err("null not permitted".to_string()));
	}
	if let Some(s) = cell.as_str() {
		if is_sealed_or_phase1_storage_string(s) {
			// Keep Groove column types aligned with the manifest (e.g. `files.content` is bytea).
			return if matches!(col_ty, ColumnType::Bytea) {
				decode_json_bytea(s).map(Value::Bytea)
			} else {
				Ok(Value::Text(s.to_string()))
			};
		}
	}
	match col_ty {
		ColumnType::Text => cell
			.as_str()
			.map(|s| Value::Text(s.to_string()))
			.ok_or_else(|| "expected JSON string column".to_string()),
		ColumnType::Boolean => cell
			.as_bool()
			.map(Value::Boolean)
			.ok_or_else(|| "expected JSON boolean column".to_string()),
		ColumnType::Integer => cell
			.as_i64()
			.and_then(|n| i32::try_from(n).ok())
			.map(Value::Integer)
			.ok_or_else(|| "expected JSON i32-compatible integer column".to_string()),
		ColumnType::BigInt => cell
			.as_i64()
			.map(Value::BigInt)
			.ok_or_else(|| "expected JSON i64-compatible integer column".to_string()),
		ColumnType::Timestamp => cell
			.as_u64()
			.map(Value::Timestamp)
			.ok_or_else(|| "expected JSON u64 timestamp column".to_string()),
		ColumnType::Uuid => cell
			.as_str()
			.and_then(|s| Uuid::parse_str(s).ok())
			.map(|u| Value::Uuid(ObjectId::from_uuid(u)))
			.ok_or_else(|| "expected UUID string column".to_string()),
		ColumnType::Array { element: inner } => {
			let arr = cell
				.as_array()
				.ok_or_else(|| format!("expected JSON array column (inner={inner:?})"))?;
			let mut elems = Vec::with_capacity(arr.len());
			for item in arr {
				elems.push(json_cell_to_jazz(item, inner.as_ref(), false)?);
			}
			Ok(Value::Array(elems))
		}
		ColumnType::Bytea => cell
			.as_str()
			.ok_or_else(|| "expected JSON string bytea column".to_string())
			.and_then(|s| decode_json_bytea(s).map(Value::Bytea)),
		ColumnType::Double => cell
			.as_f64()
			.map(Value::Double)
			.ok_or_else(|| "expected JSON number double column".to_string()),
		ColumnType::Json { .. } => {
			let s = serde_json::to_string(cell).map_err(|e| format!("json column encode: {e}"))?;
			Ok(Value::Text(s))
		}
		ColumnType::Enum { variants } => {
			let s = cell
				.as_str()
				.ok_or_else(|| "expected JSON string enum column".to_string())?;
			if !variants.iter().any(|v| v == s) {
				return Err(format!("enum variant `{s}` not in {variants:?}"));
			}
			Ok(Value::Text(s.to_string()))
		}
		ColumnType::BatchId => {
			let s = cell
				.as_str()
				.ok_or_else(|| "expected JSON string batch_id column".to_string())?;
			let bytes = hex::decode(s.trim()).map_err(|e| format!("batch_id hex: {e}"))?;
			if bytes.len() != 16 {
				return Err(format!("batch_id length {} (expected 16)", bytes.len()));
			}
			let mut arr = [0u8; 16];
			arr.copy_from_slice(&bytes);
			Ok(Value::BatchId(arr))
		}
		// Nested `Row` types are engine-only until a structured JSON IPC contract exists.
		ColumnType::Row { .. } => Err(format!(
			"row {col_ty:?} unsupported through JSON IPC (engine-only; use flat columns)",
			col_ty = col_ty,
		)),
	}
}

/// Encode IPC JSON into a Groove `Text` cell (storage is always `text` for sealed columns).
///
/// When the manifest sets `exposeTs`, the logical value is encoded as canonical JSON inside the
/// text cell (then sealed on the write path). Plain `text` columns without `exposeTs` store UTF-8 strings.
pub(super) fn json_to_text_storage_cell(
	table: &str,
	column: &str,
	cell: &JsonValue,
	nullable: bool,
) -> Result<Value, String> {
	if cell.is_null() || *cell == JsonValue::Null {
		return nullable
			.then(|| Ok(Value::Null))
			.unwrap_or_else(|| Err("null not permitted".to_string()));
	}
	if let Some(expose) = crate::schema_manifest::expose_ts_for(table, column) {
		let gv = json_cell_to_jazz(cell, expose, nullable)?;
		let canon = crate::crypto::groove_value_to_canonical_utf8(&gv)?;
		return Ok(Value::Text(canon));
	}
	if let Some(s) = cell.as_str() {
		if is_sealed_or_phase1_storage_string(s) {
			return Ok(Value::Text(s.to_string()));
		}
		return Ok(Value::Text(s.to_string()));
	}
	Err(format!(
		"column `{table}.{column}`: expected JSON string for text storage (or use exposeTs logical type)"
	))
}

pub(super) fn insert_values(
	table: &str,
	table_schema: &TableSchema,
	values: JsonRow,
) -> Result<Vec<Value>, String> {
	let cols = &table_schema.columns.columns;
	let mut row = Vec::with_capacity(cols.len());
	for cd in cols {
		let key = cd.name_str();
		let cv = values.get(key);
		let val = match cv {
			None if cd.nullable => Value::Null,
			None => return Err(format!("missing column `{key}`")),
			Some(js) => {
				if matches!(cd.column_type, ColumnType::Text) {
					json_to_text_storage_cell(table, key, js, cd.nullable)?
				} else {
					json_cell_to_jazz(js, &cd.column_type, cd.nullable)?
				}
			}
		};
		row.push(val);
	}
	Ok(row)
}

pub(crate) fn patch_updates(table_schema: &TableSchema, patch: JsonRow) -> Result<Vec<(String, Value)>, String> {
	let mut ops = Vec::new();
	let row_desc = &table_schema.columns;

	for (k, raw_js) in &patch {
		if k == "id" {
			continue;
		}
		let col = row_desc.column(k).ok_or_else(|| format!("unknown_column: {k}"))?;
		let v = json_cell_to_jazz(raw_js, &col.column_type, col.nullable)?;
		ops.push((k.clone(), v));
	}
	if ops.is_empty() {
		return Err("empty patch".into());
	}
	Ok(ops)
}

/// Dev-only (`dev:app2x`): when `AVENOS_DEV_PEER_SYNC=1`, establish a localhost
/// TCP peer transport so two instances converge a shared spark live. Instance A
/// listens, B dials (retrying until A is up). Returns the transport + remote peer
/// id, or `None` to run local-only (single instance, or peer not reachable).
async fn try_dev_peer_transport(local: PeerId) -> Option<(Arc<dyn SyncTransport>, PeerId)> {
	if std::env::var("AVENOS_DEV_PEER_SYNC").is_err() {
		return None;
	}
	const ADDR: &str = "127.0.0.1:14290";
	let role = match std::env::var("AVENOS_DEV_INSTANCE").ok().as_deref() {
		Some("A") => DevRole::Listen,
		Some("B") => DevRole::Dial,
		_ => return None,
	};
	let established = tokio::time::timeout(Duration::from_secs(30), async {
		loop {
			match TcpSyncTransport::connect(role, ADDR, local).await {
				Ok(t) => return Some(t),
				// Dialer retries until the listener binds; listener bind/accept
				// failures fall through to local-only.
				Err(_) if role == DevRole::Dial => {
					tokio::time::sleep(Duration::from_millis(400)).await;
				}
				Err(e) => {
					log::warn!("dev peer transport ({role:?}) failed: {e}");
					return None;
				}
			}
		}
	})
	.await
	.ok()
	.flatten();
	match established {
		Some(t) => {
			let remote = t.remote_client_id();
			log::info!("dev peer transport established (remote {remote})");
			Some((Arc::new(t), remote))
		}
		None => {
			log::warn!("dev peer transport not established; running local-only");
			None
		}
	}
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
	let live_schemas =
		reconcile_jazz_identity_cache_dir(&data_dir, deterministic, &groove_hash, &schema)?;

	let ctx = AppContext {
		app_id: AppId::from_name("ceo.aven.os"),
		client_id: Some(PeerId(deterministic)),
		schema: schema.clone(),
		live_schemas,
		data_dir: data_dir.clone(),
	};

	let _ = (app, mj);
	let client = match try_dev_peer_transport(PeerId(deterministic)).await {
		Some((transport, remote)) => {
			let client = JazzClient::connect_with_sync_transport(ctx, transport, None)
				.await
				.map_err(format_jazz_err)?;
			if let Err(e) = client.register_peer_sync_client(remote) {
				log::warn!("register dev peer {remote}: {e}");
			}
			client
		}
		None => JazzClient::connect(ctx).await.map_err(format_jazz_err)?,
	};
	crate::schema_migrations::stamp_current_vault_snapshot(&data_dir, &schema)?;
	Ok(client)
}

/// Flip shell gate after local vault shell is ready (demo mesh — no live transport reconcile).
fn mark_shell_local_ready_for_mesh(_app: &tauri::AppHandle, mj: &ManagedJazz) {
	mj.mesh_local_shell_gate.store(true, Ordering::Release);
}

async fn pairing_session_active(_app: &tauri::AppHandle) -> bool {
	false
}

async fn jazz_shell_ready(
	app: &tauri::AppHandle,
	mj: &ManagedJazz,
	self_state: &SelfState,
	client: Arc<JazzClient>,
) -> Result<std::sync::Arc<jazz_engine::ShellState>, String> {
	jazz_shell_ready_inner(app, mj, self_state, client, false).await
}

/// Shell hydrate for UI table drains — no mesh reconcile, ACL bootstrap, or pairing-sensitive flush side effects.
async fn jazz_shell_for_ui(
	app: &tauri::AppHandle,
	mj: &ManagedJazz,
	self_state: &SelfState,
	client: Arc<JazzClient>,
) -> Result<std::sync::Arc<jazz_engine::ShellState>, String> {
	jazz_shell_ready_inner(app, mj, self_state, client, true).await
}

async fn jazz_shell_ready_inner(
	app: &tauri::AppHandle,
	mj: &ManagedJazz,
	self_state: &SelfState,
	client: Arc<JazzClient>,
	for_ui_drain: bool,
) -> Result<std::sync::Arc<jazz_engine::ShellState>, String> {
	if !mj.shell_vault_stale.load(Ordering::Acquire) {
		if let Some(cached) = mj.shell.lock().await.clone() {
			if !for_ui_drain {
				mark_shell_local_ready_for_mesh(app, mj);
			}
			return Ok(cached);
		}
	}

	let _hydrate_guard = mj.shell_hydrate.lock().await;
	if !mj.shell_vault_stale.load(Ordering::Acquire) {
		if let Some(cached) = mj.shell.lock().await.clone() {
			if !for_ui_drain {
				mark_shell_local_ready_for_mesh(app, mj);
			}
			return Ok(cached);
		}
	}

	let root = self_state
		.with_root(|r| Ok(*r))
		.map_err(|_| "locked: unlock AvenOS identity first".to_string())?;
	let vault_files = vault_user_root(app)?;
	// Full hydrate when vault tables change (sparks/keyshares/peers) or on first use after unlock.
	let hydrated = jazz_engine::hydrate_shell(client.as_ref(), &root, &vault_files).await?;
	mj.shell_vault_stale.store(false, Ordering::Release);
	let arc = std::sync::Arc::new(hydrated);
	let mut slot = mj.shell.lock().await;
	*slot = Some(std::sync::Arc::clone(&arc));
	let object_spark_ids = jazz_engine::build_object_spark_id_map(client.as_ref()).await?;
	let snap = spark_sync::build_sync_acl_snapshot(object_spark_ids);
	*mj.sync_acl.write().expect("sync_acl poisoned") = Some(snap);
	if !for_ui_drain {
		let first_mesh_publish = !mj.mesh_acl_rebroadcast_done.swap(true, Ordering::AcqRel);
		if first_mesh_publish {
			publish_peer_mesh_after_acl(app).await;
		}
		mark_shell_local_ready_for_mesh(app, mj);
	}
	Ok(arc)
}

async fn publish_peer_mesh_after_acl(app: &tauri::AppHandle) {
	runtime::groove_actor(app).publish_mesh().await;
}

pub(crate) async fn groove_ipc_status(
	_app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
) -> Result<JazzStatusReply, String> {
	if !self_state.is_unlocked() {
		jazz.reset_connection().await;
		return Ok(JazzStatusReply {
			ready: false,
			tables: vec![],
			session: None,
			message: None,
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
			session: None,
			message: None,
		});
	}

	let client = match jc.client.clone() {
		Some(c) => c,
		None => {
			return Ok(JazzStatusReply {
				ready: false,
				tables: vec![],
				session: None,
				message: None,
			});
		}
	};
	let shell_ready = !jazz.shell_vault_stale.load(Ordering::Acquire)
		&& jazz.shell.lock().await.is_some();
	drop(jc);

	let sch = client.schema().await.map_err(format_jazz_err)?;
	let mut names: Vec<String> = sch.keys().map(|k| k.to_string()).collect();
	names.sort();
	Ok(JazzStatusReply {
		ready: shell_ready,
		tables: names,
		session: None,
		message: None,
	})
}

fn jazz_session_reply_from_shell(shell: &jazz_engine::ShellState) -> JazzSessionReply {
	JazzSessionReply {
		peer_did: shell.peer_did.clone(),
		peer_did_short: jazz_engine::short_peer_did(&shell.peer_did),
		default_spark_urn: jazz_engine::spark_urn(shell.default_spark),
	}
}

const BOOTSTRAP_UI_TABLES: &[&str] = &["sparks", "humans", "peers", "messages", "todos", "files"];

pub(crate) async fn groove_ipc_bootstrap(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
) -> Result<JazzStatusReply, String> {
	let client = with_connected_client(jazz, app, self_state).await?;
	let sch = client.schema().await.map_err(format_jazz_err)?;
	let mut tables: Vec<String> = sch.keys().map(|k| k.to_string()).collect();
	tables.sort();

	let client_arc = client.clone();
	match jazz_shell_ready(app, jazz, self_state, client).await {
		Ok(shell) => {
			let session = jazz_session_reply_from_shell(shell.as_ref());
			emit_avenos_runtime(app, serde_json::json!({
				"kind": "session",
				"phase": "ready",
				"grooveReady": true,
				"peerDid": session.peer_did,
				"defaultSparkUrn": session.default_spark_urn,
				"tables": tables.clone(),
			}));
			for table in BOOTSTRAP_UI_TABLES {
				if let Err(e) = jazz
					.publish_table_snapshot_force(
						app,
						client_arc.as_ref(),
						shell.as_ref(),
						table,
					)
					.await
				{
					log::warn!(
						target: "avenos::jazz",
						"bootstrap snapshot {table}: {e}",
					);
				}
			}
			#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
			{
				if let Err(e) = execute_mesh_refresh_full(app, jazz).await {
					log::debug!(
						target: "avenos::jazz",
						"post-bootstrap mesh refresh: {e}",
					);
				}
			}
			Ok(JazzStatusReply {
				ready: true,
				tables,
				session: Some(session),
				message: None,
			})
		}
		Err(e) => {
			log::warn!(target: "avenos::jazz", "jazz_bootstrap shell_ready: {e}");
			emit_avenos_runtime(app, serde_json::json!({
				"kind": "session",
				"phase": "bootstrapping",
				"grooveReady": false,
				"message": e,
			}));
			Ok(JazzStatusReply {
				ready: false,
				tables,
				session: None,
				message: Some(e),
			})
		}
	}
}

pub(crate) async fn groove_ipc_session(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
) -> Result<JazzSessionReply, String> {
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	Ok(JazzSessionReply {
		peer_did: shell.peer_did.clone(),
		peer_did_short: jazz_engine::short_peer_did(&shell.peer_did),
		default_spark_urn: jazz_engine::spark_urn(shell.default_spark),
	})
}

/// Demo mesh — no live Groove peer registration.
pub(crate) async fn groove_ipc_peer_mesh_refresh(
	_app: &tauri::AppHandle,
	_jazz: &ManagedJazz,
	_self_state: &SelfState,
) -> Result<JazzPeerMeshRefreshReply, String> {
	Ok(JazzPeerMeshRefreshReply {
		registered_count: 0,
	})
}

/// Append biscuit third-party `owns` for `peerDid`, persist updated `genesis_b64`, and add a DEK keyshare row so the peer can decrypt ciphertext for this spark after sync.
pub(crate) async fn groove_ipc_spark_admin_add(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
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

	let client = with_connected_client(jazz, app, self_state).await?;

	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let shell = shell_arc.as_ref();

	if peer_did == shell.peer_did {
		return Err("cannot grant a spark to your own DID".into());
	}

	crate::jazz_auth::ed25519_public_from_peer_did(&peer_did)?;

	if !crate::peers::is_allowlisted(client.as_ref(), &peer_did).await? {
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

	let ks_schema_pre = jazz_engine::resolved_table_schema(client.as_ref(), "keyshares").await?;
	let ks_spark_ix_pre = jazz_engine::col_ix(&ks_schema_pre, "spark_id")?;
	let ks_ver_ix_pre = jazz_engine::col_ix(&ks_schema_pre, "dek_version")?;
	let ks_recip_ix_pre = jazz_engine::col_ix(&ks_schema_pre, "recipient_did")?;

	let ks_rows_pre = jazz_engine::exec_list_rows(client.as_ref(), "keyshares").await?;
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
		finish_spark_admin_grant(app, jazz, self_state, client, spark_uuid).await?;
		return Ok(());
	}

	let _ = client.flush_peer_sync().await;

	// Keyshare before genesis so peers often have the DEK before biscuit/catalogue rows land.
	if !ks_exists {
		let recipient_pk = crate::jazz_auth::ed25519_public_from_peer_did(&peer_did)?;
		let kek = crate::crypto::derive_kek_x25519(&shell.signing_key, &recipient_pk)?;
		let urn = jazz_engine::spark_urn(spark_uuid);
		let aad = crate::crypto::keyshare_wrap_aad(&urn, &peer_did, dek_ver);
		let wrapped = crate::crypto::encrypt_keyshare_payload(&kek, dek.expose(), &aad)?;

		let ks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "keyshares").await?;
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
			"wrapper_did".into(),
			JsonValue::String(shell.peer_did.clone()),
		);
		ks.insert(
			"wrapped_dek".into(),
			JsonValue::String(wrapped),
		);
		let ks_vals = insert_values("keyshares", &ks_schema, ks)?;
		client
			.create("keyshares", ks_vals)
			.await
			.map_err(format_jazz_err)?;
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

		let sparks_schema = jazz_engine::resolved_table_schema(client.as_ref(), "sparks").await?;
		let spark_id_ix = jazz_engine::col_ix(&sparks_schema, "spark_id")?;

		let sparks_rows = jazz_engine::exec_list_rows(client.as_ref(), "sparks").await?;
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

	finish_spark_admin_grant(app, jazz, self_state, client, spark_uuid).await?;

	Ok(())
}

/// Re-hydrate vault shell + sync ACL, push grant to peers, refresh sparks catalogue in the webview.
async fn finish_spark_admin_grant(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	client: Arc<JazzClient>,
	_spark_uuid: uuid::Uuid,
) -> Result<(), String> {
	jazz.invalidate_vault_shell();
	let shell = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;

	let _ = execute_mesh_refresh_full(app, jazz).await;

	let _ = jazz
		.publish_table_snapshot_force(app, client.as_ref(), shell.as_ref(), "sparks")
		.await;

	enqueue_vault_catalogue_drain(app).await;

	Ok(())
}

async fn enqueue_vault_catalogue_drain(app: &tauri::AppHandle) {
	use std::collections::HashSet;

	let mut tables = HashSet::new();
	for t in spark_sync::VAULT_CATALOGUE_UI_TABLES {
		tables.insert(t.to_string());
	}
	let drain = ui_drain::ui_table_drain(app);
	if let Err(e) = drain.enqueue(tables).await {
		log::debug!(
			target: "avenos::jazz",
			"vault catalogue drain enqueue failed: {e}",
		);
	}
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SparkAdminListReply {
	pub admin_dids: Vec<String>,
}

/// Who can administer this spark (from biscuit `owns` facts).
pub(crate) async fn groove_ipc_spark_admin_list(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	spark_id: String,
) -> Result<SparkAdminListReply, String> {
	let spark_uuid =
		Uuid::parse_str(spark_id.trim()).map_err(|e| format!("invalid spark_id UUID: {e}"))?;

	let client = with_connected_client(jazz, app, self_state).await?;
	let shell = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
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
pub(crate) async fn groove_ipc_spark_admin_revoke(
	_spark_id: String,
	_peer_did: String,
) -> Result<(), String> {
	Err("spark_admin_revoke is not implemented yet (planned: v2 key rotation).".into())
}

pub(crate) async fn groove_ipc_jazz_list(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	table: String,
) -> Result<Vec<JsonRow>, String> {
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let (rows, _) =
		jazz_engine::query_table_publish(client.as_ref(), &shell, &table, ENCRYPTED_META).await?;
	Ok(rows)
}

pub(crate) async fn groove_ipc_jazz_explorer_list(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	table: String,
) -> Result<JazzExplorerListReply, String> {
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let (rows, skipped_unauthorized_rows) =
		jazz_engine::query_table_publish(client.as_ref(), &shell, &table, ENCRYPTED_META).await?;
	Ok(JazzExplorerListReply {
		rows,
		skipped_unauthorized_rows,
	})
}

pub(crate) async fn groove_ipc_jazz_get(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	table: String,
	id: String,
) -> Result<JsonRow, String> {
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let uuid = Uuid::parse_str(&id).map_err(|e| format!("invalid id UUID: {e}"))?;

	let tbl = jazz_engine::resolved_table_schema(client.as_ref(), &table).await?;
	match jazz_engine::find_row_snapshot(client.as_ref(), &table, &tbl, uuid).await? {
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

async fn finish_spark_data_write(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
	table: &str,
) {
	if !spark_sync::is_spark_data_table(table) {
		return;
	}
	let _ = jazz
		.snapshot_broadcast(app, client, shell, table)
		.await;
}

pub(crate) async fn groove_ipc_jazz_create(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	table: String,
	mut values: JsonRow,
) -> Result<JsonRow, String> {
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let tbl = jazz_engine::resolved_table_schema(client.as_ref(), &table).await?;

	if table == "peers" {
		let vals = insert_values("peers", &tbl, values)?;
		let oid = client
			.create(&table, vals.clone())
			.await
			.map_err(format_jazz_err)?;

		let (_, vals_fresh) =
			jazz_engine::find_row_snapshot(client.as_ref(), &table, &tbl, *oid.uuid())
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

		#[cfg(any(target_os = "macos", target_os = "ios"))]
		{
			let _ = execute_mesh_refresh_full(app, jazz).await?;
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

		let vals = insert_values(&table, &tbl, values)?;
		let oid = client
			.create(&table, vals.clone())
			.await
			.map_err(format_jazz_err)?;

	if spark_sync::needs_acl_object_map_refresh_after_create(&table) {
		let _ = jazz.refresh_sync_acl_object_map(client.as_ref()).await;
	}

	if !plaintext.is_empty() {
		let spark = jazz_engine::spark_uuid_row(&tbl, &vals)?;
		let mut ph = JsonRow::new();
		for (col, pt) in plaintext {
			let cd = tbl
				.columns
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
		jazz_engine::find_row_snapshot(client.as_ref(), &table, &tbl, *oid.uuid())
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

	finish_spark_data_write(app, jazz, client.as_ref(), shell.as_ref(), &table).await;

	Ok(reply)
}

pub(crate) async fn groove_ipc_jazz_update(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	table: String,
	id: String,
	patch: JsonRow,
) -> Result<JsonRow, String> {
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let tbl = jazz_engine::resolved_table_schema(client.as_ref(), &table).await?;
	let uuid =
		uuid::Uuid::parse_str(&id).map_err(|e| format!("invalid id UUID parse: {e}"))?;

	// `find_row_snapshot` reads without `.branch()` so jazz-tools auto-loads the
	// row's `Object` on **every** known schema-version branch into ObjectManager.
	// Important: keep using `oid` from the query result — `ObjectId::from_uuid`
	// produces a non-interned id that misses the pointer-keyed in-memory map.
	let (oid, old_vals) = jazz_engine::find_row_snapshot(client.as_ref(), &table, &tbl, uuid)
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
	let runtime_branch = jazz_engine::groove_write_branch_from_connected_schema_or_log(client.as_ref()).await;
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
					.columns
					.column(col)
					.ok_or_else(|| format!("unknown_sensitive_col:{col}"))?;
				let gv = if let Some(expose) =
					crate::schema_manifest::expose_ts_for(&table, col)
				{
					json_cell_to_jazz(&js, expose, cd.nullable)?
				} else {
					json_cell_to_jazz(&js, &cd.column_type, cd.nullable)?
				};
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

	finish_spark_data_write(app, jazz, client.as_ref(), shell.as_ref(), &table).await;

	groove_ipc_jazz_get(app, jazz, self_state, table, id.to_string()).await
}

pub(crate) async fn groove_ipc_jazz_delete(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	table: String,
	id: String,
) -> Result<(), String> {
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let tbl = jazz_engine::resolved_table_schema(client.as_ref(), &table).await?;
	let uuid =
		uuid::Uuid::parse_str(&id).map_err(|e| format!("invalid UUID: {e}"))?;
	// See jazz_update: read across all known schema branches so the row's
	// `Object` is loaded into ObjectManager on every branch it lives on. Use
	// the interned `oid` from the query (never `ObjectId::from_uuid`).
	let (oid, row_vals) = jazz_engine::find_row_snapshot(client.as_ref(), &table, &tbl, uuid)
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
	let runtime_branch = jazz_engine::groove_write_branch_from_connected_schema_or_log(client.as_ref()).await;
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

pub(crate) async fn groove_ipc_jazz_subscribe(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	table: String,
) -> Result<(), String> {
	let _n = jazz.bump_table_ui_ref(&table).await;
	if table == "peers" {
		let client = with_connected_client(jazz, app, self_state).await?;
		let rows = crate::peers::list_peer_rows(client.as_ref()).await?;
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
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	let (snap, _) =
		jazz_engine::query_table_publish(client.as_ref(), &shell, &table, ENCRYPTED_META).await?;
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

pub(crate) async fn groove_ipc_jazz_unsubscribe(jazz: &ManagedJazz, table: String) -> Result<(), String> {
	jazz.drop_table_ui_ref(&table).await;
	Ok(())
}

/// Actor-only: assemble + emit mesh snapshot (no re-enqueue). Skips emit when JSON unchanged.
pub(crate) async fn execute_publish_mesh(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	ss: &SelfState,
) {
	if let Err(e) = publish_trusted_peers_ui(app, jazz, ss).await {
		log::debug!(
			target: "avenos::jazz",
			"execute_publish_mesh: {e}",
		);
	}
}

/// Actor-only: demo mesh UI snapshot for `meshStatus` IPC.
pub(crate) async fn execute_mesh_snapshot(
	_app: &tauri::AppHandle,
	_jazz: &ManagedJazz,
	_ss: &SelfState,
) -> Result<PeerMeshStatusReply, String> {
	Ok(crate::demo_mesh::demo_mesh_status_reply())
}

pub(crate) async fn execute_mesh_refresh_full(
	_app: &tauri::AppHandle,
	_jazz: &ManagedJazz,
) -> Result<u32, String> {
	Ok(0)
}

pub(crate) async fn groove_ipc_peer_list(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
) -> Result<Vec<crate::peers::PeerRowReply>, String> {
	let client = with_connected_client(jazz, app, self_state).await?;
	crate::peers::list_peer_rows(client.as_ref()).await
}

/// First-contact / pairing: add a trusted peer (device DID) to My Network.
pub(crate) async fn groove_ipc_peer_add(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	peer_did: String,
	device_label: String,
) -> Result<(), String> {
	let peer_did = peer_did.trim().to_string();
	if peer_did.is_empty() {
		return Err("peer_did is empty".into());
	}
	crate::jazz_auth::ed25519_public_from_peer_did(&peer_did)?;
	let client = with_connected_client(jazz, app, self_state).await?;
	let shell_arc = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
	if peer_did == shell_arc.as_ref().peer_did {
		return Err("cannot add your own DID as a peer".into());
	}
	crate::peers::add_remote_peer(client.as_ref(), &peer_did, &device_label).await
}

pub(crate) async fn groove_ipc_peer_revoke(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	peer_did: String,
) -> Result<(), String> {
	let client = with_connected_client(jazz, app, self_state).await?;
	crate::peers::set_peer_status(client.as_ref(), &peer_did, "revoked").await?;
	let _ = execute_mesh_refresh_full(app, jazz).await?;
	let _ = jazz.change_tx.send("peers".to_string());
	Ok(())
}

/// Multiplexed IPC: one entry for Groove session, tables, mesh, and peer admin.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrooveRuntimeEnvelope {
	pub op: String,
	#[serde(default)]
	pub payload: serde_json::Value,
}

fn pj_str(p: &serde_json::Value, key: &str) -> Result<String, String> {
	p.get(key)
		.and_then(|v| v.as_str())
		.map(|s| s.trim().to_string())
		.filter(|s| !s.is_empty())
		.ok_or_else(|| format!("groove_runtime: missing or empty string field `{key}`"))
}

pub(crate) async fn groove_runtime_dispatch(
	app: &tauri::AppHandle,
	_window: tauri::Window,
	mj: &ManagedJazz,
	ss: &SelfState,
	envelope: GrooveRuntimeEnvelope,
) -> Result<serde_json::Value, String> {
	let op = envelope.op.trim().to_ascii_lowercase();
	let pj = envelope.payload;

	match op.as_str() {
		"bootstrap" => serde_json::to_value(groove_ipc_bootstrap(app, mj, ss).await?).map_err(|e| e.to_string()),
		"status" => serde_json::to_value(groove_ipc_status(app, mj, ss).await?).map_err(|e| e.to_string()),
		"session" => serde_json::to_value(groove_ipc_session(app, mj, ss).await?).map_err(|e| e.to_string()),
		"list" => {
			let table = pj_str(&pj, "table")?;
			serde_json::to_value(groove_ipc_jazz_list(app, mj, ss, table).await?).map_err(|e| e.to_string())
		}
		"explorerlist" => {
			let table = pj_str(&pj, "table")?;
			serde_json::to_value(groove_ipc_jazz_explorer_list(app, mj, ss, table).await?)
				.map_err(|e| e.to_string())
		}
		"get" => {
			let table = pj_str(&pj, "table")?;
			let id = pj_str(&pj, "id")?;
			serde_json::to_value(groove_ipc_jazz_get(app, mj, ss, table, id).await?).map_err(|e| e.to_string())
		}
		"create" => {
			let table = pj_str(&pj, "table")?;
			let values: JsonRow = serde_json::from_value(
				pj.get("values")
					.cloned()
					.ok_or_else(|| "groove_runtime: missing `values`".to_string())?,
			)
			.map_err(|e| format!("groove_runtime: values: {e}"))?;
			serde_json::to_value(groove_ipc_jazz_create(app, mj, ss, table, values).await?)
				.map_err(|e| e.to_string())
		}
		"update" => {
			let table = pj_str(&pj, "table")?;
			let id = pj_str(&pj, "id")?;
			let patch: JsonRow = serde_json::from_value(
				pj.get("patch")
					.cloned()
					.ok_or_else(|| "groove_runtime: missing `patch`".to_string())?,
			)
			.map_err(|e| format!("groove_runtime: patch: {e}"))?;
			serde_json::to_value(groove_ipc_jazz_update(app, mj, ss, table, id, patch).await?)
				.map_err(|e| e.to_string())
		}
		"delete" => {
			let table = pj_str(&pj, "table")?;
			let id = pj_str(&pj, "id")?;
			groove_ipc_jazz_delete(app, mj, ss, table, id).await?;
			Ok(serde_json::Value::Null)
		}
		"subscribe" => {
			let table = pj_str(&pj, "table")?;
			groove_ipc_jazz_subscribe(app, mj, ss, table).await?;
			Ok(serde_json::Value::Null)
		}
		"unsubscribe" => {
			let table = pj_str(&pj, "table")?;
			groove_ipc_jazz_unsubscribe(mj, table).await?;
			Ok(serde_json::Value::Null)
		}
		"peermeshrefresh" => {
			serde_json::to_value(groove_ipc_peer_mesh_refresh(app, mj, ss).await?)
				.map_err(|e| e.to_string())
		}
		"meshstatus" => {
			let snap = execute_mesh_snapshot(app, mj, ss).await?;
			serde_json::to_value(snap).map_err(|e| e.to_string())
		}
		"peerlist" => serde_json::to_value(groove_ipc_peer_list(app, mj, ss).await?).map_err(|e| e.to_string()),
		"peeradd" => {
			let peer_did = pj_str(&pj, "peerDid")?;
			let label = pj
				.get("label")
				.and_then(|v| v.as_str())
				.unwrap_or("")
				.to_string();
			groove_ipc_peer_add(app, mj, ss, peer_did, label).await?;
			Ok(serde_json::Value::Null)
		}
		"peerrevoke" => {
			let peer_did = pj_str(&pj, "peerDid")?;
			groove_ipc_peer_revoke(app, mj, ss, peer_did).await?;
			Ok(serde_json::Value::Null)
		}
		"sparkadminadd" => {
			let spark_id = pj_str(&pj, "sparkId")?;
			let peer_did = pj_str(&pj, "peerDid")?;
			groove_ipc_spark_admin_add(app, mj, ss, spark_id, peer_did).await?;
			Ok(serde_json::Value::Null)
		}
		"sparkadminlist" => {
			let spark_id = pj_str(&pj, "sparkId")?;
			serde_json::to_value(groove_ipc_spark_admin_list(app, mj, ss, spark_id).await?)
				.map_err(|e| e.to_string())
		}
		"sparkadminrevoke" => {
			let spark_id = pj_str(&pj, "sparkId")?;
			let peer_did = pj_str(&pj, "peerDid")?;
			groove_ipc_spark_admin_revoke(spark_id, peer_did).await?;
			Ok(serde_json::Value::Null)
		}
		other => Err(format!(
			"groove_runtime: unknown op `{other}` — valid ops: bootstrap, status, session, list, explorerList, get, create, update, delete, subscribe, unsubscribe, peerMeshRefresh, meshStatus, peerList, peerAdd, peerRevoke, sparkAdminAdd, sparkAdminList, sparkAdminRevoke"
		)),
	}
}

#[tauri::command(rename_all = "camelCase")]
pub async fn groove_runtime(
	window: tauri::Window,
	_app: tauri::AppHandle,
	actor: tauri::State<'_, runtime::GrooveActorHandle>,
	op: String,
	payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
	let envelope = GrooveRuntimeEnvelope {
		op,
		payload: payload.unwrap_or_else(|| serde_json::json!({})),
	};
	actor.runtime_invoke(window, envelope).await
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfStoragePathsReply {
	pub root: String,
	pub app_base: String,
	pub db_dir: String,
	pub self_identity_dir: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn self_storage_paths(app: tauri::AppHandle) -> Result<SelfStoragePathsReply, String> {
	let app_base = tauri_plugin_self::paths::aven_os_app_base(&app)?;
	let app_base_str = app_base.to_string_lossy().into_owned();
	match vault_user_root(&app) {
		Ok(root) => {
			let db_dir = tauri_plugin_self::paths::db_dir(&root);
			let crypto_dir = tauri_plugin_self::paths::identity_crypto_dir(&root);
			Ok(SelfStoragePathsReply {
				root: root.to_string_lossy().into_owned(),
				app_base: app_base_str,
				db_dir: db_dir.to_string_lossy().into_owned(),
				self_identity_dir: crypto_dir.to_string_lossy().into_owned(),
			})
		}
		Err(_) => Ok(SelfStoragePathsReply {
			root: String::new(),
			app_base: app_base_str,
			db_dir: String::new(),
			self_identity_dir: String::new(),
		}),
	}
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

/// Lock, tear down Groove, and delete the entire `.avenOS` tree (all vaults, identity, schema cache).
#[tauri::command(rename_all = "camelCase")]
pub async fn self_clear_aven_os_data(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
) -> Result<(), String> {
	jazz.reset_connection().await;

	let self_state: tauri::State<'_, SelfState> = app.state();
	self_state.clear();
	let vault: tauri::State<'_, ActiveVault> = app.state();
	vault.clear()?;
	let _ = app.emit("self:did-lock", ());

	let base = tauri_plugin_self::paths::aven_os_app_base(&app)?;
	if base.exists() {
		fs::remove_dir_all(&base).map_err(|e| format!("remove {}: {e}", base.display()))?;
	}
	Ok(())
}

#[cfg(test)]
mod json_cell_tests {
	use super::*;
	use groove::query_manager::types::ColumnType;
	use serde_json::json;

	#[test]
	fn json_cell_to_jazz_bytea_standard_base64() {
		let cell = json!("aGVsbG8=");
		let v = json_cell_to_jazz(&cell, &ColumnType::Bytea, false).unwrap();
		assert_eq!(v, Value::Bytea(b"hello".to_vec()));
	}

	#[test]
	fn json_cell_to_jazz_phase1_and_sealed_bytea_stay_bytea() {
		let phase1 = json!(PHASE1_SECRET_PLACEHOLDER);
		let v = json_cell_to_jazz(&phase1, &ColumnType::Bytea, false).unwrap();
		assert_eq!(v, Value::Bytea(PHASE1_SECRET_PLACEHOLDER.as_bytes().to_vec()));

		let sealed = format!("{}abc", crate::crypto::CELL_ENVELOPE_V1);
		let v = json_cell_to_jazz(&json!(sealed), &ColumnType::Bytea, false).unwrap();
		assert!(matches!(v, Value::Bytea(b) if b.starts_with(crate::crypto::CELL_ENVELOPE_V1.as_bytes())));
	}

	#[test]
	fn sealed_bytea_canonical_roundtrip_ipc() {
		use base64::Engine;
		use crate::crypto::{
			groove_value_to_canonical_utf8, ipc_json_from_opened_sensitive_plaintext,
		};
		let payload = b"fake-image-bytes".to_vec();
		let canon = groove_value_to_canonical_utf8(&Value::Bytea(payload.clone())).unwrap();
		let ipc = ipc_json_from_opened_sensitive_plaintext(&canon, &ColumnType::Bytea).unwrap();
		let b64 = ipc.as_str().expect("bytea ipc is base64 string");
		assert_eq!(
			base64::engine::general_purpose::STANDARD.decode(b64).unwrap(),
			payload,
		);
	}

	#[test]
	fn json_cell_to_jazz_double_batch_id_enum() {
		let d = json_cell_to_jazz(&json!(1.5), &ColumnType::Double, false).unwrap();
		assert_eq!(d, Value::Double(1.5));

		let bid = json_cell_to_jazz(
			&json!("0102030405060708090a0b0c0d0e0f10"),
			&ColumnType::BatchId,
			false,
		)
		.unwrap();
		assert_eq!(bid, Value::BatchId([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));

		let en = ColumnType::Enum {
			variants: vec!["a".into(), "b".into()],
		};
		let v = json_cell_to_jazz(&json!("a"), &en, false).unwrap();
		assert_eq!(v, Value::Text("a".into()));
	}

	#[test]
	fn json_cell_to_jazz_json_column() {
		let cell = json!({"k": 1});
		let v = json_cell_to_jazz(&cell, &ColumnType::Json { schema: None }, false).unwrap();
		assert_eq!(v, Value::Text(r#"{"k":1}"#.into()));
	}

	#[test]
	fn json_cell_to_jazz_rejects_row_type() {
		let row_ty = ColumnType::Row {
			columns: Box::new(groove::query_manager::types::RowDescriptor::new(vec![])),
		};
		let err = json_cell_to_jazz(&json!([]), &row_ty, false).unwrap_err();
		assert!(err.contains("engine-only"));
	}

	#[test]
	fn json_cell_to_jazz_sealed_bigint_stored_as_text() {
		let sealed = format!("{}abc", crate::crypto::CELL_ENVELOPE_V1);
		let v = json_cell_to_jazz(&json!(sealed), &ColumnType::Text, false).unwrap();
		assert!(matches!(v, Value::Text(s) if s.starts_with(crate::crypto::CELL_ENVELOPE_V1)));
	}

	#[test]
	fn sealed_bigint_canonical_roundtrip_ipc() {
		use crate::crypto::{groove_value_to_canonical_utf8, ipc_json_from_opened_sensitive_plaintext};
		let canon = groove_value_to_canonical_utf8(&Value::BigInt(1_704_000_000_000)).unwrap();
		let ipc = ipc_json_from_opened_sensitive_plaintext(&canon, &ColumnType::Text).unwrap();
		assert_eq!(ipc.as_i64(), Some(1_704_000_000_000));
	}
}

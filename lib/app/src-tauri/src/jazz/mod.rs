//! Generic Jazz CRUD over Tauri IPC. Schema mirrors `libs/jazz-schema/schema.manifest.json`.

pub(crate) mod jazz_engine;
pub mod runtime;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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

/// Tables that change vault biscuits / P2P ACL; everything else can reuse a cached shell.
const VAULT_SHELL_TABLES: &[&str] = &["sparks", "keyshares", "peers"];

pub struct ManagedJazz {
	conn: Mutex<JazzConn>,
	/// Webview `subscribe` ref-count per table — drives [`Self::snapshot_broadcast`] + `avenos:runtime` `{ kind: "table" }`.
	table_ui_refs: Mutex<HashMap<String, u32>>,
	shell: Mutex<Option<std::sync::Arc<jazz_engine::ShellState>>>,
	/// Serializes full `hydrate_shell` so parallel IPC does not stampede.
	shell_hydrate: Mutex<()>,
	/// When false, [`jazz_shell_ready`] may return the cached shell (todos CRUD, drain, etc.).
	shell_vault_stale: AtomicBool,
	/// Groove peers registered this Jazz session (`register_peer_sync_client` once each).
	mesh_groove_registered: Mutex<HashSet<ClientId>>,
	/// Bumped on every Groove client replace/reset so background tasks never touch a stale `Arc`.
	conn_epoch: AtomicU64,
	/// Opens after [`jazz_shell_ready`] succeeds (cached or hydrated). Hyperswarm/mesh work must wait.
	mesh_local_shell_gate: AtomicBool,
	/// One Groove catch-up rebroadcast per conn epoch (not per shell invalidation).
	mesh_acl_rebroadcast_done: AtomicBool,
	/// Shared with [`BiscuitGatedPeerTransport`] — spark biscuit snapshot for outbound sync policy.
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
			mesh_groove_registered: Mutex::new(HashSet::new()),
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

/// Runs one coalesced drain batch on the Groove actor (serialization + shell hydrate + snapshots).
pub(crate) async fn execute_drain_batch(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	mut pending: std::collections::HashSet<String>,
) {
	if pending
		.iter()
		.any(|t| VAULT_SHELL_TABLES.contains(&t.as_str()))
	{
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

	if pending.is_empty() {
		return;
	}

	if !jazz.any_ui_subscriber(&pending).await {
		log::trace!(
			target: "avenos::jazz",
			"table-change drain: no UI subscribers for {} table(s), skip",
			pending.len(),
		);
		return;
	}

	let client = match with_connected_client(jazz, app, self_state).await {
		Ok(c) => c,
		Err(_) => return,
	};
	let shell = match jazz_shell_ready(app, jazz, self_state, client.clone()).await {
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

		let actor = app.state::<crate::jazz::runtime::GrooveActorHandle>();
		if let Err(e) = actor.enqueue_drain(pending).await {
			log::warn!(
				target: "avenos::jazz",
				"table-change drain: failed to enqueue batch on groove actor: {e}",
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
		#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
		crate::peer_catchup::notify_jazz_connection_teardown(app).await;
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
				#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
				crate::peer_catchup::notify_jazz_connection_teardown(app).await;
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

	fn conn_epoch_is(&self, epoch: u64) -> bool {
		self.conn_epoch.load(Ordering::Acquire) == epoch
	}

	pub(crate) fn groove_conn_epoch(&self) -> u64 {
		self.conn_epoch.load(Ordering::Acquire)
	}

	pub(crate) fn groove_conn_epoch_is(&self, epoch: u64) -> bool {
		self.conn_epoch_is(epoch)
	}

	pub(crate) async fn groove_clone_connected_client(&self) -> Option<Arc<JazzClient>> {
		self.conn.lock().await.client.clone()
	}

	fn invalidate_vault_shell(&self) {
		self.shell_vault_stale.store(true, Ordering::Release);
		self.last_table_snapshots
			.write()
			.expect("last_table_snapshots poisoned")
			.clear();
		// Keep sync_acl until re-hydrate replaces it — clearing it re-triggers catch-up rebroadcast storms.
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
			self.mesh_groove_registered.lock().await.clear();
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
	rows: Vec<crate::peers::PeerRowReply>,
) -> Result<(), String> {
	#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
	let snap = crate::peer_mesh_state::assemble_mesh_snapshot(app, jazz, rows).await?;
	#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "ios")))]
	let snap = {
		let _ = rows;
		crate::peer_mesh_state::PeerMeshStatusReply {
			hyperswarm_running: false,
			hyperswarm_start_error: None,
			local_pk_prefix_hex: String::new(),
			pairing_code_pending: None,
			p2p_diagnostics: tauri_plugin_peer::P2pDiagnostics {
				central_mode: false,
				dht_bootstrap: String::new(),
				joined_topic_count: 0,
				allowlist_count: 0,
				linked_count: 0,
				pairing_session_active: false,
				pairing_topic_hex: None,
				relay_https_probe: None,
				dht_bootstrap_closest_seen: None,
				last_path_change_at_ms: None,
				last_foreground_heal_at_ms: None,
				heal_in_progress: false,
				prefer_lan: true,
				network_interfaces: vec![],
			},
			peers: vec![],
		}
	};

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
	crate::peer_mesh_state::emit_mesh_snapshot_events(app, &snap);
	Ok(())
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
	let live_schemas =
		reconcile_jazz_identity_cache_dir(&data_dir, deterministic, &groove_hash, &schema)?;

	let ctx = AppContext {
		app_id: AppId::from_name("ceo.aven.os"),
		client_id: Some(ClientId(deterministic)),
		schema: schema.clone(),
		live_schemas,
		server_url: String::new(),
		data_dir: data_dir.clone(),
		jwt_token: None,
		backend_secret: None,
		admin_secret: None,
	};

	#[cfg(any(target_os = "macos", target_os = "ios"))]
	{
		use std::sync::Arc;

		let bridge = app.state::<tauri_plugin_peer::HyperswarmGrooveBridge>();
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
		crate::schema_migrations::stamp_current_vault_snapshot(&data_dir, &schema)?;
		return Ok(client);
	}

	#[cfg(not(any(target_os = "macos", target_os = "ios")))]
	{
		let client = JazzClient::connect(ctx).await.map_err(format_jazz_err)?;
		crate::schema_migrations::stamp_current_vault_snapshot(&data_dir, &schema)?;
		Ok(client)
	}
}

/// Flip shell gate; enqueue one mesh reconcile (same path as periodic tick — Hyperswarm allowlist + register).
#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
fn mark_shell_local_ready_for_mesh(app: &tauri::AppHandle, mj: &ManagedJazz) {
	mj.mesh_local_shell_gate.store(true, Ordering::Release);
	let app = app.clone();
	tauri::async_runtime::spawn(async move {
		let _ = peer_mesh_reconcile_tick(&app, true).await;
	});
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "ios")))]
fn mark_shell_local_ready_for_mesh(_app: &tauri::AppHandle, mj: &ManagedJazz) {
	mj.mesh_local_shell_gate.store(true, Ordering::Release);
}

async fn jazz_shell_ready(
	app: &tauri::AppHandle,
	mj: &ManagedJazz,
	self_state: &SelfState,
	client: Arc<JazzClient>,
) -> Result<std::sync::Arc<jazz_engine::ShellState>, String> {
	if !mj.shell_vault_stale.load(Ordering::Acquire) {
		if let Some(cached) = mj.shell.lock().await.clone() {
			mark_shell_local_ready_for_mesh(app, mj);
			return Ok(cached);
		}
	}

	let _hydrate_guard = mj.shell_hydrate.lock().await;
	if !mj.shell_vault_stale.load(Ordering::Acquire) {
		if let Some(cached) = mj.shell.lock().await.clone() {
			mark_shell_local_ready_for_mesh(app, mj);
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
	let snap = peer_sync_gate::load_acl_snapshot(&arc.vault, object_spark_ids)?;
	*mj.sync_acl.write().expect("sync_acl poisoned") = Some(snap);
	// One catch-up rebroadcast per conn epoch — not on every vault-table invalidation reload.
	let first_acl_catchup = !mj.mesh_acl_rebroadcast_done.swap(true, Ordering::AcqRel);
	if first_acl_catchup {
		#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
		{
			let bridge = app.state::<tauri_plugin_peer::HyperswarmGrooveBridge>();
			let live_n = bridge.snapshot_remote_clients().await.len();
			let h = app.state::<crate::peer_catchup::PeerCatchupHandle>();
			h.on_shell_acl_first_loaded_prepare_catchup().await;
			if live_n == 0 {
				log::debug!(
					target: "avenos::jazz",
					"sync_acl ready (catch-up deferred — no live P2P link yet)",
				);
			} else {
				log::debug!(
					target: "avenos::jazz",
					"sync_acl ready (acl bootstrap queued for {live_n} live link(s))",
				);
			}
			bridge.peer_set_changed_notify().notify_waiters();
		}
		publish_peer_mesh_after_acl(app).await;
	}
	mark_shell_local_ready_for_mesh(app, mj);
	Ok(arc)
}

#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
async fn publish_peer_mesh_after_acl(app: &tauri::AppHandle) {
	crate::peer_mesh_state::publish_peer_mesh_snapshot(app).await;
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "ios")))]
async fn publish_peer_mesh_after_acl(_app: &tauri::AppHandle) {}

/// Load biscuit sync ACL once; mesh reconcile must not re-run full `hydrate_shell` every tick.
async fn ensure_sync_acl_for_mesh(
	app: &tauri::AppHandle,
	mj: &ManagedJazz,
	self_state: &SelfState,
	client: Arc<JazzClient>,
) -> Result<(), String> {
	if mj
		.sync_acl
		.read()
		.expect("sync_acl poisoned")
		.is_some()
	{
		return Ok(());
	}
	let _ = jazz_shell_ready(app, mj, self_state, client.clone()).await?;
	Ok(())
}

pub(crate) async fn groove_ipc_status(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
) -> Result<JazzStatusReply, String> {
	if !self_state.is_unlocked() {
		#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
		crate::peer_catchup::notify_jazz_connection_teardown(app).await;
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
			#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
			crate::peer_catchup::notify_jazz_connection_teardown(app).await;
			jazz.reset_connection().await;
		}
		return Ok(JazzStatusReply {
			ready: false,
			tables: vec![],
		});
	}

	let client = match jc.client.clone() {
		Some(c) => c,
		None => {
			return Ok(JazzStatusReply {
				ready: false,
				tables: vec![],
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
	})
}

pub(crate) async fn groove_ipc_bootstrap(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
) -> Result<JazzStatusReply, String> {
	let client = with_connected_client(jazz, app, self_state).await?;
	let sch = client.schema().await.map_err(format_jazz_err)?;
	let mut tables: Vec<String> = sch.keys().map(|k| k.to_string()).collect();
	tables.sort();

	match jazz_shell_ready(app, jazz, self_state, client).await {
		Ok(shell) => {
			emit_avenos_runtime(app, serde_json::json!({
				"kind": "session",
				"phase": "ready",
				"grooveReady": true,
				"peerDid": shell.peer_did,
				"defaultSparkUrn": jazz_engine::spark_urn(shell.default_spark),
				"tables": tables.clone(),
			}));
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

/// Re-register Groove P2P sync clients + Hyperswarm allowlist + per-pair topics after the peer table changes.
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub(crate) async fn groove_ipc_peer_mesh_refresh(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
) -> Result<JazzPeerMeshRefreshReply, String> {
	if !self_state.is_unlocked() {
		return Ok(JazzPeerMeshRefreshReply {
			registered_count: 0,
		});
	}
	let _ = with_connected_client(jazz, app, self_state).await?;
	let n = execute_mesh_refresh_full(app, jazz).await?;
	Ok(JazzPeerMeshRefreshReply {
		registered_count: n,
	})
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub(crate) async fn groove_ipc_peer_mesh_refresh() -> Result<JazzPeerMeshRefreshReply, String> {
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
		jazz.invalidate_vault_shell();
		let _shell = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;
		flush_spark_grant_to_peers(app, client.as_ref(), spark_uuid).await;
		let _ = jazz.change_tx.send("sparks".to_string());
		let _ = jazz.change_tx.send("keyshares".to_string());
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
			"wrapped_dek".into(),
			JsonValue::String(wrapped),
		);
		let ks_vals = insert_values(&ks_schema, ks)?;
		client
			.create("keyshares", ks_vals)
			.await
			.map_err(format_jazz_err)?;
	}

	// Re-hydrate shell + refresh outbound sync ACL **before** Groove tries to push
	// sparks/keyshares deltas — otherwise `peer_sync_gate` still sees the pre-grant
	// biscuit and drops every frame to the new admin.
	jazz.invalidate_vault_shell();
	let _shell = jazz_shell_ready(app, jazz, self_state, client.clone()).await?;

	flush_spark_grant_to_peers(app, client.as_ref(), spark_uuid).await;

	let _ = jazz.change_tx.send("sparks".to_string());
	let _ = jazz.change_tx.send("keyshares".to_string());

	Ok(())
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
async fn flush_spark_grant_to_peers(
	app: &tauri::AppHandle,
	client: &JazzClient,
	spark_uuid: uuid::Uuid,
) {
	use tauri_plugin_peer::HyperswarmGrooveBridge;

	let h = app.state::<crate::peer_catchup::PeerCatchupHandle>();
	h.on_spark_access_granted().await;

	let bridge = app.state::<HyperswarmGrooveBridge>();
	let live_links = app.state::<std::sync::Arc<tauri_plugin_peer::PeerLinkCoordinator>>();
	let live = live_links.snapshot_mux_ready_clients().await;
	if live.is_empty() {
		log::info!(
			target: "avenos::jazz",
			"spark_admin_add: grant saved for spark {spark_uuid}; catch-up queued for next live link",
		);
		return;
	}
	let send_ready = {
		let mut ok = false;
		for cid in &live {
			if bridge.peer_send_ready(*cid).await {
				ok = true;
				break;
			}
		}
		ok
	};
	if !send_ready {
		log::info!(
			target: "avenos::jazz",
			"spark_admin_add: grant saved for spark {spark_uuid}; catch-up queued until Groove mux send-ready",
		);
		return;
	}
	match client.rebroadcast_all_peer_clients_and_flush().await {
		Ok(()) => log::info!(
			target: "avenos::jazz",
			"spark_admin_add: ACL catch-up flushed to peer(s) for spark {spark_uuid}",
		),
		Err(e) => log::warn!(
			target: "avenos::jazz",
			"spark_admin_add: peer catch-up flush failed: {e}",
		),
	}
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
async fn flush_spark_grant_to_peers(
	_app: &tauri::AppHandle,
	_client: &JazzClient,
	_spark_uuid: uuid::Uuid,
) {
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
		let vals = insert_values(&tbl, values)?;
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
	let n = jazz.bump_table_ui_ref(&table).await;
	if n != 1 {
		return Ok(());
	}
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

/// Groove Jazz sync registration + outbound catch-up (Hyperswarm allowlist/topics in [`PeerCtl`];
/// coalesced flushes via [`crate::peer_catchup`]).
#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
pub(crate) async fn refresh_peer_mesh_groove_register_primitives(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	client: Arc<JazzClient>,
	allow: &[String],
	nudge_discovery_if_no_live_links: bool,
) -> Result<u32, String> {
	use std::sync::Arc;

	let peer_ctl = app.state::<Arc<tauri_plugin_peer::PeerCtl>>();
	let self_state: tauri::State<'_, SelfState> = app.state();
	let bridge = app.state::<tauri_plugin_peer::HyperswarmGrooveBridge>();
	let peer_catchup = app.state::<crate::peer_catchup::PeerCatchupHandle>();

	if ensure_sync_acl_for_mesh(app, jazz, &self_state, Arc::clone(&client))
		.await
		.is_err()
	{
		log::debug!(
			target: "avenos::jazz",
			"peer-mesh reconcile: sync_acl not ready yet, deferring Groove register",
		);
		return Ok(0);
	}

	let live_links = app.state::<std::sync::Arc<tauri_plugin_peer::PeerLinkCoordinator>>();
	let live: HashSet<ClientId> = live_links
		.snapshot_mux_ready_clients()
		.await
		.into_iter()
		.collect();

	if nudge_discovery_if_no_live_links && !allow.is_empty() {
		if let Err(e) = peer_ctl.nudge_allowlisted_discovery(allow).await {
			log::debug!(
				target: "avenos::jazz",
				"peer-mesh nudge discovery: {e}",
			);
		}
	}

	let mut n = 0u32;
	let m = bridge.shared_client_id_to_did();
	let per_live_did: Vec<(ClientId, String)> = {
		let g = m.read().expect("cid map poisoned");
		live.iter()
			.filter_map(|p| g.get(p).cloned().map(|d| (*p, d)))
			.filter(|(_, did)| allow.iter().any(|a| a == did))
			.collect()
	};

	let mut allow_live = HashSet::new();

	for (p, did) in &per_live_did {
		if !bridge.peer_send_ready(*p).await {
			continue;
		}
		allow_live.insert(*p);

		let mut registered = jazz.mesh_groove_registered.lock().await;
		// Same ClientId (pubkey-derived) after transport upgrade — skip re-register / catch-up reset.
		if !registered.contains(p) {
			match client.register_peer_sync_client(*p) {
				Ok(()) => {
					n += 1;
					registered.insert(*p);
					log::info!(
						target: "avenos::jazz",
						"register_peer_sync_client ok peer={p:?} did={did}",
					);
					drop(registered);
					peer_catchup.on_peer_registered(*p).await;
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

	if n > 0 {
		log::info!(target: "avenos::jazz", "peer-mesh reconcile: {n} new Groove peer(s)");
	}

	peer_catchup.sync_allowlisted_live(allow_live).await;

	crate::peer_mesh_state::publish_peer_mesh_snapshot(app).await;

	Ok(n)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "ios")))]
pub(crate) async fn refresh_peer_mesh_groove_register_primitives(
	_app: &tauri::AppHandle,
	_jazz: &ManagedJazz,
	_client: Arc<JazzClient>,
	_allow: &[String],
	_nudge_discovery_if_no_live_links: bool,
) -> Result<u32, String> {
	Ok(0)
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

/// Actor-only: mesh UI snapshot from conn + transport state.
pub(crate) async fn execute_mesh_snapshot(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	ss: &SelfState,
) -> Result<crate::peer_mesh_state::PeerMeshStatusReply, String> {
	let db_rows = if ss.is_unlocked() {
		let jc = jazz.conn.lock().await;
		if let Some(client) = jc.client.clone() {
			crate::peers::list_peer_rows(client.as_ref()).await?
		} else {
			vec![]
		}
	} else {
		vec![]
	};

	#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
	{
		crate::peer_mesh_state::assemble_mesh_snapshot(app, jazz, db_rows).await
	}
	#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "ios")))]
	{
		let _ = (app, jazz, db_rows);
		Ok(crate::peer_mesh_state::PeerMeshStatusReply {
			hyperswarm_running: false,
			hyperswarm_start_error: None,
			local_pk_prefix_hex: String::new(),
			pairing_code_pending: None,
			p2p_diagnostics: tauri_plugin_peer::P2pDiagnostics {
				central_mode: false,
				dht_bootstrap: String::new(),
				joined_topic_count: 0,
				allowlist_count: 0,
				linked_count: 0,
				pairing_session_active: false,
				pairing_topic_hex: None,
				relay_https_probe: None,
				dht_bootstrap_closest_seen: None,
				last_path_change_at_ms: None,
				last_foreground_heal_at_ms: None,
				heal_in_progress: false,
				prefer_lan: true,
				network_interfaces: vec![],
			},
			peers: vec![],
		})
	}
}

/// Actor-only: full Hyperswarm allowlist sync + Groove register path.
#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
pub(crate) async fn execute_mesh_refresh_full(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
) -> Result<u32, String> {
	use std::sync::Arc;

	let self_state: tauri::State<'_, SelfState> = app.state();
	if !self_state.is_unlocked() {
		return Ok(0);
	}

	let peer_ctl = app.state::<Arc<tauri_plugin_peer::PeerCtl>>();
	let root = self_state
		.with_root(|r| Ok(*r))
		.map_err(|_| "locked: unlock identity first".to_string())?;
	let pk = ed25519_public(&root)?;
	let local_did = crate::jazz_auth::peer_did_from_ed25519(&pk)?;

	let (client, allow) = {
		let jc = jazz.conn.lock().await;
		let Some(client) = jc.client.clone() else {
			return Ok(0);
		};
		let allow = crate::peers::list_active_peer_dids(client.as_ref()).await?;
		(client, allow)
	};

	peer_ctl
		.sync_allowlist_from_peer_table(&local_did, &allow)
		.await?;

	if !jazz.mesh_local_shell_gate.load(Ordering::Acquire) {
		execute_publish_mesh(app, jazz, self_state.inner()).await;
		return Ok(0);
	}

	refresh_peer_mesh_groove_register_primitives(app, jazz, client, &allow, true).await
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "ios")))]
pub(crate) async fn execute_mesh_refresh_full(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
) -> Result<u32, String> {
	let ss = app.state::<SelfState>();
	execute_publish_mesh(app, jazz, ss.inner()).await;
	Ok(0)
}

/// Actor-only: periodic reconcile tick (Groove register + optional DHT nudge).
#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
pub(crate) async fn execute_mesh_reconcile(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	nudge_discovery: bool,
) -> Result<(), String> {
	use std::sync::Arc;

	let self_state = app.state::<SelfState>();
	if !self_state.is_unlocked() {
		return Ok(());
	}

	let peer_ctl = app.state::<Arc<tauri_plugin_peer::PeerCtl>>();

	if peer_ctl
		.peer_transport_status()
		.await
		.pairing_code_pending
		.is_some()
	{
		let _ = peer_ctl.nudge_pairing_discovery().await;
		execute_publish_mesh(app, jazz, self_state.inner()).await;
	}

	if !jazz.mesh_local_shell_gate.load(Ordering::Acquire) {
		return Ok(());
	}

	let Some(client) = ({
		let jc = jazz.conn.lock().await;
		jc.client.clone()
	}) else {
		return Ok(());
	};

	let allow = crate::peers::list_active_peer_dids(client.as_ref()).await?;

	let root = self_state
		.with_root(|r| Ok(*r))
		.map_err(|_| "locked: unlock AvenOS identity first".to_string())?;
	let pk = ed25519_public(&root)?;
	let local_did = crate::jazz_auth::peer_did_from_ed25519(&pk)?;

	peer_ctl
		.sync_allowlist_from_peer_table(&local_did, &allow)
		.await?;

	if nudge_discovery && !allow.is_empty() {
		peer_ctl.nudge_allowlisted_discovery(&allow).await?;
	}

	if nudge_discovery {
		if let Err(e) = peer_ctl.maybe_probe_transport_upgrades().await {
			log::debug!(target: "avenos::jazz", "transport upgrade probe: {e}");
		}
	}

	let _ = refresh_peer_mesh_groove_register_primitives(app, jazz, client, &allow, false).await?;
	execute_publish_mesh(app, jazz, self_state.inner()).await;
	Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "ios")))]
pub(crate) async fn execute_mesh_reconcile(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	_nudge_discovery: bool,
) -> Result<(), String> {
	let ss = app.state::<SelfState>();
	execute_publish_mesh(app, jazz, ss.inner()).await;
	Ok(())
}

/// Enqueue mesh refresh on the Groove actor (safe from any thread/task).
pub(crate) async fn refresh_peer_mesh_primitives(app: &tauri::AppHandle) -> Result<u32, String> {
	runtime::groove_actor(app).mesh_refresh().await
}

/// Enqueue mesh reconcile on the Groove actor.
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub(crate) async fn peer_mesh_reconcile_tick(
	app: &tauri::AppHandle,
	nudge_discovery: bool,
) -> Result<(), String> {
	runtime::groove_actor(app)
		.mesh_reconcile(nudge_discovery)
		.await
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub(crate) async fn peer_mesh_reconcile_tick(
	app: &tauri::AppHandle,
	nudge_discovery: bool,
) -> Result<(), String> {
	runtime::groove_actor(app)
		.mesh_reconcile(nudge_discovery)
		.await
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

/// Actor-only: persist paired peer row + refresh mesh.
pub(crate) async fn execute_apply_peer_invite(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	ss: &SelfState,
	payload: &str,
) -> Result<(), String> {
	let p: PeerInvitePairedPayload =
		serde_json::from_str(payload).map_err(|e| format!("peer:invite-paired json: {e}"))?;
	let client = with_connected_client(jazz, app, ss).await?;
	let device_label = peer_invite_device_label(&p, &p.remote_did);
	crate::peers::upsert_remote_peer_row(client.as_ref(), &p.remote_did, &device_label, "active")
		.await?;

	#[cfg(any(target_os = "macos", target_os = "ios"))]
	{
		use std::sync::Arc;

		let self_state: tauri::State<'_, SelfState> = app.state();
		let root = self_state
			.with_root(|r| Ok(*r))
			.map_err(|_| "locked: unlock identity first".to_string())?;
		let pk = ed25519_public(&root)?;
		let local_did = crate::jazz_auth::peer_did_from_ed25519(&pk)?;
		let allow =
			crate::peers::list_active_peer_dids(client.as_ref()).await?;
		let ctl = app.state::<Arc<tauri_plugin_peer::PeerCtl>>();
		let _ = ctl.peer_invite_cancel().await;
		ctl.sync_allowlist_from_peer_table_deferred_flush(&local_did, &allow)
			.await?;
		ctl.schedule_post_pairing_mesh_refresh(p.remote_did.clone());
		let _ = execute_publish_mesh(app, jazz, ss).await;
	}

	#[cfg(not(any(target_os = "macos", target_os = "ios")))]
	{
		let _ = execute_mesh_refresh_full(app, jazz).await?;
	}
	let _ = jazz.change_tx.send("peers".to_string());
	log::info!(
		target: "avenos::jazz",
		"peer:invite-paired persisted did={} label={device_label}",
		p.remote_did,
	);
	Ok(())
}

pub(crate) async fn apply_peer_invite_paired(
	app: &tauri::AppHandle,
	payload: &str,
) -> Result<(), String> {
	runtime::groove_actor(app)
		.apply_peer_invite(payload.to_string())
		.await
}

pub(crate) async fn groove_ipc_peer_list(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
) -> Result<Vec<crate::peers::PeerRowReply>, String> {
	let client = with_connected_client(jazz, app, self_state).await?;
	crate::peers::list_peer_rows(client.as_ref()).await
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
		#[cfg(any(target_os = "macos", target_os = "ios"))]
		"peermeshrefresh" => {
			serde_json::to_value(groove_ipc_peer_mesh_refresh(app, mj, ss).await?)
				.map_err(|e| e.to_string())
		}
		#[cfg(not(any(target_os = "macos", target_os = "ios")))]
		"peermeshrefresh" => {
			serde_json::to_value(groove_ipc_peer_mesh_refresh().await?).map_err(|e| e.to_string())
		}
		"meshstatus" => {
			let snap = execute_mesh_snapshot(app, mj, ss).await?;
			serde_json::to_value(snap).map_err(|e| e.to_string())
		}
		"peerlist" => serde_json::to_value(groove_ipc_peer_list(app, mj, ss).await?).map_err(|e| e.to_string()),
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
			"groove_runtime: unknown op `{other}` — valid ops: bootstrap, status, session, list, explorerList, get, create, update, delete, subscribe, unsubscribe, peerMeshRefresh, meshStatus, peerList, peerRevoke, sparkAdminAdd, sparkAdminList, sparkAdminRevoke"
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
			let db_dir = root.join(AVEN_OS_GROOVE_DATA_DIR);
			let self_identity_dir = root.join("self");
			Ok(SelfStoragePathsReply {
				root: root.to_string_lossy().into_owned(),
				app_base: app_base_str,
				db_dir: db_dir.to_string_lossy().into_owned(),
				self_identity_dir: self_identity_dir.to_string_lossy().into_owned(),
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
	#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
	crate::peer_catchup::notify_jazz_connection_teardown(&app).await;
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
	#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
	crate::peer_catchup::notify_jazz_connection_teardown(&app).await;
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

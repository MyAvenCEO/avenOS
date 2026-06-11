//! Connection / lifecycle / data-dir management for the avenDB-backed AvenDb client.

use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use aven_db::{
	query_manager::types::{ComposedBranchName, SchemaHash, TableName},
	PeerId,
	AvenDbClient,
	AvenDbError,
	QueryBuilder,
};
use crate::identity_sync::{self, SyncAclSnapshot};
use serde_json::{Map, Value as JsonValue};
use tauri::Manager;
use tauri_plugin_self::derive::ed25519_public;
use tauri_plugin_self::state::SelfState;
use tauri_plugin_self::vault::ActiveVault;
use tokio::sync::{Mutex, Notify};
use uuid::Uuid;

use super::*;

pub(super) fn vault_user_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
	let v = app.state::<ActiveVault>();
	tauri_plugin_self::paths::aven_os_user_root(app, &*v)
}

pub type JsonRow = Map<String, JsonValue>;

pub(crate) const PHASE1_SECRET_PLACEHOLDER: &str = "\u{feff}";
pub(crate) const ENCRYPTED_META: &str = "_encryptedColumns";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvenDbStatusReply {
	pub ready: bool,
	pub tables: Vec<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub session: Option<AvenDbSessionReply>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub message: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvenDbSessionReply {
	pub signer_did: String,
	pub signer_did_short: String,
	pub default_spark_urn: String,
	/// did:key of the aven-node relay this device is synced through, if any —
	/// lets the UI offer a one-click "replicate this identity to the relay".
	pub relay_did: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvenDbPeerMeshRefreshReply {
	pub registered_count: u32,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvenDbExplorerListReply {
	pub rows: Vec<JsonRow>,
	pub skipped_unauthorized_rows: usize,
}

/// avenDB-backed AvenDb client lifecycle. Clearing on lock / fingerprint mismatch avoids serving
/// a stale SurrealKV view after `SelfState` changes.
pub(super) struct AvenDbConn {
	pub(super) client: Option<Arc<AvenDbClient>>,
	/// Device root → avenDB [`PeerId`](aven_db::PeerId) UUID; `Some` iff `client` is populated.
	pub(super) linked_identity: Option<Uuid>,
}

impl Default for AvenDbConn {
	fn default() -> Self {
		Self {
			client: None,
			linked_identity: None,
		}
	}
}

pub struct ManagedAvenDb {
	pub(super) conn: Mutex<AvenDbConn>,
	/// Webview `subscribe` ref-count per table — drives [`Self::snapshot_broadcast`] + `avenos:runtime` `{ kind: "table" }`.
	table_ui_refs: Mutex<HashMap<String, u32>>,
	pub(super) shell: Mutex<Option<std::sync::Arc<engine::ShellState>>>,
	/// Serializes full `hydrate_shell` so parallel IPC does not stampede.
	pub(super) shell_hydrate: Mutex<()>,
	/// When false, [`avendb_shell_ready`] may return the cached shell (todos CRUD, drain, etc.).
	pub(super) shell_vault_stale: AtomicBool,
	/// Bumped on every avenDB client replace/reset so background tasks never touch a stale `Arc`.
	conn_epoch: AtomicU64,
	/// Opens after [`avendb_shell_ready`] succeeds (cached or hydrated). Hyperswarm/mesh work must wait.
	pub(super) mesh_local_shell_gate: AtomicBool,
	/// One avenDB catch-up rebroadcast per conn epoch (not per shell invalidation).
	pub(super) mesh_acl_rebroadcast_done: AtomicBool,
	/// Identity biscuit snapshot for outbound sync policy.
	pub(crate) sync_acl: Arc<RwLock<Option<SyncAclSnapshot>>>,
	/// Std-lock mirror of the hydrated shell (biscuit vault) for the sync gate.
	/// `BiscuitCapabilityResolver` reads this synchronously on the engine tick
	/// thread (the primary `shell` is a tokio Mutex, unusable from sync code).
	pub(crate) sync_shell: Arc<RwLock<Option<std::sync::Arc<engine::ShellState>>>>,
	/// did:key of the aven-node relay this device is currently synced through
	/// (the authenticated peer from the TLS handshake), or `None` when local-only.
	/// Surfaced to the UI so a identity can grant it `replicate` with one click —
	/// no copying the DID out of the server's logs.
	pub(crate) connected_relay_did: Arc<RwLock<Option<String>>>,
	/// MPSC sender for **all** UI-facing table deltas: paired peer inbound sync and local
	/// IPC writes both post `(table)` here. The drain task [`run_table_change_drain`] is
	/// the sole caller of [`ManagedAvenDb::snapshot_broadcast`], keeping one code path from
	/// "row changed somewhere" → `avendb:<table>:changed` for the webview.
	pub(crate) change_tx: tokio::sync::mpsc::UnboundedSender<String>,
	/// Skip identical table snapshots so the webview does not repaint every drain tick.
	pub(super) last_table_snapshots: RwLock<HashMap<String, String>>,
	/// Skip identical mesh snapshots so connect sub-states do not repaint the webview.
	pub(super) last_mesh_snapshot: RwLock<Option<String>>,
	/// Content fingerprint of the vault-shell tables (identities/keyshares/peers) at the last
	/// drain check. Inbound peer-sync re-delivers shell-table batches that are often no-ops
	/// (frontier re-announce, non-converged blind relay), and each one used to invalidate +
	/// re-hydrate the vault shell — a constant idle re-hydrate loop. We now re-hydrate only
	/// when this digest actually changes, so a real change (e.g. a new identity-admin grant)
	/// still re-hydrates but identical re-deliveries don't. `None` = unknown → treat as changed.
	last_shell_digest: RwLock<Option<u64>>,
	/// Receiver moved out of here by [`take_change_rx`] once at startup; afterwards this
	/// stays `None`. Kept inside `std::sync::Mutex` so we can extract it from
	/// `tauri::setup` without an async runtime.
	change_rx: std::sync::Mutex<Option<tokio::sync::mpsc::UnboundedReceiver<String>>>,
	/// Coalesce parallel `avendb_connect` attempts (actor-serialized, belt-and-suspenders).
	connect_in_progress: Mutex<bool>,
	connect_done: Notify,
}

impl Default for ManagedAvenDb {
	fn default() -> Self {
		let (change_tx, change_rx) = tokio::sync::mpsc::unbounded_channel();
		Self {
			conn: Mutex::new(AvenDbConn::default()),
			table_ui_refs: Mutex::new(HashMap::new()),
			shell: Mutex::new(None),
			shell_hydrate: Mutex::new(()),
			shell_vault_stale: AtomicBool::new(true),
			conn_epoch: AtomicU64::new(0),
			mesh_local_shell_gate: AtomicBool::new(false),
			mesh_acl_rebroadcast_done: AtomicBool::new(false),
			sync_acl: Arc::new(RwLock::new(None)),
			sync_shell: Arc::new(RwLock::new(None)),
			connected_relay_did: Arc::new(RwLock::new(None)),
			change_tx,
			last_table_snapshots: RwLock::new(HashMap::new()),
			last_mesh_snapshot: RwLock::new(None),
			last_shell_digest: RwLock::new(None),
			change_rx: std::sync::Mutex::new(Some(change_rx)),
			connect_in_progress: Mutex::new(false),
			connect_done: Notify::new(),
		}
	}
}

pub(crate) fn emit_avenos_runtime(app: &tauri::AppHandle, payload: serde_json::Value) {
	use tauri::Emitter;
	let _ = app.emit("avenos:runtime", &payload);
}

impl ManagedAvenDb {
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

async fn shutdown_owned_client(old: Option<Arc<AvenDbClient>>) {
	let Some(client) = old else {
		return;
	};
	match Arc::try_unwrap(client) {
		Ok(c) => {
			if let Err(e) = c.shutdown().await {
				log::warn!(target: "avenos::avendb", "AvenDbClient shutdown failed (flush/sync): {e}");
			}
		}
		Err(arc) => {
			log::warn!(
				target: "avenos::avendb",
				"AvenDbClient shutdown skipped: {} outstanding Arc ref(s)",
				Arc::strong_count(&arc),
			);
		}
	}
}

/// Open avenDB if needed and return a shared client. **`conn` is not held during `avendb_connect`.**
pub(super) async fn with_connected_client(
	avendb: &ManagedAvenDb,
	app: &tauri::AppHandle,
	self_state: &SelfState,
) -> Result<Arc<AvenDbClient>, String> {
	if !self_state.is_unlocked() {
		avendb.reset_connection().await;
		return Err("locked: unlock AvenOS identity first".into());
	}
	// Exit-drain gate: once shutdown has begun, NEVER start a (re)connect. The process is
	// about to run C++ static destructors (RocksDB OptionTypeInfo registries) via `exit()`;
	// a concurrent `TransactionDB::Open` reads those same statics → SIGSEGV at quit.
	if crate::avendb_exit_draining() {
		return Err("shutting down: refusing new avenDB connect".into());
	}
	let desired = desired_root_client_uuid(self_state)?;

	loop {
		{
			let jc = avendb.conn.lock().await;
			if let (Some(c), Some(linked)) = (&jc.client, &jc.linked_identity) {
				if *linked == desired {
					return Ok(Arc::clone(c));
				}
			}
			if *avendb.connect_in_progress.lock().await {
				drop(jc);
				avendb.connect_done.notified().await;
				continue;
			}
		}

		*avendb.connect_in_progress.lock().await = true;

		let connect_result: Result<Arc<AvenDbClient>, String> = async {
			{
				let mut jc = avendb.conn.lock().await;
				if let (Some(c), Some(linked)) = (&jc.client, &jc.linked_identity) {
					if *linked == desired {
						return Ok(Arc::clone(c));
					}
				}
				let old = jc.client.take();
				jc.linked_identity = None;
				avendb.shell.lock().await.take();
				*avendb.sync_shell.write().expect("sync_shell poisoned") = None;
				let _epoch = avendb.bump_conn_epoch();
				avendb.reset_mesh_acl_catchup();
				drop(jc);
				shutdown_owned_client(old).await;
			}
			let client = avendb_connect(app, self_state, avendb).await?;
			Ok(Arc::new(client))
		}
		.await;

		*avendb.connect_in_progress.lock().await = false;
		avendb.connect_done.notify_waiters();

		match connect_result {
			Ok(client) => {
				let mut jc = avendb.conn.lock().await;
				jc.client = Some(Arc::clone(&client));
				jc.linked_identity = Some(desired);
				drop(jc);
				// Wire dev peer sync in the background — never blocks the connect path.
				spawn_dev_peer_sync(
					self_state,
					Arc::clone(&client),
					avendb.change_tx.clone(),
					avendb.connected_relay_did.clone(),
				);
				return Ok(client);
			}
			Err(e) => return Err(e),
		}
	}
}

/// Normalize [`AvenDbError`] for IPC strings and structured logs (avoids `Write error: Write error:` layering).
///
/// jazz-tools' `update_with_session` / `delete_with_session` collapse every
/// failure inside `add_commit` (including `BranchNotFound`, `ParentNotFound`,
/// and `StorageError`) into `QueryError::ObjectNotFound(id)`. The message
/// `ObjectNotFound(...)` therefore tells you very little about the real cause.
/// We surface the raw text unchanged so the caller can wrap it with its own
/// context (`table`, `write_branch`, `runtime_branch`) and so any "fix"
/// suggestion isn't fabricated from a misread of the upstream error code.
#[must_use]
pub(crate) fn format_avendb_err(err: AvenDbError) -> String {
	match &err {
		AvenDbError::Write(msg) => {
			log::warn!(
				target: "avenos::avendb",
				"avendb write (display): {msg} | debug: {:?}",
				err
			);
			msg.clone()
		}
		AvenDbError::Query(msg) => {
			log::warn!(
				target: "avenos::avendb",
				"avendb query (display): {msg} | debug: {:?}",
				err
			);
			msg.clone()
		}
		other => {
			let msg = other.to_string();
			log::warn!(target: "avenos::avendb", "{msg}; debug: {:?}", other);
			msg
		}
	}
}

pub(super) fn desired_root_client_uuid(self_state: &SelfState) -> Result<Uuid, String> {
	let root = self_state
		.with_root(|r| Ok(*r))
		.map_err(|_| "locked: unlock AvenOS identity first".to_string())?;
	let pk = ed25519_public(&root)?;
	Ok(crate::avendb_auth::client_uuid_from_ed_pubkey(&pk))
}

/// Persisted avenDB [`SchemaHash`] as 32-byte SHA digest from `SchemaHash::compute(schema)`.
/// This is the **same value** avenDB uses to derive its composed write branch
/// (`ComposedBranchName::new(env, schema_hash, user_branch)`). If on-disk != current,
/// old rows live on a stale branch that `current_branch()` cannot resolve — every
/// `update`/`delete` will return `ObjectNotFound`/`BranchNotFound`. We wipe in that case.
///
/// Replaces the old raw-manifest SHA256 fingerprint: byte-identical manifest JSON
/// can still produce a different `SchemaHash` if jazz-tools' Schema-build
/// changes shape between versions.
const AVENDB_SCHEMA_HASH_FILE: &str = "avendb_schema_hash";
const AVENDB_LANE_FILE: &str = "avendb_lane";

/// Must stay aligned with JazzClient `SchemaManager::new(.., env, user_branch)` in jazz-tools (`client.rs`).
pub(crate) const AVENDB_CLIENT_ENV: &str = "client";
pub(crate) const AVENDB_USER_BRANCH_MAIN: &str = "main";

/// Composed avenDB branch string derived from the **raw** manifest JSON (before AvenDb normalizes schemas).
/// Prefer `avendb_write_branch_from_connected_schema` for list/write queries so branch matches persisted avenDB state.
pub(crate) fn avendb_write_branch_for_manifest_schema() -> Result<String, String> {
	let schema = crate::schema_manifest::load_avendb_schema_from_manifest()?;
	let h = SchemaHash::compute(&schema);
	let bn = ComposedBranchName::new(
		AVENDB_CLIENT_ENV,
		h,
		AVENDB_USER_BRANCH_MAIN,
	)
	.to_branch_name();
	Ok(bn.as_str().to_string())
}

/// Branch string **exactly** as avenDB resolves it from the connected client's normalized schema.
/// List/write queries must use this; deriving only from the manifest JSON can drift after AvenDb normalizes/persists schemas.
pub(crate) async fn avendb_write_branch_from_connected_schema(
	client: &AvenDbClient,
) -> Result<String, String> {
	let sch = client.schema().await.map_err(format_avendb_err)?;
	let bn = ComposedBranchName::from_schema(
		AVENDB_CLIENT_ENV,
		&sch,
		AVENDB_USER_BRANCH_MAIN,
	)
	.to_branch_name();
	Ok(bn.as_str().to_string())
}

/// avenDB durable files live here (was `.avenOS/avendb` before AvenOS renamed the folder).
pub(super) const AVEN_OS_AVENDB_DATA_DIR: &str = "db";
const CURRENT_AVENDB_LANE: &str = "lane-v1;env=client;user_branch=main";

/// True when `AVENOS_DATA_DIR_OVERRIDE` collapses every identity into one shared
/// sandbox root (dev/test only). In that mode the db dir is intentionally reset on
/// identity mismatch; outside it, a mismatch is a hard refusal (never a wipe).
fn data_dir_override_active() -> bool {
	std::env::var_os("AVENOS_DATA_DIR_OVERRIDE").is_some_and(|v| !v.is_empty())
}

/// Re-stamp the avenDB data dir. Wipes only when **identity** disagrees (`client_id` or lane).
///
/// Schema hash changes use AvenDb v2 lenses ([`schema_migrations`]) — data stays on older branches
/// and remains readable/writable via composed lenses (see <https://jazz.tools/docs/schemas/migrations>).
pub(super) fn reconcile_avendb_identity_cache_dir(
	avendb_dir: &Path,
	desired_peer: PeerId,
	current_avendb_hash: &[u8; 32],
	current_schema: &aven_db::Schema,
) -> Result<Vec<aven_db::Schema>, String> {
	let mut reason: Option<String> = None;

	let client_path = avendb_dir.join("client_id");
	let rocksdb_path = avendb_dir.join("storage.rocksdb");
	let legacy_rocksdb_path = avendb_dir.join("avendb.rocksdb");
	let legacy_surrealkv_path = avendb_dir.join("avendb.surrealkv");
	if legacy_rocksdb_path.is_file() && !rocksdb_path.exists() {
		if let Err(e) = fs::rename(&legacy_rocksdb_path, &rocksdb_path) {
			log::warn!(
				target: "avenos::avendb",
				"migrate avendb.rocksdb→storage.rocksdb: {e}",
			);
		}
	}
	let has_prior_avendb_data = client_path.exists()
		|| rocksdb_path.exists()
		|| legacy_rocksdb_path.exists()
		|| legacy_surrealkv_path.exists();
	if legacy_surrealkv_path.exists() && !rocksdb_path.exists() {
		reason = Some(
			"storage backend migration: SurrealKV (avendb.surrealkv) → RocksDB (storage.rocksdb); wiping local vault".into(),
		);
	}
	match fs::read_to_string(&client_path) {
		Ok(s) => {
			if let Some(cid) = PeerId::parse(s.trim()) {
				if cid != desired_peer {
					// This db folder is owned by a *different* cryptographic identity.
					// Historically we wiped it — which silently bricks the rightful
					// owner's database when two app instances (or two accounts that
					// collide on a folder) point at the same dir. Refuse instead: an
					// identity may only ever open its own db folder. The lone exception
					// is the data-dir override sandbox, whose single shared root is
					// reset-on-mismatch *by design* for local dev.
					if data_dir_override_active() {
						reason = Some(format!(
							"data-dir override sandbox: persisted peer id {cid} != current identity {desired_peer}; resetting shared sandbox db"
						));
					} else {
						return Err(format!(
							"identity_db_owner_mismatch: {} belongs to identity {cid}, but the unlocked identity is {desired_peer}. Refusing to open (this prevents bricking another identity's local database). If you intend to reset, delete this folder manually.",
							avendb_dir.display()
						));
					}
				}
			}
		}
		Err(e) if e.kind() == ErrorKind::NotFound => {}
		Err(e) => return Err(format!("read {}: {e}", client_path.display())),
	}

	let hash_path = avendb_dir.join(AVENDB_SCHEMA_HASH_FILE);
	let mut live_schemas: Vec<aven_db::Schema> = Vec::new();
	if reason.is_none() {
		match fs::read(&hash_path) {
			Ok(bytes) if bytes.len() == 32 && bytes.as_slice() == current_avendb_hash => {}
			Ok(bytes) if bytes.len() == 32 => {
				let stored: [u8; 32] = bytes.try_into().expect("length checked");
				live_schemas =
					crate::schema_migrations::live_schemas_for_stored_hash(avendb_dir, &stored, current_schema)?;
			}
			Ok(bytes) => {
				reason = Some(format!(
					"invalid avendb SchemaHash file ({} bytes, expected 32)",
					bytes.len()
				));
			}
			Err(e) if e.kind() == ErrorKind::NotFound => {
				if has_prior_avendb_data {
					reason = Some(
						"avendb SchemaHash file missing while avendb data present (older AvenOS install or aborted write); cannot prove writable branch matches on-disk rows".into(),
					);
				}
			}
			Err(e) => return Err(format!("read {}: {e}", hash_path.display())),
		}
	}

	let lane_path = avendb_dir.join(AVENDB_LANE_FILE);
	if reason.is_none() {
		match fs::read_to_string(&lane_path) {
			Ok(stored) => {
				let stored = stored.trim();
				if stored != CURRENT_AVENDB_LANE {
					reason = Some(format!(
						"avendb lane mismatch (on-disk={stored:?}, current={CURRENT_AVENDB_LANE:?})"
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
			target: "avenos::avendb",
			"Purging {}: {why}",
			avendb_dir.display(),
		);
		if avendb_dir.exists() {
			fs::remove_dir_all(avendb_dir)
				.map_err(|e| format!("remove {}: {e}", avendb_dir.display()))?;
		}
	}

	fs::create_dir_all(avendb_dir).map_err(|e| format!("recreate avendb dir: {e}"))?;
	fs::write(&hash_path, current_avendb_hash)
		.map_err(|e| format!("write {}: {e}", hash_path.display()))?;
	fs::write(avendb_dir.join(AVENDB_LANE_FILE), CURRENT_AVENDB_LANE.as_bytes()).map_err(|e| {
		format!(
			"write {}: {e}",
			avendb_dir.join(AVENDB_LANE_FILE).display()
		)
	})?;

	let composed = ComposedBranchName::new(
		AVENDB_CLIENT_ENV,
		SchemaHash::from_bytes(*current_avendb_hash),
		AVENDB_USER_BRANCH_MAIN,
	)
	.to_branch_name();
	log::info!(
		target: "avenos::avendb",
		"avendb cache stamped: dir={} avendb_hash={} composed_branch={} live_schemas={}",
		avendb_dir.display(),
		hex_short(current_avendb_hash),
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

impl ManagedAvenDb {
	fn bump_conn_epoch(&self) -> u64 {
		self.conn_epoch.fetch_add(1, Ordering::AcqRel) + 1
	}

	pub(super) fn invalidate_vault_shell(&self) {
		self.shell_vault_stale.store(true, Ordering::Release);
		self.last_table_snapshots
			.write()
			.expect("last_table_snapshots poisoned")
			.clear();
		// Keep sync_acl until re-hydrate replaces it — clearing it re-triggers catch-up rebroadcast storms.
	}

	/// Has the vault-shell content actually changed since the last check? Returns `true` (and
	/// records the new fingerprint) only on a real change; identical inbound re-deliveries return
	/// `false`. This gates the drain's re-hydrate so the constant idle re-hydrate loop stops while
	/// a genuine change (new identity-admin grant, keyshare, peer) still re-hydrates.
	///
	/// Fully generic — no table or column is special-cased:
	///   • it digests every table in `identity_sync::VAULT_SHELL_TABLES` (extend that list and this
	///     follows automatically), and
	///   • each row contributes a column/schema-agnostic hash of `(table, object_id, values)`,
	///     so it works for any table of any shape.
	/// Order-independent (rows summed), includes soft-deleted rows (a delete is a real change),
	/// and fails safe to `true` on any query error so a real change is never suppressed.
	pub(super) async fn vault_shell_content_changed(&self, client: &AvenDbClient) -> bool {
		use std::hash::{Hash, Hasher};
		let mut acc: u64 = 0;
		for table in identity_sync::VAULT_SHELL_TABLES {
			let q = QueryBuilder::new(TableName::new(*table))
				.include_deleted()
				.build();
			let rows = match client.query(q, None).await {
				Ok(rows) => rows,
				Err(_) => return true, // fail safe: re-hydrate rather than risk missing a change
			};
			for (oid, vals) in rows {
				let mut h = std::collections::hash_map::DefaultHasher::new();
				(*table).hash(&mut h);
				oid.uuid().as_bytes().hash(&mut h);
				format!("{vals:?}").hash(&mut h);
				acc = acc.wrapping_add(h.finish()); // order-independent fold
			}
		}
		let mut last = self
			.last_shell_digest
			.write()
			.expect("last_shell_digest poisoned");
		if *last == Some(acc) {
			false
		} else {
			*last = Some(acc);
			true
		}
	}

	/// Refresh `(table, object_id) → owner` in the outbound sync gate without a full shell hydrate.
	pub(crate) async fn refresh_sync_acl_object_map(
		&self,
		client: &AvenDbClient,
	) -> Result<(), String> {
		let object_owner = engine::build_object_owner_map(client).await?;
		let keyshare_recipient = engine::build_keyshare_recipient_map(client).await?;
		let mut guard = self.sync_acl.write().expect("sync_acl poisoned");
		if let Some(snap) = guard.as_mut() {
			snap.object_owner = object_owner;
			snap.keyshare_recipient = keyshare_recipient;
		}
		Ok(())
	}

	fn reset_mesh_acl_catchup(&self) {
		self.mesh_acl_rebroadcast_done.store(false, Ordering::Release);
	}

	/// Wait until no `avendb_connect` is in flight. Used by the exit drain: a connect holds
	/// RocksDB internals (`TransactionDB::Open` reads static option registries), so exiting
	/// the process under it races the C++ static destructors run by `exit()` → SIGSEGV.
	pub(crate) async fn wait_for_connect_idle(&self) {
		loop {
			let notified = self.connect_done.notified();
			if !*self.connect_in_progress.lock().await {
				return;
			}
			notified.await;
		}
	}

	/// Drops cached avenDB runtime + biscuit shell (`SelfState`-derived). Prefer calling this whenever
	/// [`SelfState`] is cleared (vault lock).
	pub(crate) async fn reset_connection(&self) {
		self.bump_conn_epoch();
		self.reset_mesh_acl_catchup();
		let old_client = {
			let mut jc = self.conn.lock().await;
			jc.linked_identity = None;
			self.shell.lock().await.take();
			*self.sync_shell.write().expect("sync_shell poisoned") = None;
			self.shell_vault_stale.store(true, Ordering::Release);
			self.mesh_local_shell_gate.store(false, Ordering::Release);
			*self.sync_acl.write().expect("sync_acl poisoned") = None;
			self.last_table_snapshots.write().expect("last_table_snapshots poisoned").clear();
			*self.last_mesh_snapshot.write().expect("last_mesh_snapshot poisoned") = None;
			*self.last_shell_digest.write().expect("last_shell_digest poisoned") = None;
			self.table_ui_refs.lock().await.clear();
			*self.connect_in_progress.lock().await = false;
			self.connect_done.notify_waiters();
			jc.client.take()
		};
		shutdown_owned_client(old_client).await;
	}

	pub(super) async fn bump_table_ui_ref(&self, table: &str) -> u32 {
		let mut m = self.table_ui_refs.lock().await;
		let n = m.entry(table.to_string()).or_insert(0);
		*n += 1;
		*n
	}

	pub(super) async fn drop_table_ui_ref(&self, table: &str) -> u32 {
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

	pub(super) async fn table_ui_ref_count(&self, table: &str) -> u32 {
		self.table_ui_refs
			.lock()
			.await
			.get(table)
			.copied()
			.unwrap_or(0)
	}

	/// At least one active `subscribe` ref for any of `tables`.
	pub(super) async fn any_ui_subscriber(&self, tables: &std::collections::HashSet<String>) -> bool {
		let m = self.table_ui_refs.lock().await;
		tables
			.iter()
			.any(|t| m.get(t).copied().unwrap_or(0) > 0)
	}

	/// Tables with at least one active UI subscriber (ref-count > 0). Used to refresh exactly
	/// the views the user is currently looking at after a vault-shell re-hydrate — generically,
	/// independent of which table it is.
	pub(super) async fn subscribed_tables(&self) -> Vec<String> {
		let m = self.table_ui_refs.lock().await;
		m.iter()
			.filter(|(_, &n)| n > 0)
			.map(|(t, _)| t.clone())
			.collect()
	}

	/// Re-query `table` and emit `avenos:runtime` `{ kind: "table", table, rows }` (deduped).
	///
	/// **Callers:** [`execute_drain_batch`], local CRUD [`change_tx`] path.
	pub async fn snapshot_broadcast(
		&self,
		app: &tauri::AppHandle,
		client: &AvenDbClient,
		shell: &engine::ShellState,
		table: &str,
	) -> Result<bool, String> {
		if self.table_ui_ref_count(table).await == 0 {
			return Ok(false);
		}
		if table == "signers" {
			let rows = crate::signers::list_signer_rows(client).await?;
			return emit_peers_table_snapshot(self, app, &rows);
		}
		let (snap, _) = engine::query_table_publish(client, shell, table, ENCRYPTED_META).await?;
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
		client: &AvenDbClient,
		shell: &engine::ShellState,
		table: &str,
	) -> Result<(), String> {
		if table == "signers" {
			let rows = crate::signers::list_signer_rows(client).await?;
			let _ = emit_peers_table_snapshot(self, app, &rows)?;
			return Ok(());
		}
		let (snap, _) =
			engine::query_table_publish(client, shell, table, ENCRYPTED_META).await?;
		if table == "safes" && snap.is_empty() {
			log::warn!(
				target: "avenos::avendb",
				"bootstrap: safes table empty after hydrate — UI may seed on next write",
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

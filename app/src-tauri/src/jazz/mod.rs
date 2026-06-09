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
	query_manager::types::{ColumnType, ComposedBranchName, SchemaHash, TableName, TableSchema},
	AppContext,
	AppId,
	PeerId,
	JazzClient,
	JazzError,
	metadata::MetadataKey,
	ObjectId,
	PeerInboundParkedHook,
	QueryBuilder,
	SyncPayload,
	SyncTransport,
	Value,
};
use crate::mesh::{
	LinkHealth, P2pDiagnostics, PeerMeshPeerState, PeerMeshPhase, PeerMeshStatusReply, PeerUsability,
	SyncBootstrapPhase,
};
use crate::identity_sync::{self, SyncAclSnapshot};
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
	/// did:key of the aven-node relay this device is synced through, if any —
	/// lets the UI offer a one-click "replicate this identity to the relay".
	pub relay_did: Option<String>,
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
	/// Identity biscuit snapshot for outbound sync policy.
	pub(crate) sync_acl: Arc<RwLock<Option<SyncAclSnapshot>>>,
	/// Std-lock mirror of the hydrated shell (biscuit vault) for the sync gate.
	/// `BiscuitCapabilityResolver` reads this synchronously on the engine tick
	/// thread (the primary `shell` is a tokio Mutex, unusable from sync code).
	pub(crate) sync_shell: Arc<RwLock<Option<std::sync::Arc<jazz_engine::ShellState>>>>,
	/// did:key of the aven-node relay this device is currently synced through
	/// (the authenticated peer from the TLS handshake), or `None` when local-only.
	/// Surfaced to the UI so a identity can grant it `replicate` with one click —
	/// no copying the DID out of the server's logs.
	pub(crate) connected_relay_did: Arc<RwLock<Option<String>>>,
	/// MPSC sender for **all** UI-facing table deltas: paired peer inbound sync and local
	/// IPC writes both post `(table)` here. The drain task [`run_table_change_drain`] is
	/// the sole caller of [`ManagedJazz::snapshot_broadcast`], keeping one code path from
	/// "row changed somewhere" → `jazz:<table>:changed` for the webview.
	pub(crate) change_tx: tokio::sync::mpsc::UnboundedSender<String>,
	/// Skip identical table snapshots so the webview does not repaint every drain tick.
	last_table_snapshots: RwLock<HashMap<String, String>>,
	/// Skip identical mesh snapshots so connect sub-states do not repaint the webview.
	last_mesh_snapshot: RwLock<Option<String>>,
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
	// A pending vault-shell table (identities/keyshares/peers) MIGHT mean the shell changed — but
	// inbound peer-sync re-delivers these batches constantly as no-ops, so we confirm an actual
	// content change below (after we have a client) before paying for a re-hydrate.
	let vault_shell_maybe_dirty = pending
		.iter()
		.any(|t| identity_sync::is_vault_shell_table(t));

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
	if !vault_shell_maybe_dirty && !want_snapshots {
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

	// Only treat the vault shell as dirty when the shell tables' CONTENT actually changed.
	// This is the fix for the constant idle re-hydrate loop: inbound shell-table re-deliveries
	// (frontier re-announce, a non-converged blind relay) used to invalidate + re-hydrate the
	// vault shell every time. A genuine change (new identity-admin grant, keyshare, peer) alters a
	// row, so the content digest changes and we still invalidate + re-hydrate — reactivity is
	// preserved; identical re-deliveries are now a no-op. On a query error we fail safe to dirty.
	let vault_shell_dirty =
		vault_shell_maybe_dirty && jazz.vault_shell_content_changed(client.as_ref()).await;
	if vault_shell_dirty {
		jazz.invalidate_vault_shell();
	}

	// A vault-shell re-hydrate can change row ACCESS for ANY table — a single identity grant
	// unlocks the identity catalogue row AND every data row (todos / messages / files / …) it
	// scopes. So after re-hydrate we refresh GENERICALLY, with no per-table special cases:
	//   • the catalogue (`identities`) ALWAYS — so the identity list updates even off-page, and
	//   • every table the user is currently viewing — so the open page reflects new access.
	// Tables the user is *not* viewing need no push: navigating to them re-`list()`s through
	// the now-hydrated shell. This force-set bypasses the per-table subscriber gate.
	let force_after_rehydrate: Vec<String> = if vault_shell_dirty {
		let mut set: std::collections::HashSet<String> = jazz
			.subscribed_tables()
			.await
			.into_iter()
			.filter(|t| t != "peers") // peers has its own publish path (publish_trusted_peers_ui)
			.collect();
		set.insert("identities".to_string());
		set.into_iter().collect()
	} else {
		Vec::new()
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
		.any(|t| identity_sync::is_spark_data_table(t))
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

	if !want_snapshots && force_after_rehydrate.is_empty() {
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

	// (1) Generic force-push after a shell re-hydrate: bypasses the per-table subscriber gate
	// so newly-granted access surfaces immediately (the identity list + whatever page is open),
	// for ANY table — no special cases.
	for table in &force_after_rehydrate {
		{
			let mut last = jazz
				.last_table_snapshots
				.write()
				.expect("last_table_snapshots poisoned");
			last.remove(table);
		}
		match jazz
			.publish_table_snapshot_force(app, client.as_ref(), shell.as_ref(), table)
			.await
		{
			Ok(()) => log::debug!(
				target: "avenos::jazz",
				"table-change drain: force-published {table} after shell re-hydrate",
			),
			Err(e) => log::warn!(
				target: "avenos::jazz",
				"table-change drain: publish_table_snapshot_force({table}) failed: {e}",
			),
		}
	}

	// (2) Ordinary row changes (no access change) for tables the user is viewing: subscriber-
	// gated snapshot. Skip any table already force-pushed above (dedup would no-op it anyway).
	if want_snapshots {
		let to_broadcast: Vec<String> = pending
			.iter()
			.filter(|t| !force_after_rehydrate.contains(*t))
			.cloned()
			.collect();
		{
			let mut last = jazz
				.last_table_snapshots
				.write()
				.expect("last_table_snapshots poisoned");
			for t in &to_broadcast {
				last.remove(t);
			}
		}
		for table in to_broadcast {
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

	let snapshot_tables: HashSet<String> = pending
		.iter()
		.cloned()
		.chain(force_after_rehydrate.iter().cloned())
		.collect();
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
				*jazz.sync_shell.write().expect("sync_shell poisoned") = None;
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
				drop(jc);
				// Wire dev peer sync in the background — never blocks the connect path.
				spawn_dev_peer_sync(
					self_state,
					Arc::clone(&client),
					jazz.change_tx.clone(),
					jazz.connected_relay_did.clone(),
				);
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
const CURRENT_JAZZ_LANE: &str = "lane-v1;env=client;user_branch=main";

/// True when `AVENOS_DATA_DIR_OVERRIDE` collapses every identity into one shared
/// sandbox root (dev/test only). In that mode the db dir is intentionally reset on
/// identity mismatch; outside it, a mismatch is a hard refusal (never a wipe).
fn data_dir_override_active() -> bool {
	std::env::var_os("AVENOS_DATA_DIR_OVERRIDE").is_some_and(|v| !v.is_empty())
}

/// Re-stamp the Groove data dir. Wipes only when **identity** disagrees (`client_id` or lane).
///
/// Schema hash changes use Jazz v2 lenses ([`schema_migrations`]) — data stays on older branches
/// and remains readable/writable via composed lenses (see <https://jazz.tools/docs/schemas/migrations>).
fn reconcile_jazz_identity_cache_dir(
	jazz_dir: &Path,
	desired_peer: PeerId,
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
							jazz_dir.display()
						));
					}
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
	async fn vault_shell_content_changed(&self, client: &JazzClient) -> bool {
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
		client: &JazzClient,
	) -> Result<(), String> {
		let object_owner = jazz_engine::build_object_owner_map(client).await?;
		let keyshare_recipient = jazz_engine::build_keyshare_recipient_map(client).await?;
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

	/// Drops cached Groove runtime + biscuit shell (`SelfState`-derived). Prefer calling this whenever
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

	/// Tables with at least one active UI subscriber (ref-count > 0). Used to refresh exactly
	/// the views the user is currently looking at after a vault-shell re-hydrate — generically,
	/// independent of which table it is.
	async fn subscribed_tables(&self) -> Vec<String> {
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
		if table == "identities" && snap.is_empty() {
			log::warn!(
				target: "avenos::jazz",
				"bootstrap: identities table empty after hydrate — UI may seed on next write",
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
	let (rows, snap) = if ss.is_unlocked() {
		let client = with_connected_client(jazz, app, ss).await?;
		let rows = crate::peers::list_peer_rows(client.as_ref()).await?;
		let registered = registered_peer_dids(client.as_ref());
		let converged = converged_peer_dids(client.as_ref());
		let local_pk_prefix = local_pk_prefix_hex(ss);
		let snap = build_peer_mesh_status(&rows, &registered, &converged, local_pk_prefix);
		(rows, snap)
	} else {
		(
			vec![],
			build_peer_mesh_status(&[], &Default::default(), &Default::default(), String::new()),
		)
	};

	if jazz.table_ui_ref_count("peers").await > 0 {
		let _ = emit_peers_table_snapshot(jazz, app, &rows);
	}

	emit_mesh_snapshot(app, jazz, snap)
}

/// did:key set for peer clients with a live registered sync link.
fn registered_peer_dids(client: &JazzClient) -> std::collections::HashSet<String> {
	client
		.peer_client_ids()
		.unwrap_or_default()
		.iter()
		.filter_map(|pid| crate::jazz_auth::peer_did_from_ed25519(&pid.0).ok())
		.collect()
}

/// did:key set for peers whose frontier is converged from our side ("Up to date").
fn converged_peer_dids(client: &JazzClient) -> std::collections::HashSet<String> {
	client
		.converged_peer_ids()
		.unwrap_or_default()
		.iter()
		.filter_map(|pid| crate::jazz_auth::peer_did_from_ed25519(&pid.0).ok())
		.collect()
}

/// First 4 bytes of the local Ed25519 pubkey, hex — for the mesh diagnostics line.
fn local_pk_prefix_hex(ss: &SelfState) -> String {
	let Ok(root) = ss.with_root(|r| Ok(*r)) else {
		return String::new();
	};
	match ed25519_public(&root) {
		Ok(pk) => format!("{:02x}{:02x}{:02x}{:02x}", pk[0], pk[1], pk[2], pk[3]),
		Err(_) => String::new(),
	}
}

/// Real mesh status from the trusted-peer rows + live transport registration +
/// frontier convergence (§10.2). A registered+converged peer is `Ready` (up to
/// date); registered but still owed batches is `Syncing`; no live link is
/// `Searching`. No demo data.
fn build_peer_mesh_status(
	rows: &[crate::peers::PeerRowReply],
	registered_dids: &std::collections::HashSet<String>,
	converged_dids: &std::collections::HashSet<String>,
	local_pk_prefix: String,
) -> PeerMeshStatusReply {
	let peers: Vec<PeerMeshPeerState> = rows
		.iter()
		.filter(|r| r.status == "active")
		.map(|r| {
			let linked = registered_dids.contains(&r.peer_did);
			let converged = linked && converged_dids.contains(&r.peer_did);
			let (phase, usability, bootstrap) = if converged {
				(
					PeerMeshPhase::Ready,
					PeerUsability::Usable,
					SyncBootstrapPhase::Ready,
				)
			} else if linked {
				(
					PeerMeshPhase::Syncing,
					PeerUsability::LiveSyncing,
					SyncBootstrapPhase::Ready,
				)
			} else {
				(
					PeerMeshPhase::Searching,
					PeerUsability::Connecting,
					SyncBootstrapPhase::TransportPending,
				)
			};
			PeerMeshPeerState {
				id: r.id.clone(),
				peer_did: r.peer_did.clone(),
				device_label: r.device_label.clone(),
				db_status: r.status.clone(),
				added_at_ms: r.added_at_ms.max(0) as u64,
				phase,
				usability: Some(usability),
				bootstrap: Some(bootstrap),
			}
		})
		.collect();

	let linked_count = peers
		.iter()
		.filter(|p| p.bootstrap == Some(SyncBootstrapPhase::Ready))
		.count() as u32;

	PeerMeshStatusReply {
		hyperswarm_running: !registered_dids.is_empty(),
		hyperswarm_start_error: None,
		local_pk_prefix_hex: local_pk_prefix,
		p2p_diagnostics: P2pDiagnostics {
			central_mode: false,
			dht_bootstrap: "dev tcp transport".into(),
			joined_topic_count: 0,
			allowlist_count: peers.len() as u32,
			linked_count,
			pairing_session_active: Some(false),
			prefer_relay_only: Some(false),
			link_health: Some(LinkHealth::None),
		},
		peers,
	}
}

fn emit_mesh_snapshot(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	snap: PeerMeshStatusReply,
) -> Result<(), String> {
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
		// Vector (embedding) column: a JSON array of numbers -> packed f32.
		ColumnType::Vector { .. } => {
			let arr = cell
				.as_array()
				.ok_or_else(|| "expected JSON array column for vector".to_string())?;
			let mut v = Vec::with_capacity(arr.len());
			for item in arr {
				let f = item
					.as_f64()
					.ok_or_else(|| "expected JSON number in vector column".to_string())?;
				v.push(f as f32);
			}
			Ok(Value::Vector(v))
		}
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

/// Dial the hosted aven-node over a WebSocket and complete the nonce-bound
/// did:key challenge. Returns the transport + the server's authenticated peer id.
///
/// The endpoint is `AVENOS_SERVER_WS_URL` (e.g. `wss://aven-ceo-bmrha.sprites.app/sync`,
/// or `ws://127.0.0.1:8080/sync` for a local relay). Reaching the hosted relay is
/// just the public Sprite URL — no `sprite proxy` — and TLS is the Sprites proxy's,
/// so there is no cert to pin. The URL is resolved from the runtime env (dev), else
/// a value baked at build time via `option_env!` (release pipeline), else `None` →
/// local-only. The dial retries briefly so the app tolerates the relay waking a
/// beat late (the first request wakes a hibernated Sprite).
async fn try_server_transport(
	signing_key: ed25519_dalek::SigningKey,
) -> Option<(Arc<dyn SyncTransport>, PeerId, Arc<tokio::sync::Notify>)> {
	let url = match server_ws_url() {
		Some(u) => {
			log::info!("server sync URL resolved: {u} (dialing relay)");
			u
		}
		None => {
			log::info!(
				"server sync URL unset (no AVENOS_SERVER_WS_URL baked or in env) — running local-only"
			);
			return None;
		}
	};
	// Dial until connected — no give-up window. A hibernated relay wakes on the
	// request; on a slow/just-coming-up network (e.g. cellular after a switch) we
	// keep retrying with capped backoff instead of silently falling back to
	// local-only. The caller (`spawn_dev_peer_sync`) re-enters this on disconnect.
	let mut backoff = Duration::from_millis(400);
	loop {
		match aven_p2p::WsClientTransport::connect(&url, signing_key.clone()).await {
			Ok(t) => {
				let server = t.server_peer_id();
				let disconnected = t.disconnected();
				log::info!("server transport established (aven {server})");
				return Some((Arc::new(t), server, disconnected));
			}
			Err(e) => {
				log::debug!("server ws dial not ready ({url}): {e}");
				tokio::time::sleep(backoff).await;
				backoff = (backoff * 2).min(Duration::from_secs(5));
			}
		}
	}
}

/// The sync server WebSocket URL: runtime `AVENOS_SERVER_WS_URL` (dev) →
/// compile-time `option_env!` (baked by the release pipeline) → `None`
/// (local-only). No connection is attempted when unset.
fn server_ws_url() -> Option<String> {
	if let Ok(u) = std::env::var("AVENOS_SERVER_WS_URL") {
		let u = u.trim().to_string();
		if !u.is_empty() {
			return Some(u);
		}
	}
	match option_env!("AVENOS_SERVER_WS_URL") {
		Some(u) if !u.trim().is_empty() => Some(u.trim().to_string()),
		_ => None,
	}
}

/// The sync transport for this client, or `None` to run local-only (no
/// `AVENOS_SERVER_SYNC`, or the relay was unreachable). Yields
/// `(transport, server-peer-to-register)`.
async fn try_any_peer_transport(
	root: &[u8; 32],
) -> Option<(Arc<dyn SyncTransport>, PeerId, Arc<tokio::sync::Notify>)> {
	let sk = crate::jazz_auth::signing_key_from_device_root(root).ok()?;
	try_server_transport(sk).await
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
	let peer_id = PeerId(pk);
	let groove_hash = *SchemaHash::compute(&schema).as_bytes();

	let user_root = vault_user_root(app)?;
	let data_dir = user_root.join(AVEN_OS_GROOVE_DATA_DIR);
	let live_schemas =
		reconcile_jazz_identity_cache_dir(&data_dir, peer_id, &groove_hash, &schema)?;

	let ctx = AppContext {
		app_id: AppId::from_name("ceo.aven.os"),
		client_id: Some(peer_id),
		schema: schema.clone(),
		live_schemas,
		data_dir: data_dir.clone(),
	};

	let _ = app;
	// Connect Groove LOCALLY only — this is the sole thing sign-in waits on. The
	// sync transport (the aven-node relay over TLS) is established and attached
	// in the BACKGROUND (see `spawn_dev_peer_sync`), so bootstrap can never block
	// waiting for the relay to appear.
	let client = JazzClient::connect(ctx).await.map_err(format_jazz_err)?;
	// Install the biscuit-backed sync gate (replaces the `AllowAll` default).
	// It reads the live shell vault + identity ACL handles, so it authorizes from
	// real biscuits the moment the shell hydrates; until then it returns
	// `Pending` (defer, never drop) and a later catch-up re-asks.
	let resolver = std::sync::Arc::new(crate::biscuit_resolver::BiscuitCapabilityResolver::new(
		mj.sync_shell.clone(),
		mj.sync_acl.clone(),
	));
	if let Err(e) = client.set_resolver(resolver) {
		log::warn!("install biscuit sync gate: {e}");
	}

	// Install the author edit-signer (audit #29): every locally-authored row is signed over
	// its content digest with the device key, so `data` + `metadata` are authenticated and a
	// relay that tampers with a sealed cell / keyshare column is rejected on apply by every
	// peer. Installed at connect (before any identity row is authored) so no row ships
	// unsigned. The key is the same device key that mints owner-bindings.
	match crate::jazz_auth::signing_key_from_device_root(&root) {
		Ok(signing_key) => {
			let signer =
				std::sync::Arc::new(crate::biscuit_resolver::AppEditSigner::new(signing_key));
			if let Err(e) = client.set_edit_signer(signer) {
				log::warn!("install author edit-signer: {e}");
			}
		}
		Err(e) => log::warn!("derive signing key for edit-signer: {e}"),
	}

	crate::schema_migrations::stamp_current_vault_snapshot(&data_dir, &schema)?;
	Ok(client)
}

/// Establish the sync transport (the aven-node relay over TLS) in the BACKGROUND
/// and attach it to an already-connected (local) client. Never blocks sign-in:
/// Groove is connected locally first, and this only wires sync once the relay is
/// reachable. A no-op when sync is unconfigured (`try_any_peer_transport` returns
/// `None` immediately when `AVENOS_SERVER_SYNC` is unset).
fn spawn_dev_peer_sync(
	self_state: &SelfState,
	client: Arc<JazzClient>,
	change_tx: tokio::sync::mpsc::UnboundedSender<String>,
	relay_did_slot: Arc<RwLock<Option<String>>>,
) {
	// Capture the unlocked root up front (the transport signs the did:key challenge
	// with it); bail if locked.
	let root = match self_state.with_root(|r| Ok(*r)) {
		Ok(r) => r,
		Err(_) => return,
	};
	// Start clean: clear any stale relay until this attempt establishes one (so a
	// local-only run correctly reports "no relay connected").
	if let Ok(mut slot) = relay_did_slot.write() {
		*slot = None;
	}
	// Inbound peer-sync deltas must drive the SAME drain that local IPC writes use
	// (`change_tx` → `run_table_change_drain` → `execute_drain_batch`). Without this
	// hook, a synced `identities`/`keyshares` change — e.g. a identity-admin grant arriving
	// from a peer — never invalidates the vault shell or refreshes the sync ACL, so
	// the newly granted identity's data won't decrypt or live-sync until the next app
	// restart. Built once and reused across reconnects.
	let on_inbound: PeerInboundParkedHook = Arc::new(move |payload: &SyncPayload| {
		// The table name lives in the payload-level `metadata` (built by
		// `metadata_from_row_locator`), NOT in `row.metadata` — a row's own metadata is
		// provenance only and never carries `table`.
		let table = match payload {
			SyncPayload::RowBatchCreated { metadata, .. }
			| SyncPayload::RowBatchNeeded { metadata, .. } => Some(
				metadata
					.as_ref()
					.and_then(|m| m.metadata.get(MetadataKey::Table.as_str()).cloned()),
			),
			_ => None,
		};
		// Peer-synced deltas forwarded by a blind relay don't always preserve the
		// payload-level table; then a synced grant/keyshare only re-hydrates after an app
		// restart (M8 B2/B3: subject_not_owner + missing_dek_cached). When a RowBatch has
		// no table, poke the vault-shell tables so a re-hydrate is CONSIDERED; the content-
		// digest guard makes identical re-deliveries a no-op (no re-hydrate loop).
		match table {
			Some(Some(table)) => {
				let _ = change_tx.send(table);
			}
			Some(None) => {
				for t in ["identities", "keyshares", "peers"] {
					let _ = change_tx.send(t.to_string());
				}
			}
			None => {}
		}
	});
	// Supervisor: (re)dial → attach → register → wait for the connection to drop →
	// repeat. This is what makes sync recover on the fly after a network switch,
	// hibernate, or idle close — not only on app restart. Re-registering on each
	// reconnect re-triggers the engine's frontier catch-up, so missed batches resync.
	tokio::spawn(async move {
		loop {
			let Some((transport, remote, disconnected)) = try_any_peer_transport(&root).await
			else {
				return; // local-only (no relay URL) — nothing to supervise
			};
			// Record the authenticated relay DID so the UI can offer a one-click
			// "replicate this identity to the connected relay".
			if let Ok(did) = crate::jazz_auth::peer_did_from_ed25519(&remote.0) {
				if let Ok(mut slot) = relay_did_slot.write() {
					*slot = Some(did);
				}
			}
			client.attach_sync_transport(transport, Some(on_inbound.clone()));
			// Don't re-register a peer the user has Forgotten (revoked) — that is what
			// makes Forget persist across reconnect/restart. Only an explicit revoke is
			// skipped; unknown peers stay permissive (first-contact).
			let remote_did = crate::jazz_auth::peer_did_from_ed25519(&remote.0).ok();
			let revoked = match &remote_did {
				Some(did) => crate::peers::is_peer_revoked(&client, did)
					.await
					.unwrap_or(false),
				None => false,
			};
			if revoked {
				log::info!("dev peer {remote} is Forgotten (revoked); not registering for sync");
			} else if let Err(e) = client.register_peer_sync_client(remote) {
				log::warn!("register dev peer {remote}: {e}");
			}
			// Block until the live connection drops, then loop to reconnect + resync.
			disconnected.notified().await;
			log::info!("relay connection lost — reconnecting to resync");
			tokio::time::sleep(Duration::from_millis(500)).await;
		}
	});
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
	// Full hydrate when vault tables change (identities/keyshares/peers) or on first use after unlock.
	let hydrated = jazz_engine::hydrate_shell(client.as_ref(), &root, &vault_files).await?;
	mj.shell_vault_stale.store(false, Ordering::Release);
	let arc = std::sync::Arc::new(hydrated);
	let mut slot = mj.shell.lock().await;
	*slot = Some(std::sync::Arc::clone(&arc));
	// Mirror into the std-lock handle read by the biscuit sync gate.
	*mj.sync_shell.write().expect("sync_shell poisoned") = Some(std::sync::Arc::clone(&arc));
	let object_owner = jazz_engine::build_object_owner_map(client.as_ref()).await?;
	let keyshare_recipient = jazz_engine::build_keyshare_recipient_map(client.as_ref()).await?;
	let snap = identity_sync::build_sync_acl_snapshot(object_owner, keyshare_recipient);
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
		default_spark_urn: jazz_engine::identity_urn(shell.default_identity),
		// This shell-only path has no relay handle; the live relay DID is filled
		// by `groove_ipc_session` (which can read `ManagedJazz`).
		relay_did: None,
	}
}

/// Internal vault tables that carry no UI rows — skipped when force-publishing initial
/// snapshots (their contents hydrate the shell, they are never painted directly).
const NON_UI_TABLES: &[&str] = &["keyshares"];

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
			// Generic: force-publish an initial snapshot for EVERY table in the connected
			// schema (minus internal vault tables), so first paint is reactive for any
			// present or future table without a hardcoded list to maintain.
			for table in &tables {
				if NON_UI_TABLES.contains(&table.as_str()) {
					continue;
				}
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
	let relay_did = jazz
		.connected_relay_did
		.read()
		.ok()
		.and_then(|slot| slot.clone());
	Ok(JazzSessionReply {
		peer_did: shell.peer_did.clone(),
		peer_did_short: jazz_engine::short_peer_did(&shell.peer_did),
		default_spark_urn: jazz_engine::identity_urn(shell.default_identity),
		relay_did,
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
/// The shared grant ritual: locate an identity's row, seal the new `genesis_b64` under the
/// identity DEK, sign the owner-binding, and persist it. Every admin/member/replicate grant
/// funnels through here, so the seal coordinate + owner-binding are applied in exactly one place.
async fn update_identity_genesis(
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
	identity: Uuid,
	genesis_b64: String,
) -> Result<(), String> {
	let sparks_schema = jazz_engine::resolved_table_schema(client, "identities").await?;
	let sparks_oid = jazz_engine::find_identity_oid(client, &sparks_schema, identity).await?;
	let mut patch = Map::new();
	patch.insert("genesis_b64".into(), JsonValue::String(genesis_b64));
	jazz_engine::seal_sensitive_in_patch(
		shell,
		"identities",
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
	let urn = jazz_engine::identity_urn(identity);
	let kek = crate::crypto::derive_kek_x25519(&shell.signing_key, &shell.vault.ed25519_public)?;
	let aad = crate::crypto::keyshare_wrap_aad(&urn, &shell.peer_did, &shell.peer_did, dek_ver);
	let wrapped = crate::crypto::encrypt_keyshare_payload(&kek, dek_plain.expose(), &aad)?;
	let ks_schema = jazz_engine::resolved_table_schema(client, "keyshares").await?;
	let mut ks = Map::new();
	ks.insert("owner".into(), JsonValue::String(identity.to_string()));
	ks.insert("dek_version".into(), JsonValue::Number(dek_ver.into()));
	ks.insert("recipient_did".into(), JsonValue::String(shell.peer_did.clone()));
	ks.insert("wrapper_did".into(), JsonValue::String(shell.peer_did.clone()));
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

		update_identity_genesis(client.as_ref(), shell, identity_uuid, genesis_b64).await?;
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

		update_identity_genesis(client.as_ref(), shell, identity_uuid, genesis_b64).await?;
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
				ensure_aven_ceo_owner_row(client.as_ref(), shell, identity_uuid).await?;
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
	let dek_plain = crate::crypto::random_identity_dek();
	let sparks_oid = ObjectId::new();
	jazz_engine::seal_sensitive_in_row_with_dek(
		dek_plain.expose(),
		"identities",
		&sparks_schema,
		identity_uuid,
		*sparks_oid.uuid(),
		dek_ver,
		&mut row,
	)?;
	let sparks_vals = insert_values("identities", &sparks_schema, row)?;
	let sparks_meta = owner_binding_meta(&shell.signing_key, sparks_oid, identity_uuid)?;
	client.create_with_id_and_metadata("identities", sparks_oid, sparks_vals, sparks_meta).await.map_err(format_jazz_err)?;

	// Self keyshare: wrap a fresh DEK to this device so the owner can read sealed
	// columns later (the roster is plaintext today, but keep the shape consistent).
	wrap_self_keyshare(client.as_ref(), shell, identity_uuid, &dek_plain, dek_ver).await?;

	// The owner is the first member: give it a roster row (populated from identity).
	ensure_aven_ceo_owner_row(client.as_ref(), shell, identity_uuid).await?;

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
	// Generate the identity DEK up-front and seal the trust-root + name cells under it BEFORE
	// the row is written (private-by-default); the same DEK is wrapped to this device below.
	let dek_plain = crate::crypto::random_identity_dek();
	let sparks_oid = ObjectId::new();
	jazz_engine::seal_sensitive_in_row_with_dek(
		dek_plain.expose(),
		"identities",
		&sparks_schema,
		identity_uuid,
		*sparks_oid.uuid(),
		dek_ver,
		&mut row,
	)?;
	let sparks_vals = insert_values("identities", &sparks_schema, row)?;
	let sparks_meta = owner_binding_meta(&shell.signing_key, sparks_oid, identity_uuid)?;
	client
		.create_with_id_and_metadata("identities", sparks_oid, sparks_vals, sparks_meta)
		.await
		.map_err(format_jazz_err)?;

	// Self keyshare: wrap the identity DEK to this device so the owner can read sealed columns.
	wrap_self_keyshare(client.as_ref(), shell, identity_uuid, &dek_plain, dek_ver).await?;

	ensure_aven_ceo_owner_row(client.as_ref(), shell, identity_uuid).await?;
	finish_spark_admin_grant(app, jazz, self_state, client, identity_uuid).await?;
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
	let dek_plain = crate::crypto::random_identity_dek();
	let sparks_oid = ObjectId::new();
	jazz_engine::seal_sensitive_in_row_with_dek(
		dek_plain.expose(),
		"identities",
		&sparks_schema,
		group_id,
		*sparks_oid.uuid(),
		dek_ver,
		&mut row,
	)?;
	let sparks_vals = insert_values("identities", &sparks_schema, row)?;
	let sparks_meta = owner_binding_meta(&shell.signing_key, sparks_oid, group_id)?;
	client
		.create_with_id_and_metadata("identities", sparks_oid, sparks_vals, sparks_meta)
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
/// row already exists. Used at claim and idempotent re-claim.
async fn ensure_aven_ceo_owner_row(
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
	identity_uuid: Uuid,
) -> Result<(), String> {
	let peer_did = shell.peer_did.as_str();
	let signing_key = &shell.signing_key;
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
	let prow_oid = ObjectId::new();
	// Private-by-default: seal account_name/device_label under the identity DEK before
	// materializing the row (routing columns stay plaintext). owner = identity_uuid,
	// object row = this freshly created roster row's oid.
	jazz_engine::seal_sensitive_in_patch(
		shell,
		"peers",
		&peers_schema,
		identity_uuid,
		*prow_oid.uuid(),
		&mut prow,
	)?;
	let prow_vals = insert_values("peers", &peers_schema, prow)?;
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

	update_identity_genesis(client.as_ref(), shell, identity_uuid, genesis_b64).await?;

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
	// Private-by-default: seal account_name/device_label under the identity DEK, scoped
	// to this member's own roster row, before building the patch ops.
	jazz_engine::seal_sensitive_in_patch(
		shell,
		"peers",
		&peers_schema,
		identity_uuid,
		*own_oid.uuid(),
		&mut patch,
	)?;
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
	let owner = crate::identity_acc::identity_peer_is_owner(&bisc.biscuit, identity_uuid, &shell.peer_did)?;
	if owner {
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

async fn enqueue_vault_catalogue_drain(app: &tauri::AppHandle) {
	use std::collections::HashSet;

	let mut tables = HashSet::new();
	for t in identity_sync::VAULT_CATALOGUE_UI_TABLES {
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
	let sparks_oid =
		jazz_engine::find_identity_oid(client.as_ref(), &sparks_schema, identity_uuid).await?;
	let mut patch = Map::new();
	patch.insert("genesis_b64".into(), JsonValue::String(genesis_b64));
	patch.insert("issuer_pubkey_b64".into(), JsonValue::String(issuer_b64));
	patch.insert("current_dek_version".into(), JsonValue::Number(new_v.into()));
	// Seal the rotated trust-root cells under the NEW dek version (new_dek/new_v), NOT the
	// hydrated current one — else the genesis stays readable by the just-revoked peer who still
	// holds the old DEK. current_dek_version itself rides plaintext (routing).
	jazz_engine::seal_sensitive_in_row_with_dek(
		new_dek.expose(),
		"identities",
		&sparks_schema,
		identity_uuid,
		*sparks_oid.uuid(),
		new_v,
		&mut patch,
	)?;
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
			let identity_row = jazz_engine::identity_uuid_row(&tbl, &vals).unwrap_or(shell.default_identity);
			jazz_engine::authorize_gate(
				&shell,
				&table,
				crate::identity_acc::AccOp::Read,
				identity_row,
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
	jazz: &ManagedJazz,
	client: &JazzClient,
	shell: &jazz_engine::ShellState,
	table: &str,
) {
	if !identity_sync::is_spark_data_table(table) {
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
		let identity = jazz_engine::identity_uuid_from_json_row(&tbl, &values)?;
		let vals = insert_values("peers", &tbl, values)?;
		let oid = ObjectId::new();
		let prow_meta = owner_binding_meta(&shell.signing_key, oid, identity)?;
		client
			.create_with_id_and_metadata(&table, oid, vals.clone(), prow_meta)
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

	jazz_engine::inject_default_identity(&mut values, &tbl, shell.default_identity)?;
	let identity_gate = jazz_engine::identity_uuid_from_json_row(&tbl, &values)?;
	jazz_engine::authorize_gate(
		&shell,
		&table,
		crate::identity_acc::AccOp::Write,
		identity_gate,
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
		// Stamp a signed owner-binding (digest-covered) so every peer verifies it on
		// apply; the id is fixed up-front so the binding's value_id == the row id.
		let oid = ObjectId::new();
		let extra_meta = owner_binding_meta(&shell.signing_key, oid, identity_gate)?;
		let oid = client
			.create_with_id_and_metadata(&table, oid, vals.clone(), extra_meta)
			.await
			.map_err(format_jazz_err)?;

	if identity_sync::needs_acl_object_map_refresh_after_create(&table) {
		let _ = jazz.refresh_sync_acl_object_map(client.as_ref()).await;
	}

	if !plaintext.is_empty() {
		let identity = jazz_engine::identity_uuid_row(&tbl, &vals)?;
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
	let identity = jazz_engine::identity_uuid_row(&tbl, &old_vals)?;

	jazz_engine::authorize_gate(
		&shell,
		&table,
		crate::identity_acc::AccOp::Write,
		identity,
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
	let identity = jazz_engine::identity_uuid_row(&tbl, &row_vals)?;

	jazz_engine::authorize_gate(
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

/// Actor-only: real mesh UI snapshot for `meshStatus` IPC — trusted-peer rows
/// + live transport registration (same builder as the pushed snapshot).
pub(crate) async fn execute_mesh_snapshot(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	ss: &SelfState,
) -> Result<PeerMeshStatusReply, String> {
	if !ss.is_unlocked() {
		return Ok(build_peer_mesh_status(
			&[],
			&Default::default(),
			&Default::default(),
			String::new(),
		));
	}
	let client = with_connected_client(jazz, app, ss).await?;
	let rows = crate::peers::list_peer_rows(client.as_ref()).await?;
	let registered = registered_peer_dids(client.as_ref());
	let converged = converged_peer_dids(client.as_ref());
	Ok(build_peer_mesh_status(
		&rows,
		&registered,
		&converged,
		local_pk_prefix_hex(ss),
	))
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
	crate::peers::add_remote_peer(client.as_ref(), &peer_did, &device_label).await?;

	// Resume sync immediately — e.g. re-adding a Forgotten peer. Idempotent with
	// the connect-time registration; harmless (queues until a transport exists)
	// when no live link to this peer is present yet.
	if let Ok(pk) = crate::jazz_auth::ed25519_public_from_peer_did(&peer_did) {
		if let Err(e) = client.register_peer_sync_client(PeerId(pk)) {
			log::warn!(target: "avenos::jazz", "peer_add register {peer_did}: {e}");
		}
	}

	// Reflect the new/reactivated peer in the list + mesh immediately.
	let _ = publish_trusted_peers_ui(app, jazz, self_state).await;
	Ok(())
}

pub(crate) async fn groove_ipc_peer_revoke(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	peer_did: String,
) -> Result<(), String> {
	let client = with_connected_client(jazz, app, self_state).await?;
	crate::peers::set_peer_status(client.as_ref(), &peer_did, "revoked").await?;

	// Actually stop syncing: drop the registered peer client so we no longer
	// ship to it or accept its catch-up. Marking the row alone left the peer
	// live in the mesh — Forget appeared to do nothing.
	if let Ok(pk) = crate::jazz_auth::ed25519_public_from_peer_did(&peer_did) {
		match client.remove_peer_sync_client(PeerId(pk)) {
			Ok(true) => {}
			Ok(false) => log::warn!(
				target: "avenos::jazz",
				"peer_revoke {peer_did}: client had unprocessed inbox; deregister deferred"
			),
			Err(e) => log::warn!(target: "avenos::jazz", "peer_revoke {peer_did}: {e}"),
		}
	}

	// Re-publish the trusted-peer list + mesh snapshot so the row and its chip
	// disappear immediately (replaces the no-op execute_mesh_refresh_full).
	let _ = publish_trusted_peers_ui(app, jazz, self_state).await;
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

/// Announce our frontier to peers after a local identity-scoped write so they pull
/// the change **live**. The engine seal publishes rows locally but does not
/// announce to peers on its own — without this, peers only converge on the next
/// reconnect/catch-up ("syncs on restart, not on the fly"). Idempotent: peers
/// diff our heads and pull only what they're owed + authorized for.
async fn announce_local_write_to_peers(
	app: &tauri::AppHandle,
	mj: &ManagedJazz,
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
		log::debug!(target: "avenos::jazz", "announce local write to peers ({table}): {e}");
	}
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
			let created = groove_ipc_jazz_create(app, mj, ss, table.clone(), values).await?;
			announce_local_write_to_peers(app, mj, ss, &table).await;
			serde_json::to_value(created).map_err(|e| e.to_string())
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
			let updated = groove_ipc_jazz_update(app, mj, ss, table.clone(), id, patch).await?;
			announce_local_write_to_peers(app, mj, ss, &table).await;
			serde_json::to_value(updated).map_err(|e| e.to_string())
		}
		"delete" => {
			let table = pj_str(&pj, "table")?;
			let id = pj_str(&pj, "id")?;
			groove_ipc_jazz_delete(app, mj, ss, table.clone(), id).await?;
			announce_local_write_to_peers(app, mj, ss, &table).await;
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
			let owner = pj_str(&pj, "identityId")?;
			let peer_did = pj_str(&pj, "peerDid")?;
			groove_ipc_spark_admin_add(app, mj, ss, owner, peer_did).await?;
			Ok(serde_json::Value::Null)
		}
		"sparkreplicateadd" => {
			let owner = pj_str(&pj, "identityId")?;
			let peer_did = pj_str(&pj, "peerDid")?;
			groove_ipc_spark_replicate_add(app, mj, ss, owner, peer_did).await?;
			Ok(serde_json::Value::Null)
		}
		"sparkreaderadd" => {
			let owner = pj_str(&pj, "identityId")?;
			let peer_did = pj_str(&pj, "peerDid")?;
			groove_ipc_spark_reader_add(app, mj, ss, owner, peer_did).await?;
			Ok(serde_json::Value::Null)
		}
		"avenceoclaim" => {
			let id = groove_ipc_aven_ceo_claim(app, mj, ss).await?;
			Ok(serde_json::Value::String(id))
		}
		"createidentity" => {
			let name = pj_str(&pj, "name")?;
			let kind = pj_str(&pj, "type").unwrap_or_else(|_| "aven".to_string());
			let id = groove_ipc_create_identity(app, mj, ss, name, kind).await?;
			Ok(serde_json::Value::String(id))
		}
		"creategroup" => {
			let identity = pj_str(&pj, "identityId")?;
			let label = pj_str(&pj, "label")?;
			let id = groove_ipc_create_collection_group(app, mj, ss, identity, label).await?;
			Ok(serde_json::Value::String(id))
		}
		"avenceoaddmember" => {
			let peer_did = pj_str(&pj, "peerDid")?;
			groove_ipc_aven_ceo_add_member(app, mj, ss, peer_did).await?;
			Ok(serde_json::Value::Null)
		}
		"avenceopublishprofile" => {
			let account_name = pj_str(&pj, "accountName")?;
			let device_label = pj_str(&pj, "deviceLabel")?;
			groove_ipc_aven_ceo_publish_profile(app, mj, ss, account_name, device_label).await?;
			Ok(serde_json::Value::Null)
		}
		"avenceomembership" => {
			let m = groove_ipc_aven_ceo_membership(app, mj, ss).await?;
			Ok(serde_json::Value::String(m))
		}
		"sparkadminlist" => {
			let owner = pj_str(&pj, "identityId")?;
			serde_json::to_value(groove_ipc_spark_admin_list(app, mj, ss, owner).await?)
				.map_err(|e| e.to_string())
		}
		"sparkadminrevoke" => {
			let owner = pj_str(&pj, "identityId")?;
			let peer_did = pj_str(&pj, "peerDid")?;
			groove_ipc_spark_admin_revoke(app, mj, ss, owner, peer_did).await?;
			Ok(serde_json::Value::Null)
		}
		other => Err(format!(
			"groove_runtime: unknown op `{other}` — valid ops: bootstrap, status, session, list, explorerList, get, create, update, delete, subscribe, unsubscribe, peerMeshRefresh, meshStatus, peerList, peerAdd, peerRevoke, sparkAdminAdd, sparkAdminList, sparkAdminRevoke, sparkReplicateAdd, sparkReaderAdd, avenCeoClaim"
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
	let p = root.join(AVEN_OS_GROOVE_DATA_DIR);
	if p.exists() {
		fs::remove_dir_all(&p).map_err(|e| format!("remove {}: {e}", p.display()))?;
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

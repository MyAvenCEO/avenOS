//! AvenOS P2P AvenDbClient (RocksDB + Hyperswarm peer transport, no WebSocket server).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use crate::avendb_tokio::TokioRuntime;
use crate::query_manager::manager::LocalUpdates;
use crate::query_manager::query::Query;
use crate::query_manager::types::{Schema, TableName, Value};
use crate::runtime_core::ReadDurabilityOptions;
use crate::schema_manager::{SchemaManager, rehydrate_schema_manager_from_catalogue};
use crate::storage::{RocksDBStorage, Storage, StorageError};
use crate::sync_manager::{
    PeerId, Destination, DurabilityTier, InboxEntry, OutboxEntry, Source, SyncManager,
    SyncPayload,
};
use crate::{AppContext, AvenDbError, ObjectId, Result};

type DynStorage = Box<dyn Storage + Send>;
type ClientRuntime = TokioRuntime<DynStorage>;

#[derive(Clone)]
enum MaybeSyncTransport {
    Off,
    Active(Arc<dyn crate::sync_transport::SyncTransport>),
}

impl Default for MaybeSyncTransport {
    fn default() -> Self {
        Self::Off
    }
}

impl std::fmt::Debug for MaybeSyncTransport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Off => f.write_str("Off"),
            Self::Active(_) => f.write_str("Active(..)"),
        }
    }
}

/// Slot holding the optional peer sync transport. Shared (not a plain field) so the
/// transport can be attached *after* `connect` — the app opens avenDB locally first
/// and wires peer sync in the background, so sign-in never blocks on the transport.
/// The outbound forwarding callback reads this slot on each frame.
type SharedSyncTransport =
    Arc<std::sync::RwLock<Option<Arc<dyn crate::sync_transport::SyncTransport>>>>;

pub struct AvenDbClient {
    runtime: ClientRuntime,
    peer_transport: SharedSyncTransport,
    peer_inbound_task: std::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
}

/// Called after an inbound peer sync frame is parked on the runtime inbox (post-`push_sync_inbox`).
pub type PeerInboundParkedHook = Arc<dyn Fn(&SyncPayload) + Send + Sync>;

fn peer_send_fail_streak() -> &'static Mutex<HashMap<PeerId, u32>> {
	static SLOT: OnceLock<Mutex<HashMap<PeerId, u32>>> = OnceLock::new();
	SLOT.get_or_init(|| Mutex::new(HashMap::new()))
}

fn peer_send_backoff(peer_id: PeerId) -> Duration {
	let mut guard = peer_send_fail_streak()
		.lock()
		.expect("peer send backoff lock");
	let streak = guard.entry(peer_id).or_insert(0);
	*streak = streak.saturating_add(1).min(16);
	let ms = 500u64.saturating_mul(1u64 << (*streak).min(5));
	Duration::from_millis(ms.min(10_000))
}

fn peer_send_backoff_clear(peer_id: PeerId) {
	let _ = peer_send_fail_streak()
		.lock()
		.expect("peer send backoff lock")
		.remove(&peer_id);
}

fn peer_outbound_callback(
    peer_transport: SharedSyncTransport,
    runtime_ready: Arc<OnceLock<ClientRuntime>>,
) -> impl Fn(OutboxEntry) + Send + Sync + 'static {
    use crate::sync_targets::SyncTargetId;

    move |entry: OutboxEntry| {
        let Destination::Client(peer_id) = entry.destination;
        // Read the live transport slot — may be empty until one is attached.
        let tt = peer_transport
            .read()
            .expect("peer_transport rwlock poisoned")
            .clone();
        let Some(tt) = tt else {
            return;
        };
        let Some(rt) = runtime_ready.get() else {
            tracing::warn!("peer outbound before runtime ready; dropping frame");
            return;
        };
        let rt = rt.clone();
        let payload = entry.payload;
        tokio::spawn(async move {
            let outbound = OutboxEntry {
                destination: Destination::Client(peer_id),
                payload: payload.clone(),
            };
            let target = SyncTargetId::Client(peer_id);
            match crate::sync_transport::SyncTransport::send_to(&*tt, target, payload).await {
                Ok(()) => peer_send_backoff_clear(peer_id),
                Err(e) => {
                    let delay = peer_send_backoff(peer_id);
                    tracing::debug!(
                        ?peer_id,
                        ?delay,
                        "peer send failed ({e:?}); re-queueing outbox entry after backoff",
                    );
                    tokio::time::sleep(delay).await;
                    if let Err(prepend_err) = rt.prepend_outbox(outbound) {
                        tracing::warn!("prepend_outbox after send failure: {prepend_err}");
                    }
                }
            }
        });
    }
}

/// Spawn the inbound pump that drains a peer transport into the runtime inbox.
/// Used both at connect (when a transport is provided up front) and by
/// [`AvenDbClient::attach_sync_transport`] (background attach after a local connect).
fn spawn_peer_inbound(
    inbound_runtime: ClientRuntime,
    transport: Arc<dyn crate::sync_transport::SyncTransport>,
    on_inbound_parked: Option<PeerInboundParkedHook>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            match crate::sync_transport::SyncTransport::recv_inbound(&*transport).await {
                None => break,
                Some(entry) => {
                    let payload = entry.payload.clone();
                    if let Err(err) = inbound_runtime.push_sync_inbox(entry) {
                        tracing::warn!("push_sync_inbox (peer inbound): {err}");
                    } else if let Some(hook) = on_inbound_parked.as_ref() {
                        hook(&payload);
                    }
                }
            }
        }
    })
}

fn build_schema_manager(storage: &DynStorage, context: &AppContext) -> Result<SchemaManager> {
    let sync_manager = SyncManager::new();
    let mut schema_manager = SchemaManager::new(
        sync_manager,
        context.schema.clone(),
        context.app_id,
        "client",
        "main",
    )
    .map_err(|e| AvenDbError::Schema(format!("{e:?}")))?;

    rehydrate_schema_manager_from_catalogue(&mut schema_manager, storage.as_ref(), context.app_id)
        .map_err(AvenDbError::Storage)?;

    for old in &context.live_schemas {
        schema_manager
            .add_live_schema(old.clone())
            .map_err(|e| AvenDbError::Schema(format!("live_schema migration: {e:?}")))?;
    }

    Ok(schema_manager)
}

async fn open_persistent_storage(data_dir: &std::path::Path) -> Result<DynStorage> {
    const MAX_ATTEMPTS: usize = 100;
    const RETRY_DELAY_MS: u64 = 25;

    std::fs::create_dir_all(data_dir)?;
    let db_path = data_dir.join("storage.rocksdb");
    let mut opened = None;
    let mut last_err = None;

    for attempt in 0..MAX_ATTEMPTS {
        match RocksDBStorage::open(&db_path, 64 * 1024 * 1024) {
            Ok(storage) => {
                opened = Some(storage);
                break;
            }
            Err(err) => {
                let is_lock_error = matches!(
                    &err,
                    StorageError::IoError(msg)
                        if msg.contains("lock") || msg.contains("Lock") || msg.contains("busy")
                );
                if !is_lock_error || attempt + 1 == MAX_ATTEMPTS {
                    last_err = Some(err);
                    break;
                }
                tokio::time::sleep(Duration::from_millis(RETRY_DELAY_MS)).await;
            }
        }
    }

    opened
        .map(|s| Box::new(s) as DynStorage)
        .ok_or_else(|| {
            AvenDbError::Storage(format!(
                "failed to open rocksdb storage '{}': {:?}",
                db_path.display(),
                last_err
            ))
        })
}

impl AvenDbClient {
    pub async fn connect(context: AppContext) -> Result<Self> {
        Self::do_connect(context, MaybeSyncTransport::Off, None).await
    }

    pub async fn connect_with_sync_transport(
        context: AppContext,
        sync_transport: Arc<dyn crate::sync_transport::SyncTransport>,
        on_inbound_parked: Option<PeerInboundParkedHook>,
    ) -> Result<Self> {
        Self::do_connect(
            context,
            MaybeSyncTransport::Active(sync_transport),
            on_inbound_parked,
        )
        .await
    }

    /// Headless, **stateless** engine for the `aven-node` mini: an in-memory
    /// store (no RocksDB directory, nothing survives a restart) wired to the
    /// given sync transport. The `client_id` bookkeeping file still lives under
    /// `context.data_dir`, but all replicated engine state is in `MemoryStorage`
    /// — so the server is a live rendezvous/relay, not a durable mirror.
    pub async fn connect_headless_in_memory(
        context: AppContext,
        sync_transport: Arc<dyn crate::sync_transport::SyncTransport>,
    ) -> Result<Self> {
        let storage: DynStorage = Box::new(crate::storage::MemoryStorage::new());
        Self::do_connect_with_storage(
            context,
            storage,
            MaybeSyncTransport::Active(sync_transport),
            None,
        )
        .await
    }

    /// Inject the peer-sync capability gate (the app's biscuit-aware resolver).
    pub fn set_resolver(
        &self,
        resolver: std::sync::Arc<dyn crate::capability::CapabilityResolver>,
    ) -> Result<()> {
        self.runtime
            .set_resolver(resolver)
            .map_err(|e| AvenDbError::Sync(format!("set_resolver: {e}")))
    }

    /// Inject the author edit-signer for the local write path. The app provides a signer
    /// backed by its device key so every locally-authored row carries an Ed25519 signature
    /// over its content digest (`EDIT_SIG_META_KEY`), verified on apply by every peer.
    pub fn set_edit_signer(
        &self,
        signer: std::sync::Arc<dyn crate::capability::EditSigner>,
    ) -> Result<()> {
        self.runtime
            .set_edit_signer(signer)
            .map_err(|e| AvenDbError::Sync(format!("set_edit_signer: {e}")))
    }

    /// Inject the owner-binder for the local write path. The app provides a binder backed by its
    /// device key so every locally-authored **owner-scoped** row carries an Ed25519-signed
    /// owner-binding (`OWNER_BINDING_META_KEY`), minted at the deep author funnel and verified on
    /// apply by every peer (board 0037). Required to author any owner-scoped row: the funnel fails
    /// closed without a binder, on every peer, local or syncing, no exceptions.
    pub fn set_owner_binder(
        &self,
        binder: std::sync::Arc<dyn crate::capability::OwnerBinder>,
    ) -> Result<()> {
        self.runtime
            .set_owner_binder(binder)
            .map_err(|e| AvenDbError::Sync(format!("set_owner_binder: {e}")))
    }

    /// Peer client ids with a live registered sync link (for mesh status UI).
    pub fn peer_client_ids(&self) -> Result<Vec<PeerId>> {
        self.runtime
            .peer_client_ids()
            .map_err(|e| AvenDbError::Sync(format!("peer_client_ids: {e}")))
    }

    /// Peers whose frontier is converged from our side — "Up to date" (§10.2).
    pub fn converged_peer_ids(&self) -> Result<Vec<PeerId>> {
        self.runtime
            .converged_peer_ids()
            .map_err(|e| AvenDbError::Sync(format!("converged_peer_ids: {e}")))
    }

    /// Attach (or replace) the peer sync transport *after* a local [`Self::connect`].
    /// This lets the app open avenDB immediately and wire peer sync in the background,
    /// so sign-in never blocks on establishing the transport. Outbound frames begin
    /// flowing as soon as the slot is populated; the inbound pump is (re)spawned here.
    pub fn attach_sync_transport(
        &self,
        sync_transport: Arc<dyn crate::sync_transport::SyncTransport>,
        on_inbound_parked: Option<PeerInboundParkedHook>,
    ) {
        *self
            .peer_transport
            .write()
            .expect("peer_transport rwlock poisoned") = Some(Arc::clone(&sync_transport));
        let task = spawn_peer_inbound(self.runtime.clone(), sync_transport, on_inbound_parked);
        if let Some(old) = self
            .peer_inbound_task
            .lock()
            .expect("peer_inbound_task lock poisoned")
            .replace(task)
        {
            old.abort();
        }
    }

    pub fn register_peer_sync_client(&self, peer_id: PeerId) -> Result<()> {
        self.runtime
            .ensure_client_as_peer(peer_id)
            .map_err(|e| AvenDbError::Sync(format!("ensure_client_as_peer {peer_id}: {e}")))?;
        // Trust bootstrap FIRST: ship sparks/keyshares UNGATED so the peer can
        // obtain the spark + biscuit chain (it cannot authorize gated data
        // otherwise — chicken-and-egg). Then the gated frontier full catch-up.
        self.runtime
            .rebroadcast_peer_shell_catchup(peer_id)
            .map_err(|e| {
                AvenDbError::Sync(format!("rebroadcast_peer_shell_catchup {peer_id}: {e}"))
            })?;
        self.runtime
            .rebroadcast_peer_catchup(peer_id)
            .map_err(|e| AvenDbError::Sync(format!("rebroadcast_peer_catchup {peer_id}: {e}")))?;
        Ok(())
    }

    /// Deregister a peer from P2P sync (Forget / revoke). The frontier is
    /// stateless, so dropping the client simply stops shipping to / accepting
    /// catch-up for this peer — no per-peer ledger to unwind. Returns `false`
    /// if the peer still has unprocessed inbound messages (caller may retry).
    pub fn remove_peer_sync_client(&self, peer_id: PeerId) -> Result<bool> {
        self.runtime
            .remove_client(peer_id)
            .map_err(|e| AvenDbError::Sync(format!("remove_client {peer_id}: {e}")))
    }

    pub fn rebroadcast_peer_catchup(&self, peer_id: PeerId) -> Result<()> {
        self.runtime
            .rebroadcast_peer_catchup(peer_id)
            .map_err(|e| AvenDbError::Sync(format!("rebroadcast_peer_catchup {peer_id}: {e}")))
    }

    pub fn rebroadcast_peer_shell_catchup(&self, peer_id: PeerId) -> Result<()> {
        self.runtime
            .rebroadcast_peer_shell_catchup(peer_id)
            .map_err(|e| AvenDbError::Sync(format!("rebroadcast_peer_shell_catchup {peer_id}: {e}")))
    }

    pub async fn rebroadcast_all_peer_clients_and_flush(&self) -> Result<()> {
        self.runtime
            .rebroadcast_all_peer_clients_and_flush()
            .await
            .map_err(|e| AvenDbError::Sync(format!("rebroadcast_all_peer_clients_and_flush: {e}")))
    }

    pub async fn flush_peer_sync(&self) -> Result<()> {
        self.runtime
            .flush()
            .await
            .map_err(|e| AvenDbError::Sync(format!("flush: {e}")))
    }

    pub fn ingest_peer_sync(&self, from_peer_runtime_id: PeerId, payload: SyncPayload) -> Result<()> {
        let entry = InboxEntry {
            source: Source::Client(from_peer_runtime_id),
            payload,
        };
        self.runtime
            .push_sync_inbox(entry)
            .map_err(|e| AvenDbError::Sync(format!("push_sync_inbox: {e}")))
    }

    async fn do_connect(
        context: AppContext,
        peer_layer: MaybeSyncTransport,
        on_inbound_parked: Option<PeerInboundParkedHook>,
    ) -> Result<Self> {
        let storage: DynStorage = open_persistent_storage(&context.data_dir).await?;
        Self::do_connect_with_storage(context, storage, peer_layer, on_inbound_parked).await
    }

    async fn do_connect_with_storage(
        context: AppContext,
        storage: DynStorage,
        peer_layer: MaybeSyncTransport,
        on_inbound_parked: Option<PeerInboundParkedHook>,
    ) -> Result<Self> {
        std::fs::create_dir_all(&context.data_dir)?;

        let client_id_path = context.data_dir.join("client_id");
        let client_id = if client_id_path.exists() {
            let id_str = std::fs::read_to_string(&client_id_path)?;
            PeerId::parse(id_str.trim()).unwrap_or_else(|| {
                let id = context.client_id.unwrap_or_default();
                let _ = std::fs::write(&client_id_path, id.to_string());
                id
            })
        } else if let Some(id) = context.client_id {
            std::fs::write(&client_id_path, id.to_string())?;
            id
        } else {
            let id = PeerId::new();
            std::fs::write(&client_id_path, id.to_string())?;
            id
        };

        tracing::debug!(client_id = %client_id, "avenDB client identity persisted (sync inbox / peers)");

        let schema_manager = build_schema_manager(&storage, &context)?;
        let peer_transport: SharedSyncTransport = Arc::new(std::sync::RwLock::new(match &peer_layer {
            MaybeSyncTransport::Active(t) => Some(Arc::clone(t)),
            MaybeSyncTransport::Off => None,
        }));
        let runtime_ready: Arc<OnceLock<ClientRuntime>> = Arc::new(OnceLock::new());
        let runtime = TokioRuntime::new(
            schema_manager,
            storage,
            peer_outbound_callback(Arc::clone(&peer_transport), Arc::clone(&runtime_ready)),
        );
        let _ = runtime_ready.set(runtime.clone());

        runtime
            .persist_schema()
            .map_err(|e| AvenDbError::Storage(e.to_string()))?;

        let peer_inbound_task = match peer_layer {
            MaybeSyncTransport::Off => None,
            MaybeSyncTransport::Active(t) => {
                Some(spawn_peer_inbound(runtime.clone(), t, on_inbound_parked))
            }
        };

        Ok(Self {
            runtime,
            peer_transport,
            peer_inbound_task: std::sync::Mutex::new(peer_inbound_task),
        })
    }

    // Board 0027: the lossy push subscription (`subscribe`/`subscribe_internal`/`unsubscribe` →
    // `OrderedRowDelta` over a bounded `try_send` channel that dropped under load) is DELETED.
    // Live reads now reconcile via the reliable frontier feed [`changes_since`]; the UI uses the
    // table-change drain. One freshness mechanism, no drop-under-load footgun.

    /// Register the unseal-on-scan hook (the sealed-data seam, plan §3): the engine
    /// calls it with (table, column, stored value) wherever `nearest`/`text_search`
    /// read values for ranking, so sealed columns rank by their plaintext. Plaintext
    /// exists transiently in RAM only; query results still carry stored rows.
    pub fn set_unseal_hook(
        &self,
        hook: Option<crate::query_manager::graph_nodes::sort::UnsealFn>,
    ) -> Result<()> {
        self.runtime
            .set_unseal(hook)
            .map_err(|e| AvenDbError::Query(format!("set_unseal: {e:?}")))
    }

    pub async fn query(
        &self,
        query: Query,
        durability_tier: Option<DurabilityTier>,
    ) -> Result<Vec<(ObjectId, Vec<Value>)>> {
        let future = self
            .runtime
            .query(
                query,
                None,
                ReadDurabilityOptions {
                    tier: durability_tier,
                    local_updates: LocalUpdates::Immediate,
                },
            )
            .map_err(|e| AvenDbError::Query(e.to_string()))?;
        future
            .await
            .map_err(|e| AvenDbError::Query(format!("{e:?}")))
    }

    /// Schema-checked create BY COLUMN NAME — THE row-write surface (the old positional
    /// `create(Vec<Value>)` is gone: zipping by index let a manifest column-order change
    /// silently corrupt writes). Resolves `fields` against the live schema:
    ///   - unknown column name        → error (caught typos / drift),
    ///   - missing nullable column     → `Null`,
    ///   - missing non-nullable column → error,
    /// then the engine type-checks each value on encode. Prefer this for any hand-built row
    /// (it makes a manifest column-order change incapable of silently corrupting a write).
    /// The current store epoch (board 0026) — an O(1) monotonic token that advances on every
    /// committed history batch (local write OR synced peer apply), independent of row count.
    /// Consumers (e.g. aven-brain's decrypt-once read cache) key their snapshots on it to ask
    /// "has anything changed since I last looked?" without scanning. Process-global.
    pub fn frontier_epoch(&self) -> u64 {
        crate::frontier_epoch::current()
    }

    /// The frontier delta feed (board 0027): the changes since `cursor` + the new cursor. The ONE
    /// reconciliation any consumer uses — brain cache, UI store, remote peer — each holding its own
    /// cursor; `apply` the returned ids to its view (re-read each: present ⇒ upsert, gone ⇒ remove),
    /// or full-rebuild on `Resync`. O(delta) in the changed-row count. `cursor == frontier_epoch()`
    /// ⇒ `Delta([])` (nothing changed).
    pub fn changes_since(&self, cursor: u64) -> (u64, crate::frontier_epoch::Changes) {
        crate::frontier_epoch::changes_since(cursor)
    }

    pub async fn create_checked(
        &self,
        table: &str,
        fields: std::collections::HashMap<String, Value>,
    ) -> Result<ObjectId> {
        let map = self.resolve_named_row(table, fields)?;
        let (object_id, _, _) = self
            .runtime
            .insert(table, map, None)
            .map_err(|e| AvenDbError::Write(e.to_string()))?;
        Ok(object_id)
    }

    /// [`create_checked`] + a caller-supplied id and row metadata (e.g. the owner-binding).
    pub async fn create_checked_with_id_and_metadata(
        &self,
        table: &str,
        object_id: ObjectId,
        fields: std::collections::HashMap<String, Value>,
        extra_metadata: std::collections::HashMap<String, String>,
    ) -> Result<ObjectId> {
        let map = self.resolve_named_row(table, fields)?;
        let (oid, _, _) = self
            .runtime
            .insert_with_id_and_metadata(table, map, Some(object_id), None, extra_metadata)
            .map_err(|e| AvenDbError::Write(e.to_string()))?;
        Ok(oid)
    }

    /// Resolve a name→value map into a full row map in schema order, filling missing
    /// nullable columns with `Null` and rejecting unknown / missing-required columns.
    fn resolve_named_row(
        &self,
        table: &str,
        mut fields: std::collections::HashMap<String, Value>,
    ) -> Result<std::collections::HashMap<String, Value>> {
        let schema = self
            .runtime
            .current_schema()
            .map_err(|e| AvenDbError::Schema(e.to_string()))?;
        let table_schema = schema
            .get(&TableName::new(table))
            .ok_or_else(|| AvenDbError::Schema(format!("table not found: {table}")))?;
        let mut row = std::collections::HashMap::with_capacity(table_schema.columns.columns.len());
        for col in table_schema.columns.columns.iter() {
            let name = col.name.to_string();
            match fields.remove(&name) {
                Some(value) => {
                    row.insert(name, value);
                }
                None if col.nullable => {
                    row.insert(name, Value::Null);
                }
                None => {
                    return Err(AvenDbError::Schema(format!(
                        "create {table}: missing required column `{name}`"
                    )));
                }
            }
        }
        if let Some(unknown) = fields.keys().next() {
            return Err(AvenDbError::Schema(format!(
                "create {table}: unknown column `{unknown}` (not in schema)"
            )));
        }
        // Owner invariant — an owner-bearing table holds owned data ONLY. A table whose
        // `owner` column is non-nullable must never receive a Null/absent owner: reject it on
        // every create path so an ownerless value can't enter an owned (SAFE-scoped) table,
        // zero exceptions. One schema-driven rule (`owner_invariant_ok`), shared & tested.
        if !crate::owner_invariant_ok(table_schema, row.get("owner")) {
            return Err(AvenDbError::Schema(format!(
                "create {table}: owner-bearing table requires a non-null `owner` \
                 (ownerless value rejected)"
            )));
        }
        Ok(row)
    }

    pub async fn update(&self, object_id: ObjectId, updates: Vec<(String, Value)>) -> Result<()> {
        self.runtime
            .update(object_id, updates, None)
            .map_err(|e| AvenDbError::Write(e.to_string()))?;
        Ok(())
    }

    /// Update a row, stamping extra row metadata (e.g. a re-minted owner-binding) into
    /// the edit's batch — so every write is authenticated on apply, not just creates.
    pub async fn update_with_metadata(
        &self,
        object_id: ObjectId,
        updates: Vec<(String, Value)>,
        extra_metadata: std::collections::HashMap<String, String>,
    ) -> Result<()> {
        self.runtime
            .update_with_metadata(object_id, updates, None, extra_metadata)
            .map_err(|e| AvenDbError::Write(e.to_string()))?;
        Ok(())
    }

    pub async fn delete(&self, object_id: ObjectId) -> Result<()> {
        self.runtime
            .delete(object_id, None)
            .map_err(|e| AvenDbError::Write(e.to_string()))?;
        Ok(())
    }

    /// Delete a row, stamping a re-minted owner-binding into the tombstone batch so the
    /// delete is authenticated on apply.
    pub async fn delete_with_metadata(
        &self,
        object_id: ObjectId,
        extra_metadata: std::collections::HashMap<String, String>,
    ) -> Result<()> {
        self.runtime
            .delete_with_metadata(object_id, None, extra_metadata)
            .map_err(|e| AvenDbError::Write(e.to_string()))?;
        Ok(())
    }

    pub async fn schema(&self) -> Result<Schema> {
        self.runtime
            .current_schema()
            .map_err(|e| AvenDbError::Query(e.to_string()))
    }

    pub fn is_connected(&self) -> bool {
        false
    }

    pub async fn shutdown(self) -> Result<()> {
        let task = self
            .peer_inbound_task
            .lock()
            .expect("peer_inbound_task lock poisoned")
            .take();
        if let Some(h) = task {
            h.abort();
            let _ = h.await;
        }

        let transport = self
            .peer_transport
            .write()
            .expect("peer_transport rwlock poisoned")
            .take();
        if let Some(t) = transport {
            if let Err(err) = t.shutdown().await {
                tracing::warn!("PeerTransport::shutdown failed: {err:?}");
            }
        }

        self.runtime
            .flush()
            .await
            .map_err(|e| AvenDbError::Connection(e.to_string()))?;

        self.runtime
            .with_storage(|storage| storage.flush())
            .map_err(|e| AvenDbError::Storage(e.to_string()))
            .and_then(|r| r.map_err(|e| AvenDbError::Storage(e.to_string())))?;

        Ok(())
    }
}
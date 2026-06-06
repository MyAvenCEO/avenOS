//! AvenOS P2P JazzClient (RocksDB + Hyperswarm peer transport, no WebSocket server).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use crate::groove_tokio::{SubscriptionHandle as RuntimeSubHandle, TokioRuntime};
use crate::query_manager::manager::LocalUpdates;
use crate::query_manager::query::Query;
use crate::query_manager::session::Session;
use crate::query_manager::types::{OrderedRowDelta, Schema, TableName, Value};
use crate::runtime_core::ReadDurabilityOptions;
use crate::schema_manager::{SchemaManager, rehydrate_schema_manager_from_catalogue};
use crate::storage::{RocksDBStorage, Storage, StorageError};
use crate::sync_manager::{
    PeerId, Destination, DurabilityTier, InboxEntry, OutboxEntry, Source, SyncManager,
    SyncPayload,
};
use tokio::sync::{RwLock, mpsc};

use crate::{AppContext, JazzError, ObjectId, Result, SubscriptionHandle, SubscriptionStream};

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
/// transport can be attached *after* `connect` — the app opens Groove locally first
/// and wires peer sync in the background, so sign-in never blocks on the transport.
/// The outbound forwarding callback reads this slot on each frame.
type SharedSyncTransport =
    Arc<std::sync::RwLock<Option<Arc<dyn crate::sync_transport::SyncTransport>>>>;

pub struct JazzClient {
    runtime: ClientRuntime,
    subscriptions: Arc<RwLock<HashMap<SubscriptionHandle, SubscriptionState>>>,
    subscription_senders: Arc<RwLock<HashMap<RuntimeSubHandle, mpsc::Sender<OrderedRowDelta>>>>,
    next_handle: std::sync::atomic::AtomicU64,
    peer_transport: SharedSyncTransport,
    peer_inbound_task: std::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
}

struct SubscriptionState {
    runtime_handle: RuntimeSubHandle,
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
/// [`JazzClient::attach_sync_transport`] (background attach after a local connect).
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
    .map_err(|e| JazzError::Schema(format!("{e:?}")))?;

    rehydrate_schema_manager_from_catalogue(&mut schema_manager, storage.as_ref(), context.app_id)
        .map_err(JazzError::Storage)?;

    for old in &context.live_schemas {
        schema_manager
            .add_live_schema(old.clone())
            .map_err(|e| JazzError::Schema(format!("live_schema migration: {e:?}")))?;
    }

    Ok(schema_manager)
}

fn vec_values_to_map(
    schema: &Schema,
    table: &str,
    values: Vec<Value>,
) -> std::result::Result<HashMap<String, Value>, JazzError> {
    let table_name = TableName::new(table);
    let table_schema = schema
        .get(&table_name)
        .ok_or_else(|| JazzError::Schema(format!("table not found: {table}")))?;
    if values.len() != table_schema.columns.columns.len() {
        return Err(JazzError::Schema(format!(
            "column count mismatch for {table}: expected {}, got {}",
            table_schema.columns.columns.len(),
            values.len()
        )));
    }
    let mut map = HashMap::with_capacity(values.len());
    for (col, value) in table_schema.columns.columns.iter().zip(values) {
        map.insert(col.name.to_string(), value);
    }
    Ok(map)
}

async fn open_persistent_storage(data_dir: &std::path::Path) -> Result<DynStorage> {
    const MAX_ATTEMPTS: usize = 100;
    const RETRY_DELAY_MS: u64 = 25;

    std::fs::create_dir_all(data_dir)?;
    let db_path = data_dir.join("storage.rocksdb");
    let legacy_path = data_dir.join("jazz.rocksdb");
    if !db_path.exists() && legacy_path.is_file() {
        std::fs::rename(&legacy_path, &db_path).map_err(|e| {
            JazzError::Storage(format!(
                "migrate jazz.rocksdb→storage.rocksdb: {e}"
            ))
        })?;
    }
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
            JazzError::Storage(format!(
                "failed to open rocksdb storage '{}': {:?}",
                db_path.display(),
                last_err
            ))
        })
}

impl JazzClient {
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

    /// Headless, **stateless** engine for the `aven-server` mini: an in-memory
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

    /// Back-compat alias — prefer [`Self::connect_with_sync_transport`].
    pub async fn connect_with_peer_transport(
        context: AppContext,
        sync_transport: Arc<dyn crate::sync_transport::SyncTransport>,
        on_inbound_parked: Option<PeerInboundParkedHook>,
    ) -> Result<Self> {
        Self::connect_with_sync_transport(context, sync_transport, on_inbound_parked).await
    }

    /// Inject the peer-sync capability gate (the app's biscuit-aware resolver).
    pub fn set_resolver(
        &self,
        resolver: std::sync::Arc<dyn crate::capability::CapabilityResolver>,
    ) -> Result<()> {
        self.runtime
            .set_resolver(resolver)
            .map_err(|e| JazzError::Sync(format!("set_resolver: {e}")))
    }

    /// Peer client ids with a live registered sync link (for mesh status UI).
    pub fn peer_client_ids(&self) -> Result<Vec<PeerId>> {
        self.runtime
            .peer_client_ids()
            .map_err(|e| JazzError::Sync(format!("peer_client_ids: {e}")))
    }

    /// Peers whose frontier is converged from our side — "Up to date" (§10.2).
    pub fn converged_peer_ids(&self) -> Result<Vec<PeerId>> {
        self.runtime
            .converged_peer_ids()
            .map_err(|e| JazzError::Sync(format!("converged_peer_ids: {e}")))
    }

    /// Attach (or replace) the peer sync transport *after* a local [`Self::connect`].
    /// This lets the app open Groove immediately and wire peer sync in the background,
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
            .map_err(|e| JazzError::Sync(format!("ensure_client_as_peer {peer_id}: {e}")))?;
        // Trust bootstrap FIRST: ship sparks/keyshares UNGATED so the peer can
        // obtain the spark + biscuit chain (it cannot authorize gated data
        // otherwise — chicken-and-egg). Then the gated frontier full catch-up.
        self.runtime
            .rebroadcast_peer_shell_catchup(peer_id)
            .map_err(|e| {
                JazzError::Sync(format!("rebroadcast_peer_shell_catchup {peer_id}: {e}"))
            })?;
        self.runtime
            .rebroadcast_peer_catchup(peer_id)
            .map_err(|e| JazzError::Sync(format!("rebroadcast_peer_catchup {peer_id}: {e}")))?;
        Ok(())
    }

    /// Deregister a peer from P2P sync (Forget / revoke). The frontier is
    /// stateless, so dropping the client simply stops shipping to / accepting
    /// catch-up for this peer — no per-peer ledger to unwind. Returns `false`
    /// if the peer still has unprocessed inbound messages (caller may retry).
    pub fn remove_peer_sync_client(&self, peer_id: PeerId) -> Result<bool> {
        self.runtime
            .remove_client(peer_id)
            .map_err(|e| JazzError::Sync(format!("remove_client {peer_id}: {e}")))
    }

    pub fn rebroadcast_peer_catchup(&self, peer_id: PeerId) -> Result<()> {
        self.runtime
            .rebroadcast_peer_catchup(peer_id)
            .map_err(|e| JazzError::Sync(format!("rebroadcast_peer_catchup {peer_id}: {e}")))
    }

    pub fn rebroadcast_peer_shell_catchup(&self, peer_id: PeerId) -> Result<()> {
        self.runtime
            .rebroadcast_peer_shell_catchup(peer_id)
            .map_err(|e| JazzError::Sync(format!("rebroadcast_peer_shell_catchup {peer_id}: {e}")))
    }

    pub async fn rebroadcast_all_peer_clients_and_flush(&self) -> Result<()> {
        self.runtime
            .rebroadcast_all_peer_clients_and_flush()
            .await
            .map_err(|e| JazzError::Sync(format!("rebroadcast_all_peer_clients_and_flush: {e}")))
    }

    pub async fn flush_peer_sync(&self) -> Result<()> {
        self.runtime
            .flush()
            .await
            .map_err(|e| JazzError::Sync(format!("flush: {e}")))
    }

    pub fn ingest_peer_sync(&self, from_peer_runtime_id: PeerId, payload: SyncPayload) -> Result<()> {
        let entry = InboxEntry {
            source: Source::Client(from_peer_runtime_id),
            payload,
        };
        self.runtime
            .push_sync_inbox(entry)
            .map_err(|e| JazzError::Sync(format!("push_sync_inbox: {e}")))
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

        tracing::debug!(client_id = %client_id, "Groove client identity persisted (sync inbox / peers)");

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
            .map_err(|e| JazzError::Storage(e.to_string()))?;

        let subscription_senders: Arc<RwLock<HashMap<RuntimeSubHandle, mpsc::Sender<OrderedRowDelta>>>> =
            Arc::new(RwLock::new(HashMap::new()));

        let peer_inbound_task = match peer_layer {
            MaybeSyncTransport::Off => None,
            MaybeSyncTransport::Active(t) => {
                Some(spawn_peer_inbound(runtime.clone(), t, on_inbound_parked))
            }
        };

        Ok(Self {
            runtime,
            subscriptions: Arc::new(RwLock::new(HashMap::new())),
            subscription_senders,
            next_handle: std::sync::atomic::AtomicU64::new(1),
            peer_transport,
            peer_inbound_task: std::sync::Mutex::new(peer_inbound_task),
        })
    }

    pub async fn subscribe(&self, query: Query) -> Result<SubscriptionStream> {
        self.subscribe_internal(query, None).await
    }

    async fn subscribe_internal(
        &self,
        query: Query,
        session: Option<Session>,
    ) -> Result<SubscriptionStream> {
        let handle = SubscriptionHandle(
            self.next_handle
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst),
        );

        let (tx, rx) = mpsc::channel::<OrderedRowDelta>(64);
        let senders = self.subscription_senders.clone();

        let runtime_handle = self
            .runtime
            .subscribe(
                query.clone(),
                move |delta| {
                    if let Ok(senders_guard) = senders.try_read()
                        && let Some(sender) = senders_guard.get(&delta.handle)
                    {
                        let _ = sender.try_send(delta.ordered_delta);
                    }
                },
                session,
            )
            .map_err(|e| JazzError::Query(e.to_string()))?;

        {
            let mut senders = self.subscription_senders.write().await;
            senders.insert(runtime_handle, tx);
        }

        {
            let mut subs = self.subscriptions.write().await;
            subs.insert(handle, SubscriptionState { runtime_handle });
        }

        Ok(SubscriptionStream::new(rx))
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
            .map_err(|e| JazzError::Query(e.to_string()))?;
        future
            .await
            .map_err(|e| JazzError::Query(format!("{e:?}")))
    }

    pub async fn create(&self, table: &str, values: Vec<Value>) -> Result<ObjectId> {
        let schema = self
            .runtime
            .current_schema()
            .map_err(|e| JazzError::Schema(e.to_string()))?;
        let map = vec_values_to_map(&schema, table, values)?;
        let (object_id, _, _) = self
            .runtime
            .insert(table, map, None)
            .map_err(|e| JazzError::Write(e.to_string()))?;
        Ok(object_id)
    }

    /// Create a row with a caller-supplied id and extra row metadata (e.g. the
    /// owner-binding header). Used by the app to stamp a signed binding whose
    /// `value_id` equals this row id, verified on apply by every peer.
    pub async fn create_with_id_and_metadata(
        &self,
        table: &str,
        object_id: ObjectId,
        values: Vec<Value>,
        extra_metadata: std::collections::HashMap<String, String>,
    ) -> Result<ObjectId> {
        let schema = self
            .runtime
            .current_schema()
            .map_err(|e| JazzError::Schema(e.to_string()))?;
        let map = vec_values_to_map(&schema, table, values)?;
        let (oid, _, _) = self
            .runtime
            .insert_with_id_and_metadata(table, map, Some(object_id), None, extra_metadata)
            .map_err(|e| JazzError::Write(e.to_string()))?;
        Ok(oid)
    }

    pub async fn update(&self, object_id: ObjectId, updates: Vec<(String, Value)>) -> Result<()> {
        self.runtime
            .update(object_id, updates, None)
            .map_err(|e| JazzError::Write(e.to_string()))?;
        Ok(())
    }

    pub async fn delete(&self, object_id: ObjectId) -> Result<()> {
        self.runtime
            .delete(object_id, None)
            .map_err(|e| JazzError::Write(e.to_string()))?;
        Ok(())
    }

    pub async fn unsubscribe(&self, handle: SubscriptionHandle) -> Result<()> {
        let mut subs = self.subscriptions.write().await;
        if let Some(state) = subs.remove(&handle) {
            let mut senders = self.subscription_senders.write().await;
            senders.remove(&state.runtime_handle);
            let _ = self.runtime.unsubscribe(state.runtime_handle);
        }
        Ok(())
    }

    pub async fn schema(&self) -> Result<Schema> {
        self.runtime
            .current_schema()
            .map_err(|e| JazzError::Query(e.to_string()))
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
            .map_err(|e| JazzError::Connection(e.to_string()))?;

        self.runtime
            .with_storage(|storage| storage.flush())
            .map_err(|e| JazzError::Storage(e.to_string()))
            .and_then(|r| r.map_err(|e| JazzError::Storage(e.to_string())))?;

        Ok(())
    }
}
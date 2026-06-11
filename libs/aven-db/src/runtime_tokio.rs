//! Tokio runtime adapter for avenDB.
//!
//! Provides `TokioRuntime<S>` - a thin wrapper around
//! `RuntimeCore<S, TokioScheduler<S>>`
//! that handles async scheduling via `tokio::spawn`.
//!
//! # Architecture
//!
//! - `S: Storage + Send + 'static` provides synchronous storage
//! - `TokioScheduler<S>` implements `Scheduler` using tokio::spawn for batched ticks
//! - `CallbackSyncSender` implements `SyncSender` with a user-provided callback
//! - `TokioRuntime<S>` wraps `Arc<Mutex<RuntimeCore<...>>>`
//! - Methods grab the lock, call RuntimeCore, and return

use std::any::Any;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};

use futures::channel::oneshot;

use crate::object::ObjectId;
use crate::query_manager::query::Query;
use crate::query_manager::session::{Session, WriteContext};
use crate::query_manager::types::{Schema, SchemaHash, Value};
use crate::row_histories::BatchId;
pub use crate::runtime_core::SubscriptionHandle;
use crate::runtime_core::{
    QueryFuture, ReadDurabilityOptions, RuntimeCore, RuntimeError as CoreRuntimeError, Scheduler,
    SubscriptionDelta, SyncSender,
};
use crate::schema_manager::manager::{CurrentPermissionsSummary, PermissionsHeadSummary};
use crate::schema_manager::{Lens, QuerySchemaContext, SchemaManager};
use crate::storage::Storage;
use crate::sync_manager::{PeerId, DurabilityTier, InboxEntry, OutboxEntry, QueryPropagation};

// ============================================================================
// TokioScheduler
// ============================================================================

/// Type alias for the concrete RuntimeCore used by TokioRuntime.
type TokioCoreType<S> = RuntimeCore<S, TokioScheduler<S>>;
type DirectInsertResult = (ObjectId, Vec<Value>, BatchId);

/// Scheduler implementation for Tokio.
///
/// Spawns a tokio task to call `batched_tick()` on the RuntimeCore.
/// Debounced: only one task is scheduled at a time.
pub struct TokioScheduler<S: Storage + Send + 'static> {
    /// Debounce flag for scheduled ticks.
    scheduled: Arc<AtomicBool>,
    /// Weak reference back to RuntimeCore for spawned tasks.
    core_ref: Weak<Mutex<TokioCoreType<S>>>,
}

impl<S: Storage + Send + 'static> TokioScheduler<S> {
    /// Create a new TokioScheduler.
    ///
    /// Note: `core_ref` starts as empty and is set after RuntimeCore is created.
    fn new() -> Self {
        Self {
            scheduled: Arc::new(AtomicBool::new(false)),
            core_ref: Weak::new(),
        }
    }

    /// Set the core reference (called after RuntimeCore is wrapped in Arc<Mutex>).
    fn set_core_ref(&mut self, core_ref: Weak<Mutex<TokioCoreType<S>>>) {
        self.core_ref = core_ref;
    }

    /// Check if a batched_tick is currently scheduled.
    pub fn is_scheduled(&self) -> bool {
        self.scheduled.load(Ordering::SeqCst)
    }
}

impl<S: Storage + Send + 'static> Scheduler for TokioScheduler<S> {
    fn schedule_batched_tick(&self) {
        // Debounce: only schedule if not already scheduled
        if !self.scheduled.swap(true, Ordering::SeqCst) {
            let core_ref = self.core_ref.clone();
            let flag = self.scheduled.clone();

            tokio::spawn(async move {
                // Give bursty transports (notably WebSocket frames emitted back-to-back)
                // one scheduler turn to enqueue related messages before the runtime drains.
                // Without this, a large subscription burst can be observed as many
                // one-message ticks, causing per-query result flushing and delayed
                // tier-settled first deliveries.
                tokio::time::sleep(std::time::Duration::from_millis(1)).await;

                // Acquire the core lock FIRST, then clear the debounce flag
                // immediately before running batched_tick.
                //
                // Clearing the flag before running the tick preserves the
                // lost-wakeup fix: a message arriving while batched_tick
                // executes finds scheduled=false and can schedule a follow-up.
                //
                // Clearing it only after acquiring the lock prevents task
                // pileup: if we cleared earlier, every caller that arrived
                // while this task was blocked on the mutex would see
                // scheduled=false and spawn another task, all piling up
                // behind the same lock. Holding the flag high until we
                // actually own the core caps the queue at one pending tick.
                let Some(core_arc) = core_ref.upgrade() else {
                    // Core is permanently gone. Leave the flag high so any
                    // stray scheduler clones (e.g. NativeTickNotifier) short-
                    // circuit instead of spawning more doomed tasks.
                    tracing::debug!("TokioScheduler: core dropped before tick could run; skipping");
                    return;
                };
                let Ok(mut core) = core_arc.lock() else {
                    // Mutex is poisoned but the core Arc still exists. Clear
                    // the flag so we don't leave a stale "tick queued" signal
                    // behind — callers are free to retry (and fail) on their
                    // own terms.
                    tracing::error!("TokioScheduler: core mutex poisoned; scheduler is unusable");
                    flag.store(false, Ordering::SeqCst);
                    return;
                };
                flag.store(false, Ordering::SeqCst);
                core.batched_tick();
            });
        }
    }
}

// Manual Clone: `S` is not stored by value — the Arc and Weak clones
// are cheap pointer copies that share the underlying allocation.
impl<S: Storage + Send + 'static> Clone for TokioScheduler<S> {
    fn clone(&self) -> Self {
        Self {
            scheduled: Arc::clone(&self.scheduled),
            core_ref: Weak::clone(&self.core_ref),
        }
    }
}

// ============================================================================
// CallbackSyncSender
// ============================================================================

/// SyncSender implementation using a callback.
#[derive(Clone)]
pub struct CallbackSyncSender {
    callback: Arc<dyn Fn(OutboxEntry) + Send + Sync>,
}

impl CallbackSyncSender {
    fn new<F>(callback: F) -> Self
    where
        F: Fn(OutboxEntry) + Send + Sync + 'static,
    {
        Self {
            callback: Arc::new(callback),
        }
    }
}

impl SyncSender for CallbackSyncSender {
    fn send_sync_message(&self, message: OutboxEntry) {
        (self.callback)(message);
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

// ============================================================================
// Errors
// ============================================================================

/// Errors from runtime operations.
#[derive(Debug, Clone)]
pub enum RuntimeError {
    QueryError(String),
    WriteError(String),
    NotFound,
    LockError,
}

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RuntimeError::QueryError(s) => write!(f, "Query error: {}", s),
            RuntimeError::WriteError(s) => write!(f, "Write error: {}", s),
            RuntimeError::NotFound => write!(f, "Not found"),
            RuntimeError::LockError => write!(f, "Lock error"),
        }
    }
}

impl std::error::Error for RuntimeError {}

impl From<CoreRuntimeError> for RuntimeError {
    fn from(e: CoreRuntimeError) -> Self {
        match e {
            CoreRuntimeError::QueryError(s) => RuntimeError::QueryError(s),
            CoreRuntimeError::WriteError(s) => RuntimeError::WriteError(s),
            CoreRuntimeError::NotFound => RuntimeError::NotFound,
            CoreRuntimeError::AnonymousWriteDenied { table, operation } => {
                RuntimeError::WriteError(format!(
                    "anonymous session cannot {} on table {}",
                    operation, table
                ))
            }
        }
    }
}

// ============================================================================
// TokioRuntime
// ============================================================================

/// Tokio runtime for avenDB, generic over storage backend.
///
/// Thin wrapper around `Arc<Mutex<RuntimeCore<S, TokioScheduler<S>>>>`.
/// All methods grab the lock, call RuntimeCore, and return.
/// Async scheduling happens via TokioScheduler.schedule_batched_tick().
pub struct TokioRuntime<S: Storage + Send + 'static> {
    core: Arc<Mutex<TokioCoreType<S>>>,
    /// Installed as `RuntimeCore::sync_sender` and retained here so the
    /// backing callback outlives the core Arc's lifetime.
    _sync_sender: CallbackSyncSender,
    /// Cloned handle to the scheduler (shares Arc-based state with the one inside core).
    /// Stored here so `connect()` can build a `NativeTickNotifier` without locking.
    scheduler: TokioScheduler<S>,
}

// Manual Clone impl — only needs Arc::clone, not S: Clone
impl<S: Storage + Send + 'static> Clone for TokioRuntime<S> {
    fn clone(&self) -> Self {
        Self {
            core: Arc::clone(&self.core),
            _sync_sender: self._sync_sender.clone(),
            scheduler: self.scheduler.clone(),
        }
    }
}

impl<S: Storage + Send + 'static> TokioRuntime<S> {
    /// Create a new TokioRuntime with the given storage backend.
    ///
    /// # Arguments
    /// - `schema_manager` - The SchemaManager to wrap
    /// - `storage` - The storage backend (e.g., MemoryStorage, FjallStorage)
    /// - `sync_callback` - Called when sync messages need to be sent
    pub fn new<F>(schema_manager: SchemaManager, storage: S, sync_callback: F) -> Self
    where
        F: Fn(OutboxEntry) + Send + Sync + 'static,
    {
        let scheduler = TokioScheduler::new();
        let sync_sender = CallbackSyncSender::new(sync_callback);

        // Create RuntimeCore
        let mut core = RuntimeCore::new(schema_manager, storage, scheduler);
        // Install the callback as the runtime's fallback outbox sink so
        // server-side fanout (or any code path without a TransportHandle)
        // still delivers OutboxEntries.
        core.set_sync_sender(Box::new(sync_sender.clone()));

        // Wrap in Arc<Mutex>
        let core_arc = Arc::new(Mutex::new(core));

        // Set the core_ref on the Scheduler
        {
            let mut core_guard = core_arc.lock().unwrap();
            core_guard
                .scheduler_mut()
                .set_core_ref(Arc::downgrade(&core_arc));
        }

        // Clone the scheduler AFTER set_core_ref so the clone shares the
        // Arc<AtomicBool> debounce flag and the Weak core reference.
        let scheduler_clone = {
            let core_guard = core_arc.lock().unwrap();
            (*core_guard.scheduler()).clone()
        };

        Self {
            core: core_arc,
            _sync_sender: sync_sender,
            scheduler: scheduler_clone,
        }
    }

    /// Persist the current schema to the catalogue for server sync.
    pub fn persist_schema(&self) -> Result<ObjectId, RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(core.persist_schema())
    }

    /// Publish any schema object to the local catalogue and in-memory schema manager.
    pub fn publish_schema(&self, schema: Schema) -> Result<ObjectId, RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(core.publish_schema(schema))
    }

    pub fn current_permissions_head(&self) -> Result<Option<PermissionsHeadSummary>, RuntimeError> {
        let core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(core.schema_manager().current_permissions_head())
    }

    pub fn current_permissions(&self) -> Result<Option<CurrentPermissionsSummary>, RuntimeError> {
        let core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(core.schema_manager().current_permissions())
    }

    /// Publish a reviewed lens edge to the local catalogue and active schema manager.
    pub fn publish_lens(&self, lens: &Lens) -> Result<ObjectId, RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(core.publish_lens(lens)?)
    }

    // =========================================================================
    // CRUD Operations
    // =========================================================================

    /// Insert a row into a table.
    pub fn insert(
        &self,
        table: &str,
        values: HashMap<String, Value>,
        session: Option<&Session>,
    ) -> Result<DirectInsertResult, RuntimeError> {
        self.insert_with_id(table, values, None, session)
    }

    /// Insert a row into a table with an optional external row id.
    pub fn insert_with_id(
        &self,
        table: &str,
        values: HashMap<String, Value>,
        object_id: Option<ObjectId>,
        session: Option<&Session>,
    ) -> Result<DirectInsertResult, RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        let owned = session.cloned().map(WriteContext::from_session);
        let ((row_id, row_values), batch_id) =
            core.insert_with_id(table, values, object_id, owned.as_ref())?;
        Ok((row_id, row_values, batch_id))
    }

    /// Insert with an explicit id AND extra row metadata (e.g. an owner-binding header)
    /// merged into the committed row's metadata map — covered by the row digest.
    pub fn insert_with_id_and_metadata(
        &self,
        table: &str,
        values: HashMap<String, Value>,
        object_id: Option<ObjectId>,
        session: Option<&Session>,
        extra_metadata: HashMap<String, String>,
    ) -> Result<DirectInsertResult, RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        let ctx = session
            .cloned()
            .map(WriteContext::from_session)
            .unwrap_or_default()
            .with_extra_metadata(extra_metadata);
        let ((row_id, row_values), batch_id) =
            core.insert_with_id(table, values, object_id, Some(&ctx))?;
        Ok((row_id, row_values, batch_id))
    }

    /// Update a row (partial update by column name).
    pub fn update(
        &self,
        object_id: ObjectId,
        values: Vec<(String, Value)>,
        session: Option<&Session>,
    ) -> Result<BatchId, RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        let owned = session.cloned().map(WriteContext::from_session);
        Ok(core.update(object_id, values, owned.as_ref())?)
    }

    /// Update a row AND merge extra row metadata (e.g. a re-minted owner-binding) into
    /// the resulting batch's metadata — so an edit carries the same authenticated proof
    /// as a create, verified on apply.
    pub fn update_with_metadata(
        &self,
        object_id: ObjectId,
        values: Vec<(String, Value)>,
        session: Option<&Session>,
        extra_metadata: HashMap<String, String>,
    ) -> Result<BatchId, RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        let ctx = session
            .cloned()
            .map(WriteContext::from_session)
            .unwrap_or_default()
            .with_extra_metadata(extra_metadata);
        Ok(core.update(object_id, values, Some(&ctx))?)
    }

    /// Create or update a row with a caller-supplied external row id.
    pub fn upsert_with_id(
        &self,
        table: &str,
        object_id: ObjectId,
        values: HashMap<String, Value>,
        session: Option<&Session>,
    ) -> Result<BatchId, RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        let owned = session.cloned().map(WriteContext::from_session);
        Ok(core.upsert_with_id(table, object_id, values, owned.as_ref())?)
    }

    /// Delete a row.
    pub fn delete(
        &self,
        object_id: ObjectId,
        session: Option<&Session>,
    ) -> Result<BatchId, RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        let owned = session.cloned().map(WriteContext::from_session);
        Ok(core.delete(object_id, owned.as_ref())?)
    }

    /// Delete a row, stamping extra metadata (a re-minted owner-binding) into the
    /// tombstone batch — so deletes are authenticated on apply like any other write.
    pub fn delete_with_metadata(
        &self,
        object_id: ObjectId,
        session: Option<&Session>,
        extra_metadata: HashMap<String, String>,
    ) -> Result<BatchId, RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        let ctx = session
            .cloned()
            .map(WriteContext::from_session)
            .unwrap_or_default()
            .with_extra_metadata(extra_metadata);
        Ok(core.delete(object_id, Some(&ctx))?)
    }

    /// Wait for a batch to settle at the requested durability tier.
    pub fn wait_for_batch(
        &self,
        batch_id: BatchId,
        tier: DurabilityTier,
    ) -> Result<oneshot::Receiver<crate::runtime_core::PersistedWriteAck>, RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(core.wait_for_batch(batch_id, tier)?)
    }

    /// Flush pending operations to storage.
    ///
    /// Call this after CRUD operations if you need to ensure data is persisted
    /// before continuing. Waits for any scheduled batched_tick to complete
    /// and then runs additional ticks until all storage is flushed.
    pub async fn flush(&self) -> Result<(), RuntimeError> {
        let mut attempts = 0;
        loop {
            // Wait for any scheduled batched_tick to complete
            loop {
                let is_scheduled = {
                    let core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
                    core.scheduler().is_scheduled()
                };

                if !is_scheduled {
                    break;
                }

                tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;

                attempts += 1;
                if attempts > 200 {
                    break;
                }
            }

            // Synchronous tick and check if more work was generated
            let has_more_work = {
                let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
                if core.has_storage_write_pending_flush()
                    && core.has_storage_flush_retry_scheduled()
                    && core.has_storage_flush_error()
                    && let Some(error) = core.take_storage_flush_error()
                {
                    return Err(RuntimeError::WriteError(format!(
                        "storage WAL flush failed: {error}"
                    )));
                }
                core.batched_tick();
                core.has_outbound()
                    || core.scheduler().is_scheduled()
                    || core.has_storage_write_pending_flush()
            };

            if !has_more_work {
                break;
            }

            attempts += 1;
            if attempts > 200 {
                break;
            }
        }

        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        if let Some(error) = core.take_storage_flush_error() {
            return Err(RuntimeError::WriteError(format!(
                "storage WAL flush failed: {error}"
            )));
        }
        if core.has_storage_write_pending_flush() {
            return Err(RuntimeError::WriteError(
                "storage WAL flush did not complete".to_string(),
            ));
        }

        Ok(())
    }

    // =========================================================================
    // Queries
    // =========================================================================

    /// Execute a one-shot query with durability options.
    /// Register the unseal-on-scan hook (plan §3 seam): bound into every subsequently
    /// compiled ranking Sort node (`nearest` / `text_search`).
    pub fn set_unseal(
        &self,
        hook: Option<crate::query_manager::graph_nodes::sort::UnsealFn>,
    ) -> Result<(), RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        core.schema_manager_mut().query_manager_mut().set_unseal(hook);
        Ok(())
    }

    pub fn query(
        &self,
        query: Query,
        session: Option<Session>,
        durability: ReadDurabilityOptions,
    ) -> Result<QueryFuture, RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(core.query_with_propagation(query, session, durability, QueryPropagation::Full))
    }

    // =========================================================================
    // Subscriptions
    // =========================================================================

    /// Subscribe to a query with a callback.
    pub fn subscribe<F>(
        &self,
        query: Query,
        callback: F,
        session: Option<Session>,
    ) -> Result<SubscriptionHandle, RuntimeError>
    where
        F: Fn(SubscriptionDelta) + Send + 'static,
    {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        core.subscribe(query, callback, session)
            .map_err(|e| RuntimeError::QueryError(e.to_string()))
    }

    /// Unsubscribe from a query.
    pub fn unsubscribe(&self, handle: SubscriptionHandle) -> Result<(), RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        core.unsubscribe(handle);
        Ok(())
    }

    // =========================================================================
    // Sync Operations
    // =========================================================================

    /// Push a sync message to the inbox (from network).
    pub fn push_sync_inbox(&self, entry: InboxEntry) -> Result<(), RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        core.park_sync_message(entry);
        Ok(())
    }

    /// Inject the peer-sync capability gate (the app's biscuit-aware resolver).
    pub fn set_resolver(
        &self,
        resolver: std::sync::Arc<dyn crate::capability::CapabilityResolver>,
    ) -> Result<(), RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        core.set_resolver(resolver);
        Ok(())
    }

    /// Inject the author edit-signer for the local write path (the app's device-key signer).
    pub fn set_edit_signer(
        &self,
        signer: std::sync::Arc<dyn crate::capability::EditSigner>,
    ) -> Result<(), RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        core.set_edit_signer(signer);
        Ok(())
    }

    /// Peer client ids currently registered for P2P sync (live transport links).
    pub fn peer_client_ids(&self) -> Result<Vec<PeerId>, RuntimeError> {
        let core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(core.peer_client_ids())
    }

    /// Peers whose frontier is converged from our side (§10.2).
    pub fn converged_peer_ids(&self) -> Result<Vec<PeerId>, RuntimeError> {
        let core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(core.converged_peer_ids())
    }

    /// Re-queue a peer outbox entry after a transport send failure (mux not ready yet).
    pub fn prepend_outbox(&self, entry: OutboxEntry) -> Result<(), RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        core.prepend_outbox(entry);
        Ok(())
    }

    /// Push multiple sync messages to the inbox under a single core lock.
    pub fn push_sync_inbox_batch(&self, entries: Vec<InboxEntry>) -> Result<(), RuntimeError> {
        if entries.is_empty() {
            return Ok(());
        }
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        for entry in entries {
            core.park_sync_message(entry);
        }
        Ok(())
    }

    /// Ensure a client exists with the given session.
    ///
    /// A session is always required — callers must authenticate before
    /// registering a client.
    pub fn ensure_client_with_session(
        &self,
        client_id: PeerId,
        session: Session,
    ) -> Result<(), RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        core.ensure_client_with_session(client_id, session);
        Ok(())
    }

    /// Ensure a peer client exists without resetting state.
    pub fn ensure_client_as_peer(&self, client_id: PeerId) -> Result<(), RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        core.ensure_client_as_peer(client_id);
        Ok(())
    }

    /// Ensure a peer client exists and replay catalogue only when its digest is stale.
    pub fn ensure_client_as_peer_with_catalogue_state_hash(
        &self,
        client_id: PeerId,
        remote_catalogue_state_hash: Option<&str>,
    ) -> Result<(), RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        core.ensure_client_as_peer_with_catalogue_state_hash(
            client_id,
            remote_catalogue_state_hash,
        );
        Ok(())
    }

    /// AvenOS: replay all syncable rows to a registered Peer client.
    pub fn rebroadcast_peer_catchup(&self, client_id: PeerId) -> Result<(), RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        core.clear_peer_delivery_ledger(client_id);
        core.rebroadcast_peer_catchup(client_id);
        Ok(())
    }

    /// AvenOS: replay sparks/keyshares only (pairing bootstrap before spark data).
    pub fn rebroadcast_peer_shell_catchup(&self, client_id: PeerId) -> Result<(), RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        core.clear_peer_delivery_ledger(client_id);
        core.rebroadcast_peer_shell_catchup(client_id);
        Ok(())
    }

    /// AvenOS: replay catch-up for every Peer client, then flush outbound sync.
    pub async fn rebroadcast_all_peer_clients_and_flush(&self) -> Result<(), RuntimeError> {
        {
            let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
            core.rebroadcast_all_peer_clients();
        }
        self.flush().await
    }

    /// Remove a client connection.
    ///
    /// Returns `Ok(true)` if removed, `Ok(false)` if skipped due to
    /// unprocessed inbox entries (caller should retry later).
    pub fn remove_client(&self, client_id: PeerId) -> Result<bool, RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(core.remove_client(client_id))
    }

    // =========================================================================
    // Schema Access
    // =========================================================================

    /// Get a clone of the current schema.
    pub fn current_schema(&self) -> Result<Schema, RuntimeError> {
        let core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(core.current_schema().clone())
    }

    /// Return all known schema hashes (for server mode).
    pub fn known_schema_hashes(&self) -> Result<Vec<SchemaHash>, RuntimeError> {
        let core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(core.schema_manager().known_schema_hashes())
    }

    /// Return a canonical digest of the runtime's catalogue state.
    pub fn catalogue_state_hash(&self) -> Result<String, RuntimeError> {
        let core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(core.schema_manager().catalogue_state_hash())
    }

    /// Get a known schema by hash from catalogue state.
    pub fn known_schema(&self, schema_hash: &SchemaHash) -> Result<Option<Schema>, RuntimeError> {
        let core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(core.schema_manager().get_known_schema(schema_hash).cloned())
    }

    /// Return the latest publish timestamp for a schema catalogue object.
    pub fn schema_published_at(
        &self,
        schema_hash: &SchemaHash,
    ) -> Result<Option<u64>, RuntimeError> {
        let core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(core.schema_manager().schema_published_at(schema_hash))
    }

    /// Seed an additional known schema into the in-memory schema manager.
    pub fn add_known_schema(&self, schema: Schema) -> Result<(), RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        core.schema_manager_mut().add_known_schema(schema);
        Ok(())
    }

    /// Access the underlying storage (for flushing, etc).
    ///
    /// The callback receives `&S` while holding the core lock.
    pub fn with_storage<R>(&self, f: impl FnOnce(&S) -> R) -> Result<R, RuntimeError> {
        let core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(f(core.storage()))
    }

    /// Access the underlying schema manager while holding the core lock.
    pub fn with_schema_manager<R>(
        &self,
        f: impl FnOnce(&SchemaManager) -> R,
    ) -> Result<R, RuntimeError> {
        let core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        Ok(f(core.schema_manager()))
    }

    /// Subscribe to a query with explicit schema context (for server use).
    pub fn subscribe_with_schema_context(
        &self,
        query: Query,
        schema_context: &QuerySchemaContext,
        session: Option<Session>,
    ) -> Result<crate::sync_manager::QueryId, RuntimeError> {
        let mut core = self.core.lock().map_err(|_| RuntimeError::LockError)?;
        let result = core
            .subscribe_with_schema_context(query, schema_context, session)
            .map_err(|e| RuntimeError::QueryError(e.to_string()))?;
        Ok(result)
    }

    /// Return a reference to the scheduler stored on this runtime handle.
    ///
    /// The returned scheduler shares `Arc`-based state with the one inside
    /// `RuntimeCore` (same debounce flag, same `Weak` back-reference), so
    /// calling `schedule_batched_tick()` on it is equivalent to calling it
    /// from within the locked core.
    pub fn scheduler(&self) -> &TokioScheduler<S> {
        &self.scheduler
    }

    /// Attach a sync-message tracer for diagnostics/tests.
    pub fn set_sync_tracer(&self, tracer: crate::sync_tracer::SyncTracer, name: String) {
        if let Ok(mut core) = self.core.lock() {
            core.set_sync_tracer(tracer, name);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query_manager::types::{ColumnType, SchemaBuilder, TableSchema};
    use crate::schema_manager::AppId;
    use crate::storage::{MemoryStorage, StorageError};
    use crate::sync_manager::SyncManager;
    use std::sync::atomic::AtomicUsize;

    fn test_schema() -> Schema {
        SchemaBuilder::new()
            .table(
                TableSchema::builder("users")
                    .column("id", ColumnType::Uuid)
                    .column("name", ColumnType::Text),
            )
            .build()
    }

    fn user_row_values(id: ObjectId, name: &str) -> Vec<Value> {
        vec![Value::Uuid(id), Value::Text(name.to_string())]
    }

    fn user_insert_values(id: ObjectId, name: &str) -> HashMap<String, Value> {
        HashMap::from([
            ("id".to_string(), Value::Uuid(id)),
            ("name".to_string(), Value::Text(name.to_string())),
        ])
    }

    #[tokio::test]
    async fn test_runtime_insert_query() {
        let schema = test_schema();
        let app_id = AppId::from_name("test-app");
        let sync_manager = SyncManager::new();
        let schema_manager =
            SchemaManager::new(sync_manager, schema, app_id, "dev", "main").unwrap();

        let sync_count = Arc::new(AtomicUsize::new(0));
        let sync_count_clone = sync_count.clone();

        let runtime = TokioRuntime::new(schema_manager, MemoryStorage::new(), move |_msg| {
            sync_count_clone.fetch_add(1, Ordering::SeqCst);
        });

        // Insert a row
        let user_id = ObjectId::new();
        let expected_values = user_row_values(user_id, "Alice");
        let (object_id, row_values, _batch_id) = runtime
            .insert("users", user_insert_values(user_id, "Alice"), None)
            .unwrap();
        assert!(!object_id.0.is_nil());
        assert_eq!(row_values, expected_values);

        // Query
        let query = Query::new("users");
        let future = runtime
            .query(query, None, ReadDurabilityOptions::default())
            .unwrap();
        let results = future.await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, object_id);
    }

    #[tokio::test]
    async fn test_runtime_update_delete() {
        let schema = test_schema();
        let app_id = AppId::from_name("test-crud");
        let sync_manager = SyncManager::new();
        let schema_manager =
            SchemaManager::new(sync_manager, schema, app_id, "dev", "main").unwrap();

        let runtime = TokioRuntime::new(schema_manager, MemoryStorage::new(), |_| {});

        // Insert
        let (object_id, _row_values, _batch_id) = runtime
            .insert("users", user_insert_values(ObjectId::new(), "Bob"), None)
            .unwrap();

        // Update
        let updates = vec![("name".to_string(), Value::Text("Charlie".to_string()))];
        runtime.update(object_id, updates, None).unwrap();

        // Verify update
        let query = Query::new("users");
        let future = runtime
            .query(query, None, ReadDurabilityOptions::default())
            .unwrap();
        let results = future.await.unwrap();
        assert_eq!(results[0].1[1], Value::Text("Charlie".to_string()));

        // Delete
        runtime.delete(object_id, None).unwrap();

        // Verify deleted
        let query = Query::new("users");
        let future = runtime
            .query(query, None, ReadDurabilityOptions::default())
            .unwrap();
        let results = future.await.unwrap();
        assert_eq!(results.len(), 0);
    }

    #[tokio::test]
    async fn flush_returns_error_when_wal_flush_fails() {
        let schema = test_schema();
        let app_id = AppId::from_name("test-wal-flush-failure");
        let sync_manager = SyncManager::new();
        let schema_manager =
            SchemaManager::new(sync_manager, schema, app_id, "dev", "main").unwrap();

        let storage = MemoryStorage::new().with_flush_wal_error(StorageError::IoError(
            "injected WAL flush failure".to_string(),
        ));
        let runtime = TokioRuntime::new(schema_manager, storage, |_| {});

        runtime
            .insert("users", user_insert_values(ObjectId::new(), "Alice"), None)
            .unwrap();

        let error = runtime
            .flush()
            .await
            .expect_err("explicit runtime flush should surface WAL flush failure");
        assert!(
            error.to_string().contains("injected WAL flush failure"),
            "unexpected error: {error}"
        );
        let flush_wal_calls = runtime
            .with_storage(|storage| storage.flush_wal_call_count())
            .expect("inspect storage calls");
        assert!(
            flush_wal_calls <= 2,
            "persistent WAL flush failures should not be retried in a tight loop, got {flush_wal_calls} attempts"
        );
    }

    #[tokio::test]
    async fn flush_recovers_after_transient_wal_flush_failure() {
        let schema = test_schema();
        let app_id = AppId::from_name("test-transient-wal-flush-failure");
        let sync_manager = SyncManager::new();
        let schema_manager =
            SchemaManager::new(sync_manager, schema, app_id, "dev", "main").unwrap();

        let storage = MemoryStorage::new().with_transient_flush_wal_failures(
            StorageError::IoError("transient WAL flush failure".to_string()),
            1,
        );
        let runtime = TokioRuntime::new(schema_manager, storage, |_| {});

        runtime
            .insert("users", user_insert_values(ObjectId::new(), "Alice"), None)
            .unwrap();

        runtime
            .flush()
            .await
            .expect("explicit runtime flush should retry transient WAL flush failure");
    }

    #[tokio::test]
    async fn flush_retries_stored_wal_error_before_returning_failure() {
        let schema = test_schema();
        let app_id = AppId::from_name("test-stored-wal-flush-error");
        let sync_manager = SyncManager::new();
        let schema_manager =
            SchemaManager::new(sync_manager, schema, app_id, "dev", "main").unwrap();
        let runtime = TokioRuntime::new(schema_manager, MemoryStorage::new(), |_| {});

        {
            let mut core = runtime.core.lock().expect("lock runtime core");
            core.mark_storage_write_pending_flush();
            core.record_storage_flush_error(StorageError::IoError(
                "previous transient WAL flush failure".to_string(),
            ));
        }

        runtime
            .flush()
            .await
            .expect("explicit runtime flush should retry the pending WAL barrier");

        let flush_wal_calls = runtime
            .with_storage(|storage| storage.flush_wal_call_count())
            .expect("inspect storage calls");
        assert_eq!(flush_wal_calls, 1);
    }

    #[tokio::test]
    async fn test_subscription_callback() {
        use std::sync::Mutex;

        let schema = test_schema();
        let app_id = AppId::from_name("test-subscription");
        let sync_manager = SyncManager::new();
        let schema_manager =
            SchemaManager::new(sync_manager, schema, app_id, "dev", "main").unwrap();

        let runtime = TokioRuntime::new(schema_manager, MemoryStorage::new(), |_| {});

        // Track callback invocations
        let updates: Arc<Mutex<Vec<SubscriptionDelta>>> = Arc::new(Mutex::new(Vec::new()));
        let updates_clone = updates.clone();

        // Subscribe to users table
        let query = Query::new("users");
        let handle = runtime
            .subscribe(
                query,
                move |delta| {
                    updates_clone.lock().unwrap().push(delta);
                },
                None,
            )
            .unwrap();

        // Insert a row - this should trigger the subscription callback
        let (_object_id, _row_values, _batch_id) = runtime
            .insert("users", user_insert_values(ObjectId::new(), "Eve"), None)
            .unwrap();

        // Verify callback was invoked
        let updates_vec = updates.lock().unwrap();
        assert!(
            !updates_vec.is_empty(),
            "Subscription callback should have been invoked after insert"
        );
        assert_eq!(updates_vec[0].handle, handle);

        // Cleanup
        drop(updates_vec);
        runtime.unsubscribe(handle).unwrap();
    }
}

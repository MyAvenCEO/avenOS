use std::collections::{HashMap, HashSet};

use crate::batch_fate::BatchFate;
use crate::catalogue::CatalogueEntry;
use crate::object::{BranchName, ObjectId};
use crate::query_manager::session::Session;
use crate::query_manager::types::SchemaHash;
use crate::row_histories::{BatchId, RowVisibilityChange};
use crate::storage::{metadata_from_row_locator, PreparedRowTableContext, Storage};

// Module declarations
pub mod clock;
pub mod forwarding;
pub mod inbox;
pub mod sync_logic;
pub mod sync_tracer;
pub mod types;

use clock::MonotonicClock;

// Re-export all public types
pub use types::*;

// ============================================================================
// M5 — relay/sync abuse caps: per-peer inbound rate limiting
// ============================================================================

/// Rate-limit window length, microseconds (1s).
const INBOUND_RATE_WINDOW_US: u64 = 1_000_000;
/// Max inbound payloads accepted from one peer per window before throttling.
/// Deliberately generous — only catches a pathological flood, never legitimate
/// catch-up bursts. A malicious peer can't turn a relay into an unbounded sink.
const INBOUND_MAX_BATCHES_PER_WINDOW: u32 = 50_000;

/// Max size of a single inbound row value (M5 "max db-value size" abuse cap).
/// Generous (64 MiB) — only rejects a pathologically huge value, not legitimate
/// files; bounds how much one write can cost a relay's storage.
const MAX_INBOUND_ROW_BYTES: usize = 64 * 1024 * 1024;

/// Per-peer inbound rate window (M5). A fixed window: count resets when the
/// window rolls; over-budget payloads in a window are dropped at the sync edge.
#[derive(Debug, Clone, Default)]
pub(super) struct InboundRate {
    window_start_us: u64,
    batches: u32,
}


// ============================================================================
// SyncManager
// ============================================================================

/// Manages synchronization state atop storage-backed row and catalogue state.
///
/// Coordinates:
/// - Upstream servers (trusted, receive all our objects)
/// - Downstream clients (untrusted, receive query-filtered subsets)
#[derive(Clone)]
pub struct SyncManager {
    pub(super) clock: MonotonicClock,
    pub(super) catalogue_entries: HashMap<ObjectId, CatalogueEntry>,
    pub(super) allow_unprivileged_schema_catalogue_writes: bool,

    pub(super) clients: HashMap<PeerId, ClientState>,
    /// Peers whose last `ship_frontier_diff` found nothing owed (frontier
    /// converged from our side). Cleared on any local change/announce. Drives the
    /// "Up to date" mesh status (§10.2) — not a delivery ledger: it stores no
    /// per-batch state and dropping it only forces a re-diff.
    pub(super) converged_peers: HashSet<PeerId>,

    /// Per-peer inbound rate-limit windows (M5 abuse caps). Flood/DoS protection
    /// at the sync edge: a peer exceeding the per-window batch budget has further
    /// inbound payloads dropped until its window rolls.
    pub(super) inbound_rate: HashMap<PeerId, InboundRate>,

    /// Per-identity storage accounting for the relay quota (M7-3 "Sync & Backup"
    /// bound). `quota_row_bytes` maps a stored object → (quota_key, bytes) so a
    /// re-delivered row updates rather than double-counts; `quota_owner_bytes` is
    /// the running per-key total checked against the resolver's limit. Empty/unused
    /// unless the resolver returns a `quota_for` key (the aven-node policy).
    pub(super) quota_row_bytes: HashMap<ObjectId, (String, u64)>,
    pub(super) quota_owner_bytes: HashMap<String, u64>,

    pub(super) inbox: Vec<InboxEntry>,
    pub(super) outbox: Vec<OutboxEntry>,
    /// Row visibility changes applied through row-history sync.
    pub(super) pending_row_visibility_changes: Vec<RowVisibilityChange>,
    /// Catalogue/system entry updates awaiting SchemaManager processing.
    pub(super) pending_catalogue_updates: Vec<CatalogueEntry>,

    pub(super) next_pending_id: u64,

    /// This node's durability identities (empty = don't emit durability notifications).
    pub(super) my_tiers: HashSet<DurabilityTier>,
    /// Tracks which clients are interested in row batch-member state updates.
    pub(super) row_batch_interest: HashMap<RowBatchKey, HashSet<PeerId>>,
    /// Tracks clients that explicitly requested the current or next known fate
    /// for a batch whose row member state may not be present on this peer.
    pub(super) batch_fate_interest: HashMap<BatchId, HashSet<PeerId>>,

    /// Pending replayable batch fates for RuntimeCore to process.
    pub(super) pending_batch_fates: Vec<BatchFate>,

    /// Batch fates to send to clients after a full inbox batch has been processed.
    pub(super) pending_client_batch_fates: HashMap<PeerId, HashSet<BatchId>>,
    /// Per-sync-manager replay cache for table/schema row write context.
    ///
    /// Incoming sync rows usually carry table + origin schema metadata. Rows in
    /// a large replay share this context, so cache it above the per-row
    /// visibility work instead of re-resolving descriptors and raw table IDs
    /// from storage for every row.
    pub(super) replay_table_contexts:
        HashMap<(String, SchemaHash), std::sync::Arc<PreparedRowTableContext>>,

    /// The single peer-sync authorizer (§6 gate). `AllowAll` by default
    /// (local-only / tests); the app injects its biscuit-aware resolver.
    pub(super) resolver: std::sync::Arc<dyn crate::capability::CapabilityResolver>,

    /// App-installed author edit-signer for the local write path (`None` until the app
    /// calls `set_edit_signer`). Invoked by `authored_row_batch` to stamp an
    /// `EDIT_SIG_META_KEY` signature over each locally-authored row's content digest.
    pub(super) edit_signer: Option<std::sync::Arc<dyn crate::capability::EditSigner>>,
}

impl std::fmt::Debug for SyncManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SyncManager")
            .field("clock", &self.clock)
            .field("catalogue_entries", &self.catalogue_entries)
            .field(
                "allow_unprivileged_schema_catalogue_writes",
                &self.allow_unprivileged_schema_catalogue_writes,
            )
            .field("clients", &self.clients)
            .field("inbox", &self.inbox)
            .field("outbox", &self.outbox)
            .field(
                "pending_row_visibility_changes",
                &self.pending_row_visibility_changes,
            )
            .field("pending_catalogue_updates", &self.pending_catalogue_updates)
            .field("next_pending_id", &self.next_pending_id)
            .field("my_tiers", &self.my_tiers)
            .field("row_batch_interest", &self.row_batch_interest)
            .field("batch_fate_interest", &self.batch_fate_interest)
            .field("pending_batch_fates", &self.pending_batch_fates)
            .field(
                "pending_client_batch_fates",
                &self.pending_client_batch_fates,
            )
            .finish()
    }
}

impl Default for SyncManager {
    fn default() -> Self {
        Self::new()
    }
}

fn short_hash(hash: &impl ToString) -> String {
    hash.to_string().chars().take(12).collect()
}

pub(crate) fn log_schema_warning(
    warning: &SchemaWarning,
    origin: Option<&str>,
    subscription_id: Option<u64>,
) {
    tracing::warn!(
        origin = origin,
        sub_id = subscription_id,
        query_id = warning.query_id.0,
        table = warning.table_name,
        row_count = warning.row_count,
        from_hash = %warning.from_hash,
        to_hash = %warning.to_hash,
        "Detected {} rows of {} with differing schema versions. To ensure data visibility and forward/backward compatibility, run `npx jazz-tools@alpha schema export --schema-hash {}`. Then generate a migration with `npx jazz-tools@alpha migrations create --fromHash {} --toHash <targetHash>`.",
        warning.row_count,
        warning.table_name,
        short_hash(&warning.from_hash),
        short_hash(&warning.from_hash),
    );
}

impl SyncManager {
    pub fn new() -> Self {
        Self {
            clock: MonotonicClock::new(),
            catalogue_entries: HashMap::new(),
            allow_unprivileged_schema_catalogue_writes: false,
            clients: HashMap::new(),
            converged_peers: HashSet::new(),
            inbound_rate: HashMap::new(),
            quota_row_bytes: HashMap::new(),
            quota_owner_bytes: HashMap::new(),
            inbox: Vec::new(),
            outbox: Vec::new(),
            pending_row_visibility_changes: Vec::new(),
            pending_catalogue_updates: Vec::new(),
            next_pending_id: 0,
            my_tiers: HashSet::new(),
            row_batch_interest: HashMap::new(),
            batch_fate_interest: HashMap::new(),
            pending_batch_fates: Vec::new(),
            pending_client_batch_fates: HashMap::new(),
            replay_table_contexts: HashMap::new(),
            // Fail-closed by default (M4): a peer that never installs a real
            // resolver denies all sync rather than silently running open. Production
            // peers (app + server) always `set_resolver`; tests that need sync opt
            // into `AllowAllResolver` explicitly.
            resolver: std::sync::Arc::new(crate::capability::DenyAllResolver),
            edit_signer: None,
        }
    }

    /// Inject the peer-sync authorizer (§6 gate). The app provides its
    /// biscuit-aware resolver; tests / local-only opt into `AllowAll` explicitly.
    pub fn set_resolver(&mut self, resolver: std::sync::Arc<dyn crate::capability::CapabilityResolver>) {
        self.resolver = resolver;
    }

    /// Inject the author edit-signer for the local write path. The app provides a signer
    /// backed by its device key; without it, locally-authored rows carry no edit-signature.
    pub fn set_edit_signer(&mut self, signer: std::sync::Arc<dyn crate::capability::EditSigner>) {
        self.edit_signer = Some(signer);
    }

    pub fn reserve_timestamp(&mut self) -> u64 {
        self.clock.reserve_timestamp()
    }

    /// Add a durability identity for this node (enables durability notifications).
    pub fn with_durability_tier(mut self, tier: DurabilityTier) -> Self {
        self.my_tiers.insert(tier);
        self
    }

    /// Allow authenticated user clients to publish structural schema catalogue
    /// objects directly. Intended for development servers only.
    pub fn with_unprivileged_schema_catalogue_writes(mut self) -> Self {
        self.allow_unprivileged_schema_catalogue_writes = true;
        self
    }

    /// Add multiple durability identities for this node.
    pub fn with_durability_tiers<I>(mut self, tiers: I) -> Self
    where
        I: IntoIterator<Item = DurabilityTier>,
    {
        self.my_tiers.extend(tiers);
        self
    }

    /// True when this runtime instance represents a durability tier identity
    /// (worker/edge/global) rather than a top-level client.
    pub fn has_durability_identity(&self) -> bool {
        !self.my_tiers.is_empty()
    }

    /// True when this node can satisfy acknowledgements for the requested tier
    /// using one of its local durability identities.
    pub fn has_local_durability_at_least(&self, requested_tier: DurabilityTier) -> bool {
        self.my_tiers
            .iter()
            .any(|local_tier| *local_tier >= requested_tier)
    }

    /// Return this node's local durability identities.
    pub fn local_durability_tiers(&self) -> HashSet<DurabilityTier> {
        self.my_tiers.clone()
    }

    /// Return the strongest durability tier this node can attest to locally.
    pub fn max_local_durability_tier(&self) -> Option<DurabilityTier> {
        self.my_tiers.iter().copied().max()
    }

    /// Approximate heap-backed memory owned by sync state, grouped for benches.
    ///
    /// Returns `(catalogue, connections, subscriptions, queues, total)`.
    pub fn memory_size(&self) -> (usize, usize, usize, usize, usize) {
        let mut catalogue = 0usize;
        for (object_id, entry) in &self.catalogue_entries {
            catalogue += std::mem::size_of_val(object_id);
            catalogue += std::mem::size_of_val(entry);
            catalogue += 48;
        }

        let mut connections = 0usize;
        for (client_id, state) in &self.clients {
            connections += std::mem::size_of_val(client_id);
            connections += std::mem::size_of_val(state);
            connections += 48;
            if let Some(session) = &state.session {
                connections += session.user_id.len();
            }
        }
        connections += self.my_tiers.len() * std::mem::size_of::<DurabilityTier>();

        let mut subscriptions = 0usize;
        for (row_batch_key, clients) in &self.row_batch_interest {
            subscriptions += std::mem::size_of_val(row_batch_key);
            subscriptions += clients.len() * std::mem::size_of::<PeerId>();
            subscriptions += 48;
        }
        for (batch_id, clients) in &self.batch_fate_interest {
            subscriptions += std::mem::size_of_val(batch_id);
            subscriptions += clients.len() * std::mem::size_of::<PeerId>();
            subscriptions += 48;
        }

        let queues = self.inbox.len() * std::mem::size_of::<InboxEntry>()
            + self.outbox.len() * std::mem::size_of::<OutboxEntry>()
            + self.pending_row_visibility_changes.len()
                * std::mem::size_of::<RowVisibilityChange>()
            + self.pending_catalogue_updates.len() * std::mem::size_of::<CatalogueEntry>()
            + self.pending_batch_fates.len() * std::mem::size_of::<BatchFate>()
            + self
                .pending_client_batch_fates
                .values()
                .map(|batch_ids| {
                    std::mem::size_of::<PeerId>()
                        + batch_ids.len() * std::mem::size_of::<BatchId>()
                })
                .sum::<usize>();

        let total = catalogue + connections + subscriptions + queues;
        (catalogue, connections, subscriptions, queues, total)
    }

    // ========================================================================
    // Connection Management
    // ========================================================================

    /// Add a client connection without automatically replaying catalogue state.
    pub fn add_client(&mut self, client_id: PeerId) {
        self.clients.insert(client_id, ClientState::default());
    }

    /// Add a client connection using storage-backed catalogue replay.
    pub fn add_client_with_storage<H: Storage>(&mut self, storage: &H, client_id: PeerId) {
        self.add_client(client_id);
        self.queue_catalogue_sync_to_client_from_storage(client_id, storage);
    }

    /// Replay catalogue entries to a client when its digest is missing or stale.
    ///
    /// Returns true when a replay was queued.
    pub fn queue_catalogue_sync_to_client_if_hash_mismatch<H: Storage>(
        &mut self,
        storage: &H,
        client_id: PeerId,
        remote_catalogue_state_hash: Option<&str>,
        local_catalogue_state_hash: &str,
    ) -> bool {
        if remote_catalogue_state_hash == Some(local_catalogue_state_hash) {
            return false;
        }

        self.queue_catalogue_sync_to_client_from_storage(client_id, storage);
        true
    }

    /// Remove a client connection and all associated state.
    ///
    /// Returns `false` if the client has unprocessed inbox entries — the
    /// caller should retry later to avoid dropping data that hasn't been
    /// persisted to storage yet.
    pub fn remove_client(&mut self, client_id: PeerId) -> bool {
        let has_inbox = self
            .inbox
            .iter()
            .any(|e| e.source == Source::Client(client_id));

        if has_inbox {
            tracing::warn!(
                %client_id,
                "skipping reap: client has unprocessed inbox entries"
            );
            return false;
        }

        self.clients.remove(&client_id);
        // Clean up interest map
        self.row_batch_interest.retain(|_, clients| {
            clients.remove(&client_id);
            !clients.is_empty()
        });
        self.batch_fate_interest.retain(|_, clients| {
            clients.remove(&client_id);
            !clients.is_empty()
        });
        // Drop queued outbox messages for this client
        self.outbox
            .retain(|e| e.destination != Destination::Client(client_id));
        true
    }

    /// Get client state.
    pub fn get_client(&self, client_id: PeerId) -> Option<&ClientState> {
        self.clients.get(&client_id)
    }

    /// Set the session for a client.
    pub fn set_client_session(&mut self, client_id: PeerId, session: Session) {
        if let Some(client) = self.clients.get_mut(&client_id) {
            client.session = Some(session);
        }
    }

    /// AvenOS: replay catalogue + all syncable visible rows to a Peer client.
    pub fn queue_full_catchup_to_peer_with_storage<H: Storage>(
        &mut self,
        storage: &H,
        client_id: PeerId,
    ) {
        if self.clients.get(&client_id).is_none() {
            return;
        }

        self.queue_catalogue_sync_to_client_from_storage(client_id, storage);

        // Frontier catch-up (§1.3): announce our heads; the peer pulls only what
        // it's owed via FrontierNeed → ship_frontier_diff. No row-by-row blanket
        // push, no per-peer ledger — the diff is the single delivery decision.
        let heads = self.resource_frontier_heads(storage);
        self.outbox.push(OutboxEntry {
            destination: Destination::Client(client_id),
            payload: SyncPayload::FrontierAnnounce {
                resource: "all".to_string(),
                heads,
            },
        });
    }

    /// No-op: peer sync is frontier-driven (no per-peer delivery ledger). Kept for
    /// call-site compatibility — a re-catch-up just re-announces and re-diffs.
    pub fn clear_peer_delivery_ledger(&mut self, _client_id: PeerId) {}

    /// No-op: see [`Self::clear_peer_delivery_ledger`].
    pub fn clear_all_peer_delivery_ledgers(&mut self) {}

    /// Tables replicated in the first bootstrap pass (biscuit shell before spark data).
    pub const SHELL_CATCHUP_TABLES: &'static [&'static str] = &["sparks", "keyshares"];

    /// AvenOS: replay catalogue + vault shell rows only (pairing bootstrap).
    pub fn queue_shell_catchup_to_peer_with_storage<H: Storage>(
        &mut self,
        storage: &H,
        client_id: PeerId,
    ) {
        if self.clients.get(&client_id).is_none() {
            return;
        }

        self.queue_catalogue_sync_to_client_from_storage(client_id, storage);

        let Ok(locators) = storage.scan_row_locators() else {
            return;
        };

        for (object_id, locator) in locators {
            let table = locator.table.as_str();
            if !Self::SHELL_CATCHUP_TABLES.contains(&table) {
                continue;
            }
            let metadata = metadata_from_row_locator(&locator);
            if metadata
                .get(crate::metadata::MetadataKey::NoSync.as_str())
                .map(|v| v == "true")
                .unwrap_or(false)
            {
                continue;
            }

            let Ok(branches) =
                crate::storage::scan_visible_region_row_batch_branches_with_storage(
                    storage, table, object_id,
                )
            else {
                continue;
            };

            for branch in branches {
                let branch_name = BranchName::new(&branch);
                if let Some(batch_id) = self.queue_initial_row_to_client_with_storage(
                    storage,
                    client_id,
                    object_id,
                    branch_name,
                    true,
                ) && let Some(fate) =
                    self.load_batch_fate_by_batch_id_from_storage(storage, batch_id)
                {
                    self.queue_batch_fate_to_client(client_id, fate);
                }
            }
        }
    }

    /// Re-queue full catch-up for an existing Peer client (mesh reconnect / ACL hydration).
    pub fn rebroadcast_peer_catchup<H: Storage>(&mut self, storage: &H, client_id: PeerId) {
        if self.clients.contains_key(&client_id) {
            self.queue_full_catchup_to_peer_with_storage(storage, client_id);
        }
    }

    /// Shell-only catch-up (sparks/keyshares) before full spark-data replay.
    pub fn rebroadcast_peer_shell_catchup<H: Storage>(&mut self, storage: &H, client_id: PeerId) {
        if self.clients.contains_key(&client_id) {
            self.queue_shell_catchup_to_peer_with_storage(storage, client_id);
        }
    }

    pub fn peer_client_ids(&self) -> Vec<PeerId> {
        self.clients.keys().copied().collect()
    }

    /// Peers whose frontier is converged from our side (last diff was empty).
    /// Drives the "Up to date" mesh status (§10.2).
    pub fn converged_peer_ids(&self) -> Vec<PeerId> {
        self.converged_peers
            .iter()
            .filter(|id| self.clients.contains_key(id))
            .copied()
            .collect()
    }

    // ========================================================================
    // Outbox / Inbox
    // ========================================================================

    /// Take all outbox entries, clearing the outbox.
    pub fn take_outbox(&mut self) -> Vec<OutboxEntry> {
        std::mem::take(&mut self.outbox)
    }

    /// Restore previously dequeued outbox entries ahead of any newly queued ones.
    pub(crate) fn prepend_outbox(&mut self, mut entries: Vec<OutboxEntry>) {
        if entries.is_empty() {
            return;
        }
        entries.append(&mut self.outbox);
        self.outbox = entries;
    }

    /// Get a reference to the outbox (for checking if empty).
    pub fn outbox(&self) -> &[OutboxEntry] {
        &self.outbox
    }

    /// Push an entry to the inbox for processing.
    pub fn push_inbox(&mut self, entry: InboxEntry) {
        self.inbox.push(entry);
    }

    /// Process all inbox entries.
    pub fn process_inbox<H: Storage>(&mut self, storage: &mut H) {
        let entries = std::mem::take(&mut self.inbox);
        for entry in entries {
            self.process_inbox_entry(storage, entry);
        }
        let pending_client_batch_fates = std::mem::take(&mut self.pending_client_batch_fates);
        for (client_id, batch_ids) in pending_client_batch_fates {
            self.respond_to_batch_fate_request(
                storage,
                Destination::Client(client_id),
                batch_ids.into_iter().collect(),
            );
        }
    }

    /// Take pending replayable batch fates for RuntimeCore to process.
    pub fn take_pending_batch_fates(&mut self) -> Vec<BatchFate> {
        std::mem::take(&mut self.pending_batch_fates)
    }

    pub fn pending_batch_fates(&self) -> &[BatchFate] {
        &self.pending_batch_fates
    }

    pub fn push_pending_batch_fate(&mut self, fate: BatchFate) {
        self.pending_batch_fates.push(fate);
    }

    /// Take pending row visibility changes for QueryManager to materialize
    /// into indices and subscriptions.
    pub fn take_pending_row_visibility_changes(&mut self) -> Vec<RowVisibilityChange> {
        std::mem::take(&mut self.pending_row_visibility_changes)
    }

    /// Take pending catalogue/system entry updates for QueryManager/SchemaManager.
    pub fn take_pending_catalogue_updates(&mut self) -> Vec<CatalogueEntry> {
        std::mem::take(&mut self.pending_catalogue_updates)
    }

    /// Requeue row visibility changes that could not be processed yet,
    /// typically because the corresponding schema has not been activated yet.
    pub fn requeue_pending_row_visibility_changes(&mut self, updates: Vec<RowVisibilityChange>) {
        self.pending_row_visibility_changes.extend(updates);
    }
}

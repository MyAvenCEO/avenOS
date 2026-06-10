use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::batch_fate::BatchFate;
use crate::catalogue::CatalogueEntry;
use crate::metadata::{MetadataKey, ObjectType};
use crate::object::{BranchName, ObjectId};
use crate::row_histories::{BatchId, QueryRowBatch, RowState, RowVisibilityChange, StoredRowBatch};
use crate::schema_manager::{
    LensTransformer, SchemaContext, encoding::encode_schema, resolve_current_table_name,
    translate_table_name_to_schema,
};
use crate::storage::{RowLocator, Storage, StorageError};
use crate::sync_manager::{
    PeerId, DurabilityTier, QueryId, QueryPropagation,
    RowBatchKey, SchemaWarning, SyncManager,
};

use crate::row_format::decode_row;
use super::graph::{QueryCompileError, QueryGraph};
use super::graph_nodes::output::QuerySubscriptionId;
use super::policy::{Operation, PolicyExpr};
use super::query::Query;
use super::session::Session;
use super::settlement_eval_cache::SettlementEvalCache;
use super::types::{
    ColumnName, ComposedBranchName, LoadedRow, OrderedAdded, OrderedRowDelta, Row, RowDelta,
    RowDescriptor, RowPolicyMode, Schema, SchemaHash, TableName, TablePolicies, TableSchema, Tuple,
    Value, build_ordered_delta_with_post_ids,
};

/// Error types for QueryManager operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueryError {
    TableNotFound(TableName),
    ColumnCountMismatch {
        expected: usize,
        actual: usize,
    },
    EncodingError(String),
    ObjectNotFound(ObjectId),
    QueryCompilationError(String),
    IndexValueTooLarge {
        table: TableName,
        column: String,
        branch: String,
        key_bytes: usize,
        max_key_bytes: usize,
    },
    IndexError(String),
    /// Cannot undelete or truncate a row that is not soft-deleted.
    RowNotDeleted(ObjectId),
    /// Cannot delete an already-deleted row.
    RowAlreadyDeleted(ObjectId),
    /// Cannot operate on a hard-deleted row (it no longer exists).
    RowHardDeleted(ObjectId),
    /// Policy denied the operation.
    PolicyDenied {
        table: TableName,
        operation: Operation,
    },
    /// Write denied because the session is anonymous.
    /// Short-circuited before policy evaluation; surfaces as ANONYMOUS_WRITE_DENIED on the wire.
    AnonymousWriteDenied {
        table: TableName,
        operation: Operation,
    },
    /// Unknown schema hash - client should sync schema first.
    UnknownSchema(SchemaHash),
    /// Storage / branch inconsistency that should not be collapsed into `ObjectNotFound`.
    InternalError(String),
}

impl std::fmt::Display for QueryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QueryError::TableNotFound(t) => write!(f, "table not found: {}", t),
            QueryError::ColumnCountMismatch { expected, actual } => {
                write!(
                    f,
                    "column count mismatch: expected {expected}, got {actual}"
                )
            }
            QueryError::EncodingError(msg) => write!(f, "encoding error: {msg}"),
            QueryError::ObjectNotFound(id) => write!(f, "object not found: {:?}", id),
            QueryError::QueryCompilationError(msg) => write!(f, "query compilation error: {msg}"),
            QueryError::IndexValueTooLarge {
                table,
                column,
                branch,
                key_bytes,
                max_key_bytes,
            } => write!(
                f,
                "indexed value too large for {table}.{column} on branch {branch}: index key would be {key_bytes} bytes (max {max_key_bytes})"
            ),
            QueryError::IndexError(msg) => write!(f, "index error: {msg}"),
            QueryError::RowNotDeleted(id) => write!(f, "row not deleted: {:?}", id),
            QueryError::RowAlreadyDeleted(id) => write!(f, "row already deleted: {:?}", id),
            QueryError::RowHardDeleted(id) => write!(f, "row hard deleted: {:?}", id),
            QueryError::PolicyDenied { table, operation } => {
                write!(f, "policy denied {} on table {}", operation, table)
            }
            QueryError::AnonymousWriteDenied { table, operation } => {
                write!(
                    f,
                    "anonymous session cannot {} on table {}",
                    operation, table
                )
            }
            QueryError::UnknownSchema(hash) => {
                write!(
                    f,
                    "unknown schema: {} - client should sync schema first",
                    hash.short()
                )
            }
            QueryError::InternalError(msg) => write!(f, "internal error: {msg}"),
        }
    }
}

impl std::error::Error for QueryError {}

/// Handle to a pending query.
///
/// Used to correlate query results with the original request.
/// Wrappers (jazz-runtime, jazz-wasm) use this to fulfill
/// platform-specific futures/promises.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct QueryHandle(pub u64);

/// Result of an insert, including durability metadata and row values.
///
/// Poll via `is_complete()` to check if the row is persisted.
/// Poll via `is_indexed()` to check if the row is indexed.
#[derive(Debug, Clone)]
pub struct InsertResult {
    /// The row's ObjectId.
    pub row_id: ObjectId,
    /// Logical batch identity for the written row member.
    pub batch_id: BatchId,
    /// Inserted row values in table column order.
    pub row_values: Vec<Value>,
}

/// Handle for tracking delete completion.
#[derive(Debug, Clone)]
pub struct DeleteHandle {
    /// The row's ObjectId.
    pub row_id: ObjectId,
    /// Logical batch identity for the tombstone row member.
    pub batch_id: BatchId,
}

impl InsertResult {
    /// Check if the row data is durable (persisted to storage).
    ///
    /// Must call `QueryManager::process()` between checks to drive storage operations.
    pub fn is_complete(&self, qm: &QueryManager, storage: &dyn Storage) -> bool {
        qm.is_version_stored(storage, self.row_id, &self.batch_id)
    }

    /// Check if the row is indexed (appears in the _id index).
    ///
    /// After insert + process(), the row should be indexed.
    pub fn is_indexed(&self, qm: &QueryManager, storage: &dyn Storage, table: &str) -> bool {
        qm.row_is_indexed(storage, table, self.row_id)
    }
}

/// Query subscription info.
#[derive(Debug)]
pub(crate) struct QuerySubscription {
    /// Original query for recompilation when schemas change.
    pub(crate) query: Query,
    /// Compiled query graph.
    pub(crate) graph: QueryGraph,
    /// Branches to read from (updated on recompile).
    pub(crate) branches: Vec<String>,
    /// Session for policy filtering (if any).
    pub(crate) session: Option<Session>,
    /// Flag indicating this subscription needs recompilation due to schema change.
    pub(crate) needs_recompile: bool,
    /// Flag indicating this subscription has settled at least once.
    /// Used to ensure one-shot queries receive an initial callback (even if empty).
    pub(crate) settled_once: bool,
    /// True when visibility can change without graph dirtiness, e.g. initial
    /// frontier completion or a remote query-scope snapshot.
    pub(crate) needs_visibility_recompute: bool,
    /// Required durability tier before non-local delivery (None = immediate).
    pub(crate) durability_tier: Option<DurabilityTier>,
    /// How local writes behave while waiting for durability.
    pub(crate) local_updates: LocalUpdates,
    /// True when this subscription observed a local write since last delivery.
    pub(crate) has_pending_local_updates: bool,
    /// Row ids that should use the local current version as an overlay while
    /// waiting for a stricter settled tier.
    pub(crate) pending_local_row_ids: HashSet<ObjectId>,
    /// Optional one-shot overlay keyed by row id for a specific local batch.
    /// When present, reads must not fall back to unrelated pending local rows.
    pub(crate) local_overlay_rows: HashMap<ObjectId, RowBatchKey>,
    /// Highest durability tier at which the initial upstream query frontier has settled.
    pub(crate) query_frontier_settled_tier: Option<DurabilityTier>,
    /// Current ordered IDs for ordered delta construction.
    pub(crate) current_ordered_ids: Vec<ObjectId>,
    /// Last visible rows delivered to the subscriber when explicit auth filtering is active.
    pub(crate) current_visible_rows: HashMap<ObjectId, Row>,
    /// Extra tables whose rows must be available locally to evaluate this
    /// subscription's bundled policy context.
    pub(crate) policy_context_tables: Vec<String>,
    /// Whether this subscription uses post-settle auth filtering instead of graph policies.
    pub(crate) uses_explicit_authorization_filtering: bool,
    /// Whether visible rows must stay aligned to the latest upstream query scope.
    pub(crate) sync_backed: bool,
    /// Upstream-propagation preference carried by the local subscribe API.
    ///
    /// Peer-mesh mode has no upstream servers to forward to, so the engine no
    /// longer reads this — it is retained because it is part of the public
    /// `subscribe_with_sync_and_propagation` surface.
    #[allow(dead_code)]
    pub(crate) propagation: QueryPropagation,
    /// Schema mismatch warnings already emitted for the latest settled state.
    pub(crate) reported_schema_warnings: HashSet<SchemaWarningKey>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LocalUpdates {
    #[default]
    Immediate,
    Deferred,
}

#[derive(Debug, Clone, Copy)]
enum SubscriptionRowMark {
    Updated,
    Deleted,
    UpdatedAndDeleted,
}

#[derive(Debug, Clone)]
struct SubscriptionVisibilityEffect {
    table: String,
    row_id: ObjectId,
    local_dirty: bool,
    row_mark: SubscriptionRowMark,
    local_row_overlay: bool,
}

#[derive(Debug, Default)]
struct BatchedSubscriptionVisibilityEffects {
    remote_dirty_tables: HashSet<String>,
    local_dirty_tables: HashSet<String>,
    remote_updated: HashMap<String, ahash::AHashSet<ObjectId>>,
    local_updated: HashMap<String, ahash::AHashSet<ObjectId>>,
    remote_deleted: HashMap<String, ahash::AHashSet<ObjectId>>,
    local_deleted: HashMap<String, ahash::AHashSet<ObjectId>>,
}

impl BatchedSubscriptionVisibilityEffects {
    fn push(&mut self, effect: SubscriptionVisibilityEffect) {
        let SubscriptionVisibilityEffect {
            table,
            row_id,
            local_dirty,
            row_mark,
            local_row_overlay,
        } = effect;

        if local_dirty {
            self.local_dirty_tables.insert(table.clone());
        } else {
            self.remote_dirty_tables.insert(table.clone());
        }

        match (row_mark, local_row_overlay) {
            (SubscriptionRowMark::Updated, true) => {
                self.local_updated.entry(table).or_default().insert(row_id);
            }
            (SubscriptionRowMark::Updated, false) => {
                self.remote_updated.entry(table).or_default().insert(row_id);
            }
            (SubscriptionRowMark::Deleted, true) => {
                self.local_deleted.entry(table).or_default().insert(row_id);
            }
            (SubscriptionRowMark::Deleted, false) => {
                self.remote_deleted.entry(table).or_default().insert(row_id);
            }
            (SubscriptionRowMark::UpdatedAndDeleted, true) => {
                self.local_updated
                    .entry(table.clone())
                    .or_default()
                    .insert(row_id);
                self.local_deleted.entry(table).or_default().insert(row_id);
            }
            (SubscriptionRowMark::UpdatedAndDeleted, false) => {
                self.remote_updated
                    .entry(table.clone())
                    .or_default()
                    .insert(row_id);
                self.remote_deleted.entry(table).or_default().insert(row_id);
            }
        }
    }

    fn is_empty(&self) -> bool {
        self.remote_dirty_tables.is_empty()
            && self.local_dirty_tables.is_empty()
            && self.remote_updated.is_empty()
            && self.local_updated.is_empty()
            && self.remote_deleted.is_empty()
            && self.local_deleted.is_empty()
    }
}

/// Update for a query subscription.
#[derive(Debug, Clone)]
pub struct QueryUpdate {
    pub subscription_id: QuerySubscriptionId,
    pub delta: RowDelta,
    pub ordered_delta: OrderedRowDelta,
    /// Output descriptor for decoding the binary row data.
    /// This matches the query's output schema (handles JOINs, projections, etc).
    pub descriptor: RowDescriptor,
}

/// Terminal failure for a local query subscription.
#[derive(Debug, Clone)]
pub struct QuerySubscriptionFailure {
    pub subscription_id: QuerySubscriptionId,
    pub code: String,
    pub reason: String,
}

#[derive(Debug)]
pub(super) struct WriteTableCacheEntry {
    pub(super) descriptor: Arc<RowDescriptor>,
    pub(super) indexed_columns: Option<Arc<Vec<ColumnName>>>,
    pub(super) row_layout: Arc<crate::row_format::CompiledRowLayout>,
    pub(super) row_locator: RowLocator,
    pub(super) insert_policy: Option<Arc<PolicyExpr>>,
    pub(super) update_using_policy: Option<Arc<PolicyExpr>>,
    pub(super) update_check_policy: Option<Arc<PolicyExpr>>,
    pub(super) delete_using_policy: Option<Arc<PolicyExpr>>,
    pub(super) select_policy: Option<Arc<PolicyExpr>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct SchemaWarningKey {
    pub(crate) table_name: String,
    pub(crate) from_hash: SchemaHash,
    pub(crate) to_hash: SchemaHash,
}

impl SchemaWarningKey {
    fn from_warning(warning: &SchemaWarning) -> Self {
        Self {
            table_name: warning.table_name.clone(),
            from_hash: warning.from_hash,
            to_hash: warning.to_hash,
        }
    }
}

#[derive(Debug, Default)]
pub(super) struct SchemaWarningAccumulator {
    counts: HashMap<SchemaWarningKey, usize>,
}

impl SchemaWarningAccumulator {
    pub(super) fn record(&mut self, table_name: &str, from_hash: SchemaHash, to_hash: SchemaHash) {
        let key = SchemaWarningKey {
            table_name: table_name.to_string(),
            from_hash,
            to_hash,
        };
        *self.counts.entry(key).or_default() += 1;
    }

    pub(super) fn warnings_for_query(&self, query_id: QueryId) -> Vec<SchemaWarning> {
        let mut warnings: Vec<SchemaWarning> = self
            .counts
            .iter()
            .map(|(key, row_count)| SchemaWarning {
                query_id,
                table_name: key.table_name.clone(),
                row_count: *row_count,
                from_hash: key.from_hash,
                to_hash: key.to_hash,
            })
            .collect();
        warnings.sort_by(|a, b| {
            a.table_name
                .cmp(&b.table_name)
                .then_with(|| a.from_hash.to_string().cmp(&b.from_hash.to_string()))
                .then_with(|| a.to_hash.to_string().cmp(&b.to_hash.to_string()))
        });
        warnings
    }
}

/// A catalogue object update received via sync.
///
/// Used to pass schema/lens updates from QueryManager to SchemaManager.
#[derive(Debug, Clone)]
pub struct CatalogueUpdate {
    /// The object ID of the catalogue object.
    pub object_id: ObjectId,
    /// Metadata from the object (includes type, app_id, etc.).
    pub metadata: HashMap<String, String>,
    /// Content from the latest commit.
    pub content: Vec<u8>,
}

/// Manages reactive SQL queries over storage-backed relational state.
///
/// No global Setup/Ready state machine: indices and rows are loaded lazily from
/// storage. Operations work immediately; queries return empty/Pending results
/// until their required data is available.
pub struct QueryManager {
    pub(super) sync_manager: SyncManager,
    pub(super) schema: Arc<Schema>,
    pub(super) row_policy_mode: RowPolicyMode,
    /// Unseal-on-scan hook bound into ranking Sort nodes at compile (plan §3 seam).
    pub(super) unseal: Option<crate::query_manager::graph_nodes::sort::UnsealFn>,
    pub(super) authorization_schema: Option<Arc<Schema>>,
    pub(super) authorization_schema_required: bool,
    pub(super) authorization_context_cache: HashMap<(String, String), Arc<SchemaContext>>,

    /// Pending catalogue updates (schemas/lenses received via sync).
    /// SchemaManager should call take_pending_catalogue_updates() to process these.
    pub(super) pending_catalogue_updates: Vec<CatalogueUpdate>,

    /// Active query subscriptions (local)
    pub(super) subscriptions: HashMap<QuerySubscriptionId, QuerySubscription>,
    pub(super) next_subscription_id: u64,

    /// Pending query updates
    pub(super) update_outbox: Vec<QueryUpdate>,

    /// Terminal local subscription failures.
    pub(super) failed_subscriptions: Vec<QuerySubscriptionFailure>,

    /// Schema context for multi-schema queries.
    /// Starts empty; initialized via set_current_schema().
    /// Enables lens transforms for rows from old schema branches.
    pub(super) schema_context: SchemaContext,

    /// Maps branch name to schema hash (derived from schema_context).
    /// Used to determine which schema a branch uses.
    pub(super) branch_schema_map: HashMap<String, SchemaHash>,

    /// Buffered row visibility changes for unknown schema branches.
    /// These are retried when new schemas activate via try_activate_pending().
    pub(super) pending_row_visibility_changes: Vec<RowVisibilityChange>,

    /// Latest locally-authored row batch entry per row id.
    ///
    /// Used to let `local_updates = Immediate` queries fall back to the current
    /// local row batch entry when the requested remote durability tier has not been
    /// reached yet.
    pub(super) pending_local_row_batches: HashMap<ObjectId, RowBatchKey>,

    /// Visible rows observed through normal row visibility processing, keyed by
    /// batch. Batch fate processing uses this to mark affected query rows
    /// without rescanning and decoding every subscribed visible region.
    pub(super) visible_rows_by_batch: HashMap<BatchId, HashSet<(String, ObjectId)>>,

    /// Authoritative batch fates loaded while settling subscriptions.
    ///
    /// A single replay can ask whether the same batch is transactional and
    /// complete for every subscribed query. Keep that storage fact at manager
    /// scope instead of reloading it once per subscription emission.
    pub(super) authoritative_batch_fate_cache: HashMap<BatchId, Option<BatchFate>>,

    /// Currently queued SyncManager batch fates whose query effects have
    /// already been applied by this manager.
    ///
    /// RuntimeCore owns draining the pending fate queue so write waiters and
    /// persisted fate state still see the same events. QueryManager may process
    /// multiple times before that drain happens, so it must only apply the
    /// subscription dirtiness effects for the newly appended suffix.
    pub(super) applied_pending_batch_fates: Vec<BatchFate>,

    /// Known schemas (for server-mode operation).
    /// Synced from SchemaManager's known_schemas to enable lazy branch activation.
    /// When a row arrives with unknown branch, we parse the branch name to extract
    /// the short hash, then look up the full schema in this map.
    pub(super) known_schemas: Arc<HashMap<SchemaHash, Schema>>,

    /// Schema hashes that still need catalogue persistence for the current
    /// storage namespace.
    pub(super) pending_catalogue_schema_hashes: HashSet<SchemaHash>,

    /// Storage namespaces where all live schemas have already been upserted
    /// into the catalogue for this manager.
    pub(super) catalogued_storage_namespaces: HashSet<usize>,

    /// Application id for catalogue schema persistence, when available.
    pub(super) catalogue_app_id: Option<String>,

    /// Per-schema, per-table write metadata cached to avoid cloning policy
    /// trees and descriptors on every hot write.
    pub(super) write_table_cache: HashMap<(SchemaHash, TableName), Arc<WriteTableCacheEntry>>,
}

impl QueryManager {
    fn mark_schema_catalogue_dirty(&mut self, schema_hash: SchemaHash) {
        self.pending_catalogue_schema_hashes.insert(schema_hash);
        self.catalogued_storage_namespaces.clear();
    }

    fn mark_all_live_schemas_catalogue_dirty(&mut self) {
        for schema_hash in self.schema_context.all_live_hashes() {
            self.pending_catalogue_schema_hashes.insert(schema_hash);
        }
        self.catalogued_storage_namespaces.clear();
    }

    pub(super) fn finalize_schema_warnings(
        reported: &mut HashSet<SchemaWarningKey>,
        warnings: Vec<SchemaWarning>,
    ) -> Vec<SchemaWarning> {
        let current_keys: HashSet<SchemaWarningKey> = warnings
            .iter()
            .map(SchemaWarningKey::from_warning)
            .collect();
        let new_warnings = warnings
            .into_iter()
            .filter(|warning| !reported.contains(&SchemaWarningKey::from_warning(warning)))
            .collect();
        *reported = current_keys;
        new_warnings
    }

    /// Create a new QueryManager with empty schema context.
    ///
    /// Call `set_current_schema()` to initialize the current schema before queries.
    /// Use `add_live_schema()` and `register_lens()` to add additional schemas.
    ///
    /// Row-level security is evaluated via `process()` which handles pending
    /// permission checks from SyncManager.
    pub fn new(sync_manager: SyncManager) -> Self {
        Self {
            sync_manager,
            schema: Arc::new(Schema::new()),
            row_policy_mode: RowPolicyMode::PermissiveLocal,
            unseal: None,
            authorization_schema: None,
            authorization_schema_required: false,
            authorization_context_cache: HashMap::new(),
            pending_catalogue_updates: Vec::new(),
            subscriptions: HashMap::new(),
            next_subscription_id: 0,
            update_outbox: Vec::new(),
            failed_subscriptions: Vec::new(),
            schema_context: SchemaContext::empty(),
            branch_schema_map: HashMap::new(),
            pending_row_visibility_changes: Vec::new(),
            pending_local_row_batches: HashMap::new(),
            visible_rows_by_batch: HashMap::new(),
            authoritative_batch_fate_cache: HashMap::new(),
            applied_pending_batch_fates: Vec::new(),
            known_schemas: Arc::new(HashMap::new()),
            pending_catalogue_schema_hashes: HashSet::new(),
            catalogued_storage_namespaces: HashSet::new(),
            catalogue_app_id: None,
            write_table_cache: HashMap::new(),
        }
    }

    pub fn set_catalogue_app_id(&mut self, app_id: impl Into<String>) {
        self.catalogue_app_id = Some(app_id.into());
        self.catalogued_storage_namespaces.clear();
    }

    /// Set the current schema (the one this client writes to).
    ///
    /// Must be called before queries. Can only be called once.
    /// Creates indices for the current schema's branch.
    pub fn set_current_schema(&mut self, schema: Schema, env: &str, user_branch: &str) {
        self.set_current_schema_with_policy_mode(
            schema,
            env,
            user_branch,
            RowPolicyMode::PermissiveLocal,
        );
    }

    pub fn set_current_schema_with_policy_mode(
        &mut self,
        schema: Schema,
        env: &str,
        user_branch: &str,
        row_policy_mode: RowPolicyMode,
    ) {
        self.schema_context
            .set_current(schema.clone(), env, user_branch);
        self.schema = Arc::new(schema.clone());
        self.row_policy_mode = row_policy_mode;
        self.authorization_schema = None;
        self.authorization_context_cache.clear();
        self.authorization_schema_required = false;
        self.write_table_cache.clear();

        // Update branch -> schema hash map
        let branch = self.schema_context.branch_name();
        self.branch_schema_map.insert(
            branch.as_str().to_string(),
            self.schema_context.current_hash,
        );
        self.pending_catalogue_schema_hashes.clear();
        self.mark_schema_catalogue_dirty(self.schema_context.current_hash);
    }

    pub fn set_authorization_schema(&mut self, _schema: Schema) {}

    pub fn require_authorization_schema(&mut self) {}

    /// Add a live schema (one we can read from but don't write to).
    ///
    /// Creates indices for the schema's branch.
    /// Marks subscriptions for recompilation to include the new branch.
    pub fn add_live_schema(&mut self, schema: Schema) {
        let hash = SchemaHash::compute(&schema);

        // Skip if already live or is current
        if self.schema_context.is_live(&hash) {
            return;
        }

        // Build branch name for this schema
        let branch = ComposedBranchName::new(
            &self.schema_context.env,
            hash,
            &self.schema_context.user_branch,
        )
        .to_branch_name();

        // Add to live_schemas (without lens - caller should register lens separately)
        self.schema_context
            .live_schemas
            .insert(hash, schema.clone());

        // Update branch -> schema hash map
        self.branch_schema_map
            .insert(branch.as_str().to_string(), hash);
        self.mark_schema_catalogue_dirty(hash);

        // Mark subscriptions for recompile to pick up new branch
        self.mark_subscriptions_for_recompile();
    }

    /// Register a lens between two schemas.
    ///
    /// Also attempts to activate any pending schemas that may now be reachable.
    pub fn register_lens(&mut self, lens: super::super::schema_manager::lens::Lens) {
        self.schema_context.register_lens(lens);
        self.authorization_context_cache.clear();

        // Try to activate pending schemas
        let activated = self.schema_context.try_activate_pending();
        if !activated.is_empty() {
            // New schemas activated - register branches and mark for recompile
            for hash in activated {
                if let Some(_schema) = self.schema_context.live_schemas.get(&hash).cloned() {
                    let branch = ComposedBranchName::new(
                        &self.schema_context.env,
                        hash,
                        &self.schema_context.user_branch,
                    )
                    .to_branch_name();

                    self.branch_schema_map
                        .insert(branch.as_str().to_string(), hash);
                    self.mark_schema_catalogue_dirty(hash);
                }
            }
            self.mark_subscriptions_for_recompile();
        }
    }

    /// Register the unseal-on-scan hook; bound into every subsequently compiled
    /// ranking Sort node (`nearest` / `text_search`). See plan §3 (sealed-data seam).
    pub fn set_unseal(&mut self, hook: Option<crate::query_manager::graph_nodes::sort::UnsealFn>) {
        self.unseal = hook;
    }

    pub(super) fn compile_graph(
        query: &Query,
        schema: &Schema,
        session: Option<Session>,
        schema_context: &SchemaContext,
        row_policy_mode: RowPolicyMode,
        unseal: Option<&crate::query_manager::graph_nodes::sort::UnsealFn>,
    ) -> Result<QueryGraph, QueryCompileError> {
        let mut graph = QueryGraph::try_compile_with_schema_context(
            query,
            schema,
            session,
            schema_context,
            row_policy_mode,
        )?;
        if let Some(hook) = unseal {
            graph.bind_unseal(hook);
        }
        Ok(graph)
    }

    pub(super) fn local_subscription_uses_explicit_authorization(
        &self,
        session: Option<&Session>,
    ) -> bool {
        session.is_some()
            && self
                .authorization_schema
                .as_ref()
                .map(|auth_schema| auth_schema.as_ref() != self.schema.as_ref())
                .unwrap_or(false)
    }

    pub(super) fn local_subscription_compile_schema(&self, session: Option<&Session>) -> Schema {
        if self.local_subscription_uses_explicit_authorization(session) {
            self.schema
                .iter()
                .map(|(table_name, table_schema)| {
                    let mut structural = table_schema.clone();
                    structural.policies = TablePolicies::default();
                    (*table_name, structural)
                })
                .collect()
        } else {
            self.schema.as_ref().clone()
        }
    }

    /// Mark all subscriptions for recompilation.
    ///
    /// Called when live schemas change to ensure subscriptions pick up new branches.
    fn mark_subscriptions_for_recompile(&mut self) {
        for sub in self.subscriptions.values_mut() {
            sub.needs_recompile = true;
        }
    }

    pub(super) fn has_stale_subscriptions(&self) -> bool {
        self.subscriptions.values().any(|sub| sub.needs_recompile)
    }

    pub(crate) fn ensure_known_schemas_catalogued<H: Storage>(
        &mut self,
        storage: &mut H,
    ) -> Result<(), StorageError> {
        if !self.schema_context.is_initialized() {
            return Ok(());
        }

        let storage_namespace = storage.storage_cache_namespace();
        if !self
            .catalogued_storage_namespaces
            .contains(&storage_namespace)
        {
            self.mark_all_live_schemas_catalogue_dirty();
        }
        if self.pending_catalogue_schema_hashes.is_empty() {
            return Ok(());
        }

        let mut pending_hashes = self
            .pending_catalogue_schema_hashes
            .iter()
            .copied()
            .collect::<Vec<_>>();
        pending_hashes.sort_by_key(|schema_hash| schema_hash.to_string());

        for schema_hash in pending_hashes {
            let Some(schema) = self.schema_context.get_schema(&schema_hash) else {
                self.pending_catalogue_schema_hashes.remove(&schema_hash);
                continue;
            };
            let object_id = schema_hash.to_object_id();
            let mut metadata = storage
                .load_catalogue_entry(object_id)?
                .map(|entry| entry.metadata)
                .unwrap_or_default();
            metadata.insert(
                MetadataKey::Type.to_string(),
                ObjectType::CatalogueSchema.to_string(),
            );
            metadata.insert(MetadataKey::SchemaHash.to_string(), schema_hash.to_string());
            if let Some(app_id) = &self.catalogue_app_id {
                metadata.insert(MetadataKey::AppId.to_string(), app_id.clone());
            }
            storage.upsert_catalogue_entry(&CatalogueEntry {
                object_id,
                metadata,
                content: encode_schema(schema),
            })?;
            self.pending_catalogue_schema_hashes.remove(&schema_hash);
        }

        self.catalogued_storage_namespaces.insert(storage_namespace);
        Ok(())
    }

    /// Recompile subscriptions that are marked as stale.
    ///
    /// Called during process() to rebuild QueryGraphs when schemas change.
    fn recompile_stale_subscriptions(&mut self) {
        if !self.has_stale_subscriptions() {
            return;
        }

        let mut failed_local: Vec<(QuerySubscriptionId, String)> = Vec::new();
        let current_schema = self.schema.clone();
        let current_schema_context = self.schema_context.clone();
        let authorization_schema = self.authorization_schema.clone();
        let unseal = self.unseal.clone();

        // Recompile local subscriptions
        for (sub_id, sub) in &mut self.subscriptions {
            if sub.needs_recompile {
                // Resolve next branches from current schema context.
                let next_branches: Vec<String> = current_schema_context
                    .all_branch_names()
                    .into_iter()
                    .map(|b| b.as_str().to_string())
                    .collect();
                let uses_explicit_authorization_filtering = sub.session.is_some()
                    && authorization_schema
                        .as_ref()
                        .map(|auth_schema| auth_schema.as_ref() != current_schema.as_ref())
                        .unwrap_or(false);
                let compile_schema = if uses_explicit_authorization_filtering {
                    current_schema
                        .iter()
                        .map(|(table_name, table_schema)| {
                            let mut structural = table_schema.clone();
                            structural.policies = TablePolicies::default();
                            (*table_name, structural)
                        })
                        .collect()
                } else {
                    current_schema.as_ref().clone()
                };

                // Recompile the graph
                let compile_row_policy_mode = if uses_explicit_authorization_filtering {
                    RowPolicyMode::PermissiveLocal
                } else {
                    self.row_policy_mode
                };
                match Self::compile_graph(
                    &sub.query,
                    &compile_schema,
                    sub.session.clone(),
                    &current_schema_context,
                    compile_row_policy_mode,
                    unseal.as_ref(),
                ) {
                    Ok(new_graph) => {
                        let policy_context_tables =
                            Self::policy_context_tables_for_graph(&new_graph);
                        sub.graph = new_graph;
                        sub.branches = next_branches;
                        sub.policy_context_tables = policy_context_tables;
                        sub.uses_explicit_authorization_filtering =
                            uses_explicit_authorization_filtering;
                        sub.needs_recompile = false;
                    }
                    Err(err) => {
                        let reason = err.to_string();
                        tracing::error!(
                            sub_id = sub_id.0,
                            table = %sub.graph.table,
                            error = %reason,
                            "subscription stale recompile failed; dropping subscription"
                        );
                        failed_local.push((*sub_id, reason));
                    }
                }
            }
        }

        for (sub_id, reason) in failed_local {
            self.subscriptions.remove(&sub_id);
            self.failed_subscriptions.push(QuerySubscriptionFailure {
                subscription_id: sub_id,
                code: "query_recompile_failed".to_string(),
                reason: reason.clone(),
            });
        }
    }

    /// Get the schema context.
    pub fn schema_context(&self) -> &SchemaContext {
        &self.schema_context
    }

    /// Get the current branch name for writes.
    ///
    /// Returns the branch for the current schema, or "main" if context isn't initialized.
    pub(super) fn current_branch(&self) -> String {
        if self.schema_context.is_initialized() {
            self.schema_context.branch_name().as_str().to_string()
        } else {
            "main".to_string()
        }
    }

    /// Get all branches to query for a table (current + live schemas).
    pub fn all_query_branches(&self) -> Vec<String> {
        self.schema_context
            .all_branch_names()
            .into_iter()
            .map(|b| b.as_str().to_string())
            .collect()
    }

    /// No-op: Storage manages its own index storage.
    /// Kept as public API for SchemaManager compatibility.
    pub fn ensure_indices_for_branch(
        &mut self,
        _table: &str,
        _branch: &str,
        _table_schema: &TableSchema,
    ) {
        // No-op: Storage manages index storage directly
    }

    /// Get the underlying SyncManager.
    pub fn sync_manager(&self) -> &SyncManager {
        &self.sync_manager
    }

    /// Get mutable reference to the underlying SyncManager.
    pub fn sync_manager_mut(&mut self) -> &mut SyncManager {
        &mut self.sync_manager
    }

    pub(crate) fn mark_subscriptions_visibility_recompute_for_batch(&mut self, batch_id: BatchId) {
        for subscription in self.subscriptions.values_mut() {
            if subscription
                .graph
                .current_output_tuples_ref()
                .iter()
                .any(|tuple| tuple.batch_provenance().contains(&batch_id))
            {
                subscription.needs_visibility_recompute = true;
            }
        }
    }

    fn apply_pending_batch_fate_effects<H: Storage>(&mut self, storage: &H) {
        let pending_batch_fates = self.sync_manager.pending_batch_fates();
        let already_applied_count =
            if pending_batch_fates.starts_with(&self.applied_pending_batch_fates) {
                self.applied_pending_batch_fates.len()
            } else {
                // RuntimeCore may have drained the queue and SyncManager may have
                // appended new fates before QueryManager gets another process pass.
                // In that case, the current queue is a new sequence, not a suffix
                // of the old one.
                0
            };

        let batch_fates = pending_batch_fates[already_applied_count..].to_vec();
        self.applied_pending_batch_fates = pending_batch_fates.to_vec();
        let fate_count = batch_fates.len();
        if fate_count == 0 {
            return;
        }

        let max_confirmed_tier = batch_fates
            .iter()
            .filter_map(BatchFate::confirmed_tier)
            .max();
        if let Some(confirmed_tier) = max_confirmed_tier {
            self.mark_subscriptions_visibility_recompute_for_tier(confirmed_tier);
        }

        let mut batch_ids = batch_fates
            .iter()
            .map(BatchFate::batch_id)
            .collect::<Vec<_>>();
        batch_ids.sort();
        batch_ids.dedup();

        let unique_batch_count = batch_ids.len();
        let mut marked_row_count = 0usize;
        for batch_id in batch_ids {
            self.authoritative_batch_fate_cache.insert(
                batch_id,
                storage
                    .load_authoritative_batch_fate(batch_id)
                    .ok()
                    .flatten(),
            );
            self.mark_subscriptions_visibility_recompute_for_batch(batch_id);
            let mut rows = self
                .visible_rows_by_batch
                .get(&batch_id)
                .cloned()
                .unwrap_or_default();
            if let Ok(Some(record)) = storage.load_local_batch_record(batch_id) {
                for member in record.members {
                    rows.insert((member.table_name, member.object_id));
                }
            }
            marked_row_count += rows.len();
            for (table_name, object_id) in rows {
                self.mark_local_row_updated_in_subscriptions(table_name.as_str(), object_id);
            }
        }
        tracing::trace!(
            fate_count,
            unique_batch_count,
            marked_row_count,
            max_confirmed_tier = ?max_confirmed_tier,
            "jazz trace batch fate effects applied"
        );
    }

    pub(crate) fn mark_subscriptions_visibility_recompute_for_tier(
        &mut self,
        confirmed_tier: DurabilityTier,
    ) {
        for subscription in self.subscriptions.values_mut() {
            if subscription
                .durability_tier
                .is_some_and(|required_tier| confirmed_tier >= required_tier)
            {
                subscription.needs_visibility_recompute = true;
            }
        }
    }

    /// Remove a client and all its sync state.
    ///
    /// Returns `false` if the client has unprocessed inbox entries.
    /// The caller should retry later.
    pub fn remove_client(&mut self, client_id: PeerId) -> bool {
        self.sync_manager.remove_client(client_id)
    }

    /// Get the schema.
    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    /// Get subscription results as decoded rows with ObjectIds (for testing).
    /// Process pending changes and settle all subscription graphs.
    ///
    /// This method drives async progress:
    /// - Processes SyncManager inbox (receives client writes)
    /// - Evaluates pending permission checks
    /// - Settles policy graphs and finalizes completed checks
    /// - Processes object updates from SyncManager
    /// - Flushes pending index updates when indices become ready
    /// - Marks subscriptions with pending IDs dirty when rows become available
    /// - Settles all subscription graphs (row data loaded on-demand from storage)
    pub fn process<H: Storage>(&mut self, storage: &mut H) {
        let _span = tracing::trace_span!("QueryManager::process").entered();

        if let Err(error) = self.ensure_known_schemas_catalogued(storage) {
            tracing::warn!(%error, "failed to persist known schemas to catalogue storage");
        }

        // 1. Process SyncManager inbox (receives client writes)
        self.sync_manager.process_inbox(storage);
        self.pending_catalogue_updates.extend(
            self.sync_manager
                .take_pending_catalogue_updates()
                .into_iter()
                .map(|entry| CatalogueUpdate {
                    object_id: entry.object_id,
                    metadata: entry.metadata,
                    content: entry.content,
                }),
        );

        // 2. Process row visibility changes from SyncManager FIRST so indices are current
        // before subscriptions are processed.
        let mut row_visibility_changes = std::mem::take(&mut self.pending_row_visibility_changes);
        row_visibility_changes.extend(self.sync_manager.take_pending_row_visibility_changes());
        if !row_visibility_changes.is_empty() {
            tracing::debug!(
                count = row_visibility_changes.len(),
                "processing row visibility changes"
            );
        }
        self.handle_row_updates_batched(storage, row_visibility_changes);

        let post_permission_row_visibility_changes =
            self.sync_manager.take_pending_row_visibility_changes();
        if !post_permission_row_visibility_changes.is_empty() {
            tracing::debug!(
                count = post_permission_row_visibility_changes.len(),
                "processing row visibility changes from accepted permission checks"
            );
        }
        self.handle_row_updates_batched(storage, post_permission_row_visibility_changes);
        self.apply_pending_batch_fate_effects(storage);

        // 5. Index storage is handled by Storage via batched_tick() - not here.
        // Tests/benchmarks that don't need real storage use NullStorage.

        // 6. Recompile any subscriptions marked as stale due to schema changes
        self.recompile_stale_subscriptions();

        // 7. Settle all subscriptions - row_loader reads from subscription's branches
        // Extract references to avoid borrowing self in the closure
        let dirty_count = self
            .subscriptions
            .values()
            .filter(|s| s.graph.has_dirty_nodes())
            .count();
        if dirty_count > 0 {
            tracing::debug!(
                dirty_count,
                total = self.subscriptions.len(),
                "settling subscriptions"
            );
        }
        let storage_ref: &dyn Storage = storage;
        let subscription_ids: Vec<_> = self.subscriptions.keys().copied().collect();

        for sub_id in subscription_ids {
            let should_process_subscription =
                self.subscriptions.get(&sub_id).is_some_and(|subscription| {
                    subscription.needs_recompile
                        || !subscription.settled_once
                        || subscription.needs_visibility_recompute
                        || subscription.has_pending_local_updates
                        || subscription.graph.has_dirty_nodes()
                });
            if !should_process_subscription {
                continue;
            }

            let Some(mut subscription) = self.subscriptions.remove(&sub_id) else {
                continue;
            };

            let _sub_span = tracing::trace_span!("settle_subscription", sub_id = sub_id.0, table = %subscription.graph.table).entered();
            let branches = subscription.branches.clone();
            let table = subscription.graph.table.as_str().to_string();
            let mut schema_warnings = SchemaWarningAccumulator::default();
            let include_deleted = subscription.query.include_deleted;
            // Peer-mesh mode has no upstream servers, so remote scope snapshots
            // never arrive: a tier-gated subscription is only "remote-satisfied"
            // when it requested no tier at all.
            let remote_scope_satisfies_subscription = subscription.durability_tier.is_none();

            let delta = {
                let schema_context = &self.schema_context;
                let branch_schema_map = &self.branch_schema_map;
                let row_loader =
                    |id: ObjectId, table_hint: Option<TableName>| -> Option<LoadedRow> {
                        let lacks_authoritative_remote_scope = subscription.sync_backed
                            && subscription.local_updates == LocalUpdates::Immediate
                            && !remote_scope_satisfies_subscription;
                        let durability_tier = if lacks_authoritative_remote_scope
                            || (subscription.local_updates == LocalUpdates::Immediate
                                && subscription.pending_local_row_ids.contains(&id))
                        {
                            None
                        } else {
                            subscription.durability_tier
                        };
                        let local_pending_version = if !subscription.local_overlay_rows.is_empty() {
                            subscription.local_overlay_rows.get(&id).copied()
                        } else {
                            (subscription.local_updates == LocalUpdates::Immediate)
                                .then(|| self.pending_local_row_batches.get(&id).copied())
                                .flatten()
                        };
                        Self::load_visible_row_for_query(
                            storage_ref,
                            id,
                            table_hint.as_ref().map(TableName::as_str),
                            &branches,
                            durability_tier,
                            local_pending_version,
                            !subscription.local_overlay_rows.is_empty(),
                            !subscription.local_overlay_rows.is_empty()
                                || (subscription.sync_backed
                                    && subscription.durability_tier.is_some()
                                    && subscription.local_updates == LocalUpdates::Immediate),
                            include_deleted,
                            schema_context,
                            branch_schema_map,
                            &table,
                            sub_id,
                            &mut schema_warnings,
                        )
                    };

                let source_overlay_rows = if !subscription.local_overlay_rows.is_empty() {
                    Some(&subscription.local_overlay_rows)
                } else if subscription.local_updates == LocalUpdates::Immediate
                    && subscription.sync_backed
                    && subscription.durability_tier.is_some()
                    && !self.pending_local_row_batches.is_empty()
                {
                    Some(&self.pending_local_row_batches)
                } else {
                    None
                };
                subscription.graph.settle_with_source_overlay(
                    storage_ref,
                    source_overlay_rows,
                    row_loader,
                )
            };
            subscription.needs_visibility_recompute = false;
            let new_schema_warnings = Self::finalize_schema_warnings(
                &mut subscription.reported_schema_warnings,
                schema_warnings.warnings_for_query(QueryId(sub_id.0)),
            );
            for warning in &new_schema_warnings {
                crate::sync_manager::log_schema_warning(warning, None, Some(sub_id.0));
            }
            if !delta.added.is_empty() || !delta.removed.is_empty() {
                tracing::debug!(
                    sub_id = sub_id.0,
                    added = delta.added.len(),
                    removed = delta.removed.len(),
                    "settle delta"
                );
            }

            // Peer-mesh mode has no upstream servers, so there is never an initial
            // upstream frontier to wait on — subscriptions deliver immediately.

            let mut visible_tuples = if subscription.uses_explicit_authorization_filtering {
                let auth_schema_context = self.schema_context.clone();
                let auth_branch_schema_map = self.branch_schema_map.clone();
                let mut settlement_eval_cache = SettlementEvalCache::default();
                Cow::Owned(self.authorized_tuples_from_graph_with_cache(
                    storage_ref,
                    &mut settlement_eval_cache,
                    &subscription.graph,
                    &auth_schema_context,
                    &auth_branch_schema_map,
                    subscription.session.as_ref(),
                ))
            } else {
                Cow::Borrowed(subscription.graph.current_output_tuples_ref())
            };

            // Peer-mesh mode has no upstream servers, so no remote query-scope
            // snapshot ever arrives — the synced-scope filter never applied here.

            visible_tuples = self.filter_transaction_visible_tuples(storage_ref, visible_tuples);

            if !subscription.settled_once {
                let visible_rows =
                    Self::rows_from_tuples(&subscription.graph, visible_tuples.as_ref());
                let row_count = visible_rows.len();
                let ordered_ids_after: Vec<_> = visible_rows.iter().map(|row| row.id).collect();
                let ordered_delta = OrderedRowDelta {
                    added: visible_rows
                        .iter()
                        .cloned()
                        .enumerate()
                        .map(|(index, row)| OrderedAdded {
                            id: row.id,
                            index,
                            row,
                        })
                        .collect(),
                    removed: Vec::new(),
                    updated: Vec::new(),
                    pending: false,
                };
                let visible_rows_by_id: HashMap<_, _> = visible_rows
                    .iter()
                    .cloned()
                    .map(|row| (row.id, row))
                    .collect();
                let visible_delta = RowDelta {
                    added: visible_rows,
                    removed: Vec::new(),
                    moved: Vec::new(),
                    updated: Vec::new(),
                };
                tracing::trace!(
                    sub_id = sub_id.0,
                    table = %table,
                    rows = row_count,
                    added = visible_delta.added.len(),
                    settled_tier = ?subscription.query_frontier_settled_tier,
                    required_tier = ?subscription.durability_tier,
                    "jazz trace subscription first delivery"
                );
                subscription.settled_once = true;
                subscription.current_ordered_ids = ordered_ids_after;
                subscription.current_visible_rows = visible_rows_by_id;
                self.update_outbox.push(QueryUpdate {
                    subscription_id: sub_id,
                    delta: visible_delta,
                    ordered_delta,
                    descriptor: subscription.graph.combined_descriptor.clone(),
                });
                subscription.has_pending_local_updates = false;
                subscription
                    .pending_local_row_ids
                    .retain(|id| self.pending_local_row_batches.contains_key(id));
            } else {
                let visible_rows =
                    Self::rows_from_tuples(&subscription.graph, visible_tuples.as_ref());
                let visible_rows_by_id: HashMap<_, _> = visible_rows
                    .iter()
                    .cloned()
                    .map(|row| (row.id, row))
                    .collect();
                let visible_delta = Self::row_delta_from_rows(
                    &subscription.current_visible_rows,
                    &subscription.current_ordered_ids,
                    &visible_rows,
                );
                if visible_delta.is_empty() {
                    self.subscriptions.insert(sub_id, subscription);
                    continue;
                }
                let ordered_ids_after: Vec<ObjectId> =
                    visible_rows.iter().map(|row| row.id).collect();
                let ordered = build_ordered_delta_with_post_ids(
                    &subscription.current_ordered_ids,
                    &ordered_ids_after,
                    &visible_delta,
                    false,
                );
                subscription.current_ordered_ids = ordered.ordered_ids_after;
                subscription.current_visible_rows = visible_rows_by_id;
                tracing::debug!(
                    sub_id = sub_id.0,
                    added = visible_delta.added.len(),
                    removed = visible_delta.removed.len(),
                    updated = visible_delta.updated.len(),
                    "incremental delivery"
                );
                self.update_outbox.push(QueryUpdate {
                    subscription_id: sub_id,
                    delta: visible_delta,
                    ordered_delta: ordered.delta,
                    descriptor: subscription.graph.combined_descriptor.clone(),
                });
                subscription.has_pending_local_updates = false;
                subscription
                    .pending_local_row_ids
                    .retain(|id| self.pending_local_row_batches.contains_key(id));
            }

            self.subscriptions.insert(sub_id, subscription);
        }

        // Note: With sync storage, object loading is immediate. No need to request
        // async loads - objects are available when we query for them.
    }

    pub(super) fn handle_row_update_with_origin(
        &mut self,
        storage: &mut dyn Storage,
        update: RowVisibilityChange,
        local_update: bool,
        apply_index_mutations: bool,
    ) {
        if let Some(effect) = self.prepare_row_update_with_origin(
            storage,
            update,
            local_update,
            apply_index_mutations,
        ) {
            self.apply_subscription_visibility_effect(effect);
        }
    }

    fn prepare_row_update_with_origin(
        &mut self,
        storage: &mut dyn Storage,
        update: RowVisibilityChange,
        local_update: bool,
        apply_index_mutations: bool,
    ) -> Option<SubscriptionVisibilityEffect> {
        let original_table = update.row_locator.table.to_string();
        let branch = update.row.branch.as_str();
        let origin_schema_hash = update.row_locator.origin_schema_hash;

        let schema_hash = match self.branch_schema_map.get(branch) {
            Some(&hash) => hash,
            None => {
                let branch_name = BranchName::new(branch);
                if let Some(composed) = ComposedBranchName::parse(&branch_name) {
                    if let Some(full_hash) = self.find_schema_by_short_hash(&composed.schema_hash) {
                        self.branch_schema_map.insert(branch.to_string(), full_hash);
                        full_hash
                    } else {
                        tracing::error!(
                            object_id = %update.object_id,
                            branch = %branch,
                            schema_hash = %composed.schema_hash.short(),
                            local_update,
                            "buffering row update for unknown schema hash; schema not yet known"
                        );
                        self.pending_row_visibility_changes.push(update);
                        return None;
                    }
                } else {
                    tracing::error!(
                        object_id = %update.object_id,
                        branch = %branch,
                        local_update,
                        "buffering row update for unknown branch; cannot parse schema hash"
                    );
                    self.pending_row_visibility_changes.push(update);
                    return None;
                }
            }
        };

        let logical_table = resolve_current_table_name(
            &self.schema_context,
            &original_table,
            origin_schema_hash.as_ref(),
        )
        .unwrap_or_else(|| original_table.to_string());
        let branch_table = if schema_hash == self.schema_context.current_hash {
            logical_table.clone()
        } else {
            translate_table_name_to_schema(&self.schema_context, &logical_table, &schema_hash)
                .unwrap_or_else(|| original_table.to_string())
        };
        let table_name = TableName::new(&branch_table);

        let table_schema = if schema_hash == self.schema_context.current_hash {
            match self.schema.get(&table_name) {
                Some(schema) => schema.clone(),
                None => return None,
            }
        } else if let Some(schema) = self.schema_context.get_schema(&schema_hash) {
            match schema.get(&table_name) {
                Some(table_schema) => table_schema.clone(),
                None => return None,
            }
        } else if let Some(schema) = self.known_schemas.get(&schema_hash) {
            match schema.get(&table_name) {
                Some(table_schema) => table_schema.clone(),
                None => return None,
            }
        } else {
            tracing::error!(
                object_id = %update.object_id,
                branch = %branch,
                schema_hash = %schema_hash.short(),
                "buffering row update because schema for branch is not available yet"
            );
            self.pending_row_visibility_changes.push(update);
            return None;
        };

        let descriptor = table_schema.columns.clone();
        let old_row = update.previous_row.as_ref();
        let current_batch_id = update.row.batch_id;
        let current_row_key = RowBatchKey::from_row(&update.row);

        if let Some(previous_row) = old_row
            && previous_row.state.is_visible()
            && let Some(rows) = self.visible_rows_by_batch.get_mut(&previous_row.batch_id)
        {
            rows.remove(&(logical_table.clone(), update.object_id));
            if rows.is_empty() {
                self.visible_rows_by_batch.remove(&previous_row.batch_id);
            }
        }
        if update.row.state.is_visible() {
            let rows = self
                .visible_rows_by_batch
                .entry(current_batch_id)
                .or_default();
            rows.insert((logical_table.clone(), update.object_id));
        }

        if local_update {
            self.pending_local_row_batches
                .insert(update.object_id, current_row_key);
        } else if let Some(pending_row_key) = self
            .pending_local_row_batches
            .get(&update.object_id)
            .copied()
            && (pending_row_key.branch_name.as_str() == update.row.branch.as_str())
            && (pending_row_key.batch_id != current_batch_id
                || update.row.confirmed_tier == Some(DurabilityTier::GlobalServer))
        {
            self.pending_local_row_batches.remove(&update.object_id);
        }

        if self.visible_row_is_hard_deleted(storage, update.object_id, &update.row.branch)
            && !update.row.is_hard_deleted()
        {
            return None;
        }

        if update.row.is_hard_deleted() {
            if apply_index_mutations {
                let old_data = old_row.map(|row| row.data.as_ref());
                let _ = Self::update_indices_for_hard_delete_on_branch(
                    storage,
                    &branch_table,
                    branch,
                    update.object_id,
                    old_data,
                    &descriptor,
                    table_schema.indexed_columns.as_deref(),
                );
            }
            return Some(SubscriptionVisibilityEffect {
                table: logical_table,
                row_id: update.object_id,
                local_dirty: local_update,
                row_mark: SubscriptionRowMark::Deleted,
                local_row_overlay: local_update,
            });
        }

        if update.row.is_soft_deleted() {
            if apply_index_mutations {
                if let Some(old_row) = old_row {
                    let _ = Self::update_indices_for_soft_delete_on_branch(
                        storage,
                        &branch_table,
                        branch,
                        update.object_id,
                        &old_row.data,
                        &descriptor,
                        table_schema.indexed_columns.as_deref(),
                    );
                } else {
                    let _ = storage.index_remove(
                        &branch_table,
                        "_id",
                        branch,
                        &Value::Uuid(update.object_id),
                        update.object_id,
                    );
                    if let Err(error) = storage.index_insert(
                        &branch_table,
                        "_id_deleted",
                        branch,
                        &Value::Uuid(update.object_id),
                        update.object_id,
                    ) {
                        tracing::error!(
                            table = branch_table,
                            branch,
                            object_id = %update.object_id,
                            %error,
                            "failed to insert synced _id_deleted index entry"
                        );
                    }
                }
            }
            return Some(SubscriptionVisibilityEffect {
                table: logical_table,
                row_id: update.object_id,
                local_dirty: local_update,
                row_mark: SubscriptionRowMark::Deleted,
                local_row_overlay: false,
            });
        }

        let was_soft_deleted = old_row.is_some_and(StoredRowBatch::is_soft_deleted);
        let new_data = &update.row.data;

        if was_soft_deleted {
            if apply_index_mutations
                && let Err(error) = Self::update_indices_for_undelete_on_branch(
                    storage,
                    &branch_table,
                    branch,
                    update.object_id,
                    new_data,
                    &descriptor,
                    table_schema.indexed_columns.as_deref(),
                )
            {
                tracing::error!(
                    table = branch_table,
                    branch,
                    object_id = %update.object_id,
                    %error,
                    "failed to update indices for synced undelete"
                );
            }
            return Some(SubscriptionVisibilityEffect {
                table: logical_table,
                row_id: update.object_id,
                local_dirty: local_update,
                row_mark: SubscriptionRowMark::Updated,
                local_row_overlay: local_update,
            });
        }

        if old_row.is_none() {
            if apply_index_mutations
                && let Err(error) = Self::update_indices_for_insert_on_branch(
                    storage,
                    &branch_table,
                    branch,
                    update.object_id,
                    new_data,
                    &descriptor,
                    table_schema.indexed_columns.as_deref(),
                )
            {
                tracing::error!(
                    table = branch_table,
                    branch,
                    object_id = %update.object_id,
                    index_column = error.column.as_str(),
                    error = %error.source,
                    "failed to update indices for synced insert"
                );
            }
        } else if let Some(old_row) = old_row
            && apply_index_mutations
            && let Err(error) = Self::update_indices_for_update_on_branch(
                storage,
                super::indices::BranchIndexTarget {
                    table: &branch_table,
                    branch,
                    descriptor: &descriptor,
                    indexed_columns: table_schema.indexed_columns.as_deref(),
                },
                update.object_id,
                &old_row.data,
                new_data,
            )
        {
            tracing::error!(
                table = branch_table,
                branch,
                object_id = %update.object_id,
                %error,
                "failed to update indices for synced update"
            );
        }

        if local_update {
            Some(SubscriptionVisibilityEffect {
                table: logical_table,
                row_id: update.object_id,
                local_dirty: true,
                row_mark: SubscriptionRowMark::Updated,
                local_row_overlay: true,
            })
        } else {
            let self_referential_table_update = old_row.is_some()
                && table_schema.columns.columns.iter().any(|column| {
                    column.references.as_ref().is_some_and(|referenced| {
                        referenced.as_str() == logical_table.as_str()
                            || referenced.as_str() == original_table.as_str()
                            || referenced.as_str() == branch_table.as_str()
                    })
                });
            if self_referential_table_update
                || Self::select_policy_columns_changed(
                    table_schema.policies.select_policy(),
                    &table_name,
                    &descriptor,
                    old_row.map(|row| row.data.as_ref()),
                    new_data,
                )
            {
                return Some(SubscriptionVisibilityEffect {
                    table: logical_table,
                    row_id: update.object_id,
                    local_dirty: false,
                    row_mark: SubscriptionRowMark::UpdatedAndDeleted,
                    local_row_overlay: false,
                });
            }
            Some(SubscriptionVisibilityEffect {
                table: logical_table,
                row_id: update.object_id,
                local_dirty: false,
                row_mark: SubscriptionRowMark::Updated,
                local_row_overlay: false,
            })
        }
    }

    fn select_policy_columns_changed(
        policy: Option<&PolicyExpr>,
        table_name: &TableName,
        descriptor: &RowDescriptor,
        old_data: Option<&[u8]>,
        new_data: &[u8],
    ) -> bool {
        let Some(policy) = policy else {
            return false;
        };
        let Some(old_data) = old_data else {
            return !matches!(policy, PolicyExpr::True);
        };
        let columns = Self::policy_local_columns(policy);
        let Ok(old_values) = decode_row(descriptor, old_data) else {
            return true;
        };
        let Ok(new_values) = decode_row(descriptor, new_data) else {
            return true;
        };
        if descriptor
            .columns
            .iter()
            .enumerate()
            .any(|(index, column)| {
                column
                    .references
                    .as_ref()
                    .is_some_and(|referenced| referenced == table_name)
                    && old_values.get(index) != new_values.get(index)
            })
        {
            return true;
        }
        if columns.is_empty() {
            return false;
        }

        columns.into_iter().any(|column| {
            descriptor
                .column_index(&column)
                .is_some_and(|index| old_values.get(index) != new_values.get(index))
        })
    }

    fn policy_local_columns(policy: &PolicyExpr) -> HashSet<String> {
        let mut columns = HashSet::new();
        Self::collect_policy_local_columns(policy, &mut columns);
        columns
    }

    fn collect_policy_local_columns(policy: &PolicyExpr, columns: &mut HashSet<String>) {
        match policy {
            PolicyExpr::Cmp { column, .. }
            | PolicyExpr::IsNull { column }
            | PolicyExpr::IsNotNull { column }
            | PolicyExpr::Contains { column, .. }
            | PolicyExpr::In { column, .. }
            | PolicyExpr::InList { column, .. }
            | PolicyExpr::Inherits {
                via_column: column, ..
            } => {
                columns.insert(column.clone());
            }
            PolicyExpr::And(exprs) | PolicyExpr::Or(exprs) => {
                for expr in exprs {
                    Self::collect_policy_local_columns(expr, columns);
                }
            }
            PolicyExpr::Not(expr)
            | PolicyExpr::Exists {
                condition: expr, ..
            } => {
                Self::collect_policy_local_columns(expr, columns);
            }
            PolicyExpr::SessionCmp { .. }
            | PolicyExpr::SessionIsNull { .. }
            | PolicyExpr::SessionIsNotNull { .. }
            | PolicyExpr::SessionContains { .. }
            | PolicyExpr::SessionInList { .. }
            | PolicyExpr::ExistsRel { .. }
            | PolicyExpr::InheritsReferencing { .. }
            | PolicyExpr::True
            | PolicyExpr::False => {}
        }
    }

    pub(crate) fn handle_row_update(
        &mut self,
        storage: &mut dyn Storage,
        update: RowVisibilityChange,
    ) {
        self.handle_row_update_with_origin(storage, update, false, true);
    }

    fn handle_row_updates_batched(
        &mut self,
        storage: &mut dyn Storage,
        updates: Vec<RowVisibilityChange>,
    ) {
        if updates.is_empty() {
            return;
        }

        let mut effects = BatchedSubscriptionVisibilityEffects::default();
        for update in updates {
            if let Some(effect) = self.prepare_row_update_with_origin(storage, update, false, true)
            {
                effects.push(effect);
            }
        }
        self.apply_batched_subscription_visibility_effects(effects);
    }

    fn apply_subscription_visibility_effect(&mut self, effect: SubscriptionVisibilityEffect) {
        let mut effects = BatchedSubscriptionVisibilityEffects::default();
        effects.push(effect);
        self.apply_batched_subscription_visibility_effects(effects);
    }

    fn apply_batched_subscription_visibility_effects(
        &mut self,
        effects: BatchedSubscriptionVisibilityEffects,
    ) {
        if effects.is_empty() {
            return;
        }

        for table in &effects.remote_dirty_tables {
            self.mark_subscriptions_dirty(table);
        }
        for table in &effects.local_dirty_tables {
            self.mark_subscriptions_dirty_local(table);
        }

        for (table, ids) in &effects.remote_updated {
            self.mark_rows_updated_in_subscriptions(table, ids, false);
        }
        for (table, ids) in &effects.local_updated {
            self.mark_rows_updated_in_subscriptions(table, ids, true);
        }
        for (table, ids) in &effects.remote_deleted {
            self.mark_rows_deleted_in_subscriptions(table, ids, false);
        }
        for (table, ids) in &effects.local_deleted {
            self.mark_rows_deleted_in_subscriptions(table, ids, true);
        }
    }

    /// Mark subscriptions dirty for a table based on update origin.
    fn mark_subscriptions_dirty_with_origin(&mut self, table: &str, local_update: bool) {
        // Mark local subscriptions dirty
        for subscription in self.subscriptions.values_mut() {
            if Self::subscription_involves_table(&subscription.graph, table) {
                subscription.graph.mark_dirty_for_table(table);
                if local_update {
                    subscription.has_pending_local_updates = true;
                }
            }
        }
    }

    /// Mark subscriptions dirty from external updates (default behavior).
    ///
    /// Checks all tables involved in the subscription (including joined tables).
    /// Also marks server-side subscriptions for downstream clients.
    pub(super) fn mark_subscriptions_dirty(&mut self, table: &str) {
        self.mark_subscriptions_dirty_with_origin(table, false);
    }

    /// Mark subscriptions dirty from local writes.
    pub(super) fn mark_subscriptions_dirty_local(&mut self, table: &str) {
        self.mark_subscriptions_dirty_with_origin(table, true);
    }

    fn mark_rows_updated_in_subscriptions(
        &mut self,
        table: &str,
        ids: &ahash::AHashSet<ObjectId>,
        local_overlay: bool,
    ) {
        for subscription in self.subscriptions.values_mut() {
            if Self::subscription_involves_table(&subscription.graph, table) {
                subscription.graph.mark_rows_updated(ids);
                if local_overlay {
                    subscription
                        .pending_local_row_ids
                        .extend(ids.iter().copied());
                }
            }
        }
    }

    pub(crate) fn mark_local_row_updated_in_subscriptions(&mut self, table: &str, id: ObjectId) {
        for subscription in self.subscriptions.values_mut() {
            if Self::subscription_involves_table(&subscription.graph, table) {
                subscription.graph.mark_row_updated(id);
                subscription.pending_local_row_ids.insert(id);
            }
        }
    }

    fn mark_rows_deleted_in_subscriptions(
        &mut self,
        table: &str,
        ids: &ahash::AHashSet<ObjectId>,
        local_overlay: bool,
    ) {
        for subscription in self.subscriptions.values_mut() {
            if Self::subscription_involves_table(&subscription.graph, table) {
                subscription.graph.mark_rows_deleted(ids);
                if local_overlay {
                    subscription
                        .pending_local_row_ids
                        .extend(ids.iter().copied());
                }
            }
        }
    }

    pub(super) fn mark_local_row_deleted_in_subscriptions(&mut self, table: &str, id: ObjectId) {
        for subscription in self.subscriptions.values_mut() {
            if Self::subscription_involves_table(&subscription.graph, table) {
                subscription.graph.mark_row_deleted(id);
                subscription.pending_local_row_ids.insert(id);
            }
        }
    }

    pub(crate) fn clear_local_pending_row_overlay(&mut self, table: &str, id: ObjectId) {
        self.pending_local_row_batches.remove(&id);
        self.mark_subscriptions_dirty_local(table);
        self.mark_local_row_updated_in_subscriptions(table, id);
    }

    fn load_row_locator(storage: &dyn Storage, row_id: ObjectId) -> Option<RowLocator> {
        storage.load_row_locator(row_id).ok().flatten()
    }

    pub(super) fn load_best_visible_row_batch(
        &self,
        storage: &dyn Storage,
        row_id: ObjectId,
        branches: &[String],
        durability_tier: Option<DurabilityTier>,
        schema_context: &SchemaContext,
        branch_schema_map: &HashMap<String, SchemaHash>,
    ) -> Option<(String, QueryRowBatch)> {
        Self::load_best_visible_row_batch_from_storage(
            storage,
            row_id,
            branches,
            durability_tier,
            schema_context,
            branch_schema_map,
        )
    }

    pub(super) fn load_best_visible_row_batch_from_storage(
        storage: &dyn Storage,
        row_id: ObjectId,
        branches: &[String],
        durability_tier: Option<DurabilityTier>,
        schema_context: &SchemaContext,
        branch_schema_map: &HashMap<String, SchemaHash>,
    ) -> Option<(String, QueryRowBatch)> {
        let locator = Self::load_row_locator(storage, row_id)?;
        Self::load_best_visible_row_batch_from_storage_with_locator(
            storage,
            row_id,
            &locator,
            branches,
            durability_tier,
            schema_context,
            branch_schema_map,
        )
    }

    fn branch_schema_hash_for_visible_load(
        branch: &str,
        schema_context: &SchemaContext,
        branch_schema_map: &HashMap<String, SchemaHash>,
    ) -> Option<SchemaHash> {
        branch_schema_map
            .get(branch)
            .copied()
            .or_else(|| {
                (branch == schema_context.branch_name().as_str())
                    .then_some(schema_context.current_hash)
            })
            .or_else(|| {
                ComposedBranchName::parse(&BranchName::new(branch)).and_then(|composed| {
                    if composed.schema_hash.short() == schema_context.current_hash.short() {
                        Some(schema_context.current_hash)
                    } else {
                        schema_context
                            .live_schemas
                            .keys()
                            .copied()
                            .find(|hash| hash.short() == composed.schema_hash.short())
                    }
                })
            })
    }

    fn load_visible_query_row_from_candidate_tables(
        storage: &dyn Storage,
        primary_table: &str,
        fallback_table: Option<&str>,
        branch: &str,
        row_id: ObjectId,
        durability_tier: Option<DurabilityTier>,
    ) -> Option<QueryRowBatch> {
        let load = |table: &str| match durability_tier {
            Some(required_tier) => {
                storage.load_visible_query_row_for_tier(table, branch, row_id, required_tier)
            }
            None => storage.load_visible_query_row(table, branch, row_id),
        };

        load(primary_table).ok().flatten().or_else(|| {
            fallback_table
                .filter(|fallback| *fallback != primary_table)
                .and_then(|fallback| load(fallback).ok().flatten())
        })
    }

    fn load_local_pending_query_row_from_candidate_tables(
        storage: &dyn Storage,
        primary_table: &str,
        fallback_table: Option<&str>,
        row_batch_key: RowBatchKey,
    ) -> Option<QueryRowBatch> {
        let load = |table: &str| {
            storage.load_history_query_row_batch(
                table,
                row_batch_key.branch_name.as_str(),
                row_batch_key.row_id,
                row_batch_key.batch_id,
            )
        };

        load(primary_table).ok().flatten().or_else(|| {
            fallback_table
                .filter(|fallback| *fallback != primary_table)
                .and_then(|fallback| load(fallback).ok().flatten())
        })
    }

    fn load_local_pending_query_row_with_hint_or_locator(
        storage: &dyn Storage,
        row_batch_key: RowBatchKey,
        table_hint: Option<&str>,
        schema_context: &SchemaContext,
    ) -> Option<(String, QueryRowBatch)> {
        if let Some(hint) = table_hint
            && let Some(row) = Self::load_local_pending_query_row_from_candidate_tables(
                storage,
                hint,
                None,
                row_batch_key,
            )
        {
            return Some((hint.to_string(), row));
        }

        let locator = Self::load_row_locator(storage, row_batch_key.row_id)?;
        let original_table = locator.table.as_str();
        let current_table = locator
            .origin_schema_hash
            .filter(|hash| *hash != schema_context.current_hash)
            .and_then(|origin_schema_hash| {
                resolve_current_table_name(
                    schema_context,
                    original_table,
                    Some(&origin_schema_hash),
                )
            })
            .filter(|translated| translated != original_table);
        let current_table_name = current_table.as_deref().unwrap_or(original_table);
        let row = Self::load_local_pending_query_row_from_candidate_tables(
            storage,
            current_table_name,
            Some(original_table),
            row_batch_key,
        )?;
        Some((current_table_name.to_string(), row))
    }

    fn load_best_visible_row_batch_from_storage_with_table_hint(
        storage: &dyn Storage,
        row_id: ObjectId,
        table_hint: &str,
        branches: &[String],
        durability_tier: Option<DurabilityTier>,
        schema_context: &SchemaContext,
        branch_schema_map: &HashMap<String, SchemaHash>,
    ) -> Option<(String, QueryRowBatch)> {
        let mut best: Option<(BatchId, QueryRowBatch)> = None;

        for branch in branches {
            let branch_schema_hash = Self::branch_schema_hash_for_visible_load(
                branch,
                schema_context,
                branch_schema_map,
            );
            let translated_table = branch_schema_hash.and_then(|hash| {
                (hash != schema_context.current_hash)
                    .then(|| translate_table_name_to_schema(schema_context, table_hint, &hash))
                    .flatten()
            });
            let primary_table = translated_table.as_deref().unwrap_or(table_hint);
            let loaded_row = Self::load_visible_query_row_from_candidate_tables(
                storage,
                primary_table,
                Some(table_hint),
                branch,
                row_id,
                durability_tier,
            );
            let Some(row) = loaded_row else {
                continue;
            };

            if !row.state.is_visible() {
                continue;
            }

            let batch_id = row.batch_id;
            match &best {
                None => best = Some((batch_id, row)),
                Some((best_batch_id, best_row))
                    if (row.updated_at, batch_id) > (best_row.updated_at, *best_batch_id) =>
                {
                    best = Some((batch_id, row));
                }
                _ => {}
            }
        }

        best.map(|(_, row)| (table_hint.to_string(), row))
    }

    pub(super) fn load_best_visible_row_batch_with_hint_or_locator(
        storage: &dyn Storage,
        row_id: ObjectId,
        table_hint: Option<&str>,
        branches: &[String],
        durability_tier: Option<DurabilityTier>,
        schema_context: &SchemaContext,
        branch_schema_map: &HashMap<String, SchemaHash>,
    ) -> Option<(String, QueryRowBatch)> {
        table_hint
            .and_then(|hint| {
                Self::load_best_visible_row_batch_from_storage_with_table_hint(
                    storage,
                    row_id,
                    hint,
                    branches,
                    durability_tier,
                    schema_context,
                    branch_schema_map,
                )
            })
            .or_else(|| {
                Self::load_best_visible_row_batch_from_storage(
                    storage,
                    row_id,
                    branches,
                    durability_tier,
                    schema_context,
                    branch_schema_map,
                )
            })
    }

    fn load_best_visible_row_batch_from_storage_with_locator(
        storage: &dyn Storage,
        row_id: ObjectId,
        locator: &RowLocator,
        branches: &[String],
        durability_tier: Option<DurabilityTier>,
        schema_context: &SchemaContext,
        branch_schema_map: &HashMap<String, SchemaHash>,
    ) -> Option<(String, QueryRowBatch)> {
        let original_table = locator.table.as_str();
        let current_table = locator
            .origin_schema_hash
            .filter(|hash| *hash != schema_context.current_hash)
            .and_then(|origin_schema_hash| {
                resolve_current_table_name(
                    schema_context,
                    original_table,
                    Some(&origin_schema_hash),
                )
            })
            .filter(|translated| translated != original_table);
        let current_table_name = current_table.as_deref().unwrap_or(original_table);

        let mut best: Option<(BatchId, QueryRowBatch)> = None;

        for branch in branches {
            let branch_schema_hash = Self::branch_schema_hash_for_visible_load(
                branch,
                schema_context,
                branch_schema_map,
            );
            let translated_table = match branch_schema_hash {
                Some(hash) if hash == schema_context.current_hash => None,
                Some(hash) => {
                    translate_table_name_to_schema(schema_context, current_table_name, &hash)
                }
                None => None,
            };
            let primary_table = match branch_schema_hash {
                Some(hash) if hash == schema_context.current_hash => current_table_name,
                Some(_) => translated_table.as_deref().unwrap_or(original_table),
                None => original_table,
            };
            let loaded_row = Self::load_visible_query_row_from_candidate_tables(
                storage,
                primary_table,
                Some(original_table),
                branch,
                row_id,
                durability_tier,
            );
            let Some(row) = loaded_row else {
                continue;
            };

            if !row.state.is_visible() {
                continue;
            }

            let batch_id = row.batch_id;
            match &best {
                None => best = Some((batch_id, row)),
                Some((best_batch_id, best_row))
                    if (row.updated_at, batch_id) > (best_row.updated_at, *best_batch_id) =>
                {
                    best = Some((batch_id, row));
                }
                _ => {}
            }
        }

        best.map(|(_, row)| (current_table_name.to_string(), row))
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn load_visible_row_for_query(
        storage: &dyn Storage,
        row_id: ObjectId,
        table_hint: Option<&str>,
        branches: &[String],
        durability_tier: Option<DurabilityTier>,
        local_pending_version: Option<RowBatchKey>,
        prefer_local_overlay: bool,
        allow_staged_overlay: bool,
        include_deleted: bool,
        schema_context: &SchemaContext,
        branch_schema_map: &HashMap<String, SchemaHash>,
        table_for_warnings: &str,
        sub_id: QuerySubscriptionId,
        schema_warnings: &mut SchemaWarningAccumulator,
    ) -> Option<LoadedRow> {
        let exact_pending_visible_row = || {
            let pending_version = local_pending_version?;
            let resolved = Self::load_best_visible_row_batch_with_hint_or_locator(
                storage,
                row_id,
                table_hint,
                branches,
                None,
                schema_context,
                branch_schema_map,
            )?;
            let (_, row) = &resolved;
            (row.batch_id == pending_version.batch_id
                && row.branch.as_str() == pending_version.branch_name.as_str())
            .then_some(resolved)
        };
        let pending_staged_row = || {
            let pending_version = local_pending_version?;
            let resolved = Self::load_local_pending_query_row_with_hint_or_locator(
                storage,
                pending_version,
                table_hint,
                schema_context,
            )?;
            let (_, row) = &resolved;
            (row.batch_id == pending_version.batch_id
                && row.branch.as_str() == pending_version.branch_name.as_str()
                && matches!(row.state, RowState::StagingPending))
            .then_some(resolved)
        };
        let best_visible_row = || {
            Self::load_best_visible_row_batch_with_hint_or_locator(
                storage,
                row_id,
                table_hint,
                branches,
                durability_tier,
                schema_context,
                branch_schema_map,
            )
        };
        let resolved = if prefer_local_overlay {
            exact_pending_visible_row()
                .or_else(pending_staged_row)
                .or_else(best_visible_row)
        } else if allow_staged_overlay {
            best_visible_row()
                .or_else(exact_pending_visible_row)
                .or_else(pending_staged_row)
        } else {
            best_visible_row().or_else(exact_pending_visible_row)
        }?;
        let (table, row) = resolved;

        if row.is_hard_deleted() {
            return None;
        }

        if row.is_soft_deleted() && !include_deleted {
            return None;
        }

        let batch_id = row.batch_id;
        let row_provenance = row.row_provenance();
        let source_branch = row.branch.as_str();

        if let Some(&source_hash) = branch_schema_map.get(source_branch)
            && source_hash != schema_context.current_hash
        {
            let transformer = LensTransformer::new(schema_context, &table);
            match transformer.transform(&row.data, batch_id, source_hash) {
                Ok(result) => {
                    return Some(LoadedRow::new(
                        result.data,
                        row_provenance,
                        [(row_id, BranchName::new(source_branch))]
                            .into_iter()
                            .collect(),
                        result.batch_id,
                    ));
                }
                Err(err) => {
                    schema_warnings.record(
                        table_for_warnings,
                        source_hash,
                        schema_context.current_hash,
                    );
                    tracing::debug!(
                        sub_id = sub_id.0,
                        row_id = %row_id,
                        table = %table,
                        source_branch = source_branch,
                        source_schema = %source_hash.short(),
                        target_schema = %schema_context.current_hash.short(),
                        error = %err,
                        "lens transform failed; row will be counted in aggregated schema warning"
                    );
                    return None;
                }
            }
        }

        Some(LoadedRow::new(
            row.data,
            row_provenance,
            [(row_id, BranchName::new(source_branch))]
                .into_iter()
                .collect(),
            row.batch_id,
        ))
    }

    /// Check if a subscription involves a given table (base table, joined table, or array subquery inner table).
    pub(super) fn subscription_involves_table(
        graph: &super::graph::QueryGraph,
        table: &str,
    ) -> bool {
        graph.involves_table(table)
    }

    pub(super) fn row_delta_from_rows(
        previous_rows: &HashMap<ObjectId, Row>,
        previous_order: &[ObjectId],
        next_rows: &[Row],
    ) -> RowDelta {
        let next_rows_by_id: HashMap<_, _> =
            next_rows.iter().cloned().map(|row| (row.id, row)).collect();
        let previous_indices: HashMap<_, _> = previous_order
            .iter()
            .enumerate()
            .map(|(index, id)| (*id, index))
            .collect();
        let next_indices: HashMap<_, _> = next_rows
            .iter()
            .enumerate()
            .map(|(index, row)| (row.id, index))
            .collect();

        let added = next_rows
            .iter()
            .filter(|row| !previous_rows.contains_key(&row.id))
            .cloned()
            .collect();
        let removed = previous_order
            .iter()
            .filter_map(|id| previous_rows.get(id))
            .filter(|row| !next_rows_by_id.contains_key(&row.id))
            .cloned()
            .collect();
        let updated = next_rows
            .iter()
            .filter_map(|row| {
                previous_rows.get(&row.id).and_then(|previous| {
                    (previous.data != row.data || previous.batch_id != row.batch_id)
                        .then(|| (previous.clone(), row.clone()))
                })
            })
            .collect();
        let moved = next_rows
            .iter()
            .filter(|row| {
                previous_rows.contains_key(&row.id)
                    && previous_rows
                        .get(&row.id)
                        .map(|previous| {
                            previous.data == row.data && previous.batch_id == row.batch_id
                        })
                        .unwrap_or(false)
                    && previous_indices.get(&row.id) != next_indices.get(&row.id)
            })
            .map(|row| row.id)
            .collect();

        RowDelta {
            added,
            removed,
            moved,
            updated,
        }
    }

    pub(super) fn rows_from_tuples(graph: &QueryGraph, tuples: &[Tuple]) -> Vec<Row> {
        tuples
            .iter()
            .filter_map(|tuple| {
                if tuple.len() == 1 {
                    tuple.to_single_row()
                } else {
                    tuple
                        .flatten_with_descriptors(
                            &graph.table_descriptors,
                            &graph.combined_descriptor,
                        )
                        .and_then(|flattened| flattened.to_single_row())
                }
            })
            .collect()
    }

    fn scope_from_tuples(tuples: &[Tuple]) -> HashSet<(ObjectId, BranchName)> {
        tuples
            .iter()
            .flat_map(|tuple| tuple.provenance().iter().copied())
            .collect()
    }

    fn authoritative_batch_fate_cached(
        &mut self,
        storage: &dyn Storage,
        batch_id: BatchId,
    ) -> Option<BatchFate> {
        if let Some(settlement) = self.authoritative_batch_fate_cache.get(&batch_id) {
            return settlement.clone();
        }

        let settlement = match storage.load_authoritative_batch_fate(batch_id) {
            Ok(settlement) => settlement,
            Err(error) => {
                tracing::warn!(?batch_id, %error, "failed to load authoritative batch settlement");
                None
            }
        };
        self.authoritative_batch_fate_cache
            .insert(batch_id, settlement.clone());
        settlement
    }

    fn transactional_batch_complete_for_query_scope(
        &mut self,
        storage: &dyn Storage,
        batch_id: BatchId,
        local_scope: &HashSet<(ObjectId, BranchName)>,
        query_scope: &HashSet<(ObjectId, BranchName)>,
    ) -> bool {
        let settlement = self.authoritative_batch_fate_cached(storage, batch_id);

        !matches!(settlement, Some(BatchFate::AcceptedTransaction { .. }))
            || query_scope.is_subset(local_scope)
    }

    fn filter_transaction_visible_tuples<'a>(
        &mut self,
        storage: &dyn Storage,
        tuples: Cow<'a, [Tuple]>,
    ) -> Cow<'a, [Tuple]> {
        if tuples.is_empty() {
            return tuples;
        }

        // Peer-mesh mode has no upstream servers, so the remote query scope is
        // always empty: the query scope is exactly the local scope.
        let local_scope = Self::scope_from_tuples(tuples.as_ref());
        let query_scope = local_scope.clone();

        let mut first_hidden = None;

        for (index, tuple) in tuples.as_ref().iter().enumerate() {
            let is_visible = tuple.batch_provenance().iter().copied().all(|batch_id| {
                self.transactional_batch_complete_for_query_scope(
                    storage,
                    batch_id,
                    &local_scope,
                    &query_scope,
                )
            });
            if !is_visible {
                first_hidden = Some(index);
                break;
            }
        }

        let Some(first_hidden) = first_hidden else {
            return tuples;
        };

        let mut filtered = Vec::with_capacity(tuples.len().saturating_sub(1));
        filtered.extend_from_slice(&tuples.as_ref()[..first_hidden]);
        for tuple in &tuples.as_ref()[first_hidden + 1..] {
            if tuple.batch_provenance().iter().copied().all(|batch_id| {
                self.transactional_batch_complete_for_query_scope(
                    storage,
                    batch_id,
                    &local_scope,
                    &query_scope,
                )
            }) {
                filtered.push(tuple.clone());
            }
        }
        Cow::Owned(filtered)
    }
    // ========================================================================
    // No-op storage driver (for tests)
    // ========================================================================

    // ========================================================================
    // Memory profiling
    // ========================================================================

    /// Calculate memory usage breakdown for profiling.
    ///
    /// Returns a tuple: (indices, subscriptions, policy_checks, total)
    /// Note: indices are managed by Storage, so index memory is reported as 0.
    pub fn memory_size(&self) -> (usize, usize, usize, usize) {
        let indices = 0usize; // Indices managed by Storage

        // Subscriptions (QueryGraph can be large)
        let mut subscriptions = 0usize;
        for (id, sub) in &self.subscriptions {
            subscriptions += std::mem::size_of_val(id);
            subscriptions += std::mem::size_of::<QuerySubscription>();
            subscriptions += sub.graph.estimate_memory_size();
            subscriptions += 48; // HashMap entry overhead
        }
        subscriptions += self.update_outbox.len() * 256; // QueryUpdate overhead

        // Active policy checks (ReBAC removed — always zero, kept for tuple shape).
        let policy_checks = 0usize;

        let total = indices + subscriptions + policy_checks;
        (indices, subscriptions, policy_checks, total)
    }
}

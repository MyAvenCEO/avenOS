use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::batch_fate::{BatchFate, SealedBatchSubmission};
use crate::catalogue::CatalogueEntry;
use crate::object::{BranchName, ObjectId};
use crate::query_manager::session::Session;
use crate::query_manager::types::SchemaHash;
use crate::row_histories::{BatchId, StoredRowBatch};

/// Error returned when a policy denies an operation.
#[derive(Debug, Clone)]
pub struct PolicyError {
    pub message: String,
}

// ============================================================================
// ID Types
// ============================================================================

/// Persistence tier — declaration order defines Ord (Local < EdgeServer < GlobalServer).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub enum DurabilityTier {
    Local,
    EdgeServer,
    GlobalServer,
}

/// A peer's identity = its Ed25519 public key (32 bytes), the same key the
/// `did:key:` encodes. This is the **full, non-lossy** identity — not a derived
/// UUID. Stays `Copy` (fixed-size), so no move-cascade. The app renders `did:key`
/// from these bytes; the wire/storage form is 64-char hex.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PeerId(pub [u8; 32]);

impl PeerId {
    /// Synthetic unique id for tests / fallback. Real peers carry their pubkey.
    pub fn new() -> Self {
        let mut bytes = [0u8; 32];
        bytes[..16].copy_from_slice(Uuid::now_v7().as_bytes());
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Parse from the 64-char hex wire/storage form.
    pub fn parse(s: &str) -> Option<Self> {
        let bytes: [u8; 32] = hex::decode(s.trim()).ok()?.try_into().ok()?;
        Some(Self(bytes))
    }
}

impl Default for PeerId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for PeerId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", hex::encode(self.0))
    }
}

/// Unique identifier for a query subscription.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct QueryId(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum QueryPropagation {
    #[default]
    #[serde(rename = "full")]
    Full,
    #[serde(rename = "local-only")]
    LocalOnly,
}

/// Unique identifier for a pending permission check.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PendingUpdateId(pub u64);

/// Stable identity for one concrete row batch entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RowBatchKey {
    pub row_id: ObjectId,
    pub branch_name: BranchName,
    pub batch_id: BatchId,
}

impl RowBatchKey {
    pub fn new(row_id: ObjectId, branch_name: BranchName, batch_id: BatchId) -> Self {
        Self {
            row_id,
            branch_name,
            batch_id,
        }
    }

    pub fn from_row(row: &StoredRowBatch) -> Self {
        Self::new(row.row_id, BranchName::new(&row.branch), row.batch_id)
    }
}

// ============================================================================
// Connection State
// ============================================================================

/// Tracking state for a connected peer client.
///
/// No per-peer delivery ledger: peer sync is frontier-driven (announce → need →
/// `frontier_diff`), so "what have I sent to whom" is never tracked — dropping
/// all of this forces a re-diff, never a re-send (§6 one-tracker invariant).
#[derive(Debug, Clone, Default)]
pub struct ClientState {
    /// Client's session for policy evaluation.
    pub session: Option<Session>,
}

impl ClientState {
    /// Create a new ClientState with an optional session.
    pub fn with_session(session: Option<Session>) -> Self {
        Self {
            session,
            ..Default::default()
        }
    }
}

// ============================================================================
// Errors
// ============================================================================

/// Strongly typed errors for sync operations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SyncError {
    /// Operation denied due to insufficient permission.
    PermissionDenied {
        object_id: ObjectId,
        branch_name: BranchName,
        code: String,
        reason: String,
    },
    /// Client must have a session to write.
    SessionRequired {
        object_id: ObjectId,
        branch_name: BranchName,
    },
    /// This client role cannot write catalogue objects.
    CatalogueWriteDenied {
        object_id: ObjectId,
        branch_name: BranchName,
    },
}

// ============================================================================
// Message Protocol
// ============================================================================

/// Row metadata sent once per destination.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RowMetadata {
    pub id: ObjectId,
    pub metadata: HashMap<String, String>,
}

/// Payload for sync messages between peers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SyncPayload {
    /// Semantic update for one catalogue/system entry.
    CatalogueEntryUpdated { entry: CatalogueEntry },

    /// Upstream replication of a newly created or newly learned row batch entry.
    RowBatchCreated {
        metadata: Option<RowMetadata>,
        row: StoredRowBatch,
    },

    /// Downstream delivery of a row batch entry that is needed for a subscriber's scope.
    RowBatchNeeded {
        metadata: Option<RowMetadata>,
        row: StoredRowBatch,
    },

    /// Replayable fate for one logical batch.
    BatchFate { fate: BatchFate },

    /// Request current replayable fate for specific batch ids.
    BatchFateNeeded { batch_ids: Vec<BatchId> },

    /// Anti-entropy: "here are my causal heads for `resource`" (sent on connect
    /// and on local seal). The receiver replies `FrontierNeed` with its own heads.
    FrontierAnnounce { resource: String, heads: Vec<BatchId> },

    /// Anti-entropy pull: "my heads for `resource` are these — send what I'm
    /// owed". The holder ships `frontier_diff(local, heads)`, gated by `may_sync`.
    FrontierNeed { resource: String, heads: Vec<BatchId> },

    /// **Eviction notice** (best-effort, trust-based): an admin tells a *revoked* peer
    /// to drop its now-orphaned local rows for `resource` (an identity urn). The receiver
    /// hard-deletes those rows **locally only** — the engine forwards it to the app, which
    /// applies `delete_with_metadata(Hard + NoSync)` so no false tombstone propagates.
    /// Not a security boundary (backward reads are unrecoverable); it is cleanup so an
    /// honest revoked peer doesn't retain stale data. Applied on trust — a revoked peer
    /// can't self-verify revocation (it still holds the old biscuit), so a misfired notice
    /// only forces a re-sync for a still-valid member, never a permanent loss.
    EvictResource { resource: String },

    /// Explicitly seal a transactional batch so the authority can validate it.
    SealBatch { submission: SealedBatchSubmission },

    /// Error response.
    Error(SyncError),
}

/// Warning emitted when a query encounters rows that cannot be transformed into the
/// subscriber's target schema because no reviewed migration path exists yet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaWarning {
    pub query_id: QueryId,
    pub table_name: String,
    pub row_count: usize,
    pub from_hash: SchemaHash,
    pub to_hash: SchemaHash,
}

/// Warning sent to the client when its schema is either disconnected from the permissions schema
/// or not connected to other schemas known to the server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSchemaDiagnostics {
    pub client_schema_hash: SchemaHash,
    pub disconnected_permissions_schema_hash: Option<SchemaHash>,
    pub unreachable_schema_hashes: Vec<SchemaHash>,
}

impl ConnectionSchemaDiagnostics {
    pub fn has_issues(&self) -> bool {
        self.disconnected_permissions_schema_hash.is_some()
            || !self.unreachable_schema_hashes.is_empty()
    }
}

impl SyncPayload {
    pub fn object_id(&self) -> Option<ObjectId> {
        match self {
            SyncPayload::CatalogueEntryUpdated { entry } => Some(entry.object_id),
            SyncPayload::RowBatchCreated { row, .. } | SyncPayload::RowBatchNeeded { row, .. } => {
                Some(row.row_id)
            }
            SyncPayload::BatchFate { .. } => None,
            SyncPayload::BatchFateNeeded { .. } => None,
            SyncPayload::SealBatch { submission } => {
                submission.members.first().map(|member| member.object_id)
            }
            _ => None,
        }
    }

    pub fn branch_name(&self) -> Option<BranchName> {
        match self {
            SyncPayload::CatalogueEntryUpdated { .. } => None,
            SyncPayload::RowBatchCreated { row, .. } | SyncPayload::RowBatchNeeded { row, .. } => {
                Some(BranchName::new(&row.branch))
            }
            SyncPayload::BatchFate { .. } => None,
            SyncPayload::BatchFateNeeded { .. } => None,
            SyncPayload::SealBatch { .. } => None,
            _ => None,
        }
    }

    /// True when handling this payload may mutate local storage.
    pub fn writes_storage(&self) -> bool {
        matches!(
            self,
            SyncPayload::CatalogueEntryUpdated { .. }
                | SyncPayload::RowBatchCreated { .. }
                | SyncPayload::RowBatchNeeded { .. }
                | SyncPayload::BatchFate { .. }
                | SyncPayload::SealBatch { .. }
        )
    }

    /// Encode this payload using postcard.
    pub fn to_bytes(&self) -> Result<Vec<u8>, postcard::Error> {
        postcard::to_allocvec(self)
    }

    /// Decode a payload from postcard bytes.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, postcard::Error> {
        postcard::from_bytes(bytes)
    }

    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }

    /// Check if this payload carries a catalogue object (schema or lens).
    pub fn is_catalogue(&self) -> bool {
        match self {
            SyncPayload::CatalogueEntryUpdated { entry } => entry.is_catalogue(),
            SyncPayload::RowBatchCreated { metadata, .. }
            | SyncPayload::RowBatchNeeded { metadata, .. } => metadata
                .as_ref()
                .and_then(|metadata| {
                    metadata
                        .metadata
                        .get(crate::metadata::MetadataKey::Type.as_str())
                })
                .is_some_and(|kind| crate::metadata::ObjectType::is_catalogue_type_str(kind)),
            _ => false,
        }
    }

    /// Check if this payload carries a structural schema catalogue object.
    pub fn is_structural_schema_catalogue(&self) -> bool {
        matches!(self, SyncPayload::CatalogueEntryUpdated { entry } if entry.is_structural_schema_catalogue())
    }

    /// Get the variant name for debugging.
    pub fn variant_name(&self) -> &'static str {
        match self {
            SyncPayload::CatalogueEntryUpdated { .. } => "CatalogueEntryUpdated",
            SyncPayload::RowBatchCreated { .. } => "RowBatchCreated",
            SyncPayload::RowBatchNeeded { .. } => "RowBatchNeeded",
            SyncPayload::BatchFate { .. } => "BatchFate",
            SyncPayload::BatchFateNeeded { .. } => "BatchFateNeeded",
            SyncPayload::FrontierAnnounce { .. } => "FrontierAnnounce",
            SyncPayload::FrontierNeed { .. } => "FrontierNeed",
            SyncPayload::EvictResource { .. } => "EvictResource",
            SyncPayload::SealBatch { .. } => "SealBatch",
            SyncPayload::Error(_) => "Error",
        }
    }
}

/// Either end of a peer relationship. `Source` and `Destination` are mirror
/// images, and both expose the same peer identity fields for telemetry.
trait PeerEnd {
    fn descriptor(&self) -> (&'static str, String);
}

/// Destination for an outbox entry.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Destination {
    Client(PeerId),
}

impl PeerEnd for Destination {
    fn descriptor(&self) -> (&'static str, String) {
        match self {
            Destination::Client(id) => ("client", id.to_string()),
        }
    }
}

impl Destination {
    pub fn peer_kind(&self) -> &'static str {
        PeerEnd::descriptor(self).0
    }

    pub fn peer_label(&self) -> String {
        PeerEnd::descriptor(self).1
    }
}

/// Source of an inbox entry.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Source {
    Client(PeerId),
}

impl PeerEnd for Source {
    fn descriptor(&self) -> (&'static str, String) {
        match self {
            Source::Client(id) => ("client", id.to_string()),
        }
    }
}

impl Source {
    pub fn peer_kind(&self) -> &'static str {
        PeerEnd::descriptor(self).0
    }

    pub fn peer_label(&self) -> String {
        PeerEnd::descriptor(self).1
    }
}

/// Outgoing message to be sent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboxEntry {
    pub destination: Destination,
    pub payload: SyncPayload,
}

/// Incoming message to be processed.
#[derive(Debug, Clone)]
pub struct InboxEntry {
    pub source: Source,
    pub payload: SyncPayload,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn destination_exposes_peer_identity_for_telemetry() {
        let client_id = PeerId::new();
        let client = Destination::Client(client_id);

        assert_eq!(client.peer_kind(), "client");
        assert_eq!(client.peer_label(), client_id.to_string());
    }

    #[test]
    fn source_exposes_peer_identity_for_telemetry() {
        let client_id = PeerId::new();
        let client = Source::Client(client_id);

        assert_eq!(client.peer_kind(), "client");
        assert_eq!(client.peer_label(), client_id.to_string());
    }
}

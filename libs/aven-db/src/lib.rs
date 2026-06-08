extern crate self as groove;

pub mod batch_fate;
pub mod catalogue;
pub mod commit;
pub mod digest;
pub mod metadata;
pub mod object;
pub mod query_manager;
pub mod row_format;
pub mod row_histories;
pub mod runtime_core;
pub mod schema_manager;
pub mod storage;
pub mod sync_manager;
pub mod capability;
pub mod did_key;
pub mod sync_targets;
#[cfg(feature = "client-p2p")]
pub mod sync_transport;
#[cfg(any(test, feature = "test-utils"))]
pub mod test_support;
pub mod wire_types;

/// The per-resource frontier — the only peer tracker (pure, storage-free core).
pub mod frontier;
pub use frontier::{frontier_diff, heads_for, FrontierDag};

pub use sync_manager::sync_tracer;

#[cfg(feature = "runtime-tokio")]
pub mod runtime_tokio;
#[cfg(feature = "runtime-tokio")]
pub use runtime_tokio as groove_tokio;

#[cfg(feature = "client-p2p")]
mod avenos_client;

#[cfg(feature = "client-p2p")]
use std::path::PathBuf;

#[cfg(feature = "client-p2p")]
use thiserror::Error;

#[cfg(feature = "client-p2p")]
pub use avenos_client::{JazzClient, PeerInboundParkedHook};
pub use sync_manager::RowBatchKey;
pub use capability::{
    AccOp, AllowAllResolver, CapDecision, CapabilityResolver, DenyAllResolver, ResourceCoord,
    may_hold,
};
pub use sync_targets::SyncTargetId;
#[cfg(feature = "client-p2p")]
pub use sync_transport::{
    decode_length_prefixed, encode_length_prefixed, NullSyncTransport, PeerTransport, SyncTransport,
};
#[cfg(feature = "client-p2p")]
pub use sync_manager::{InboxEntry, Source, SyncPayload};
#[cfg(feature = "client-p2p")]
pub use object::ObjectId;
#[cfg(feature = "client-p2p")]
pub use query_manager::query::{Query, QueryBuilder};
#[cfg(feature = "client-p2p")]
pub use query_manager::session::Session;
#[cfg(feature = "client-p2p")]
pub use query_manager::types::{
    ColumnType, OrderedRowDelta, Row, RowDelta, Schema, SchemaBuilder, TableName, TableSchema,
    Value,
};
#[cfg(feature = "client-p2p")]
pub use schema_manager::AppId;
#[cfg(feature = "client-p2p")]
pub use sync_manager::PeerId;
#[cfg(feature = "client-p2p")]
pub use sync_manager::DurabilityTier;

/// Configuration for connecting to Jazz (AvenOS P2P client).
#[cfg(feature = "client-p2p")]
#[derive(Debug, Clone)]
pub struct AppContext {
    pub app_id: AppId,
    pub client_id: Option<PeerId>,
    pub schema: Schema,
    pub data_dir: PathBuf,
    /// Older schema versions registered via Jazz lenses (local-first migrations).
    pub live_schemas: Vec<Schema>,
}

#[cfg(feature = "client-p2p")]
#[derive(Error, Debug)]
pub enum JazzError {
    #[error("Connection error: {0}")]
    Connection(String),
    #[error("Query error: {0}")]
    Query(String),
    #[error("Write error: {0}")]
    Write(String),
    #[error("Sync error: {0}")]
    Sync(String),
    #[error("Storage error: {0}")]
    Storage(String),
    #[error("Schema error: {0}")]
    Schema(String),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Channel closed")]
    ChannelClosed,
}

#[cfg(feature = "client-p2p")]
pub type Result<T> = std::result::Result<T, JazzError>;

#[cfg(feature = "client-p2p")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SubscriptionHandle(pub u64);

#[cfg(feature = "client-p2p")]
pub struct SubscriptionStream {
    receiver: tokio::sync::mpsc::Receiver<OrderedRowDelta>,
}

#[cfg(feature = "client-p2p")]
impl SubscriptionStream {
    pub(crate) fn new(receiver: tokio::sync::mpsc::Receiver<OrderedRowDelta>) -> Self {
        Self { receiver }
    }

    pub async fn next(&mut self) -> Option<OrderedRowDelta> {
        self.receiver.recv().await
    }
}

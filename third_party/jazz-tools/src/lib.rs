extern crate self as groove;

#[path = "_published_groove/commit.rs"]
pub mod commit;
#[path = "_published_groove/metadata.rs"]
pub mod metadata;
#[path = "_published_groove/object.rs"]
pub mod object;
#[path = "_published_groove/object_manager/mod.rs"]
pub mod object_manager;
#[path = "_published_groove/query_manager/mod.rs"]
pub mod query_manager;
#[path = "_published_groove/runtime_core.rs"]
pub mod runtime_core;
#[path = "_published_groove/schema_manager/mod.rs"]
pub mod schema_manager;
#[path = "_published_groove/storage/mod.rs"]
pub mod storage;
#[path = "_published_groove/sync_manager/mod.rs"]
pub mod sync_manager;

#[cfg(feature = "runtime-tokio")]
#[path = "_published_runtime_tokio/lib.rs"]
pub mod runtime_tokio;
#[cfg(feature = "runtime-tokio")]
pub use runtime_tokio as groove_tokio;

#[cfg(feature = "transport")]
pub mod transport_protocol;
#[cfg(feature = "transport")]
pub use transport_protocol as jazz_transport;

#[cfg(feature = "client")]
mod client;
#[cfg(feature = "client")]
mod transport;
#[cfg(all(feature = "client", feature = "peer-transport"))]
mod peer_transport;

#[cfg(feature = "client")]
use std::path::PathBuf;

#[cfg(feature = "client")]
use thiserror::Error;

#[cfg(feature = "client")]
pub use client::{JazzClient, SessionClient};

#[cfg(all(feature = "client", feature = "peer-transport"))]
pub use peer_transport::{PeerTransport, decode_length_prefixed, encode_length_prefixed};
#[cfg(all(feature = "client", feature = "peer-transport"))]
pub use sync_manager::SyncPayload;
#[cfg(all(feature = "client", feature = "peer-transport"))]
pub use sync_manager::{InboxEntry, Source};


#[cfg(all(feature = "client", feature = "transport"))]
pub use jazz_transport::ServerEvent;
#[cfg(feature = "client")]
pub use object::ObjectId;
#[cfg(feature = "client")]
pub use query_manager::query::{Query, QueryBuilder};
#[cfg(feature = "client")]
pub use query_manager::session::Session;
#[cfg(feature = "client")]
pub use query_manager::types::{
    ColumnType, Row, RowDelta, Schema, SchemaBuilder, TableName, TableSchema, Value,
};
#[cfg(feature = "client")]
pub use schema_manager::AppId;
#[cfg(feature = "client")]
pub use sync_manager::ClientId;
#[cfg(feature = "client")]
pub use sync_manager::PersistenceTier;
#[cfg(feature = "client")]
pub use sync_manager::ServerId;

/// Configuration for connecting to Jazz.
#[cfg(feature = "client")]
#[derive(Debug, Clone)]
pub struct AppContext {
    /// Application ID.
    pub app_id: AppId,
    /// Client ID (generated if not provided).
    pub client_id: Option<ClientId>,
    /// Schema for this client.
    pub schema: Schema,
    /// Server URL for sync (e.g., "http://localhost:1625").
    pub server_url: String,
    /// Local data directory for SurrealKV storage.
    pub data_dir: PathBuf,

    // Authentication fields
    /// JWT token for frontend authentication.
    /// Sent as `Authorization: Bearer <token>`.
    pub jwt_token: Option<String>,
    /// Backend secret for session impersonation.
    /// Enables `for_session()` to act as any user.
    pub backend_secret: Option<String>,
    /// Admin secret for schema/policy sync.
    /// Required to sync catalogue objects.
    pub admin_secret: Option<String>,

    /// Older schema versions to register via Jazz lenses (local-first migrations).
    /// Populated by the host when on-disk schema hash differs from the current manifest.
    pub live_schemas: Vec<Schema>,
}

/// Errors from Jazz client operations.
#[cfg(feature = "client")]
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

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Channel closed")]
    ChannelClosed,
}

/// Result type for Jazz operations.
#[cfg(feature = "client")]
pub type Result<T> = std::result::Result<T, JazzError>;

/// Handle to a subscription.
#[cfg(feature = "client")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SubscriptionHandle(pub u64);

/// Stream of row deltas from a subscription.
#[cfg(feature = "client")]
pub struct SubscriptionStream {
    receiver: tokio::sync::mpsc::Receiver<RowDelta>,
}

#[cfg(feature = "client")]
impl SubscriptionStream {
    /// Create a new subscription stream.
    pub(crate) fn new(receiver: tokio::sync::mpsc::Receiver<RowDelta>) -> Self {
        Self { receiver }
    }

    /// Get the next delta, waiting if necessary.
    pub async fn next(&mut self) -> Option<RowDelta> {
        self.receiver.recv().await
    }
}

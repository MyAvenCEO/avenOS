//! Transport-agnostic sync recipient identifiers.

use serde::{Deserialize, Serialize};

use crate::sync_manager::PeerId;

/// Who may receive a replicated sync frame.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SyncTargetId {
    /// Trusted peer mesh member (`did:key:…`).
    PeerDid(String),
    /// Downstream client session (Groove role).
    Client(PeerId),
}

impl SyncTargetId {
    pub fn peer_did(did: impl Into<String>) -> Self {
        Self::PeerDid(did.into())
    }

    pub fn as_peer_did(&self) -> Option<&str> {
        match self {
            Self::PeerDid(d) => Some(d.as_str()),
            _ => None,
        }
    }

    pub fn from_client_id(client: PeerId) -> Self {
        Self::Client(client)
    }
}

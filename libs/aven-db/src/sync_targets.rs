//! Transport-agnostic sync recipient identifiers.

use serde::{Deserialize, Serialize};

use crate::sync_manager::PeerId;

/// Who may receive a replicated sync frame.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SyncTargetId {
    /// Trusted peer mesh member (`did:key:…`).
    SignerDid(String),
    /// Downstream client session (Groove role).
    Client(PeerId),
}

impl SyncTargetId {
    pub fn signer_did(did: impl Into<String>) -> Self {
        Self::SignerDid(did.into())
    }

    pub fn as_signer_did(&self) -> Option<&str> {
        match self {
            Self::SignerDid(d) => Some(d.as_str()),
            _ => None,
        }
    }

    pub fn from_client_id(client: PeerId) -> Self {
        Self::Client(client)
    }
}

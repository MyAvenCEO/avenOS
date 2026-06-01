//! Biscuit-driven sync authorization hook (app implements).

use crate::sync_manager::SyncPayload;
use crate::sync_targets::SyncTargetId;

/// Decides whether a sync payload may be delivered to a target.
pub trait SyncAuthorizer: Send + Sync {
    fn may_deliver(&self, recipient: &SyncTargetId, payload: &SyncPayload) -> bool;
}

/// Permissive default — used in tests and when no app policy is wired.
#[derive(Debug, Clone, Copy, Default)]
pub struct AllowAllSyncAuthorizer;

impl SyncAuthorizer for AllowAllSyncAuthorizer {
    fn may_deliver(&self, _recipient: &SyncTargetId, _payload: &SyncPayload) -> bool {
        true
    }
}

/// Deny all outbound sync — local-only mode default at the transport layer.
#[derive(Debug, Clone, Copy, Default)]
pub struct DenyAllSyncAuthorizer;

impl SyncAuthorizer for DenyAllSyncAuthorizer {
    fn may_deliver(&self, _recipient: &SyncTargetId, _payload: &SyncPayload) -> bool {
        false
    }
}

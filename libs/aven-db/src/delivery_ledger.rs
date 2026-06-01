//! DID-scoped delivery tracking aligned with sync authorization scopes.

use std::collections::{HashMap, HashSet};

use crate::object::{BranchName, ObjectId};
use crate::row_histories::BatchId;
use crate::sync_authorizer::SyncAuthorizer;
use crate::sync_manager::SyncPayload;
use crate::sync_targets::SyncTargetId;

/// Stable key for one concrete row batch in the ledger.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RowBatchKey {
    pub object_id: ObjectId,
    pub branch_name: BranchName,
    pub batch_id: BatchId,
}

/// Per-target delivery state — keys by peer DID for mesh, PeerId for downstream clients.
#[derive(Debug, Default)]
pub struct DeliveryLedger {
    delivered: HashMap<SyncTargetId, HashSet<RowBatchKey>>,
    pending: HashMap<SyncTargetId, HashSet<RowBatchKey>>,
}

impl DeliveryLedger {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn queue(&mut self, target: SyncTargetId, key: RowBatchKey) {
        self.pending.entry(target).or_default().insert(key);
    }

    pub fn mark_delivered(&mut self, target: &SyncTargetId, key: RowBatchKey) {
        if let Some(p) = self.pending.get_mut(target) {
            p.remove(&key);
        }
        self.delivered.entry(target.clone()).or_default().insert(key);
    }

    pub fn is_delivered(&self, target: &SyncTargetId, key: &RowBatchKey) -> bool {
        self.delivered
            .get(target)
            .is_some_and(|s| s.contains(key))
    }

    pub fn pending_for(&self, target: &SyncTargetId) -> usize {
        self.pending.get(target).map(|s| s.len()).unwrap_or(0)
    }

    /// Drop all ledger entries scoped to one spark object (grant/revoke replay).
    pub fn invalidate_object(&mut self, target: &SyncTargetId, object_id: ObjectId) {
        for map in [&mut self.delivered, &mut self.pending] {
            if let Some(set) = map.get_mut(target) {
                set.retain(|k| k.object_id != object_id);
            }
        }
    }

    /// Record delivery only when policy allows; returns whether the batch was accepted.
    pub fn try_deliver<A: SyncAuthorizer>(
        &mut self,
        authorizer: &A,
        target: SyncTargetId,
        key: RowBatchKey,
        payload: &SyncPayload,
    ) -> bool {
        if !authorizer.may_deliver(&target, payload) {
            return false;
        }
        self.mark_delivered(&target, key);
        true
    }
}

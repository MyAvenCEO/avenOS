//! The per-resource frontier — **the only peer tracker**.
//!
//! A frontier is the set of causal DAG heads a peer holds (the Hypercore
//! "have"-set analogue). It is **derived, never persisted separately**: storage's
//! visible-region frontier *is* this have-set, so there is one source of truth —
//! the hash-linked batch DAG — and nothing to drift.
//!
//! [`frontier_diff`] is **pure, stateless and symmetric**. Reconciliation is a
//! head-set diff plus an ancestor-reachability walk (row history is a DAG, not a
//! linear log). Because it holds no non-derivable state, dropping every cache
//! forces a re-diff that resends **zero** already-held batches — convergence is
//! path/order-independent and crash-safe by construction (the resilience
//! property locked by tests T6/T7/T9).

use std::collections::{HashMap, HashSet};

use crate::object::ObjectId;
use crate::row_histories::BatchId;

/// A local view of a resource's batch DAG: each held batch → its parent batch ids.
///
/// In production this is read from storage (`load_visible_region_frontier` /
/// `scan_row_branch_tip_ids`); [`frontier_diff`] treats it abstractly so the core
/// logic is unit-testable with zero storage and zero networking.
#[derive(Debug, Default, Clone)]
pub struct FrontierDag {
    parents: HashMap<BatchId, Vec<BatchId>>,
}

impl FrontierDag {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record that we hold `batch` with the given `parents`. Idempotent — a
    /// batch's parent set is immutable, so a repeat insert is a no-op.
    pub fn insert(&mut self, batch: BatchId, parents: Vec<BatchId>) {
        self.parents.entry(batch).or_insert(parents);
    }

    /// True if we hold `batch` locally.
    pub fn contains(&self, batch: &BatchId) -> bool {
        self.parents.contains_key(batch)
    }

    /// Number of batches held.
    pub fn len(&self) -> usize {
        self.parents.len()
    }

    pub fn is_empty(&self) -> bool {
        self.parents.is_empty()
    }

    /// One reconciliation pull: copy from `source` every batch we are missing
    /// (computed by [`frontier_diff`] against our heads), each with its parents,
    /// in parents-first order. Returns how many batches transferred.
    ///
    /// This is the whole anti-entropy step. It is **stateless and idempotent**:
    /// a second pull against the same source transfers zero (T6), convergence is
    /// path/order-independent (T5/T7), and a partition heals by pulling both ways
    /// after reconnect (T9). Dedup is automatic — already-held batch ids are never
    /// re-pulled, regardless of how many paths a batch arrives by.
    pub fn pull_from(&mut self, source: &FrontierDag) -> usize {
        let missing = frontier_diff(source, &self.heads());
        for batch in &missing {
            let parents = source.parents_of(batch).to_vec();
            self.insert(*batch, parents);
        }
        missing.len()
    }

    fn parents_of(&self, batch: &BatchId) -> &[BatchId] {
        self.parents.get(batch).map(|p| p.as_slice()).unwrap_or(&[])
    }

    /// Causal heads — held batches that are not a parent of any other held batch.
    /// This is what a peer announces (`FrontierAnnounce`). Deterministically ordered.
    pub fn heads(&self) -> Vec<BatchId> {
        let mut is_parent: HashSet<BatchId> = HashSet::new();
        for parents in self.parents.values() {
            for parent in parents {
                is_parent.insert(*parent);
            }
        }
        let mut heads: Vec<BatchId> = self
            .parents
            .keys()
            .copied()
            .filter(|b| !is_parent.contains(b))
            .collect();
        heads.sort_by_key(|b| b.0);
        heads
    }

    /// Held batches in topological order (parents strictly before children),
    /// deterministic across runs.
    fn topo_order(&self) -> Vec<BatchId> {
        let mut visited: HashSet<BatchId> = HashSet::new();
        let mut out: Vec<BatchId> = Vec::new();
        let mut keys: Vec<BatchId> = self.parents.keys().copied().collect();
        keys.sort_by_key(|b| b.0);
        for key in keys {
            self.visit(key, &mut visited, &mut out);
        }
        out
    }

    fn visit(&self, batch: BatchId, visited: &mut HashSet<BatchId>, out: &mut Vec<BatchId>) {
        if !visited.insert(batch) {
            return;
        }
        // Only held batches are emitted — we can never send what we don't hold.
        if self.contains(&batch) {
            let mut parents: Vec<BatchId> = self.parents_of(&batch).to_vec();
            parents.sort_by_key(|b| b.0);
            for parent in parents {
                self.visit(parent, visited, out);
            }
            out.push(batch);
        }
    }
}

/// Pure, stateless, symmetric reconciliation.
///
/// Returns the batches the remote is **missing**, given my DAG and the remote's
/// announced `remote_heads`, in parents-before-children order ready to ship.
///
/// A batch is owed to the remote iff I hold it and it is **not reachable** from
/// the remote's heads within my DAG. Multi-head (merge) histories are handled by
/// the ancestor walk — this is never a scalar length compare.
pub fn frontier_diff(local: &FrontierDag, remote_heads: &[BatchId]) -> Vec<BatchId> {
    // Closure of what the remote already has (restricted to batches I can see).
    let mut remote_has: HashSet<BatchId> = HashSet::new();
    let mut stack: Vec<BatchId> = remote_heads
        .iter()
        .copied()
        .filter(|b| local.contains(b))
        .collect();
    while let Some(batch) = stack.pop() {
        if remote_has.insert(batch) {
            for parent in local.parents_of(&batch) {
                stack.push(*parent);
            }
        }
    }

    // Everything I hold that the remote lacks, parents first.
    local
        .topo_order()
        .into_iter()
        .filter(|b| !remote_has.contains(b))
        .collect()
}

/// Aggregate a resource's frontier from its rows' stored have-sets — the single
/// source of truth is storage, never a separate tracker.
///
/// `frontier_of(row)` yields one row's stored have-set (in production,
/// `storage.load_visible_region_frontier(table, branch, row)`); `heads_for`
/// unions and dedups them into the resource frontier. Production binding is a
/// one-liner:
///
/// ```ignore
/// let heads = heads_for(&row_ids, |row| {
///     storage.load_visible_region_frontier(table, branch, row).ok().flatten().unwrap_or_default()
/// });
/// ```
///
/// T3 locks the aggregation: `heads_for` == union of the per-row storage frontiers.
pub fn heads_for<F>(rows: &[ObjectId], mut frontier_of: F) -> Vec<BatchId>
where
    F: FnMut(ObjectId) -> Vec<BatchId>,
{
    let mut heads: Vec<BatchId> = Vec::new();
    for &row in rows {
        heads.extend(frontier_of(row));
    }
    heads.sort_by_key(|b| b.0);
    heads.dedup();
    heads
}

// Tests live in `tests/frontier_reconcile.rs` (integration target) because the
// crate's in-lib `#[cfg(test)]` modules currently fail to compile for unrelated
// reasons; an integration binary exercises the pure public API independently.

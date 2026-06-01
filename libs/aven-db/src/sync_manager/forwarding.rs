use super::*;
use crate::batch_fate::BatchFate;
use crate::object::{BranchName, ObjectId};
use crate::row_histories::{BatchId, HistoryScan, StoredRowBatch};
use crate::storage::{RowLocator, Storage, metadata_from_row_locator};
use std::collections::HashMap;

impl SyncManager {
    pub(super) fn load_current_row_from_storage<H: crate::storage::Storage + ?Sized>(
        &self,
        storage: &H,
        object_id: ObjectId,
        branch_name: &BranchName,
        row_locator: &RowLocator,
    ) -> Option<StoredRowBatch> {
        let table = row_locator.table.as_str();

        if let Ok(Some(row)) =
            storage.load_visible_region_row(table, branch_name.as_str(), object_id)
        {
            return Some(row);
        }

        storage
            .scan_history_region(
                table,
                branch_name.as_str(),
                HistoryScan::Row { row_id: object_id },
            )
            .ok()?
            .into_iter()
            .filter(|row| row.state.is_visible())
            .max_by_key(|row| (row.updated_at, row.batch_id()))
    }

    pub(super) fn load_batch_fate_by_batch_id_from_storage<H: crate::storage::Storage + ?Sized>(
        &self,
        storage: &H,
        batch_id: BatchId,
    ) -> Option<BatchFate> {
        storage
            .load_authoritative_batch_fate(batch_id)
            .ok()
            .flatten()
    }

    pub(super) fn queue_batch_fate_to_client(&mut self, client_id: PeerId, fate: BatchFate) {
        let Some(fate) = self.batch_fate_for_client(client_id, &fate) else {
            return;
        };
        self.queue_batch_fate_to_client_unfiltered(client_id, fate);
    }

    pub(super) fn queue_batch_fate_to_client_unfiltered(
        &mut self,
        client_id: PeerId,
        fate: BatchFate,
    ) {
        self.outbox.push(OutboxEntry {
            destination: Destination::Client(client_id),
            payload: SyncPayload::BatchFate { fate },
        });
    }

    pub(super) fn forward_update_to_clients_with_storage(
        &mut self,
        storage: &impl crate::storage::Storage,
        object_id: ObjectId,
        branch_name: BranchName,
    ) {
        self.forward_update_to_clients_except_with_storage(
            storage,
            object_id,
            branch_name,
            PeerId([0u8; 32]),
        );
    }

    pub(super) fn forward_update_to_clients_except_with_storage<H: crate::storage::Storage>(
        &mut self,
        storage: &H,
        object_id: ObjectId,
        branch_name: BranchName,
        except: PeerId,
    ) {
        // Frontier-driven delivery (§1.3): on a local change we announce our heads
        // to each peer; the peer pulls exactly what it's owed via FrontierNeed →
        // ship_frontier_diff. No row-targeted blanket push, no per-peer ledger.
        let _ = (object_id, branch_name);
        let client_ids: Vec<PeerId> = self
            .clients
            .keys()
            .copied()
            .filter(|id| *id != except)
            .collect();
        if client_ids.is_empty() {
            return;
        }
        let heads = self.resource_frontier_heads(storage);
        for client_id in client_ids {
            self.outbox.push(OutboxEntry {
                destination: Destination::Client(client_id),
                payload: SyncPayload::FrontierAnnounce {
                    resource: "all".to_string(),
                    heads: heads.clone(),
                },
            });
        }
    }

    // ========================================================================
    // Frontier anti-entropy (§1.3) — the pure tracker. Storage IS the have-set;
    // the DAG's heads are the frontier, the diff is the only delivery decision.
    // ========================================================================

    /// Causal heads of the syncable resource = heads of the DAG built from stored
    /// row history. No separate tracker — storage is the single source of truth.
    pub(super) fn resource_frontier_heads<H: Storage>(&self, storage: &H) -> Vec<BatchId> {
        self.build_sync_dag(storage).0.heads()
    }

    /// Ship the batches a peer is owed: `frontier_diff(our DAG, their heads)`,
    /// each forwarded only when `may_sync` Allows (per-hop gate, §6). Consults no
    /// per-peer ledger — re-running with the same heads ships nothing new.
    pub(super) fn ship_frontier_diff<H: Storage>(
        &mut self,
        storage: &H,
        client_id: PeerId,
        their_heads: &[BatchId],
    ) {
        let (dag, index) = self.build_sync_dag(storage);
        for batch_id in crate::frontier::frontier_diff(&dag, their_heads) {
            let Some((object_id, table, metadata, row)) = index.get(&batch_id) else {
                continue;
            };
            let res = crate::capability::ResourceCoord::new(
                format!("{table}:{object_id}"),
                table.clone(),
                *object_id,
            );
            if self.resolver.may_sync(
                &crate::sync_targets::SyncTargetId::Client(client_id),
                crate::capability::AccOp::Write,
                &res,
            ) == crate::capability::CapDecision::Allow
            {
                self.queue_row_to_client(client_id, *object_id, metadata.clone(), row.clone(), true);
            }
        }
    }

    /// Build a `FrontierDag` over all syncable rows + an index from `BatchId` to
    /// the `(object, table, metadata, row)` needed to forward it.
    #[allow(clippy::type_complexity)]
    fn build_sync_dag<H: Storage>(
        &self,
        storage: &H,
    ) -> (
        crate::frontier::FrontierDag,
        HashMap<BatchId, (ObjectId, String, HashMap<String, String>, StoredRowBatch)>,
    ) {
        let mut dag = crate::frontier::FrontierDag::new();
        let mut index: HashMap<BatchId, (ObjectId, String, HashMap<String, String>, StoredRowBatch)> =
            HashMap::new();
        let Ok(locators) = storage.scan_row_locators() else {
            return (dag, index);
        };
        for (object_id, locator) in locators {
            let table = locator.table.to_string();
            // Local identity / trust tables are never P2P-forwarded.
            if matches!(table.as_str(), "humans" | "peers") {
                continue;
            }
            let metadata = metadata_from_row_locator(&locator);
            if let Ok(batches) = storage.scan_history_row_batches(&table, object_id) {
                for row in batches {
                    dag.insert(row.batch_id, row.parents.to_vec());
                    index.insert(row.batch_id, (object_id, table.clone(), metadata.clone(), row));
                }
            }
        }
        (dag, index)
    }
}

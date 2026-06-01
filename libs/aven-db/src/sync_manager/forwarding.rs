use super::*;
use crate::batch_fate::BatchFate;
use crate::object::{BranchName, ObjectId};
use crate::row_histories::{BatchId, HistoryScan, StoredRowBatch};
use crate::storage::{RowLocator, Storage, metadata_from_row_locator};
use std::collections::{HashMap, HashSet};

impl SyncManager {
    fn object_has_upstream_confirmation<H: Storage>(
        &self,
        storage: &H,
        table: &str,
        branch_name: &BranchName,
        object_id: ObjectId,
    ) -> bool {
        let Ok(Some(visible_entry)) =
            storage.load_visible_region_entry(table, branch_name.as_str(), object_id)
        else {
            return false;
        };
        let local_tier = self.max_local_durability_tier();
        match local_tier {
            None => {
                visible_entry.current_row.confirmed_tier.is_some()
                    || visible_entry.worker_batch_id.is_some()
                    || visible_entry.edge_batch_id.is_some()
                    || visible_entry.global_batch_id.is_some()
            }
            Some(my_tier) => {
                visible_entry
                    .current_row
                    .confirmed_tier
                    .is_some_and(|row_tier| row_tier > my_tier)
                    || matches!(my_tier, DurabilityTier::Local)
                        && (visible_entry.edge_batch_id.is_some()
                            || visible_entry.global_batch_id.is_some())
                    || matches!(my_tier, DurabilityTier::EdgeServer)
                        && visible_entry.global_batch_id.is_some()
            }
        }
    }

    fn queue_row_to_server_with_storage<H: Storage>(
        &mut self,
        storage: &H,
        table: &str,
        server_id: ServerId,
        object_id: ObjectId,
        metadata: HashMap<String, String>,
        row: StoredRowBatch,
    ) {
        let branch_name = BranchName::new(&row.branch);
        let include_metadata = {
            let Some(server) = self.servers.get(&server_id) else {
                return;
            };
            let metadata_already_sent = server.sent_metadata.contains(&object_id);
            if !metadata_already_sent {
                true
            } else {
                !self.object_has_upstream_confirmation(storage, table, &branch_name, object_id)
            }
        };
        self.queue_row_to_server_with_metadata(
            server_id,
            object_id,
            metadata,
            row,
            include_metadata,
        );
    }

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

    pub(super) fn load_current_batch_fate_from_storage<H: crate::storage::Storage + ?Sized>(
        &self,
        storage: &H,
        object_id: ObjectId,
        branch_name: &BranchName,
        row_locator: &RowLocator,
    ) -> Option<BatchFate> {
        let row =
            self.load_current_row_from_storage(storage, object_id, branch_name, row_locator)?;
        if row.branch != branch_name.as_str() {
            return None;
        }
        match row.state {
            crate::row_histories::RowState::VisibleDirect
            | crate::row_histories::RowState::VisibleTransactional => {
                self.load_batch_fate_by_batch_id_from_storage(storage, row.batch_id)
            }
            crate::row_histories::RowState::StagingPending
            | crate::row_histories::RowState::Superseded
            | crate::row_histories::RowState::Rejected => None,
        }
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

    #[cfg(test)]
    pub fn forward_update_to_servers_with_storage<H: crate::storage::Storage>(
        &mut self,
        storage: &H,
        object_id: ObjectId,
        branch_name: BranchName,
    ) {
        let server_ids: Vec<ServerId> = self.servers.keys().copied().collect();
        if !server_ids.is_empty() {
            tracing::trace!(%object_id, %branch_name, servers = server_ids.len(), "forwarding to servers");
        }

        let Some(row_locator) = storage.load_row_locator(object_id).ok().flatten() else {
            return;
        };
        if let Some(row) =
            self.load_current_row_from_storage(storage, object_id, &branch_name, &row_locator)
        {
            let metadata = metadata_from_row_locator(&row_locator);
            self.forward_row_batch_to_servers_with_storage(
                storage,
                row_locator.table.as_str(),
                object_id,
                metadata,
                row,
            );
            return;
        }
    }

    pub(crate) fn forward_row_batch_to_servers_with_storage<H: Storage>(
        &mut self,
        storage: &H,
        table: &str,
        object_id: ObjectId,
        metadata: HashMap<String, String>,
        row: StoredRowBatch,
    ) {
        let server_ids: Vec<ServerId> = self.servers.keys().copied().collect();
        if !server_ids.is_empty() {
            tracing::trace!(
                %object_id,
                branch = row.branch.as_str(),
                servers = server_ids.len(),
                "forwarding row batch entry with parent closure to servers"
            );
        }

        for server_id in server_ids {
            let mut visiting = HashSet::new();
            self.queue_row_to_server_with_missing_parents(
                storage,
                table,
                server_id,
                metadata.clone(),
                row.clone(),
                &mut visiting,
            );
        }
    }

    pub(super) fn queue_row_to_server_with_missing_parents<H: Storage>(
        &mut self,
        storage: &H,
        table: &str,
        server_id: ServerId,
        metadata: HashMap<String, String>,
        row: StoredRowBatch,
        visiting: &mut HashSet<BatchId>,
    ) {
        let object_id = row.row_id;
        let branch_name = BranchName::new(&row.branch);
        let already_sent = self
            .servers
            .get(&server_id)
            .and_then(|server| {
                server
                    .sent_batch_ids
                    .get(&(object_id, branch_name))
                    .cloned()
            })
            .unwrap_or_default();

        for parent_batch_id in row.parents.iter().copied() {
            if already_sent.contains(&parent_batch_id) {
                continue;
            }
            if !visiting.insert(parent_batch_id) {
                continue;
            }

            match storage.load_history_row_batch(
                table,
                row.branch.as_str(),
                object_id,
                parent_batch_id,
            ) {
                Ok(Some(parent_row)) => self.queue_row_to_server_with_missing_parents(
                    storage,
                    table,
                    server_id,
                    metadata.clone(),
                    parent_row,
                    visiting,
                ),
                Ok(None) => tracing::warn!(
                    %server_id,
                    %object_id,
                    %branch_name,
                    ?parent_batch_id,
                    "missing parent row batch in local storage while queueing row batch to server"
                ),
                Err(error) => tracing::warn!(
                    %server_id,
                    %object_id,
                    %branch_name,
                    ?parent_batch_id,
                    %error,
                    "failed to load parent row batch while queueing row batch to server"
                ),
            }

            visiting.remove(&parent_batch_id);
        }

        self.queue_row_to_server_with_storage(storage, table, server_id, object_id, metadata, row);
    }

    pub(crate) fn forward_row_batch_to_servers<H: Storage>(
        &mut self,
        storage: &H,
        object_id: ObjectId,
        metadata: HashMap<String, String>,
        row: StoredRowBatch,
    ) {
        let table = metadata
            .get(crate::metadata::MetadataKey::Table.as_str())
            .cloned()
            .or_else(|| {
                storage
                    .load_row_locator(object_id)
                    .ok()
                    .flatten()
                    .map(|locator| locator.table.to_string())
            });

        if let Some(table) = table {
            self.forward_row_batch_to_servers_with_storage(
                storage,
                table.as_str(),
                object_id,
                metadata,
                row,
            );
            return;
        }

        let server_ids: Vec<ServerId> = self.servers.keys().copied().collect();
        if !server_ids.is_empty() {
            tracing::trace!(
                %object_id,
                branch = row.branch.as_str(),
                servers = server_ids.len(),
                "forwarding row batch entry to servers"
            );
        }

        for server_id in server_ids {
            let include_metadata = self
                .servers
                .get(&server_id)
                .is_some_and(|server| !server.sent_metadata.contains(&object_id));
            self.queue_row_to_server_with_metadata(
                server_id,
                object_id,
                metadata.clone(),
                row.clone(),
                include_metadata,
            );
        }
    }

    pub(crate) fn force_row_batch_to_servers(
        &mut self,
        object_id: ObjectId,
        metadata: HashMap<String, String>,
        row: StoredRowBatch,
    ) {
        let branch_name = BranchName::new(&row.branch);
        let batch_id = row.batch_id;
        let server_ids: Vec<ServerId> = self.servers.keys().copied().collect();

        for server_id in server_ids {
            if let Some(server) = self.servers.get_mut(&server_id) {
                server.sent_metadata.remove(&object_id);
                if let Some(sent_batches) = server.sent_batch_ids.get_mut(&(object_id, branch_name))
                {
                    sent_batches.remove(&batch_id);
                    if sent_batches.is_empty() {
                        server.sent_batch_ids.remove(&(object_id, branch_name));
                    }
                }
            }

            self.queue_row_to_server_with_metadata(
                server_id,
                object_id,
                metadata.clone(),
                row.clone(),
                true,
            );
        }
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

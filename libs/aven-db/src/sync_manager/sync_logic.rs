use super::*;
use crate::catalogue::CatalogueEntry;
use crate::object::{BranchName, ObjectId};
use crate::row_histories::StoredRowBatch;
use crate::storage::metadata_from_row_locator;
use std::collections::HashMap;

impl SyncManager {
    fn scope_delivery_row(mut row: StoredRowBatch) -> StoredRowBatch {
        if row.state.is_visible() {
            row.parents.clear();
        }
        row
    }

    pub(super) fn queue_catalogue_sync_to_client_from_storage<H: Storage>(
        &mut self,
        client_id: PeerId,
        storage: &H,
    ) {
        let Ok(entries) = storage.scan_catalogue_entries() else {
            return;
        };

        for entry in entries {
            self.catalogue_entries
                .insert(entry.object_id, entry.clone());
            self.queue_catalogue_entry_to_client(client_id, entry);
        }
    }

    pub fn upsert_catalogue_entry<H: Storage>(&mut self, storage: &mut H, entry: CatalogueEntry) {
        let changed = self.persist_catalogue_entry(storage, entry.clone());
        if !changed {
            return;
        }

        self.forward_catalogue_entry_to_clients(entry, None);
    }

    pub(super) fn persist_catalogue_entry<H: Storage>(
        &mut self,
        storage: &mut H,
        entry: CatalogueEntry,
    ) -> bool {
        let existing = self
            .catalogue_entries
            .get(&entry.object_id)
            .cloned()
            .or_else(|| storage.load_catalogue_entry(entry.object_id).ok().flatten());

        if existing.as_ref() == Some(&entry) {
            self.catalogue_entries.insert(entry.object_id, entry);
            return false;
        }

        if let Err(error) = storage.upsert_catalogue_entry(&entry) {
            tracing::warn!(
                object_id = %entry.object_id,
                %error,
                "failed to persist catalogue entry"
            );
        }

        self.catalogue_entries.insert(entry.object_id, entry);
        true
    }

    fn queue_catalogue_entry_to_client(&mut self, client_id: PeerId, entry: CatalogueEntry) {
        self.outbox.push(OutboxEntry {
            destination: Destination::Client(client_id),
            payload: SyncPayload::CatalogueEntryUpdated { entry },
        });
    }

    pub(super) fn forward_catalogue_entry_to_clients(
        &mut self,
        entry: CatalogueEntry,
        except: Option<PeerId>,
    ) {
        let client_ids: Vec<_> = self
            .clients
            .keys()
            .copied()
            .filter(|client_id| except != Some(*client_id))
            .collect();
        for client_id in client_ids {
            self.queue_catalogue_entry_to_client(client_id, entry.clone());
        }
    }

    pub(super) fn queue_initial_row_to_client_with_storage<H: Storage + ?Sized>(
        &mut self,
        storage: &H,
        client_id: PeerId,
        object_id: ObjectId,
        branch_name: BranchName,
        force_resend: bool,
    ) -> Option<BatchId> {
        let row_locator = storage.load_row_locator(object_id).ok().flatten()?;
        let metadata = metadata_from_row_locator(&row_locator);
        if let Some(row) =
            self.load_current_row_from_storage(storage, object_id, &branch_name, &row_locator)
        {
            let batch_id = row.batch_id;
            self.queue_row_to_client(client_id, object_id, metadata, row, force_resend);
            return Some(batch_id);
        }

        None
    }

    /// Forward one owed row batch to a peer. Called only from `ship_frontier_diff`,
    /// which has already computed (via `frontier_diff`) that the peer lacks this
    /// batch — so there is no per-peer "already sent" ledger to consult. Metadata
    /// is always attached; the receiver dedups by `BatchId`.
    pub(super) fn queue_row_to_client(
        &mut self,
        client_id: PeerId,
        object_id: ObjectId,
        metadata: HashMap<String, String>,
        row: StoredRowBatch,
        _force_resend: bool,
    ) {
        let row = Self::scope_delivery_row(row);
        if metadata
            .get(crate::metadata::MetadataKey::NoSync.as_str())
            .map(|v| v == "true")
            .unwrap_or(false)
        {
            return;
        }
        if !self.clients.contains_key(&client_id) {
            return;
        }

        let branch_name = BranchName::new(&row.branch);
        let batch_id = row.batch_id;
        self.row_batch_interest
            .entry(RowBatchKey::new(object_id, branch_name, batch_id))
            .or_default()
            .insert(client_id);

        self.outbox.push(OutboxEntry {
            destination: Destination::Client(client_id),
            payload: SyncPayload::RowBatchNeeded {
                metadata: Some(RowMetadata {
                    id: object_id,
                    metadata,
                }),
                row,
            },
        });
    }
}

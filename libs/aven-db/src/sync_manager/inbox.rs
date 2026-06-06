use super::*;
use crate::batch_fate::{BatchFate, BatchMode, SealedBatchSubmission};
use crate::object::{BranchName, ObjectId};
use crate::row_histories::{
    ApplyRowBatchWithContext, RowState, RowVisibilityChange, StoredRowBatch, apply_row_batch,
    apply_row_batch_with_context, patch_row_batch_state,
};
use crate::storage::{
    PreparedRowWriteContext, RowLocator, Storage, metadata_from_row_locator,
    prepared_row_table_context_for_schema_hash, prepared_row_write_context_from_table_context,
    row_locator_from_metadata,
};
use std::collections::{HashMap, HashSet};

struct AppliedRowBatch {
    row: StoredRowBatch,
    visibility_change: Option<RowVisibilityChange>,
}

/// Whether applying a visible row should also record this node's authoritative
/// fate for the row's batch. Peer-mesh mode never records fates on inbound apply,
/// so `Skip` is the only variant.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum AuthoritativeFateRecording {
    Skip,
}

impl AuthoritativeFateRecording {
    fn should_record(self) -> bool {
        matches!(self, Self::Skip if false)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SealedBatchMode {
    Direct,
    Transactional,
}

impl SyncManager {
    fn retain_client_batch_fate(&mut self, fate: &BatchFate) -> bool {
        tracing::debug!(
            batch_id = ?fate.batch_id(),
            "ignoring client-sent batch fate; authoritative fates are server-owned"
        );
        false
    }

    fn validate_sealed_batch_submission(
        &self,
        submission: &SealedBatchSubmission,
    ) -> Result<BranchName, BatchFate> {
        if submission.members.is_empty() {
            return Err(BatchFate::Rejected {
                batch_id: submission.batch_id,
                code: "invalid_batch_submission".to_string(),
                reason: "sealed batch must declare at least one member".to_string(),
            });
        }

        if submission.batch_digest
            != SealedBatchSubmission::compute_batch_digest(&submission.members)
        {
            return Err(BatchFate::Rejected {
                batch_id: submission.batch_id,
                code: "invalid_batch_submission".to_string(),
                reason: "sealed batch digest does not match declared members".to_string(),
            });
        }

        Ok(submission.target_branch_name)
    }

    fn validate_batch_rows_target_branch(
        &self,
        submission: &SealedBatchSubmission,
        batch_rows: &[(String, StoredRowBatch)],
    ) -> Result<(), BatchFate> {
        if batch_rows.iter().any(|(_, row)| {
            row.batch_id == submission.batch_id
                && row.branch.as_str() != submission.target_branch_name.as_str()
        }) {
            return Err(BatchFate::Rejected {
                batch_id: submission.batch_id,
                code: "invalid_batch_submission".to_string(),
                reason: "sealed batch rows must belong to the declared target branch".to_string(),
            });
        }

        Ok(())
    }

    fn infer_sealed_batch_mode(
        &self,
        submission: &SealedBatchSubmission,
        batch_rows: &[(String, StoredRowBatch)],
    ) -> Result<Option<SealedBatchMode>, BatchFate> {
        let mut mode = None;
        for (_, row) in batch_rows {
            let row_mode = match row.state {
                RowState::VisibleDirect => SealedBatchMode::Direct,
                RowState::StagingPending => match submission.mode {
                    BatchMode::Direct => SealedBatchMode::Direct,
                    BatchMode::Transactional => SealedBatchMode::Transactional,
                },
                _ => {
                    return Err(BatchFate::Rejected {
                        batch_id: submission.batch_id,
                        code: "invalid_batch_submission".to_string(),
                        reason: "sealed batch rows must be visible direct or staging pending"
                            .to_string(),
                    });
                }
            };

            match mode {
                Some(existing) if existing != row_mode => {
                    return Err(BatchFate::Rejected {
                        batch_id: submission.batch_id,
                        code: "invalid_batch_submission".to_string(),
                        reason: "sealed batch mixes direct and transactional rows".to_string(),
                    });
                }
                Some(_) => {}
                None => mode = Some(row_mode),
            }
        }

        Ok(mode)
    }

    fn parent_frontier_conflict_fate(&self, batch_id: crate::row_histories::BatchId) -> BatchFate {
        BatchFate::Rejected {
            batch_id,
            code: "transaction_conflict".to_string(),
            reason: "row visible parent changed since transaction write was staged".to_string(),
        }
    }

    fn normalize_frontier(
        mut frontier: Vec<crate::row_histories::BatchId>,
    ) -> Vec<crate::row_histories::BatchId> {
        frontier.sort();
        frontier.dedup();
        frontier
    }

    fn validate_transactional_parent_frontiers<H: Storage>(
        &self,
        storage: &H,
        submission: &SealedBatchSubmission,
        declared_rows: &[(String, StoredRowBatch)],
    ) -> Result<(), BatchFate> {
        for (table, row) in declared_rows {
            let expected_frontier = Self::normalize_frontier(row.parents.iter().copied().collect());
            let current_frontier = storage
                .load_visible_region_frontier(
                    table,
                    submission.target_branch_name.as_str(),
                    row.row_id,
                )
                .map_err(|error| BatchFate::Rejected {
                    batch_id: submission.batch_id,
                    code: "invalid_batch_submission".to_string(),
                    reason: format!("failed to load row visible parent frontier: {error}"),
                })?
                .map(Self::normalize_frontier)
                .unwrap_or_default();

            if current_frontier != expected_frontier {
                return Err(self.parent_frontier_conflict_fate(submission.batch_id));
            }
        }

        Ok(())
    }

    fn persist_authoritative_batch_fate<H: Storage>(
        &self,
        storage: &mut H,
        fate: &BatchFate,
    ) -> Result<bool, crate::storage::StorageError> {
        let previous = storage.load_authoritative_batch_fate(fate.batch_id())?;
        let merged = match previous.as_ref() {
            Some(existing) => existing.merged_with(fate),
            None => fate.clone(),
        };
        if previous.as_ref() == Some(&merged) {
            return Ok(false);
        }
        storage
            .upsert_authoritative_batch_fate(&merged)
            .map_err(|error| {
                tracing::trace!(
                    batch_id = ?fate.batch_id(),
                    %error,
                    "failed to persist authoritative batch fate"
                );
                error
            })?;
        Ok(true)
    }

    fn persist_sealed_batch_submission<H: Storage>(
        &self,
        storage: &mut H,
        submission: &SealedBatchSubmission,
    ) -> Result<(), crate::storage::StorageError> {
        storage
            .upsert_sealed_batch_submission(submission)
            .map_err(|error| {
                tracing::trace!(
                    batch_id = ?submission.batch_id,
                    %error,
                    "failed to persist sealed batch submission"
                );
                error
            })
    }

    fn ensure_object_metadata<H: Storage>(
        &mut self,
        storage: &mut H,
        object_id: ObjectId,
        metadata: HashMap<String, String>,
    ) -> (bool, bool) {
        let existing_row_locator = storage.load_row_locator(object_id).ok().flatten();
        let Some(metadata_row_locator) = crate::storage::row_locator_from_metadata(&metadata)
        else {
            return (false, false);
        };
        let metadata_schema_hash = metadata_row_locator.origin_schema_hash;
        match existing_row_locator {
            Some(existing_row_locator) => (
                false,
                existing_row_locator.origin_schema_hash != metadata_schema_hash,
            ),
            None => {
                let _ = storage.put_row_locator(object_id, Some(&metadata_row_locator));
                (true, false)
            }
        }
    }

    fn row_metadata_from_payload<H: Storage>(
        &self,
        storage: &H,
        row: &StoredRowBatch,
        metadata: Option<&RowMetadata>,
    ) -> Option<HashMap<String, String>> {
        if let Some(metadata) = metadata {
            return Some(metadata.metadata.clone());
        }

        storage
            .load_row_locator(row.row_id)
            .ok()
            .flatten()
            .map(|locator| metadata_from_row_locator(&locator))
    }

    fn row_context_from_metadata<H: Storage>(
        &mut self,
        storage: &H,
        metadata: &HashMap<String, String>,
        needs_exact_locator: bool,
    ) -> Option<(RowLocator, PreparedRowWriteContext)> {
        let row_locator = row_locator_from_metadata(metadata)?;
        let schema_hash = row_locator.origin_schema_hash?;
        let table = row_locator.table.to_string();
        let cache_key = (table.clone(), schema_hash);
        let table_context = if let Some(context) = self.replay_table_contexts.get(&cache_key) {
            context.clone()
        } else {
            let context =
                prepared_row_table_context_for_schema_hash(storage, &table, schema_hash).ok()?;
            self.replay_table_contexts
                .insert(cache_key, context.clone());
            context
        };
        let write_context =
            prepared_row_write_context_from_table_context(table_context, needs_exact_locator);
        Some((row_locator, write_context))
    }

    fn apply_row_updated<H: Storage>(
        &mut self,
        storage: &mut H,
        subject_client: PeerId,
        metadata: Option<RowMetadata>,
        mut row: StoredRowBatch,
        fate_recording: AuthoritativeFateRecording,
    ) -> Option<AppliedRowBatch> {
        let authoritative_tier = match (row.confirmed_tier, self.max_local_durability_tier()) {
            (Some(incoming), Some(local)) => Some(incoming.max(local)),
            (Some(incoming), None) => Some(incoming),
            (None, Some(local)) => Some(local),
            (None, None) => None,
        };
        row.confirmed_tier = None;
        let resolver = std::sync::Arc::clone(&self.resolver);

        let metadata = self.row_metadata_from_payload(storage, &row, metadata.as_ref())?;
        let (is_newly_located_object, needs_exact_locator) =
            self.ensure_object_metadata(storage, row.row_id, metadata.clone());
        let branch_name = BranchName::new(&row.branch);
        let visibility_change =
            match self.row_context_from_metadata(storage, &metadata, needs_exact_locator) {
                Some((row_locator, context)) => {
                    let table = row_locator.table.to_string();
                    let branch = row.branch.clone();

                    // Phase 2 — inbound apply gate. Verify a received batch BEFORE
                    // persisting it, so a forged/relabeled batch from a peer is rejected
                    // (not merely withheld outbound). The engine stays crypto-agnostic:
                    // it passes the sender, the op, the resource, the digest IT computed,
                    // and the opaque proof carried with the batch (`None` until later
                    // phases put the author signature + owner-binding on the wire). The
                    // default resolver Allows; production denies unless the proof verifies.
                    let res = crate::capability::ResourceCoord::new(
                        format!("{table}:{}", row.row_id),
                        table.clone(),
                        row.row_id,
                    );
                    let subject = crate::sync_targets::SyncTargetId::Client(subject_client);
                    let digest = row.content_digest();
                    // The owner-binding (and later the edit signature) ride in the row's
                    // metadata, base64-encoded; hand them to the resolver as opaque bytes.
                    let proof = row
                        .metadata
                        .get(crate::capability::OWNER_BINDING_META_KEY)
                        .map(|s| s.as_bytes());
                    match resolver.verify_on_apply(
                        &subject,
                        crate::capability::AccOp::Write,
                        &res,
                        &digest.0,
                        proof,
                    ) {
                        crate::capability::CapDecision::Allow => {}
                        other => {
                            tracing::warn!(
                                row_id = %row.row_id,
                                table = %table,
                                decision = ?other,
                                "apply gate: rejected inbound batch (verify_on_apply)"
                            );
                            return None;
                        }
                    }

                    match apply_row_batch_with_context(
                        storage,
                        ApplyRowBatchWithContext {
                            object_id: row.row_id,
                            branch_name: &branch_name,
                            row: row.clone(),
                            index_mutations: &[],
                            row_locator,
                            table,
                            branch,
                            context,
                            is_known_new_object: is_newly_located_object && row.parents.is_empty(),
                        },
                    ) {
                        Ok(applied) => applied.visibility_change,
                        Err(err) => {
                            tracing::warn!(
                                row_id = %row.row_id,
                                %branch_name,
                                ?err,
                                "failed to apply synced row batch"
                            );
                            return None;
                        }
                    }
                }
                None => {
                    match apply_row_batch(storage, row.row_id, &branch_name, row.clone(), &[]) {
                        Ok(applied) => applied.visibility_change,
                        Err(err) => {
                            tracing::warn!(
                                row_id = %row.row_id,
                                %branch_name,
                                ?err,
                                "failed to apply synced row batch"
                            );
                            return None;
                        }
                    }
                }
            };
        if fate_recording.should_record()
            && let Some(confirmed_tier) = authoritative_tier
            && row.state.is_visible()
        {
            let fate = match row.state {
                RowState::VisibleDirect => BatchFate::DurableDirect {
                    batch_id: row.batch_id,
                    confirmed_tier,
                },
                RowState::VisibleTransactional => BatchFate::AcceptedTransaction {
                    batch_id: row.batch_id,
                    confirmed_tier,
                },
                RowState::StagingPending | RowState::Superseded | RowState::Rejected => {
                    unreachable!("row.state.is_visible() guarded non-visible states")
                }
            };
            if matches!(
                self.persist_authoritative_batch_fate(storage, &fate),
                Ok(true)
            ) {
                self.pending_batch_fates.push(fate.clone());
            }
        }

        Some(AppliedRowBatch {
            row,
            visibility_change,
        })
    }

    pub(super) fn respond_to_batch_fate_request<H: Storage>(
        &mut self,
        storage: &H,
        destination: Destination,
        mut batch_ids: Vec<crate::row_histories::BatchId>,
    ) {
        batch_ids.sort();
        batch_ids.dedup();
        for batch_id in batch_ids {
            let fate = self
                .load_batch_fate_by_batch_id_from_storage(storage, batch_id)
                .unwrap_or(BatchFate::Missing { batch_id });
            match destination {
                Destination::Client(client_id) => {
                    self.queue_batch_fate_to_client_unfiltered(client_id, fate);
                }
            }
        }
    }

    pub(super) fn batch_fate_for_client(
        &self,
        client_id: PeerId,
        fate: &BatchFate,
    ) -> Option<BatchFate> {
        self.clients.get(&client_id)?;
        match fate {
            BatchFate::DurableDirect { batch_id, .. }
            | BatchFate::AcceptedTransaction { batch_id, .. }
            | BatchFate::Rejected { batch_id, .. } => {
                let row_interest = self.row_batch_interest.iter().any(|(key, clients)| {
                    key.batch_id == *batch_id && clients.contains(&client_id)
                });
                let fate_interest = self
                    .batch_fate_interest
                    .get(batch_id)
                    .is_some_and(|clients| clients.contains(&client_id));
                (row_interest || fate_interest).then(|| fate.clone())
            }
            BatchFate::Missing { .. } => Some(fate.clone()),
        }
    }

    pub(super) fn interested_clients_for_batch_fate(&self, fate: &BatchFate) -> HashSet<PeerId> {
        match fate {
            BatchFate::DurableDirect { batch_id, .. }
            | BatchFate::AcceptedTransaction { batch_id, .. }
            | BatchFate::Rejected { batch_id, .. } => {
                let mut interested = HashSet::new();
                for (key, clients) in &self.row_batch_interest {
                    if key.batch_id == *batch_id {
                        interested.extend(clients.iter().copied());
                    }
                }
                if let Some(clients) = self.batch_fate_interest.get(batch_id) {
                    interested.extend(clients.iter().copied());
                }
                interested
            }
            BatchFate::Missing { .. } => HashSet::new(),
        }
    }

    fn register_client_batch_fate_interest(
        &mut self,
        client_id: PeerId,
        batch_ids: &[crate::row_histories::BatchId],
    ) {
        for batch_id in batch_ids {
            self.batch_fate_interest
                .entry(*batch_id)
                .or_default()
                .insert(client_id);
        }
    }

    fn transactional_batch_rows<H: Storage>(
        &self,
        storage: &H,
        batch_id: crate::row_histories::BatchId,
        object_ids: &[ObjectId],
    ) -> Vec<(String, StoredRowBatch)> {
        let mut rows = Vec::new();
        for row_id in object_ids {
            let Ok(Some(row_locator)) = storage.load_row_locator(*row_id) else {
                continue;
            };
            let Ok(history_rows) =
                storage.scan_history_row_batches(row_locator.table.as_str(), *row_id)
            else {
                continue;
            };

            for row in history_rows {
                if row.batch_id == batch_id {
                    rows.push((row_locator.table.to_string(), row));
                }
            }
        }

        rows.sort_by(|(_, left), (_, right)| {
            left.row_id
                .uuid()
                .as_bytes()
                .cmp(right.row_id.uuid().as_bytes())
                .then_with(|| left.branch.as_str().cmp(right.branch.as_str()))
                .then_with(|| left.batch_id.0.cmp(&right.batch_id.0))
        });
        rows
    }

    fn apply_transactional_batch_fate_to_rows<H: Storage>(
        &mut self,
        storage: &mut H,
        origin_client_id: Option<PeerId>,
        fate: &BatchFate,
        batch_rows: &[(String, StoredRowBatch)],
    ) {
        match fate {
            BatchFate::DurableDirect { .. } => {
                for (_table, row) in batch_rows {
                    let row_id = row.row_id;
                    let branch_name = BranchName::new(&row.branch);
                    let mut direct_row = row.clone();
                    direct_row.state = RowState::VisibleDirect;
                    direct_row.confirmed_tier = None;
                    let applied =
                        apply_row_batch(storage, row_id, &branch_name, direct_row.clone(), &[])
                            .ok();

                    if let Some(applied) = applied
                        && let Some(update) = applied.visibility_change
                    {
                        self.pending_row_visibility_changes.push(update);
                        if let Some(client_id) = origin_client_id {
                            self.forward_update_to_clients_except_with_storage(
                                storage,
                                row_id,
                                branch_name,
                                client_id,
                            );
                        } else {
                            self.forward_update_to_clients_with_storage(
                                storage,
                                row_id,
                                branch_name,
                            );
                        }
                    }
                }
            }
            BatchFate::AcceptedTransaction { confirmed_tier, .. } => {
                for (_table, row) in batch_rows {
                    let row_id = row.row_id;
                    let branch_name = BranchName::new(&row.branch);
                    let accepted_row = row.accepted_transaction_output(*confirmed_tier);
                    let applied =
                        apply_row_batch(storage, row_id, &branch_name, accepted_row.clone(), &[])
                            .ok();

                    if let Some(applied) = applied
                        && let Some(update) = applied.visibility_change
                    {
                        self.pending_row_visibility_changes.push(update);
                        if let Some(client_id) = origin_client_id {
                            self.forward_update_to_clients_except_with_storage(
                                storage,
                                row_id,
                                branch_name,
                                client_id,
                            );
                        } else {
                            self.forward_update_to_clients_with_storage(
                                storage,
                                row_id,
                                branch_name,
                            );
                        }
                    }
                }
            }
            BatchFate::Rejected { .. } => {
                for (_, row) in batch_rows {
                    let row_id = row.row_id;
                    let branch_name = BranchName::new(&row.branch);
                    let row_batch_id = row.batch_id();

                    let visibility_change = patch_row_batch_state(
                        storage,
                        row_id,
                        &branch_name,
                        row_batch_id,
                        Some(RowState::Rejected),
                        None,
                    )
                    .ok()
                    .flatten();

                    if let Some(update) = visibility_change {
                        self.pending_row_visibility_changes.push(update);
                        if let Some(client_id) = origin_client_id {
                            self.forward_update_to_clients_except_with_storage(
                                storage,
                                row_id,
                                branch_name,
                                client_id,
                            );
                        } else {
                            self.forward_update_to_clients_with_storage(
                                storage,
                                row_id,
                                branch_name,
                            );
                        }
                    }
                }
            }
            BatchFate::Missing { .. } => return,
        }

        if matches!(fate, BatchFate::DurableDirect { .. }) {
            return;
        }

        if let Some(client_id) = origin_client_id {
            self.outbox.push(OutboxEntry {
                destination: Destination::Client(client_id),
                payload: SyncPayload::BatchFate { fate: fate.clone() },
            });
        }
    }

    fn reject_sealed_transactional_batch<H: Storage>(
        &mut self,
        storage: &mut H,
        origin_client_id: Option<PeerId>,
        fate: BatchFate,
        batch_rows: &[(String, StoredRowBatch)],
    ) {
        match self.persist_authoritative_batch_fate(storage, &fate) {
            Ok(true) => self.pending_batch_fates.push(fate.clone()),
            Ok(false) => {}
            Err(_) => return,
        }
        if let Err(error) = storage.delete_sealed_batch_submission(fate.batch_id()) {
            tracing::warn!(
                batch_id = ?fate.batch_id(),
                %error,
                "failed to delete rejected sealed batch submission"
            );
        }
        self.apply_transactional_batch_fate_to_rows(storage, origin_client_id, &fate, batch_rows);
    }

    fn declared_rows_for_submission(
        submission: &SealedBatchSubmission,
        batch_rows: &[(String, StoredRowBatch)],
    ) -> Option<Vec<(String, StoredRowBatch)>> {
        let mut declared_rows = Vec::with_capacity(submission.members.len());
        for member in &submission.members {
            let matching_row = batch_rows.iter().find(|(_, row)| {
                row.row_id == member.object_id
                    && row.branch.as_str() == submission.target_branch_name.as_str()
                    && row.content_digest() == member.row_digest
            })?;
            declared_rows.push(matching_row.clone());
        }
        Some(declared_rows)
    }

    fn settle_sealed_batch<H: Storage>(
        &mut self,
        storage: &mut H,
        origin_client_id: Option<PeerId>,
        submission: SealedBatchSubmission,
        batch_rows: Vec<(String, StoredRowBatch)>,
        declared_rows: Vec<(String, StoredRowBatch)>,
        mode: SealedBatchMode,
    ) {
        let batch_id = submission.batch_id;
        let fate = match storage.load_authoritative_batch_fate(batch_id) {
            Ok(Some(BatchFate::DurableDirect { confirmed_tier, .. }))
                if mode == SealedBatchMode::Direct =>
            {
                let confirmed_tier = self
                    .my_tiers
                    .iter()
                    .copied()
                    .max()
                    .map(|authority_tier| authority_tier.max(confirmed_tier))
                    .unwrap_or(confirmed_tier);
                let fate = BatchFate::DurableDirect {
                    batch_id,
                    confirmed_tier,
                };
                let changed = match self.persist_authoritative_batch_fate(storage, &fate) {
                    Ok(changed) => changed,
                    Err(_) => return,
                };
                if changed {
                    self.pending_batch_fates.push(fate.clone());
                }
                fate
            }
            Ok(Some(existing_fate)) => existing_fate,
            Ok(None) => {
                if batch_rows.is_empty() {
                    BatchFate::Missing { batch_id }
                } else {
                    let Some(confirmed_tier) = self.my_tiers.iter().copied().max() else {
                        return;
                    };
                    let fate = match mode {
                        SealedBatchMode::Direct => BatchFate::DurableDirect {
                            batch_id,
                            confirmed_tier,
                        },
                        SealedBatchMode::Transactional => BatchFate::AcceptedTransaction {
                            batch_id,
                            confirmed_tier,
                        },
                    };
                    let changed = match self.persist_authoritative_batch_fate(storage, &fate) {
                        Ok(changed) => changed,
                        Err(_) => return,
                    };
                    if changed {
                        self.pending_batch_fates.push(fate.clone());
                    }
                    fate
                }
            }
            Err(error) => {
                tracing::warn!(?batch_id, %error, "failed to load authoritative batch fate");
                return;
            }
        };

        if !matches!(fate, BatchFate::Missing { .. })
            && let Err(error) = storage.delete_sealed_batch_submission(batch_id)
        {
            tracing::warn!(?batch_id, %error, "failed to delete sealed batch submission");
        }
        let rows_to_patch: &[(String, StoredRowBatch)] = match fate {
            BatchFate::DurableDirect { .. } | BatchFate::AcceptedTransaction { .. } => {
                &declared_rows
            }
            BatchFate::Rejected { .. } => &batch_rows,
            BatchFate::Missing { .. } => &[],
        };
        self.apply_transactional_batch_fate_to_rows(
            storage,
            origin_client_id,
            &fate,
            rows_to_patch,
        );

        if matches!(fate, BatchFate::DurableDirect { .. }) {
            let mut interested_clients = self.interested_clients_for_batch_fate(&fate);
            if let Some(client_id) = origin_client_id {
                self.queue_batch_fate_to_client_unfiltered(client_id, fate.clone());
                interested_clients.remove(&client_id);
            }
            for client_id in interested_clients {
                self.queue_batch_fate_to_client(client_id, fate.clone());
            }
        }
    }

    pub(super) fn try_accept_completed_sealed_batch_from_client<H: Storage>(
        &mut self,
        storage: &mut H,
        client_id: PeerId,
        batch_id: crate::row_histories::BatchId,
    ) {
        let submission = match storage.load_sealed_batch_submission(batch_id) {
            Ok(Some(submission)) => submission,
            Ok(None) => return,
            Err(error) => {
                tracing::warn!(?batch_id, %error, "failed to load sealed batch submission");
                return;
            }
        };
        match storage.load_authoritative_batch_fate(batch_id) {
            Ok(Some(fate)) => {
                let highest_authority_tier = self.my_tiers.iter().copied().max();
                if matches!(
                    fate,
                    BatchFate::DurableDirect { confirmed_tier, .. }
                        if highest_authority_tier
                            .is_some_and(|authority_tier| confirmed_tier < authority_tier)
                ) {
                    // Continue into seal validation so this authority can promote a
                    // previously local direct fate to its own durability tier.
                } else {
                    let should_prune_submission = matches!(fate, BatchFate::Rejected { .. })
                        || fate
                            .confirmed_tier()
                            .is_some_and(|tier| tier >= DurabilityTier::GlobalServer);
                    let prune_result = if should_prune_submission {
                        storage.delete_sealed_batch_submission(batch_id)
                    } else {
                        Ok(())
                    };
                    if let Err(error) = prune_result {
                        tracing::warn!(
                            ?batch_id,
                            %error,
                            "failed to delete sealed batch submission"
                        );
                    }
                    self.queue_batch_fate_to_client_unfiltered(client_id, fate);
                    return;
                }
            }
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(?batch_id, %error, "failed to load authoritative batch fate");
                return;
            }
        }

        let batch_rows = self.transactional_batch_rows(
            storage,
            batch_id,
            &submission
                .members
                .iter()
                .map(|member| member.object_id)
                .collect::<Vec<_>>(),
        );
        if let Err(rejection) = self.validate_sealed_batch_submission(&submission) {
            self.reject_sealed_transactional_batch(
                storage,
                Some(client_id),
                rejection,
                &batch_rows,
            );
            return;
        }
        if let Err(rejection) = self.validate_batch_rows_target_branch(&submission, &batch_rows) {
            self.reject_sealed_transactional_batch(
                storage,
                Some(client_id),
                rejection,
                &batch_rows,
            );
            return;
        }
        let Some(declared_rows) = Self::declared_rows_for_submission(&submission, &batch_rows)
        else {
            return;
        };
        let mode = match self.infer_sealed_batch_mode(&submission, &batch_rows) {
            Ok(Some(mode)) => mode,
            Ok(None) => return,
            Err(rejection) => {
                self.reject_sealed_transactional_batch(
                    storage,
                    Some(client_id),
                    rejection,
                    &batch_rows,
                );
                return;
            }
        };
        if mode == SealedBatchMode::Transactional
            && let Err(rejection) =
                self.validate_transactional_parent_frontiers(storage, &submission, &declared_rows)
        {
            self.reject_sealed_transactional_batch(
                storage,
                Some(client_id),
                rejection,
                &batch_rows,
            );
            return;
        }

        self.settle_sealed_batch(
            storage,
            Some(client_id),
            submission,
            batch_rows,
            declared_rows,
            mode,
        );
    }

    pub(crate) fn recover_completed_sealed_batches_with_storage<H: Storage>(
        &mut self,
        storage: &mut H,
    ) -> bool {
        if self.my_tiers.is_empty() {
            return false;
        }

        let submissions = match storage.scan_sealed_batch_submissions() {
            Ok(submissions) => submissions,
            Err(error) => {
                tracing::warn!(%error, "failed to scan sealed batch submissions for recovery");
                return false;
            }
        };

        let mut recovered_any = false;
        for submission in submissions {
            let batch_rows = self.transactional_batch_rows(
                storage,
                submission.batch_id,
                &submission
                    .members
                    .iter()
                    .map(|member| member.object_id)
                    .collect::<Vec<_>>(),
            );
            if let Err(rejection) = self.validate_sealed_batch_submission(&submission) {
                self.reject_sealed_transactional_batch(storage, None, rejection, &batch_rows);
                recovered_any = true;
                continue;
            }
            if let Err(rejection) = self.validate_batch_rows_target_branch(&submission, &batch_rows)
            {
                self.reject_sealed_transactional_batch(storage, None, rejection, &batch_rows);
                recovered_any = true;
                continue;
            }
            let Some(declared_rows) = Self::declared_rows_for_submission(&submission, &batch_rows)
            else {
                continue;
            };
            let mode = match self.infer_sealed_batch_mode(&submission, &batch_rows) {
                Ok(Some(mode)) => mode,
                Ok(None) => continue,
                Err(rejection) => {
                    self.reject_sealed_transactional_batch(storage, None, rejection, &batch_rows);
                    recovered_any = true;
                    continue;
                }
            };
            if mode == SealedBatchMode::Transactional
                && let Err(rejection) = self.validate_transactional_parent_frontiers(
                    storage,
                    &submission,
                    &declared_rows,
                )
            {
                self.reject_sealed_transactional_batch(storage, None, rejection, &batch_rows);
                recovered_any = true;
                continue;
            }

            self.settle_sealed_batch(storage, None, submission, batch_rows, declared_rows, mode);
            recovered_any = true;
        }

        recovered_any
    }

    /// Process a single inbox entry.
    pub(super) fn process_inbox_entry<H: Storage>(&mut self, storage: &mut H, entry: InboxEntry) {
        tracing::trace!(source = ?entry.source, payload = entry.payload.variant_name(), "processing inbox entry");
        match entry.source {
            Source::Client(client_id) => {
                self.process_from_client(storage, client_id, entry.payload)
            }
        }
    }

    /// M5 abuse cap: true if `client_id` has exceeded its inbound batch budget for
    /// the current window (payload should be dropped). Fixed window — the count
    /// resets when the window rolls. Generous bound: only a pathological flood
    /// trips it, never legitimate catch-up.
    fn inbound_rate_exceeded(&mut self, client_id: PeerId) -> bool {
        let now_us = web_time::SystemTime::now()
            .duration_since(web_time::UNIX_EPOCH)
            .map(|d| d.as_micros() as u64)
            .unwrap_or(0);
        let rate = self.inbound_rate.entry(client_id).or_default();
        if now_us.saturating_sub(rate.window_start_us) > super::INBOUND_RATE_WINDOW_US {
            rate.window_start_us = now_us;
            rate.batches = 0;
        }
        rate.batches = rate.batches.saturating_add(1);
        rate.batches > super::INBOUND_MAX_BATCHES_PER_WINDOW
    }

    /// Process a payload from a client.
    pub(super) fn process_from_client<H: Storage>(
        &mut self,
        storage: &mut H,
        client_id: PeerId,
        payload: SyncPayload,
    ) {
        let _span = tracing::debug_span!("process_from_client", %client_id, payload = payload.variant_name()).entered();
        // M5: drop floods at the sync edge before any processing.
        if self.inbound_rate_exceeded(client_id) {
            tracing::warn!(%client_id, payload = payload.variant_name(), "M5: inbound rate limit exceeded — dropping payload");
            return;
        }
        let Some(client) = self.clients.get(&client_id) else {
            tracing::warn!(
                %client_id,
                "message from unknown client, ignoring (race with mesh reconcile?)"
            );
            return;
        };
        tracing::trace!(%client_id, payload = payload.variant_name(), "client→payload");

        match &payload {
            SyncPayload::CatalogueEntryUpdated { entry } => {
                let object_id = entry.object_id;
                let branch_name = BranchName::new("main");
                // Peers never author catalogue (schema) entries over the mesh.
                self.outbox.push(OutboxEntry {
                    destination: Destination::Client(client_id),
                    payload: SyncPayload::Error(SyncError::CatalogueWriteDenied {
                        object_id,
                        branch_name,
                    }),
                });
            }
            SyncPayload::RowBatchCreated { metadata: _, row }
            | SyncPayload::RowBatchNeeded { metadata: _, row } => {
                let object_id = row.row_id;
                let branch_name = BranchName::new(&row.branch);
                // All mesh clients are peers: apply row writes directly (caps gate
                // the wire, not ReBAC), but never accept catalogue writes from a peer.
                if payload.is_catalogue() {
                    self.outbox.push(OutboxEntry {
                        destination: Destination::Client(client_id),
                        payload: SyncPayload::Error(SyncError::CatalogueWriteDenied {
                            object_id,
                            branch_name,
                        }),
                    });
                    return;
                }
                self.apply_payload_from_client(
                    storage,
                    client_id,
                    payload,
                    AuthoritativeFateRecording::Skip,
                );
            }
            SyncPayload::SealBatch { .. } => {
                self.apply_payload_from_client(
                    storage,
                    client_id,
                    payload,
                    AuthoritativeFateRecording::Skip,
                );
            }
            // Frontier anti-entropy (§1.3): peer announced its heads → reply with
            // ours so it ships what we're owed. The diff is the only tracker.
            SyncPayload::FrontierAnnounce { resource, heads: _ } => {
                let my_heads = self.resource_frontier_heads(storage);
                self.outbox.push(OutboxEntry {
                    destination: Destination::Client(client_id),
                    payload: SyncPayload::FrontierNeed {
                        resource: resource.clone(),
                        heads: my_heads,
                    },
                });
            }
            // Peer wants what it's owed → ship frontier_diff(our DAG, their heads),
            // per-hop gated by may_sync. No per-peer ledger consulted.
            SyncPayload::FrontierNeed { resource: _, heads } => {
                self.ship_frontier_diff(storage, client_id, heads);
            }
            // Handle query subscription with full Query struct
            // Queue for QueryManager to process (SyncManager doesn't know about QueryGraph)
            SyncPayload::QuerySubscription {
                query_id,
                query,
                session,
                required_tier,
                propagation,
                policy_context_tables,
            } => {
                // Build effective session: identity (user_id) comes from the
                // server-established session (set during the SSE auth handshake) and
                // cannot be overridden by the payload. However, ephemeral per-subscription
                // claims supplied in the payload — such as a join_code for invite flows —
                // are merged in when the user_id matches, so that policy conditions like
                // `claims.join_code` evaluate correctly for this subscription.
                let effective_session = match (&client.session, session) {
                    (Some(client_session), Some(payload_session)) => {
                        if client_session.user_id != payload_session.user_id {
                            tracing::warn!(
                                %client_id,
                                "QuerySubscription payload session user_id does not match client session; ignoring payload session"
                            );
                            Some(client_session.clone())
                        } else {
                            // Same user: merge claims. Payload provides ephemeral claims
                            // (e.g. join_code); client session claims take precedence so
                            // auth-established values cannot be spoofed.
                            let merged_claims = if let (
                                serde_json::Value::Object(client_map),
                                serde_json::Value::Object(payload_map),
                            ) =
                                (&client_session.claims, &payload_session.claims)
                            {
                                let mut merged = payload_map.clone();
                                merged.extend(client_map.clone());
                                serde_json::Value::Object(merged)
                            } else {
                                client_session.claims.clone()
                            };
                            Some(Session {
                                user_id: client_session.user_id.clone(),
                                claims: merged_claims,
                                auth_mode: client_session.auth_mode,
                            })
                        }
                    }
                    (Some(client_session), None) => Some(client_session.clone()),
                    (None, payload_session) => payload_session.clone(),
                };
                // Track origin for QuerySettled relay
                self.query_origin
                    .entry(*query_id)
                    .or_default()
                    .insert(client_id);
                tracing::trace!(
                    %client_id,
                    query_id = query_id.0,
                    table = %query.table,
                    ?propagation,
                    "jazz trace received query subscription from client"
                );
                self.pending_query_subscriptions
                    .push(PendingQuerySubscription {
                        client_id,
                        query_id: *query_id,
                        query: query.as_ref().clone(),
                        session: effective_session,
                        required_tier: *required_tier,
                        propagation: *propagation,
                        policy_context_tables: policy_context_tables.clone(),
                    });
            }
            // Handle query unsubscription
            // Queue for QueryManager to process (remove server-side QueryGraph, forward upstream)
            SyncPayload::QueryUnsubscription { query_id } => {
                tracing::trace!(
                    %client_id,
                    query_id = query_id.0,
                    "jazz trace received query unsubscription from client"
                );
                // Clean up query origin
                if let Some(clients) = self.query_origin.get_mut(query_id) {
                    clients.remove(&client_id);
                    if clients.is_empty() {
                        self.query_origin.remove(query_id);
                    }
                }
                self.pending_query_unsubscriptions
                    .push(PendingQueryUnsubscription {
                        client_id,
                        query_id: *query_id,
                    });
            }
            SyncPayload::BatchFate { fate } => {
                if self.retain_client_batch_fate(fate) {
                    self.pending_batch_fates.push(fate.clone());
                }
            }
            SyncPayload::BatchFateNeeded { batch_ids } => {
                self.register_client_batch_fate_interest(client_id, batch_ids);
                self.respond_to_batch_fate_request(
                    storage,
                    Destination::Client(client_id),
                    batch_ids.clone(),
                );
            }
            SyncPayload::QuerySettled {
                query_id,
                tier,
                scope: _,
                through_seq,
            } => {
                // Client relaying a QuerySettled from downstream
                self.pending_query_settled.push(PendingQuerySettled {
                    query_id: *query_id,
                    tier: *tier,
                    through_seq: *through_seq,
                });
            }
            SyncPayload::SchemaWarning(warning) => {
                tracing::warn!(
                    %client_id,
                    query_id = warning.query_id.0,
                    "client attempted to send SchemaWarning payload; ignoring"
                );
            }
            SyncPayload::ConnectionSchemaDiagnostics(_) => {
                tracing::warn!(
                    %client_id,
                    "client attempted to send ConnectionSchemaDiagnostics payload; ignoring"
                );
            }
            // Clients shouldn't send these
            SyncPayload::Error(_) => {}
        }
    }

    /// Apply a payload from a client (either directly or after approval).
    pub(super) fn apply_payload_from_client<H: Storage>(
        &mut self,
        storage: &mut H,
        client_id: PeerId,
        payload: SyncPayload,
        fate_recording: AuthoritativeFateRecording,
    ) {
        match payload {
            SyncPayload::CatalogueEntryUpdated { entry } => {
                if self.persist_catalogue_entry(storage, entry.clone()) {
                    self.pending_catalogue_updates.push(entry.clone());
                    self.forward_catalogue_entry_to_clients(entry, Some(client_id));
                }
            }
            SyncPayload::RowBatchCreated { metadata, row }
            | SyncPayload::RowBatchNeeded { metadata, row } => {
                let object_id = row.row_id;
                let branch_name = BranchName::new(&row.branch);
                let batch_id = row.batch_id;
                self.row_batch_interest
                    .entry(RowBatchKey::new(object_id, branch_name, batch_id))
                    .or_default()
                    .insert(client_id);

                if let Some(applied) =
                    self.apply_row_updated(storage, client_id, metadata, row.clone(), fate_recording)
                {
                    if !matches!(
                        applied.row.state,
                        RowState::StagingPending | RowState::Superseded
                    ) && let Some(update) = applied.visibility_change
                    {
                        self.pending_row_visibility_changes.push(update);
                        self.forward_update_to_clients_except_with_storage(
                            storage,
                            object_id,
                            branch_name,
                            client_id,
                        );
                    }
                }
                self.try_accept_completed_sealed_batch_from_client(storage, client_id, batch_id);
            }
            SyncPayload::SealBatch { submission } => {
                if submission.members.is_empty() {
                    tracing::warn!(batch_id = ?submission.batch_id, "ignoring SealBatch with no declared members");
                    return;
                }
                match storage.load_authoritative_batch_fate(submission.batch_id) {
                    Ok(Some(fate @ BatchFate::Rejected { .. }))
                    | Ok(Some(fate @ BatchFate::AcceptedTransaction { .. }))
                    | Ok(Some(fate @ BatchFate::Missing { .. })) => {
                        self.queue_batch_fate_to_client(client_id, fate);
                        return;
                    }
                    Ok(Some(BatchFate::DurableDirect { .. })) => {}
                    Ok(None) => {}
                    Err(error) => {
                        tracing::warn!(
                            batch_id = ?submission.batch_id,
                            %error,
                            "failed to load authoritative batch fate"
                        );
                        return;
                    }
                }
                if let Err(rejection) = self.validate_sealed_batch_submission(&submission) {
                    let batch_rows = self.transactional_batch_rows(
                        storage,
                        submission.batch_id,
                        &submission
                            .members
                            .iter()
                            .map(|member| member.object_id)
                            .collect::<Vec<_>>(),
                    );
                    self.reject_sealed_transactional_batch(
                        storage,
                        Some(client_id),
                        rejection,
                        &batch_rows,
                    );
                    return;
                }
                if let Err(error) = self.persist_sealed_batch_submission(storage, &submission) {
                    tracing::warn!(
                        batch_id = ?submission.batch_id,
                        %error,
                        "failed to persist sealed batch submission"
                    );
                    return;
                }
                self.try_accept_completed_sealed_batch_from_client(
                    storage,
                    client_id,
                    submission.batch_id,
                );
            }
            SyncPayload::BatchFate { fate } => {
                if self.retain_client_batch_fate(&fate) {
                    self.pending_batch_fates.push(fate.clone());
                }
            }
            SyncPayload::BatchFateNeeded { batch_ids } => {
                self.register_client_batch_fate_interest(client_id, &batch_ids);
                self.respond_to_batch_fate_request(
                    storage,
                    Destination::Client(client_id),
                    batch_ids,
                );
            }
            _ => {}
        }
    }
}

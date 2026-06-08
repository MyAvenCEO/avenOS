use super::*;
use crate::batch_fate::LocalBatchMember;
use crate::row_histories::{RowState, patch_row_batch_state};

impl<S: Storage, Sch: Scheduler> RuntimeCore<S, Sch> {
    fn local_batch_row_was_insert(
        &self,
        table: &str,
        row: &crate::row_histories::StoredRowBatch,
    ) -> bool {
        if !row.parents.is_empty() {
            return false;
        }

        let Ok(history_rows) = self.storage.scan_history_row_batches(table, row.row_id) else {
            return true;
        };
        !history_rows.iter().any(|candidate| {
            candidate.branch == row.branch
                && candidate.batch_id != row.batch_id
                && !matches!(candidate.state, RowState::Rejected)
        })
    }

    pub(crate) fn local_batch_rows(
        &self,
        batch_id: crate::row_histories::BatchId,
    ) -> Vec<(
        LocalBatchMember,
        crate::storage::RowLocator,
        crate::row_histories::StoredRowBatch,
    )> {
        let mut rows = Vec::new();
        if let Ok(Some(submission)) = self.storage.load_sealed_batch_submission(batch_id) {
            for sealed_member in submission.members {
                let Ok(Some(row_locator)) = self.storage.load_row_locator(sealed_member.object_id)
                else {
                    continue;
                };
                let Some(row) = self
                    .storage
                    .scan_history_row_batches(row_locator.table.as_str(), sealed_member.object_id)
                    .ok()
                    .and_then(|rows| {
                        rows.into_iter().find(|row| {
                            row.batch_id == batch_id
                                && row.branch.as_str() == submission.target_branch_name.as_str()
                                && row.content_digest() == sealed_member.row_digest
                        })
                    })
                else {
                    continue;
                };
                let Ok(schema_hash) = self.local_batch_member_schema_hash(
                    submission.target_branch_name,
                    sealed_member.object_id,
                    batch_id,
                ) else {
                    continue;
                };
                let member = LocalBatchMember {
                    object_id: sealed_member.object_id,
                    table_name: row_locator.table.to_string(),
                    branch_name: submission.target_branch_name,
                    schema_hash,
                    row_digest: sealed_member.row_digest,
                };
                rows.push((member, row_locator, row));
            }
        }

        if rows.is_empty()
            && let Some(record) = self.local_batch_record_cache.get(&batch_id)
        {
            for member in record.members.clone() {
                let row_locator = self
                    .storage
                    .load_row_locator(member.object_id)
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| crate::storage::RowLocator {
                        table: member.table_name.clone().into(),
                        origin_schema_hash: None,
                    });
                let Ok(Some(row)) = self.storage.load_history_row_batch_for_schema_hash(
                    member.table_name.as_str(),
                    member.schema_hash,
                    member.branch_name.as_str(),
                    member.object_id,
                    batch_id,
                ) else {
                    let Some(row) = self
                        .storage
                        .scan_history_row_batches(member.table_name.as_str(), member.object_id)
                        .ok()
                        .and_then(|rows| {
                            rows.into_iter().find(|row| {
                                row.batch_id == batch_id
                                    && row.branch.as_str() == member.branch_name.as_str()
                            })
                        })
                    else {
                        continue;
                    };
                    rows.push((member, row_locator, row));
                    continue;
                };
                rows.push((member, row_locator, row));
            }
        }
        if rows.is_empty()
            && let Ok(Some(record)) = self.storage.load_local_batch_record(batch_id)
        {
            for member in record.members {
                let row_locator = self
                    .storage
                    .load_row_locator(member.object_id)
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| crate::storage::RowLocator {
                        table: member.table_name.clone().into(),
                        origin_schema_hash: None,
                    });
                let Ok(Some(row)) = self.storage.load_history_row_batch_for_schema_hash(
                    member.table_name.as_str(),
                    member.schema_hash,
                    member.branch_name.as_str(),
                    member.object_id,
                    batch_id,
                ) else {
                    continue;
                };
                rows.push((member, row_locator, row));
            }
        }
        if rows.is_empty()
            && let Ok(row_locators) = self.storage.scan_row_locators()
        {
            for (object_id, row_locator) in row_locators {
                let Ok(history_rows) = self
                    .storage
                    .scan_history_row_batches(row_locator.table.as_str(), object_id)
                else {
                    continue;
                };
                for row in history_rows
                    .into_iter()
                    .filter(|row| row.batch_id == batch_id)
                {
                    let branch_name = BranchName::new(row.branch.as_str());
                    let Ok(schema_hash) =
                        self.local_batch_member_schema_hash(branch_name, object_id, batch_id)
                    else {
                        continue;
                    };
                    let member = LocalBatchMember {
                        object_id,
                        table_name: row_locator.table.to_string(),
                        branch_name,
                        schema_hash,
                        row_digest: row.content_digest(),
                    };
                    rows.push((member, row_locator.clone(), row));
                }
            }
        }

        rows.sort_by(
            |(left_member, left_locator, left_row), (right_member, right_locator, right_row)| {
                left_member
                    .object_id
                    .uuid()
                    .as_bytes()
                    .cmp(right_member.object_id.uuid().as_bytes())
                    .then_with(|| {
                        left_locator
                            .table
                            .as_str()
                            .cmp(right_locator.table.as_str())
                    })
                    .then_with(|| left_row.branch.as_str().cmp(right_row.branch.as_str()))
                    .then_with(|| {
                        left_member
                            .schema_hash
                            .as_bytes()
                            .cmp(right_member.schema_hash.as_bytes())
                    })
                    .then_with(|| left_row.batch_id.0.cmp(&right_row.batch_id.0))
            },
        );
        rows
    }

    fn apply_received_batch_fate(&mut self, fate: crate::batch_fate::BatchFate) {
        let batch_id = fate.batch_id();
        if let Err(error) = self.storage.upsert_authoritative_batch_fate(&fate) {
            tracing::warn!(
                ?batch_id,
                %error,
                "failed to persist batch fate"
            );
        }

        if let crate::batch_fate::BatchFate::Rejected { code, reason, .. } = &fate {
            self.mark_local_batch_rows_rejected(batch_id);
            let acknowledged = self
                .is_rejected_batch_acknowledged(batch_id)
                .unwrap_or(false);
            if !acknowledged {
                let handled_by_waiter = self.durability.record_rejection(batch_id, code, reason);
                if !handled_by_waiter {
                    let batch = self
                        .local_batch_record(batch_id)
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| {
                            crate::batch_fate::LocalBatchRecord::new(
                                batch_id,
                                crate::batch_fate::BatchMode::Direct,
                                true,
                                Some(fate.clone()),
                            )
                        });
                    self.queue_mutation_error_event(crate::runtime_core::MutationErrorEvent {
                        code: code.clone(),
                        reason: reason.clone(),
                        batch,
                    });
                }
            }
        } else if matches!(
            fate,
            crate::batch_fate::BatchFate::AcceptedTransaction { .. }
        ) {
            self.schema_manager
                .query_manager_mut()
                .mark_subscriptions_visibility_recompute_for_batch(batch_id);
        }

        if let Some(acked_tier) = fate.confirmed_tier() {
            self.schema_manager
                .query_manager_mut()
                .mark_subscriptions_visibility_recompute_for_tier(acked_tier);
            for (member, row_locator, _) in self.local_batch_rows(batch_id) {
                self.schema_manager
                    .query_manager_mut()
                    .mark_local_row_updated_in_subscriptions(
                        row_locator.table.as_str(),
                        member.object_id,
                    );
            }
            self.durability.record_batch_ack(batch_id, acked_tier);
        }
    }

    pub(crate) fn mark_local_batch_rows_rejected(
        &mut self,
        batch_id: crate::row_histories::BatchId,
    ) {
        let mut cleared_rows = Vec::new();
        let mut batch_patch_succeeded_by_table = std::collections::HashMap::new();

        for (member, row_locator, row) in self.local_batch_rows(batch_id) {
            let was_visible = matches!(row.state, RowState::VisibleDirect)
                || (matches!(row.state, RowState::Rejected)
                    && self
                        .storage
                        .load_visible_region_row(
                            row_locator.table.as_str(),
                            row.branch.as_str(),
                            member.object_id,
                        )
                        .ok()
                        .flatten()
                        .is_some_and(|visible_row| visible_row.batch_id() == row.batch_id()));

            if !was_visible && !matches!(row.state, RowState::StagingPending | RowState::Superseded)
            {
                continue;
            }

            cleared_rows.push((
                row_locator.table.to_string(),
                member.schema_hash,
                row.branch.to_string(),
                member.object_id,
                row.batch_id(),
                row.data.to_vec(),
                was_visible,
                row.delete_kind.is_some(),
                self.local_batch_row_was_insert(row_locator.table.as_str(), &row),
            ));
        }

        for (table, _, _, _, _, _, was_visible, _, _) in &cleared_rows {
            if *was_visible {
                continue;
            }
            batch_patch_succeeded_by_table
                .entry(table.clone())
                .or_insert_with(|| {
                    self.storage
                        .patch_row_region_rows_by_batch(
                            table,
                            batch_id,
                            Some(RowState::Rejected),
                            None,
                        )
                        .is_ok()
                });
        }

        let query_manager = self.schema_manager.query_manager_mut();
        for (
            table,
            schema_hash,
            branch,
            row_id,
            member_batch_id,
            row_data,
            was_visible,
            was_delete,
            was_insert,
        ) in cleared_rows
        {
            if was_visible {
                let branch_name = crate::object::BranchName::new(&branch);
                let _ = self.storage.patch_row_region_rows_by_batch(
                    &table,
                    member_batch_id,
                    Some(RowState::Rejected),
                    None,
                );
                let _ = patch_row_batch_state(
                    &mut self.storage,
                    row_id,
                    &branch_name,
                    member_batch_id,
                    Some(RowState::Rejected),
                    None,
                );
                let _ = self.storage.patch_exact_row_batch_for_schema_hash(
                    &table,
                    schema_hash,
                    &branch,
                    row_id,
                    member_batch_id,
                    Some(RowState::Rejected),
                    None,
                );
            } else if !batch_patch_succeeded_by_table
                .get(&table)
                .copied()
                .unwrap_or(false)
            {
                let _ = self.storage.patch_exact_row_batch_for_schema_hash(
                    &table,
                    schema_hash,
                    &branch,
                    row_id,
                    member_batch_id,
                    Some(RowState::Rejected),
                    None,
                );
            }
            if was_visible {
                if was_delete {
                    query_manager.restore_local_rejected_delete_row(
                        &mut self.storage,
                        &table,
                        &branch,
                        row_id,
                        &row_data,
                    );
                } else if !was_insert {
                    query_manager.clear_local_pending_row_overlay(&table, row_id);
                } else {
                    let _ = self
                        .storage
                        .delete_visible_region_row(&table, &branch, row_id);
                    query_manager.retract_local_rejected_row(
                        &mut self.storage,
                        &table,
                        &branch,
                        row_id,
                        &row_data,
                        true,
                    );
                }
            } else {
                query_manager.clear_local_pending_row_overlay(&table, row_id);
            }
        }
    }

    // =========================================================================
    // Tick Methods
    // =========================================================================

    /// Synchronous tick - processes managers, fulfills completed queries.
    ///
    /// Schedules batched_tick if there are outbound messages or storage writes
    /// waiting on the WAL flush barrier.
    ///
    /// Call this after any mutation operation (insert, update, delete, etc.)
    /// to process the change and schedule any required I/O.
    pub fn immediate_tick(&mut self) -> TickOutput {
        let _span = trace_span!("immediate_tick", tier = self.tier_label).entered();

        let recovered_sealed_batches = self
            .schema_manager
            .query_manager_mut()
            .sync_manager_mut()
            .recover_completed_sealed_batches_with_storage(&mut self.storage);
        if recovered_sealed_batches {
            self.mark_storage_write_pending_flush();
        }

        // 1. Process logical updates (sync, subscriptions)
        self.schema_manager.process(&mut self.storage);

        // 2. Second process() handles deferred query subscriptions that couldn't
        //    compile on first pass (schema wasn't available yet, e.g. catalogue
        //    was just processed and made the schema available).
        self.schema_manager.process(&mut self.storage);

        // 2c. Apply replayable batch fates before collecting subscription
        // updates so fate-driven visibility changes land in the same tick.
        let received_batch_fates = self
            .schema_manager
            .query_manager_mut()
            .sync_manager_mut()
            .take_pending_batch_fates();
        if !received_batch_fates.is_empty() {
            for fate in received_batch_fates {
                self.apply_received_batch_fate(fate);
            }
            self.schema_manager.process(&mut self.storage);
        }

        // 3. Collect subscription updates
        let subscription_updates = self.schema_manager.query_manager_mut().take_updates();
        let subscription_failures = self
            .schema_manager
            .query_manager_mut()
            .take_failed_subscriptions();

        // Track one-shot queries that completed this tick
        let mut completed_one_shots: Vec<SubscriptionHandle> = Vec::new();
        let mut failed_one_shots: Vec<SubscriptionHandle> = Vec::new();
        let mut callbacks_fired: u64 = 0;

        // 3. Call subscription callbacks AND handle one-shot queries
        for update in &subscription_updates {
            if let Some(&handle) = self.subscription_reverse.get(&update.subscription_id) {
                // Check if this is a one-shot query
                if let Some(pending) = self.pending_one_shot_queries.get_mut(&handle) {
                    // First callback = graph settled, fulfill the future
                    if let Some(sender) = pending.sender.take() {
                        // Decode rows using the query's output descriptor
                        let results: Vec<(ObjectId, Vec<Value>)> = update
                            .ordered_delta
                            .added
                            .iter()
                            .filter_map(|row| {
                                decode_row(&update.descriptor, &row.row.data)
                                    .ok()
                                    .map(|values| (row.row.id, values))
                            })
                            .collect();
                        let _ = sender.send(Ok(results));
                    }
                    // Mark for cleanup (unsubscribe happens after loop)
                    completed_one_shots.push(handle);
                } else if let Some(state) = self.subscriptions.get(&handle) {
                    // Regular subscription - call callback
                    let delta = SubscriptionDelta {
                        handle,
                        ordered_delta: update.ordered_delta.clone(),
                        descriptor: update.descriptor.clone(),
                    };
                    (state.callback)(delta);
                    callbacks_fired += 1;
                }
            }
        }
        tracing::debug!(callbacks_fired, "subscription callbacks fired this tick");

        for failure in &subscription_failures {
            if let Some(&handle) = self.subscription_reverse.get(&failure.subscription_id) {
                if let Some(pending) = self.pending_one_shot_queries.get_mut(&handle) {
                    if let Some(sender) = pending.sender.take() {
                        let _ = sender.send(Err(RuntimeError::QueryError(format!(
                            "query subscription {} failed during schema recompile: {}",
                            failure.subscription_id.0, failure.reason
                        ))));
                    }
                    failed_one_shots.push(handle);
                } else if self.subscriptions.remove(&handle).is_some() {
                    self.subscription_reverse.remove(&failure.subscription_id);
                    tracing::error!(
                        handle = handle.0,
                        sub_id = failure.subscription_id.0,
                        error = %failure.reason,
                        "subscription failed during schema recompile and was dropped"
                    );
                }
            } else {
                tracing::error!(
                    sub_id = failure.subscription_id.0,
                    error = %failure.reason,
                    "subscription failed during schema recompile and was dropped"
                );
            }
        }

        // 2b. Cleanup completed one-shot queries
        for handle in completed_one_shots {
            if let Some(pending) = self.pending_one_shot_queries.remove(&handle) {
                // Unsubscribe from the underlying subscription
                self.schema_manager
                    .query_manager_mut()
                    .unsubscribe_with_sync(pending.subscription_id);
                self.subscription_reverse.remove(&pending.subscription_id);
            }
        }

        // 2c. Cleanup failed one-shot queries.
        // The underlying subscriptions were already removed by QueryManager.
        for handle in failed_one_shots {
            if let Some(pending) = self.pending_one_shot_queries.remove(&handle) {
                self.subscription_reverse.remove(&pending.subscription_id);
            }
        }

        // 4. Schedule batched_tick if outbound messages exist or a WAL flush
        // barrier is pending.
        if self.has_outbound() || self.storage_write_pending_flush {
            self.scheduler.schedule_batched_tick();
        }

        TickOutput {
            subscription_updates,
        }
    }

    /// Batched tick - handles all I/O, then processes parked messages.
    ///
    /// Called by the platform when the scheduled tick fires. This:
    /// 1. Sends all outgoing sync messages via SyncSender
    /// 2. Processes parked sync messages
    ///
    /// Each step is followed by an immediate_tick to process results.
    pub fn batched_tick(&mut self) {
        let _span = debug_span!("batched_tick", tier = self.tier_label).entered();

        // 1. Send all outgoing sync messages
        self.flush_runtime_outbox("flushing outbox");

        // 2. Process parked sync messages
        self.handle_sync_messages();

        // 3. Flush any new outbox entries generated by processing.
        // The scheduler's debounce prevents immediate_tick() from scheduling
        // another batched_tick while we're inside one, so we must flush here.
        self.flush_runtime_outbox("flushing post-process outbox");

        // Flush the storage durability barrier so writes survive a hard kill (tab close, crash).
        if self.storage_write_pending_flush {
            let _span = tracing::debug_span!("flush_wal").entered();
            if let Err(error) = self.flush_wal_barrier() {
                tracing::error!(%error, "storage WAL flush failed");
                if self.should_schedule_storage_flush_retry() {
                    self.scheduler.schedule_batched_tick();
                }
            }
        }
    }

    fn flush_runtime_outbox(&mut self, log_message: &str) {
        let outbox = self
            .schema_manager
            .query_manager_mut()
            .sync_manager_mut()
            .take_outbox();
        if !outbox.is_empty() {
            debug!(count = outbox.len(), "{log_message}");
        }

        let mut unsent = Vec::new();
        for msg in outbox {
            let peer_kind = msg.destination.peer_kind();
            let peer_id = msg.destination.peer_label();
            let payload = msg.payload.variant_name();
            let _send_span = debug_span!(
                "sync.send",
                peer_kind = peer_kind,
                peer_id = %peer_id,
                payload = payload,
                payload_json = %serde_json::to_string(&msg.payload).unwrap_or_default(),
                tier = self.tier_label,
            )
            .entered();

            if let Some((ref tracer, ref name)) = self.sync_tracer {
                tracer.record_outgoing(name, &msg.destination, &msg.payload);
            }

            if let Some(sync_sender) = self.sync_sender.as_ref() {
                sync_sender.send_sync_message(msg);
            } else {
                unsent.push(msg);
            }
        }

        if !unsent.is_empty() {
            self.schema_manager
                .query_manager_mut()
                .sync_manager_mut()
                .prepend_outbox(unsent);
        }
    }

    /// Apply parked sync messages and tick.
    fn handle_sync_messages(&mut self) {
        let messages = std::mem::take(&mut self.parked_sync_messages);
        let mut applied_messages = 0usize;

        if !messages.is_empty() {
            debug!(
                count = messages.len(),
                "processing parked unsequenced sync messages"
            );
        }
        for msg in messages {
            if msg.payload.writes_storage() {
                self.mark_storage_write_pending_flush();
            }
            self.push_sync_inbox(msg);
            applied_messages += 1;
        }

        if applied_messages > 0 {
            debug!(count = applied_messages, "applied parked sync messages");
            self.immediate_tick();
        }
    }

    /// Check if there are outbound messages requiring a batched_tick.
    pub fn has_outbound(&self) -> bool {
        !self
            .schema_manager
            .query_manager()
            .sync_manager()
            .outbox()
            .is_empty()
    }

    /// Park a sync message for processing in next batched_tick.
    pub fn park_sync_message(&mut self, message: InboxEntry) {
        let _recv_span = debug_span!(
            "sync.recv",
            peer_kind = message.source.peer_kind(),
            peer_id = %message.source.peer_label(),
            payload = message.payload.variant_name(),
            payload_json = %serde_json::to_string(&message.payload).unwrap_or_default(),
            tier = self.tier_label,
        )
        .entered();
        if let Some((ref tracer, ref name)) = self.sync_tracer {
            tracer.record_incoming(&message.source, name, &message.payload);
        }
        self.parked_sync_messages.push(message);
        self.scheduler.schedule_batched_tick();
    }
}

use super::*;

fn storage_with_unacknowledged_rejected_local_batch(batch_id: BatchId) -> MemoryStorage {
    let mut storage = MemoryStorage::new();
    let fate = crate::batch_fate::BatchFate::Rejected {
        batch_id,
        code: "permission_denied".to_string(),
        reason: "writer lacks publish rights".to_string(),
    };
    storage
        .upsert_local_batch_record(&crate::batch_fate::LocalBatchRecord::new(
            batch_id,
            crate::batch_fate::BatchMode::Direct,
            true,
            Some(fate),
        ))
        .unwrap();
    storage
}

#[test]
fn rc_direct_insert_persisted_reconnect_reconciles_rejected_batch_from_server() {
    let mut core = create_runtime_with_boxed_storage(
        test_schema(),
        "direct-reject-replay-test",
        Box::new(RowRegionReadFailingStorage::with_row_locator_scan_failure()),
    );

    let ((row_id, _row_values), mut receiver) = insert_and_wait_for_batch(
        &mut core,
        "users",
        user_insert_values(ObjectId::new(), "Alice"),
        None,
        DurabilityTier::EdgeServer,
    )
    .unwrap();

    let branch_name = core.schema_manager().branch_name();
    let batch_id = core
        .storage()
        .load_visible_region_row("users", branch_name.as_str(), row_id)
        .unwrap()
        .expect("persisted direct insert should materialize a visible row")
        .batch_id;

    core.replay_batch_rejection(batch_id, "permission_denied", "writer lacks publish rights")
        .unwrap();

    assert_eq!(
        receiver.try_recv(),
        Ok(Some(Err(crate::runtime_core::PersistedWriteRejection {
            batch_id,
            code: "permission_denied".to_string(),
            reason: "writer lacks publish rights".to_string(),
        }))),
        "replayed direct-batch rejections should resolve persisted waits"
    );
    assert!(
        core.drain_mutation_error_events().is_empty(),
        "handled direct-batch rejections should not surface onMutationError events"
    );
    assert_eq!(
        core.storage()
            .load_authoritative_batch_fate(batch_id)
            .unwrap(),
        Some(crate::batch_fate::BatchFate::Rejected {
            batch_id,
            code: "permission_denied".to_string(),
            reason: "writer lacks publish rights".to_string(),
        })
    );
    assert_eq!(
        core.storage()
            .load_visible_region_row("users", branch_name.as_str(), row_id)
            .unwrap(),
        None,
        "replayed direct-batch rejection should retract the optimistic visible row"
    );
    assert_eq!(
        core.storage()
            .scan_history_row_batches("users", row_id)
            .unwrap()[0]
            .state,
        crate::row_histories::RowState::Rejected
    );
}

#[test]
fn rc_restart_recovers_pending_mutation_error_events_only_for_client_tiers() {
    let no_tier_batch_id = BatchId::new();
    let mut no_tier_runtime = create_runtime_with_storage_and_sync_manager(
        test_schema(),
        "client-recover-rejected-batch-without-tier",
        storage_with_unacknowledged_rejected_local_batch(no_tier_batch_id),
        SyncManager::new(),
    );
    let no_tier_events = no_tier_runtime.drain_mutation_error_events();
    assert_eq!(no_tier_events.len(), 1);
    assert_eq!(no_tier_events[0].batch.batch_id, no_tier_batch_id);

    let local_batch_id = BatchId::new();
    let mut local_runtime = create_runtime_with_storage_and_sync_manager(
        test_schema(),
        "client-recover-rejected-batch-local-tier",
        storage_with_unacknowledged_rejected_local_batch(local_batch_id),
        SyncManager::new().with_durability_tier(DurabilityTier::Local),
    );
    let local_events = local_runtime.drain_mutation_error_events();
    assert_eq!(local_events.len(), 1);
    assert_eq!(local_events[0].batch.batch_id, local_batch_id);

    let edge_batch_id = BatchId::new();
    let mut edge_runtime = create_runtime_with_storage_and_sync_manager(
        test_schema(),
        "server-does-not-recover-rejected-batch-notification",
        storage_with_unacknowledged_rejected_local_batch(edge_batch_id),
        SyncManager::new().with_durability_tier(DurabilityTier::EdgeServer),
    );
    assert!(
        edge_runtime.drain_mutation_error_events().is_empty(),
        "edge server runtimes should not recover client mutation-error notifications"
    );
    assert!(matches!(
        edge_runtime
            .storage()
            .load_authoritative_batch_fate(edge_batch_id)
            .unwrap(),
        Some(crate::batch_fate::BatchFate::Rejected { .. })
    ));
}

#[test]
fn rc_rejected_replay_record_can_be_synthesized_from_sealed_submission() {
    let mut core = create_runtime_with_schema(
        test_schema(),
        "direct-reject-replay-record-test",
    );

    let ((row_id, _row_values), _receiver) = insert_and_wait_for_batch(
        &mut core,
        "users",
        user_insert_values(ObjectId::new(), "Alice"),
        None,
        DurabilityTier::Local,
    )
    .unwrap();
    let branch_name = core.schema_manager().branch_name();
    let batch_id = core
        .storage()
        .load_visible_region_row("users", branch_name.as_str(), row_id)
        .unwrap()
        .expect("persisted direct insert should materialize a visible row")
        .batch_id;

    core.storage_mut()
        .delete_local_batch_record(batch_id)
        .unwrap();
    core.storage_mut()
        .upsert_authoritative_batch_fate(&crate::batch_fate::BatchFate::Rejected {
            batch_id,
            code: "permission_denied".to_string(),
            reason: "writer lacks publish rights".to_string(),
        })
        .unwrap();
    core.replay_batch_rejection(batch_id, "permission_denied", "writer lacks publish rights")
        .unwrap();

    assert_eq!(core.local_batch_record(batch_id).unwrap(), None);
    let record = core
        .local_batch_record_for_rejection_replay(batch_id)
        .unwrap()
        .expect("sealed rejected batches should remain replayable");
    assert_eq!(record.batch_id, batch_id);
    assert_eq!(record.mode, crate::batch_fate::BatchMode::Direct);
    assert!(record.sealed);
    assert!(matches!(
        record.latest_fate,
        Some(crate::batch_fate::BatchFate::Rejected { .. })
    ));
    assert_eq!(record.members.len(), 1);
    assert_eq!(record.members[0].object_id, row_id);
    assert!(record.sealed_submission.is_some());
}

#[test]
fn rc_transactional_rejected_replay_record_keeps_sealed_submission_mode() {
    let mut core = create_runtime_with_schema(
        test_schema(),
        "transactional-reject-replay-record-mode-test",
    );

    let write_context = WriteContext::from_session(Session::new("alice"))
        .with_batch_mode(crate::batch_fate::BatchMode::Transactional);
    let ((row_id, _row_values), _receiver) = insert_and_wait_for_batch(
        &mut core,
        "users",
        user_insert_values(ObjectId::new(), "Alice"),
        Some(&write_context),
        DurabilityTier::Local,
    )
    .unwrap();

    let history_rows = core
        .storage()
        .scan_history_row_batches("users", row_id)
        .unwrap();
    assert_eq!(history_rows.len(), 1);
    let batch_id = history_rows[0].batch_id;
    core.seal_batch(batch_id).unwrap();

    core.storage_mut()
        .delete_local_batch_record(batch_id)
        .unwrap();
    core.storage_mut()
        .upsert_authoritative_batch_fate(&crate::batch_fate::BatchFate::Rejected {
            batch_id,
            code: "permission_denied".to_string(),
            reason: "writer lacks publish rights".to_string(),
        })
        .unwrap();

    let record = core
        .local_batch_record_for_rejection_replay(batch_id)
        .unwrap()
        .expect("sealed rejected transactional batches should remain replayable");
    assert_eq!(record.batch_id, batch_id);
    assert_eq!(record.mode, crate::batch_fate::BatchMode::Transactional);
    assert!(record.sealed);
    assert_eq!(record.members.len(), 1);
    assert_eq!(record.members[0].object_id, row_id);
    assert_eq!(
        record
            .sealed_submission
            .as_ref()
            .expect("replay should retain the sealed submission")
            .mode,
        crate::batch_fate::BatchMode::Transactional
    );
}

#[test]
fn rc_worker_sync_records_include_sealed_batches_pending_edge_reconciliation() {
    let mut core = create_runtime_with_schema(
        test_schema(),
        "direct-pending-worker-sync-record-test",
    );

    let ((row_id, _row_values), _receiver) = insert_and_wait_for_batch(
        &mut core,
        "users",
        user_insert_values(ObjectId::new(), "Alice"),
        None,
        DurabilityTier::Local,
    )
    .unwrap();
    let branch_name = core.schema_manager().branch_name();
    let batch_id = core
        .storage()
        .load_visible_region_row("users", branch_name.as_str(), row_id)
        .unwrap()
        .expect("persisted direct insert should materialize a visible row")
        .batch_id;

    core.storage_mut()
        .delete_local_batch_record(batch_id)
        .unwrap();

    assert_eq!(core.local_batch_record(batch_id).unwrap(), None);
    let records = core.local_batch_records_for_worker_sync().unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].batch_id, batch_id);
    assert!(matches!(
        records[0].latest_fate,
        Some(crate::batch_fate::BatchFate::DurableDirect {
            confirmed_tier: DurabilityTier::Local,
            ..
        })
    ));
    assert_eq!(records[0].members.len(), 1);
    assert_eq!(records[0].members[0].object_id, row_id);
}

#[test]
fn rc_worker_sync_records_include_local_only_fates_as_pending_markers() {
    let mut core = create_runtime_with_schema(
        test_schema(),
        "direct-pending-fate-worker-sync-record-test",
    );
    let batch_id = BatchId::new();

    core.storage_mut()
        .upsert_authoritative_batch_fate(&crate::batch_fate::BatchFate::DurableDirect {
            batch_id,
            confirmed_tier: DurabilityTier::Local,
        })
        .unwrap();

    let records = core.local_batch_records_for_worker_sync().unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].batch_id, batch_id);
    assert!(records[0].members.is_empty());
    assert!(matches!(
        records[0].latest_fate,
        Some(crate::batch_fate::BatchFate::DurableDirect {
            confirmed_tier: DurabilityTier::Local,
            ..
        })
    ));
}

#[test]
#[ignore = "pending milestone: rip legacy client/worker sync in favour of pure FrontierDag P2P reconciliation; \
            local-batch-replay persistence behaviour is under review (see spawned task)"]
fn rc_worker_accepts_local_batch_replay_payloads_from_peer() {
    let schema = test_schema();
    let mut main = create_runtime_with_schema(schema.clone(), "worker-local-replay-test");
    let mut worker = create_runtime_with_schema_and_sync_manager(
        schema,
        "worker-local-replay-test",
        SyncManager::new().with_durability_tier(DurabilityTier::Local),
    );

    let client_id = PeerId::new();
    worker.add_client(client_id, None);

    let ((row_id, _row_values), batch_id) = main
        .insert("users", user_insert_values(ObjectId::new(), "Alice"), None)
        .unwrap();

    let payloads = main.local_batch_replay_payloads(batch_id);
    assert_eq!(payloads.len(), 2);

    for payload in payloads {
        worker.park_sync_message(InboxEntry {
            source: Source::Client(client_id),
            payload,
        });
    }
    worker.batched_tick();
    worker.immediate_tick();

    let records = worker.local_batch_records_for_worker_sync().unwrap();
    assert!(
        records
            .iter()
            .any(|record| record.batch_id == batch_id && record.members.len() == 1),
        "worker should retain memberful batch record after local replay; records={records:?}"
    );
    assert!(
        worker
            .storage()
            .scan_history_row_batches("users", row_id)
            .unwrap()
            .iter()
            .any(|row| row.batch_id == batch_id),
        "worker should persist replayed row history"
    );
}

#[test]
fn rc_restart_accepts_stale_unrelated_family_frontier_sealed_batch_from_storage() {
    let schema = test_schema();
    let schema_hash = SchemaHash::compute(&schema);
    let batch_id = BatchId::new();
    let existing_row_id = ObjectId::new();
    let conflicting_row_id = ObjectId::new();
    let staged_row_id = ObjectId::new();
    let target_branch = crate::object::BranchName::new("dev-aaaaaaaaaaaa-main");
    let sibling_branch = crate::object::BranchName::new("dev-bbbbbbbbbbbb-main");
    let existing_row = crate::row_histories::StoredRowBatch::new(
        existing_row_id,
        target_branch.as_str(),
        Vec::<BatchId>::new(),
        encode_row(
            &test_schema()[&TableName::new("users")].columns,
            &user_row_values(existing_row_id, "Seen"),
        )
        .expect("user test row should encode"),
        crate::metadata::RowProvenance::for_insert(existing_row_id.to_string(), 900),
        HashMap::new(),
        crate::row_histories::RowState::VisibleDirect,
        None,
    );
    let conflicting_row = crate::row_histories::StoredRowBatch::new(
        conflicting_row_id,
        sibling_branch.as_str(),
        Vec::<BatchId>::new(),
        encode_row(
            &test_schema()[&TableName::new("users")].columns,
            &user_row_values(conflicting_row_id, "Bob"),
        )
        .expect("user test row should encode"),
        crate::metadata::RowProvenance::for_insert(conflicting_row_id.to_string(), 950),
        HashMap::new(),
        crate::row_histories::RowState::VisibleDirect,
        None,
    );
    let staged_row = crate::row_histories::StoredRowBatch::new_with_batch_id(
        batch_id,
        staged_row_id,
        target_branch.as_str(),
        Vec::<BatchId>::new(),
        encode_row(
            &test_schema()[&TableName::new("users")].columns,
            &user_row_values(staged_row_id, "Alice"),
        )
        .expect("user test row should encode"),
        crate::metadata::RowProvenance::for_insert(staged_row_id.to_string(), 1_000),
        HashMap::new(),
        crate::row_histories::RowState::StagingPending,
        None,
    );

    let mut old_runtime = create_runtime_with_schema_and_sync_manager(
        schema.clone(),
        "transactional-restart-frontier-conflict-test",
        SyncManager::new().with_durability_tier(DurabilityTier::Local),
    );
    for row_id in [existing_row_id, conflicting_row_id, staged_row_id] {
        old_runtime
            .storage_mut()
            .put_row_locator(
                row_id,
                Some(&RowLocator {
                    table: "users".into(),
                    origin_schema_hash: Some(schema_hash),
                }),
            )
            .unwrap();
    }
    old_runtime
        .storage_mut()
        .append_history_region_rows(
            "users",
            &[
                existing_row.clone(),
                conflicting_row.clone(),
                staged_row.clone(),
            ],
        )
        .unwrap();
    old_runtime
        .storage_mut()
        .upsert_visible_region_rows(
            "users",
            &[
                crate::row_histories::VisibleRowEntry::rebuild(
                    existing_row.clone(),
                    std::slice::from_ref(&existing_row),
                ),
                crate::row_histories::VisibleRowEntry::rebuild(
                    conflicting_row.clone(),
                    std::slice::from_ref(&conflicting_row),
                ),
            ],
        )
        .unwrap();
    old_runtime
        .storage_mut()
        .upsert_sealed_batch_submission(&SealedBatchSubmission::new(
            batch_id,
            crate::batch_fate::BatchMode::Transactional,
            target_branch,
            vec![SealedBatchMember {
                object_id: staged_row_id,
                row_digest: staged_row.content_digest(),
            }],
            vec![CapturedFrontierMember {
                object_id: existing_row_id,
                branch_name: target_branch,
                batch_id: existing_row.batch_id(),
            }],
        ))
        .unwrap();

    let storage = old_runtime.into_storage();
    let restarted = create_runtime_with_storage_and_sync_manager(
        schema,
        "transactional-restart-frontier-conflict-test",
        storage,
        SyncManager::new().with_durability_tier(DurabilityTier::Local),
    );

    assert_eq!(
        restarted
            .storage()
            .load_authoritative_batch_fate(batch_id)
            .unwrap(),
        Some(crate::batch_fate::BatchFate::AcceptedTransaction {
            batch_id,
            confirmed_tier: DurabilityTier::Local,
        })
    );
    let visible = restarted
        .storage()
        .load_visible_region_row("users", target_branch.as_str(), staged_row_id)
        .unwrap()
        .expect("accepted sealed batch should publish staged row");
    assert_eq!(
        visible.state,
        crate::row_histories::RowState::VisibleTransactional
    );
    assert_eq!(
        restarted
            .storage()
            .scan_history_row_batches("users", staged_row_id)
            .unwrap()[0]
            .state,
        crate::row_histories::RowState::VisibleTransactional
    );
    assert_eq!(
        restarted
            .storage()
            .load_sealed_batch_submission(batch_id)
            .unwrap(),
        None
    );
}

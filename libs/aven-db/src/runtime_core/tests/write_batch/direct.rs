use super::*;









#[test]
fn rc_same_row_direct_batch_overwrites_staged_member_in_place() {
    let mut core = create_test_runtime();
    let batch_id = BatchId::new();
    let write_context = WriteContext::default().with_batch_id(batch_id);

    let ((row_id, _), _) = core
        .insert(
            "users",
            user_insert_values(ObjectId::new(), "Alice"),
            Some(&write_context),
        )
        .unwrap();

    core.update(
        row_id,
        vec![("name".to_string(), Value::Text("Alicia".to_string()))],
        Some(&write_context),
    )
    .unwrap();

    let branch_name = core.schema_manager().branch_name();
    let history_rows = core
        .storage()
        .scan_history_row_batches("users", row_id)
        .unwrap();
    assert_eq!(
        history_rows.len(),
        1,
        "rewriting the same row inside one direct batch should overwrite the batch member instead of appending a second history row"
    );
    assert_eq!(history_rows[0].batch_id, batch_id);
    assert_eq!(history_rows[0].batch_id(), batch_id);

    assert_eq!(
        core.storage()
            .load_visible_region_row("users", branch_name.as_str(), row_id)
            .unwrap(),
        None,
        "open direct batch rows should stay staged until the batch is sealed"
    );
    assert_eq!(
        history_rows[0].state,
        crate::row_histories::RowState::StagingPending
    );

    core.seal_batch(batch_id).unwrap();

    let visible_row = core
        .storage()
        .load_visible_region_row("users", branch_name.as_str(), row_id)
        .unwrap()
        .expect("sealed direct batch row should become visible");
    assert_eq!(visible_row.batch_id, batch_id);
    assert_eq!(visible_row.batch_id(), batch_id);
    assert_eq!(
        visible_row.state,
        crate::row_histories::RowState::VisibleDirect
    );
}

#[test]
fn rc_direct_batch_reuses_loaded_local_batch_record_while_building() {
    let calls = Arc::new(Mutex::new(RowMutationCallCounts::default()));
    let mut core = create_runtime_with_boxed_storage(
        test_schema(),
        "direct-batch-local-record-cache-test",
        Box::new(RowMutationObservingStorage::new(calls.clone())),
    );
    let batch_id = BatchId::new();
    let write_context = WriteContext::default()
        .with_batch_mode(crate::batch_fate::BatchMode::Direct)
        .with_batch_id(batch_id);

    core.insert(
        "users",
        user_insert_values(ObjectId::new(), "Alice"),
        Some(&write_context),
    )
    .unwrap();
    core.insert(
        "users",
        user_insert_values(ObjectId::new(), "Bob"),
        Some(&write_context),
    )
    .unwrap();
    core.insert(
        "users",
        user_insert_values(ObjectId::new(), "Cleo"),
        Some(&write_context),
    )
    .unwrap();

    assert_eq!(
        calls.lock().unwrap().local_batch_record_get_calls,
        1,
        "building a direct batch should not repeatedly load and decode the growing local batch record"
    );
}


#[test]
fn rc_sealed_direct_batch_rejects_further_writes() {
    let mut core = create_test_runtime();
    let batch_id = BatchId::new();
    let write_context = WriteContext::default()
        .with_batch_mode(crate::batch_fate::BatchMode::Direct)
        .with_batch_id(batch_id);

    let ((row_id, _), _) = core
        .insert(
            "users",
            user_insert_values(ObjectId::new(), "Alice"),
            Some(&write_context),
        )
        .unwrap();

    core.seal_batch(batch_id).unwrap();

    let submission = core
        .storage()
        .load_sealed_batch_submission(batch_id)
        .unwrap()
        .expect("sealed direct batch should keep its sealed submission");
    assert_eq!(
        submission.captured_frontier,
        Vec::<CapturedFrontierMember>::new(),
        "direct batch seals should not capture transactional frontier state"
    );

    let err = core
        .update(
            row_id,
            vec![("name".to_string(), Value::Text("Alicia".to_string()))],
            Some(&write_context),
        )
        .expect_err("sealed direct batches should be frozen");
    let err = format!("{err:?}");
    assert!(
        err.contains("already sealed"),
        "expected sealed-batch error, got {err:?}"
    );
}

#[test]
fn rc_open_direct_batch_has_no_persisted_local_batch_record() {
    let mut core = create_test_runtime();
    let batch_id = BatchId::new();
    let write_context = WriteContext::default()
        .with_batch_mode(crate::batch_fate::BatchMode::Direct)
        .with_batch_id(batch_id);

    core.insert(
        "users",
        user_insert_values(ObjectId::new(), "Alice"),
        Some(&write_context),
    )
    .unwrap();

    assert_eq!(
        core.local_batch_record(batch_id).unwrap(),
        None,
        "open direct batches are in-memory builders until sealed"
    );
}

#[test]
fn rc_restart_recovers_completed_sealed_batch_from_storage() {
    let schema = test_schema();
    let schema_hash = SchemaHash::compute(&schema);
    let batch_id = BatchId::new();
    let row_id = ObjectId::new();
    let staged_row = staged_user_row(row_id, batch_id, 1_000, "Alice");

    let mut old_runtime = create_runtime_with_schema_and_sync_manager(
        schema.clone(),
        "transactional-restart-seal-recovery-test",
        SyncManager::new().with_durability_tier(DurabilityTier::Local),
    );
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
    old_runtime
        .storage_mut()
        .append_history_region_rows("users", std::slice::from_ref(&staged_row))
        .unwrap();
    old_runtime
        .storage_mut()
        .upsert_sealed_batch_submission(&SealedBatchSubmission::new(
            batch_id,
            crate::batch_fate::BatchMode::Direct,
            crate::object::BranchName::new("main"),
            vec![SealedBatchMember {
                object_id: row_id,
                row_digest: staged_row.content_digest(),
            }],
            Vec::new(),
        ))
        .unwrap();

    let storage = old_runtime.into_storage();
    let restarted = create_runtime_with_storage_and_sync_manager(
        schema,
        "transactional-restart-seal-recovery-test",
        storage,
        SyncManager::new().with_durability_tier(DurabilityTier::Local),
    );

    let settlement = restarted
        .storage()
        .load_authoritative_batch_fate(batch_id)
        .unwrap()
        .expect("restart should recover and settle completed sealed batch");
    assert!(matches!(
        settlement,
        crate::batch_fate::BatchFate::DurableDirect {
            batch_id: settled_batch_id,
            confirmed_tier: DurabilityTier::Local,
        } if settled_batch_id == batch_id
    ));

    let visible = restarted
        .storage()
        .load_visible_region_row("users", "main", row_id)
        .unwrap()
        .expect("restart recovery should publish the durable direct row");
    assert_eq!(visible.state, crate::row_histories::RowState::VisibleDirect);
    assert_eq!(visible.batch_id, batch_id);
    assert_eq!(
        restarted
            .storage()
            .load_sealed_batch_submission(batch_id)
            .unwrap(),
        None,
        "recovered settlement should prune the sealed submission marker"
    );
}

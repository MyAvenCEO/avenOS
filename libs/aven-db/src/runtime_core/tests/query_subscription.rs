use super::*;

fn persist_direct_settlement_for_row(
    core: &mut TestCore,
    row: &crate::row_histories::StoredRowBatch,
    tier: DurabilityTier,
) {
    core.storage_mut()
        .upsert_authoritative_batch_fate(&crate::batch_fate::BatchFate::DurableDirect {
            batch_id: row.batch_id,
            confirmed_tier: tier,
        })
        .unwrap();
}






#[test]
fn rc_query_local_transaction_overlay_shows_only_the_requested_staged_insert() {
    let mut core = create_runtime_with_schema(test_schema(), "query-local-transaction-overlay");
    let branch_name = core.schema_manager().branch_name();

    let alice_batch = BatchId::new();
    let bob_batch = BatchId::new();

    let alice_context = WriteContext {
        session: None,
        attribution: None,
        updated_at: None,
        batch_mode: Some(crate::batch_fate::BatchMode::Transactional),
        batch_id: Some(alice_batch),
        target_branch_name: None,
        extra_metadata: None,
    };
    let bob_context = WriteContext {
        session: None,
        attribution: None,
        updated_at: None,
        batch_mode: Some(crate::batch_fate::BatchMode::Transactional),
        batch_id: Some(bob_batch),
        target_branch_name: None,
        extra_metadata: None,
    };

    let ((alice_id, _), _) = core
        .insert(
            "users",
            user_insert_values(ObjectId::new(), "alice-draft"),
            Some(&alice_context),
        )
        .unwrap();
    let ((_bob_id, _), _) = core
        .insert(
            "users",
            user_insert_values(ObjectId::new(), "bob-draft"),
            Some(&bob_context),
        )
        .unwrap();

    let alice_rows = execute_runtime_query_with_local_overlay(
        &mut core,
        Query::new("users"),
        None,
        ReadDurabilityOptions::default(),
        crate::sync_manager::QueryPropagation::Full,
        QueryLocalOverlay {
            batch_id: alice_batch,
            branch_name,
            row_ids: vec![alice_id],
        },
    );

    assert_eq!(alice_rows.len(), 1);
    assert_eq!(alice_rows[0].0, alice_id);
    assert_eq!(alice_rows[0].1[1], Value::Text("alice-draft".into()));

    let visible_rows = execute_runtime_query(&mut core, Query::new("users"), None);
    assert_eq!(
        visible_rows,
        Vec::<(ObjectId, Vec<Value>)>::new(),
        "ordinary reads should not see staged transactional rows"
    );
}

#[test]
fn rc_query_local_transaction_overlay_keeps_same_row_updates_isolated_by_batch() {
    let mut core = create_runtime_with_schema(test_schema(), "query-local-transaction-same-row");
    let branch_name = core.schema_manager().branch_name();

    let ((row_id, _), _) = core
        .insert("users", user_insert_values(ObjectId::new(), "shared"), None)
        .unwrap();

    let alice_batch = BatchId::new();
    let bob_batch = BatchId::new();

    let alice_context = WriteContext {
        session: None,
        attribution: None,
        updated_at: None,
        batch_mode: Some(crate::batch_fate::BatchMode::Transactional),
        batch_id: Some(alice_batch),
        target_branch_name: None,
        extra_metadata: None,
    };
    let bob_context = WriteContext {
        session: None,
        attribution: None,
        updated_at: None,
        batch_mode: Some(crate::batch_fate::BatchMode::Transactional),
        batch_id: Some(bob_batch),
        target_branch_name: None,
        extra_metadata: None,
    };

    core.update(
        row_id,
        vec![("name".into(), Value::Text("alice-draft".into()))],
        Some(&alice_context),
    )
    .unwrap();
    core.update(
        row_id,
        vec![("name".into(), Value::Text("bob-draft".into()))],
        Some(&bob_context),
    )
    .unwrap();

    let visible_rows = execute_runtime_query(&mut core, Query::new("users"), None);
    assert_eq!(visible_rows.len(), 1);
    assert_eq!(visible_rows[0].1[1], Value::Text("shared".into()));

    let alice_rows = execute_runtime_query_with_local_overlay(
        &mut core,
        Query::new("users"),
        None,
        ReadDurabilityOptions::default(),
        crate::sync_manager::QueryPropagation::Full,
        QueryLocalOverlay {
            batch_id: alice_batch,
            branch_name: branch_name.clone(),
            row_ids: vec![row_id],
        },
    );
    assert_eq!(alice_rows.len(), 1);
    assert_eq!(alice_rows[0].1[1], Value::Text("alice-draft".into()));

    let bob_rows = execute_runtime_query_with_local_overlay(
        &mut core,
        Query::new("users"),
        None,
        ReadDurabilityOptions::default(),
        crate::sync_manager::QueryPropagation::Full,
        QueryLocalOverlay {
            batch_id: bob_batch,
            branch_name,
            row_ids: vec![row_id],
        },
    );
    assert_eq!(bob_rows.len(), 1);
    assert_eq!(bob_rows[0].1[1], Value::Text("bob-draft".into()));
}

#[test]
fn rc_query_local_transaction_overlay_handles_indexed_insert_filters() {
    let mut core =
        create_runtime_with_schema(test_schema(), "query-local-transaction-index-insert");
    let branch_name = core.schema_manager().branch_name();

    let batch_id = BatchId::new();
    let write_context = WriteContext {
        session: None,
        attribution: None,
        updated_at: None,
        batch_mode: Some(crate::batch_fate::BatchMode::Transactional),
        batch_id: Some(batch_id),
        target_branch_name: None,
        extra_metadata: None,
    };

    let ((row_id, _), _) = core
        .insert(
            "users",
            user_insert_values(ObjectId::new(), "alice-draft"),
            Some(&write_context),
        )
        .unwrap();

    let query = QueryBuilder::new("users")
        .filter_eq("name", Value::Text("alice-draft".into()))
        .build();

    let visible_rows = execute_runtime_query(&mut core, query.clone(), None);
    assert_eq!(
        visible_rows,
        Vec::<(ObjectId, Vec<Value>)>::new(),
        "ordinary indexed reads should not see staged transaction inserts"
    );

    let overlay_rows = execute_runtime_query_with_local_overlay(
        &mut core,
        query,
        None,
        ReadDurabilityOptions::default(),
        crate::sync_manager::QueryPropagation::Full,
        QueryLocalOverlay {
            batch_id,
            branch_name,
            row_ids: vec![row_id],
        },
    );

    assert_eq!(overlay_rows.len(), 1);
    assert_eq!(overlay_rows[0].0, row_id);
    assert_eq!(overlay_rows[0].1[1], Value::Text("alice-draft".into()));
}

#[test]
fn rc_query_local_transaction_overlay_handles_indexed_update_filters() {
    let mut core =
        create_runtime_with_schema(test_schema(), "query-local-transaction-index-update");
    let branch_name = core.schema_manager().branch_name();

    let ((row_id, _), _) = core
        .insert("users", user_insert_values(ObjectId::new(), "shared"), None)
        .unwrap();

    let batch_id = BatchId::new();
    let write_context = WriteContext {
        session: None,
        attribution: None,
        updated_at: None,
        batch_mode: Some(crate::batch_fate::BatchMode::Transactional),
        batch_id: Some(batch_id),
        target_branch_name: None,
        extra_metadata: None,
    };

    core.update(
        row_id,
        vec![("name".into(), Value::Text("alice-draft".into()))],
        Some(&write_context),
    )
    .unwrap();

    let draft_query = QueryBuilder::new("users")
        .filter_eq("name", Value::Text("alice-draft".into()))
        .build();
    let shared_query = QueryBuilder::new("users")
        .filter_eq("name", Value::Text("shared".into()))
        .build();

    assert_eq!(
        execute_runtime_query(&mut core, draft_query.clone(), None),
        Vec::<(ObjectId, Vec<Value>)>::new(),
        "ordinary indexed reads should not see staged transaction updates"
    );
    assert_eq!(
        core.storage().index_lookup(
            "users",
            "name",
            branch_name.as_str(),
            &Value::Text("alice-draft".into())
        ),
        Vec::<ObjectId>::new(),
        "staged transaction updates should not update the branch index"
    );
    let shared_rows = execute_runtime_query(&mut core, shared_query.clone(), None);
    assert_eq!(shared_rows.len(), 1);
    assert_eq!(shared_rows[0].1[1], Value::Text("shared".into()));

    let draft_overlay_rows = execute_runtime_query_with_local_overlay(
        &mut core,
        draft_query,
        None,
        ReadDurabilityOptions::default(),
        crate::sync_manager::QueryPropagation::Full,
        QueryLocalOverlay {
            batch_id,
            branch_name: branch_name.clone(),
            row_ids: vec![row_id],
        },
    );
    assert_eq!(draft_overlay_rows.len(), 1);
    assert_eq!(
        draft_overlay_rows[0].1[1],
        Value::Text("alice-draft".into())
    );

    let shared_overlay_rows = execute_runtime_query_with_local_overlay(
        &mut core,
        shared_query,
        None,
        ReadDurabilityOptions::default(),
        crate::sync_manager::QueryPropagation::Full,
        QueryLocalOverlay {
            batch_id,
            branch_name,
            row_ids: vec![row_id],
        },
    );
    assert_eq!(
        shared_overlay_rows,
        Vec::<(ObjectId, Vec<Value>)>::new(),
        "transaction indexed reads should use the staged value, not the branch index value"
    );
}

#[test]
fn rc_query_local_transaction_overlay_keeps_indexed_deletes_isolated() {
    let mut core =
        create_runtime_with_schema(test_schema(), "query-local-transaction-index-delete");
    let branch_name = core.schema_manager().branch_name();

    let ((row_id, _), _) = core
        .insert("users", user_insert_values(ObjectId::new(), "shared"), None)
        .unwrap();

    let batch_id = BatchId::new();
    let write_context = WriteContext {
        session: None,
        attribution: None,
        updated_at: None,
        batch_mode: Some(crate::batch_fate::BatchMode::Transactional),
        batch_id: Some(batch_id),
        target_branch_name: None,
        extra_metadata: None,
    };

    core.delete(row_id, Some(&write_context)).unwrap();

    let shared_query = QueryBuilder::new("users")
        .filter_eq("name", Value::Text("shared".into()))
        .build();

    let visible_rows = execute_runtime_query(&mut core, shared_query.clone(), None);
    assert_eq!(visible_rows.len(), 1);
    assert_eq!(
        visible_rows[0].0, row_id,
        "ordinary indexed reads should still see the committed row while the delete is staged"
    );
    assert_eq!(
        core.storage().index_lookup(
            "users",
            "name",
            branch_name.as_str(),
            &Value::Text("shared".into())
        ),
        vec![row_id],
        "staged transaction deletes should not remove the branch index entry"
    );

    let overlay_rows = execute_runtime_query_with_local_overlay(
        &mut core,
        shared_query,
        None,
        ReadDurabilityOptions::default(),
        crate::sync_manager::QueryPropagation::Full,
        QueryLocalOverlay {
            batch_id,
            branch_name,
            row_ids: vec![row_id],
        },
    );
    assert_eq!(
        overlay_rows,
        Vec::<(ObjectId, Vec<Value>)>::new(),
        "transaction indexed reads should hide the row deleted by that transaction"
    );
}

#[test]
fn rc_query_local_transaction_overlay_include_deleted_returns_staged_delete() {
    let mut core =
        create_runtime_with_schema(test_schema(), "query-local-transaction-include-deleted");
    let branch_name = core.schema_manager().branch_name();

    let ((row_id, _), _) = core
        .insert("users", user_insert_values(ObjectId::new(), "shared"), None)
        .unwrap();

    let batch_id = BatchId::new();
    let write_context = WriteContext {
        session: None,
        attribution: None,
        updated_at: None,
        batch_mode: Some(crate::batch_fate::BatchMode::Transactional),
        batch_id: Some(batch_id),
        target_branch_name: None,
        extra_metadata: None,
    };

    core.delete(row_id, Some(&write_context)).unwrap();

    let deleted_query = QueryBuilder::new("users")
        .filter_eq("name", Value::Text("shared".into()))
        .include_deleted()
        .build();

    let overlay_rows = execute_runtime_query_with_local_overlay(
        &mut core,
        deleted_query,
        None,
        ReadDurabilityOptions::default(),
        crate::sync_manager::QueryPropagation::Full,
        QueryLocalOverlay {
            batch_id,
            branch_name,
            row_ids: vec![row_id],
        },
    );
    assert_eq!(
        overlay_rows.len(),
        1,
        "include_deleted transaction reads should include the row deleted by that transaction"
    );
    assert_eq!(overlay_rows[0].0, row_id);
}

#[test]
fn rc_query_local_direct_batch_overlay_handles_indexed_filters_until_commit() {
    let mut core =
        create_runtime_with_schema(test_schema(), "query-local-direct-batch-index-update");
    let branch_name = core.schema_manager().branch_name();

    let ((row_id, _), _) = core
        .insert("users", user_insert_values(ObjectId::new(), "shared"), None)
        .unwrap();

    let batch_id = BatchId::new();
    let write_context = WriteContext::default()
        .with_batch_mode(crate::batch_fate::BatchMode::Direct)
        .with_batch_id(batch_id);

    core.update(
        row_id,
        vec![("name".into(), Value::Text("alice-batch".into()))],
        Some(&write_context),
    )
    .unwrap();

    let batch_query = QueryBuilder::new("users")
        .filter_eq("name", Value::Text("alice-batch".into()))
        .build();
    let shared_query = QueryBuilder::new("users")
        .filter_eq("name", Value::Text("shared".into()))
        .build();

    assert_eq!(
        execute_runtime_query(&mut core, batch_query.clone(), None),
        Vec::<(ObjectId, Vec<Value>)>::new(),
        "ordinary indexed reads should not see open direct batch updates"
    );
    assert_eq!(
        core.storage().index_lookup(
            "users",
            "name",
            branch_name.as_str(),
            &Value::Text("alice-batch".into())
        ),
        Vec::<ObjectId>::new(),
        "open direct batch updates should not update the branch index"
    );

    let batch_overlay_rows = execute_runtime_query_with_local_overlay(
        &mut core,
        batch_query.clone(),
        None,
        ReadDurabilityOptions::default(),
        crate::sync_manager::QueryPropagation::Full,
        QueryLocalOverlay {
            batch_id,
            branch_name: branch_name.clone(),
            row_ids: vec![row_id],
        },
    );
    assert_eq!(batch_overlay_rows.len(), 1);
    assert_eq!(
        batch_overlay_rows[0].1[1],
        Value::Text("alice-batch".into())
    );

    let shared_overlay_rows = execute_runtime_query_with_local_overlay(
        &mut core,
        shared_query,
        None,
        ReadDurabilityOptions::default(),
        crate::sync_manager::QueryPropagation::Full,
        QueryLocalOverlay {
            batch_id,
            branch_name,
            row_ids: vec![row_id],
        },
    );
    assert_eq!(
        shared_overlay_rows,
        Vec::<(ObjectId, Vec<Value>)>::new(),
        "direct batch indexed reads should use the staged value while the batch is open"
    );

    core.seal_batch(batch_id).unwrap();

    assert_eq!(
        core.storage().index_lookup(
            "users",
            "name",
            branch_name.as_str(),
            &Value::Text("alice-batch".into())
        ),
        vec![row_id],
        "sealing a direct batch should apply its index mutations"
    );
    assert_eq!(
        core.storage().index_lookup(
            "users",
            "name",
            branch_name.as_str(),
            &Value::Text("shared".into())
        ),
        Vec::<ObjectId>::new(),
        "sealing a direct batch should remove stale index entries"
    );

    let committed_rows = execute_runtime_query(&mut core, batch_query, None);
    assert_eq!(committed_rows.len(), 1);
    assert_eq!(committed_rows[0].1[1], Value::Text("alice-batch".into()));
}



#[test]
fn query_reads_pick_row_batches_by_required_durability_tier() {
    let mut core = create_runtime_with_schema_and_sync_manager(
        test_schema(),
        "tier-aware-visible-row",
        SyncManager::new(),
    );
    let branch_name = core.schema_manager().branch_name().to_string();

    // Row history:
    //   v1 --(global)--> visible for global queries
    //    \
    //     `-- v2 --(worker)--> current head for worker queries
    let row_id = ObjectId::new();
    let ((object_id, _), _) = core
        .insert("users", user_insert_values(row_id, "Alice-global"), None)
        .unwrap();
    core.immediate_tick();

    let first_visible = core
        .storage()
        .load_visible_region_row("users", &branch_name, object_id)
        .unwrap()
        .expect("first visible row");
    persist_direct_settlement_for_row(&mut core, &first_visible, DurabilityTier::GlobalServer);

    core.update(
        object_id,
        vec![("name".into(), Value::Text("Alice-worker".into()))],
        None,
    )
    .unwrap();
    core.immediate_tick();

    let second_visible = core
        .storage()
        .load_visible_region_row("users", &branch_name, object_id)
        .unwrap()
        .expect("second visible row");
    persist_direct_settlement_for_row(&mut core, &second_visible, DurabilityTier::Local);

    let worker_rows = execute_runtime_query_with_durability_and_propagation(
        &mut core,
        Query::new("users"),
        None,
        ReadDurabilityOptions {
            tier: Some(DurabilityTier::Local),
            local_updates: crate::query_manager::manager::LocalUpdates::Deferred,
        },
        crate::sync_manager::QueryPropagation::LocalOnly,
    );
    let global_rows = execute_runtime_query_with_durability_and_propagation(
        &mut core,
        Query::new("users"),
        None,
        ReadDurabilityOptions {
            tier: Some(DurabilityTier::GlobalServer),
            local_updates: crate::query_manager::manager::LocalUpdates::Deferred,
        },
        crate::sync_manager::QueryPropagation::LocalOnly,
    );

    assert_eq!(
        worker_rows,
        vec![(object_id, user_row_values(row_id, "Alice-worker"))]
    );
    assert_eq!(
        global_rows,
        vec![(object_id, user_row_values(row_id, "Alice-global"))]
    );
}

#[test]
fn query_reads_merge_conflicting_row_batches_by_required_durability_tier() {
    let schema = SchemaBuilder::new()
        .table(
            TableSchema::builder("todos")
                .column("title", ColumnType::Text)
                .column("done", ColumnType::Boolean),
        )
        .build();
    let mut core = create_runtime_with_schema_and_sync_manager(
        schema.clone(),
        "tier-aware-merged-row",
        SyncManager::new(),
    );
    let branch_name = core.schema_manager().branch_name().to_string();
    let descriptor = &schema[&TableName::new("todos")].columns;

    let ((row_id, _row_values), _) = core
        .insert(
            "todos",
            HashMap::from([
                ("title".to_string(), Value::Text("base".into())),
                ("done".to_string(), Value::Boolean(false)),
            ]),
            None,
        )
        .unwrap();
    core.immediate_tick();

    let base = core
        .storage()
        .load_visible_region_row("todos", &branch_name, row_id)
        .unwrap()
        .expect("base visible row");
    persist_direct_settlement_for_row(&mut core, &base, DurabilityTier::GlobalServer);
    let base = core
        .storage()
        .load_visible_region_row("todos", &branch_name, row_id)
        .unwrap()
        .expect("patched base visible row");

    let edge_title = crate::row_histories::StoredRowBatch::new(
        row_id,
        branch_name.clone(),
        vec![base.batch_id()],
        encode_row(
            descriptor,
            &[Value::Text("edge-title".into()), Value::Boolean(false)],
        )
        .unwrap(),
        crate::metadata::RowProvenance::for_update(&base.row_provenance(), "alice".to_string(), 20),
        HashMap::new(),
        crate::row_histories::RowState::VisibleDirect,
        None,
    );
    let worker_done = crate::row_histories::StoredRowBatch::new(
        row_id,
        branch_name.clone(),
        vec![base.batch_id()],
        encode_row(
            descriptor,
            &[Value::Text("base".into()), Value::Boolean(true)],
        )
        .unwrap(),
        crate::metadata::RowProvenance::for_update(&base.row_provenance(), "bob".to_string(), 21),
        HashMap::new(),
        crate::row_histories::RowState::VisibleDirect,
        None,
    );
    persist_direct_settlement_for_row(&mut core, &edge_title, DurabilityTier::EdgeServer);
    persist_direct_settlement_for_row(&mut core, &worker_done, DurabilityTier::Local);

    core.storage_mut()
        .append_history_region_rows("todos", &[edge_title.clone(), worker_done.clone()])
        .unwrap();
    core.storage_mut()
        .upsert_visible_region_rows(
            "todos",
            std::slice::from_ref(
                &crate::row_histories::VisibleRowEntry::rebuild_with_descriptor(
                    descriptor,
                    &[base.clone(), edge_title.clone(), worker_done.clone()],
                )
                .unwrap()
                .expect("merged visible entry"),
            ),
        )
        .unwrap();

    let worker_preview = core
        .storage()
        .load_visible_region_row_for_tier("todos", &branch_name, row_id, DurabilityTier::Local)
        .unwrap()
        .expect("worker preview");
    let edge_preview = core
        .storage()
        .load_visible_region_row_for_tier("todos", &branch_name, row_id, DurabilityTier::EdgeServer)
        .unwrap()
        .expect("edge preview");
    let global_preview = core
        .storage()
        .load_visible_region_row_for_tier(
            "todos",
            &branch_name,
            row_id,
            DurabilityTier::GlobalServer,
        )
        .unwrap()
        .expect("global preview");
    assert_eq!(
        decode_row(descriptor, &worker_preview.data).unwrap(),
        vec![Value::Text("edge-title".into()), Value::Boolean(true)]
    );
    assert_eq!(
        decode_row(descriptor, &edge_preview.data).unwrap(),
        vec![Value::Text("edge-title".into()), Value::Boolean(false)]
    );
    assert_eq!(
        decode_row(descriptor, &global_preview.data).unwrap(),
        vec![Value::Text("base".into()), Value::Boolean(false)]
    );

    let worker_rows = execute_runtime_query_with_durability_and_propagation(
        &mut core,
        Query::new("todos"),
        None,
        ReadDurabilityOptions {
            tier: Some(DurabilityTier::Local),
            local_updates: crate::query_manager::manager::LocalUpdates::Deferred,
        },
        crate::sync_manager::QueryPropagation::LocalOnly,
    );
    let edge_rows = execute_runtime_query_with_durability_and_propagation(
        &mut core,
        Query::new("todos"),
        None,
        ReadDurabilityOptions {
            tier: Some(DurabilityTier::EdgeServer),
            local_updates: crate::query_manager::manager::LocalUpdates::Deferred,
        },
        crate::sync_manager::QueryPropagation::LocalOnly,
    );
    let global_rows = execute_runtime_query_with_durability_and_propagation(
        &mut core,
        Query::new("todos"),
        None,
        ReadDurabilityOptions {
            tier: Some(DurabilityTier::GlobalServer),
            local_updates: crate::query_manager::manager::LocalUpdates::Deferred,
        },
        crate::sync_manager::QueryPropagation::LocalOnly,
    );

    assert_eq!(
        worker_rows,
        vec![(
            row_id,
            vec![Value::Text("edge-title".into()), Value::Boolean(true)]
        )]
    );
    assert_eq!(
        edge_rows,
        vec![(
            row_id,
            vec![Value::Text("edge-title".into()), Value::Boolean(false)]
        )]
    );
    assert_eq!(
        global_rows,
        vec![(
            row_id,
            vec![Value::Text("base".into()), Value::Boolean(false)]
        )]
    );
}









use super::*;

#[test]
fn test_runtime_core_new() {
    let core = create_test_runtime();
    let schema = core.current_schema();
    assert!(schema.contains_key(&TableName::new("users")));
}

#[test]
fn test_runtime_core_insert_query() {
    let mut core = create_test_runtime();

    let user_id = ObjectId::new();
    let expected_values = user_row_values(user_id, "Alice");
    let ((object_id, row_values), _) = core
        .insert("users", user_insert_values(user_id, "Alice"), None)
        .unwrap();
    assert!(!object_id.uuid().is_nil());
    assert_eq!(row_values, expected_values);

    core.immediate_tick();
    core.batched_tick();

    let query = Query::new("users");
    let results = execute_query(&mut core, query);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].0, object_id);
    assert_eq!(results[0].1, row_values);
}

#[test]
fn add_server_rehydrates_visible_rows_from_storage_after_restart() {
    let mut old_runtime = create_runtime_with_schema(test_schema(), "restart-sync-test");
    let user_id = ObjectId::new();
    let ((row_object_id, _), _) = old_runtime
        .insert("users", user_insert_values(user_id, "Alice"), None)
        .expect("insert should succeed before restart");

    let storage = old_runtime.into_storage();
    let mut restarted = create_runtime_with_storage(test_schema(), "restart-sync-test", storage);

    let server_id = ServerId::new();
    restarted.add_server(server_id);
    restarted.batched_tick();

    let messages = restarted.sync_sender().take();
    let synced_row = messages.iter().find(|message| match &message.payload {
        SyncPayload::RowBatchCreated { row, .. } => row.row_id == row_object_id,
        _ => false,
    });

    assert!(
        synced_row.is_some(),
        "row visible before restart should replay to a new server after restart; messages: {}",
        messages
            .iter()
            .map(|message| format!("{:?}", message.payload))
            .collect::<Vec<_>>()
            .join(", ")
    );
}

#[test]
fn test_runtime_core_insert_materializes_schema_defaults() {
    let mut core = create_runtime_with_schema(defaulted_todos_schema(), "todos-with-defaults");

    let ((object_id, row_values), _) = core
        .insert(
            "todos",
            HashMap::from([("title".to_string(), Value::Text("Ship it".to_string()))]),
            None,
        )
        .unwrap();
    assert!(!object_id.uuid().is_nil());
    let descriptor = &core.current_schema()[&TableName::new("todos")].columns;
    let title_idx = descriptor.column_index("title").unwrap();
    let done_idx = descriptor.column_index("done").unwrap();
    assert_eq!(row_values[title_idx], Value::Text("Ship it".to_string()));
    assert_eq!(row_values[done_idx], Value::Boolean(false));

    core.immediate_tick();
    core.batched_tick();

    let results = execute_query(&mut core, Query::new("todos"));
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].0, object_id);
    assert_eq!(results[0].1, row_values);
}

#[test]
fn test_runtime_core_subscription() {
    let mut core = create_test_runtime();

    let updates: Arc<Mutex<Vec<SubscriptionDelta>>> = Arc::new(Mutex::new(Vec::new()));
    let updates_clone = updates.clone();

    let query = Query::new("users");
    let handle = core
        .subscribe(
            query,
            move |delta| {
                updates_clone.lock().unwrap().push(delta);
            },
            None,
        )
        .unwrap();

    let _object_id = core
        .insert("users", user_insert_values(ObjectId::new(), "Bob"), None)
        .unwrap();

    core.immediate_tick();
    core.batched_tick();

    let updates_vec = updates.lock().unwrap();
    assert!(
        !updates_vec.is_empty(),
        "Should receive subscription update"
    );
    assert_eq!(updates_vec[0].handle, handle);

    drop(updates_vec);
    core.unsubscribe(handle);
}

#[test]
fn test_runtime_core_concurrent_inserts_from_multiple_callers() {
    use std::thread;

    let core = Arc::new(Mutex::new(create_test_runtime()));
    let workers = 8;
    let mut handles = Vec::new();

    for i in 0..workers {
        let core_ref = Arc::clone(&core);
        handles.push(thread::spawn(move || {
            let mut locked = core_ref.lock().unwrap();
            locked
                .insert(
                    "users",
                    user_insert_values(ObjectId::new(), &format!("User-{i}")),
                    None,
                )
                .unwrap();
        }));
    }

    for handle in handles {
        handle.join().expect("worker thread should complete");
    }

    let mut locked = core.lock().unwrap();
    locked.immediate_tick();
    locked.batched_tick();

    let results = execute_query(&mut locked, Query::new("users"));
    assert_eq!(
        results.len(),
        workers,
        "All concurrent inserts should be visible"
    );
}

#[test]
fn test_runtime_core_update_delete() {
    let mut core = create_test_runtime();

    let id = ObjectId::new();
    let ((object_id, _row_values), _) = core
        .insert("users", user_insert_values(id, "Charlie"), None)
        .unwrap();
    core.immediate_tick();
    core.batched_tick();

    let updates = vec![("name".to_string(), Value::Text("Dave".to_string()))];
    core.update(object_id, updates, None).unwrap();
    core.immediate_tick();
    core.batched_tick();

    let query = Query::new("users");
    let results = execute_query(&mut core, query);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].1[1], Value::Text("Dave".to_string()));

    core.delete(object_id, None).unwrap();
    core.immediate_tick();
    core.batched_tick();

    let query = Query::new("users");
    let results = execute_query(&mut core, query);
    assert_eq!(results.len(), 0);
}

#[test]
fn test_park_sync_message() {
    use crate::metadata::RowProvenance;
    use crate::sync_manager::{Source, SyncPayload};

    let mut core = create_test_runtime();

    let message = InboxEntry {
        source: Source::Server(ServerId::new()),
        payload: SyncPayload::RowBatchCreated {
            metadata: None,
            row: crate::row_histories::StoredRowBatch::new(
                ObjectId::new(),
                "main",
                Vec::new(),
                b"alice".to_vec(),
                RowProvenance::for_insert(ObjectId::new().to_string(), 1_000),
                HashMap::new(),
                crate::row_histories::RowState::VisibleDirect,
                None,
            ),
        },
    };
    core.park_sync_message(message);

    assert_eq!(core.parked_sync_messages.len(), 1);
}

// =========================================================================
// Durability API Tests (3-tier: A ↔ B[Worker] ↔ C[EdgeServer])
// =========================================================================

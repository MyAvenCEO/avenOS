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
fn rc_nearest_returns_top_k_by_cosine_distance() {
    // Schema with a first-class Vector column.
    let schema = SchemaBuilder::new()
        .table(
            TableSchema::builder("memories")
                .column("id", ColumnType::Uuid)
                .column("embedding", ColumnType::Vector { dim: 3 }),
        )
        .build();
    let mut core = create_runtime_with_schema(schema, "nearest-cosine-test");

    // Query vector points along +x. Distances to it (1 - cosine):
    //   a = +x        -> 0.0   (identical direction, nearest)
    //   b = +x+y (45) -> ~0.293
    //   c = -x        -> 2.0   (opposite, farthest)
    let ((a, _), _) = core
        .insert(
            "memories",
            HashMap::from([
                ("id".to_string(), Value::Uuid(ObjectId::new())),
                ("embedding".to_string(), Value::Vector(vec![1.0, 0.0, 0.0])),
            ]),
            None,
        )
        .unwrap();
    let ((b, _), _) = core
        .insert(
            "memories",
            HashMap::from([
                ("id".to_string(), Value::Uuid(ObjectId::new())),
                ("embedding".to_string(), Value::Vector(vec![1.0, 1.0, 0.0])),
            ]),
            None,
        )
        .unwrap();
    let ((c, _), _) = core
        .insert(
            "memories",
            HashMap::from([
                ("id".to_string(), Value::Uuid(ObjectId::new())),
                ("embedding".to_string(), Value::Vector(vec![-1.0, 0.0, 0.0])),
            ]),
            None,
        )
        .unwrap();

    core.immediate_tick();
    core.batched_tick();

    let query = QueryBuilder::new("memories")
        .nearest("embedding", vec![1.0, 0.0, 0.0], 2)
        .build();
    let results = execute_query(&mut core, query);

    let ids: Vec<ObjectId> = results.iter().map(|(id, _)| *id).collect();
    assert_eq!(ids.len(), 2, "k=2 should return 2 rows, got {results:?}");
    assert_eq!(ids[0], a, "closest must be the identical-direction vector");
    assert_eq!(ids[1], b, "second closest must be the 45-degree vector");
    assert!(
        !ids.contains(&c),
        "opposite-direction vector must be excluded by k=2"
    );
}

#[test]
fn rc_unseal_hook_ranks_sealed_columns_by_plaintext() {
    use crate::query_manager::graph_nodes::sort::UnsealFn;
    use std::sync::Arc;

    // Sealed-at-rest simulation: embeddings stored negated, bodies stored reversed.
    // The unseal-on-scan hook (plan §3 seam) recovers plaintext for ranking only.
    let schema = SchemaBuilder::new()
        .table(
            TableSchema::builder("memories")
                .column("id", ColumnType::Uuid)
                .column("embedding", ColumnType::Vector { dim: 3 })
                .column("body", ColumnType::Text),
        )
        .build();
    let mut core = create_runtime_with_schema(schema, "unseal-seam-test");

    let seal_vec = |v: &[f32]| Value::Vector(v.iter().map(|x| -x).collect());
    let seal_text = |t: &str| Value::Text(t.chars().rev().collect());

    // Plaintext a = +x, "the quick brown fox"; plaintext c = -x, "slow turtle crawls".
    let ((a, _), _) = core
        .insert(
            "memories",
            HashMap::from([
                ("id".to_string(), Value::Uuid(ObjectId::new())),
                ("embedding".to_string(), seal_vec(&[1.0, 0.0, 0.0])),
                ("body".to_string(), seal_text("the quick brown fox")),
            ]),
            None,
        )
        .unwrap();
    let ((c, _), _) = core
        .insert(
            "memories",
            HashMap::from([
                ("id".to_string(), Value::Uuid(ObjectId::new())),
                ("embedding".to_string(), seal_vec(&[-1.0, 0.0, 0.0])),
                ("body".to_string(), seal_text("slow turtle crawls")),
            ]),
            None,
        )
        .unwrap();

    core.immediate_tick();
    core.batched_tick();

    // WITHOUT the hook the engine ranks the sealed bytes as-is: c's stored
    // embedding (+x after sealing) wins nearest(+x) — the wrong row.
    let query = QueryBuilder::new("memories")
        .nearest("embedding", vec![1.0, 0.0, 0.0], 1)
        .build();
    let results = execute_query(&mut core, query);
    assert_eq!(results[0].0, c, "sealed bytes rank as stored without the hook");

    // Register the unseal hook: ranking now follows plaintext.
    let hook: UnsealFn = Arc::new(|_table, column, v| match (column, v) {
        ("embedding", Value::Vector(sealed)) => {
            Some(Value::Vector(sealed.iter().map(|x| -x).collect()))
        }
        ("body", Value::Text(sealed)) => Some(Value::Text(sealed.chars().rev().collect())),
        _ => Some(v.clone()),
    });
    core.schema_manager_mut()
        .query_manager_mut()
        .set_unseal(Some(hook));

    let query = QueryBuilder::new("memories")
        .nearest("embedding", vec![1.0, 0.0, 0.0], 1)
        .build();
    let results = execute_query(&mut core, query);
    assert_eq!(results[0].0, a, "with the hook, plaintext +x wins nearest(+x)");

    // BM25 over sealed text: only the unsealed body of `a` contains the terms.
    let query = QueryBuilder::new("memories")
        .text_search("body", "quick fox", 1)
        .build();
    let results = execute_query(&mut core, query);
    assert_eq!(results[0].0, a, "with the hook, BM25 scores plaintext bodies");

    // Results still carry the STORED (sealed) row values — no plaintext leaks out.
    let stored_body = &results[0].1;
    assert!(
        stored_body
            .iter()
            .any(|v| matches!(v, Value::Text(s) if s == &"the quick brown fox".chars().rev().collect::<String>())),
        "query results must return stored (sealed) values, got {stored_body:?}"
    );
}

#[test]
fn rc_text_search_returns_top_k_by_bm25() {
    let schema = SchemaBuilder::new()
        .table(
            TableSchema::builder("memories")
                .column("id", ColumnType::Uuid)
                .column("body", ColumnType::Text),
        )
        .build();
    let mut core = create_runtime_with_schema(schema, "text-search-bm25-test");

    // Query "quick fox":
    //   a = both terms, long doc  -> moderate BM25
    //   b = both terms, short doc -> highest BM25 (length normalization)
    //   c = no query terms        -> 0, excluded
    let ((a, _), _) = core
        .insert(
            "memories",
            HashMap::from([
                ("id".to_string(), Value::Uuid(ObjectId::new())),
                (
                    "body".to_string(),
                    Value::Text("the quick brown fox jumps over things".to_string()),
                ),
            ]),
            None,
        )
        .unwrap();
    let ((b, _), _) = core
        .insert(
            "memories",
            HashMap::from([
                ("id".to_string(), Value::Uuid(ObjectId::new())),
                ("body".to_string(), Value::Text("quick fox".to_string())),
            ]),
            None,
        )
        .unwrap();
    let ((c, _), _) = core
        .insert(
            "memories",
            HashMap::from([
                ("id".to_string(), Value::Uuid(ObjectId::new())),
                ("body".to_string(), Value::Text("the lazy dog sleeps".to_string())),
            ]),
            None,
        )
        .unwrap();

    core.immediate_tick();
    core.batched_tick();

    let query = QueryBuilder::new("memories")
        .text_search("body", "quick fox", 2)
        .build();
    let results = execute_query(&mut core, query);

    let ids: Vec<ObjectId> = results.iter().map(|(id, _)| *id).collect();
    assert_eq!(ids.len(), 2, "k=2 should return 2 rows, got {results:?}");
    assert_eq!(ids[0], b, "shortest doc with both query terms ranks first (BM25)");
    assert_eq!(ids[1], a, "longer doc with both terms ranks second");
    assert!(
        !ids.contains(&c),
        "doc with no query terms must be excluded by k=2"
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


// =========================================================================
// Durability API Tests (3-tier: A ↔ B[Worker] ↔ C[EdgeServer])
// =========================================================================

use super::*;

#[test]
fn query_manager_with_schema_context() {
    let v1 = SchemaBuilder::new()
        .table(
            TableSchema::builder("users")
                .column("id", ColumnType::Uuid)
                .column("name", ColumnType::Text),
        )
        .build();

    let v2 = SchemaBuilder::new()
        .table(
            TableSchema::builder("users")
                .column("id", ColumnType::Uuid)
                .column("name", ColumnType::Text)
                .nullable_column("email", ColumnType::Text),
        )
        .build();

    let v1_hash = SchemaHash::compute(&v1);
    let v2_hash = SchemaHash::compute(&v2);
    let lens = generate_lens(&v1, &v2);

    // Create QueryManager with new API
    let sm = SyncManager::new();
    let mut qm = QueryManager::new(sm);
    qm.set_current_schema(v2.clone(), "dev", "main");
    qm.add_live_schema(v1.clone());
    qm.register_lens(lens);

    // Verify schema context is initialized
    assert!(qm.schema_context().is_initialized());

    // Verify all branches are available for queries
    let branches = qm.all_query_branches();
    assert_eq!(branches.len(), 2);

    // Both schema branches should be included
    let v1_branch = format!("dev-{}-main", v1_hash.short());
    let v2_branch = format!("dev-{}-main", v2_hash.short());
    assert!(branches.contains(&v1_branch));
    assert!(branches.contains(&v2_branch));
}

#[test]
fn query_graph_compile_with_schema_context() {
    let v1 = SchemaBuilder::new()
        .table(
            TableSchema::builder("users")
                .column("id", ColumnType::Uuid)
                .column("email", ColumnType::Text),
        )
        .build();

    let v2 = SchemaBuilder::new()
        .table(
            TableSchema::builder("users")
                .column("id", ColumnType::Uuid)
                .column("email_address", ColumnType::Text), // renamed column
        )
        .build();

    let v1_hash = SchemaHash::compute(&v1);
    let v2_hash = SchemaHash::compute(&v2);

    // Create explicit rename lens
    let mut transform = LensTransform::new();
    transform.push(
        LensOp::RenameColumn {
            table: "users".to_string(),
            old_name: "email".to_string(),
            new_name: "email_address".to_string(),
        },
        false,
    );
    let lens = Lens::new(v1_hash, v2_hash, transform);

    let mut ctx = SchemaContext::new(v2.clone(), "dev", "main");
    ctx.add_live_schema(v1.clone(), lens);

    // Build query with filter on the renamed column
    let query = QueryBuilder::new("users").build();

    // Compile with schema context
    let graph = QueryGraph::compile_with_schema_context(&query, &v2, None, &ctx);
    let graph = graph.expect("Query graph compilation should succeed with schema context");

    // Should have index scan nodes for both branches
    // Note: the exact number depends on how many disjuncts and branches
    assert!(!graph.index_scan_nodes.is_empty());
}

#[test]
fn schema_manager_to_query_manager_integration() {
    let v1 = SchemaBuilder::new()
        .table(
            TableSchema::builder("users")
                .column("id", ColumnType::Uuid)
                .column("name", ColumnType::Text),
        )
        .build();

    let v2 = SchemaBuilder::new()
        .table(
            TableSchema::builder("users")
                .column("id", ColumnType::Uuid)
                .column("name", ColumnType::Text)
                .nullable_column("email", ColumnType::Text),
        )
        .build();

    // Create schema manager (which manages SchemaContext internally)
    let mut schema_mgr =
        SchemaManager::new(SyncManager::new(), v2.clone(), test_app_id(), "dev", "main").unwrap();
    schema_mgr.add_live_schema(v1.clone()).unwrap();

    // Verify SchemaManager's QueryManager is properly configured
    let qm = schema_mgr.query_manager();
    assert!(qm.schema_context().is_initialized());
    assert_eq!(qm.all_query_branches().len(), 2);
}

#[test]
fn query_settled_no_tier_immediate() {
    let schema = SchemaBuilder::new()
        .table(
            TableSchema::builder("items")
                .column("id", ColumnType::Uuid)
                .column("name", ColumnType::Text),
        )
        .build();

    let mut manager = SchemaManager::new(
        SyncManager::new(),
        schema.clone(),
        test_app_id(),
        "dev",
        "main",
    )
    .unwrap();
    let mut storage = MemoryStorage::new();

    // Insert a row
    let row_id = ObjectId::new();
    let values = HashMap::from([
        ("id".to_string(), Value::Uuid(row_id)),
        ("name".to_string(), Value::Text("hello".into())),
    ]);
    manager
        .insert(&mut storage, "items", values, None, None)
        .unwrap();
    manager.process(&mut storage);

    // Subscribe with settled_tier=None
    let query = QueryBuilder::new("items").build();
    let sub_id = manager
        .query_manager_mut()
        .subscribe_with_session(query, None, None)
        .unwrap();
    manager.process(&mut storage);

    // Should get immediate callback on first process
    let updates = manager.query_manager_mut().take_updates();
    assert!(
        !updates.is_empty(),
        "settled_tier=None should deliver immediately"
    );
    let matching: Vec<_> = updates
        .iter()
        .filter(|u| u.subscription_id == sub_id)
        .collect();
    assert_eq!(matching.len(), 1);
    assert_eq!(matching[0].delta.added.len(), 1);
}

#[test]
fn query_one_shot_settled_tier() {
    let schema = SchemaBuilder::new()
        .table(
            TableSchema::builder("items")
                .column("id", ColumnType::Uuid)
                .column("name", ColumnType::Text),
        )
        .build();

    let mut client = SchemaManager::new(
        SyncManager::new(),
        schema.clone(),
        test_app_id(),
        "dev",
        "main",
    )
    .unwrap();
    let mut storage = MemoryStorage::new();

    // Insert a row first
    let row_id = ObjectId::new();
    let values = HashMap::from([
        ("id".to_string(), Value::Uuid(row_id)),
        ("name".to_string(), Value::Text("one-shot".into())),
    ]);
    client
        .insert(&mut storage, "items", values, None, None)
        .unwrap();
    client.process(&mut storage);

    // Subscribe with settled_tier=Local (simulating one-shot behavior)
    let query = QueryBuilder::new("items")
        .branch(client.branch_name().to_string())
        .build();
    let sub_id = client
        .query_manager_mut()
        .subscribe_with_sync(query, None, Some(DurabilityTier::Local))
        .unwrap();
    client.process(&mut storage);

    // First process: local pending row is already visible because one-shot
    // queries use immediate local updates by default.
    let updates = client.query_manager_mut().take_updates();
    let matching: Vec<_> = updates
        .iter()
        .filter(|u| u.subscription_id == sub_id)
        .collect();
    assert!(
        !matching.is_empty(),
        "One-shot should resolve on first local settle"
    );
    let total_added: usize = matching.iter().map(|u| u.delta.added.len()).sum();
    assert_eq!(total_added, 1, "Should contain the one local row");

    let peer = PeerId::new();
    let visible_row = storage
        .scan_visible_region("items", client.branch_name().as_str())
        .unwrap()
        .into_iter()
        .next()
        .expect("one visible row");
    client
        .query_manager_mut()
        .sync_manager_mut()
        .push_inbox(InboxEntry {
            source: Source::Client(peer),
            payload: SyncPayload::BatchFate {
                fate: crate::batch_fate::BatchFate::DurableDirect {
                    batch_id: visible_row.batch_id,
                    confirmed_tier: DurabilityTier::Local,
                },
            },
        });
    client.process(&mut storage);

    // Local durability arriving later should not emit another visible
    // delta because the row is already present.
    let updates = client.query_manager_mut().take_updates();
    let matching: Vec<_> = updates
        .iter()
        .filter(|u| u.subscription_id == sub_id)
        .collect();
    assert!(
        matching.is_empty() || matching.iter().all(|u| u.delta.is_empty()),
        "Local promotion should not emit a second visible delta"
    );
}

#[test]
fn query_one_shot_settled_tier_empty_results() {
    let schema = SchemaBuilder::new()
        .table(
            TableSchema::builder("items")
                .column("id", ColumnType::Uuid)
                .column("name", ColumnType::Text),
        )
        .build();

    let mut client = SchemaManager::new(
        SyncManager::new(),
        schema.clone(),
        test_app_id(),
        "dev",
        "main",
    )
    .unwrap();
    let mut storage = MemoryStorage::new();

    // No rows inserted. Subscribe with settled_tier=Local.
    let query = QueryBuilder::new("items")
        .branch(client.branch_name().to_string())
        .build();
    let sub_id = client
        .query_manager_mut()
        .subscribe_with_sync(query, None, Some(DurabilityTier::Local))
        .unwrap();
    client.process(&mut storage);

    // With no upstream server and no rows, the empty snapshot resolves immediately.
    let updates = client.query_manager_mut().take_updates();
    let matching: Vec<_> = updates
        .iter()
        .filter(|u| u.subscription_id == sub_id)
        .collect();
    assert!(
        !matching.is_empty(),
        "Should deliver empty snapshot immediately for a local empty result"
    );
    assert!(
        matching.iter().all(|u| u.delta.is_empty()),
        "Expected empty delta for empty snapshot"
    );
}

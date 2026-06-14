use super::*;





#[test]
fn rc_transactional_update_can_modify_row_inserted_earlier_in_same_batch() {
    // alice local runtime
    //   insert one staged transactional row
    //   update that same row again before sealing
    //   latest staged member should reflect the update
    let mut core = create_test_runtime();
    let batch_id = BatchId::new();
    let write_context = WriteContext {
        batch_mode: Some(crate::batch_fate::BatchMode::Transactional),
        batch_id: Some(batch_id),
        ..Default::default()
    };

    let inserted_user_id = ObjectId::new();
    let ((row_id, _), _) = core
        .insert(
            "users",
            user_insert_values(inserted_user_id, "Alice"),
            Some(&write_context),
        )
        .expect("transactional insert should stage locally");

    core.update(
        row_id,
        vec![("name".to_string(), Value::Text("Bob".to_string()))],
        Some(&write_context),
    )
    .expect("transactional update should reuse the row staged earlier in the same batch");

    let history_rows = core
        .storage()
        .scan_history_row_batches("users", row_id)
        .unwrap();
    let latest_staged = history_rows
        .iter()
        .filter(|row| {
            row.batch_id == batch_id
                && matches!(row.state, crate::row_histories::RowState::StagingPending)
        })
        .max_by_key(|row| (row.updated_at, row.batch_id()))
        .expect("transaction should keep one staged member for the row");
    assert!(
        latest_staged.parents.is_empty(),
        "rewriting a row inserted earlier in the same batch should keep the insert's empty parent frontier"
    );
    let values = decode_row(
        &test_schema()[&TableName::new("users")].columns,
        &latest_staged.data,
    )
    .expect("latest staged row should decode");
    assert_eq!(values, user_row_values(inserted_user_id, "Bob"));
}

#[test]
fn rc_transactional_same_row_same_batch_collapses_to_one_live_staged_member() {
    // todo row visible on main
    //   tx update #1 changes title
    //   tx update #2 changes done
    //   latest staged member should compose both changes
    //   only one live staged member should remain for that row/batch
    let mut core = create_runtime_with_schema(defaulted_todos_schema(), "tx-write-set-collapse");
    let ((row_id, _), _) = core
        .insert(
            "todos",
            HashMap::from([("title".to_string(), Value::Text("Draft".to_string()))]),
            None,
        )
        .expect("seed visible todo");
    let base_visible = core
        .storage()
        .scan_history_row_batches("todos", row_id)
        .unwrap()
        .into_iter()
        .find(|row| matches!(row.state, crate::row_histories::RowState::VisibleDirect))
        .expect("seeded todo should be visible before the transaction");

    let batch_id = BatchId::new();
    let write_context = WriteContext {
        batch_mode: Some(crate::batch_fate::BatchMode::Transactional),
        batch_id: Some(batch_id),
        ..Default::default()
    };

    core.update(
        row_id,
        vec![("title".to_string(), Value::Text("Renamed".to_string()))],
        Some(&write_context),
    )
    .expect("first transactional update should stage");
    core.update(
        row_id,
        vec![("done".to_string(), Value::Boolean(true))],
        Some(&write_context),
    )
    .expect("second transactional update should compose on the same staged row");

    let history_rows = core
        .storage()
        .scan_history_row_batches("todos", row_id)
        .unwrap();
    let transactional_rows: Vec<_> = history_rows
        .iter()
        .filter(|row| row.batch_id == batch_id)
        .collect();
    assert_eq!(transactional_rows.len(), 1);
    assert!(
        transactional_rows
            .iter()
            .all(|row| { row.parents.as_slice() == [base_visible.batch_id()] })
    );
    let live_staged_rows: Vec<_> = history_rows
        .iter()
        .filter(|row| {
            row.batch_id == batch_id
                && matches!(row.state, crate::row_histories::RowState::StagingPending)
        })
        .collect();
    assert_eq!(
        live_staged_rows.len(),
        1,
        "same-row transactional rewrites should keep one live staged member"
    );
    assert_eq!(
        live_staged_rows[0].parents.as_slice(),
        [base_visible.batch_id()]
    );
    let values = decode_row(
        &defaulted_todos_schema()[&TableName::new("todos")].columns,
        &live_staged_rows[0].data,
    )
    .expect("collapsed staged todo should decode");
    assert_eq!(
        values,
        vec![Value::Text("Renamed".to_string()), Value::Boolean(true),]
    );
}














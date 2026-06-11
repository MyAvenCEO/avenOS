//! Repro: deletes never sync across devices, even after a full reset/reconnect.
//!
//! On reconnect the engine announces its ENTIRE frontier (`SyncManager::build_sync_dag`
//! → `dag.heads()`) and the peer pulls whatever it's missing via `frontier_diff`. So a
//! delete that never propagates *even on a full catch-up* can only mean one thing: the
//! delete batch is absent from the frontier the engine computes.
//!
//! This test reconstructs `build_sync_dag` verbatim (scan every row locator, then every
//! history batch for that object) and asserts a peer that already holds the create is
//! *owed* the delete batch. Runs as a `tests/` integration target so it compiles against
//! the public API, independent of the (currently broken) inline `#[cfg(test)]` harness.

use std::collections::HashMap;

use aven_db::frontier::{frontier_diff, FrontierDag};
use aven_db::object::ObjectId;
use aven_db::query_manager::types::{ColumnType, Schema, SchemaBuilder, TableSchema, Value};
use aven_db::row_histories::BatchId;
use aven_db::schema_manager::{AppId, SchemaManager};
use aven_db::storage::{MemoryStorage, Storage};
use aven_db::sync_manager::SyncManager;

/// Verbatim reconstruction of `SyncManager::build_sync_dag`: every row locator × every
/// history batch for that object → a `FrontierDag`. `dag.heads()` is exactly what a peer
/// is told it can pull.
fn sync_frontier(io: &MemoryStorage) -> (FrontierDag, Vec<BatchId>) {
    let mut dag = FrontierDag::new();
    for (oid, locator) in io.scan_row_locators().expect("scan_row_locators") {
        let table = locator.table.to_string();
        if table == "humans" || table == "signers" {
            continue;
        }
        if let Ok(batches) = io.scan_history_row_batches(&table, oid) {
            for row in batches {
                dag.insert(row.batch_id(), row.parents.to_vec());
            }
        }
    }
    let heads = dag.heads();
    (dag, heads)
}

fn todos_schema() -> Schema {
    SchemaBuilder::new()
        .table(
            TableSchema::builder("todos")
                .column("id", ColumnType::Uuid)
                .column("title", ColumnType::Text),
        )
        .build()
}

#[test]
fn delete_batch_is_in_the_announced_frontier() {
    let mut io = MemoryStorage::new();
    let mut a = SchemaManager::new(
        SyncManager::new(),
        todos_schema(),
        AppId::from_name("delete-repro"),
        "dev",
        "main",
    )
    .expect("schema manager");

    // --- create ---
    let mut vals = HashMap::new();
    vals.insert("id".to_string(), Value::Uuid(ObjectId::new()));
    vals.insert("title".to_string(), Value::Text("DELME".into()));
    let ins = a.insert(&mut io, "todos", vals, None, None).expect("insert");
    let row_id = ins.row_id;
    a.process(&mut io);

    let (_dag_c, heads_after_create) = sync_frontier(&io);
    assert!(
        !heads_after_create.is_empty(),
        "create must produce a frontier head"
    );
    // Simulate peer B: it synced the create and converged on these heads.
    let b_heads = heads_after_create.clone();

    // --- delete ---
    let del = a.delete(&mut io, row_id, None).expect("delete");
    a.process(&mut io);

    // (1) Object must still be scannable (soft-delete must not drop the locator).
    let locators = io.scan_row_locators().unwrap();
    assert!(
        locators.iter().any(|(oid, _)| *oid == row_id),
        "BUG: soft-deleted object dropped from scan_row_locators → object excluded from sync DAG"
    );

    // (2) Delete batch must be in the object's history.
    let hist = io.scan_history_row_batches("todos", row_id).unwrap();
    assert!(
        hist.iter().any(|r| r.batch_id() == del.batch_id),
        "BUG: delete batch missing from scan_history_row_batches → never reaches the frontier"
    );

    // (3) Frontier must advance to the delete batch.
    let (dag_d, heads_after_delete) = sync_frontier(&io);
    assert_ne!(
        heads_after_delete, heads_after_create,
        "BUG: frontier did not advance on delete → peers are never told to re-pull"
    );

    // (4) Decisive: a peer holding the create must be OWED the delete batch.
    let diff = frontier_diff(&dag_d, &b_heads);
    assert!(
        diff.contains(&del.batch_id),
        "BUG: peer with the create is NOT owed the delete batch \
         (owed={:?}, delete={:?}) → delete never syncs even on full reconnect",
        diff,
        del.batch_id
    );
}

/// Receive side: a peer that holds the create receives the delete batch over the inbox.
/// Does it actually STORE the delete (so its own frontier advances and it re-forwards)?
#[test]
fn peer_receiving_the_delete_actually_stores_it() {
    use aven_db::capability::AllowAllResolver;
    use aven_db::metadata::MetadataKey;
    use aven_db::sync_manager::types::RowMetadata;
    use aven_db::sync_manager::{InboxEntry, PeerId, Source, SyncPayload};

    // --- Engine A: create + delete; capture both batches and the row metadata. ---
    let mut io_a = MemoryStorage::new();
    let mut a = SchemaManager::new(
        SyncManager::new(),
        todos_schema(),
        AppId::from_name("a"),
        "dev",
        "main",
    )
    .unwrap();
    let mut vals = HashMap::new();
    vals.insert("id".to_string(), Value::Uuid(ObjectId::new()));
    vals.insert("title".to_string(), Value::Text("DELME".into()));
    let ins = a.insert(&mut io_a, "todos", vals, None, None).unwrap();
    let row_id = ins.row_id;
    a.process(&mut io_a);
    let del = a.delete(&mut io_a, row_id, None).unwrap();
    a.process(&mut io_a);

    // Metadata mirrors `metadata_from_row_locator` (table + origin schema hash).
    let (_oid, locator) = io_a
        .scan_row_locators()
        .unwrap()
        .into_iter()
        .find(|(o, _)| *o == row_id)
        .unwrap();
    let mut meta_map = HashMap::new();
    meta_map.insert(
        MetadataKey::Table.as_str().to_string(),
        locator.table.to_string(),
    );
    if let Some(h) = locator.origin_schema_hash {
        meta_map.insert(
            MetadataKey::OriginSchemaHash.as_str().to_string(),
            h.to_string(),
        );
    }
    let meta = RowMetadata {
        id: row_id,
        metadata: meta_map,
    };

    let hist_a = io_a.scan_history_row_batches("todos", row_id).unwrap();
    let delete_batch = hist_a
        .iter()
        .find(|r| r.batch_id() == del.batch_id)
        .cloned()
        .expect("delete batch present on A");
    let create_batch = hist_a
        .iter()
        .find(|r| r.batch_id() != del.batch_id)
        .cloned()
        .expect("create batch present on A");
    assert!(delete_batch.is_deleted, "sanity: delete batch is_deleted");

    // --- Engine B: fresh peer with the same schema. ---
    let mut io_b = MemoryStorage::new();
    let mut b = SchemaManager::new(
        SyncManager::new(),
        todos_schema(),
        AppId::from_name("b"),
        "dev",
        "main",
    )
    .unwrap();
    // B is a fresh peer: `SyncManager::new()` is fail-closed (DenyAllResolver, M4
    // hardening), so it would reject every inbound batch at the `verify_on_apply`
    // gate. Opt into AllowAll so this test exercises the receive/store path itself
    // rather than the capability gate.
    b.query_manager_mut()
        .sync_manager_mut()
        .set_resolver(std::sync::Arc::new(AllowAllResolver));
    let peer_a = PeerId::new();
    b.query_manager_mut()
        .sync_manager_mut()
        .add_client_with_storage(&io_b, peer_a);

    // B receives the CREATE.
    b.query_manager_mut()
        .sync_manager_mut()
        .push_inbox(InboxEntry {
            source: Source::Client(peer_a),
            payload: SyncPayload::RowBatchCreated {
                metadata: Some(meta.clone()),
                row: create_batch.clone(),
            },
        });
    b.process(&mut io_b);
    let hist_b1 = io_b.scan_history_row_batches("todos", row_id).unwrap();
    assert!(
        hist_b1.iter().any(|r| r.batch_id() == create_batch.batch_id()),
        "precondition: B must store the create batch it received"
    );

    // B receives the DELETE (shipped as RowBatchNeeded, like ship_frontier_diff).
    b.query_manager_mut()
        .sync_manager_mut()
        .push_inbox(InboxEntry {
            source: Source::Client(peer_a),
            payload: SyncPayload::RowBatchNeeded {
                metadata: Some(meta.clone()),
                row: delete_batch.clone(),
            },
        });
    b.process(&mut io_b);

    // DECISIVE: did B actually store the delete batch?
    let hist_b2 = io_b.scan_history_row_batches("todos", row_id).unwrap();
    assert!(
        hist_b2.iter().any(|r| r.batch_id() == del.batch_id),
        "BUG: peer B received the delete batch but did NOT store it → delete never syncs"
    );

    // And B's frontier must now be the delete batch (so B re-forwards it onward).
    let (_dag, heads_b) = sync_frontier(&io_b);
    assert!(
        heads_b.contains(&del.batch_id),
        "BUG: B's frontier head is not the delete batch after receiving it (heads={:?})",
        heads_b
    );
}

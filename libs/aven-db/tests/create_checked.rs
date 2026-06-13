//! The universal schema-checked CRUD surface (board 0020).
//!
//! `create_checked` is THE row-write path — name-keyed and resolved against the
//! live schema, so a manifest column-order change can never silently corrupt a
//! write (the positional `create(Vec<Value>)` it replaced zipped by index; that's
//! how the brain's embedding vector once landed in a text column without a sound).

use std::collections::HashMap;
use std::sync::Arc;

use aven_db::{
    AppContext, AppId, AvenDbClient, ColumnType, NullSyncTransport, ObjectId, QueryBuilder,
    Schema, SchemaBuilder, TableSchema, Value,
};

fn test_schema() -> Schema {
    SchemaBuilder::new()
        .table(
            TableSchema::builder("notes")
                .column("owner", ColumnType::Uuid)
                .column("title", ColumnType::Text)
                .nullable_column("body", ColumnType::Text),
        )
        .build()
}

async fn client(app: &str) -> AvenDbClient {
    let data_dir = std::env::temp_dir().join(format!("aven-db-create-checked-{app}"));
    let _ = std::fs::create_dir_all(&data_dir);
    let context = AppContext {
        app_id: AppId::from_name(app),
        client_id: None,
        schema: test_schema(),
        data_dir,
        live_schemas: Vec::new(),
    };
    AvenDbClient::connect_headless_in_memory(context, Arc::new(NullSyncTransport))
        .await
        .expect("in-memory client")
}

/// Board 0026 (M1): the O(1) `frontier_epoch()` advances on every committed batch and is stable
/// between reads with no write — the freshness token aven-brain's decrypt-once read cache keys
/// on (cost is a plain atomic load, independent of row count). Local writes are proven here;
/// SYNCED peer applies share the same `apply_encoded_row_mutation` sink (so they bump it too) and
/// are exercised end-to-end by aven-brain's `mirror_converges_after_local_and_synced_writes`.
#[tokio::test]
async fn frontier_epoch_advances_on_commit_and_is_stable() {
    let c = client("frontier-epoch").await;
    let e0 = c.frontier_epoch();

    let write = |title: &'static str| {
        c.create_checked(
            "notes",
            HashMap::from([
                ("owner".to_string(), Value::Uuid(ObjectId::from_uuid(uuid::Uuid::new_v4()))),
                ("title".to_string(), Value::Text(title.into())),
            ]),
        )
    };

    write("one").await.expect("write 1");
    let e1 = c.frontier_epoch();
    assert!(e1 > e0, "a committed batch advances the epoch ({e0} -> {e1})");

    // Stable between reads with no write in between.
    assert_eq!(c.frontier_epoch(), e1, "epoch is stable when nothing is committed");

    write("two").await.expect("write 2");
    let e2 = c.frontier_epoch();
    assert!(e2 > e1, "the next committed batch advances it again ({e1} -> {e2})");
}

/// Board 0027 (S1): the frontier delta feed returns ONLY the delta. After N seeded rows, a cursor
/// snapshot, then ONE write, `changes_since(cursor)` yields exactly that one changed row id — not
/// the whole table — and advances the cursor. This is the O(delta) reconciliation any consumer
/// (brain cache, UI store, remote peer) keys on.
#[tokio::test]
async fn changes_since_returns_only_the_delta() {
    let c = client("changes-since").await;
    let mk = |title: &'static str| {
        c.create_checked(
            "notes",
            HashMap::from([
                ("owner".to_string(), Value::Uuid(ObjectId::from_uuid(uuid::Uuid::new_v4()))),
                ("title".to_string(), Value::Text(title.into())),
            ]),
        )
    };

    // Seed N rows.
    const N: usize = 25;
    for _ in 0..N {
        mk("seed").await.expect("seed");
    }

    // Cursor after the seed — "where I've caught up to".
    let cursor = c.frontier_epoch();

    // ONE more write.
    let new_id = mk("the one change").await.expect("delta write");

    // The feed returns exactly that one row, not the N before it.
    let (next, changed) = c.changes_since(cursor);
    let delta = match changed {
        aven_db::frontier_epoch::Changes::Delta(ids) => ids,
        aven_db::frontier_epoch::Changes::Resync => panic!("recent cursor must yield a delta, not resync"),
    };
    assert_eq!(delta.len(), 1, "changes_since returns ONLY the delta, not the table: {delta:?}");
    assert_eq!(delta[0], new_id, "the delta is the row that changed");
    assert!(next > cursor, "the cursor advances past the delta ({cursor} -> {next})");

    // Caught up: nothing new since the returned cursor.
    let (_, none) = c.changes_since(next);
    assert!(
        matches!(none, aven_db::frontier_epoch::Changes::Delta(ref ids) if ids.is_empty()),
        "no changes since the just-returned cursor: {none:?}"
    );
}

#[tokio::test]
async fn unknown_column_is_rejected() {
    let c = client("unknown-col").await;
    let err = c
        .create_checked(
            "notes",
            HashMap::from([
                ("owner".to_string(), Value::Uuid(ObjectId::from_uuid(uuid::Uuid::new_v4()))),
                ("title".to_string(), Value::Text("t".into())),
                // typo / schema drift — must error, never be silently dropped
                ("titel".to_string(), Value::Text("oops".into())),
            ]),
        )
        .await
        .expect_err("unknown column must be rejected");
    assert!(
        format!("{err:?}").contains("unknown column"),
        "error names the unknown column: {err:?}"
    );
}

#[tokio::test]
async fn missing_required_column_is_rejected() {
    let c = client("missing-required").await;
    let err = c
        .create_checked(
            "notes",
            HashMap::from([("title".to_string(), Value::Text("no owner".into()))]),
        )
        .await
        .expect_err("missing required column must be rejected");
    assert!(
        format!("{err:?}").contains("missing required column"),
        "error names the missing column: {err:?}"
    );
}

#[tokio::test]
async fn missing_nullable_is_null_filled_and_row_reads_back() {
    let c = client("null-fill").await;
    let owner = uuid::Uuid::new_v4();
    let id = c
        .create_checked(
            "notes",
            HashMap::from([
                ("owner".to_string(), Value::Uuid(ObjectId::from_uuid(owner))),
                ("title".to_string(), Value::Text("hello".into())),
                // `body` omitted — nullable, so the surface fills Null
            ]),
        )
        .await
        .expect("create succeeds");
    let rows = c
        .query(QueryBuilder::new("notes").build(), None)
        .await
        .expect("query");
    let (_, vals) = rows.into_iter().find(|(oid, _)| *oid == id).expect("row exists");
    // Column order comes from the schema, not the caller: owner, title, body.
    assert_eq!(vals[1], Value::Text("hello".into()));
    assert_eq!(vals[2], Value::Null);
}

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

//! Board 0037 — ownership is an aven-db core primitive.
//!
//! On a real avenOS peer EVERY value is owned by a SAFE: the installed `OwnerBinder` IS the peer's
//! identity (its device key), so when one is present the deep author funnel requires every authored
//! value to carry its signed owner-binding `(value_id → owner)` in the immutable header — a CREATE
//! mints it from `WriteContext.owner` (REQUIRED; a create with no owner FAILS — there is no path to
//! an ownerless value), and an UPDATE/DELETE inherits the value's immutable binding verbatim. A
//! binder-less engine has no SAFE (generic/test store) and authors plain rows. Crypto-free here on
//! purpose — the real `mint_owner_binding` is exercised by the app tests; we assert only the
//! engine's stamp-or-fail and inherit behaviour.
use super::*;
use crate::query_manager::session::WriteContext;

/// A test binder that stamps a deterministic marker under the real `OWNER_BINDING_META_KEY`.
struct StampingBinder;

impl crate::capability::OwnerBinder for StampingBinder {
    fn bind_row(&self, row_id: ObjectId, owner: uuid::Uuid) -> Option<(String, String)> {
        Some((
            crate::capability::OWNER_BINDING_META_KEY.to_string(),
            format!("bound:{}:{}", row_id.uuid(), owner),
        ))
    }
}

/// A table with an updatable column. Ownership is NOT a column or a flag — it is the binding minted
/// from the owner; the engine treats every value the same when a binder (identity) is present.
fn schema() -> Schema {
    SchemaBuilder::new()
        .table(
            TableSchema::builder("widgets")
                .column("id", ColumnType::Uuid)
                .nullable_column("label", ColumnType::Text),
        )
        .build()
}

fn owned_write(owner: uuid::Uuid) -> WriteContext {
    WriteContext {
        owner: Some(owner),
        ..Default::default()
    }
}

fn latest_binding(core: &TestCore, row_id: ObjectId) -> Option<String> {
    core.storage()
        .scan_history_row_batches("widgets", row_id)
        .unwrap()
        .into_iter()
        .max_by_key(|r| (r.updated_at, r.batch_id()))
        .and_then(|r| {
            r.metadata
                .get(crate::capability::OWNER_BINDING_META_KEY)
                .cloned()
        })
}

#[test]
fn create_mints_owner_binding_from_the_owner() {
    let mut core = create_runtime_with_schema(schema(), "owner-binder-mint");
    core.set_owner_binder(Arc::new(StampingBinder));

    let owner = *ObjectId::new().uuid();
    let ((row_id, _), _) = core
        .insert(
            "widgets",
            HashMap::from([("id".to_string(), Value::Uuid(ObjectId::new()))]),
            Some(&owned_write(owner)),
        )
        .unwrap();
    core.immediate_tick();

    assert_eq!(
        latest_binding(&core, row_id),
        Some(format!("bound:{}:{}", row_id.uuid(), owner)),
        "a create mints the immutable owner-binding from WriteContext.owner"
    );
}

#[test]
fn create_without_an_owner_fails_no_ownerless_value() {
    // With an identity (binder) installed, a create MUST carry an owner. No owner = no value:
    // the write fails, never producing an ownerless value. This is the no-iff enforcement.
    let mut core = create_runtime_with_schema(schema(), "owner-binder-no-owner");
    core.set_owner_binder(Arc::new(StampingBinder));

    let err = core
        .insert(
            "widgets",
            HashMap::from([("id".to_string(), Value::Uuid(ObjectId::new()))]),
            None, // no WriteContext.owner
        )
        .expect_err("a create with no owner must fail — every value is owned by a SAFE");
    assert!(
        err.to_string().contains("owner-binding required"),
        "expected the ownerless-create failure, got: {err}"
    );
}

#[test]
fn update_inherits_the_immutable_binding() {
    // The owner-binding is the value's identity: an update (no owner on the context) inherits the
    // create-time binding verbatim — never re-minted, never relabeled.
    let mut core = create_runtime_with_schema(schema(), "owner-binder-update");
    core.set_owner_binder(Arc::new(StampingBinder));

    let owner = *ObjectId::new().uuid();
    let ((row_id, _), _) = core
        .insert(
            "widgets",
            HashMap::from([
                ("id".to_string(), Value::Uuid(ObjectId::new())),
                ("label".to_string(), Value::Text("before".to_string())),
            ]),
            Some(&owned_write(owner)),
        )
        .unwrap();
    let created = format!("bound:{}:{}", row_id.uuid(), owner);

    core.update(
        row_id,
        vec![("label".to_string(), Value::Text("after".to_string()))],
        None,
    )
    .unwrap();
    core.immediate_tick();

    assert_eq!(
        latest_binding(&core, row_id),
        Some(created),
        "the update inherits the immutable create-time owner-binding"
    );
}

#[test]
fn binderless_engine_authors_plain_values() {
    // A binder-less engine has no SAFE/identity (the generic/test store): it authors plain rows
    // with no owner-binding — the only configuration without owned enforcement.
    let mut core = create_runtime_with_schema(schema(), "owner-binder-generic");

    let ((row_id, _), _) = core
        .insert(
            "widgets",
            HashMap::from([("id".to_string(), Value::Uuid(ObjectId::new()))]),
            None,
        )
        .expect("a binder-less generic engine authors plain rows");
    core.immediate_tick();

    assert_eq!(
        latest_binding(&core, row_id),
        None,
        "no identity ⇒ no owner-binding"
    );
}

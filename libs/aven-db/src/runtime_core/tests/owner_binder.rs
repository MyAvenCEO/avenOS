//! Board 0037 — the owner-binding invariant at the deep author funnel.
//!
//! Ownership is a **per-peer authoring invariant**, not a sync-layer policy: on EVERY peer —
//! local, headless, or syncing — an owner-scoped row can only be authored if it carries its signed
//! owner-binding in the immutable header. Owner-scoping is the declarative `owner_scoped` flag; the
//! owning SAFE travels in `WriteContext.owner` (never a data column) and the funnel mints the
//! binding from it. No `require` switch, no local carve-out. Crypto-free here on purpose — the real
//! `mint_owner_binding` is exercised by the app tests; we assert only the engine's stamp-or-fail.
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

/// An owner-scoped table — declared by the flag, no `owner` column (ownership is the binding).
fn owner_scoped_schema() -> Schema {
    SchemaBuilder::new()
        .table(TableSchema::builder("widgets").column("id", ColumnType::Uuid).owner_scoped())
        .build()
}

/// Owner-scoped with an updatable column, to exercise the update carry-forward path.
fn owner_scoped_labelled_schema() -> Schema {
    SchemaBuilder::new()
        .table(
            TableSchema::builder("widgets")
                .column("id", ColumnType::Uuid)
                .nullable_column("label", ColumnType::Text)
                .owner_scoped(),
        )
        .build()
}

/// A non-owner-scoped table (no flag → the binder is never invoked, write is not gated).
fn unowned_schema() -> Schema {
    SchemaBuilder::new()
        .table(
            TableSchema::builder("notes")
                .column("id", ColumnType::Uuid)
                .column("body", ColumnType::Text),
        )
        .build()
}

fn owned_write(owner: uuid::Uuid) -> WriteContext {
    WriteContext {
        owner: Some(owner),
        ..Default::default()
    }
}

#[test]
fn owner_scoped_write_auto_stamps_binding() {
    let mut core = create_runtime_with_schema(owner_scoped_schema(), "owner-binder-stamp");
    core.set_owner_binder(Arc::new(StampingBinder));

    let owner = *ObjectId::new().uuid();
    let ((row_id, _), _) = core
        .insert(
            "widgets",
            HashMap::from([("id".to_string(), Value::Uuid(ObjectId::new()))]),
            // The owner travels on the write context — NOT as a data column.
            Some(&owned_write(owner)),
        )
        .unwrap();
    core.immediate_tick();

    let history = core
        .storage()
        .scan_history_row_batches("widgets", row_id)
        .unwrap();
    assert_eq!(history.len(), 1, "exactly one history batch for the insert");
    let binding = history[0]
        .metadata
        .get(crate::capability::OWNER_BINDING_META_KEY);
    assert!(
        binding.is_some(),
        "owner-scoped write must auto-stamp the owner-binding from WriteContext.owner"
    );
    assert_eq!(
        binding.unwrap(),
        &format!("bound:{}:{}", row_id.uuid(), owner),
        "the stamped binding must carry the funnel-minted (row_id, owner)"
    );
}

#[test]
fn owner_scoped_write_without_binder_fails_closed() {
    // No binder installed → this peer cannot author owned data at all (unconditional, every peer).
    let mut core = create_runtime_with_schema(owner_scoped_schema(), "owner-binder-no-binder");

    let err = core
        .insert(
            "widgets",
            HashMap::from([("id".to_string(), Value::Uuid(ObjectId::new()))]),
            Some(&owned_write(*ObjectId::new().uuid())),
        )
        .expect_err("an owner-scoped write with no binder must refuse on every peer");
    assert!(
        err.to_string().contains("owner-binding required"),
        "expected fail-closed owner-binding-required, got: {err}"
    );

    // The gate is owner-scoped-specific: a non-owner-scoped write still succeeds with no binder.
    let mut unowned = create_runtime_with_schema(unowned_schema(), "owner-binder-unowned");
    unowned
        .insert(
            "notes",
            HashMap::from([
                ("id".to_string(), Value::Uuid(ObjectId::new())),
                ("body".to_string(), Value::Text("hello".to_string())),
            ]),
            None,
        )
        .expect("a non-owner-scoped write is never gated by the owner-binding invariant");
}

#[test]
fn owner_scoped_update_carries_binding_forward() {
    // The owner-binding is immutable: an update (no owner on the write context) must carry the
    // create-time binding forward verbatim, not fail and not re-mint a different one.
    let mut core = create_runtime_with_schema(owner_scoped_labelled_schema(), "owner-binder-update");
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

    // Update with NO owner on the context — carry-forward must supply the binding.
    core.update(
        row_id,
        vec![("label".to_string(), Value::Text("after".to_string()))],
        None,
    )
    .unwrap();
    core.immediate_tick();

    let history = core
        .storage()
        .scan_history_row_batches("widgets", row_id)
        .unwrap();
    let latest = history
        .iter()
        .max_by_key(|r| (r.updated_at, r.batch_id()))
        .unwrap();
    assert_eq!(
        latest.metadata.get(crate::capability::OWNER_BINDING_META_KEY),
        Some(&created),
        "the update must carry the immutable create-time owner-binding forward"
    );
}

#[test]
fn ownerless_owner_scoped_write_fails_closed() {
    // Every owned row MUST be rooted in a SAFE — an owner-scoped create with no owner on the write
    // context (and no prior binding to carry forward) is refused even with a binder installed.
    let mut core = create_runtime_with_schema(owner_scoped_schema(), "owner-binder-ownerless");
    core.set_owner_binder(Arc::new(StampingBinder));

    let err = core
        .insert(
            "widgets",
            HashMap::from([("id".to_string(), Value::Uuid(ObjectId::new()))]),
            None, // no WriteContext.owner
        )
        .expect_err("an ownerless owner-scoped create must refuse — every owned row belongs to a SAFE");
    assert!(
        err.to_string().contains("owner-binding required"),
        "expected fail-closed owner-binding-required, got: {err}"
    );
}

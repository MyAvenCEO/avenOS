//! Board 0037 — the owner-binding invariant at the deep author funnel.
//!
//! Ownership is a **per-peer authoring invariant**, not a sync-layer policy: on EVERY peer —
//! local, headless, or syncing — an owner-scoped row can only be authored if it is rooted in a
//! SAFE and carries its signed owner-binding. No `require` switch, no local carve-out. These
//! tests pin that: an injected [`OwnerBinder`] auto-stamps the binding for every owner-scoped
//! write (so no call-site can forget it), and any owner-scoped write that can't be bound — no
//! binder, or no owner — REFUSES rather than authoring an unbound owned row. Crypto-free on
//! purpose: the real `mint_owner_binding` is exercised by the app tests; here we assert only the
//! engine's stamp-or-fail behaviour.
use super::*;

/// A test binder that stamps a deterministic marker under the real `OWNER_BINDING_META_KEY`.
/// Stage 1 only needs to prove the binding lands and carries the funnel-supplied `(row_id, owner)`.
struct StampingBinder;

impl crate::capability::OwnerBinder for StampingBinder {
    fn bind_row(&self, row_id: ObjectId, owner: uuid::Uuid) -> Option<(String, String)> {
        Some((
            crate::capability::OWNER_BINDING_META_KEY.to_string(),
            format!("bound:{}:{}", row_id.uuid(), owner),
        ))
    }
}

/// An owner-scoped table (carries an `owner` column → `table_schema_is_owner_scoped`).
fn owner_scoped_schema() -> Schema {
    SchemaBuilder::new()
        .table(
            TableSchema::builder("widgets")
                .column("id", ColumnType::Uuid)
                .column("owner", ColumnType::Uuid),
        )
        .build()
}

/// An owner-scoped table whose `owner` column is **nullable** — mirrors the legacy `signers`
/// carve-out. The funnel must STILL refuse an ownerless row here: no DB-level nullability can
/// sneak an unbound owned row past the per-peer invariant.
fn nullable_owner_schema() -> Schema {
    SchemaBuilder::new()
        .table(
            TableSchema::builder("trust")
                .column("id", ColumnType::Uuid)
                .nullable_column("owner", ColumnType::Uuid),
        )
        .build()
}

/// A non-owner-scoped table (no `owner` column → the binder is never invoked, write is not gated).
fn unowned_schema() -> Schema {
    SchemaBuilder::new()
        .table(
            TableSchema::builder("notes")
                .column("id", ColumnType::Uuid)
                .column("body", ColumnType::Text),
        )
        .build()
}

#[test]
fn owner_scoped_write_auto_stamps_binding() {
    let mut core = create_runtime_with_schema(owner_scoped_schema(), "owner-binder-stamp");
    core.set_owner_binder(Arc::new(StampingBinder));

    let owner = ObjectId::new();
    let ((row_id, _), _) = core
        .insert(
            "widgets",
            HashMap::from([
                ("id".to_string(), Value::Uuid(ObjectId::new())),
                ("owner".to_string(), Value::Uuid(owner)),
            ]),
            // NB: the call-site passes NO owner-binding metadata — the funnel must add it.
            None,
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
        "owner-scoped write must auto-stamp the owner-binding even though the call-site passed none"
    );
    assert_eq!(
        binding.unwrap(),
        &format!("bound:{}:{}", row_id.uuid(), owner.uuid()),
        "the stamped binding must carry the funnel-supplied (row_id, owner)"
    );
}

#[test]
fn owner_scoped_write_without_binder_fails_closed() {
    // No binder installed → this peer cannot author owned data at all. Enforced unconditionally
    // (no `require` switch): a non-owner-scoped write still succeeds, an owner-scoped one refuses.
    let mut core = create_runtime_with_schema(owner_scoped_schema(), "owner-binder-no-binder");

    let err = core
        .insert(
            "widgets",
            HashMap::from([
                ("id".to_string(), Value::Uuid(ObjectId::new())),
                ("owner".to_string(), Value::Uuid(ObjectId::new())),
            ]),
            None,
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
fn ownerless_owner_scoped_write_fails_closed() {
    // Every owned row MUST be rooted in a SAFE — an ownerless owner-scoped write is refused even
    // with a binder installed and even on a local engine. No exceptions, every peer.
    let mut core = create_runtime_with_schema(nullable_owner_schema(), "owner-binder-ownerless");
    core.set_owner_binder(Arc::new(StampingBinder));

    let err = core
        .insert(
            "trust",
            HashMap::from([
                ("id".to_string(), Value::Uuid(ObjectId::new())),
                ("owner".to_string(), Value::Null),
            ]),
            None,
        )
        .expect_err("an ownerless owner-scoped write must refuse — every owned row belongs to a SAFE");
    assert!(
        err.to_string().contains("owner-binding required"),
        "expected fail-closed owner-binding-required, got: {err}"
    );
}

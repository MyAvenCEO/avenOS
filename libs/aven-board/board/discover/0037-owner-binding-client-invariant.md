---
title: Ownership is an aven-db core primitive — one owned CRUD, value identity is the signed binding
summary: Re-discovered under the compact/simplify/consolidate lens. Ownership is NOT a configurable option, a per-table flag, or a sync-mode — it is a CORE PRIMITIVE of aven-db, exactly like `_id`. A value IS `(id, owner, data)` whose `(id, owner)` identity is immutable and carried by the Ed25519 owner-binding in the row's signed header. You cannot represent an unowned value. This collapses the whole owner-binding sprawl to its irreducible core: ONE `create(table, owner, fields)` (owner required), the binding established once at create and inherited by every later batch (no carry-forward branch), and ownership read back from the binding. DELETE end-to-end: the `owner` data column (all 11 tables), the `owner_scoped` flag, `owner_binding_meta` (~26 sites), `owner_invariant_ok`, `update_with_metadata`/`delete_with_metadata` binding-passing, `create_checked`/`create_checked_with_id_and_metadata`/`create_owned`, and every column-decode / already-present / carry-forward source. Security improves BY the simplification: one signed source = no confused-deputy; structural (not remembered) = no silent auth gap; immutable identity = the owner-relabel attack is unrepresentable, not merely guarded.
owner: claude (aven-db + aven-caps + app + relay)
created: 2026-06-14
updated: 2026-06-14
tags: [aven-db, aven-caps, security, sync, onboarding, ssot, elimination]
goal: "Ownership is an aven-db core primitive — every value is intrinsically `(id, owner, data)` with the owner carried ONLY by the immutable signed owner-binding, and the owner-binding sprawl is eliminated to one owned CRUD. Provable from command output: (1) ELIMINATIONS — each grep returns ZERO hits: `grep -rn '\"owner\"' libs/aven-schema/schema.manifest.json` (column gone from all tables); `grep -rn 'owner_scoped' libs/aven-db/src libs/aven-schema` (no flag); `grep -rn 'owner_binding_meta\\|owner_invariant_ok\\|create_checked\\|create_owned\\|create_checked_with_id_and_metadata\\|update_with_metadata\\|delete_with_metadata\\|existing_binding\\|owner_binding_target\\|already_bound' libs app` (every legacy symbol gone — one `create(table, owner, fields)` is the sole owned-create, and update/delete carry the binding as value identity, never re-stamp it). (2) `cargo test -p aven-db owner_binder` passes the rewritten owned-CRUD tests (create requires an owner+binder or fails closed; update/delete preserve the create-time binding; ownership reads back from the binding). (3) `cargo build -p aven-db -p aven-node -p aven-os-app --features desktop-ai` exits 0; aven-db + aven-node suites green. (4) CONSTRAINT held: every synced batch still carries the binding AND an edit-sig that covers it (no relay can strip ownership in flight) — proven by the relay/client `verify_on_apply` tests staying green. (5) LIVE: a freshly-flushed relay + fresh device completes first-human onboarding with ZERO `relay-deny[no-binding]` and `granted FIRST human SAFE admin` fires (recorded)."
---

# Ownership is an aven-db core primitive (one owned CRUD)

## Context

First-human onboarding broke because ownership lived in TWO places — a mutable `owner` data column
AND the immutable author-signed owner-binding — kept equal only by per-call-site discipline that three
`signers` writes forgot. The relay (correctly fail-closed) denied those unbound rows and no admin was
ever granted. Through this session the architecture **re-derived itself** to its irreducible core, and
this card re-scopes 0037 to that end-state under the compact/simplify/consolidate elimination rule.

**The core principle (confirmed with the user):** ownership is **not a feature, option, flag, or
mode** — it is a **CORE PRIMITIVE of aven-db itself, like `_id`.** A value *is* `(id, owner, data)`
whose `(id, owner)` identity is **immutable** and carried by the Ed25519 owner-binding
`(value_id → owner)` in the row's signed header. **aven-db cannot represent an unowned value** — there
is no API to make one, no "unowned mode," no per-table choice. Authoring a value *is* establishing its
owner-binding, inseparably.

**Why this is correct for a local-first P2P biscuit-capability architecture** (not taste — necessity):
- **P2P has no central authority to vouch for data.** Every row crossing between peers must be
  self-authenticating; an *unowned value is an un-attributable value* — a hole in the trust model.
- **Capabilities root in identities (SAFEs).** A cap only means something about a value if that value
  has an owner the chain roots in. One owner per value = the clean root caps always assumed.
- **CRDT/local-first:** a *mutable* owner column is a divergence surface (two peers LWW-conflict on
  owner) — the exact drift that broke onboarding. Ownership in the immutable signed header cannot
  diverge. The dual representation wasn't redundant, it was *wrong*.

**Security improves BY the simplification** (the cleanup IS the hardening): one signed source =
no confused-deputy between column-trusting and binding-trusting code; a **structural** invariant
(can't author a value without its binding) = no *remembered*-at-26-sites auth gap; an **immutable**
identity = the owner-relabel attack is *unrepresentable*, not merely guarded (the relay's special
owner-relabel denial becomes unnecessary); ~26 hand-stamping sites → one audited `create` = a smaller
trusted computing base; one read path for ownership = peers cannot hold disagreeing ownership views.

**The boundary (confirmed from code):** the value funnel (`authored_row_batch`) only ever authors
**values** (the manifest tables). The **schema catalogue** (schema defs + lenses) DOES sync but on a
**separate** path (`SyncPayload::CatalogueEntryUpdated` / `upsert_catalogue_entry`, never the funnel)
with its **own** trust model (inbound peer catalogue writes are rejected — `inbox.rs:1118`; hash/
publisher authenticated, not SAFE-owned). Storage internals (`_id`/`_id_deleted` indexes, sync
bookkeeping) are device-local. So the catalogue is **not a value** — out of scope, no contradiction.

## Goal

Ownership is intrinsic to every aven-db value; the owner-binding sprawl is gone; first-human
onboarding works against a freshly-flushed relay. Completion = the frontmatter `goal:`.

**Completion condition** (identical to frontmatter `goal:`):

> Ownership is an aven-db core primitive — every value is intrinsically `(id, owner, data)` with the
> owner carried ONLY by the immutable signed owner-binding — proven by: the elimination greps all
> return zero; `cargo test -p aven-db owner_binder` green; `cargo build -p aven-db -p aven-node
> -p aven-os-app --features desktop-ai` exits 0 with aven-db + aven-node suites green; every synced
> batch still carries binding + covering edit-sig (verify_on_apply tests green); and a freshly-flushed
> relay + fresh device onboards with zero `relay-deny[no-binding]` and the admin grant fires.

## Approach (irreducible owned-CRUD — eliminate, don't optimize)

- **aven-db — ownership is intrinsic.** `WriteContext.owner` carries the owning SAFE; the deep author
  funnel `authored_row_batch` mints the owner-binding from it on CREATE and stamps it into the immutable
  header BEFORE the edit-sig digest (so it is itself integrity-signed). UPDATE/DELETE **inherit** the
  value's existing binding — it is the value's identity, established once, never re-stamped or re-minted
  (eliminate the `existing_binding` carry-forward branch; the engine preserves the value's binding the
  same way it preserves `_id`). No owner-binding ⇒ no value ⇒ the write fails by construction. Decide in
  build the cleanest place for "inherit the binding" so update/delete need zero owner input.
- **One create.** `AvenDbClient::create(table, owner, id?, fields)` is the **sole** owned-create.
  DELETE `create_checked`, `create_owned`, `create_checked_with_id_and_metadata`. `owner` is required.
- **Read ownership back from the binding.** `AvenDbClient::owner_binding_for` (built) returns the raw
  binding; the app parses it (`aven_caps::ownership::OwnerBinding::from_meta_str`) to recover the owner.
  The sync ACL `build_object_owner_map` reads ownership from the binding, not a column.
- **Eliminate everywhere:** the `owner` column (all 11 manifest tables); the `owner_scoped` flag
  (no per-table option — ownership is intrinsic); `owner_binding_meta` (~26 caps_ipc/crud_ipc/aven_ceo
  sites → the one `create`); `owner_invariant_ok` + its `resolve_named_row` check; the
  `update_with_metadata`/`delete_with_metadata` owner-binding passing (→ plain `update`/`delete`); any
  column-decode (`owner_binding_target`) or already-present source.
- **Relay/resolver:** every value row requires a valid binding + covering edit-sig (already
  fail-closed on main); with the column gone, the owner-relabel guard's job is done by immutability.
- **Out of scope:** the schema catalogue (non-value infrastructure, separate path/trust).

## Steps

1. aven-db: finalize the funnel to mint-on-create / inherit-on-update-delete (no carry-forward branch);
   `WriteContext.owner`; the one `create`; rewrite the `owner_binder` tests to the owned-CRUD API.
2. aven-db: drop the `owner_scoped` flag (TableSchema + builder + manifest parse); delete
   `owner_invariant_ok` + the `resolve_named_row` check + exports + their schema.rs tests.
3. Manifest: delete the `owner` column from all 11 tables (schema-hash bump → coordinated redeploy).
4. App: migrate ~26 `caps_ipc`/`crud_ipc` create sites to the one `create`; updates/deletes to plain
   `update`/`delete`; delete `owner_binding_meta`; migrate `build_object_owner_map` to the binding read.
5. aven-node `aven_ceo.rs`: author the avenCEO genesis via the one `create`; delete its
   `owner_binding_meta`.
6. Build aven-db + aven-node + app green; run the eliminated-symbol greps (all zero).
7. Flush + `WIPE=1` relay redeploy + fresh client; live onboarding proof recorded.

## Files to touch

- `libs/aven-db/src/query_manager/writes.rs` (funnel: mint-on-create / inherit binding), `session.rs`
  (`WriteContext.owner`), `avenos_client.rs` (one `create`, `owner_binding_for` — built), `runtime_*`
  (plumbing — built), `query_manager/types/schema.rs` (drop `owner_scoped` + `owner_invariant_ok`),
  `manifest.rs` (drop flag parse), `schema_manager/encoding.rs` (drop `owner_scoped`), `lib.rs` (exports).
- `libs/aven-schema/schema.manifest.json` (drop 11 `owner` columns).
- `app/src-tauri/src/avendb/caps_ipc.rs`, `crud_ipc.rs` (one `create`; delete `owner_binding_meta`),
  `engine.rs` (`build_object_owner_map` → binding read; device self-signer via `create`),
  `signers.rs` (via `create`), `biscuit_resolver.rs` (tests).
- `libs/aven-node/src/aven_ceo.rs` (genesis via `create`; delete `owner_binding_meta`).

## Acceptance criteria

- [ ] `grep -rn '"owner"' libs/aven-schema/schema.manifest.json` → 0 (column gone from all tables).
- [ ] `grep -rn 'owner_scoped' libs/aven-db/src libs/aven-schema` → 0 (no flag — ownership is intrinsic).
- [ ] `grep -rn 'owner_binding_meta\|owner_invariant_ok\|create_checked\|create_owned\|create_checked_with_id_and_metadata\|update_with_metadata\|delete_with_metadata\|existing_binding\|owner_binding_target\|already_bound' libs app` → 0.
- [ ] `cargo test -p aven-db owner_binder` passes the owned-CRUD tests (create requires owner+binder or fails; update/delete preserve the create-time binding; ownership reads back from the binding).
- [ ] `cargo build -p aven-db -p aven-node -p aven-os-app --features desktop-ai` exits 0; aven-db + aven-node suites green.
- [ ] Every synced batch carries binding + covering edit-sig — `verify_on_apply` relay/client tests green (no relay can strip ownership).
- [ ] **Delegation roots in the binding**: biscuit authorization is checked against `binding.owner` (the value's true owner) and no other owner source — per-SAFE, per-op (`peers`→Admit, `keyshares`→RotateDek, `delete`→Delete, else Write). Proven by the `biscuit_resolver` / `authorize_signed_edit` tests staying green; making ownership immutable makes the owner-relabel→bypass attack unrepresentable.
- [ ] Live: freshly-flushed relay + fresh first-human onboarding → zero `relay-deny[no-binding]`, `granted FIRST human SAFE admin` fires (recorded).

## Verification

```bash
grep -rn '"owner"' libs/aven-schema/schema.manifest.json                 # 0
grep -rn 'owner_scoped' libs/aven-db/src libs/aven-schema                # 0
grep -rn 'owner_binding_meta\|owner_invariant_ok\|create_checked\|create_owned\|update_with_metadata\|delete_with_metadata\|existing_binding\|owner_binding_target\|already_bound' libs app  # 0
cargo test -p aven-db owner_binder
cargo build -p aven-db -p aven-node -p aven-os-app --features desktop-ai
# runtime: WIPE=1 redeploy relay, then tail /.sprite/logs/services/aven-node.log
#   (no relay-deny[no-binding]; "granted FIRST human SAFE admin")
```

## Hand-off

```
/aven-build 0037
```

## Progress log

Newest first.

- `2026-06-14` — **Re-discovered under the elimination lens.** Confirmed with the user that ownership is
  a CORE PRIMITIVE of aven-db (like `_id`), not a flag/mode/option — a value *is* `(id, owner, data)`,
  the owner carried only by the immutable signed binding; aven-db cannot represent an unowned value.
  Collapsed to one `create(table, owner, fields)`; the binding is the value's identity (no carry-forward
  branch — update/delete inherit it); eliminate the column, `owner_scoped` flag, `owner_binding_meta`,
  `owner_invariant_ok`, the `*_with_metadata` binding-passing, and the legacy create variants. Established
  WHY this is necessary for local-first P2P biscuit-cap (un-attributable = un-authenticatable; mutable
  owner = CRDT divergence) and HOW it hardens security (one source = no confused-deputy; structural = no
  remembered gap; immutable = relabel unrepresentable; smaller TCB). Boundary confirmed from code: the
  value funnel only authors values; the schema catalogue syncs on a separate path with its own trust and
  is out of scope. Hard constraint kept: every synced batch carries binding + covering edit-sig.
  Engine foundation (WriteContext.owner mint funnel + `owner_binding_for` read-back + one `create`) is
  built and green at the aven-db level, UNCOMMITTED on branch `claude/thirsty-hellman-5cb9e6` (rebased
  onto main); the app-wide create-site migration + column drop is the remaining atomic build.
- `2026-06-14` — Stage 2a (committed `4e976f76`, since superseded by the intrinsic-ownership framing):
  `owner_scoped` made a declarative flag — now to be deleted entirely (ownership is not optional).
- `2026-06-14` — Stage 1 (committed `7bba6272`): per-peer owner-binding invariant at the deep author
  funnel; `OwnerBinder` seam; binders installed on both peers; signers ownership; 710 aven-db tests green.

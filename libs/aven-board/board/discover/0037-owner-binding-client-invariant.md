---
title: Owner-binding is the SOLE source of ownership — auto-stamp every owner-scoped row, drop the `owner` column (SSOT)
summary: First-human onboarding broke because ownership lives in TWO places — a mutable `owner` data column AND an immutable author-signed owner-binding — kept equal only by per-call-site discipline that three `signers` writes forgot, so the relay (correctly fail-closed) denied those unbound rows and no admin was ever granted. The fix is the SSOT end-state, not a patch: make the signed owner-binding the ONE source of ownership, auto-stamped at the deepest aven-db author funnel for every owner-scoped row (mirroring the injected EditSigner), and DELETE the redundant mutable `owner` column from all tables. Dev-only / flush-from-scratch is authorized, so we go straight to the end-state in one coordinated schema bump — no intermediate dual-representation stage. Trust-root model: a value's owner (its SAFE) is fixed by the signed binding; all access beyond the owner flows ONLY through admin-role caps.
owner: claude (aven-db + aven-caps + app + relay)
created: 2026-06-14
updated: 2026-06-14
tags: [aven-db, aven-caps, security, sync, onboarding, schema, ssot]
goal: "Ownership has exactly ONE representation — the author-signed owner-binding in the row's immutable authenticated header — and it is non-bypassable at the deepest aven-db core, enforced as a PER-PEER authoring invariant (every peer — local, headless, syncing — no `require` switch, no exceptions). Provable from command output: (1) `cargo test -p aven-db owner_binder` passes with THREE tests — `owner_scoped_write_auto_stamps_binding` (a write to an owner-scoped table through a peer with an installed OwnerBinder carries the OwnerBinding even though the CALL-SITE passed none), `owner_scoped_write_without_binder_fails_closed` (any peer with no binder REFUSES an owner-scoped write — no unbound owned row can be authored), and `ownerless_owner_scoped_write_fails_closed` (an owner-scoped write with a NULL owner REFUSES even where the column is nullable — every owned row belongs to a SAFE). (2) `grep -rn '\"owner\"' libs/aven-schema/schema.manifest.json` returns ZERO data-column hits — the mutable owner column is gone from all tables; owner-scoped-ness is declared by an explicit `owner_scoped` table flag, not column presence, and `owner` is a required write parameter. (3) `grep -rn 'owner_binding_meta' app/src-tauri/src` shows per-call-site stamping removed from write paths. (4) `cargo build -p aven-db -p aven-node -p aven-os-app --features desktop-ai` exits 0 and the aven-db + aven-node suites stay green. (5) Relay `verify_on_apply` stays fail-closed on ALL owner-scoped tables (no exemptions). (6) LIVE proof recorded in the card: a freshly-flushed relay + fresh device completes first-human onboarding with ZERO `relay-deny[no-binding]` and `granted FIRST human SAFE admin` fires."
---

# Owner-binding is the SOLE source of ownership (SSOT)

## Context

Debugging the live relay (clean release-104 deploy) found first-human onboarding fully broken: the log
floods `relay-deny[no-binding]: spark-scoped row missing owner-binding table=keyshares … DenyPermanent`,
**no `granted FIRST human SAFE admin`** ever fires, and avenCEO's only owner is the **server key**
(`did:key:z6Mkvy…qpp3`) — so a fresh mac/iOS/Linux can't claim admin.

**Root cause (confirmed):** ownership is represented in **two** places that must stay equal:
1. the **mutable `owner` data column** (11 tables in `schema.manifest.json`), and
2. the **immutable author-signed owner-binding** (`OWNER_BINDING_META_KEY`, an Ed25519 assertion
   `(value_id → owner)` in the row's authenticated header, covered by the row digest, blind-verifiable
   by a keyless relay).

The merged *"enforce owner-binding system-wide"* change made the relay's `verify_on_apply`
**fail-closed on every owner-scoped table** (correct — the relay verifies *authenticity + integrity*
of each row via the author's pubkey, no DEK needed; KEEP IT). But on the client the binding is stamped
**manually, per IPC call-site** (`owner_binding_meta(...)`), and **three `signers` writes forgot**:
- `app/src-tauri/src/signers.rs:195` → `create_checked("signers", …)` (no binding)
- `app/src-tauri/src/signers.rs:229` → `update(oid, …)` (no binding)
- `app/src-tauri/src/avendb/engine.rs:1318` → `create_checked("signers", …)` (no binding)

`signers` is owner-scoped, so the relay `DenyPermanent`s those unbound rows → the device's signer never
lands → `grant_first_human_admin` (`aven_ceo.rs:312`) finds no synced human SAFE → never grants.

**The real flaw is the dual representation itself.** A mutable mirror kept equal by call-site discipline
*will* drift (it did). SSOT/DRY/KISS says: the signed binding is the trust root; delete the mirror.

**Architecture (confirmed with the user):**
- **Owner-binding = trust root.** The signed `(value_id → owner)` in the immutable header IS the
  ownership. There is no second notion of owner. Blind-verifiable, so a keyless relay can fail-closed on
  authenticity. Do **not** exempt trust tables — that's lesser security, unacceptable in P2P.
- **All access beyond the owner flows ONLY through admin-role caps.** The biscuit chain roots on the
  bound owner; additional members / delegated writes / admin grants are minted as caps that chain from
  that owner/admin. The binding authenticates ownership; caps authorize everything else. Clean split.
- **The `owner` column is deleted.** Owner-scoped-ness becomes an explicit declarative `owner_scoped`
  table flag in the manifest (not column-presence). Owner-scoped lookups/indexes derive the owner from
  the binding, not a data cell.
- **Dev-only / flush-from-scratch is authorized**, so this is ONE coordinated schema bump to the
  end-state — no intermediate "auto-stamp but keep the column" stage to ship and later tear out.

**Nullable-`signers` carve-out must be resolved.** Today `owner_invariant_ok` lets a *nullable* `owner`
column pass with NULL (the "device-local trust-set" carve-out), yet the relay fail-closes on the
`signers` table — a NULL-owner row **cannot** be bound (nothing to bind to) but is denied anyway. In the
SSOT model every row of an `owner_scoped` table MUST have an owner (so it can be bound). Resolve by
either: (a) `signers` rows always carry the device's own SAFE as owner (then they bind + sync cleanly),
or (b) `signers` is marked NOT `owner_scoped` and is device-local / non-syncing. The build picks the one
that makes onboarding pass; whichever it is, **no `owner_scoped` table may hold an unbindable row**.

## Goal

Ownership has exactly one representation — the signed binding — enforced non-bypassably at the deepest
aven-db core, fail-closed, E2E. The mutable `owner` column no longer exists. Completion = frontmatter `goal:`.

## Approach (SSOT — one authority, mirror the EditSigner, drop the column)

- **aven-db — auto-stamp (the invariant):** add an `OwnerBinder` trait (capability.rs, analogue of
  `EditSigner`) — `fn bind_row(&self, row_id, owner: Uuid) -> Option<(String, String)>` returning
  `OWNER_BINDING_META_KEY` + serialized binding — plus `AvenDbClient::set_owner_binder(...)` and the
  plumbing that mirrors `edit_signer` (sync_manager field+setter, runtime_core/sync.rs,
  runtime_tokio.rs, avenos_client.rs, lib.rs export). At the single deep author funnel
  (`writes.rs::authored_row_batch`), for any **owner-scoped** row, mint + stamp the binding **before**
  the edit-sig digest (so the binding is itself integrity-signed and travels E2E). Fail-closed: a
  SYNCING engine writing an owner-scoped row with **no** binder installed (or a binder returning `None`)
  **fails the write** — an unbound owned row cannot be authored, by construction. Local/headless
  (`NullSyncTransport`, tests) may write unbound (they never reach a fail-closed relay).
- **aven-db — drop the column (the SSOT):** replace `table_schema_is_owner_scoped` (column-presence)
  with an explicit `owner_scoped: bool` on `TableSchema`, sourced from a new manifest field. Remove the
  `owner` column from all 11 tables in `schema.manifest.json`. Migrate every owner-scoped read path
  (`owner_invariant_ok`, owner indexes, any `column("owner")` lookup, ACL `build_object_spark_id_map`)
  to derive the owner from the binding instead of the data cell. `owner_scoped_table_names` now filters
  on the flag.
- **App:** install an aven-caps-backed `AppOwnerBinder` (`mint_owner_binding(device_key, row_id, owner)`)
  beside `set_edit_signer` (avendb/mod.rs:381). **Remove the manual `owner_binding_meta`** from the IPC
  call-sites (DRY — the invariant owns it). Drop any `owner`-column writes from row construction.
- **Relay:** unchanged logic — stays fail-closed on all `owner_scoped` tables (verify). It already trusts
  the binding, never a column value, so dropping the column doesn't touch its trust path.
- **Flush + redeploy:** rebuild + WIPE the relay and flush clients so the new schema hash is the only one
  in the network (dev-only authorized).

## Steps

1. aven-db `OwnerBinder` trait + `set_owner_binder` plumbing + auto-stamp at `authored_row_batch` before
   the edit-sig digest; the two gating tests (`owner_scoped_write_auto_stamps_binding`,
   `owner_scoped_write_without_binder_fails_closed`).
2. Declarative `owner_scoped` flag (manifest + `TableSchema`); delete the `owner` column from all 11
   tables; migrate owner-scoped reads/indexes/ACL to binding-derived owner; resolve the `signers`
   carve-out. aven-db + aven-node suites green.
3. App: install `AppOwnerBinder`; remove per-call-site `owner_binding_meta` and `owner`-column writes;
   `cargo build -p aven-db -p aven-node -p aven-os-app --features desktop-ai` exits 0.
4. Flush + redeploy relay (`WIPE=1` deploy) and clients; fresh device onboards → tail the relay → zero
   `relay-deny[no-binding]` + `granted FIRST human SAFE admin` fires; record the live result in the card.

## Files to touch

- `libs/aven-db/src/capability.rs` (OwnerBinder trait — present), `query_manager/writes.rs` (funnel
  stamp), `query_manager/types/schema.rs` (`owner_scoped` flag, drop column-presence detection),
  `sync_manager/mod.rs` + `runtime_core/sync.rs` + `runtime_tokio.rs` + `avenos_client.rs` + `lib.rs`
  (set_owner_binder plumbing + export).
- `libs/aven-schema/schema.manifest.json` (drop 11 `owner` columns; add `owner_scoped` flag per table).
- `app/src-tauri/src/biscuit_resolver.rs` (`AppOwnerBinder`, beside `AppEditSigner`) + `avendb/mod.rs`
  (install), `app/src-tauri/src/signers.rs`, `app/src-tauri/src/avendb/engine.rs`, `caps_ipc.rs`,
  `crud_ipc.rs` (drop manual stamping + owner-column writes).
- aven-node ACL (`build_object_spark_id_map` / owner-scoped lookups) — binding-derived owner.

## Acceptance criteria

- [ ] `owner_scoped_write_auto_stamps_binding` passes — owner-scoped write carries the binding with the call-site passing none.
- [ ] `owner_scoped_write_without_binder_fails_closed` passes — a syncing client can't author an unbound owner-scoped row.
- [ ] `grep -rn '"owner"' libs/aven-schema/schema.manifest.json` returns ZERO data-column hits (column gone); owner-scoped-ness is the `owner_scoped` flag.
- [ ] `grep -rn 'owner_binding_meta' app/src-tauri/src` shows the per-call-site stamping gone from write paths.
- [ ] `cargo build -p aven-db -p aven-node -p aven-os-app --features desktop-ai` exits 0; aven-db + aven-node suites green.
- [ ] Relay `verify_on_apply` still fail-closed on ALL owner-scoped tables (no exemptions).
- [ ] Live: freshly-flushed relay + fresh first-human onboarding → zero `relay-deny[no-binding]`, `granted FIRST human SAFE admin` fires (recorded).

## Verification

```
cargo test -p aven-db owner_binder
cargo build -p aven-db -p aven-node -p aven-os-app --features desktop-ai
grep -rn '"owner"' libs/aven-schema/schema.manifest.json   # expect: no data-column hits
grep -rn "owner_binding_meta" app/src-tauri/src            # expect: gone from write paths
# runtime: WIPE=1 redeploy relay, then:
#   sprite exec -s aven-ceo -- tail -f /.sprite/logs/services/aven-node.log
#   (no relay-deny[no-binding]; "granted FIRST human SAFE admin")
```

## Progress log

- `2026-06-14` — Discovery: root-caused broken onboarding to manual per-call-site owner-binding stamping
  (3 `signers` sites forgot) vs the now-fail-closed relay. Reviewed the crypto: the OwnerBinding
  primitive (Ed25519 `(value_id→owner)`, domain-separated, blind-verifiable, in the immutable digest-
  covered header) is sound and the right choice; the real flaw is the **dual owner representation**
  (mutable column vs signed binding). User authorized dev-only flush-from-scratch + schema change, so the
  card is the **SSOT end-state in one bump**: auto-stamp the binding at the deepest author funnel (mirror
  EditSigner) AND delete the `owner` column, owner-scoped-ness becoming a declarative `owner_scoped` flag,
  owner-scoped reads/indexes/ACL deriving owner from the binding. Trust-root model confirmed: owner =
  signed binding (the SAFE), all further access only via admin-role caps. Open design point flagged for
  build: resolve the nullable-`signers` carve-out (every `owner_scoped` row must be bindable).
- `2026-06-14` — **Stage 1 built + green** (the permanent enforcement core): added the `OwnerBinder`
  capability seam (`set_owner_binder` plumbed through sync_manager → runtime_core → runtime_tokio →
  AvenDbClient, exported from the crate root) and wired the mint+stamp into the single deep author funnel
  `QueryManager::authored_row_batch` (libs/aven-db/src/query_manager/writes.rs) — stamped BEFORE the
  edit-sig digest so the binding is itself integrity-signed, across all five write paths (insert / update /
  soft-delete / undelete / hard-delete). **Refined the invariant per the user (twice): enforcement is
  UNCONDITIONAL and PER-PEER — not a sync-engine policy.** Dropped the `require_owner_binding` switch
  entirely: on EVERY peer (local, headless, syncing) an owner-scoped row that cannot be bound — no binder
  (no device key) or no owner SAFE — fails the write (`QueryError::OwnerBindingRequired`). No local
  carve-out: an ownerless owned row is refused even where the column is nullable (the legacy `signers`
  carve-out is thereby eliminated; the app must always own its trust-set rows by the device SAFE). New
  error variant + three gating tests (`runtime_core/tests/owner_binder.rs`). `cargo test -p aven-db`:
  **707 passed, 0 failed** (zero blast radius — no aven-db test table is owner-scoped; all owner-scoped
  tables live in the app manifest); aven-node builds green. The transitional `owner_binding_target`
  decodes the owner from the `owner` column for now; Stage 2 replaces it with an explicit required `owner`
  write parameter once the column is dropped — turning this runtime gate into a compile-time guarantee.

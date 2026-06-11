---
title: Enforce the Delete capability on inbound sync (not Write)
summary: Derive the inbound apply op from row.delete_kind so a Write-only peer is denied on delete-flagged rows, matching the local originate gate.
owner: Claude Code
created: 2026-06-08
updated: 2026-06-08
tags: [aven-db, security, authz]
goal: `cargo build -p aven-db` succeeds AND `cargo test -p aven-caps writer_grant_denies_delete` passes, proving a Write-only peer is denied the Delete cap the inbox now requests on delete-flagged rows.
---

# Enforce the Delete capability on inbound sync (not Write)

## Context

Implements crypto-audit finding **#6** (`docs/security/crypto-audit-2026-06-08.md`, "[High] #6 — Inbound delete is gated only as Write — the distinct Delete capability is never enforced on synced rows", 3 confirm / 0 refute).

The inbound apply gate in `libs/aven-db/src/sync_manager/inbox.rs:333-339` hardcodes `crate::capability::AccOp::Write` for **every** received row — including rows flagged as soft/hard delete. The app's resolver then maps the row's table to a required cap via `required_write_op_for_table` (`app/src-tauri/src/biscuit_resolver.rs:173-179`), which only ever returns `Admit` / `RotateDek` / `Write` — never `AccOp::Delete`. The dedicated `AccOp::Delete` capability — defined in `libs/aven-caps/src/caps.rs:32`, granted to owners via `OWNER_RIGHTS` (`caps.rs:119`), and enforced on the **local** outbound originate path at `app/src-tauri/src/jazz/mod.rs:3636` (`authorize_gate(.., AccOp::Delete, ..)`) — is therefore never checked on inbound sync. The gate only ever asks "may this author *Write*?".

**Attack scenario (carried over from the audit):** An admin grants peer P a row- or table-scoped `write` capability on identity O's data (write but **no** delete) — e.g. a granular `grant(did,"write",prefix)`. P crafts a `StoredRowBatch` for one of O's rows, sets metadata key `Delete="hard"` (parsed into `delete_kind=Hard`, `types.rs:261-270` / `309-310`), stamps a valid owner-binding (P is an authorized writer, so `verify_on_apply`'s `authorize(Write)` passes), and syncs it. Every receiving member's `verify_on_apply` runs `authorize(.., AccOp::Write, ..)` — which P satisfies — so the hard-delete is applied. `resolution.rs:88-98` / `381-398` ranks `Hard > Soft > live`, so the row's data is cleared **network-wide**. P performed a destructive Delete it was never granted.

**Precise evidence:**
- `inbox.rs:333-339` — `resolver.verify_on_apply(&subject, crate::capability::AccOp::Write, &res, &digest.0, proof)` — literal `AccOp::Write`, no branch on `row.delete_kind`.
- `biscuit_resolver.rs:157` — `required_write_op_for_table(&res.table)` returns `Admit`/`RotateDek`/`Write` only (`173-179`); no mapping to `AccOp::Delete`. Note: the resolver **ignores** the `op` argument passed by the engine and recomputes from the table, so the fix must touch both layers.
- `AccOp::Delete` exists in BOTH the aven-db engine enum (`libs/aven-db/src/capability.rs:20`) and aven-caps (`caps.rs:32`); it is enforced only at the local originate gate `jazz/mod.rs:3636`.
- `row.delete_kind: Option<DeleteKind>` is a wire field on `StoredRowBatch` (`types.rs:220`), already populated from metadata before apply.

**Cross-link:** This item **pairs with 0013** (bind delete state into the content digest / edit-signature so a relay cannot tamper `delete_kind` in flight — finding #7/#26). 0012 stops an *authenticated Write-only peer* from self-authoring a delete; 0013 stops a *relay flipping unsigned `delete_kind` bytes* on a legitimately-signed row. **Both are needed** — 0012 alone leaves the tamper-in-flight path open; 0013 alone leaves the granular-writer path open.

## Goal

When done, the inbound apply gate requests `AccOp::Delete` (not `Write`) for any row whose `delete_kind.is_some()`, so a peer holding only `Write` is denied at apply on every receiving member — matching the local originate gate.

**Completion condition** (identical to frontmatter goal):
> `cargo build -p aven-db` succeeds AND `cargo test -p aven-caps writer_grant_denies_delete` passes, proving a Write-only peer is denied the Delete cap the inbox now requests on delete-flagged rows.

## Approach

Two small, layered changes:

1. **Engine (`libs/aven-db/src/sync_manager/inbox.rs`)** — derive the op from the row instead of hardcoding it. Replace the literal `crate::capability::AccOp::Write` at line 335 with a value computed as `if row.delete_kind.is_some() { AccOp::Delete } else { AccOp::Write }`. The engine already has `AccOp::Delete` (`capability.rs:20`), so no enum change is needed. Bind the op into a `let` above the `verify_on_apply` call for readability.

2. **App resolver (`app/src-tauri/src/biscuit_resolver.rs`)** — `required_write_op_for_table` currently throws away the engine-supplied `op` and recomputes purely from the table, so it would silently re-coerce `Delete` back to `Write`. Make the resolver honor an incoming `Delete`: when the engine passes `AccOp::Delete`, the authorize call must use `AccOp::Delete` (mapping through `crate::identity_acc::AccOp::Delete`) rather than `required_write_op_for_table(..)`. Keep `peers`→`Admit` / `keyshares`→`RotateDek` for non-delete writes. The cleanest shape: pass the engine `op` into the table-mapping helper and let a `Delete` short-circuit to `AccOp::Delete`.

3. **Regression test (`libs/aven-caps/src/caps.rs` test module)** — add `writer_grant_denies_delete`: mint a genesis identity, attenuate a third-party **write-only** granular grant to a peer P via `attenuate_add_grant_third_party(.., P.did, "write", identity-prefix)`, then assert `authorize(.., AccOp::Write, ..)` **succeeds** for P but `authorize(.., AccOp::Delete, ..)` **fails** (`is_err()`). This proves the cap layer the inbox now invokes truly distinguishes Write from Delete for a granular writer — i.e. the exact peer in the attack is denied. (`AccOp::Delete` denial for non-owners is already asserted at `caps.rs:999` / `1110`, but those cover *readers*; the new test covers the granular-*writer* case in the finding.)

**Trade-offs / out of scope:**
- This item does NOT make `delete_kind` tamper-proof on the wire — a relay can still flip `delete_kind` on a row P legitimately wrote, because it is not in the content digest. That is **0013**'s job (finding #7/#26). 0012 only closes the authenticated-writer self-authoring path.
- `aven-db` library unit tests are currently broken to build in bulk (~266 errors, legacy test scaffolding from the M0 server-tier rip). Therefore the goal does NOT run `cargo test -p aven-db` wholesale — the engine change is proven by `cargo build -p aven-db` (compile) plus the aven-caps-level regression test (`cargo test -p aven-caps` is known-green). An optional engine-level test is noted in Steps but is not part of the gating goal.

## Steps

1. In `libs/aven-db/src/sync_manager/inbox.rs` (apply gate, ~line 333), introduce `let apply_op = if row.delete_kind.is_some() { crate::capability::AccOp::Delete } else { crate::capability::AccOp::Write };` and pass `apply_op` to `verify_on_apply` instead of the literal `AccOp::Write`. Update the surrounding comment to note that deletes request the Delete cap.
2. In `app/src-tauri/src/biscuit_resolver.rs`, thread the engine-supplied `op` into the authorize decision so an inbound `AccOp::Delete` maps to `crate::identity_acc::AccOp::Delete` (and does NOT get re-coerced to `Write` by `required_write_op_for_table`). Keep `peers`→`Admit` / `keyshares`→`RotateDek` for writes.
3. Add the `writer_grant_denies_delete` regression test to the `aven-caps` test module in `libs/aven-caps/src/caps.rs`, modeled on `reader_grant_allows_read_without_membership` (`caps.rs:975`) but using `attenuate_add_grant_third_party(.., "write", prefix)` for a granular write-only grant.
4. `cargo build -p aven-db` (engine compiles with the derived op).
5. `cargo test -p aven-caps writer_grant_denies_delete` (new test green) and `cargo test -p aven-caps` (no regression).
6. `cargo build -p avenos-app` or the app crate to confirm the resolver change compiles (best-effort; not part of the gating goal — note if the app crate is slow/unavailable in the harness).

## Files to touch

- `libs/aven-db/src/sync_manager/inbox.rs` (~333-339) — replace hardcoded `AccOp::Write` with op derived from `row.delete_kind.is_some()`; this is the core fix.
- `app/src-tauri/src/biscuit_resolver.rs` (~153-179) — honor an inbound `AccOp::Delete` instead of re-coercing every write-or-delete to `required_write_op_for_table(..)`, so the engine's Delete request actually reaches `authorize(.., AccOp::Delete, ..)`.
- `libs/aven-caps/src/caps.rs` (test module, near `caps.rs:975`) — add `writer_grant_denies_delete` regression test proving a granular write-only peer is denied Delete.

## Acceptance criteria

- [x] `inbox.rs` no longer passes a literal `AccOp::Write` to `verify_on_apply`; the op is derived as `if row.delete_kind.is_some() { AccOp::Delete } else { AccOp::Write }` — proven by `cargo build` in `libs/aven-db`.
- [x] The app resolver honors the inbound `Delete` (does not re-coerce to `required_write_op_for_table`) — `verify_on_apply` now uses the engine `op`; proven by `cargo check` on `aven-os-app` (Finished).
- [x] `aven-db` compiles with the change — proven by `cargo build` in `libs/aven-db` (Finished).
- [x] A granular write-only peer is denied the Delete cap — proven by `cargo test writer_grant_denies_delete` (1 passed).
- [x] No aven-caps regression — proven by `cargo test` in `libs/aven-caps` (31 passed).

## Verification

```bash
# 1. The hardcoded Write is gone; op is derived from the delete flag.
grep -n "apply_op\|delete_kind.is_some" libs/aven-db/src/sync_manager/inbox.rs

# 2. Engine compiles with the derived op (aven-db --lib bulk tests are known-broken,
#    so we gate on build here, not `cargo test -p aven-db`).
cargo build -p aven-db

# 3. The new regression test: a write-only granular peer is denied Delete.
cargo test -p aven-caps writer_grant_denies_delete

# 4. No regression in the (known-green) caps suite.
cargo test -p aven-caps
```

## Hand-off

```
/aven-build 0012-enforce-delete-cap-inbound
```

## Progress log

Newest first.
- `2026-06-08` — **Implemented + verified (ready for test column).** Three-layer fix: (1) `inbox.rs` apply gate derives `apply_op = if row.delete_kind.is_some() { AccOp::Delete } else { AccOp::Write }` instead of the hardcoded `Write`; (2) `biscuit_resolver.rs` `verify_on_apply` un-ignored its `op` param and now maps an inbound `AccOp::Delete` to `identity_acc::AccOp::Delete` (short-circuiting `required_write_op_for_table`, which would have re-coerced it to `Write`), keeping `peers`→`Admit`/`keyshares`→`RotateDek` for non-delete writes; (3) added `writer_grant_denies_delete` to `caps.rs` proving a granular write-only peer may Write but is denied Delete (and the owner retains Delete). Verified: `cargo test writer_grant_denies_delete` ✅, aven-caps 31/31 ✅, aven-db build ✅, app `cargo check` ✅. Pairs with 0013 (tamper-in-flight of `delete_kind`), still in plan. Moved plan → test.
- `2026-06-08` — Planned from crypto audit (docs/security/crypto-audit-2026-06-08.md, finding #6). Grounded against real source: inbox.rs:333-339 (hardcoded `AccOp::Write`), capability.rs:20 (engine `AccOp::Delete` already exists), biscuit_resolver.rs:157/173-179 (resolver ignores engine op, recomputes from table — must also change), jazz/mod.rs:3636 (local Delete gate to match), caps.rs:119 `OWNER_RIGHTS` + 999/1110 (existing reader-denies-delete tests; new test covers the granular-writer case). Cross-linked to 0013 (tamper-in-flight). Created in plan.

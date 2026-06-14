---
title: Owner-binding as a client-layer invariant — auto-stamp every owner-scoped row
summary: First-human onboarding is broken — the relay (correctly) fail-closes on every owner-scoped row missing an owner-binding, but bindings are stamped MANUALLY per call-site and three `signers` writes forgot, so the device's signer never lands and no admin is ever granted. Fix it structurally: an injected OwnerBinder on the AvenDbClient auto-stamps the binding for EVERY owner-scoped write (mirroring the existing EditSigner), so "no unbound owner-scoped row, ever" is true by construction — not by remembering at N call-sites.
owner: claude (aven-db + app)
created: 2026-06-14
updated: 2026-06-14
tags: [aven-db, aven-caps, security, sync, onboarding]
goal: "`cargo test -p aven-db owner_binder` passes with TWO new tests — `owner_scoped_write_auto_stamps_binding` (a write to an owner-scoped table through a client with an installed OwnerBinder carries the OwnerBinding metadata even though the CALL-SITE passed none) and `owner_scoped_write_without_binder_fails_closed` (a SYNCING client with no binder refuses/flags an owner-scoped write — no unbound owner-scoped row can be authored) — AND `grep -rn 'owner_binding_meta' app/src-tauri/src` shows the per-call-site stamping removed from the write paths (binding is now the client invariant); `cargo build -p aven-db -p aven-node -p aven-os-app --features desktop-ai` exits 0 and the aven-db + aven-node suites stay green; relay `verify_on_apply` remains fail-closed on ALL owner-scoped tables (no exemptions). Live proof (runtime, recorded in the card): a fresh device completes first-human onboarding against the relay with ZERO `relay-deny[no-binding]` and `grant_first_human_admin` fires."
---

# Owner-binding as a client-layer invariant

## Context

Debugging the live relay (clean release-104 deploy) found first-human onboarding fully broken: the
log floods `relay-deny[no-binding]: spark-scoped row missing owner-binding table=keyshares … DenyPermanent`,
**no `granted FIRST human SAFE admin`** ever fires, and avenCEO's only owner is the **server key**
(`did:key:z6Mkvy…qpp3`) — so a fresh mac/iOS/Linux can't claim admin.

**Root cause (confirmed):** the merged *"enforce owner-binding system-wide"* change made the relay's
`verify_on_apply` **fail-closed on every owner-scoped table** (correct — KEEP IT; the relay verifies
*authenticity + integrity* of each row via the author's pubkey, no DEK needed). But on the client,
owner-bindings are stamped **manually, per IPC call-site** (`owner_binding_meta(...)` passed into
`create_checked_with_id_and_metadata` / `update_with_metadata`). Most paths remember; **three `signers`
writes forgot**:
- `app/src-tauri/src/signers.rs:195` → `create_checked("signers", …)` (no binding)
- `app/src-tauri/src/signers.rs:229` → `update(oid, …)` (no binding)
- `app/src-tauri/src/avendb/engine.rs:1318` → `create_checked("signers", …)` (no binding)

`signers` is owner-scoped, so the relay `DenyPermanent`s those unbound rows → the device's signer
never lands → `grant_first_human_admin` (aven_ceo.rs:312) finds no synced human SAFE → never grants.
(Not a build/feature regression — the merge flipped the relay to fail-closed, *exposing* pre-existing
unbound writes that the old fail-open relay silently accepted.)

**Architecture decision (confirmed with the user):** do NOT exempt trust tables — that's lesser
security, unacceptable in P2P. Enforce binding **everywhere, structurally**: bindings must be a
**client-layer invariant**, not a per-call-site chore (which was forgotten and will be again). aven-db
ALREADY has the exact pattern: an injected **`EditSigner`** (`set_edit_signer`) that the engine
auto-invokes on every write to stamp the edit-sig, plus exported `is_owner_scoped_table` /
`owner_scoped_table_names` / `owner_invariant_ok`. The owner-binder is its direct analogue.

## Goal

No write to an owner-scoped table can be unbound — guaranteed at one layer, so onboarding (and every
future path) carries a valid owner-binding by construction, and the relay can stay fail-closed
everywhere. Completion = the frontmatter `goal:`.

## Approach (DRY/SSOT — one layer, mirror the EditSigner)

- **aven-db:** add an `OwnerBinder` trait (capability.rs, analogue of `EditSigner`):
  `fn bind_row(&self, row_id: ObjectId, owner: Uuid) -> Option<(String, String)>` returning the
  `OWNER_BINDING_META_KEY` + serialized binding. Add `AvenDbClient::set_owner_binder(...)`. In the
  engine write path, for any **owner-scoped** row (`is_owner_scoped_table`), read the row's `owner`
  cell and auto-invoke the binder, stamping the binding into the batch metadata — exactly where/how
  the edit-sig is stamped. Non-owner-scoped tables: untouched.
- **Fail-closed backstop:** a SYNCING client (real `SyncTransport`) with **no** owner-binder installed
  must refuse/flag an owner-scoped write (a missing binder is a config error). Local/headless
  (`NullSyncTransport`, tests) may write unbound since they never reach a fail-closed relay.
- **App:** install an aven-caps-backed `AppOwnerBinder` (`mint_owner_binding(device_key, row_id, owner)`)
  right next to `set_edit_signer` (avendb/mod.rs:381). Then **remove the manual `owner_binding_meta`
  passing** from the IPC call-sites (DRY — the invariant owns it); keep `*_with_metadata` only for
  non-binding metadata.
- **Relay:** unchanged — stays fail-closed on all owner-scoped tables (verify it).

## Steps

1. aven-db `OwnerBinder` trait + `set_owner_binder` + engine auto-stamp on owner-scoped writes; the
   two gating tests (`owner_scoped_write_auto_stamps_binding`, `owner_scoped_write_without_binder_fails_closed`).
2. App: install `AppOwnerBinder`; remove per-call-site `owner_binding_meta` from the write paths
   (incl. the 3 `signers` sites + the others); build green.
3. Runtime proof: fresh device onboards → tail the relay → zero `relay-deny[no-binding]` + grant fires;
   record the result in the card. Redeploy via `release:app:all`/`deploy-aven-node-sprite` if needed.

## Files to touch

- `libs/aven-db/src/capability.rs` (+ `avenos_client.rs`, `runtime_tokio.rs`, engine write path) — the trait + hook.
- `app/src-tauri/src/biscuit_resolver.rs` (the `AppOwnerBinder`, beside `AppEditSigner`) + `avendb/mod.rs` (install).
- `app/src-tauri/src/signers.rs`, `app/src-tauri/src/avendb/engine.rs`, `caps_ipc.rs` — drop manual stamping.

## Acceptance criteria

- [ ] `owner_scoped_write_auto_stamps_binding` passes — owner-scoped write carries the binding with the call-site passing none.
- [ ] `owner_scoped_write_without_binder_fails_closed` passes — a syncing client can't author an unbound owner-scoped row.
- [ ] `grep -rn 'owner_binding_meta' app/src-tauri/src` shows the per-call-site stamping gone from the write paths.
- [ ] `cargo build -p aven-db -p aven-node -p aven-os-app --features desktop-ai` exits 0; aven-db + aven-node suites green.
- [ ] Relay `verify_on_apply` still fail-closed on ALL owner-scoped tables (no exemptions).
- [ ] Live: fresh first-human onboarding → zero `relay-deny[no-binding]`, `grant_first_human_admin` fires (recorded).

## Verification

```
cargo test -p aven-db owner_binder
cargo build -p aven-db -p aven-node -p aven-os-app --features desktop-ai
grep -rn "owner_binding_meta" app/src-tauri/src   # expect: gone from write paths
# runtime: sprite exec -s aven-ceo -- tail -f /.sprite/logs/services/aven-node.log  (no relay-deny[no-binding]; "granted FIRST human")
```

## Progress log

- `2026-06-14` — Discovery: root-caused the broken onboarding to manual per-call-site owner-binding
  stamping (3 `signers` sites forgot) vs the now-fail-closed relay. Confirmed the architecture with the
  user: enforce binding EVERYWHERE via a client-layer auto-binder (mirror the EditSigner), never exempt
  trust tables. Measurable: auto-stamp test + no-unbound-write test + onboarding live proof.

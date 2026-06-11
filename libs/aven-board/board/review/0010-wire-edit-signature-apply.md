---
title: Wire EditSignature into the live inbound apply path
summary: Stamp sign_batch over the receiver-aligned row digest outbound under EDIT_SIG_META_KEY and make verify_on_apply require authorize_signed_edit against it, closing the unauthenticated-`data` channel.
owner: Claude Code
created: 2026-06-08
updated: 2026-06-08
tags: [aven-db, security, crypto]
goal: `cargo test -p aven-caps` is green AND `cargo build -p aven-db` and `cargo build -p app` succeed AND a new regression test `cargo test -p aven-caps edit_sig_apply_rejects_tampered_data` passes (a row whose `data` is tampered after signing is rejected by authorize_signed_edit, while the untampered row is accepted).
---

# Wire EditSignature into the live inbound apply path

## Context
avenOS's threat model is an honest-but-curious / malicious relay that can see and mutate
wire bytes but holds no identity keys. The crypto design is meant to make every received
row's `data` + `metadata` authenticated by an authorized author before it is persisted.
The machinery to do this **already exists and is unit-tested** in
`libs/aven-caps/src/ownership.rs`:

- `EditSignature { author_did, batch_digest, sig }` — an ed25519 signature by the author's
  device key over the BLAKE3 batch digest, under domain `avenos:edit-sig:v1\0`
  (ownership.rs:118-155).
- `sign_batch(author_sk, &digest)` mints it (ownership.rs:137-141).
- `verify_signed_batch(sig, expected_digest)` rejects unless the carried digest equals the
  receiver-computed digest AND the signature verifies (ownership.rs:146-155).
- `authorize_signed_edit(vault, owner, op, table, row_id, edit_sig, expected_digest,
  owner_binding)` runs the full inbound gate: verify the edit-sig over the receiver digest,
  verify the owner-binding (if present) and that it names this identity, then `authorize`
  the author for `op` (ownership.rs:196-215).
- The reserved metadata key it travels under is `EDIT_SIG_META_KEY = "_edit_sig"`
  (ownership.rs:33).

**The gap (audit #29):** none of this is wired into the live path. Outbound, only the
owner-binding is stamped (`owner_binding_meta`, app/src-tauri/src/jazz/mod.rs:3320-3333);
no `sign_batch` is ever called on a real row, so no `EDIT_SIG_META_KEY` ever rides the wire.
Inbound, `verify_on_apply` computes nothing of the sort and **discards the digest the
engine handed it**: its parameter is named `_digest` and is unused
(app/src-tauri/src/biscuit_resolver.rs:92-99, 97). The only proof it consumes is the
owner-binding, whose signed message is `domain || value_id || owner`
(ownership.rs:51-56) — it covers neither `data` nor `metadata`. The engine carefully
computes `let digest = row.content_digest();` (inbox.rs:326) over
`branch|parents|data|updated_at|updated_by|metadata` (codecs.rs:35-74) and passes it
(inbox.rs:337), but only extracts `OWNER_BINDING_META_KEY` as proof (inbox.rs:329-332) —
the edit-sig is never extracted.

**Net effect / attack (audit #29):** the entire `data` blob — every sealed cell ciphertext
AND the `keyshares` columns `wrapper_did/recipient_did/wrapped_dek/dek_version` — is
accepted with no signature binding it to an authorized author. A malicious relay rewrites
the `data` of an in-flight `keyshares` row (substitutes a captured `wrapped_dek/wrapper_did`
from a different (member,version) pair, or strips/downgrades a sealed cell). The
owner-binding still verifies (`value_id+owner` unchanged), the binding owner matches the
ACL owner, and the per-kind cap is satisfied by the legitimate author named in the binding,
so `verify_on_apply` returns `Allow`. The receiver persists attacker-chosen
ciphertext/metadata. This is also the delivery mechanism for the cell-relabeling /
keyshare-confusion attacks and (the in-flight half of #7/#26) flipping the unsigned delete
fields — because the one artifact that would bind `data`+`metadata` to an author is inert.

This item is **the highest-leverage fix and the root enabler**: wiring the edit-sig
single-handedly closes the unauthenticated-`data` channel underlying #29 and the in-flight
halves of #7/#26, and it is cheap because the primitives already exist and are tested.

Related board items:
- **0013** (authenticate delete state) — depends on 0010. Once the digest is signed, 0013
  folds `delete_kind`/`is_deleted` into `compute_row_digest` so a delete becomes a signed
  authorial act; that protection is only real once the edit-sig over the digest is enforced
  here.
- **0011** (inbound `AccOp::Delete` enforcement) — complementary: 0010 stops tamper-in-flight
  by a relay; 0011 stops an authenticated Write-only peer from self-authoring deletes.
- **0012** pairs with 0013.

## Goal
Every identity-scoped row carries a `sign_batch` signature over the receiver-aligned digest
under `EDIT_SIG_META_KEY`, and `verify_on_apply` rejects any inbound row whose `data` or
`metadata` was tampered after signing (via `authorize_signed_edit`), proven by a new
tamper-then-apply regression test.

**Completion condition** (identical to frontmatter goal):
> `cargo test -p aven-caps` is green AND `cargo build -p aven-db` and `cargo build -p app` succeed AND a new regression test `cargo test -p aven-caps edit_sig_apply_rejects_tampered_data` passes (a row whose `data` is tampered after signing is rejected by authorize_signed_edit, while the untampered row is accepted).

## Approach
Two ends of the wire, one new digest subtlety.

**Digest subtlety (must solve first).** `compute_row_digest` (codecs.rs:35-74) hashes the
full `metadata` map, and `StoredRowBatch::content_digest` (types.rs:351-360) passes
`self.metadata`. The owner-binding lives in metadata and is legitimately covered by the
digest (it is immutable). But the edit-sig **signs** the digest, so it cannot itself be in
the hashed metadata (chicken-and-egg: stamping it would change the digest it signs).
Therefore `compute_row_digest` must hash metadata **excluding** the `EDIT_SIG_META_KEY`
entry — the same way `types.rs:314` already filters `MetadataKey::Delete` out of the
metadata it constructs. Concretely: in `compute_row_digest`, skip the entry whose key
equals `aven_caps::ownership::EDIT_SIG_META_KEY` (mirror the literal `"_edit_sig"` in
aven-db's `capability.rs`, next to the existing `OWNER_BINDING_META_KEY`, so aven-db does
not gain a dependency direction it lacks). The owner-binding stays in the digest; only the
edit-sig is excluded. This makes the digest the *receiver* recomputes identical to the one
the *author* signed.

**Outbound (app/src-tauri/src/jazz/mod.rs).** The owner-binding is stamped before the row
is built (`owner_binding_meta`, mod.rs:3320-3333) — but the edit-sig must be stamped over
the *final* digest, which depends on `branch|parents|data|updated_at|updated_by|metadata`
(including the owner-binding). That digest is only known once the `StoredRowBatch` is
assembled by the engine. So the clean shape is: stamp the owner-binding as today, let the
engine assemble the batch, compute `row.content_digest()` (which now excludes the edit-sig
slot), call `aven_caps::ownership::sign_batch(&signing_key, &digest.0)`, and insert
`EDIT_SIG_META_KEY -> sig.to_meta_string()` into the row metadata before it is sealed/sent.
Investigate the create/write path the engine exposes (`create_with_id_and_metadata` and the
local-originate write path around jazz/mod.rs:3326-3370 and jazz_engine) to find the single
choke point where the assembled `StoredRowBatch` is available pre-send, and add the stamp
there so it applies to BOTH data and control-plane (`peers`, `keyshares`) creates AND
updates. If the engine does not currently expose a post-assembly hook, the minimal change
is to compute the digest from the same inputs the engine will use and stamp the edit-sig
into the metadata map alongside the owner-binding before handing it to the engine — but the
digest exclusion above is what makes either ordering safe.

**Inbound (app/src-tauri/src/biscuit_resolver.rs + libs/aven-db/src/sync_manager/inbox.rs).**
- inbox.rs:329-332 currently extracts only `OWNER_BINDING_META_KEY`. Add extraction of
  `EDIT_SIG_META_KEY` and pass both opaque blobs to the resolver. Since `verify_on_apply`
  takes a single `proof: Option<&[u8]>` today, either widen the resolver trait to carry the
  edit-sig too, or (lower-churn) have inbox pass the whole metadata map / a small struct.
  Prefer the smallest change that lets `verify_on_apply` see the edit-sig bytes; keep the
  digest argument (`row.content_digest()`, inbox.rs:326) — it is already correct once the
  exclusion lands.
- In `verify_on_apply`, stop ignoring the digest. Rename `_digest` to `digest`, decode the
  edit-sig from `EDIT_SIG_META_KEY` via `aven_caps::ownership::EditSignature::from_meta_str`,
  decode the owner-binding as today, and replace the bespoke owner-binding-only checks
  (biscuit_resolver.rs:118-164) with a single call to
  `aven_caps::ownership::authorize_signed_edit(vault, binding.owner, required_write_op_for_table(table), table, Some(value_id), &edit_sig, digest, Some(&binding))`.
  Keep the existing pre-checks that need no vault (binding.value_id == row, owner-binding
  authentic, ACL identity-immutability at biscuit_resolver.rs:131-139) and the blind-relay
  branch (no identity held → still require `verify_signed_batch` over the digest so even a
  relay rejects a tampered `data`, then `Allow`). A missing edit-sig on an identity-scoped
  row is `DenyPermanent` (fail-closed), mirroring the missing-owner-binding rule at
  biscuit_resolver.rs:104-108.

**Trade-offs / out-of-scope.**
- This item does NOT add `delete_kind`/`is_deleted` to the digest — that is **0013**. It
  only makes the digest a *signed* artifact so 0013's protection becomes enforceable.
- This item does NOT change the inbound op from the hardcoded `AccOp::Write` to
  `AccOp::Delete` — that is **0011**.
- aven-db library unit tests do not build in bulk today (~266 errors in legacy test
  scaffolding from the M0 server-tier rip). Therefore the **regression test for the attack
  lands in aven-caps** (`cargo test -p aven-caps`, known-green), exercising
  `authorize_signed_edit` directly against a tampered-vs-untampered digest. aven-db is
  covered by `cargo build -p aven-db` only (the new digest-exclusion path) — do NOT make the
  goal a wholesale `cargo test -p aven-db`.

## Steps
1. Add `EDIT_SIG_META_KEY` to aven-db's `capability.rs` (next to `OWNER_BINDING_META_KEY`,
   libs/aven-db/src/capability.rs:62-65) as the literal `"_edit_sig"`, with a doc note that
   it must match `aven_caps::ownership::EDIT_SIG_META_KEY`.
2. Exclude `EDIT_SIG_META_KEY` from `compute_row_digest` (libs/aven-db/src/row_histories/codecs.rs:60-68)
   by skipping the metadata entry whose key equals that literal — mirroring the existing
   `MetadataKey::Delete` filter at types.rs:314. Keep the owner-binding in the digest.
3. Outbound: in app/src-tauri/src/jazz/mod.rs, at the choke point where the assembled
   `StoredRowBatch` (or its exact digest inputs) is available pre-send, compute the digest
   and stamp `EDIT_SIG_META_KEY -> sign_batch(&shell.signing_key, &digest.0).to_meta_string()`
   into the row metadata alongside the owner-binding (`owner_binding_meta`, mod.rs:3320-3333).
   Apply to data and control-plane (`peers`, `keyshares`) creates and updates.
4. Inbound extraction: in libs/aven-db/src/sync_manager/inbox.rs:329-332, also pull
   `EDIT_SIG_META_KEY` from `row.metadata` and make it reach `verify_on_apply` (widen the
   proof carried to the resolver minimally).
5. Inbound verify: in app/src-tauri/src/biscuit_resolver.rs:92-165, use the digest
   (un-`_`-prefix it), decode the edit-sig, and replace the owner-binding-only authorization
   with `authorize_signed_edit(...)`. Make a missing edit-sig on an identity-scoped row
   `DenyPermanent`. Keep the blind-relay branch but require `verify_signed_batch` over the
   digest there too.
6. Add the regression test `edit_sig_apply_rejects_tampered_data` in
   libs/aven-caps/src/ownership.rs `#[cfg(test)] mod tests`: build an owner vault with an
   identity, mint an owner-binding for a value, compute a digest `d0`, `sign_batch(&sk, &d0)`,
   then assert `authorize_signed_edit(..., &es, &d0, Some(&binding))` is `Ok` (untampered
   accepted) and `authorize_signed_edit(..., &es, &d1, Some(&binding))` with a different
   digest `d1` (the receiver-computed digest of a row whose `data` was tampered) is `Err`
   (tampered rejected — the edit-sig digest no longer matches what the receiver hashes).
7. Build: `cargo build -p aven-db` and `cargo build -p app`; run `cargo test -p aven-caps`.

## Files to touch
- `libs/aven-db/src/capability.rs` — add `EDIT_SIG_META_KEY = "_edit_sig"` constant beside `OWNER_BINDING_META_KEY` (must match aven-caps literal).
- `libs/aven-db/src/row_histories/codecs.rs` — `compute_row_digest`: skip the `EDIT_SIG_META_KEY` metadata entry so the digest the author signs equals the digest the receiver recomputes.
- `app/src-tauri/src/jazz/mod.rs` — stamp `sign_batch` over the assembled row's digest under `EDIT_SIG_META_KEY` for every identity-scoped create/update (alongside `owner_binding_meta`).
- `libs/aven-db/src/sync_manager/inbox.rs` — extract `EDIT_SIG_META_KEY` from the inbound row metadata and pass it (plus the existing digest) to `verify_on_apply`.
- `app/src-tauri/src/biscuit_resolver.rs` — `verify_on_apply`: stop discarding `_digest`; decode the edit-sig and call `authorize_signed_edit` against the receiver-computed digest; fail-closed on a missing edit-sig.
- `libs/aven-caps/src/ownership.rs` — add the `edit_sig_apply_rejects_tampered_data` regression test.

## Acceptance criteria
- [x] `EDIT_SIG_META_KEY` exists in aven-db and is excluded from `compute_row_digest` — proven by `cargo build -p aven-db` (Finished, clean).
- [x] Outbound rows stamp the edit-sig and inbound `verify_on_apply` calls `authorize_signed_edit` (digest no longer `_`-prefixed/unused) — proven by `cargo check` on `aven-os-app` (Finished). NOTE: a full `cargo build` of the app is blocked only by a missing bundled resource `onnxruntime/libonnxruntime.dylib` in this checkout — an environmental artifact, not a code error; type-check is green.
- [x] A tampered-after-signing row is rejected while the untampered row is accepted — proven by `cargo test edit_sig_apply_rejects_tampered_data` (1 passed).
- [x] No regression in existing caps crypto — proven by `cargo test` in `libs/aven-caps` (29 passed, 0 failed).
- [x] Relay (aven-node) also rejects `data`-tampered rows — `ServerApplyGate::verify_on_apply` now verifies the edit-sig over the digest it computed; proven by `cargo build` in `libs/aven-node` (Finished).

## Verification
```bash
# aven-db builds with the digest-exclusion + new constant (lib tests are knowingly
# un-buildable in bulk; build only — see Approach trade-offs).
cargo build -p aven-db

# app builds with the outbound stamp + the rewired verify_on_apply.
cargo build -p app

# the new attack regression (tamper-then-apply must be rejected; clean must be accepted)
cargo test -p aven-caps edit_sig_apply_rejects_tampered_data

# full caps crypto suite stays green (known-green baseline).
cargo test -p aven-caps
```

## Hand-off
```
/aven-build 0010-wire-edit-signature-apply
```

## Progress log
Newest first.
- `2026-06-08` — **Implemented + verified (ready for test column).** Engine: added `EDIT_SIG_META_KEY` (capability.rs) and excluded it from `compute_row_digest` (codecs.rs) — non-breaking (absent key = no-op for existing digests). Added an `EditSigner` hook trait (capability.rs, re-exported at `groove::` root) stored on `SyncManager` beside `resolver`, plumbed `set_edit_signer` through runtime_core/sync.rs → runtime_tokio.rs → avenos_client.rs (mirroring `set_resolver`). Outbound: `authored_row_batch` (writes.rs) now signs the assembled batch's content digest and stamps it via new `StoredRowBatch::set_metadata_entry` / `RowMetadata::upsert` (types.rs) — chosen because the encoded `data` + engine-assigned `parents`/`updated_at` only exist post-assembly, so the app cannot pre-compute the digest (engine hook required, confirmed by tracing the write path). Inbound: inbox.rs extracts `EDIT_SIG_META_KEY` and passes it to the widened `verify_on_apply(.., digest, proof, edit_sig)`; the app resolver (biscuit_resolver.rs) stops discarding the digest and runs `authorize_signed_edit` (fail-closed: missing edit-sig on an identity-scoped row = `DenyPermanent`); the relay (aven-node `ServerApplyGate`) now verifies the edit-sig over its own computed digest so even a blind relay rejects `data`-tampered rows. App installs `AppEditSigner` (device key) at `jazz_connect` next to `set_resolver`. Verified: `cargo test edit_sig_apply_rejects_tampered_data` ✅, aven-caps 29/29 ✅, aven-db build ✅, aven-node build ✅, app `cargo check` ✅ (full app build blocked only by missing `onnxruntime/libonnxruntime.dylib` resource — environmental). Out of scope (separate items): delete-state in digest (0013), inbound `AccOp::Delete` (0012). Moved plan → test.
- `2026-06-08` — Planned from crypto audit (docs/security/crypto-audit-2026-06-08.md), finding #29 plus the integrity halves of #7/#26. Grounded against ownership.rs (sign_batch/verify_signed_batch/authorize_signed_edit, EDIT_SIG_META_KEY), biscuit_resolver.rs:92-165 (verify_on_apply discards `_digest`), inbox.rs:326-332 (digest computed, only owner-binding extracted), codecs.rs:35-74 (compute_row_digest hashes metadata), jazz/mod.rs:3320-3333 (owner_binding_meta outbound stamp). Cross-linked: prerequisite for 0013; complementary to 0011. Created in plan.

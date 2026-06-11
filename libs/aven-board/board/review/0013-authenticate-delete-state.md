---
title: Authenticate delete_kind / is_deleted on the wire
summary: Fold delete_kind + is_deleted into compute_row_digest as a 1-byte tag so any relay flip of the delete state changes the row digest.
owner: Claude Code
created: 2026-06-08
updated: 2026-06-08
tags: [aven-db, security, crypto]
goal: "`cargo build -p aven-db` succeeds AND `cargo test -p aven-db row_digest_covers_delete_state` passes — the new regression test proves that flipping delete_kind None→Hard, Hard→Soft, or stripping a delete (Some→None) changes compute_row_digest / content_digest, and that two batches differing ONLY in delete_kind/is_deleted no longer collide on digest."
---

# Authenticate delete_kind / is_deleted on the wire

## Context
Audit findings **#7** and **#26** (`docs/security/crypto-audit-2026-06-08.md`, the verifier kept them as duplicate records: `#7 = #26 = "delete state unauthenticated"`). Both are **High**.

`StoredRowBatch` carries two delete fields as plain serde-serialized wire fields:

```rust
// libs/aven-db/src/row_histories/types.rs:208-224
pub struct StoredRowBatch {
    ...
    pub delete_kind: Option<DeleteKind>,  // :220
    pub is_deleted: bool,                  // :221
    pub data: RowBytes,
    pub metadata: RowMetadata,
}
```

These fields are **lifted out of metadata before any digest is computed**. In `new_with_batch_id` (`types.rs:309-316`) the `Delete` metadata key is parsed into `delete_kind` and then *filtered out* of `metadata`:

```rust
let delete_kind = delete_kind_from_metadata(&metadata); // "soft"→Soft, "hard"→Hard
let is_deleted = delete_kind.is_some();
let metadata = RowMetadata::from_hash_map(
    metadata.into_iter()
        .filter(|(key, _)| key != MetadataKey::Delete.as_str()) // :314 — stripped
        .collect(),
);
```

`content_digest` (`types.rs:351-360`) then hashes only the **post-strip** metadata, and `compute_row_digest` (`codecs.rs:35-74`) hashes only:

```
b"row-batch-v1" | branch | parents | data | updated_at | updated_by | metadata
```

So `delete_kind` and `is_deleted` are covered by **no digest** anywhere. The owner-binding signs only `value_id || owner` (`aven-caps/src/ownership.rs:51` `owner_binding_msg`), and the edit-signature (`ownership.rs:122-155`, `EditSignature`/`sign_batch`/`verify_signed_batch`) signs the **digest** — which omits the delete state. Net: the delete fields travel as relay-mutable plaintext bound by nothing the apply gate verifies.

**Attack (carried from the audit).** A relay (Replicate cap; holds ciphertext + plaintext metadata) or a Write-only member captures a victim's legitimately-signed live `StoredRowBatch` and flips `delete_kind` `None → Some(Hard)` + `is_deleted = true`, leaving `branch/parents/data/updated_at/updated_by/metadata` byte-identical. The recomputed `content_digest` is unchanged, so the owner-binding (and any edit-sig) still verifies and `verify_on_apply` passes. `delete_winner` (`resolution.rs:82-104`) ranks `Hard(2) > Soft(1) > live(0)`, so the forged Hard delete wins and the merged row's `data` is cleared to `Vec::new()` (`resolution.rs:381-382`) on every downstream member — a destructive wipe with no key material. The inverse (strip an owner's legitimate delete, `Some → None`) resurrects data the owner intended removed. Downgrade `Hard → Soft` is the same class.

This item closes the **tamper-in-flight** half: make the delete state part of the digest so any flip changes the digest.

**Related items.**
- **DEPENDS ON `0010`** (wire `EditSignature` into the live apply path: stamp `sign_batch` outbound, have `verify_on_apply` compare its computed digest via `authorize_signed_edit` instead of ignoring `_digest` at `capability.rs:131`). Including the delete tag in the digest is only *enforced* once that digest is actually signed outbound and verified on apply. Until `0010` lands, this change is a correct-but-latent prerequisite: the digest covers the delete state, but nothing yet rejects a mismatch.
- **Pairs with `0012`** (enforce `AccOp::Delete` on the inbound apply path — derive the op from `row.delete_kind.is_some()` instead of the hardcoded `AccOp::Write`). `0012` stops an *authenticated* Write-only peer from self-authoring a delete; this item (`0013`) stops *anyone* (relay or peer) from mutating the delete state in flight. Both are needed — neither subsumes the other.

## Goal
`compute_row_digest` and `content_digest` cover `delete_kind` and `is_deleted`, so two `StoredRowBatch`es that differ only in their delete state produce different digests, and a new regression test proves every flip (None→Hard, Hard→Soft, Some→None) is now digest-detectable.

**Completion condition** (identical to frontmatter goal):
> `cargo build -p aven-db` succeeds AND `cargo test -p aven-db row_digest_covers_delete_state` passes — the new regression test proves that flipping delete_kind None→Hard, Hard→Soft, or stripping a delete (Some→None) changes compute_row_digest / content_digest, and that two batches differing ONLY in delete_kind/is_deleted no longer collide on digest.

## Approach
Add the delete state to the hashed preimage in `compute_row_digest` (`libs/aven-db/src/row_histories/codecs.rs`) as a single fixed-position byte, written **after `updated_by` and before the metadata block** so the domain-tag prefix and existing field order stay stable for everything except the new tag.

Encode the delete state in one byte that captures both fields unambiguously:

```
0x00 = live          (delete_kind None,  is_deleted false)
0x01 = soft delete   (delete_kind Some(Soft))
0x02 = hard delete   (delete_kind Some(Hard))
```

To keep `is_deleted` independently authenticated (it is a separate wire field that resolution and visibility read), append `is_deleted as u8` (`0`/`1`) as a second byte after the kind tag. Both bytes are derived from the caller's arguments, so a flip of *either* field changes the digest. This means widening `compute_row_digest`'s signature to take `delete_kind: Option<DeleteKind>` and `is_deleted: bool` (two new params), and updating its single in-tree caller `StoredRowBatch::content_digest` (`types.rs:351-360`) to pass `self.delete_kind` and `self.is_deleted`.

Because `compute_row_digest` is `pub` and re-exported from `row_histories::mod` (`mod.rs:27`), this is a signature change — grep all callers and fix them in the same change (the only non-test caller is `content_digest`).

**Trade-offs / out of scope.**
- This is a **digest preimage change**: it is not backward-compatible with any persisted/queued digest computed by the old function. That is acceptable and intended — there is no on-disk-stable-digest contract here; `content_digest` is recomputed on apply, not stored as a verification anchor across versions. No migration is needed; note it in the progress log.
- **Out of scope:** wiring the edit-signature into apply (that is `0010`) and enforcing `AccOp::Delete` on inbound (that is `0012`). This item only guarantees the digest *covers* the delete state. Proving end-to-end rejection of a tampered delete on the live apply path is `0010`'s acceptance criterion, not this one.
- We do **not** un-strip the `Delete` key back into `metadata` (that would change visible metadata semantics and the resolution/visibility code that reads the struct fields). Adding the byte tag is the minimal, isolated fix.

## Steps
1. In `libs/aven-db/src/row_histories/codecs.rs`, widen `compute_row_digest` to accept `delete_kind: Option<DeleteKind>` and `is_deleted: bool` (`DeleteKind` is already imported at `codecs.rs:10`). After the `updated_by` update (currently `codecs.rs:58`) and before the `metadata` block (`codecs.rs:60`), write `hasher.update(&[kind_tag])` where `kind_tag` is `0x00/0x01/0x02` per the None/Soft/Hard mapping, then `hasher.update(&[is_deleted as u8])`.
2. Update the only caller, `StoredRowBatch::content_digest` (`libs/aven-db/src/row_histories/types.rs:351-360`), to pass `self.delete_kind` and `self.is_deleted`.
3. `grep -rn "compute_row_digest" libs/aven-db/src` to confirm no other callers break; fix any (expected: none outside `content_digest` + the re-export line in `mod.rs:27`).
4. Add a regression test `row_digest_covers_delete_state` in a `#[cfg(test)] mod tests` in `codecs.rs` (it can call `compute_row_digest` directly with fixed args, so it does not depend on the broken `aven-db` bulk test scaffolding — see caveat). The test must assert:
   - `live_digest != hard_digest` (None → Hard flip is detectable),
   - `hard_digest != soft_digest` (Hard → Soft downgrade is detectable),
   - `soft_digest != live_digest` (Some → None strip / resurrect is detectable),
   - a `is_deleted=true` vs `is_deleted=false` pair (kind held equal) yields different digests,
   - all other arguments held byte-identical across the pairs, so the digest difference is attributable *only* to the delete state.
5. `cargo build -p aven-db` then `cargo test -p aven-db row_digest_covers_delete_state`.
6. (Sanity, complementary, known-green) `cargo test -p aven-caps` to confirm the caps crate that owns the signature machinery still builds/passes — establishes the digest this feeds into is the one `0010` will sign.

## Files to touch
- `libs/aven-db/src/row_histories/codecs.rs` — widen `compute_row_digest` signature; hash a 1-byte kind tag (None/Soft/Hard → 0x00/0x01/0x02) + a 1-byte `is_deleted` after `updated_by`, before metadata; add `#[cfg(test)] mod tests` with `row_digest_covers_delete_state`.
- `libs/aven-db/src/row_histories/types.rs` — update `StoredRowBatch::content_digest` (`:351-360`) to forward `self.delete_kind` and `self.is_deleted` to the widened `compute_row_digest`.

## Acceptance criteria
- [x] `compute_row_digest` hashes a delete-kind tag byte (None/Soft/Hard → 0x00/0x01/0x02) and an `is_deleted` byte after `updated_by` — proven by `cargo build` in `libs/aven-db` (Finished).
- [x] `content_digest` forwards the row's `delete_kind`/`is_deleted` — proven by `cargo build` in `libs/aven-db` (the caller would not compile otherwise).
- [x] New regression test `row_digest_covers_delete_state` proves None→Hard, Hard→Soft, Some→None, and is_deleted-only flips each change the digest, with all other fields held identical — proven by `cargo test row_digest_covers_delete_state` (1 passed). NOTE: the aven-db lib test target now COMPILES (main's "drop sqlite backend" refactor fixed the legacy ~266-error scaffolding), so this runs in-crate as the goal specified — 697 other aven-db tests also passed.
- [x] No other `compute_row_digest` caller is left mis-arity — clean `cargo build` in `libs/aven-db`; only caller is `content_digest`.
- [x] `cargo test` in `libs/aven-caps` still green (31 passed) — the digest this feeds into is the one 0010 signs.

## Verification
```bash
# Build the touched crate (the broad aven-db --lib test suite is known-broken by legacy
# scaffolding, ~266 errors — DO NOT run `cargo test -p aven-db` wholesale; we target the
# one new test by name, which lives in a self-contained mod and does not need that scaffolding).
cargo build -p aven-db

# The attack-regression: every delete-state flip must change the digest.
cargo test -p aven-db row_digest_covers_delete_state

# Confirm the only in-tree caller was updated (build above already enforces arity; this is the audit trail).
grep -rn "compute_row_digest" libs/aven-db/src

# Sanity: the caps crate that owns sign_batch/verify_signed_batch (what 0010 will feed this digest into) is still green.
cargo test -p aven-caps
```

## Hand-off
```
/aven-build 0013-authenticate-delete-state
```

## Progress log
Newest first.
- `2026-06-08` — **Implemented + verified (ready for test column).** Widened `compute_row_digest` (codecs.rs) with `delete_kind: Option<DeleteKind>` + `is_deleted: bool`, hashing a 2-byte preimage (kind tag 0x00/0x01/0x02 + is_deleted) after `updated_by`, before the metadata block; updated the sole caller `StoredRowBatch::content_digest` (types.rs) to forward `self.delete_kind`/`self.is_deleted`. Added self-contained `row_digest_covers_delete_state` test in codecs.rs. Now that 0010 stamps+verifies the edit-sig over this digest, a relay flipping `delete_kind` in flight changes the receiver-computed digest → edit-sig mismatch → rejected. Verified: `cargo test row_digest_covers_delete_state` ✅ (+697 aven-db tests passed — the lib test target compiles again post-refactor), aven-db build ✅, aven-caps 31/31 ✅, app type-check ✅. Pairs with 0012. Moved plan → test.
- `2026-06-08` — Planned from crypto audit (docs/security/crypto-audit-2026-06-08.md), findings #7/#26. Grounded against current source: code lives in `row_histories/` (not `sync_manager/` as the audit's line refs say). Confirmed `compute_row_digest` at `codecs.rs:35-74` omits delete fields; `new_with_batch_id` strips the Delete key at `types.rs:314`; `content_digest` at `types.rs:351-360`; `delete_winner` ranks Hard>Soft at `resolution.rs:82-104`; `DeleteKind{Soft,Hard}` at `metadata.rs:104`. Noted dependency on 0010 (digest must be signed+verified to enforce) and pairing with 0012 (inbound AccOp::Delete). Created in plan.

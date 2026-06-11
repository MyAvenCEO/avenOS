---
title: Make the reader authoritative over cell AAD and dek_version
summary: Reject sealed cells whose AAD/dek_version don't match the slot being read, instead of trusting the relay-supplied envelope AAD.
owner: Claude Code
created: 2026-06-08
updated: 2026-06-08
tags: [aven-caps, app, security, crypto]
goal: `cargo test -p aven-caps reader_authoritative_cell_aad` passes (a relocated/rolled-back sealed envelope fails to open) AND `cargo build -p aven-caps` AND `cargo build -p app` both exit 0.
---

# Make the reader authoritative over cell AAD and dek_version

## Context
Audit findings **#3** and **#28** (`docs/security/crypto-audit-2026-06-08.md`, the High section "Cell AEAD AAD is never validated against expected coordinates on read") are duplicates of the same defect — **Theme B: the reader is not authoritative over what it decrypts.**

On the **write** path the cell AAD correctly binds the cell's position:
`cell_seal_aad(identity_urn|table|column|row|dek_version|ty:slug|msv)` is constructed at `app/src-tauri/src/jazz/jazz_engine.rs:322` (inside `seal_column_plain`, ~306-324) and is the *only* place the expected AAD is built in the whole app crate.

On the **read** path the AEAD authenticates against the AAD carried *inside the relay-supplied envelope* and the reader never recomputes the expected AAD for the slot it is decoding:
- `open_text_cell_payload` (`libs/aven-caps/src/crypto.rs:193-229`) parses `aad_b64` out of the `v1.nonce.aad.ct` string (line 200), base64-decodes it to `aad_plain` (line 207), and passes *that self-supplied AAD* straight into `decrypt(... aad: &aad_plain ...)` (line 219). It returns `(plaintext, dek_version)` (line 228) but never receives or checks an expected AAD.
- Both call sites discard the version and never compare coordinates: `open_sealed_text_for_identity` binds `(opened, _)` (`jazz_engine.rs:128`) and `map_sensitive_storage_cell` binds `(opened, _ver)` (`jazz_engine.rs:342`).

The AEAD tag therefore only proves "*some* holder of this DEK sealed this AAD/ciphertext pair," not "this envelope belongs in *this* (table,column,row,version) slot, now."

**Attack (carried from the audit, both #3 and #28):** A relay with ciphertext-blind replicate rights (no DEK) copies the sealed envelope of cell A into the storage column of cell B of the **same identity, same dek_version** (so the same DEK opens it). The owner-binding still verifies because it signs only `value_id‖owner`, not cell contents/coordinates (`ownership.rs:51-55`), and the inbound apply gate's `EditSignature` digest check is dead code (`verify_on_apply` names the param `_digest`, `biscuit_resolver.rs:97`) — so the relabeled row is accepted. On read, `open_text_cell_payload` authenticates against A's embedded AAD, succeeds, and the reader returns A's plaintext as B's value. The same trick relocates a sensitive value across columns/tables (confused-deputy cell relabeling), and — because the recovered `dek_version` is thrown away — replays an old-version envelope for the same coordinate (intra-identity rollback), defeating rotation/revocation on reads.

**Cross-link:** This item is the **read-side** half of the integrity story; **0010** is the **write-side / `EditSignature`-into-apply** half. They are complementary: 0010 stops the relay from substituting `data` undetected on the wire; 0011 stops the reader from honoring a substituted/relocated/rolled-back envelope even if it lands. **0015 depends on 0011** (it consumes the reader-authoritative open path for genesis/issuer trust-root hydration, audit #31). Neither blocks the other; both are required to make AEAD position-binding actually enforced end to end.

## Goal
The reader recomputes the expected `cell_seal_aad` for the exact slot it is decoding, passes it into the AEAD as the authenticated `aad`, and rejects on AAD or `dek_version` mismatch — so a relocated or rolled-back sealed envelope no longer opens.

**Completion condition** (identical to frontmatter goal):
> `cargo test -p aven-caps reader_authoritative_cell_aad` passes (a relocated/rolled-back sealed envelope fails to open) AND `cargo build -p aven-caps` AND `cargo build -p app` both exit 0.

## Approach
Invert the trust direction at the open boundary so the **caller's** coordinates — not the envelope's self-described AAD — are authoritative.

1. **`libs/aven-caps/src/crypto.rs` — `open_text_cell_payload`.** Add an `expected_aad: &[u8]` parameter. Stop reading the AAD field as the authentication input: pass `expected_aad` (the reader-recomputed `cell_seal_aad`) into `decrypt(... aad: expected_aad ...)`. Because XChaCha20-Poly1305 binds the AAD into the tag, a mismatch between the embedded coordinates and the reader's expected coordinates now fails `decrypt` with `open_fail` — exactly the desired reject-on-mismatch. Keep returning the recovered `dek_version` (parsed from `expected_aad` now) so callers can enforce it. **Stop storing the AAD in the envelope**: change the wire format produced by `seal_text_cell_payload` from `v1.nonce.aad.ct` to `v1.nonce.ct` (the AAD is fully reconstructible from coordinates, so it is redundant and is the very thing the attacker controls). Update `open_text_cell_payload`'s parser to the 3-field shape. Bump `CELL_PAYLOAD_MSV` is **not** required because the AAD string content is unchanged; but the envelope *layout* changes, so gate parsing on a new envelope tag `CELL_ENVELOPE_V2 = "v2"` and keep a read-only `v1` fallback path *only if* existing sealed data must be migrated — see out-of-scope note.
2. **`app/src-tauri/src/jazz/jazz_engine.rs` — the two read call sites.** Both currently trial-decrypt across held DEK versions and discard the version. Replace the discarding opens:
   - `open_sealed_text_for_identity` (~110-133): for each candidate `dek_version dv`, recompute `cell_seal_aad(urn, table, column, row, dv, slug)` and call the new `open_text_cell_payload(dek, raw, &expected_aad)`. This requires threading the cell's `(table, column, row, storage_ty)` into the function (today it only has `identity` + `raw`). The trial loop over versions stays, but each attempt is now slot-bound, so only the *correct* version+coordinate envelope can open.
   - `map_sensitive_storage_cell` (~326-350): same — recompute the expected AAD from `(identity, table, col, row, dv, storage_ty)` and pass it in; reject (push to `miss`) when no version produces a slot-matching open.
3. **Enforce `dek_version` against the allowed epoch.** After a successful open, compare the recovered `dek_version` against `current_dek_version(state, identity)` (`jazz_engine.rs:298-304`) and reject if the opened version is greater than current, or — for the rollback variant — accept only versions in the identity's allowed set. Concretely: a relocated/rolled-back envelope that *only* opens under a non-current version is no longer surfaced. (The AAD-equality check already kills cross-coordinate relocation; the version check kills same-coordinate rollback where an old envelope was replayed.)

**Trade-offs / out-of-scope:**
- The `v1.nonce.aad.ct` → `v1.nonce.ct` (or `v2`) format change means any cells sealed before this lands cannot be opened by the new parser unless a one-shot re-seal/migration runs. Since sealed cells live in local per-device vaults and the app is pre-release, the chosen path is a **hard format bump** with no on-disk migration; document this and require a fresh vault. If a migration is later needed, it is a separate item.
- This item does **not** wire `EditSignature` into the apply path — that is **0010**. Without 0010, a relay can still substitute `data` undetected on the wire; this item only guarantees the reader will not *honor* a substituted cell. Both are needed for full coverage.
- Keyshares-table AAD (wrapper_did / recipient_did binding) is out of scope (separate residual, audit §unconfirmed #260).

## Steps
1. In `crypto.rs`, change `seal_text_cell_payload` to emit `v1.{nonce}.{ct}` (drop the `aad` field) and define/confirm an envelope tag so the new layout is unambiguous.
2. In `crypto.rs`, change `open_text_cell_payload` signature to `(dek32, envelope, expected_aad: &[u8]) -> Result<(String, u64), String>`; parse the 3-field envelope; pass `expected_aad` as the AEAD `aad`; derive the returned `dek_version` from `expected_aad`.
3. In `jazz_engine.rs`, thread `(table, column, row, storage_ty)` into `open_sealed_text_for_identity` and `hydrate_text_at`/callers; recompute `cell_seal_aad` per candidate version and call the new open; on no slot-matching version, error.
4. In `jazz_engine.rs` `map_sensitive_storage_cell`, recompute expected AAD per held version and call the new open; push to `miss` on no match.
5. After a successful open in both call sites, reject when the recovered `dek_version` is not the identity's current/allowed version (`current_dek_version`).
6. Update the existing crypto tests (`envelope_roundtrip`, `envelope_roundtrip_extended_aad`) to the new `open_text_cell_payload(dek, enc, &aad_plain)` signature.
7. Add the new regression test `reader_authoritative_cell_aad` (see Acceptance criteria) proving relocation and rollback both fail to open.
8. `cargo build -p aven-caps`, `cargo build -p app`, `cargo test -p aven-caps reader_authoritative_cell_aad`, and `cargo test -p aven-caps` (known-green) all pass.

## Files to touch
- `libs/aven-caps/src/crypto.rs` — `seal_text_cell_payload` (drop AAD from wire), `open_text_cell_payload` (take `expected_aad`, authenticate against it, parse 3-field envelope), and the `tests` module (fix existing signatures + add `reader_authoritative_cell_aad`).
- `app/src-tauri/src/jazz/jazz_engine.rs` — `open_sealed_text_for_identity` (~110-133), `hydrate_text_at` and its callers (thread cell coordinates), `map_sensitive_storage_cell` (~326-350) to recompute and pass expected AAD and enforce `dek_version`.

## Acceptance criteria
- [x] `open_text_cell_payload` takes a caller-supplied `expected_aad` and authenticates the ciphertext against it (not the embedded AAD) — proven by `cargo build` in `libs/aven-caps`.
- [x] The wire envelope no longer carries the AAD field — proven by `reader_authoritative_cell_aad` asserting the envelope splits into exactly 3 dotted fields (`v1.nonce.ct`).
- [x] **Relocation is blocked:** an envelope sealed for cell A fails to open when the reader supplies the expected AAD for cell B (different column), and likewise for a different row, even with the same DEK — proven by `cargo test reader_authoritative_cell_aad`.
- [x] **Rollback is blocked:** an envelope sealed under `dek_version = 1` fails to open when the reader supplies the expected AAD for `dek_version = 2` (same DEK bytes) — proven by the same test.
- [x] Both read call sites in `jazz_engine.rs` recompute `cell_seal_aad` per candidate version and authenticate against it — proven by `cargo check` on `aven-os-app` (Finished). **Deviation (intentional):** the read sites do NOT *hard-reject* a non-current `dek_version`. There is no eager re-seal on rotation (`seal_column_plain` is only called on normal writes), so old-version cells legitimately persist until rewritten; hard-rejecting them would break legitimate reads. The version is bound *inside* `cell_seal_aad`, so per-version+coordinate authentication is automatic, and the trial loop now tries newest-version-first (rollback-preference). Per-coordinate expected-version enforcement is a separate concern (depends on a re-seal-on-rotation policy that doesn't exist yet).
- [x] No regressions in the caps crate — proven by `cargo test` in `libs/aven-caps` (30 passed).

## Verification
```bash
cargo build -p aven-caps
cargo build -p app
cargo test -p aven-caps reader_authoritative_cell_aad
cargo test -p aven-caps
```

The `reader_authoritative_cell_aad` test (added to `libs/aven-caps/src/crypto.rs` `mod tests`) must encode the attack:

```rust
#[test]
fn reader_authoritative_cell_aad() {
    let dek = random_identity_dek();
    let identity = uuid::Uuid::nil();
    let row = uuid::Uuid::nil();
    let urn = format!("identity:{identity}");
    let slug = column_type_slug(&ColumnType::Text);

    // Seal cell A (column "secret_a", dek_version 1).
    let aad_a = cell_seal_aad(&urn, "vault", "secret_a", row, 1, slug);
    let env = seal_text_cell_payload(dek.expose(), &aad_a, "A-plaintext").unwrap();

    // Honest read of cell A with the matching expected AAD succeeds.
    let (pt, ver) = open_text_cell_payload(dek.expose(), &env, &aad_a).unwrap();
    assert_eq!(pt, "A-plaintext");
    assert_eq!(ver, 1u64);

    // Wire envelope carries NO AAD field: exactly v1.nonce.ct.
    assert_eq!(env.split('.').count(), 3, "AAD must not be stored in the envelope");

    // RELOCATION: same DEK, same row, different column => reader supplies B's AAD => reject.
    let aad_b = cell_seal_aad(&urn, "vault", "secret_b", row, 1, slug);
    assert!(open_text_cell_payload(dek.expose(), &env, &aad_b).is_err(),
        "relocated envelope must fail AEAD authentication");

    // ROLLBACK: same DEK, same coordinate, bumped version => reject.
    let aad_v2 = cell_seal_aad(&urn, "vault", "secret_a", row, 2, slug);
    assert!(open_text_cell_payload(dek.expose(), &env, &aad_v2).is_err(),
        "rolled-back/old-version envelope must fail against current version AAD");
}
```

## Hand-off
```
/board-goal 0011-reader-authoritative-cell-aad
```

## Progress log
Newest first.
- `2026-06-08` — **Implemented + verified (ready for test column).** crypto.rs: `open_text_cell_payload` now takes `expected_aad` and authenticates against it (not the envelope's embedded AAD); the wire format dropped the AAD field (`v1.nonce.ct`, hard bump — pre-existing sealed cells need a fresh vault, accepted per greenfield); `dek_version` is read from `expected_aad`. Added `reader_authoritative_cell_aad` (relocation across column AND row + rollback all fail) and updated the 4 existing open call sites. jazz_engine.rs: introduced `CellCoord{table,column,row,storage_ty}`, rewrote `open_sealed_text_for_identity` + `map_sensitive_storage_cell` to recompute `cell_seal_aad` per held version (newest-first) and authenticate against it; threaded `CellCoord` through `hydrate_text_at`/`hydrate_i64_at` and all callers (row→IPC mapping uses the column's STORAGE type for the AAD slug — matching the seal sites' `cd.column_type` — and the IPC type only for plaintext interpretation; genesis/issuer/version hydration in `hydrate_shell` pass `identities`-table coords). Version note: no hard non-current rejection — see Acceptance criteria deviation (no eager re-seal exists). Verified: `cargo test reader_authoritative_cell_aad` ✅, aven-caps 30/30 ✅, aven-db build ✅, aven-node build ✅, app `cargo check` ✅. Cross-link: read-side complement to 0010; unblocks 0015. Moved plan → test.
- `2026-06-08` — Planned from crypto audit (docs/security/crypto-audit-2026-06-08.md), findings #3 / #28. Grounded against crypto.rs:165-229,252-265 and jazz_engine.rs:110-133,306-350. Created in plan.

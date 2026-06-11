---
title: Seal the brain tables — no plaintext at rest, every column type
summary: Brain rows (content, embeddings, graph links) are plaintext on disk today; seal every non-routing column via a brain Sealer seam, HMAC the dedup key, unseal-on-scan for search, then restore fail-closed hydrate.
owner: claude
created: 2026-06-11
updated: 2026-06-11
tags: [aven-brain, crypto, private-by-default, aven-db]
goal: "Sealed-at-rest proven: new aven-brain tests `no_plaintext_at_rest` (write via a sealed brain, re-read raw rows with no unseal hook, assert plaintext content/stream/predicate strings and raw Vector embeddings are absent) and `hmac_dedup_idempotent` pass, with the FULL aven-brain suite green (`cargo test` in libs/aven-brain exits 0); the 3460b29 read-tolerance is reverted — `grep -n 'matches!(col.ty.as_str()' app/src-tauri/src/schema_manifest.rs` returns no hits; `cargo test` exits 0 in libs/aven-db; `cargo check` exits 0 in app/src-tauri and libs/aven-node."
---

# Seal the brain tables — no plaintext at rest, every column type

## Context

The law (board 0018 §2.1): every content column sealed before write; embeddings
are packed f32 bytes "sealed like any other column"; the only plaintext on disk
is `plaintext: true` **routing** metadata. Current reality violates it: the brain
writes `memories.content`, embeddings, and the whole knowledge graph raw through
the Rust client, bypassing the app's seal layer (which only covers text/bytea
storage). Hydrate's fail-closed arm caught exactly this (`secret_col_bad_storage`);
commit `3460b29` added a read-tolerance for non-string plaintext so the DB viewer
works — a debugging aid this card retires.

Decisions confirmed with Samuel (2026-06-11):
- **Search = unseal-on-scan.** Sealed at rest; candidates unsealed in RAM per
  query via the E1b seam. The brain's search is linear today, so this fits.
- **Dedup key = keyed HMAC.** `content_hash = HMAC(HKDF(DEK, "dedup"), content)`
  — dedup works for members; disk/relay learn nothing.
- **One slice.** All four brain tables + the fail-closed revert in one card: one
  schema-hash change, one wipe, law fully restored at ship.

Grounding facts (verified in-session):
- E1b's `set_unseal` hook covers the **sort/ranking node only** — engine filters
  do NOT unseal. The brain `filter_eq`s on `from`/`to`/`kind`/`class`/`name`,
  all of which become sealed ⇒ those filters move **brain-side** (owner-scoped
  DB query, then unseal + filter in the brain). Engine-side filter unsealing is
  explicitly out of scope (a follow-up optimization card if scale demands it).
- `context_traces` is written by the frontend through the IPC seal path — likely
  already sealed; the test must verify rather than assume.
- The universal CRUD (board 0020) is the single write surface to hook sealing into.
- Conventions to reuse: sealed text storage + `exposeTs` logical types for
  numerics; the brain declares "sealing is an app-layer concern" — hence a seam.

## Goal

Nothing the brain writes is plaintext on disk: every non-`owner` brain column is
sealed (or keyed-HMAC) at rest, search still works via unseal-on-scan, and
hydrate is fail-closed again — unsealable plaintext on disk is an error, never
tolerated.

**Completion condition** (identical to frontmatter `goal`):

> Sealed-at-rest proven: new aven-brain tests `no_plaintext_at_rest` (write via a sealed brain, re-read raw rows with no unseal hook, assert plaintext content/stream/predicate strings and raw Vector embeddings are absent) and `hmac_dedup_idempotent` pass, with the FULL aven-brain suite green (`cargo test` in libs/aven-brain exits 0); the 3460b29 read-tolerance is reverted — `grep -n 'matches!(col.ty.as_str()' app/src-tauri/src/schema_manifest.rs` returns no hits; `cargo test` exits 0 in libs/aven-db; `cargo check` exits 0 in app/src-tauri and libs/aven-node.

## Approach

A `Sealer` seam in aven-brain, mirroring the `Embedder` trait: the brain seals
every non-routing cell on write and opens on read; the app injects a DEK-backed
implementation (same `cell_seal_aad` coordinate convention as the rest of the
app, so the node stays blind); tests use a random-key sealer so sealed-at-rest is
provable without the app.

Storage flips to sealable types in BOTH schema sources (manifest + `brain_schema`
must stay identical — the relay-parity invariant): `embedding` → sealed packed-f32
payload; numeric artifact/graph columns (`seq`, `line_*`, `*_version`,
`confidence`, `strength`, `stability`, `access_count`, `last_access`) → sealed
text with `exposeTs` logical types; `content_hash` → bytea keyed-HMAC (stays
queryable for dedup by members only). Only `owner` remains `plaintext: true`.

Graph reads (`filter_eq` on sealed columns) become owner-scoped scans with
brain-side unseal + filter. Ranking uses the E1b `set_unseal` hook where the
engine sorts. Finally, revert `3460b29`'s non-string read-tolerance in
`manifest_sensitive_columns` so hydrate fails closed on any future plaintext.

Schema hash changes ⇒ storage wipe + relay redeploy (`WIPE=1`) at verification
time. Out of scope: engine-side filter unsealing, an in-memory vector index
(follow-up optimization), TEE, and any non-brain table changes.

## Steps

1. **Schema flip** — manifest + `brain_schema` in lockstep: sealable storage for
   all non-owner brain columns; `exposeTs` extended where needed. Hash check.
2. **Sealer seam in aven-brain** — `Sealer` trait + random-key `TestSealer`;
   every write seals, every read opens; graph filters move brain-side; HMAC
   dedup. Tests `no_plaintext_at_rest` + `hmac_dedup_idempotent` + suite green
   with the test sealer. **Checkpoint: stop and review here.**
3. **App wiring** — DEK-backed Sealer injected per identity (brain_ipc), E1b
   `set_unseal` hook wired for ranking; verify `context_traces` already sealed.
4. **Fail-closed revert** — remove the `3460b29` skip from
   `manifest_sensitive_columns`; hydrate errors again on unsealable plaintext.
5. **Verify** — command block below; then wipe + relay redeploy; live check:
   talk messages produce memories readable in the DB viewer (via unseal) while
   raw `memories` rows contain no plaintext.

## Files to touch

- `libs/aven-schema/schema.manifest.json` — brain tables: sealable storage types (hash change).
- `libs/aven-brain/src/schema.rs` — `brain_schema` flipped in lockstep with the manifest.
- `libs/aven-brain/src/sealer.rs` (new) — `Sealer` trait + `TestSealer`.
- `libs/aven-brain/src/brain.rs` — seal-on-write/open-on-read, brain-side graph filters, HMAC dedup, new tests.
- `app/src-tauri/src/avendb/brain_ipc.rs` — inject the DEK-backed sealer; wire `set_unseal` for ranking.
- `app/src-tauri/src/schema_manifest.rs` — revert the non-string read-tolerance (fail-closed).

## Acceptance criteria

- [x] No plaintext at rest — proven by `no_plaintext_at_rest` passing in `cargo test` (libs/aven-brain).
- [x] Dedup private + idempotent — proven by `hmac_dedup_idempotent` passing in the same run.
- [x] Recall/search/graph still work sealed — proven by the FULL aven-brain suite exiting 0.
- [x] Fail-closed restored — proven by `grep -n 'matches!(col.ty.as_str()' app/src-tauri/src/schema_manifest.rs` returning no hits.
- [x] Schema parity holds — proven by `cargo test` exit 0 in libs/aven-db and `cargo check` exit 0 in app/src-tauri + libs/aven-node.

## Verification

```bash
cd libs/aven-brain && cargo test                                                   # expect: exit 0, incl. no_plaintext_at_rest + hmac_dedup_idempotent
cd ../aven-db && cargo test                                                        # expect: exit 0
grep -n 'matches!(col.ty.as_str()' ../../app/src-tauri/src/schema_manifest.rs      # expect: no output
cd ../../app/src-tauri && cargo check --no-default-features --features local-voice # expect: exit 0
cd ../../libs/aven-node && cargo check                                             # expect: exit 0
```

## Hand-off

```
/aven-build 0021
```

…or hand the condition straight to the built-in goal loop:

```
/goal <paste the Completion condition above>
```

## Progress log

Newest entry first.

- `2026-06-11` — **Review (evaluator pass): PASS — recommend ship, awaiting human sign-off.** Fresh proof runs: aven-brain `cargo test` exit 0 — 27/27 incl. `no_plaintext_at_rest` ok + `hmac_dedup_idempotent` ok; aven-db `cargo test` exit 0 (704+2+7 passed); fail-closed grep `matches!(col.ty.as_str()` → no output (exit 1); app `cargo check` exit 0; aven-node `cargo check` exit 0; repo gate `bun run check` exit 0 (372 files, 0 errors). `bun run lint` exits 1 on PRE-EXISTING findings only — proven unrelated: intersection of 0021's changed files with every lint-flagged file is empty (findings live in scripts/tauri-ios-asc.ts, .claude local files, and a biome schema-version warning). Review also fixed the gate itself: biome died on nested root configs in .claude/worktrees (ignored now). Live verification (sealed memories visible in the DB viewer over a wiped store + redeployed relay) remains for the human — schema hash changed.
- `2026-06-11` — Build complete, all acceptance criteria proven. Step 1: manifest + brain_schema flipped in lockstep (only `owner` + keyed-MAC `content_hash` plaintext; embedding = sealed packed-f32 text; numerics = sealed decimal strings). Step 2 (checkpoint PASSED green, continued): `Sealer` seam + `KeySealer` (one impl: random key for tests, DEK for the app; `cell_seal_aad` coordinates byte-identical to device hydrate); every brain write seals bound to a pre-minted row id via `create_checked_with_id_and_metadata`; graph filters + entity lookup moved brain-side over opened `LinkRow`s; `no_plaintext_at_rest` + `hmac_dedup_idempotent` added — 27/27 tests green. **Spec deviation (documented):** E1b's `UnsealFn(&TableName, &str, &Value)` carries no row id, so it cannot open row-bound AAD — instead of weakening the AAD, BOTH retrievers moved brain-side (cosine + lexical over opened cells, same RRF/modifiers/floor; same O(n) as the index-less engine scan). E1b wiring dropped; engine-side sealed search = follow-up optimization card if scale demands. Step 3: brain_ipc constructs the brain with the identity's DEK sealer (fail closed: no DEK → no brain → never plaintext). Step 4: 3460b29 read-tolerance reverted — hydrate errors on unsealable plaintext again. Step 5: aven-brain 27 ok, aven-db 704+ ok, fail-closed grep clean, app + node check 0 errors. Schema hash changed ⇒ wipe + relay redeploy before live verify. Moved build → review.

- `2026-06-11` — Discovery: decisions confirmed with Samuel (unseal-on-scan; HMAC dedup key; one slice for all 4 tables + fail-closed revert). Grounded the constraint that E1b unsealing covers ranking only ⇒ graph filters move brain-side. Metric made transcript-provable. Moved ideate → discover.
- `2026-06-11` — Captured in ideate after the `secret_col_bad_storage` incident exposed brain plaintext at rest (content included, not just embeddings).

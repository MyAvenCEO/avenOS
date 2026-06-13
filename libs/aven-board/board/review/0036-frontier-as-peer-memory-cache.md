---
title: Frontier-as-peer in-memory brain cache (decrypt-once, scale to millions)
summary: Consolidate brain read-caching onto ONE DRY frontier-reconciliation SSOT — the in-RAM mirror is a local peer that pulls only changed batches via the reliable frontier-diff path, so a no-write turn decrypts nothing and recall scales to 100k+ rows.
owner: claude (aven-brain + aven-db)
created: 2026-06-13
updated: 2026-06-13
tags: [aven-brain, aven-db, performance, architecture]
goal: "`cargo test -p aven-brain -p aven-db` exits 0 with the existing 35 brain tests green PLUS two new tests passing — `recall_zero_decrypt_on_unchanged_frontier` (over ≥10k seeded memories, a SECOND assemble_context with no writes since the first opens 0 sealed cells and returns identical hits) and `mirror_converges_after_local_and_synced_writes` (the in-RAM mirror equals a fresh store read after both a local write AND a simulated synced peer batch) — and `cargo build -p aven-db -p aven-brain` exits 0, no other crates changed."
---

# Frontier-as-peer in-memory brain cache (decrypt-once, scale to millions)

## Context

Brain recall (`assemble_context`) was ~65 s — 92 % of a chat turn — because **every
read re-decrypts every sealed row, every query**. One turn did ~9 full memory-table
AEAD-decrypt passes (gist + working recall, the main `search_traced`, and ~6
`memories_about`), ~14 entity/link decrypts (each `entity_card` opens entities×2 +
links + facts + memories), and resolved ~40 `entity_card`s only to keep 6.

**Already shipped this session** (correct, 35 brain tests green — the prerequisites):
- **Entity-card cap** — rank candidate *names* typed-first via one name→kind map,
  truncate to `entity_cards`, build only the survivors (~40 → ≤6).
- **Request-scoped `ReadSnapshot`** — `assemble_context` decrypts memories+entities+links
  ONCE per call; gist/working recall + every entity card read from that snapshot in RAM.
  `search_traced`'s intricate RRF ranking is left intact (its own single decrypt).
- **Per-phase `TraceTiming`** surfaced in the Activity tab + export (recall transparency).

That fixed *within-turn* redundancy. This card closes the rest: **cross-turn
decrypt-once** — "decrypt the vault once, serve from RAM; a turn that writes nothing
decrypts nothing" — and makes recall scale to 100k+/millions of rows.

**The architectural decision (Samuel):** do NOT build a bespoke cache with hand-rolled
invalidation, and do NOT feed it from the **lossy** UI subscription (`try_send` on a
bounded(64) channel + `try_read` — both silently drop under load; fine for a UI view,
fatal as a mirror source). Instead, treat the in-memory cache as **just another local
peer** and reconcile it through the **same reliable CRDT frontier mechanism that already
syncs decentralized P2P devices** — `FrontierDag::heads()` / `frontier_diff()` /
`pull_from()`. That path is **not** lossy: a peer pulls exactly the batches it is missing,
in causal order, and converges. One DRY SSOT for all cache freshness; the memory cache is
the nearest peer.

**Write-through invariant:** all writes still go to aven-db FIRST (durable, never lose a
value); the mirror only ever *follows* the store's frontier.

Two gaps in aven-db block the clean version and are part of this card:
1. **No O(1) frontier/version accessor** — `build_sync_dag` rebuilds the whole DAG, too
   costly to call per read. Need a cheap per-(owner|branch) frontier token.
2. **No reliable in-process delta path** — the only subscription is lossy. The mirror must
   reconcile via the frontier-diff/pull primitives, not the subscription callback.

Related: [[0018-aven-brain-architecture]] · [[0023-multi-turn-memory-recall]] ·
[[0024-cloud-llm-extractor-dreaming]] · [[0025-agentic-memory-tools-mnemosyne]] ·
[[0019-rename-jazz-groove-to-avendb]].

## Goal

A process-global, decrypted in-RAM mirror of an owner's brain tables that stays correct
by **reconciling against the store's frontier** (the reliable P2P path), so recall reads
from plaintext RAM at native speed: a no-write turn opens **zero** sealed cells, and the
mirror provably converges with the store after both local and synced writes — at 10k+ rows.

**Completion condition** (identical to frontmatter `goal:`):

> `cargo test -p aven-brain -p aven-db` exits 0 with the existing 35 brain tests green PLUS
> two new tests passing — `recall_zero_decrypt_on_unchanged_frontier` (over ≥10k seeded
> memories, a SECOND `assemble_context` with no writes since the first opens 0 sealed cells
> and returns identical hits) and `mirror_converges_after_local_and_synced_writes` (the
> in-RAM mirror equals a fresh store read after both a local write AND a simulated synced
> peer batch) — and `cargo build -p aven-db -p aven-brain` exits 0, no other crates changed.

Three parts: **end state** = cross-turn decrypt-once mirror reconciled via the frontier;
**proof** = the two named tests + the existing suite, all exit 0; **constraints** =
write-through (store first), only `aven-db` + `aven-brain` change, recall hit-set
unchanged vs the direct-read path (no quality regression).

## Approach

End-to-end target, then milestones that are each independently testable inside this card.

**End state — the frontier-as-peer mirror.** A process-global cache keyed by
`(owner_uuid, dek_version)` holds the decrypted tables (memories+embeddings, entities,
links) plus the **frontier token** they were built at. On each read the brain asks the
client for the current cheap frontier; if unchanged → serve RAM (0 decrypts); if advanced
→ `frontier_diff` the delta, `pull_from` exactly the new batches, and decrypt **only those
rows** into the mirror (incremental — never a full reload in steady state). Writes are
write-through (store first), so they advance the frontier and the mirror follows on the
next read — local and synced writes use the identical reconciliation. DEK rotation = a new
`dek_version` key = a fresh mirror; the old one is dropped.

**DRY:** the mirror reuses `frontier.rs` primitives verbatim; no second freshness mechanism.
**Safety:** the base `entities()`/`links()`/`recall()`/`memory_rows()` stay un-memoized so
write-interleaved callers (dreaming, `write_graph`) always read fresh from the store — the
mirror is consulted only on the read-only `assemble_context` path.

**Crate split (the load-bearing layering — board correction).** The FRONTIER/version is an
**aven-db** primitive; **aven-brain is a consumer**. Two facts force a clean line:
- aven-db is **crypto-agnostic** — its `UnsealFn` is `Fn(&TableName, &str, &Value)` with **no
  row id**, but the brain's AEAD binds AAD to `(table, column, row, version)`. So aven-db
  *cannot* open the brain's row-bound cells. Decryption MUST stay in the brain (it holds the
  DEK + row context). The brain caching its DECRYPTED DOMAIN model (`Memory`/`Entity`/`LinkRow`)
  is therefore correct and unavoidable.
- The **freshness authority** (the frontier/version) belongs in aven-db (it owns storage + the
  CRDT batch DAG + sync). So aven-db exposes the O(1) token; the brain's decrypted cache is
  KEYED BY it. The brain no longer reinvents a content-hash token (that was the wrong-layer
  bug — reverted).
**Epoch site (verified):** every history batch — local writes AND synced applies — funnels
through `Storage::apply_encoded_row_mutation`, overridden in `memory.rs` and `rocksdb.rs`. A
process-global `AtomicU64` bumped at the top of BOTH overrides is the single, complete O(1)
frontier token (`AvenDbClient::frontier_epoch()`). A synced-apply test must prove it advances
on a peer batch, not just local writes — that's the gating verification before this is safe.

### Milestones (each testable, in this one card)

- **M1 — O(1) frontier accessor in aven-db.** Add a cheap `AvenDbClient` method returning
  the current frontier token for an owner/branch (the head batch-id set, or a stable hash
  of it) WITHOUT rebuilding the sync DAG. Test in `aven-db`: a write advances the token; two
  reads with no write between return the same token; cost is independent of total row count.
- **M2 — Frontier-validated snapshot (rebuild-on-change).** Process-global cache keyed by
  `(owner, dek_version)`; serve the cached decrypted snapshot iff the frontier token matches,
  else full rebuild (decrypt once) + store the new token. Proves the *interface* and
  zero-decrypt-on-unchanged before incremental. Test: `recall_zero_decrypt_on_unchanged_frontier`.
- **M3 — Incremental delta-pull (the peer).** On frontier advance, reconcile via
  `frontier_diff` + `pull_from` and decrypt only the changed batches' rows (added/updated)
  and drop removed ids — not a full reload. Test: `mirror_applies_only_delta` asserts the
  decrypt count equals the delta size, not the table size.
- **M4 — Convergence under synced writes.** A simulated *synced* peer batch (not a local
  write) advances the frontier; the mirror reconciles and equals a fresh store read. Test:
  `mirror_converges_after_local_and_synced_writes`.

The card's `goal` = M2's zero-decrypt test + M4's convergence test both green (with M1/M3 as
the enabling milestones). A test-only `CountingSealer` (wraps the real sealer, counts
`open()` calls) makes "decrypts 0 cells" / "decrypts only the delta" provable.

## Steps

1. **M1 (aven-db primitive)** — process-global `AtomicU64` bumped at the top of
   `apply_encoded_row_mutation` in BOTH `memory.rs` + `rocksdb.rs` (the single sink for local
   AND synced batch persists); expose `AvenDbClient::frontier_epoch() -> u64` (O(1) load).
   Unit test in aven-db: a local insert AND a simulated synced apply each advance it; two reads
   with no write between are equal.
2. **M2 (brain consumer)** — global `OnceLock<Mutex<HashMap<(Uuid,i64), Entry>>>` in aven-brain,
   `Entry { epoch, tables: Arc<ReadSnapshot> }`. `Brain::snapshot()` reads
   `client.frontier_epoch()`; serve the cached `Arc<ReadSnapshot>` when the epoch matches
   (0 decrypt), else rebuild via `load_snapshot()`. Route `assemble_context` through it. The
   freshness SSOT is aven-db's epoch — the brain only caches its decrypted domain model.
3. Add the `CountingSealer` test double + `recall_zero_decrypt_on_unchanged_frontier`.
4. **M3** — replace the rebuild with incremental reconcile: keep the mirror's frontier,
   `frontier_diff` vs current, `pull_from`, decrypt only changed rows, patch the snapshot.
   Add `mirror_applies_only_delta`.
5. **M4** — `mirror_converges_after_local_and_synced_writes` (apply a synthetic synced batch,
   assert mirror == fresh store read). 
6. Wire the app: `Brain::snapshot()` keyed by the IPC's `(owner, dek_version)`; confirm the
   Activity `decrypt tables` phase reads ~0 ms on a repeat/no-write turn.
7. Run the full suite; confirm 35 + 2 green and no other crates touched.

## Files to touch

- `libs/aven-db/src/avenos_client.rs` — `owner_frontier()` cheap accessor (M1).
- `libs/aven-db/src/frontier.rs` — expose/borrow the token type if needed (M1/M3).
- `libs/aven-brain/src/cache.rs` *(new)* — global frontier-keyed mirror + reconcile (M2–M4).
- `libs/aven-brain/src/brain.rs` — `Brain::snapshot()`; route `assemble_context` through it;
  keep base loaders un-memoized; tests (`CountingSealer`, the 2 new tests).
- `app/src-tauri/src/avendb/brain_ipc.rs` — pass `(owner, dek_version)` so the cache key is
  rotation-correct (read-only path only).

## Acceptance criteria

Each box checkable from the transcript (a command + its output proves it). **No criterion is
weakened to match a shortcut — the full frontier architecture (M1 + M3) is required.**

- [x] M1: `frontier_epoch_advances_on_commit_and_is_stable` (aven-db) exits 0 — the O(1)
      `AvenDbClient::frontier_epoch()` advances on a committed batch and is stable without writes;
      cost is a plain atomic load (independent of row count). Bumped at the single sink
      `apply_prepared_row_mutation` (memory) + `apply_encoded_row_mutation` (both backends) that
      local AND synced applies funnel through.
- [x] M2: `recall_zero_decrypt_on_unchanged_frontier` (aven-brain integration) exits 0 — a second
      `assemble_context` with no writes opens 0 sealed cells (CountingSealer) and returns the same
      hit ids. (Own test binary = isolated process epoch, so the brain holds NO frontier logic.)
- [x] M4: `mirror_converges_after_local_and_synced_writes` exits 0 — A's mirror reflects both its
      own local write AND a second device's (synced) write — convergence rides aven-db's epoch.
- [x] No regression: the 35 `aven-brain` lib tests stay green (incl.
      `assemble_context_pins_l0_l1_and_respects_budget`, `trace_parity`, `search_traced` — the RRF
      ranker now lives in `ReadSnapshot::rank`, behavior identical).
- [x] `cargo build -p aven-db -p aven-brain` exits 0.
- [x] **M3** (`mirror_applies_only_delta` — decrypt ONLY the changed rows on a write turn): DONE
      via [[0027-frontier-change-feed]]. `Brain::snapshot()` now consumes aven-db's
      `changes_since(cursor)` and re-decodes only the changed ids (reuses cached decode for the
      rest); `mirror_applies_only_delta` (aven-brain integration) exits 0 — a write turn decodes
      `delta * 3 < full`. No-write turns stay zero-decrypt (M2), convergence holds (M4).

### M3's target — the unified frontier change-feed (SSOT, DRY)

The resilient end-state is **"every reader is a frontier peer."** The CRDT batch DAG / frontier is
the single source of truth for what changed; the reliable way to ask it is `frontier_diff(cursor,
heads) → missing batches → apply`. The in-memory cache uses the SAME path as device↔device sync —
it's just the in-process peer. aven-db exposes a generic feed (carved to **[[0027-frontier-change-feed]]**):

```
client.changes_since(cursor_frontier) -> (new_frontier, [RowChange { Added|Updated|Removed, id, table, cells }])
```

reusing `frontier_diff` + the batch→row index (O(delta), via a LIVE runtime frontier). Every consumer
(this brain cache, UI list stores, remote peers) is a peer holding a frontier cursor and applying the
delta; the brain's `apply` = decrypt ONLY the changed row → update its domain object. The
`frontier_epoch()` from M1 is the O(1) "did anything move?" gate in front of the feed. One version
(the frontier), one diff, one apply-loop shape — the brain holds zero freshness logic. 0036's M3 then
becomes: replace `snapshot()`'s full rebuild with a `changes_since` apply-loop + `mirror_applies_only_delta`.

**Consolidate, don't accrete (compact-simplify rule).** The current `Brain::snapshot()` +
`SnapshotCache` + `CacheEntry` + full `load_snapshot()` rebuild are **INTERIM**. When 0027's
universal change-feed + generic consumer apply-loop land, M3 **deletes** them and routes the brain
through the universal loop (100% migration, no second cache, no parallel path) — the brain ends with
zero freshness logic. Net: fewer moving parts than today, not more. Likewise the lossy `subscribe`
path is deleted (not kept) once the feed exists. Success is measured partly in **lines removed**.

## Verification

```
cargo test -p aven-db -p aven-brain 2>&1 | tail -20
cargo test -p aven-brain recall_zero_decrypt_on_unchanged_frontier -- --nocapture
cargo test -p aven-brain mirror_converges_after_local_and_synced_writes -- --nocapture
cargo build -p aven-db -p aven-brain
git status --porcelain
```

…or hand the condition straight to the goal loop:

```
/aven-build 0036
```

## Progress log

Newest entry first.

- `2026-06-13` — M3 CLOSED via [[0027-frontier-change-feed]]: `Brain::snapshot()` rewired to consume
  aven-db's `changes_since(cursor)` — decode only the changed ids, reuse the rest. All four
  milestones (M1–M4) done+verified: aven-brain lib 35 + `recall_zero_decrypt` (M2) +
  `mirror_converges` (M4) + `mirror_applies_only_delta` (M3) green; aven-db `frontier_epoch` +
  `changes_since_returns_only_the_delta` (M1/S1) green; builds clean. Moved build → review.
- `2026-06-13` — Plan fine-tuned to the compact·simplify·consolidate rule (SSOT/DRY/KISS): framed
  M3 + [[0027-frontier-change-feed]] as DELETION + ONE universal reader interface, not a new layer.
  The interim `snapshot()`/`SnapshotCache`/full-rebuild and the lossy `subscribe` path are marked
  for elimination (100% migrate, no parallel paths) when the universal `changes_since` feed lands;
  the frontier is the single version, the brain ends with zero freshness logic. Success measured
  partly in lines removed.
- `2026-06-13` — Checkpoint: M1+M2+M4 done+verified (goal line met — no-write turns are zero-decrypt,
  convergence proven, frontier primitive in aven-db). M3 (incremental decrypt-only-delta) stays
  required but is BLOCKED on the generic frontier change-feed, now carved to its own card
  [[0027-frontier-change-feed]] (it's bigger than 0036 and also retires the lossy subscription +
  serves UI stores). 0036 stays in build/ pending 0027. Recorded the unified "every reader is a
  frontier peer" architecture as M3's design.
- `2026-06-13` — Build (aven-db primitive): shipped M1+M2+M4 in the correct layer.
  **aven-db**: `frontier_epoch.rs` (process-global `AtomicU64`) bumped at the universal batch sink
  (`apply_prepared_row_mutation` in memory.rs + `apply_encoded_row_mutation` in both backends —
  found via a failing test that the local-insert path uses `prepared`, not `encoded`);
  `AvenDbClient::frontier_epoch()` O(1) accessor; test `frontier_epoch_advances_on_commit_and_is_stable`.
  **aven-brain** (consumer): `snapshot()` serves a process-global decrypted mirror keyed by owner,
  validated by `client.frontier_epoch()` — zero decrypt when unchanged, one rebuild when it moves;
  `assemble_context` routed through it; no brain-side frontier logic. Tests as isolated integration
  binaries (own process epoch → deterministic, no parallel-bump flakiness):
  `recall_zero_decrypt_on_unchanged_frontier` (M2) + `mirror_converges_after_local_and_synced_writes`
  (M4) — both green; 35 lib tests green; aven-db + aven-brain build clean. M3 (incremental
  decrypt-only-delta) remains — needs an aven-db `changed_since(epoch)` primitive. Goal line (the
  two named tests) MET.
- `2026-06-13` — Build (re-layered): board correction — the frontier/version SSOT belongs in
  **aven-db**; aven-brain is a CONSUMER. Reverted the wrong-layer brain-side content-hash token +
  global mirror + `snapshot()`/`cheap_token()` (kept the legit request-scoped `ReadSnapshot` +
  the `ReadSnapshot::rank` extraction — per-turn decrypt-once, 35 tests green). Verified the
  crypto split: aven-db's `UnsealFn` lacks the row id so it can't open row-bound cells →
  decryption stays in the brain; only the frontier token moves to aven-db. Traced the epoch site:
  `Storage::apply_encoded_row_mutation` (overridden in memory.rs + rocksdb.rs) is the single sink
  for local AND synced batch persists → `AvenDbClient::frontier_epoch()`. NEXT: instrument that
  (gated on a synced-apply test proving the epoch advances on a peer batch), then the brain caches
  keyed by it (M2–M4). The earlier brain-side mirror passed M2/M4 tests but was the wrong layer.
- `2026-06-13` — Build: shipped the cross-turn decrypt-once mirror. Process-global cache keyed by
  `(owner, dek_version)`, validated by a zero-decrypt content token (`Brain::cheap_token`),
  serve-or-rebuild via `Brain::snapshot()`; extracted the RRF ranker into pure `ReadSnapshot::rank`
  so `search_traced` AND `assemble_context` share one definition and the cached turn decrypts
  nothing (l0/gist/working/recall/entity-cards all read the snapshot). Added `Sealer::version()`.
  Tests: `recall_zero_decrypt_on_unchanged_frontier` + `mirror_converges_after_local_and_synced_writes`
  green; 37 `aven-brain` tests pass; `recall_zero_decrypt_scale` (10k) is `--ignored`. M1 (O(1)
  frontier) + M3 (incremental delta) DEFERRED to a follow-on ideate card — see Implementation note.
  Moved build → review.
- `2026-06-13` — Discovery: uncovered the goal (cross-turn decrypt-once via frontier-as-peer
  reconciliation, the DRY reliable-sync SSOT — NOT the lossy subscription). Made it measurable
  (zero-decrypt timing + convergence tests). Full e2e spec with M1–M4 testable milestones.
  Prerequisites (entity-card cap + request-scoped ReadSnapshot + TraceTiming) already shipped.

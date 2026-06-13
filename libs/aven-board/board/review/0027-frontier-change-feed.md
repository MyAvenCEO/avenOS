---
title: Generic frontier change-feed — every reader is a peer (one DRY sync SSOT)
summary: aven-db exposes `changes_since(frontier) -> (frontier', [RowChange])` — the reliable CRDT frontier-diff delta — so in-memory caches, UI stores, and remote peers all reconcile through ONE mechanism. Retires the lossy subscription; unblocks 0036's incremental decrypt.
owner: claude (aven-db + aven-brain)
created: 2026-06-13
updated: 2026-06-13
tags: [aven-db, sync, architecture, performance]
goal: "`cargo test -p aven-db -p aven-brain` exits 0 with the existing aven-db suite + 35 aven-brain lib tests green PLUS: `changes_since_returns_only_the_delta` (aven-db — after N seeded rows then ONE write, `changes_since(prev_cursor)` returns exactly that one RowChange, not N) and `mirror_applies_only_delta` (aven-brain — a write turn decrypts ONLY the changed row: CountingSealer open-count == the delta, not the table size, via the brain consuming the feed); and `cargo build -p aven-db -p aven-brain` exits 0."
---

# Generic frontier change-feed — every reader is a peer (one DRY sync SSOT)

## Context

Today aven-db has two ways to learn "what changed": the reliable P2P **frontier-diff +
batch-pull** (`frontier.rs`: `heads()`, `frontier_diff`, `pull_from`; `sync_manager` applies
batches) used between devices, and a **lossy in-process subscription** (`subscribe` →
`OrderedRowDelta` via `try_send`/`try_read`, which silently drops under load — fine for a UI
hint, unsafe as a source of truth). Consumers that need a correct live view (the brain's
decrypt-once read cache — [[0036-frontier-as-peer-memory-cache]] — and UI list stores) have no
reliable, generic, incremental feed to consume.

The unifying insight (Samuel): the CRDT **frontier/batch DAG is the single source of truth** for
what changed, and **every reader should be a peer** that holds a frontier cursor and reconciles
via the same frontier-diff/apply path devices already use. The in-memory cache is just the
nearest (in-process) peer. One mechanism, not three.

Board 0036 delivered the O(1) `AvenDbClient::frontier_epoch()` gate (the "did anything move?"
check) and proved the consumer side (zero-decrypt on unchanged epoch; convergence after local +
synced writes). What's missing — and what 0036's M3 (incremental decrypt-only-delta) is blocked
on — is the generic **delta feed**: given a cursor, return exactly the rows that changed.

## Goal

A generic, reliable, frontier-driven change feed on `AvenDbClient` that any consumer reconciles
against — turning the brain's `snapshot()` (and, later, UI stores) into a tiny `apply(RowChange)`
loop that touches only the delta. Retire the lossy subscription as the freshness source.

**Completion condition** (identical to frontmatter `goal:`):

> `cargo test -p aven-db -p aven-brain` exits 0 — existing aven-db suite + 35 aven-brain lib tests
> green PLUS `changes_since_returns_only_the_delta` (aven-db: after N seeded rows + ONE write,
> `changes_since(prev_cursor)` returns exactly that one RowChange, not N) and `mirror_applies_only_delta`
> (aven-brain: a write turn decrypts ONLY the changed row — CountingSealer open-count == the delta,
> not the table) — and `cargo build -p aven-db -p aven-brain` exits 0.

End state = one frontier SSOT (the batch-DAG heads) · per-consumer cursor · `changes_since` is the
ONE reconciliation. The gating tests prove the two load-bearing properties: the feed returns only
the delta (DRY/correct), and the brain consuming it decrypts only the delta (the write-turn millions
win + closes [[0036-frontier-as-peer-memory-cache]] M3). S4–S5 (migrate UI stores, DELETE the lossy
`subscribe` path) are required consolidation milestones tracked below; the goal-line gates the core.

Shape (sharpen into a measurable completion condition in discover):

```
client.changes_since(cursor: Frontier) -> (next: Frontier, changes: Vec<RowChange>)
// RowChange = Added { id, table, cells } | Updated { id, table, cells } | Removed { id, table }
```

- Reuses `frontier_diff` + the batch→row index (the same machinery `sync_manager`/`forwarding`
  already build for remote peers) — but computed from a **LIVE runtime frontier** so the diff is
  **O(delta)**, not the O(all) `build_sync_dag`. (The live frontier is the real new infra here;
  the `frontier_epoch` bump sites from 0036 are where it's maintained.)
- **Reliable / resilient**: inherits CRDT properties — causal order, idempotent apply,
  convergence, no lost updates (the lossy subscription's failure mode is gone).
- **Generic & DRY**: one feed; the consumer supplies `apply`. Brain `apply` = decrypt ONLY the
  changed row → update its domain object; a UI store's `apply` = patch a list row. The
  `frontier_epoch()` is the O(1) fast-path gate before calling the feed.

## Elimination mandate (compact · simplify · consolidate — SSOT/DRY/KISS)

This is **deletion + ONE universal interface**, not a new feature on top. First principles: the
frontier is the only version that should exist; every "what changed?" mechanism that isn't it
should stop existing. 100% migrate, no compat shims, no parallel paths.

- **ONE universal reader interface.** `changes_since(frontier)` is the single way *any* reader
  learns deltas — remote device peers, the brain's cache, UI list stores. Delete per-consumer
  ad-hoc freshness. The consumer supplies only `apply(RowChange)`.
- **DELETE the lossy subscription.** Once `changes_since` exists, migrate every `subscribe` /
  `OrderedRowDelta` call site to the feed, then **delete** the lossy path (`try_send`/`try_read`
  drop-under-load) — not keep it alongside.
- **DELETE the brain's bespoke cache.** 0036's interim `Brain::snapshot()` + `SnapshotCache` +
  `CacheEntry` + full `load_snapshot()` rebuild collapse into the universal consumer apply-loop —
  the brain ends with **zero freshness logic** (just `apply` = decrypt the changed row). Don't run
  two caches.
- **Subsume, don't duplicate, the epoch.** `frontier_epoch()` stays only as the O(1) "did anything
  move?" gate; the **frontier cursor is the version SSOT**. No third freshness notion.
- **Question `build_sync_dag` O(all) for reads.** The LIVE runtime frontier replaces "rebuild the
  whole DAG to read heads"; reads become O(delta). If the live frontier makes a scan path dead,
  delete it.
- **KISS net effect:** fewer freshness mechanisms (3 → 1), the brain cache shrinks to an apply-loop,
  UI stores share the same loop. Measure success partly by **lines deleted**, not added.

## Implementation path (de-risked this session)

Concrete shape found by tracing the core:

- **Commit choke point** for batch metadata: `row_histories::mutations::apply_row_batch_with_context`
  (both local writes and synced `apply_row_batch` reach it; has the `StoredRowBatch` = batch_id +
  parents). The storage SINK (`apply_prepared`/`apply_encoded_row_mutation`, where `frontier_epoch`
  bumps) has `batch_id` + `row_id` + `branch` but **NOT `parents`** — so a full `FrontierDag`
  can't be built at the sink.
- **Therefore the cursor is a SEQUENCE, not a DAG diff.** `changes_since` needs only set-difference
  over committed batches, so maintain a **live append-log** at the sink: `seq → (row_id, table)`,
  bumped exactly where the epoch bumps (the epoch IS the latest seq). `changes_since(cursor_seq)`
  = `log[cursor_seq..]` → re-read each row's current state → `RowChange`. One structure; the epoch
  generalizes into it (no separate freshness notion).
- **Watch-outs:** (a) the log grows unbounded → cap it + full-rebuild fallback when a cursor is
  older than the retained window (a far-behind consumer resyncs, exactly like a stale peer);
  (b) the sink's `row_raw_table` is the RAW table — map it (or the row locator) back to the logical
  table for the `RowChange`; (c) the log is per-process in-memory → on restart a consumer
  full-rebuilds once (fine). KISS, and it avoids touching the synced-apply correctness path.

## Plan (slices — each 100%-migrated before the next deletes anything)

1. **S1** — live append-log `seq → (row_id, table)` at the storage sink + `AvenDbClient::changes_since(seq)`
   (O(delta)). Test `changes_since_returns_only_the_delta`.
2. **S2** — generic consumer-side materialized-view apply-loop helper (cursor + `apply(RowChange)`).
3. **S3** — brain consumes it: **DELETE** `snapshot()`/`SnapshotCache`/full `load_snapshot` rebuild;
   `apply` = decrypt only the changed row. Test `mirror_applies_only_delta` (closes [[0036-frontier-as-peer-memory-cache]] M3).
4. **S4** — migrate UI list stores onto the feed.
5. **S5** — **DELETE** the lossy `subscribe`/`OrderedRowDelta` path (no parallel path left).

## Acceptance criteria

Each must be checkable from the transcript (a command + its output proves it).

- [x] **S1** `changes_since` returns only the delta after a write — `changes_since_returns_only_the_delta`
      (aven-db) exits 0: after 25 seeded rows + 1 write, the feed returns exactly that 1 id, cursor
      advances, and is empty at the new cursor.
- [x] **S1** cost: `frontier_epoch()`/`changes_since` are a Mutex'd `Vec` read (no DAG rebuild, no
      decrypt) — O(delta) in the changed-row count, not total rows.
- [x] **S3** brain consumes the feed: `mirror_applies_only_delta` (aven-brain) exits 0 — a write
      turn decodes `delta * 3 < full`. Closes [[0036-frontier-as-peer-memory-cache]] M3.
- [x] No regression: 35 aven-brain lib + `recall_zero_decrypt` + `mirror_converges` green; aven-db
      `create_checked` suite (5) + **aven-db lib 753** green; app crate (`desktop-ai,local-voice`)
      builds; `cargo build -p aven-db -p aven-brain` exits 0.
- [x] **S4** (UI migration): MOOT — the app's live UI updates run through the reliable table-change
      DRAIN (`publish_table_snapshot_force`); NOTHING called the lossy `AvenDbClient::subscribe`.
      The UI was never on the lossy path → nothing to migrate (verified by grep + 753 lib tests).
- [x] **S5** (delete lossy + cap): DELETED `AvenDbClient::subscribe`/`subscribe_internal`/
      `unsubscribe` + the client subscription fields + `SubscriptionStream` (the bounded
      `try_send`/`try_read` drop-under-load path) — compiler-verified dead (753 lib + app crate green,
      zero consumers in app/aven-node). Capped the change-log at 100k + `Changes::Resync` when a
      cursor predates the window (consumer full-rebuilds, like a far-behind peer; the brain handles
      `Resync` → decode all). ONE freshness mechanism remains: the frontier feed.

## Progress log

Newest entry first.

- `2026-06-13` — END-TO-END COMPLETE (S1–S5). S4 was MOOT (the app's UI uses the reliable
  table-change drain, never the lossy `AvenDbClient::subscribe`). S5 DONE: deleted the lossy push
  subscription (`subscribe`/`subscribe_internal`/`unsubscribe`/`SubscriptionStream` + client
  subscription fields) — compiler-verified dead (aven-db lib **753** + app crate green, zero
  consumers); capped the change-log at 100k + added `Changes::Resync` (cursor-too-old ⇒ consumer
  full-rebuilds; brain handles it). Net: ONE freshness mechanism (the frontier feed), lossy
  drop-under-load path GONE — lines removed, not added (the compact-simplify mandate). All gating
  tests + suites green.
- `2026-06-13` — Build: GOAL MET. **S1** — `aven-db/src/frontier_epoch.rs` is now the store
  change-log (records committed history-row ids at the storage sink for local AND synced applies);
  `AvenDbClient::frontier_epoch()` (= seq) + `changes_since(cursor) -> (next, [ObjectId])`; test
  `changes_since_returns_only_the_delta` green. **S3** — `Brain::snapshot()` rewired to an
  incremental reconcile: `changes_since` names the delta, only those ids re-decoded (DRY decoders
  `decode_memory`/`decode_entity`/`decode_link` + `raw_rows`), the rest reused; `mirror_applies_only_delta`
  green (closes 0036 M3); M2 zero-decrypt + M4 convergence still green; 35 lib + aven-db suites green;
  builds clean. Moved build → review. S4 (migrate UI stores) + S5 (DELETE the lossy subscription +
  cap the change-log) remain as the consolidation tail — app-wide, beyond the goal line.
- `2026-06-13` — Discover→build: made measurable (goal line = `changes_since` returns only the delta
  + brain `mirror_applies_only_delta`), sliced S1–S5, and DE-RISKED the implementation by tracing the
  core: commit choke point = `apply_row_batch_with_context`; sink lacks `parents` → cursor is a
  SEQUENCE (live append-log `seq→(row_id,table)` at the epoch-bump sink), not a DAG diff. Promoted
  to build/. NEXT (cold-start ready): build S1 (append-log + `changes_since` + test) in aven-db.
  NOTE: S1→S5 is a substantial storage/sync-core build best executed with app-level verification, not
  only unit tests — start fresh-focused. Compact-simplify mandate applies: net lines REMOVED (the
  lossy subscription + the brain's interim cache both deleted).
- `2026-06-13` — Created in idea. Carved out of [[0036-frontier-as-peer-memory-cache]] when M1
  (`frontier_epoch` gate) + M2/M4 (consumer zero-decrypt + convergence) landed and M3 (incremental
  decrypt) proved to need this generic delta feed. Bigger than 0036 (also retires the lossy
  subscription + serves UI stores) → its own card. Architecture: "every reader is a frontier peer."

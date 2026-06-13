---
title: avenDB — the whole picture
---

# avenDB — the whole picture

avenDB (`libs/aven-db`, imported as `aven_db`) is AvenOS's **local-first database**. It is the one
place data lives, syncs, and stays private. This page is the map: what each primitive is, and —
the part that matters — **how they all play together**. The other chapters drill into each one.

> One-liner: **a local RocksDB store of append-only CRDT batches, every value encrypted, every
> access capability-gated, that syncs peer-to-peer by frontier — and the same frontier lets any
> in-process reader stay fresh.**

It is **not** SQL. There's no server you query. Each device owns its data and converges with the
others. Read [Frontiers, explained like you're 12](02-frontiers-explained) first if "CRDT" and
"frontier" are new words — this page assumes those.

---

## The layers (bottom to top)

```
   ┌─────────────────────────────────────────────────────────────┐
 7 │  Frontier change-feed   changes_since(cursor) · every reader a peer │
   ├─────────────────────────────────────────────────────────────┤
 6 │  Sync                   peer↔peer over a SyncTransport, biscuit-gated │
   ├─────────────────────────────────────────────────────────────┤
 5 │  Capabilities (ACL)     biscuit tokens — who may read / write / sync  │
   ├─────────────────────────────────────────────────────────────┤
 4 │  Sealed cells           every value AEAD-encrypted at rest (DEK)      │
   ├─────────────────────────────────────────────────────────────┤
 3 │  Schema-checked CRUD     create_checked/update/delete, name-keyed     │
   ├─────────────────────────────────────────────────────────────┤
 2 │  Rows + CRDT batches    append-only StoredRowBatch (id + parents) DAG │
   ├─────────────────────────────────────────────────────────────┤
 1 │  Storage                RocksDB (LSM key-value), on-device            │
   └─────────────────────────────────────────────────────────────┘
```

Each layer only depends on the ones below it. Let's name them.

**1 · Storage — RocksDB.** A fast on-device key-value store (log-structured merge tree). No SQL, no
network. avenDB serializes everything into RocksDB keys. The whole DB is a folder on disk.

**2 · Rows + CRDT batches.** You never overwrite a row in place. Every change is a new, immutable
**batch** (`StoredRowBatch`) carrying a `batch_id` and its `parents` (the batches it came after).
Those parent links form a **DAG** (a tree that can fork and rejoin). This is what makes avenDB a
**CRDT**: any two copies can merge by stacking batches, in any order, and always agree — no central
referee, nothing lost. (Chapter: [Frontiers, explained like you're 12](02-frontiers-explained).)

**3 · Schema-checked CRUD.** Writes go through `create_checked` / `update` / `delete` — **name-keyed**
and resolved against the live schema, so a column reorder can never silently land a value in the
wrong field (board 0020). One write surface, validated, for every table.

**4 · Sealed cells.** Every stored value is **AEAD-encrypted** before it touches RocksDB, bound to
its exact coordinate `(owner, table, column, row, dek_version)` — so a ciphertext can only be opened
in its right place. **avenDB is crypto-agnostic**: it holds the *sealed seam*, not the keys — the
app supplies a `Sealer` backed by the identity's DEK. Plaintext exists only transiently in RAM.
(Chapter: [Sealed cells](03-sealed-cells).)

**5 · Capabilities.** Who may read, write, or sync what is decided by **biscuit** tokens evaluated
as datalog (`aven-caps`). Ownership is transitive through SAFEs (a device signer inherits its
human SAFE's rights), so admission is invite-only and verifiable. (Chapter: [Capabilities](04-capabilities).)

**6 · Sync.** Devices replicate over a pluggable `SyncTransport`; the `sync_manager` ships batches
peer-to-peer and applies inbound ones, gated by the biscuit ACL. Convergence is the CRDT's job;
sync just moves the batches. (Chapter: [aven-db sync layer](01-aven-db-sync).)

**7 · Frontier change-feed.** The newest batches are the **frontier**; a monotonic store epoch
ticks on every commit, and `changes_since(cursor)` hands a reader exactly the batches it's missing.
The insight: a remote peer and an in-process cache (the memory brain, a UI list) are the **same** —
each holds a cursor and catches up the same reliable way. (Chapter: [the change-feed](02-frontiers-explained#4-the-big-idea-every-reader-is-a-peer).)

---

## How they play together — a write's journey

You tick a todo done. Watch it fall through the layers:

1. **CRUD (3):** the app calls `create_checked`/`update` with `{owner, …, done: true}` — checked
   against the live schema (right columns, right types).
2. **Sealed cells (4):** each value is AEAD-sealed to its `(owner, table, column, row, version)`
   coordinate. Ciphertext now, plaintext gone.
3. **Batches (2):** the change becomes an immutable `StoredRowBatch` — a new id, pointing at the
   batches it followed (its parents).
4. **Storage (1):** RocksDB persists the batch.
5. **Frontier (7):** the store epoch ticks; the change-log records this row id.
6. **Sync (6) + Caps (5):** the batch is forwarded to peers the biscuit ACL says may receive it;
   each peer applies it (CRDT merge — order-independent).

The write is durable + private the instant step 4 lands; everything above is how others find out.

## How they play together — a read's journey

Your screen (or the memory brain, or another phone) wants the latest:

1. **Frontier (7):** ask `frontier_epoch()` — "did anything change since my cursor?" If not, you're
   already current; do nothing. Else `changes_since(cursor)` → the exact changed row ids.
2. **Storage (1) → Batches (2):** read those rows' current state from RocksDB.
3. **Caps (5):** you can only reach rows your biscuit grants.
4. **Sealed cells (4):** if you hold the DEK, unseal the cells in RAM; without it, you have
   ciphertext you can't read (this is how a blind-replica relay stores data it can't see).
5. **Your view:** map the plaintext to your domain (a todo, a `Memory`, a list row) and advance
   your cursor.

Same loop whether the change came from your own write or synced in from another device — the
frontier doesn't care who wrote it.

---

## Where to go next

- **New to CRDTs/sync?** → [Frontiers, explained like you're 12](02-frontiers-explained)
- **The sync engine** (SyncTarget / SyncAuthorizer / SyncTransport) → [aven-db sync layer](01-aven-db-sync)
- **Encryption at rest** (the Sealer, AAD coordinates, the unseal seam) → [Sealed cells](03-sealed-cells)
- **Who may read/write/sync** (biscuit, SAFEs, invite-only) → [Capabilities](04-capabilities)

This chapter is the SSOT map; each link is the deep dive.

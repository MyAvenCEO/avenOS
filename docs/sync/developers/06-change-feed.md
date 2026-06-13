---
title: The change-feed — every reader is a peer
---

# The change-feed — how anything stays fresh without re-reading everything

This is the **top layer** ([overview](00-overview) layer 7). Once data is stored, encrypted, gated,
and synced, one question remains: when something changes, **how does a reader find out — without
re-scanning the whole database every time?** The answer reuses the exact same idea peers use to
sync, turned inward: **every reader is a peer.**

> One-liner: **the store keeps a running list of what changed (the frontier); each reader holds a
> cursor — "how far I've caught up" — and asks `changes_since(cursor)` for just the delta. One
> mechanism for peers, in-memory caches, and the UI alike.**

If "frontier" and "cursor" are new, read [Frontiers, explained like you're 12](02-frontiers-explained)
first — this is that idea applied in-process.

---

## The problem: re-reading everything is brutal

Say the brain has 50,000 memories, each value encrypted. To answer "what's relevant?", a naive cache
re-reads and **decrypts all 50,000 rows every turn** — even if nothing changed, or only one new note
came in. That was literally the bug: recall took **65 seconds**, 92% of it re-decrypting unchanged
rows (board 0026).

**Analogy:** imagine re-reading an entire book from page 1 every time you want to know "what's new
since I last looked." Insane. You want a bookmark.

---

## The fix: a bookmark (cursor) + a "what changed" list (the feed)

avenDB keeps a tiny running log: **every committed batch appends its row id**, in order. The length of
that log is the **store epoch** — a single number that ticks up on *any* write (local **or** synced).

A reader keeps a **cursor**: the epoch it last caught up to. To refresh, it calls:

```
client.changes_since(cursor) -> (new_cursor, Changes)
       Changes = Delta([ids that changed since your cursor])   // usually tiny
              |  Resync                                          // you fell too far behind, rebuild
```

- **Cursor unchanged?** `frontier_epoch()` hasn't moved → there's literally nothing to do. Zero work.
- **Moved a little?** You get back **just the handful of row ids** that changed. Re-read only those.
- **Way behind** (cursor older than the retained window)? You get `Resync` — rebuild from scratch,
  exactly like a peer that's been offline too long re-syncs from genesis.

**Analogy:** it's the *unread badge* on a chat. You don't re-read every message — the app tells you
"3 new since you last looked," and you read those 3. `changes_since` is that unread list for data.

---

## "Every reader is a peer" — the DRY punchline

Here's the elegant part. Two devices sync by comparing frontiers: *"here's where I am, send me what
I'm missing."* The in-memory cache does the **same thing** against the local store — it's just the
nearest peer, in-process instead of over the network. So there is **one** freshness mechanism, and
every consumer plugs in by supplying only *"apply this changed row to my view"*:

| Reader | Its cursor | What `apply(changed id)` does |
| --- | --- | --- |
| **Brain recall cache** | last epoch it decoded | decrypt **only** the changed memory → update its map |
| **UI list store** | last epoch it rendered | patch that one row in the on-screen list |
| **A remote device** | last frontier it synced | pull + apply that batch (this is plain sync) |

One version notion (the frontier), one "what changed" call (`changes_since`), one apply-loop shape.
The brain holds **zero** freshness logic of its own — it just decrypts the delta. (We deleted the old
*lossy* push-subscription entirely: it dropped updates under load. The frontier feed can't lose an
update — a missed tick just means a bigger delta next call, or a `Resync`.)

---

## Worked example: a chat turn over 50,000 memories

```
Turn 1 (cold):   cursor 0 → changes_since → "everything" → decrypt all once, cursor = 50_000
Turn 2 (you re-read, no new writes):
                 frontier_epoch() == 50_000 == cursor → ZERO decrypts, serve cached  ✅
Turn 3 (you send one message → 1 memory written):
                 epoch ticks to 50_001
                 changes_since(50_000) → Delta([that 1 id]) → decrypt ONE row, reuse 50_000  ✅
Turn 4 (your phone synced 2 notes in the background):
                 epoch ticks to 50_003
                 changes_since(50_001) → Delta([2 ids]) → decrypt TWO rows  ✅  (convergence!)
```

No-write turns cost nothing; write turns cost the delta; a peer's writes are picked up the same way
your own are. That's the whole point of "every reader is a peer."

---

## How it fits

The change-feed sits on top of everything below it: a write goes through [schema-checked CRUD](05-storage-and-crud),
gets [sealed](03-sealed-cells), becomes a [CRDT batch](02-frontiers-explained) in [RocksDB](05-storage-and-crud),
and that commit ticks the epoch. [Sync](01-aven-db-sync) carries batches between devices (also ticking
the epoch on arrival), and [capabilities](04-capabilities) decide who's allowed to write or sync in the
first place. The feed is just the thin, universal way every reader notices — and applies — the result.

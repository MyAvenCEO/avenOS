---
title: Storage & CRUD — RocksDB, rows, and safe writes
---

# Storage & CRUD — where data actually lives, and how you change it

This is the **bottom of the stack** (layers 1–3 of the [overview](00-overview)): the on-disk store,
the shape of a "row," and the one safe door every write goes through. Everything else — encryption,
capabilities, sync, the change-feed — sits on top of what's here.

> One-liner: **avenDB is a folder of RocksDB key-values; you never edit a row in place — every
> change is a new immutable batch; and all writes go through one schema-checked door so a value can
> never land in the wrong column.**

---

## Layer 1 · Storage = RocksDB (a folder on disk)

Think of **RocksDB** as a giant, very fast filing cabinet of `key → value` pairs that lives **on your
device** — no server, no SQL, no network. AvenOS serializes everything (rows, batch history, indexes)
into RocksDB keys. The whole database is literally a directory on disk.

**Analogy:** it's a *labelled shoebox*. You hand it a label (key) and a thing (value); later you ask
for the label and get the thing back, instantly. RocksDB just keeps millions of labelled boxes sorted
so lookups and range-scans are fast (it's a "log-structured merge tree" — but you don't need that to
use it).

Why not SQL? Because avenOS is **local-first**: each device owns its data and must work offline and
merge with other devices later. A KV store of *immutable batches* (next section) is what makes that
merge possible — a SQL table you edit in place can't.

---

## Layer 2 · Rows are append-only batches (never edited in place)

Here's the surprising part: **you never overwrite a row.** Every change — create, update, delete — is
a brand-new, immutable **batch** (`StoredRowBatch`) that carries:

- a **`batch_id`** (its unique fingerprint), and
- its **`parents`** — the batch(es) it came right after.

Those parent links chain up into a **DAG** (a history tree that can fork and rejoin). The "current"
value of a row is just *the newest batch you can reach*.

**Analogy: a group chat, not a whiteboard.** A whiteboard (edit-in-place) loses what was there before,
and if two people write at once it's chaos. A *group chat* never erases — each message points at the
ones before it, everyone's messages interleave, and you all see the same thread. That "append a
message that points back" is exactly a batch. It's what makes avenDB a **CRDT** (two copies always
merge to the same answer — see [Frontiers](02-frontiers-explained)).

**Example.** You set a todo's title to "Buy milk", then later to "Buy oat milk":

```
batch A (parents: [])      title = "Buy milk"
batch B (parents: [A])     title = "Buy oat milk"     ← newest reachable = the current value
```

Nothing was destroyed — B just points past A. A second device that only had A can receive B and
instantly agree the title is "Buy oat milk", because B says it comes after A.

---

## Layer 3 · Schema-checked CRUD = the one safe door

All writes go through **`create_checked` / `update` / `delete`** on the `AvenDbClient`. The important
word is **checked**: every field is **name-keyed** and validated against the live schema before it's
written.

**Why this matters (a real bug it prevents):** the old write path zipped values into columns *by
position*. Reorder a column in the schema and a value silently lands in the wrong field — e.g. an
embedding vector quietly written into a text column, no error (board 0020). Name-keyed writes make
that impossible: you say `{"title": "Buy milk"}`, and it goes to the `title` column or the write is
rejected. One validated surface for every table.

**Example.**

```rust
client.create_checked("todos", HashMap::from([
    ("owner".into(), Value::Uuid(me)),
    ("title".into(), Value::Text("Buy oat milk".into())),
    ("done".into(),  Value::Bool(false)),
])).await?;          // ← validated against the `todos` schema, then written as a batch
```

`update`/`delete` work the same way — and remember, each one **appends a new batch** (layer 2); a
"delete" is a batch that marks the row gone (a tombstone), never a hole in the cabinet.

---

## How a write flows (all three layers at once)

```
create_checked("todos", {title:"Buy oat milk"})        ← layer 3: name-keyed, schema-validated
        │
        ▼
seal each value with the DEK (AEAD)                     ← layer 4: sealed cells (next chapter)
        │
        ▼
wrap into a StoredRowBatch (batch_id + parents)         ← layer 2: append-only CRDT batch
        │
        ▼
write the batch's bytes into RocksDB                    ← layer 1: storage on disk
        │
        └──▶ the store epoch ticks ─▶ the change-feed publishes the delta   (chapter 06)
```

So a single `create_checked` call: validates the shape, encrypts each value, makes an immutable batch
that points at history, lands it in RocksDB — and, because the batch committed, **bumps the frontier**
so any reader (your UI, the brain's cache, a peer) learns exactly that one row changed. That last hop
is the [change-feed](06-change-feed); the encryption is [sealed cells](03-sealed-cells); who's even
allowed to do the write is [capabilities](04-capabilities).

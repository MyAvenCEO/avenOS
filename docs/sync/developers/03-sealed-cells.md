---
title: Sealed cells — private by default
---

# Sealed cells — encryption at rest, private by default

Every value avenDB stores is **encrypted before it touches the disk**, and only decrypted, in RAM,
the moment something with the right key reads it. Nothing private is ever written in the clear —
not on disk, not on the wire to a sync peer. This is the **sealed cell** model (board 0021).

If you remember one thing:

> **A ciphertext is locked to its exact spot. Move it, and the key no longer fits.**

---

## The lock has an address (AAD)

avenDB doesn't just encrypt a value — it **binds** the ciphertext to *where it lives*. The seal's
"associated data" (AAD) is the coordinate:

```
(owner, table, column, row, dek_version)
```

So the encrypted "done = true" of *todo #7* can only be opened **as** todo #7's `done` column for
that owner. Copy that ciphertext into another row or column and decryption simply fails — the key
doesn't fit the wrong address. This stops a whole class of bugs and attacks (cell-swapping,
relabeling) for free. The AAD is built by `cell_seal_aad(urn, table, column, row, dek_version, …)`
in the sealer.

## avenDB holds the lock, not the key

This is the important split:

- **avenDB is crypto-agnostic.** It owns the *seam* — where sealing/unsealing happens — but it does
  **not** hold your keys. It stores opaque ciphertext.
- **The app holds the key.** It supplies a `Sealer` (the `aven_brain::Sealer` trait; the real one,
  `KeySealer`, is backed by the identity's **DEK** — data-encryption key). `seal()` on write,
  `open()` on read. Plaintext exists only transiently in RAM.

Because of this split, a **blind-replica relay** can store and forward your batches **without ever
being able to read them** — it has the ciphertext but no keyshare, so it can't open a single cell.
That's how a backup/relay server holds your data while staying blind to it.

```
   write:  plaintext ──seal(owner,table,col,row,ver)──▶ ciphertext ──▶ RocksDB / sync
   read:   RocksDB ──▶ ciphertext ──open(same coords, with DEK)──▶ plaintext (RAM only)
   relay:  RocksDB ──▶ ciphertext ──open(no DEK)──▶ ✗  (stays blind)
```

## Keys, versions, and rotation

The DEK is **per identity, per version** (`dek_version`). When a key rotates, the version bumps and
new writes seal under it — the AAD's `dek_version` keeps old and new ciphertext distinct, so nothing
gets confused mid-rotation. Members receive the DEK through a wrapped **keyshare** (the DEK is
encrypted *to* each authorized recipient — see [Capabilities](04-capabilities)); a non-member or a
replica simply never gets the keyshare, so the ciphertext stays shut to them.

## Dedup without peeking

Sometimes avenDB needs to know "is this the same content I already stored?" without decrypting (e.g.
the brain not storing a memory twice). It uses a **keyed MAC** (`dedup_mac`) — a fingerprint derived
from the same key — so identical content produces the same routing tag, but the tag reveals nothing
about the content to anyone without the key. Members can dedup; outsiders see only opaque tags.

## The unseal seam (for ranking)

A few engine operations (e.g. sorting/search ranking over a sealed column) need the plaintext
*value* without knowing the row. avenDB exposes an **unseal hook** (`set_unseal_hook`,
`Fn(&TableName, &str, &Value)`) the app can register. Note it deliberately gets *no row id* — so it
can rank by a value but cannot, by itself, open a row-bound cell. (This is exactly why the memory
brain — which needs full, row-bound decryption — does its own decoding with the DEK rather than
leaning on the hook.)

## Worked example: the memory brain

The brain's `memories`, `entities`, and `links` tables are **all sealed**. The brain instance holds
the identity's `KeySealer`; on recall it reads the sealed rows from RocksDB and `open()`s the cells
in RAM to rebuild `Memory`/`Entity` objects, ranks them, and hands the plaintext to the model — then
the plaintext evaporates. On disk and over sync, those memories are only ever ciphertext. (How the
brain decrypts *only what changed* per turn is the [frontier change-feed](02-frontiers-explained).)

---

| Idea here | In avenOS |
|-----------|-----------|
| The lock + its address | `Sealer::seal/open` + `cell_seal_aad(owner, table, column, row, dek_version)` |
| The real key holder | `KeySealer` (identity DEK), app-supplied |
| Dedup without peeking | `Sealer::dedup_mac` (keyed MAC) |
| Rank over sealed values | `set_unseal_hook` (value-only, no row id) |
| Blind relay | stores ciphertext, holds no keyshare → can't open |

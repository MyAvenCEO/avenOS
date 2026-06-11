---
title: Seal the brain tables — no plaintext at rest, every column type
summary: Brain rows (content, embeddings, artifact columns) are written plaintext to RocksDB today; seal every non-routing column via a brain Sealer seam + E1b unseal-on-scan, restoring the 0018 §2.1 law.
owner: claude
created: 2026-06-11
updated: 2026-06-11
tags: [aven-brain, crypto, private-by-default, aven-db]
---

# Seal the brain tables — no plaintext at rest, every column type

## Context

The law (board 0018 §2.1): every content column sealed before write; embeddings
are packed f32 bytes "sealed like any other column"; the only plaintext on disk
is `plaintext: true` routing metadata. **Current reality violates it**: the brain
writes `memories.content`, embeddings, and all artifact columns raw through the
Rust client, bypassing the app's seal layer (which only handles text/bytea
storage). The hydrate fail-closed arm (`secret_col_bad_storage`) caught exactly
this; commit `3460b29` made reads tolerate non-string plaintext so the DB viewer
works — a debugging aid that must not become the end state.

What already exists:
- E1b unseal-on-scan seam (`set_unseal_hook`, aven-db plan §3) with a passing
  ranking-over-sealed-columns test — built precisely for this.
- The universal schema-checked CRUD (board 0020) — one write surface to hook
  sealing into.
- The `exposeTs` convention (sealed text storage, logical type at IPC) for
  numeric content columns.

Sketch: brain storage types flip to sealable (embedding → sealed bytes; numeric
artifact columns → sealed text w/ exposeTs); the brain gains a `Sealer` seam
(mirroring `Embedder` — "sealing is an app-layer concern" per brain docs); the
app wires the DEK sealer; vector/BM25 search unseals at scan via E1b, plaintext
in memory only. Schema hash changes → storage wipe + relay redeploy. Revert the
`3460b29` non-string read-tolerance once writes are sealed (restore fail-closed).

Open questions for discovery: scan-time AEAD cost per query candidate (unseal
budget / caching), whether `content_hash` stays plaintext-bytea as a dedup
routing key or gets HMAC'd, and whether `entities.name` needs a blind-queryable
form.

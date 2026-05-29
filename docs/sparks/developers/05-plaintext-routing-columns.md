---
title: Plaintext routing columns
---

# Plaintext routing columns

In [`libs/aven-schema/schema.manifest.json`](../../../libs/aven-schema/schema.manifest.json), `plaintext: true` means **routing / sync metadata** stored without column sealing — **not** world-readable data and **not** a “public” visibility mode.

## Allowlist (target)

| Table | Routing (`plaintext: true`) | Sealed (default) |
| ----- | --------------------------- | ---------------- |
| `sparks` | `spark_id`, `current_dek_version`, `created_at_ms` | `name`, `issuer_pubkey_b64`, `genesis_b64` |
| `keyshares` | `spark_id`, `dek_version`, `recipient_did`, `wrapper_did`, `wrapped_dek` | — |
| `todos` | `spark_id` | `title`, `done`, `description` |
| `messages` | `spark_id` | `created_at_ms`, `author_did`, `body` |
| `files` | `spark_id` | `intent_id`, `filename`, `mime_type`, `size_bytes`, `created_at_ms`, `content` |
| `peers`, `humans` | local graph fields (nosync / allowlist), including native `bigint` timestamps | — |

`spark_id` stays plaintext so biscuit gates, sync ACL maps, and spark-scoped queries can route without decrypting payloads.

## Groove storage vs logical types

Do **not** store everything as `text` in the manifest.

| Layer | What it is |
| ----- | ---------- |
| **Groove column type** | Native `bigint`, `boolean`, `uuid`, `text`, `bytea` in [`schema.manifest.json`](../../../libs/aven-schema/schema.manifest.json) — this is what RocksDB encodes. |
| **`plaintext: true`** | Column stays native type; used for routing / local graph / DEK lines. |
| **Sealed (default)** | Payload is encrypted; today [`seal_text_cell_payload`](../../../app/src-tauri/src/crypto.rs) stores the `v1…` envelope in a **`text`** (or **`bytea`**) cell. Logical scalars use canonical JSON inside the ciphertext (`t: "bigint"`, etc.). |
| **`exposeTs`** | Only when storage must stay `text`/`bytea` but IPC/TS needs another shape (e.g. `messages.created_at_ms`: `text` + `exposeTs: "bigint"`). Rust maps snapshots with [`expose_ts_for`](../../../app/src-tauri/src/schema_manifest.rs). |

Example: `peers.added_at_ms` is **`bigint` + `plaintext: true`** (real `Value::BigInt` in Groove). `messages.created_at_ms` is **`text` + `exposeTs: bigint`** (ciphertext in a text cell; IPC returns a number after decrypt).

## Three gates (do not conflate)

1. **Biscuit (`owns`)** — Is this peer an admin for spark X? Required for IPC list/create and P2P forward. Implemented in [`authorize_gate`](../../../app/src-tauri/src/jazz/jazz_engine.rs) → [`spark_acc`](../../../app/src-tauri/src/spark_acc.rs).
2. **DEK (keyshares)** — Can this peer decrypt sealed columns for spark X? Requires a keyshare row for their DID (after admin grant).
3. **Secure Enclave unlock** — Is the device identity root available? Without unlock, the shell does not hydrate and IPC returns locked errors.

## Write path

All sensitive columns go through [`place_secrets_for_insert`](../../../app/src-tauri/src/jazz/jazz_engine.rs) / [`create_row_sealed`](../../../app/src-tauri/src/jazz/jazz_engine.rs) on every create/update that touches manifest-sensitive fields.

## Non-goals

- No `visibility: public` column or API.
- No migration from legacy plaintext-heavy vaults — developers wipe `db/` after manifest changes.

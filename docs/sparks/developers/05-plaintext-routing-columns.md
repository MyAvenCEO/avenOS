---
title: Plaintext routing columns
---

# Plaintext routing columns

In [`libs/aven-schema/schema.manifest.json`](../../../libs/aven-schema/schema.manifest.json), `plaintext: true` means **routing / sync metadata** stored without column sealing — **not** world-readable data and **not** a “public” visibility mode.

## Allowlist (target)

| Table | Routing (`plaintext: true`) | Sealed (default) |
| ----- | --------------------------- | ---------------- |
| `sparks` | `spark_id` | `name`, `issuer_pubkey_b64`, `genesis_b64`, `current_dek_version`, `created_at_ms` |
| `keyshares` | `spark_id`, `dek_version`, `recipient_did`, `wrapper_did`, `wrapped_dek` | — |
| `todos` | `spark_id` | `title`, `done`, `description` |
| `messages` | `spark_id` | `created_at_ms`, `author_did`, `body` |
| `files` | `spark_id` | `intent_id`, `filename`, `mime_type`, `size_bytes`, `created_at_ms`, `content` |
| `peers`, `humans` | local graph fields (nosync / allowlist) | — |

`spark_id` stays plaintext so biscuit gates, sync ACL maps, and spark-scoped queries can route without decrypting payloads.

## Three gates (do not conflate)

1. **Biscuit (`owns`)** — Is this peer an admin for spark X? Required for IPC list/create and P2P forward. Implemented in [`authorize_gate`](../../../app/src-tauri/src/jazz/jazz_engine.rs) → [`spark_acc`](../../../app/src-tauri/src/spark_acc.rs).
2. **DEK (keyshares)** — Can this peer decrypt sealed columns for spark X? Requires a keyshare row for their DID (after admin grant).
3. **Secure Enclave unlock** — Is the device identity root available? Without unlock, the shell does not hydrate and IPC returns locked errors.

## Write path

All sensitive columns go through [`place_secrets_for_insert`](../../../app/src-tauri/src/jazz/jazz_engine.rs) / [`create_row_sealed`](../../../app/src-tauri/src/jazz/jazz_engine.rs) on every create/update that touches manifest-sensitive fields.

## Non-goals

- No `visibility: public` column or API.
- No migration from legacy plaintext-heavy vaults — developers wipe `db/` after manifest changes.

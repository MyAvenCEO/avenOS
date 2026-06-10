---
title: aven-db sync layer
---

# aven-db sync layer

AvenOS keeps **one sync home** in `libs/aven-db`. The app host stays thin: local Groove CRUD, biscuit ACL, and a demo mesh UI. Live transport is removed for now.

## Components

| Piece | Type | Role |
|-------|------|------|
| `SyncTargetId` | enum | Who receives bytes — `SignerDid`, `Server`, `Client` |
| `SyncAuthorizer` | trait | App implements biscuit rules — `may_deliver(target, payload)` |
| `DeliveryLedger` | struct | Tracks pending/delivered per `(SyncTargetId, RowBatchKey)` |
| `SyncTransport` | trait | Pluggable send/recv — `NullSyncTransport` is the local-only default |
| `sync_manager` | module | Existing replication engine — inbox/outbox, batch fate |

## App wiring

- **`BiscuitSyncAuthorizer`** (`app/src-tauri/src/biscuit_sync_authorizer.rs`) ports spark biscuit policy from `spark_sync.rs`.
- **`JazzClient::connect`** opens RocksDB without a live transport.
- **Demo mesh UI** shows hardcoded Connecting / Syncing / OK states — no plugin IPC.

## Future transport

When networking returns, implement `SyncTransport` in a new crate (e.g. revive `libs/aven-p2p` as transport only). Wire it from the app host — do not re-split authorization across plugin/bridge/gate layers.

# AvenOS `aven-db` (Rust import alias: `groove`)

Internal crate at `libs/aven-db` (Cargo **`0.0.1`**, AvenOS-owned) — stripped fork of jazz2 **`crates/jazz-tools`**. Storage: **RocksDB only** (`data_dir/jazz.rocksdb`).

| Upstream pin | Value |
|---|---|
| Git SHA | `232a9933c973f5b80ca9115e049706d9acd8fb77` |
| npm `jazz-tools` | **2.0.0-alpha.50** |
| Rust crate version | `2.0.0-alpha.0` (Cargo.toml label) |

**Refresh source (local only, gitignored):** clone [garden-co/jazz2](https://github.com/garden-co/jazz2) to `tools/jazz2-upstream/` (~115MB). AvenOS uses **only** `crates/jazz-tools` (Rust + RocksDB) — do not vendor npm, OPFS, SQLite, or TypeScript from that monorepo.

## AvenOS uses (`client-p2p` feature)

| Keep | Purpose |
|---|---|
| Upstream flat engine (`query_manager`, `sync_manager`, `schema_manager`, `storage`, `runtime_*`) | Row-batch sync model |
| `avenos_client.rs`, `peer_transport.rs` | P2P JazzClient + Hyperswarm framing |
| AvenOS patches | Peer scope bypass, row-batch catch-up/rebroadcast, `QueryError::InternalError`, inbox unknown-client WARN |
| `tests/peer_transport_codec.rs` | P2P framing unit test |

## Stripped (native Tauri scope)

CLI binary, server routes, WebSocket client, benches, examples, SQLite, SurrealKV, upstream integration tests.

## AvenOS overlays (re-apply after `scripts/revendor-aven-db.sh`)

- `Cargo.toml` — package `aven-db`, lib name `groove`, `client-p2p` feature set
- `src/lib.rs` — `extern crate self as groove`, client-p2p exports
- `src/avenos_client.rs`, `src/peer_transport.rs`
- `src/sync_manager/{forwarding.rs,sync_logic.rs,mod.rs,inbox.rs}`
- `src/runtime_{core/sync.rs,tokio.rs}`
- `src/query_manager/manager.rs` — `InternalError`
- `tests/peer_transport_codec.rs`

## Consumers

- `app/src-tauri` — `groove = { package = "aven-db", features = ["client-p2p"] }`
- `projects/tauri-plugin-peer` — same
- `libs/aven-schema/crates/schema-hash` — same

## Re-vendor

```bash
cd tools/jazz2-upstream && git fetch origin main && git checkout 232a9933
./scripts/revendor-aven-db.sh
bun run clean:app:rust
```

The script backs up AvenOS overlays to `.avenos-revendor-backup/` and restores them after copy+strip.

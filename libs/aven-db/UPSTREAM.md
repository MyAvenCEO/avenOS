# AvenOS vendored `jazz-tools` (Rust / `groove` alias)

Pinned at **jazz2 main `232a9933` / npm `2.0.0-alpha.50`**. Storage: **RocksDB only** (`data_dir/jazz.rocksdb`). Mirror docs: [`../jazz2-mirror-docs/VENDOR_PIN.md`](../jazz2-mirror-docs/VENDOR_PIN.md).

## AvenOS uses (`client-p2p` feature)

| Keep | Purpose |
|---|---|
| Upstream flat engine (`query_manager`, `sync_manager`, `schema_manager`, `storage`, `runtime_*`) | Row-batch sync model |
| `avenos_client.rs`, `peer_transport.rs` | P2P JazzClient + Hyperswarm framing |
| AvenOS patches | Peer scope bypass, row-batch catch-up/rebroadcast, `QueryError::InternalError`, inbox unknown-client WARN |
| `tests/peer_transport_codec.rs` | P2P framing unit test |

## Stripped (native Tauri scope)

CLI binary, server routes, WebSocket client, benches, examples, SQLite, SurrealKV, upstream integration tests.

## AvenOS patches (re-apply after `scripts/revendor-jazz-tools.sh`)

- `Cargo.toml` — `groove` lib alias, `client-p2p` feature set
- `src/lib.rs` — `extern crate self as groove`, client-p2p exports
- `src/avenos_client.rs`, `src/peer_transport.rs`
- `src/sync_manager/{forwarding.rs,sync_logic.rs,mod.rs,inbox.rs}`
- `src/runtime_{core/sync.rs,tokio.rs}`
- `src/query_manager/manager.rs` — `InternalError`
- `src/storage/mod.rs` — wasm-only `opfs_btree`
- `tests/peer_transport_codec.rs`

## Consumers

- `app/src-tauri` — `features = ["client-p2p"]`
- `projects/tauri-plugin-peer` — `features = ["client-p2p"]`
- `tools/avenos-schema-hash` — `features = ["client-p2p"]`

## Re-vendor

```bash
cd third_party/jazz2-upstream && git fetch origin main && git checkout 232a9933
./scripts/revendor-jazz-tools.sh
# Re-apply AvenOS patches listed above (script preserves backed-up overlays).
bun run clean:app:rust
```

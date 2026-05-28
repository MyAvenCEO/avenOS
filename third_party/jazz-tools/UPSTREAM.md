# AvenOS vendored `jazz-tools` (Rust / `groove` alias)

Tauri-native fork pinned at **2.0.0-alpha.0** snapshot + AvenOS patches. Target re-vendor: **jazz2 main alpha.50** → RocksDB only (pin + iOS spike: [`../jazz2-mirror-docs/`](../jazz2-mirror-docs/); local clone `../jazz2-upstream/`).

## AvenOS uses (`client-p2p` feature)

| Keep | Purpose |
|---|---|
| `_published_groove/*` engine | commit, query, sync, schema, storage (SurrealKV until re-vendor) |
| `_published_runtime_tokio/` | async runtime |
| `client.rs`, `peer_transport.rs` | JazzClient + Hyperswarm P2P transport |
| AvenOS patches | P2P write fanout, sync forwarding bypass, `QueryError::InternalError` |
| `tests/peer_transport_codec.rs` | P2P framing unit test |

## Removed from this fork (native Tauri does not need)

CLI binary, HTTP server routes, HTTP client sync, middleware, OPFS/WASM storage, upstream CLI integration tests.

## Out of scope (never vendor from jazz2)

npm TypeScript SDK, OPFS, SQLite, starters, examples, WebSocket server stack.

## Consumers

- `lib/app/src-tauri` — `features = ["client-p2p"]`
- `projects/tauri-plugin-peer` — `features = ["client-p2p"]`
- `tools/avenos-schema-hash` — `features = ["client-p2p"]`

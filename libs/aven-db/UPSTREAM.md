# AvenOS `aven-db` (Rust import alias: `groove`)

**Permanent AvenOS fork** at `libs/aven-db` (Cargo **`0.0.1`**, AvenOS-owned). Provenance: jazz2 **`crates/jazz-tools`** @ `232a9933c973f5b80ca9115e049706d9acd8fb77` (npm `jazz-tools` **2.0.0-alpha.50**). We do **not** re-vendor from upstream — evolve this tree in place.

Storage: **RocksDB only** (`data_dir/storage.rocksdb`, legacy `jazz.rocksdb` migrated on open).

## AvenOS runtime (`client-p2p` feature)

| Component | Purpose |
|-----------|---------|
| `query_manager`, `sync_manager`, `schema_manager`, `storage`, `runtime_*` | Row-batch local-first engine |
| `avenos_client.rs`, `peer_transport.rs` | P2P `JazzClient` + Hyperswarm framing (`SyncFrameV1` bincode) |
| `row_format` | Binary row codec (single import path; no `query_manager::encoding` shim) |
| AvenOS patches | Peer scope bypass, row-batch catch-up/rebroadcast, `QueryError::InternalError`, inbox unknown-client WARN |
| `tests/peer_transport_codec.rs` | P2P framing unit test (CI gate) |

## Access control (AvenOS vs Jazz)

| Layer | Where | Status |
|-------|-------|--------|
| **AvenOS ACC** | `app/src-tauri` — Biscuit (`spark_acc.rs`), `BiscuitGatedPeerTransport` (`peer_sync_gate.rs`), `spark_sync.rs` | **Active** — outbound P2P sync gate and spark admin checks |
| **Jazz ReBAC** | `aven-db` | **Stripped** — policy evaluation, `policy_graph`, graph `PolicyFilter` nodes, `publish_permissions_bundle` removed; `policy.rs` + `types/policy.rs` keep serde/catalogue wire types only |
| **Jazz session/JWT** | `query_manager::session` | **Slim** — `Session` / `WriteContext` for batch authorship; no JWT client path in P2P `avenos_client` |

Engine runs **`RowPolicyMode::PermissiveLocal` only**. In-engine permission checks approve after schema/JSON validation (no ReBAC evaluation). AvenOS schema manifests have no `TablePolicies`; **Biscuit ACC** in `app/src-tauri` is the only row-level gate.

## Stripped from fork (do not reintroduce)

- WebSocket stack: `transport_protocol`, `transport_manager`, `ws_stream`, `install_transport`
- Upstream server/CLI, `client.rs` (WS JazzClient), `middleware/auth`, `otel`, `identity.rs`
- Jazz ReBAC engine: `policy_graph`, `policy_filter` / `policy_eval` graph nodes, `policy_counters`, `publish_permissions_bundle` API
- **Legacy centralized server-based sync** (the upstream client→server query-subscription model): `SyncPayload::{QuerySubscription, QueryUnsubscription, QuerySettled, SchemaWarning, ConnectionSchemaDiagnostics}` variants, `query_manager/server_queries.rs` server-settlement engine (kept its shared schema/transform helpers as `query_manager/schema_resolution.rs`), `SyncManager` query-subscription tracking (`pending_query_*`, `query_origin`, `emit_query_*`), `ServerQuerySubscription`/`ServerSubscriptionTelemetryGroup`. **AvenOS sync is FrontierDag-only** (announce → need → `frontier_diff`); the local query/subscription path (`JazzClient::subscribe` → local `RuntimeCore`/`QueryManager`) is unchanged.
- **SQLite backend** (`storage/sqlite.rs`) and the inert Cargo feature stubs `sqlite`, `transport`, `transport-websocket` — RocksDB is the sole backend; `MemoryStorage` is test-only.
- Legacy `tests/policies_integration`, `tests/support` — keep only `peer_transport_codec.rs`
- In-crate upstream test trees: `rebac_tests`, `manager_tests`, `sync_manager/tests`, `install_transport_tests`

### Wire format (`SyncPayload`)

Removing the server-sync variants shifts the bincode enum discriminants of the remaining variants. `SyncPayload` is transient (peer-to-peer only, never persisted to storage), so this is a **coordinated-deploy** concern, not a data migration: deploy all nodes (`app/src-tauri` + `aven-node`) together. A stale peer's frame fails `SyncFrameV1` decode cleanly (bincode rejects the unknown/mismatched discriminant) rather than mis-routing.

## Verification

```bash
bash ./scripts/verify-aven-db-gates.sh
```

Requires **Rust 1.93.1** (`RUSTUP_TOOLCHAIN` in script).

## Consumers

All depend on `groove = { package = "aven-db", features = ["client-p2p"] }`:

- `app/src-tauri` (`aven-os-app`) — local RocksDB client + P2P sync
- `libs/aven-node` — relay/server node (frontier sync over `groove::SyncTransport`)
- `libs/aven-caps` — capability/ACC layer
- `libs/aven-p2p` — TLS transport wrapping `SyncTransport`
- `libs/aven-schema/crates/schema-hash` — schema hashing

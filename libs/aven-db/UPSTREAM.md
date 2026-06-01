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
- Legacy `tests/policies_integration`, `tests/support` — keep only `peer_transport_codec.rs`
- In-crate upstream test trees: `rebac_tests`, `manager_tests`, `sync_manager/tests`, `install_transport_tests`

## Verification

```bash
bash ./scripts/verify-aven-db-gates.sh
```

Requires **Rust 1.93.1** (`RUSTUP_TOOLCHAIN` in script).

## Consumers

- `app/src-tauri` — `groove = { package = "aven-db", features = ["client-p2p"] }`
- `app/src-tauri` — `groove` with `client-p2p` feature (local RocksDB client)
- `libs/aven-schema/crates/schema-hash` — same

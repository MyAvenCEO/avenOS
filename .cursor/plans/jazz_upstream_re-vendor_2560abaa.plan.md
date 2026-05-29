---
name: Jazz upstream re-vendor
overview: "Prep complete (alpha.50 pin, fork strip, iOS RocksDB spike). Next: copy jazz2 main crate, re-port AvenOS P2P patches, cut over to jazz.rocksdb, smoke on macOS + iOS."
todos:
  - id: toolchain-align
    content: "Decide rust-toolchain for re-vendor — bump AvenOS to 1.93.1 (jazz2 pin) or validate upstream crate on 1.88; update app/src-tauri/rust-toolchain.toml if bumping"
    status: pending
  - id: revendor-jazz-tools
    content: "Replace third_party/jazz-tools from jazz2-upstream/crates/jazz-tools (SHA 232a9933+); add client-p2p feature (rocksdb + peer-transport, no websocket/sqlite/surrealkv); keep groove lib alias"
    status: pending
  - id: report-avenos-patches
    content: "Re-port peer_transport, connect_with_peer_transport, P2P write fanout, sync forwarding bypass, QueryError::InternalError; run cargo test peer_transport_codec"
    status: pending
  - id: tauri-integration-cutover
    content: "Update jazz/mod.rs identity reconcile (jazz.rocksdb), AppContext, schema_migrations, peer_sync_gate, schema-hash tool; one-time wipe groove.surrealkv on upgrade"
    status: pending
  - id: p2p-smoke-validation
    content: "macOS + iOS TestFlight: unlock, CRUD, P2P pair, catch-up, spark admin sync on RocksDB backend (after P2P link coordinator stable)"
    status: pending
isProject: false
---

# Jazz upstream re-vendor — execution plan (v3)

> Supersedes [jazz_upstream_gap_analysis_0bfdfa4c.plan.md](jazz_upstream_gap_analysis_0bfdfa4c.plan.md)

## Scope contract — Rust + RocksDB native only

AvenOS Tauri (macOS + iOS) uses **one vendored Rust crate** and nothing else from the jazz2 monorepo.

**In scope:** `crates/jazz-tools` (Rust engine + client), `rocksdb` (`jazz.rocksdb`) on macOS + iOS, AvenOS P2P patches, `groove` lib alias, host integration in `app/src-tauri`, `tauri-plugin-peer`, `libs/jazz-schema`.

**Out of scope — never vendor:** npm TS SDK, OPFS/WASM, SQLite, WebSocket server stack, HTTP server/CLI/otel, starters/examples.

Pin reference (not imported): npm **2.0.0-alpha.50** @ git **`232a9933`**. Recorded in [`third_party/jazz2-mirror-docs/VENDOR_PIN.md`](../../third_party/jazz2-mirror-docs/VENDOR_PIN.md). Local clone: `third_party/jazz2-upstream/` (not tracked).

---

## Completed (removed from active work)

| Milestone | Commit / doc |
|---|---|
| `client-p2p` feature + consumer migration (`ed80d2b`) | HTTP/CLI/server excluded from native builds |
| Physical strip of vendored fork (`bfbc0d1`) | CLI, server routes, HTTP sync, OPFS, upstream integration tests deleted |
| Fork boundary doc | [`third_party/jazz-tools/UPSTREAM.md`](../../third_party/jazz-tools/UPSTREAM.md) |
| Upstream mirror pinned alpha.50 | [`third_party/jazz2-mirror-docs/VENDOR_PIN.md`](../../third_party/jazz2-mirror-docs/VENDOR_PIN.md) — SHA `232a9933` |
| iOS RocksDB spike **PASS** | [`third_party/jazz2-mirror-docs/IOS_ROCKSDB_SPIKE.md`](../../third_party/jazz2-mirror-docs/IOS_ROCKSDB_SPIKE.md) — isolated upstream + AvenOS `cargo check --target aarch64-apple-ios` on stripped fork |
| Vendoring scope documented | Rust + RocksDB only; npm/OPFS/SQLite/TS excluded (UPSTREAM.md + VENDOR_PIN.md) |

**Do not** cherry-pick against `_published_groove/` — upstream main layout diverged. Full re-vendor only.

---

## Current state vs target

| Dimension | Vendored (today) | Target (jazz2 main) |
|---|---|---|
| Layout | `_published_groove/*` flat snapshot | Upstream flat modules (~185 .rs) |
| Storage | SurrealKV `groove.surrealkv` | RocksDB `jazz.rocksdb` |
| Transport | AvenOS `peer-transport` + gated HTTP | Re-port `peer-transport` onto upstream client |
| Schema | `AppContext.live_schemas` | Catalogue rehydrate |
| Sync | Patched forwarding / fanout | Re-apply on upstream `sync_manager` |

---

## AvenOS patches to re-port (must not lose)

| Patch | Current location | Upstream target |
|---|---|---|
| `PeerTransport` + framing | `peer_transport.rs` | New file on upstream crate |
| `connect_with_peer_transport` | `client.rs` | Upstream `client.rs` |
| P2P write fanout | `query_manager/writes.rs` | Upstream `writes.rs` |
| Sync P2P bypass | `sync_manager/forwarding.rs` | Upstream `sync_manager/inbox.rs` |
| `QueryError::InternalError` | `query_manager/manager.rs` | Re-apply |
| `client-p2p` feature | `Cargo.toml` | `rocksdb` + `peer-transport`, no websocket/sqlite |
| `groove` lib alias | `Cargo.toml` | Keep |

Host touchpoints: [`jazz/mod.rs`](../../app/src-tauri/src/jazz/mod.rs), [`peer_sync_gate.rs`](../../app/src-tauri/src/peer_sync_gate.rs), [`schema_migrations.rs`](../../app/src-tauri/src/schema_migrations.rs), [`hyperswarm_groove_bridge.rs`](../../projects/tauri-plugin-peer/src/hyperswarm_groove_bridge.rs), [`libs/jazz-schema`](../../libs/jazz-schema).

---

## Next up (ordered)

### 1. Toolchain align

Upstream mirror pins **Rust 1.93.1**; AvenOS app uses **1.88** ([`app/src-tauri/rust-toolchain.toml`](../../app/src-tauri/rust-toolchain.toml)). Pick one before copying the crate:

- **Preferred:** bump AvenOS to 1.93.1 with re-vendor (matches upstream CI)
- **Alternative:** prove upstream `jazz-tools` builds on 1.88 before copy

### 2. Re-vendor crate

```bash
# refresh mirror if needed
cd third_party/jazz2-upstream && git pull origin main

# replace vendor tree (keep AvenOS patch notes / peer_transport_codec test as checklist)
# copy jazz2-upstream/crates/jazz-tools → third_party/jazz-tools
# add client-p2p = ["runtime-tokio", "rocksdb", "peer-transport", ...]
# [[lib]] name = "groove"
```

Verify:

```bash
cd app/src-tauri && cargo check
cd app/src-tauri && cargo check --target aarch64-apple-ios
cd third_party/jazz-tools && cargo test peer_transport_codec
```

### 3. Re-port AvenOS patches

Apply patch table above; run unit tests. Do not enable websocket, sqlite, or surrealkv in AvenOS features.

### 4. Tauri integration + storage cutover

- Open `jazz.rocksdb` instead of `groove.surrealkv`
- One-time migration: wipe legacy SurrealKV path on first RocksDB boot (document in release notes)
- Fix AppContext / schema catalogue / `schema_migrations.rs` / `peer_sync_gate.rs` for upstream API changes
- Update `tools/avenos-schema-hash` if schema manifest path changes

### 5. P2P smoke (macOS + iOS TestFlight)

Run after re-vendor + cutover. P2P transport layer is stabilized separately ([P2P link coordinator](../../377d0c7) on `samuel/self`).

| Scenario | Expected |
|---|---|
| Unlock vault | Opens `jazz.rocksdb`, no crash |
| Local CRUD | Sparks/intents persist |
| P2P pair (LAN) | Both reach Ready; spark admin grant syncs |
| Catch-up after reconnect | No `ChannelClosed` on send |
| iOS kill / airplane | Peer row drops ~10s (keepalive); reconnect without re-invite |

---

## Rejected / out of scope

| Item | Reason |
|---|---|
| Cherry-pick on alpha.0 snapshot | Layout diverged |
| SQLite fallback | RocksDB both platforms only |
| npm bump (aven-ceo) | Not AvenOS Tauri runtime |
| Vendor whole jazz2 monorepo | TS/browser/server dead weight |

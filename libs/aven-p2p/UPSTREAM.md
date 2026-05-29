# AvenOS `aven-p2p`

Internal crate at `libs/aven-p2p` — merged fork of **peeroxide@1.3.1** + **peeroxide-dht@1.3.1**.

| Upstream pin | Value |
|---|---|
| crates.io | `peeroxide` / `peeroxide-dht` **1.3.1** |
| Repository | https://github.com/Rightbracket/peeroxide |

## Layout

- `src/dht/` — former `peeroxide-dht` (HyperDHT, Noise, relay, holepunch)
- `src/swarm.rs` (+ peers) — former `peeroxide` Hyperswarm layer (`swarm` feature, default on)

## AvenOS patches (preserve on refresh)

| Module | Patch |
|--------|-------|
| `dht/secret_stream.rs` | `SecretStream::into_split()` — independent read/write halves for Groove bridge |
| `dht/connect_ui.rs` | Connect-progress hooks for mesh UI |
| `dht/local_addresses.rs` | LAN IPv4 enumeration for Noise `addresses4` |
| `dht/hyperdht.rs` | Connect transport waterfall (documented in network docs) |
| `peer_discovery.rs` | `JoinOpts::fast_refresh` — 3s DHT refresh + 2s connect retry cap on invite topics |

## Consumers

- `libs/tauri-plugin-peer` — full crate (`swarm` + `dht`)
- `libs/aven-relay` — `default-features = false` (DHT-only relay host)
- `scripts/remote-relay-dht-smoke` — DHT smoke tests

## Refresh procedure (optional)

```bash
# Diff against upstream release tag v1.3.1, re-apply AvenOS patches above.
git clone https://github.com/Rightbracket/peeroxide /tmp/peeroxide
```

Do **not** copy upstream `examples/` or Node.js golden interop tests — AvenOS uses plugin-level tests.

---
title: Auto-heal & coordinator
---

# Auto-heal & coordinator

Developer reference for transport healing and link-phase authority. User summary: [Staying connected](../founders/05-staying-connected.md).

## Single reconnect ritual

All heal triggers funnel through **`PeerCtl::reconnect_peers`** (`peer_reconnect.rs`):

1. Optionally apply **`prefer_lan`** (Wi‑Fi / wired → LAN-first).
2. Tear down stale non-live mux workers (or **all** links on pairing reset).
3. Clear **phantom** coordinator rows (`Handshaking`/`TransportUp` without `worker_active`).
4. **`refresh_announce_relays`**
5. **`prepare_reconnect`** (global) when no live / in-flight links among targets — else per-peer **`note_peer_disconnected`**
6. DHT flush (capped ~4s for pairing-critical paths)
7. Optional transport upgrade probe on path change
8. Coarse **`peer:mesh-push`** → Groove actor **`publish_mesh`**

### Triggers → API

| Trigger | Entry |
| -------- | ------ |
| Network path change | `soft_heal` → `ReconnectOpts::path_change` |
| App foreground | `soft_heal` → `ReconnectOpts::foreground` |
| Mesh reconcile tick | `nudge_allowlisted_discovery` → `ReconnectOpts::mesh_nudge` |
| Pairing discovery tick | `nudge_pairing_discovery` |
| Pairing reset / new invite | `ReconnectOpts::pairing_reset` (`teardown_all_links`) |
| Link down during pairing | `ReconnectOpts::link_down` |
| Mux worker exit (normal) | `note_peer_disconnected` + mesh push; pairing spawns `link_down` reconnect |

Thin wrappers remain on **`PeerCtl`** for Jazz call sites; implementation is one module.

### Path / foreground dedupe (app shell)

On **`peer:network-path-changed`** and **`peer:app-foreground`**:

1. Plugin listener → **`on_network_path_changed`** / **`on_app_foreground`** → full DHT heal.
2. App listener → **`mesh_reconcile(nudge_discovery: false)`** — Groove register + publish only (no second DHT nudge).

Adaptive peer-set tick uses **`mesh_reconcile(nudge_discovery: true)`**.

## Transport suppress gate

peeroxide calls **`should_suppress_transport(pk)`** synchronously from a coordinator snapshot.

Suppress when:

- Phase **`Live`**, or
- **`TransportUp` / `Handshaking`** and bridge reports **`worker_active`**

When suppressed: cancel deferred blind-relay per pk, skip dominant outbound nudges, do not clear inbound slot for an active attempt.

**Backoff** and phantom handshaking **do not** suppress — allows LAN→cellular reconnect after stale state.

## Coordinator phases vs UI

`peer_mesh_state.rs` maps coordinator + DHT connect UI → `PeerMeshPhase` / `PeerConnectSubstate` / `PeerTransportMode` for the webview.

| Coordinator | Typical UI phase |
| ------------- | ----------------- |
| Pairing session active | `pairing` |
| Idle / Discovering / Backoff | `searching` (+ connect substate) |
| TransportUp / Handshaking (worker) | `searching` |
| Live, catch-up pending | `syncing` |
| Live, catch-up done | `ready` |
| Revoked / swarm down | `offline` |

Per-peer heal fields: `reconnectAttempt`, `lastDisconnectReason`, `desiredTransport` vs `transportMode`. Global: `lastPathChangeAtMs`, `lastForegroundHealAtMs`, `healInProgress`.

## Web mesh UI

Mesh snapshots **only** via **`avenos:runtime`**:

- `{ kind: "mesh", snapshot: PeerMeshStatusReply }`
- `{ kind: "table", table: "peers", rows }` for trusted-device rows

Plugin emits coarse signals only: `peer:hyperswarm-ready`, `peer:invite-paired`, `peer:mesh-push`, `peer:connect-ui-changed`. App forwards to Groove actor — **no** mesh assembly inside the plugin.

| Actor op | When |
| -------- | ---- |
| `mesh_refresh` (full) | Hyperswarm ready, invite persisted, explicit retry |
| `mesh_reconcile` | Periodic tick; path/foreground register-only variant |
| `publish_mesh` | Connect UI delta, `peer:mesh-push`, reconcile tail |

## Logging

Target **`avenos::peeroxide`**. Useful filters:

```text
RUST_LOG=info,avenos::peeroxide=info,avenos::jazz=info
```

Look for:

- `reconnect_peers (…): missing=… live=… global_reset=…`
- `peer_heal: link_down did=…`
- `groove_p2p link up peer=… mode=Lan|Relay|…`

Manual **`peer_swarm_retry`** remains a debug escape hatch (full swarm rebuild).

## Further work

Internal refactor plan: `.cursor/plans/p2p_heal_compact_phase2.plan.md` (transport probe unification, `pairing.rs` extract).

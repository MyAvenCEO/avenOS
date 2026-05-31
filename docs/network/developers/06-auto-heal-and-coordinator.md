---
title: Auto-heal & coordinator
---

# Auto-heal & coordinator

Developer reference for transport healing and link-phase authority. User summary: [Staying connected](../founders/05-staying-connected.md).

## First principles

1. **`PeerLinkCoordinator` phase is law** — one predicate `may_global_reset()` gates `prepare_reconnect` and worker abort.
2. **`transport_tick(TickMode)` selects policy** — one entrypoint replaces heal intents / relay reconcile / reconnect wrappers (`transport.rs`).
3. **`TransportScheduler` coalesces triggers** — highest-priority mode wins; debounce per mode.
4. **Transport layers only report** — aven-p2p connect UI → coordinator (sync `note_connect_progress`); bridge → mux phases.

**Rule:** never call `prepare_reconnect` or abort workers while any peer is in `SwarmConnecting | Handshaking (worker) | Live`.

## Transport tick modes

| Mode | Triggers | Allowed side effects |
| ---- | -------- | -------------------- |
| **Pairing** | Pairing discovery tick, invite join, mesh reconcile during invite | DHT flush + dominant redial via scheduler debounce |
| **MeshSteady** | Periodic mesh reconcile | Per-peer dial when mux not live |
| **MeshMissing** | Post-pair relay heal | Per-peer dial for missing peers |
| **Force** | Network path change, app foreground | Full heal if `may_global_reset()` |
| **Reset** | Pairing reset (new invite) | `AllLinks` teardown + `reset_peer_dial_state` |
| **LinkDown** | Groove mux drop | Immediate per-peer recover |

All external triggers call **`PeerCtl::transport_tick(mode)`**; **`TransportScheduler`** debounces and coalesces.

### Triggers → mode

| Trigger | Mode |
| -------- | ------ |
| Network path change | `Force` (plugin only) |
| App foreground | `Force` (plugin only) |
| Periodic mesh reconcile | `MeshSteady` |
| Pairing discovery / mesh tick during invite | `Pairing` |
| Pairing reset / new invite | `Reset` |
| Link down | `LinkDown` |
| Post-pair relay heal | `MeshMissing` |

While **`PairingState`** is `Advertising | Joining | TransportUp | Persisting`, **Force/MeshMissing are blocked** — only Pairing and Reset run.

**Relay-only invite** (`peer_invite_create` / `peer_invite_accept`): both sides blind-relay only; coordinator suppresses transport only when a peer is **`Live`** with active worker; stale `SwarmConnecting` rows cleared after ~8s (`STALE_SWARM_CONNECTING_MS`).

Pairing arms swarm with **`set_active_pair_topic`** + **`reset_peer_dial_state`** so dominant/subordinate use matching invite tokens and retries are not blocked by `waiting`.

## Coordinator phases

| Phase | In-flight | Suppress transport | Linked for sync |
| ----- | --------- | ------------------ | --------------- |
| `Discovering` | yes | no (relay-only) | no |
| **`SwarmConnecting`** | yes | no (relay-only) | no |
| `TransportUp` / `Handshaking` | if `worker_active` | if `worker_active` | no |
| `Live` | yes | yes (with worker) | yes |
| `Backoff` | no | no | no |

`SwarmConnecting` is set synchronously from aven-p2p **connect UI** progress (handshake / blind-relay) before the mux worker exists.

Connect substate in mesh snapshots is projected **only from coordinator phase** (no connect-UI fallback merge).

`may_global_reset()` returns false when any peer is establishing or live.

## Path / foreground dedupe (app shell)

On **`peer:network-path-changed`** and **`peer:app-foreground`**:

1. Plugin listener → **`transport_tick(Force)`** (sole transport heal).
2. App listener → **`publish_mesh()`** only (no second transport heal or full reconcile).

Periodic mesh tick runs full reconcile: allowlist sync, **`transport_tick(MeshSteady)`**, Groove register, publish.

During active pairing, mesh reconcile runs **`transport_tick(Pairing)`** then publish (no duplicate `MeshMissing` from Groove register path).

## Web mesh UI

Mesh snapshots **only** via **`avenos:runtime`**. Plugin emits coarse signals: `peer:hyperswarm-ready`, `peer:invite-paired`, `peer:mesh-push`, `peer:connect-ui-changed`.

## Logging

Target **`avenos::peeroxide`**. Look for:

- `transport (Pairing|MeshSteady|… reason): missing=… global_reset=…`
- `pairing conn complete … attaching Groove mux`
- `peer_heal: link_down did=…`
- `blind-relay: sent pair request` / `wire_paired_streams ok|fail` (pair lifecycle at INFO)

## Two-instance QA checklist

After `bun run dev:app2x:mac` with fresh build:

- [ ] Dominant logs `connecting … epoch=1` (stable, no redial storm)
- [ ] Within ~60s: `peer connected` at INFO **or** `blind-relay pair failed` + subordinate retry
- [ ] `linkedCount >= 1`, `swarmPeerConnectedTotal >= 1` on success
- [ ] Path change / foreground: exactly **one** `transport (Force …)` log per event
- [ ] Mesh UI updates via `avenos:runtime` only

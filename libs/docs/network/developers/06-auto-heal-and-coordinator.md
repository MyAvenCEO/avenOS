---
title: Auto-heal & coordinator
---

# Auto-heal & coordinator

Developer reference for transport healing and link-phase authority. User summary: [Staying connected](../founders/05-staying-connected.md).

## First principles

1. **`PeerLinkCoordinator` phase is law** — one predicate `may_global_reset()` gates `prepare_reconnect` and worker abort.
2. **`HealIntent` selects policy** — rendezvous ≠ recover ≠ reset (`heal_intent.rs`).
3. **`HealScheduler` coalesces triggers** — highest intent wins; debounce per intent (`heal_scheduler.rs`).
4. **Transport layers only report** — aven-p2p connect UI → coordinator; bridge → mux phases.

**Rule:** never call `prepare_reconnect` or abort workers while any peer is in `SwarmConnecting | Handshaking (worker) | Live`.

## Heal intents

| Intent | Triggers | Allowed side effects |
| ------ | -------- | -------------------- |
| **Rendezvous** | Pairing discovery tick, allowlist heal during pairing | DHT flush + relay refresh only |
| **Recover** | Mesh nudge, path change, foreground, link down | Per-peer nudge; `prepare_reconnect` only if `may_global_reset()` |
| **Reset** | Pairing reset (new invite) | `AllLinks`; `prepare_reconnect` if safe |

All external triggers call **`HealScheduler::request`**; **`PeerCtl::heal`** executes policy.

Thin wrappers (`soft_heal`, `nudge_*`, `reconnect_peers`) remain for Jazz.

### Triggers → intent

| Trigger | Intent |
| -------- | ------ |
| Network path change | Recover (`soft_heal`) |
| App foreground | Recover |
| Mesh reconcile tick (paired) | Recover (`nudge_allowlisted_discovery`) |
| Pairing discovery tick | Rendezvous (`nudge_pairing_discovery`) |
| Pairing reset / new invite | Reset |
| Link down | Recover (or Reset if `force_teardown`) |

While **`PairingState`** is `Advertising | Joining | TransportUp | Persisting`, **Recover is blocked** — only Rendezvous and Reset run.

## Coordinator phases

| Phase | In-flight | Suppress transport | Linked for sync |
| ----- | --------- | ------------------ | --------------- |
| `Discovering` | yes | yes | no |
| **`SwarmConnecting`** | yes | yes | no |
| `TransportUp` / `Handshaking` | if `worker_active` | if `worker_active` | no |
| `Live` | yes | yes | yes |
| `Backoff` | no | no | no |

`SwarmConnecting` is set from aven-p2p **connect UI** progress (handshake / holepunch / blind-relay) before the mux worker exists.

`may_global_reset()` returns false when any peer is establishing or live.

## Path / foreground dedupe (app shell)

On **`peer:network-path-changed`** and **`peer:app-foreground`**:

1. Plugin listener → **`soft_heal`** (Recover).
2. App listener → **`mesh_reconcile(nudge_discovery: false)`** — Groove register + publish only.

During active pairing, mesh reconcile returns after Rendezvous only (no allowlist Recover).

## Web mesh UI

Mesh snapshots **only** via **`avenos:runtime`**. Plugin emits coarse signals: `peer:hyperswarm-ready`, `peer:invite-paired`, `peer:mesh-push`, `peer:connect-ui-changed`.

## Logging

Target **`avenos::peeroxide`**. Look for:

- `heal (Rendezvous|Recover|Reset …): … global_reset=… teardown=…`
- `pairing conn complete … attaching Groove mux`
- `peer_heal: link_down did=…`

## Manual QA gate (Mac + iPhone)

Run before relying on coordinator-live-truth merge in production:

| Scenario | Pass criteria |
| -------- | ------------- |
| WiFi pair → iOS 5G | `pair response received` → `linkedCount: 1` ≤15s |
| Active invite, 30s wait | No `prepare_reconnect` during pairing |
| Kill remote app → reopen | Recover only; sync ≤15s |
| Airplane toggle one device | Backoff → Recover; no AllWorkers while SwarmConnecting |
| iOS background 5+ min → foreground | One Recover drain; no double DHT storm |

Log signatures:

- `heal (Rendezvous …): global_reset=false teardown=None` during pairing
- `heal (Recover …): global_reset=false` when any SwarmConnecting
- `heal (Reset …): teardown=AllLinks` only on invite create/accept

Manual **`peer_swarm_retry`** remains a debug escape hatch.

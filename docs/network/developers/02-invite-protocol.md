---
title: Invite protocol
---

# Invite protocol

User walkthrough: [Pair a device](../founders/02-pairing-a-device.md).

## Flow

1. **Invite** — `peer_invite_create` generates a six-character code; host joins the signalling topic; UI shows the code on the host chip.
2. **Accept** — joiner calls `peer_invite_accept(code, label)` with a label for the host on their device.
3. When a Noise connection lands on the signalling topic, each side derives the remote `did:key` from the static key and emits **`peer:invite-paired`**.
4. The shell **upserts** `peers` (`active`), **cancels** the signalling join, and enqueues **full mesh refresh** on the Groove actor (allowlist sync + durable per-pair joins + `register_peer_sync_client` when **Live** → mesh snapshot publish).

UI updates from **pushed** `avenos:runtime` mesh/table snapshots — not a peers-screen poll loop.

## Transport reset before invite

Starting a new invite runs **`transport_tick(Reset)`**: global `prepare_reconnect` + **`teardown_all_links`** + **`reset_peer_dial_state`** so ghost mux workers and stale swarm `waiting` state do not block the fresh pairing stream.

Order: teardown links → `prepare_reconnect` → leave durable topics → join signalling topic → DHT flush.

## Pairing dial authority

After reset, **`arm_pairing_swarm`** sets **`active_pair_topic`** (invite topic hash) and clears dial state. The swarm uses this topic for **all** blind-relay pair tokens during `fast_refresh` — not `peers[pk].topics.first()`.

**Dominant** (higher ed25519 static key) outbound-dials on discovery; **subordinate** defers outbound (`should_outbound_connect`). During pairing, dominant bypasses swarm `waiting` backoff via **`try_queue_outbound`**.

## Post-pair persist

Durable topic join may **defer DHT flush** until mux is **Live** or a short grace elapses.

## Events (coarse)

| Event | App action |
| ----- | ----------- |
| `peer:invite-paired` | Persist row, mesh refresh |
| `peer:mesh-push` | Groove actor `publish_mesh` |
| `peer:hyperswarm-ready` | Full mesh refresh |

See [Auto-heal & coordinator](06-auto-heal-and-coordinator.md) for heal during active pairing (path change, link down).

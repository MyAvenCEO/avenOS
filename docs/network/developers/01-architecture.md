---
title: Architecture overview
---

# Architecture overview

User-facing concepts: start with [My Network](../founders/01-my-network.md). This page is the developer map.

## Data model

- **`peers` table** — local-only rows (`nosync` metadata); fields `peer_did`, `label`, `added_at_ms`, `status`.
- **Per-pair topic** — `discovery_key("aven:peer-pair:v1:" || sort(didA, didB))`.
- **Signalling topic** — `discovery_key("aven:pair:v1:" || code)` for the invite only.
- **Inbound gate** — connections on pairing topics are always accepted until the row is written; per-pair topics require an **active** allowlist DID for the remote static key.

## Layer ownership

| Layer | Crate / module | Responsibility |
| ----- | -------------- | ---------------- |
| DHT + Noise | `aven-p2p`, `tauri-plugin-p2p` | Topics, allowlist socket gate, connect UI hook |
| Link phase | `PeerLinkCoordinator` | Single owner per remote static key; suppress transport |
| Groove mux | `HyperswarmGrooveBridge` | SecretStream → Jazz sync; reader/writer split tasks |
| Mesh UI | `peer_mesh_state.rs` | Assemble `PeerMeshStatusReply` → `avenos:runtime` |
| Spark sync | `jazz/mod.rs`, Groove actor | Allowlist sync, `register_peer_sync_client`, catch-up |

Do **not** add a second webview channel for mesh payloads — see [Auto-heal & coordinator](06-auto-heal-and-coordinator.md#web-mesh-ui).

## Cold-start reconnect

After unlock, **PeerCtl** rebuilds transport from persisted `peers` rows (no second invite):

1. **Swarm identity** from the vault Ed25519 seed (`start_swarm` after unlock).
2. Join **durable per-pair topics** with `pairing_join_opts()` / `fast_refresh`.
3. **Capped DHT flush** (~4s) — logs may say `reconnect allowlisted peers` or `reconnect_peers`.
4. Topics leave only on **revoke** or allowlist shrink; **lock** tears down swarm + in-memory pairing.

**Jazz** calls `register_peer_sync_client` only when coordinator phase is **`Live`** (`groove_p2p link up`). UI **`linkedCount`** reads the same snapshot.

## P2P sync policy (three axes)

Keep transport, sync policy, and UI separate — do not infer “connected” from DHT alone.

| Axis | Source of truth | User-visible |
| ---- | ----------------- | ------------ |
| **Transport** | `PeerLinkCoordinator` mux + `HyperswarmGrooveBridge::peer_send_ready` | `groove_mux_ready`, mode always **relay** (relay-only steady state) |
| **Sync** | `spark_sync::should_forward_p2p` + `ManagedJazz::sync_acl` + Groove register | `sync_ready`, `syncBlockReason` |
| **UI phase** | `PeerSessionFacts` / `derive_usability` only | mesh phase (`Ready` requires mux + ACL + catch-up) |

**Outbound policy** (`spark_sync.rs`, enforced in `peer_sync_gate.rs`):

- **`sparks` / `keyshares`** — forward to allowlisted peer after ACL snapshot loads (pairing bootstrap; no per-spark biscuit `owns` yet).
- **`peers`** — never forwarded (permanent drop, no outbox retry storm).
- **Spark data** (`messages`, `humans`, …) — `spark_peer_is_owner` for destination DID.
- **`BatchFate`** and other control frames — forward when ACL is loaded.

Pairing completes with `execute_mesh_refresh_full` (allowlist + discovery nudge + register), not UI-only mesh publish.

## PeerLinkCoordinator (summary)

One encrypted Groove mux per remote static key. Phases: `Idle` → `Discovering` → `TransportUp` → `Handshaking` → `Live` → `Backoff`.

- Only **`Live`** enables spark sync and counts toward `linkedCount`.
- **Transport suppress** in aven-p2p: `Live`, or `TransportUp`/`Handshaking` **with an active mux worker** (`worker_active`).
- Mux keepalive `avenos/mux-ping/v1` every 5s; two missed rounds (~10s) tear down stale links.

Full heal pipeline: [Auto-heal & coordinator](06-auto-heal-and-coordinator.md).

## Related pages

- [Invite protocol](02-invite-protocol.md)
- [Allowlist storage](03-allowlist-storage.md)
- [Two-instance harness](04-two-instance-harness.md)
- [Central P2P signal](05-p2p-signal.md)
- [Auto-heal & coordinator](06-auto-heal-and-coordinator.md)

## TestFlight acceptance matrix

| Scenario | Expected |
| -------- | -------- |
| Linked → kill remote app → reopen | Reconnect ≤15s, sync resumes |
| Linked on relay → network change | Stays on blind relay; self-heal via `steady_reconcile` |
| Mac reboot, iPhone stays open | Mac unlock → reconnect without invite |
| Airplane mode toggle on one device | Heal after path satisfied |
| iOS background 5+ min → foreground | One Recover drain; no double DHT storm |

User-facing expectations: [Staying connected](../founders/05-staying-connected.md).

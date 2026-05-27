---
title: Allowlist, topics, and transport
---

# Architecture

- **`peers` table** — local-only rows (`nosync` metadata); fields `peer_did`, `label`, `added_at_ms`, `status`.
- **Per-pair topic** — `discovery_key("aven:peer-pair:v1:" || sort(didA, didB))`.
- **Signalling topic** — `discovery_key("aven:pair:v1:" || code)` for the invite only.
- **Inbound gate** — connections on pairing topics are always accepted until the row is written; per-pair topics require an **active** allowlist DID for the remote static key.

## Reconnect ritual

After a vault is unlocked, **PeerCtl** rebuilds mesh transport against the persisted `peers` table (no second invite):

1. **Swarm identity** stays tied to the same local Ed25519 seed for that vault (`start_swarm` after unlock).
2. For each active remote DID, join the **durable per-pair topic** (`discovery_key("aven:peer-pair:v1:" || sorted(dids))`) with **`fast_refresh`** pairing options (`pairing_join_opts()`).
3. Run a **capped flush** on the swarm (about **four seconds**) so the next DHT round runs promptly — same pattern as the invite handshake; continuation work may finish in the background. Logs often mention **`reconnect allowlisted peers`** for this flush.
4. Topics are **only left when a peer is revoked** or the allowlist shrinks; locking the vault **tears down** the swarm and clears in-memory pairing state for privacy — the **next unlock** repeats this ritual against the saved rows.

**Jazz/Groove** layers register `register_peer_sync_client` **after** a live hyperswarm link appears (`groove_p2p link up` in logs); mesh ticks may **nudge** discovery while allowlisted peers have no links yet, without rebuilding the entire allowlist each tick.

## Web mesh UI (`avenos:runtime`)

The desktop/mobile shell exposes mesh state **only through one channel**:

- **`avenos:runtime` payloads** `{ kind: "mesh", snapshot }` for transport phases, pairing pending code, diagnostics, and per-peer connect substates (`PeerMeshStatusReply`).
- **`avenos:runtime`** `{ kind: "table", table: "peers", rows }` for trusted-device rows (`PeerRowReply[]`) after a ref-counted `subscribe` to the `peers` table.

Groove actor mailboxes (`publish_mesh` vs full `mesh_refresh`) own when snapshots are built; the webview **does not poll** mesh IPC on a timer for normal UI. Prefer the shared Svelte stores fed by that channel over ad-hoc `peerList` / duplicate `peer:*` mesh events.

This path uses **public HyperDHT** only; it does **not** require `AVENOS_DHT_BOOTSTRAP`, relay endpoints, or other custom infra for reconnect.

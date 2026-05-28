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

**Jazz/Groove** layers register `register_peer_sync_client` **only after** coordinator **`Live`** (`groove_p2p link up` in logs). UI **`linkedCount`** and spark ACL catch-up read the same coordinator snapshot.

- **Pairing / allowlist reset** — `prepare_reconnect` + `teardown_all_links` clears ghost slots before a new invite or empty allowlist (never while any peer is in-flight).
- **Post-invite persist** — durable topic join runs without DHT flush until mux is **Live** or a short grace elapses, preserving the winning LAN pre-reply stream.

## PeerLinkCoordinator (single link owner)

One encrypted Groove mux per remote static key. **PeerLinkCoordinator** owns phase for each peer; DHT discovery, LAN pre-reply, blind-relay, and heal nudges are subordinate to it.

Phases:

- **`Idle` / `Discovering` / `Backoff`** — no sync; UI shows searching.
- **`TransportUp` / `Handshaking`** — Noise stream up, mux worker starting; transport actions suppressed in peeroxide (no blind-relay storm, no stale-slot clear).
- **`Live`** — mux writer ready; **only phase that enables spark sync** and counts toward `linkedCount`.

peeroxide receives `should_suppress_transport(pk)` from the coordinator. When suppressed, deferred blind-relay tasks are cancelled per peer, dominant-side outbound nudges are skipped, and inbound reconnect does not clear an active slot.

Mux **keepalive** (`avenos/mux-ping/v1`) runs every 5s; two missed rounds (~10s) tear down the link so killed/airplane peers leave the UI promptly.

## Auto-heal (link-down, path change, foreground)

1. **Link-down** — when a Groove mux exits, `HyperswarmGrooveBridge` notifies peeroxide via `note_peer_disconnected`; proven peers get fast retry (≤2s with `fast_refresh` topics).
2. **Per-peer nudge** — mesh reconcile calls `nudge_allowlisted_discovery` for allowlisted DIDs **missing** an in-flight or live link (`TransportUp` ∪ `Handshaking` ∪ `Live`); global `prepare_reconnect` runs only when no peer is pairing or in-flight.
3. **Network path change** — `NWPathMonitor` (macOS/iOS Swift bridge) emits `peer:network-path-changed`; **PeerCtl** runs soft heal: `refresh_announce_relays` → flush → per-peer nudge. Wi‑Fi/wired paths set `desiredTransport: lan` in the mesh snapshot.
4. **App foreground** — `UIApplication` / `NSApplication` `didBecomeActive` emits `peer:app-foreground`; same soft heal path without vault lock.
5. **Transport upgrade** — while linked on relay/punched, mesh reconcile probes a better path every ~90s; if a new connect succeeds with a better rank (LAN > direct > punched > relay), the Groove bridge **migrates** the mux atomically (same `ClientId`, catch-up state preserved).

Manual **`peer_swarm_retry`** remains a debug escape hatch (full swarm rebuild); normal operation does not require it.

Structured logs use the `avenos::peeroxide` target with `peer_heal:` prefixes (`link_down`, `path_change`, `foreground`, `upgrade`, `nudge`).

## Web mesh UI (`avenos:runtime`)

The desktop/mobile shell exposes mesh state **only through one channel**:

- **`avenos:runtime` payloads** `{ kind: "mesh", snapshot }` for transport phases, pairing pending code, diagnostics, and per-peer connect substates (`PeerMeshStatusReply`).
- **`avenos:runtime`** `{ kind: "table", table: "peers", rows }` for trusted-device rows (`PeerRowReply[]`) after a ref-counted `subscribe` to the `peers` table.

Groove actor mailboxes (`publish_mesh` vs full `mesh_refresh`) own when snapshots are built; the webview **does not poll** mesh IPC on a timer for normal UI. Prefer the shared Svelte stores fed by that channel over ad-hoc `peerList` / duplicate `peer:*` mesh events.

Per-peer heal fields in `PeerMeshPeerState`: `reconnectAttempt`, `lastDisconnectReason`, `desiredTransport` vs `transportMode`. Global diagnostics: `lastPathChangeAtMs`, `lastForegroundHealAtMs`, `healInProgress`.

Central relay mode (`AVEN_RELAY`) uses the same heal pipeline; DHT bootstrap/relay hints are refreshed on path change so announces stay current.

## TestFlight acceptance matrix

| Scenario | Expected |
| -------- | -------- |
| Linked → kill remote app → reopen | Reconnect ≤15s, sync resumes |
| Linked on relay → both join same Wi‑Fi | Stable reconnect; transport may upgrade to `lan` within ~90s |
| Linked on LAN → iPhone to 5G | Downgrade to punched/relay, stay linked |
| Mac reboot, iPhone stays open | Mac unlock → reconnect without invite |
| Airplane mode toggle on one device | Heal after path satisfied |
| iOS background 5+ min → foreground | Heal without manual retry |
| Walk through relay → LAN → relay | No manual invite; transport mode updates in UI |

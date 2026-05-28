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

**Jazz/Groove** layers register `register_peer_sync_client` **only after** a mux-ready link (`groove_p2p link up` in logs). UI **`linkedCount`** and spark ACL catch-up use the same **`LiveLinkRegistry`** phase (`MuxReady` only — handshaking transport slots do not count).

## LiveLink (single connected definition)

- **`Handshaking`** — transport stream accepted; label exchange (pairing) or mux worker starting.
- **`MuxReady`** — Groove mux worker running with outbound channel; **only state that enables spark sync**.
- **Pairing / allowlist reset** — `prepare_reconnect` + `teardown_all_links` clears ghost slots before a new invite or empty allowlist.
- **Sequential transport** — peeroxide delivers one path per handshake (LAN pre-reply, then blind-relay fallback); `connections.add` runs immediately before `conn_tx.send`, not at handshake start.

## Auto-heal (link-down, path change, foreground)

Trusted peers reconnect **without re-inviting** when links drop or the network changes:

1. **Link-down** — when a Groove mux exits, `HyperswarmGrooveBridge` notifies peeroxide via `note_peer_disconnected`; proven peers get fast retry (≤2s with `fast_refresh` topics).
2. **Per-peer nudge** — mesh reconcile (2s/8s tick) calls `nudge_allowlisted_discovery` for each allowlisted DID **missing** a live bridge link; live peers are not torn down.
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

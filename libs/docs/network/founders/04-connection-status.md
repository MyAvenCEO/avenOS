---
title: Connection status
---

# Connection status

The header and **Self → Connect & trust** list show the same live mesh state. Chips use plain language; detail lines expose transport mechanics when useful.

## Phase chips

| Chip | You see | What it means |
| ----- | -------- | --------------- |
| **Pairing…** | Pulsing pairing colour | A six-character invite is active on this device |
| **Connecting…** | Blue pulse | Searching or establishing the encrypted link |
| **Syncing…** | Amber pulse | Link is up; Groove catch-up in progress |
| **Up to date** | Green | Transport ready and catch-up finished (for granted sparks) |
| **Offline** | Red | Peer revoked, vault locked, or swarm not running |

**Up to date** means **transport + catch-up** for the mesh layer — not “every spark in the universe synced.” Spark ACL still applies.

## Detail sub-labels (Connecting…)

While **Connecting…**, you may see:

| Sub-label | Meaning |
| --------- | -------- |
| **Discovering** | DHT / topic lookup for the peer |
| **Handshaking** | Noise encryption handshake in progress |
| **Holepunching** | NAT traversal attempt |
| **Relay fallback** | Direct paths failed; using encrypted Aven relay |
| **Retry N (…)** | Auto-heal attempt after a drop (network change, idle timeout, …) |

These are **normal** during reconnect — especially Wi‑Fi ↔ cellular.

## Transport modes (Syncing / Up to date)

When linked, a transport tag describes **how** bytes flow:

| Tag | Plain English |
| ----- | --------------- |
| **LAN** | Same local network (Wi‑Fi or Personal Hotspot) |
| **Direct** | Public internet, no punch needed |
| **Punched** | NAT hole punched between routers |
| **Relay** | Encrypted fallback via Aven relay (UDP 49737) |

You may see **LAN → Relay** (or similar) while AvenOS upgrades or downgrades path — for example iPhone leaves Wi‑Fi for 5G. No action needed unless it stays stuck on **Connecting…** for many minutes.

## Diagnostics (advanced)

**Self → Connect & trust** may expose diagnostics for beta builds: bootstrap host, topic count, **linked count** (mux-ready peers), path-change timestamps. **`linkedCount`** counts fully ready sync links — not “DHT saw someone.”

For TestFlight QA signals, see [iOS P2P smoke checklist](../../deploy/ios-testflight-p2p-smoke.md).

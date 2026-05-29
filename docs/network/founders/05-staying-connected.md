---
title: Staying connected
---

# Staying connected

After the first successful pair, AvenOS **reconnects on its own**. You should not need a new invite when everyday network life happens.

## What triggers auto-reconnect

AvenOS runs one internal **reconnect ritual** whenever:

- A link drops (app killed, idle timeout, keepalive miss ~10s)
- **Network path changes** — Wi‑Fi ↔ cellular, VPN, hotspot
- The app returns to **foreground** after iOS background
- The periodic mesh tick notices a paired peer is missing while allowlisted

The ritual refreshes relay hints, clears stale half-dead connections, nudges discovery for missing peers, and updates the UI — without wiping live links that still work.

## What to expect

| Situation | Typical behaviour | How long |
| --------- | ----------------- | -------- |
| Same Wi‑Fi | **LAN** transport; fast sync | Seconds |
| iPhone → 5G while Mac on Wi‑Fi | Downgrade to **Punched** or **Relay**; chip may show **Connecting…** briefly | Often ≤15s |
| Kill remote app → reopen | **Connecting…** then **Up to date** | Often ≤15s |
| Airplane mode toggle | **Offline** or **Connecting…** until path satisfied | ~10–30s |
| Mac sleep → wake | Reconnect after unlock; no new invite | ~30–60s on cold DHT |
| iOS background 5+ min | Foreground heal on return | Usually automatic |

Transport may **upgrade** back to LAN when both devices rejoin the same network (often within ~90s while linked).

## What AvenOS preserves

- **Same device identities** — pairing survives reboot.
- **Same spark catch-up state** when transport mode changes (LAN → relay) — sync resumes where it left off for admin-granted sparks.
- **Live links** during partial outage — if one peer stays up, AvenOS nudges only the missing one instead of tearing down everyone.

## When to use **Retry swarm**

**Retry swarm** (Self → peers, beta/diagnostics) rebuilds the Hyperswarm stack from scratch. Use it only when chips stay **Offline** or **Connecting…** for many minutes despite good internet. Normal life cycle should not require it.

## Locking the vault

**Lock** tears down the swarm and clears in-memory pairing sessions for privacy. **Unlock** runs the same allowlist reconnect ritual against saved `peers` rows — no second invite if trust was already established.

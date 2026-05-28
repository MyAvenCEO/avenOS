---
title: My Network
---

# My Network

**My Network** is your device’s invite-only list of trusted peers — other Macs, iPhones, or iPads you have explicitly paired. Each entry is a **device identity** (`did:key`) plus a label you choose (for example “Sam’s MacBook” or “Work iPhone”).

Nothing leaves your mesh by accident:

- **Pairing** only adds a device to this list and opens an encrypted transport between you.
- **Spark data** stays gated separately — pairing does **not** grant read access to your sparks (see [Transport vs data access](03-transport-vs-data-access.md)).

By default the allowlist is **local to each device** (stored in your vault, not replicated as a shared table). Hyperswarm uses **per-pair discovery topics** derived from your two device IDs so only paired devices rendezvous after the initial invite.

## Where you manage it

| Place in AvenOS | What it shows |
| ---------------- | ------------- |
| **Self → Connect & trust** | Invite, accept, revoke peers |
| **Header chips** | Live status per paired device (Connecting…, Up to date, …) |
| **Spark settings → Grant admin** | Who may sync **that spark’s** data (separate from pairing) |

Status chips update automatically — AvenOS pushes mesh state to the UI; you do not need to refresh the peers screen.

## Core ideas (read next)

1. **[Pair a device](02-pairing-a-device.md)** — six-character invite codes, what happens on each side.
2. **[Transport vs data access](03-transport-vs-data-access.md)** — why pairing ≠ spark access.
3. **[Connection status](04-connection-status.md)** — what “Connecting…”, LAN, Relay, and Syncing mean.
4. **[Staying connected](05-staying-connected.md)** — Wi‑Fi ↔ cellular, sleep, kill app, auto-reconnect.
5. **[Troubleshooting](06-troubleshooting.md)** — when to wait, when to retry, when to re-invite.

Developers: see the **Developers** section in this doc tree for protocol, relay env, and harness details.

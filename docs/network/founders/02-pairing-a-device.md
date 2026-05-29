---
title: Pair a device
---

# Pair a device

Pairing proves two devices share a **one-time invite** and adds each other to **My Network**. After that, AvenOS keeps trying to reconnect automatically — you should not need a new code every day.

## Before you start

- Both devices: **unlocked** (Face ID / Touch ID / passphrase).
- Both on a **compatible build** (TestFlight betas should match roughly).
- **Local Network** permission accepted on iOS when prompted (required for LAN discovery).
- For first pairing across the internet, both sides need reachability to the **Aven relay** (built into production builds) or the same dev relay in lab setups.

## Steps

### On the inviting device (host)

1. Open **Self → Connect & trust**.
2. Tap **Invite** (or equivalent). AvenOS shows a **six-character code** (letters and numbers, no ambiguous `0`/`O`).
3. Share the code out-of-band — message, AirDrop, in person. Codes are **short-lived**; if it expires, cancel and create a new one.
4. Wait on the **Pairing…** chip. When the other device accepts, the row moves through **Connecting…** → **Syncing…** → **Up to date**.

### On the joining device (acceptor)

1. Open **Self → Connect & trust**.
2. Enter the code and a **label for the host** (how you will recognize their device on your list).
3. Tap **Accept**. Your side runs the same pairing → connecting → syncing flow.

### After pairing succeeds

- Each device stores the other as **`active`** in its local `peers` table.
- The short **signalling topic** (invite-only) is torn down; a **durable per-pair topic** takes over for everyday reconnect.
- Encrypted **Noise** streams come up; AvenOS attaches the **Groove sync mux** when the link is fully ready.
- **Spark sync** still requires **Grant admin** on each spark you want to share — pairing alone is not enough.

## What you should see

| Phase (chip) | Meaning |
| ------------- | -------- |
| **Pairing…** | Invite code active; waiting for rendezvous on the signalling topic |
| **Connecting…** | Finding each other on the network (discovering, handshaking, holepunch, or relay) |
| **Syncing…** | Link is up; catch-up replication running |
| **Up to date** | Transport live and catch-up finished for allowed sparks |

Sub-labels under **Connecting…** (Discovering, Handshaking, Relay fallback, …) are normal — see [Connection status](04-connection-status.md).

## When **not** to pair again

- App was killed and reopened
- One device switched Wi‑Fi ↔ cellular
- Mac slept or iPhone was backgrounded
- Brief airplane mode

AvenOS **auto-heals** these cases against the saved allowlist. Only pair again if troubleshooting says the trust row is missing or revoke left you disconnected for good.

## Revoking

**Revoke** on a peer row marks them **`revoked`**, leaves the per-pair topic, and drops sync registration. They cannot reconnect until you pair again with a fresh invite.

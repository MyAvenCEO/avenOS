---
title: Allowlist storage
---

# Allowlist storage

User context: [My Network](../founders/01-my-network.md) · [Transport vs data access](../founders/03-transport-vs-data-access.md).

Rows live in Groove table **`peers`** but inserts set **NoSync** metadata so commits are **not** forwarded over P2P. The allowlist is **local policy** on each device.

| Field | Role |
| ----- | ---- |
| `peer_did` | Remote device identity (`did:key`) |
| `label` | Display name you chose at accept (or placeholder during pairing) |
| `added_at_ms` | When trust was established |
| `status` | `active`, `revoked`, or transient pairing states |

Authorization to **read** another device’s encrypted sparks still flows from **biscuits** and **keyshares** (spark admin grants), not from this table alone.

**PeerCtl** reads active DIDs on mesh reconcile and syncs Hyperswarm allowlist + per-pair topic joins. See [Architecture overview](01-architecture.md).

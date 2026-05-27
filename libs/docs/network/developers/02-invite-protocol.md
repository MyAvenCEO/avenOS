---
title: Invite protocol
---

# Invite protocol

1. **Invite** — `peer_invite_create` generates a code; host joins the signalling topic; UI shows the code.
2. **Accept** — joiner calls `peer_invite_accept(code, label)` with a label for the host on their device.
3. When a Noise connection lands on that topic, each side derives the remote `did:key` from the static key and emits `peer:invite-paired`. The shell **upserts** `peers` (`active`), **cancels** the signalling join, and enqueues a **full mesh refresh** on the Groove actor (Hyperswarm allowlist sync + durable per-pair joins + `register_peer_sync_client` for live links → then mesh snapshot publish). The pairing row and mesh chips update from **pushed** `avenos:runtime` mesh/table snapshots, not from a peers-screen poll loop.

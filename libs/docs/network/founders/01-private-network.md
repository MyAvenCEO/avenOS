---
title: Your private device mesh
---

# Your private device mesh

**My Network** is an invite-only **peer allowlist** on this device. Each entry is a remote **did:key** (derived from the other device’s Noise static key) plus a label you choose.

By default nothing is shared: transport may connect, but Groove only syncs spark-scoped data to peers that are **both** on your allowlist **and** **Spark admins** for the relevant workspace (see Sparks docs).

**Connect Peer** runs a short invite: both machines join the same signalling topic with a code, then each side stores the other as `active` in the local `peers` table (never replicated — `nosync`). Hyperswarm then uses **per-pair discovery topics** derived from sorted DIDs.

You can **revoke** a peer: their row becomes `revoked`, that topic is left, and sync registration drops.

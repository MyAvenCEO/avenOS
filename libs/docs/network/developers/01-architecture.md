---
title: Allowlist, topics, and transport
---

# Architecture

- **`peers` table** — local-only rows (`nosync` metadata); fields `peer_did`, `label`, `added_at_ms`, `status`.
- **Per-pair topic** — `discovery_key("aven:peer-pair:v1:" || sort(didA, didB))`.
- **Signalling topic** — `discovery_key("aven:pair:v1:" || code)` for the invite only.
- **Inbound gate** — connections on pairing topics are always accepted until the row is written; per-pair topics require an **active** allowlist DID for the remote static key.

---
title: Add-admin grant flow
---

# Add-admin grant flow

`spark_admin_add(sparkId, peerDid)` requires `peerDid` in the local **`peers`** allowlist. It attenuates the spark biscuit for third-party `owns`, updates `sparks.genesis_b64`, inserts a **keyshare** row for the DEK version, then broadcasts snapshots so the peer can merge and decrypt after P2P ingest.

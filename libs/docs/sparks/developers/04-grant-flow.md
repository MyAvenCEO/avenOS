---
title: Add-admin grant flow
---

# Add-admin grant flow

`spark_admin_add(sparkId, peerDid)` requires `peerDid` in the local **`peers`** allowlist. It attenuates the spark biscuit for third-party `owns`, updates `sparks.genesis_b64`, inserts a **keyshare** row for the DEK version, then broadcasts snapshots so the peer can merge and decrypt after P2P ingest.

Each keyshare stores **`wrapper_did`** — the DID of the admin who wrapped the DEK (genesis issuer or a delegated admin). Recipients derive `KEK = DH(my_signing_key, wrapper_pubkey)` so multi-admin chains work (A grants B, B grants C).

After this schema change, wipe local Groove data (`db/` under the vault) or reinstall — old keyshares without `wrapper_did` are not supported.

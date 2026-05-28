---
title: Transport vs data access
---

# Transport vs data access

AvenOS separates **who may connect** from **what they may read**.

## Transport (My Network / pairing)

- **Invite code + Noise + Hyperswarm** establish an encrypted pipe between two device identities.
- Adds the remote device to your **allowlist** so future connections are allowed without a new code.
- Required for any P2P sync — but **not sufficient** for spark content.

Think of transport as: *“I trust this device enough to talk to it.”*

## Data access (Sparks / admin grants)

- Each **spark** has its own ACL: biscuits and DEK keyshares decide decrypt + merge.
- **Grant admin** in **Spark settings** lets a paired `did:key` sync **that spark only**.
- Non-admin sparks stay **private** even when the peer chip shows **Up to date**.

Think of data access as: *“This device may read and write this workspace.”*

## Typical workflow

1. **Pair** Mac and iPhone → both appear in My Network, chips reach **Up to date** when transport is healthy.
2. On the Mac, open a spark → **Grant admin** → pick the iPhone’s device from the paired list.
3. Todos, notes, and other spark-scoped rows replicate to the phone. Other sparks remain invisible until granted.

## Why both layers exist

- You might pair a family device for future use without sharing every spark.
- Revoking **admin** on one spark does not require unpairing the device.
- Revoking **pairing** cuts transport entirely — all sparks stop syncing to that device regardless of old grants.

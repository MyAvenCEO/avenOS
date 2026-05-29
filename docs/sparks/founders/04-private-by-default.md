---
title: Private by default
---

# Private by default

AvenOS treats every spark as **private by default**. There is no “public spark,” no “public row,” and no link that grants read access without an explicit admin grant.

## What you can do

- **Work alone** on a spark on your device — data is encrypted at rest per spark.
- **Share a spark** only by adding another peer as a **spark admin** under Self → Share (biscuit `owns` + DEK keyshare). See [Sharing a spark](02-sharing-a-spark.md).
- **Pair devices** under Self → Peers (My Network) — pairing alone does **not** expose spark ciphertext.

## What we do not offer

- No toggle to make a spark or message “public” or world-readable.
- No anonymous or link-based read access.
- No bypass of Touch ID unlock for Groove row reads in the desktop app.

## How enforcement works (short)

| Layer | Mechanism |
| ----- | --------- |
| **Who may read/write** | Biscuit per spark — only DIDs with `owns` on that spark URN |
| **Who may decrypt** | Per-spark DEK, delivered via **keyshares** to admins you grant |
| **Local app reads** | Touch ID unlock → hydrated Jazz shell → IPC gates every list/create |
| **P2P sync** | Outbound payloads only go to peers who are admins for that spark |

Technical detail: [Plaintext routing columns](../developers/05-plaintext-routing-columns.md) and [Security threat model](../../../security/threat-model-private-default.md).

## After schema changes

If sealing or manifest columns change, **wipe** this vault’s Groove `db/` folder (or delete `Documents/.avenOS` and unlock again). Mixed old/new on-disk shapes are not migrated.

---
title: Network seed — sourcing & identity binding
---

# Network seed — sourcing & identity binding

## What it is

The **network seed** is a hardcoded string that binds every device identity on this build to one Aven network. For alpha testnet:

```
ceo.aven/testnet/abagana
```

It replaces the former `GENESIS_NETWORK_ID` (external 65-byte P-256 public point in `.env`). There is no env var and no user-facing crypto anchor.

## Source

**File:** `libs/tauri-plugin-self/src/network.rs`

| Constant | Value |
|----------|-------|
| `NETWORK_SEED` | `ceo.aven/testnet/abagana` |
| `RELAY_URL` | `relay.aven.ceo` |
| Path segments | `ceo.aven` / `testnet` / `abagana` |

The frontend reads the same string via Tauri command `network_seed` (mirrored in `app/src/lib/settings/network.ts`).

## Derivation (v2)

At unlock, the Secure Enclave performs ECDH against a **deterministic anchor pubkey** derived from `NETWORK_SEED`, then HKDF:

```
anchor = P-256 pubkey from HKDF(NETWORK_SEED, info="ceo.aven/network-anchor/v1")
root   = HKDF(ECDH(SE_priv, anchor), salt=NETWORK_SEED, info=NETWORK_SEED)
sign   = HKDF(root, info="{NETWORK_SEED}/identity/ed25519/v1")
```

See [04-root-derivation.md](04-root-derivation.md).

## On-disk layout

```
~/Documents/.avenOS/ceo.aven/testnet/abagana/
├── peers/<slug>/{vault,db}
└── schema/
```

See [Storage layout](05-storage-and-state.md).

## UI

**Settings → Advanced → Network** shows the current network seed as read-only (not switchable).

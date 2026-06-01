---
title: Root derivation — ECDH + HKDF (network seed v2)
---

# Root derivation — ECDH + HKDF (network seed v2)

## Overview

The 32-byte session root is computed in Swift during `unlock`:

```
NETWORK_SEED = "ceo.aven/testnet/abagana"

anchor_pubkey = deterministic P-256 point from NETWORK_SEED (Rust, internal)

root = HKDF-SHA256(
    ikm  = ECDH(SE_private_key, anchor_pubkey),
    salt = NETWORK_SEED (UTF-8),
    info = NETWORK_SEED (UTF-8),
    L    = 32
)
```

Ed25519 signing key:

```
signing_seed = HKDF-SHA256(
    ikm  = root,
    info = "{NETWORK_SEED}/identity/ed25519/v1",
    L    = 32
)
```

## Swift implementation

**File:** `libs/tauri-plugin-self/swift-lib/Sources/SelfBridge/SelfBridge.swift`
**Function:** `self_derive_root_secret_bridge`

Receives the SE blob, anchor pubkey (65 bytes), and network seed string. HKDF uses the seed for both `salt` and `sharedInfo`.

## Rust side

**File:** `libs/tauri-plugin-self/src/macos/commands.rs`, `unlock` command.

Calls `derive_root_secret(&blob, anchor, NETWORK_SEED, UNLOCK_REASON)` — no genesis bytes from the frontend.

The returned 32 bytes are stored in `SelfState` via `state.set_root(bytes)`. They are **never** returned to JavaScript.

## Session lifetime

The root lives in `SelfState` until `plugin:self|lock` is called or the process exits.

Stronghold uses a sibling key: `HKDF(root, info="{NETWORK_SEED}/stronghold/v1")` — see [Vault plugin architecture](../../vault/developers/01-architecture.md) and [Trust boundaries](../../security/trust-boundaries-and-sensitive-material.md).

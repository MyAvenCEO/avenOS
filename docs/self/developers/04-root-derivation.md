---
title: Root derivation — ECDH + HKDF
---

# Root derivation — ECDH + HKDF

## Overview

The 32-byte session root is computed in Swift during `unlock`. The full derivation is:

```
root = HKDF-SHA256(
    ikm  = ECDH(SE_private_key, genesis_network_id),
    salt = genesis_network_id,          // 65-byte P-256 public point
    info = "ceo.aven.os/root/v1",      // UTF-8
    L    = 32
)
```

## Swift implementation

**File:** `libs/tauri-plugin-self/swift-lib/Sources/SelfBridge/SelfBridge.swift`
**Function:** `self_derive_root_secret_bridge`

```swift
let ctx = LAContext()
ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, ...) { success, _ in
    let key = SecureEnclave.P256.KeyAgreement.PrivateKey(
        dataRepresentation: blobData,
        authenticationContext: ctx   // reuses the authenticated context; no second prompt
    )
    let peer = P256.KeyAgreement.PublicKey(x963Representation: peerData)
    let secret = key.sharedSecretFromKeyAgreement(with: peer)

    let sym = secret.hkdfDerivedSymmetricKey(
        using: SHA256.self,
        salt: peerData,                         // genesis_network_id bytes
        sharedInfo: Data("ceo.aven.os/root/v1".utf8),
        outputByteCount: 32
    )
}
```

The same `LAContext` is passed to the SE key load so the Secure Enclave does not trigger a second biometric prompt.

## Rust side

**File:** `libs/tauri-plugin-self/src/macos/commands.rs`, `unlock` command.

Calls `crate::macos::derive_root_secret(&blob, &genesis_network_id, UNLOCK_REASON)` where `UNLOCK_REASON = "Unlock AvenOS device identity"` (shown in the Touch ID sheet).

The returned 32 bytes are stored in `SelfState` via `state.set_root(bytes)`. They are **never** returned to JavaScript — only derived outputs (signatures, public keys) cross the IPC boundary.

## Session lifetime

The root lives in `SelfState` until `plugin:self|lock` is called or the process exits. `LockGate.svelte` calls `clearDeviceSession()` on window close, which invokes `plugin:self|lock`.

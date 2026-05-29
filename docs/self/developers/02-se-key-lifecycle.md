---
title: Secure Enclave key lifecycle
---

# Secure Enclave key lifecycle

## Key creation

**File:** `libs/tauri-plugin-self/swift-lib/Sources/SelfBridge/SelfBridge.swift`
**Function:** `self_create_se_key_bridge`

Creates a `SecureEnclave.P256.KeyAgreement.PrivateKey` with the following access control:

```swift
SecAccessControlCreateWithFlags(
    nil,
    kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    [.privateKeyUsage, .biometryCurrentSet],
    &cfErr
)
```

`.biometryCurrentSet` means Touch ID / Face ID re-enrollment invalidates the key. `.privateKeyUsage` is required by Apple for SE keys used in key agreement.

Returns:
- `blob`: `priv.dataRepresentation` — SE-wrapped opaque handle, not the raw scalar.
- `publicKey`: `priv.publicKey.x963Representation` — 65-byte uncompressed SEC1 P-256 point.

## On-disk storage

**File:** `libs/tauri-plugin-self/src/macos/commands.rs`

`register` writes two files under `app.path().app_data_dir()/self/` atomically (write to `.tmp`, chmod `0600`, rename):

| File | Contents |
|------|----------|
| `peer-id-{slot}.se-blob` | SE-wrapped opaque handle |
| `peer-id-{slot}.pub` | 65-byte P-256 public point |

Default slot name: `device_default`.

`register` is idempotent — returns `Ok(())` immediately if both files exist.

## Public key recovery

`public_key` command reads `.pub`. If `.pub` is missing but `.se-blob` exists, it calls `self_public_key_from_blob_bridge` (no biometric prompt — reading a public key from an SE blob does not require Touch ID) and rewrites the cache file.

## Key invalidation

Replacing the Mac, re-enrolling biometrics, or deleting the blob files removes access to the private key. There is no recovery path — a new `register` creates a new key pair with a new public identity.

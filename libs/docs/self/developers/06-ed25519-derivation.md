---
title: Ed25519 key derivation
---

# Ed25519 key derivation

## Design

The 32-byte session root is treated as an HKDF PRK. Each derived primitive uses a disjoint `info` string so outputs are independent — compromise of a derived key reveals nothing about the root or sibling keys.

## Implementation

**File:** `projects/tauri-plugin-self/src/derive.rs`

```rust
pub const ED25519_INFO: &[u8] = b"ceo.aven.os/identity/ed25519/v1";

pub fn derive_ed25519_seed(root: &[u8; 32]) -> Result<Zeroizing<[u8; 32]>, String> {
    let hk = Hkdf::<Sha256>::from_prk(root)?;
    let mut seed = Zeroizing::new([0u8; 32]);
    hk.expand(ED25519_INFO, seed.as_mut_slice())?;
    Ok(seed)
}

pub fn signing_key_from_root(root: &[u8; 32]) -> Result<SigningKey, String> {
    let seed = derive_ed25519_seed(root)?;
    Ok(SigningKey::from_bytes(&seed))
}
```

Full derivation path from raw inputs:

```
HKDF-Expand-SHA256(
    prk  = session_root,                            // 32 bytes from ECDH+HKDF
    info = "ceo.aven.os/identity/ed25519/v1",      // stable label
    L    = 32
) → Ed25519 seed → SigningKey / VerifyingKey
```

## Key versioning

Bumping the `vN` suffix in `ED25519_INFO` rotates the keypair without touching the Secure Enclave key or the genesis anchor. This is the correct mechanism for key rotation short of a full network reset.

## Crates used

- `ed25519-dalek` — signing and verification
- `hkdf` + `sha2` — HKDF-Expand-SHA256
- `zeroize` — `Zeroizing<[u8; 32]>` wrapper ensures the seed is zeroed on drop

The derived `SigningKey` is not cached in `SelfState`. Each call to `sign` or `signing_public_key` re-derives the key from the root on the fly.

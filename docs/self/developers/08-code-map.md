---
title: Code map & audit anchors
---

# Code map & audit anchors

## Self plugin (signer / SE)

| Concern | File |
| ------- | ---- |
| SE key creation & ECDH/HKDF in Swift | `libs/tauri-plugin-self/swift-lib/Sources/SelfBridge/SelfBridge.swift` |
| macOS/iOS commands (register, unlock) | `libs/tauri-plugin-self/src/macos/commands.rs` |
| sign, verify, lock | `libs/tauri-plugin-self/src/commands.rs` |
| Ed25519 derivation | `libs/tauri-plugin-self/src/derive.rs` |
| Session root cache | `libs/tauri-plugin-self/src/state.rs` |
| Stronghold open/save | `libs/tauri-plugin-self/src/stronghold_vault.rs` |
| Network seed + paths | `libs/tauri-plugin-self/src/network.rs`, `paths.rs` |

## Vault plugin (secrets)

| Concern | File |
| ------- | ---- |
| Secrets IPC | `libs/tauri-plugin-vault/src/lib.rs` |
| Plugin registration | `app/src-tauri/src/lib.rs` |
| Vault webview capabilities | `app/src-tauri/capabilities/vault-webview.json` |
| Vault routes | `app/src/routes/vault/` |
| Settings / LockGate | `app/src/lib/settings/LockGate.svelte` |
| Open vault window | `app/src/lib/vault/open-vault-window.ts` |

## Audit strings

| Role | Value | Location |
| ---- | ----- | -------- |
| Network seed | `ceo.aven/testnet/abagana` | `network.rs` |
| Anchor HKDF `info` | `ceo.aven/network-anchor/v1` | `network.rs` |
| Root HKDF `salt` + `info` | `NETWORK_SEED` | `SelfBridge.swift` |
| Ed25519 HKDF `info` | `{NETWORK_SEED}/identity/ed25519/v1` | `derive.rs` |
| Stronghold HKDF `info` | `{NETWORK_SEED}/stronghold/v1` | `stronghold_vault.rs` |
| Touch ID sheet reason | `Unlock AvenOS device identity` | `macos/commands.rs` |

## Key sizes

| Value | Size |
| ----- | ---- |
| P-256 public point (SEC1 uncompressed) | 65 bytes |
| Session root / Stronghold key material | 32 bytes |
| Ed25519 seed / public key | 32 bytes |
| Ed25519 signature | 64 bytes |

## Related

- [Trust boundaries & sensitive material](../../security/trust-boundaries-and-sensitive-material.md)

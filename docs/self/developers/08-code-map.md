---
title: Code map & audit anchors
---

# Code map & audit anchors

## File map

| Concern | File |
|---------|------|
| SE key creation & ECDH/HKDF in Swift | `libs/tauri-plugin-self/swift-lib/Sources/SelfBridge/SelfBridge.swift` |
| macOS Tauri commands (register, unlock, public_key) | `libs/tauri-plugin-self/src/macos/commands.rs` |
| Cross-platform commands (sign, verify, lock, signing_public_key) | `libs/tauri-plugin-self/src/commands.rs` |
| Ed25519 derivation (HKDF-Expand from root) | `libs/tauri-plugin-self/src/derive.rs` |
| Session root cache (SelfState) | `libs/tauri-plugin-self/src/state.rs` |
| Plugin registration & Tauri app setup | `app/src-tauri/src/lib.rs` |
| Genesis anchor — env parsing, debug auto-seed, GenesisState | `app/src-tauri/src/genesis.rs` |
| Unlock UI sequence | `app/src/lib/self/LockGate.svelte` |
| Frontend session state (no key bytes) | `app/src/lib/self/device-session-store.ts` |

## Audit strings

These string literals are the stable identifiers for the derivation hierarchy. Any change to them silently rotates keys.

| Role | Value | Location |
|------|-------|----------|
| Root HKDF `sharedInfo` | `ceo.aven.os/root/v1` | `SelfBridge.swift` |
| Ed25519 HKDF `info` | `ceo.aven.os/identity/ed25519/v1` | `derive.rs` (`ED25519_INFO`) |
| Touch ID sheet reason | `Unlock AvenOS device identity` | `macos/commands.rs` (`UNLOCK_REASON`) |

## Key sizes

| Value | Size |
|-------|------|
| P-256 public point (SEC1 uncompressed) | 65 bytes |
| SE opaque blob | variable (SE-determined) |
| Session root | 32 bytes |
| Ed25519 seed | 32 bytes |
| Ed25519 public key | 32 bytes |
| Ed25519 signature | 64 bytes |

---
title: Plugin command surface
---

# Plugin command surface

All commands are registered in `lib/app/src-tauri/src/lib.rs` and implemented across two files:

- `projects/tauri-plugin-self/src/commands.rs` — cross-platform commands
- `projects/tauri-plugin-self/src/macos/commands.rs` — macOS-only SE commands

## Command reference

### `plugin:self|peer_status`
**Args:** `{ slot: string }` — **Returns:** `{ platformSupported: bool, registered: bool, unlocked: bool }`

No biometric prompt. Safe to call on mount to read current state.

### `plugin:self|register`
**Args:** `{ slot: string }` — **Returns:** `()`

Creates the SE key pair for `slot` if it does not exist. No biometric prompt. Idempotent.

### `plugin:self|unlock`
**Args:** `{ slot: string, genesisNetworkId: number[] }` — **Returns:** `()`

Triggers one Touch ID sheet. On success, deposits 32-byte root into `SelfState`. Errors if `genesisNetworkId.length !== 65` or if `slot` is not registered.

### `plugin:self|lock`
**Args:** none — **Returns:** `()`

Zeroizes and clears the root from `SelfState`. Safe to call when unlocked or locked.

### `plugin:self|public_key`
**Args:** `{ slot: string }` — **Returns:** `number[]` (65 bytes)

Returns the P-256 device public key. No biometric prompt.

### `plugin:self|signing_public_key`
**Args:** none — **Returns:** `number[]` (32 bytes)

Returns the Ed25519 public key derived from the current session root. Requires unlocked state.

### `plugin:self|sign`
**Args:** `{ message: number[] }` — **Returns:** `number[]` (64 bytes)

Signs arbitrary bytes with the Ed25519 signing key derived from the root. Requires unlocked state.

### `plugin:self|verify`
**Args:** `{ publicKey: number[], message: number[], signature: number[] }` — **Returns:** `bool`

Stateless Ed25519 verification. Does not require an unlocked session.

### `genesis_network_id` (app-level, not plugin)
**Args:** none — **Returns:** `number[]` (65 bytes)

Reads from `GenesisState`. Implemented in `lib/app/src-tauri/src/genesis.rs`.

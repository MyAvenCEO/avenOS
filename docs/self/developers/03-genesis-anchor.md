---
title: Genesis anchor — sourcing & validation
---

# Genesis anchor — sourcing & validation

## What it is

The genesis network ID is a **65-byte SEC1 uncompressed P-256 public point** that anchors all device identities on a network. It is the `peerPub` input to ECDH during unlock. Every device on the same network must use the same anchor to derive compatible session material.

## Source

**File:** `app/src-tauri/src/genesis.rs`

| Build mode | Env var read | Behaviour if unset |
|------------|-------------|---------------------|
| Release (`--release`) | `GENESIS_NETWORK_ID` | Hard error at startup |
| Debug (default) | `DEV_GENESIS_NETWORK_ID` | Auto-generate & persist |

Values must be **base64-encoded** (standard alphabet). Decoded length must be exactly **65 bytes**.

## Debug auto-seed

In debug builds with no `DEV_GENESIS_NETWORK_ID` set, `genesis.rs` generates a fresh P-256 keypair via `p256::SecretKey::random(&mut OsRng)`, encodes only the **public** point (65 bytes), writes `DEV_GENESIS_NETWORK_ID="<base64>"` to the repo-root `.env`, and discards the private scalar. The `.env` is located by walking up from `CARGO_MANIFEST_DIR` to find the workspace root.

## Runtime state

Decoded bytes are stored in `GenesisState { pub_bytes: Mutex<Option<Vec<u8>>> }` and registered as Tauri managed state. The `genesis_network_id` Tauri command returns `Vec<u8>` (65 bytes) to the frontend.

## Validation

`unlock` in `macos/commands.rs` rejects `genesis_network_id` inputs with length ≠ 65 with error `invalid_genesis_network_id: expected 65-byte SEC1 uncompressed P-256 point, got N`. Same constraint is applied during env var parsing in `genesis.rs`.

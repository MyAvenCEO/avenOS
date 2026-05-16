---
title: Storage layout & state machine
---

# Storage layout & state machine

## On-disk files

All files live under `app.path().app_data_dir()/self/` (macOS: `~/Library/Application Support/ceo.aven.os/self/` or similar).

| File | Mode | Contents | Usable without this Mac? |
|------|------|----------|--------------------------|
| `peer-id-{slot}.se-blob` | `0600` | SE-wrapped opaque key handle | No |
| `peer-id-{slot}.pub` | `0600` | 65-byte P-256 public point | Yes (public data) |

Files are written atomically: write to `{path}.tmp`, `chmod 0600`, then `rename`. The `.se-blob` is ciphertext from the Secure Enclave's perspective; `0600` is defence-in-depth only.

## SelfState (Rust)

**File:** `projects/tauri-plugin-self/src/state.rs`

Holds `Option<[u8; 32]>` wrapped in a `Mutex`, zeroized on clear. Set by `unlock`, cleared by `lock`. All commands that need the root call `state.with_root(|root| ...)` which returns `Err("locked")` if the root is absent.

## Frontend state

**File:** `lib/app/src/lib/self/device-session-store.ts`

```ts
type DeviceSession =
  | { kind: 'locked' }
  | { kind: 'unlocked' }
  | { kind: 'dev_bypass' }
```

`setUnlocked()`, `clearDeviceSession()`, and `devBypassUnlock()` are the only mutations. No key material is stored in the store or in any JavaScript variable.

## State transitions

```
locked  ──register + unlock──▶  unlocked
locked  ──devBypassUnlock──▶    dev_bypass
unlocked / dev_bypass  ──lock / close window──▶  locked
```

`peer_status` command (no biometric prompt) returns `{ platformSupported, registered, unlocked }`. `LockGate.svelte` reads this on mount to detect if a prior session is already unlocked (Rust state survives webview reloads within the same process).

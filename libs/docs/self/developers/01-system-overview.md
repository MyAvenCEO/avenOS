---
title: System overview & IPC sequence
---

# System overview & IPC sequence

`tauri-plugin-self` is a Tauri v2 plugin built from `projects/tauri-plugin-self/`. It exposes Secure Enclave operations to the Svelte frontend via Tauri's typed IPC. On macOS, the plugin calls into a Swift static library (`swift-lib/`) via C FFI; on other platforms the plugin surface exists but SE operations return errors (dev bypass is available in debug builds).

## Unlock sequence

`lib/app/src/lib/self/LockGate.svelte` orchestrates the full unlock in three sequential Tauri invocations:

```
invoke('plugin:self|register', { slot: 'device_default' })
  → creates SE key pair if absent; no biometric prompt; writes blob + pub files

const genesisNetworkId = await invoke('genesis_network_id')
  → returns GenesisState bytes (Vec<u8>, 65 bytes); sourced from genesis.rs

invoke('plugin:self|unlock', { slot: 'device_default', genesisNetworkId })
  → triggers Touch ID; runs ECDH + HKDF in Swift; deposits root into SelfState
```

## Frontend state

`lib/app/src/lib/self/device-session-store.ts` holds a Svelte store with a discriminated union `{ kind: 'locked' | 'unlocked' | 'dev_bypass' }`. No key material, signatures, or derived bytes cross the IPC boundary into JavaScript — only operation results (e.g. signature bytes on demand).

## Plugin registration

The plugin is registered in `lib/app/src-tauri/src/lib.rs` alongside `GenesisState` and `SelfState`. Commands exposed: `register`, `unlock`, `lock`, `peer_status`, `public_key`, `signing_public_key`, `sign`, `verify`.

## Dev bypass

In `import.meta.env.DEV` builds on non-macOS targets, `LockGate.svelte` shows a bypass button. `device-session-store.ts` exposes `devBypassUnlock()`, which sets state to `dev_bypass` without any Tauri call. No SE operations are performed.

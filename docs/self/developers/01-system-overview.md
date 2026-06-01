---
title: System overview & IPC sequence
---

# System overview & IPC sequence

Two Rust plugins and two webview surfaces:

| Plugin | Role |
| ------ | ---- |
| **`tauri-plugin-self`** | SE unlock, sign, identity, opens `strong.hold` |
| **`tauri-plugin-vault`** | Stronghold secrets CRUD (`plugin:vault\|secrets_*`) |

| Webview | Routes |
| ------- | ------ |
| **main** | `/settings/*`, `/sparks/*`, LockGate |
| **vault** | `/vault/*` (child window, isolated capabilities) |

## Unlock sequence

`app/src/lib/settings/LockGate.svelte`:

```
invoke('plugin:self|register', { slot: 'device_default' })
invoke('plugin:self|unlock', { slot: 'device_default' })
  → Touch ID; ECDH + HKDF in Swift; root cached in SelfState
  → strong.hold opened; identity pinned
```

Network id: `ceo.aven/testnet/abagana` (`libs/tauri-plugin-self/src/network.rs`). UI reads via `network_seed` command.

## Frontend session (main)

`app/src/lib/settings/device-session-store.ts`: `{ kind: 'locked' | 'unlocked' }`. No key material crosses IPC into JavaScript.

## Vault embed (child webview)

**Vault** is a root nav item → `/vault` (redirects to `/vault/secrets`). The main window shows aside nav + an embed host; a child webview labeled `vault-embed` loads the same route with `?vaultEmbed=1`. Only that child may call `plugin:vault|*`.

## Plugin registration

`app/src-tauri/src/lib.rs`: `tauri-plugin-self`, `tauri-plugin-vault`. Capabilities: `default.json` (main), `vault-webview.json` (`vault-embed` child).

## Related

- [Trust boundaries & sensitive material](../../security/trust-boundaries-and-sensitive-material.md)
- [Vault plugin architecture](../../vault/developers/01-architecture.md)

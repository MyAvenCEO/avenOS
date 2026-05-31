---
title: Storage layout & state machine
---

# Storage layout & state machine

## Network root

```
~/Documents/.avenOS/ceo.aven/testnet/abagana/
├── identities/
│   └── <slug>/
│       ├── vault/          ← crypto + Stronghold (plugin:self + plugin:vault)
│       └── db/             ← Jazz / Groove
└── schema/                 ← network-level manifest cache
```

Path segments match `NETWORK_PATH_SEGMENTS` in `libs/tauri-plugin-self/src/network.rs`.

## Per-identity `vault/` directory

| File | Mode | Contents | Readable without this device? |
| ---- | ---- | -------- | ------------------------------- |
| `peer-id-{slot}.se-blob` | `0600` | SE-wrapped opaque P-256 handle | No |
| `peer-id-{slot}.pub` | `0600` | 65-byte P-256 public point | Yes (public) |
| `strong.hold` | `0600` | Stronghold snapshot (encrypted secrets) | Ciphertext only offline |
| `manifest.json` | `0600` | Onboarding metadata (name, slug, device label) | Yes |
| `settings.json` | `0600` | Non-secret UI / P2P prefs | Yes |

Atomic writes: temp file → `chmod 0600` → `rename`.

## Per-identity `db/` directory

| File | Contents |
| ---- | -------- |
| `storage.rocksdb` | Groove row storage (sealed payload columns = ciphertext) |

## Rust session state

**`SelfState`** (`libs/tauri-plugin-self/src/state.rs`): `device_root_secret` in RAM until `plugin:self|lock`. Zeroized on clear.

**`StrongholdSession`**: open `strong.hold` after unlock; saved on lock. Owned by self plugin; vault plugin borrows for secrets CRUD.

**`ActiveVault`**: pins unlocked identity slug ↔ Ed25519 ppK.

## Frontend state

**Main webview** — `app/src/lib/settings/device-session-store.ts`:

```ts
type DeviceSession = { kind: 'locked' } | { kind: 'unlocked' }
```

No key bytes in JS. LockGate calls `plugin:self|*`.

**Vault webview** — `app/src/lib/vault/`: secret **names/tags** only in UI state; values never stored in Svelte stores.

## State transitions

```
locked  ──register + unlock (plugin:self)──▶  unlocked
unlocked  ──lock / close──▶  locked  (+ strong.hold save, vault window close)
```

See [Trust boundaries & sensitive material](../../security/trust-boundaries-and-sensitive-material.md) for tier model and webview IPC split.

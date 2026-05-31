---
title: Vault plugin & Stronghold architecture
---

# Vault plugin & Stronghold architecture

`tauri-plugin-vault` manages **user secrets** in IOTA Stronghold (`strong.hold`). It does **not** replace `tauri-plugin-self` (signer / SE unlock).

## Plugin split

| Plugin | Crate | Opens | IPC examples |
| ------ | ----- | ----- | ------------ |
| **self** | `libs/tauri-plugin-self/` | SE, root cache, `strong.hold` on unlock | `register`, `unlock`, `lock`, `sign`, `active_identity` |
| **vault** | `libs/tauri-plugin-vault/` | Stronghold store (after self unlock) | `secrets_list`, `secrets_set`, `secrets_reveal`, `secrets_delete` |

`plugin:self` owns `StrongholdSession` (opened at unlock, saved and dropped on lock). `plugin:vault` borrows that session for CRUD.

## On-disk layout (per identity)

```
~/Documents/.avenOS/ceo.aven/testnet/abagana/
├── identities/<slug>/
│   ├── vault/
│   │   ├── peer-id-{slot}.se-blob    ← plugin:self / SE
│   │   ├── peer-id-{slot}.pub
│   │   ├── strong.hold               ← Stronghold snapshot
│   │   ├── manifest.json
│   │   └── settings.json             ← non-secret prefs; sensitive fields migrate into strong.hold
│   └── db/
│       └── storage.rocksdb           ← Jazz / Groove
└── schema/
```

Stronghold encryption key:

```
stronghold_key = HKDF-SHA256(
  ikm  = device_root_secret,
  info = "{NETWORK_SEED}/stronghold/v1"
)
```

Stronghold internal client name: `"vault"`.

## Frontend

| Route tree | Webview window | Purpose |
| ---------- | -------------- | ------- |
| `/settings/*` | `main` | Peers, connection, preferences, identity (display), workspaces, network, db viewer |
| `/vault/*` | `vault` | Secrets manager (`/vault/secrets`, future sub-routes) |

Capabilities:

- **`default.json`** (`main`): `self:default`, jazz, peer — **no** `vault:*`
- **`vault-webview.json`** (`vault`): `vault:default`, limited read-only `self:*`

Main shell links **Open Vault** → create/focus `WebviewWindow` labeled `vault` at `/vault/secrets`.

## Unlock / lock lifecycle

1. **LockGate** (main): `plugin:self|register` → `plugin:self|unlock`
2. **self plugin**: derive root, open/create `strong.hold`, pin identity
3. User opens vault window → `plugin:vault|secrets_list` (metadata only)
4. **Lock** (main or window close): `strong.hold` save, `plugin:self|lock`, close vault window

## Code map (vault)

| Concern | Location |
| ------- | -------- |
| Stronghold open/save | `libs/tauri-plugin-self/src/stronghold_vault.rs` |
| Secrets IPC | `libs/tauri-plugin-vault/src/` |
| Vault webview routes | `app/src/routes/vault/` |
| Vault nav | `app/src/lib/shell/vault-nav.ts` |
| Capabilities | `app/src-tauri/capabilities/vault-webview.json` |
| Open vault window helper | `app/src/lib/vault/open-vault-window.ts` |

## Related docs

- [Trust boundaries & sensitive material](../../security/trust-boundaries-and-sensitive-material.md)
- [System overview (self plugin)](../../self/developers/01-system-overview.md)

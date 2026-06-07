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
├── peers/<slug>/
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

| Route tree | Webview | Purpose |
| ---------- | ------- | ------- |
| `/settings/*` | `main` | Peers, connection, preferences, identity (display), workspaces, network, db viewer |
| `/vault/*` | `main` shell + child `vault-embed` | Passwords + API keys (`/vault/passwords`, `/vault/api-keys`) |

The main window renders vault chrome (aside nav + embed host). A **child webview** labeled `vault-embed` loads the same route with `?vaultEmbed=1` so secrets IPC runs in an isolated capability set — same pattern as vibe sandbox `vibe-sb-*` webviews.

Capabilities:

- **`default.json`** (`main`): `self:default`, jazz, peer — **no** `vault:*`
- **`vault-webview.json`** (`vault-embed` child): `vault:default`, limited read-only `self:*`

Root nav includes **Vault** → `/vault` (redirects to `/vault/passwords`). Settings → Identity **Open vault** navigates there instead of opening a separate window.

## Unlock / lock lifecycle

1. **LockGate** (main): `plugin:self|register` → `plugin:self|unlock`
2. **self plugin**: derive root, open/create `strong.hold`, pin identity
3. User opens **Vault** in main nav → child webview loads `/vault/passwords?vaultEmbed=1` → `plugin:vault|secrets_list`
4. **Lock** (main): `strong.hold` save, `plugin:self|lock`, destroy `vault-embed` child

Native child embed requires **macOS** (same as vibe sandbox webviews). Other platforms show an error in the embed host until a non-macOS embed path exists.

## Code map (vault)

| Concern | Location |
| ------- | -------- |
| Stronghold open/save | `libs/tauri-plugin-self/src/stronghold_vault.rs` |
| Secrets IPC | `libs/tauri-plugin-vault/src/` |
| Vault webview routes | `app/src/routes/vault/` |
| Vault nav | `app/src/lib/vault/vault-nav.ts` |
| Vault embed (Rust) | `app/src-tauri/src/lib.rs` (`create_vault_embed_webview`, …) |
| Vault embed (TS) | `app/src/lib/vault/tauri-vault-embed.ts`, `VaultEmbedFrame.svelte` |
| Capabilities | `app/src-tauri/capabilities/vault-webview.json` |

## Related docs

- [Trust boundaries & sensitive material](../../security/trust-boundaries-and-sensitive-material.md)
- [System overview (self plugin)](../../self/developers/01-system-overview.md)

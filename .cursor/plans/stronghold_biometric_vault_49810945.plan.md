---
name: Stronghold Biometric Vault
overview: Keep tauri-plugin-self for SE/signer/unlock. tauri-plugin-vault for Stronghold secrets. Split frontend /settings vs /vault/* child webview. On-disk identities/<slug>/{vault,db}, strong.hold. Apple first.
todos:
  - id: rename-vaults-to-identities
    content: On-disk vaults/ → identities/; self/ subfolder → vault/; manifest.json + settings.json; migrate legacy paths
    status: completed
  - id: rename-rocksdb-file
    content: jazz.rocksdb → db/storage.rocksdb in aven-db + jazz mod
    status: completed
  - id: keep-plugin-self
    content: Keep crate tauri-plugin-self + plugin:self| IPC (no rename); document self = signer/SE, vault = storage/UI
    status: completed
  - id: add-stronghold-dep
    content: Add iota_stronghold to tauri-plugin-self; strong.hold at identities/<slug>/vault/strong.hold
    status: completed
  - id: stronghold-vault-module
    content: "stronghold_vault.rs in plugin-self: HKDF stronghold key; client \"vault\"; save on lock"
    status: completed
  - id: wire-unlock-lock
    content: Extend unlock_with_root_secret and lock; StrongholdSession in plugin-self
    status: completed
  - id: frontend-settings-routes
    content: routes/self → routes/settings; lib/self → lib/settings; settings-nav; redirects /self/* → /settings/*
    status: completed
  - id: frontend-vault-webview
    content: routes/vault/* only in WebviewWindow label vault; vault-nav; openVaultWindow from main
    status: completed
  - id: secrets-plugin-and-capabilities
    content: libs/tauri-plugin-vault (Stronghold CRUD); capabilities/vault-webview.json; main self:default without vault:* secrets cmds
    status: completed
  - id: secrets-manager-ui
    content: /vault/secrets in vault webview; plugin:vault|secrets_* IPC
    status: completed
  - id: apple-first-test
    content: "macOS: plugin:self unlock, strong.hold, vault webview secrets, /settings on main"
    status: completed
  - id: docs-update
    content: Document self vs vault naming (plugin, disk, routes)
    status: completed
  - id: future-tpm
    content: "Phase 4: TPM / Keystore adapters (deferred)"
    status: cancelled
isProject: false
---

# Stronghold + naming: self (signer) vs vault (storage/UI)

## Naming map (keep these distinct)


| Word         | Layer                  | Meaning                                                                                                           |
| ------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **self**     | **Rust plugin**        | `tauri-plugin-self` — biometric SE unlock, `device_root_secret`, Ed25519 **self-signer**, DIDs. IPC: `plugin:self |
| **self**     | *not* a frontend route | Old `/self/`* becomes `/settings/`* — avoid route name collision                                                  |
| **vault**    | **Rust plugin**        | `tauri-plugin-vault` — Stronghold CRUD. IPC: `plugin:vault                                                        |
| **vault**    | **On-disk folder**     | `identities/<slug>/vault/` — SE blobs, `strong.hold`, manifest, settings                                          |
| **vault**    | **Frontend route**     | `/vault/`* — isolated child webview for secrets UI                                                                |
| **settings** | **Frontend route**     | `/settings/`* — main webview (peers, identity info, prefs, share, db)                                             |


Two plugins, clean split:

```
tauri-plugin-self   →  unlock, sign, SE biometrics, opens strong.hold
tauri-plugin-vault  →  secrets_list / set / reveal / delete (Stronghold)
identities/.../vault/  →  on-disk folder
/vault/*            →  secrets UI (child webview)
/settings/*         →  persona settings (main webview)
```

---

## On-disk layout

```
~/Documents/.avenOS/ceo.aven/testnet/abagana/
├── identities/<slug>/
│   ├── vault/                  ← on-disk “vault” (not the plugin name)
│   │   ├── peer-id-*.se-blob   ← managed by plugin:self
│   │   ├── peer-id-*.pub
│   │   ├── strong.hold
│   │   ├── manifest.json
│   │   └── settings.json
│   └── db/storage.rocksdb
└── schema/
```

---

## Frontend split

```mermaid
flowchart LR
    subgraph main [WebviewWindow main]
        LockGate[LockGate via plugin:self]
        Settings["/settings/*"]
    end

    subgraph vaultWin [WebviewWindow vault]
        VaultRoutes["/vault/*"]
        VaultRoutes --> Secrets[/vault/secrets]
    end

    LockGate --> Settings
    Settings -->|Open Vault| vaultWin
```



### `/settings/*` (main) — was `/self/*`

Peers, connection, preferences, identity (read-only DID display), workspaces, network, db viewer.

- IPC: `**plugin:self|***` for unlock, sign, identity, identity list/select
- **No** `plugin:vault|*` on main

### `/vault/*` (child webview only)

Entire subtree isolated; window label `vault`.

- IPC: `**plugin:vault|secrets_*`** + read-only `plugin:self|peer_status`, `active_identity`
- Stronghold opened by `**plugin:self`** on unlock; `**plugin:vault`** borrows session

---

## IPC & plugins


| Plugin                   | Role                                                                              |
| ------------------------ | --------------------------------------------------------------------------------- |
| `**tauri-plugin-self**`  | SE register/unlock, root cache, sign/verify, identity select, opens `strong.hold` |
| `**tauri-plugin-vault**` | `secrets_list`, `secrets_set`, `secrets_reveal`, `secrets_delete`                 |



| Webview | Permissions                                                                     |
| ------- | ------------------------------------------------------------------------------- |
| `main`  | `self:default`, jazz, peer — **no** `vault:*`                                   |
| `vault` | `vault:default`, limited `self:allow-peer-status`, `self:allow-active-identity` |


LockGate on main calls `**plugin:self|unlock`**. On lock: close vault window, `plugin:self|lock`, Stronghold save + drop.

---

## Secret tiers


| Tier       | Location                                    | Owner                                                |
| ---------- | ------------------------------------------- | ---------------------------------------------------- |
| RAM        | `device_root_secret`, derived Ed25519       | `plugin:self` / `SelfState`                          |
| Stronghold | `vault/strong.hold`                         | opened by `plugin:self`, CRUD via `**plugin:vault`** |
| Jazz       | `db/storage.rocksdb`                        | jazz engine                                          |
| Plain      | `manifest.json`, non-secret settings fields | disk                                                 |


`stronghold_key = HKDF(root, info="{NETWORK_SEED}/stronghold/v1")`

---

## Phases

### Phase 0

- **Keep** `tauri-plugin-self`; paths `identities/` + on-disk `vault/`; `storage.rocksdb`
- Frontend: `/settings/*`, `/vault/*` webview split; redirects from `/self/*`
- `$lib/self` → `$lib/settings` for main-app identity session (LockGate, device-session-store) — “self” remains in **plugin/API** names, not UI routes

### Phase 1

- Stronghold in `**tauri-plugin-self`** (`stronghold_vault.rs`)

### Phase 2

- `**tauri-plugin-vault`** + vault webview UI (`plugin:vault|secrets_*`)

---

## Summary

- `**tauri-plugin-self`** — signer + SE unlock
- `**tauri-plugin-vault**` — Stronghold secrets (not `vault-secrets`)
- `**/settings/***` — main webview; `**/vault/***` — secrets child webview


# tauri-plugin-self

In-tree Tauri 2 plugin: **Secure-Enclave P-256 key agreement** for `PEER_ID_<device>`, ECDH-derived `device_root_secret` against a hardcoded **network seed** (`ceo.aven/testnet/abagana`).

**Naming:** this crate stays **`tauri-plugin-self`** — signer, SE unlock, root cache, Stronghold open/save. User secrets CRUD lives in **`tauri-plugin-vault`**. On disk, crypto material is under `identities/<slug>/vault/` (folder name “vault”, not the plugin). Frontend settings UI is `/settings/*` (not `/self/*`).

See `src/network.rs`, `src/paths.rs`, `src/stronghold_vault.rs`, and `docs/self/developers/03-genesis-anchor.md`.

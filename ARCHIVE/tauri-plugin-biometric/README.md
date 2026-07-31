# tauri-plugin-biometric — reference package

**This is parked source, not live code.** It is out of the Cargo workspace and is
not expected to compile where it sits. It is kept so the device-key work can come
back without being rediscovered. Card 0121 removed it when avenOS was stripped
back to the avenCITY seed.

Two crates, moved here verbatim from `libs/`:

| Crate | Was | Does |
|-------|-----|------|
| `tauri-plugin-self/` | `libs/tauri-plugin-self` | Secure-Enclave P-256 key agreement, device root secret, Stronghold open/save |
| `tauri-plugin-vault/` | `libs/tauri-plugin-vault` | User-secrets CRUD on top of the vault the above unlocks |

They were always a pair: `tauri-plugin-self` owns the signer, the biometric unlock
and the root cache; `tauri-plugin-vault` owns secrets stored inside it. Bringing
one back without the other is unlikely to be what you want.

## What it actually gives you

A hardware-backed key that never leaves the Secure Enclave, and a root secret
derived from it:

1. A P-256 keypair is generated **in the Secure Enclave** under a label like
   `PEER_ID_<device>`. The private half is non-extractable — you get a handle,
   never the bytes.
2. Touch ID / Face ID gates *use* of that key. The biometric prompt is the OS's,
   so there is no password path to bypass and nothing of yours to store.
3. ECDH against a **network anchor** derives `device_root_secret`, which unlocks
   the on-disk Stronghold vault at `identities/<slug>/vault/`.

The useful property: the vault is bound to *this device's enclave*. Copying the
files to another machine gets you ciphertext, because the key that opens it cannot
be copied.

## The one thing to fix before re-introducing it

`src/network.rs` **hardcodes the network seed**:

```rust
pub const NETWORK_SEED: &str = "ceo.aven/testnet/abagana";
pub const NETWORK_PATH_SEGMENTS: &[&str] = &["ceo.aven", "testnet", "abagana"];
pub const MAINNET_PATH_SEGMENTS: &[&str] = &["ceo.aven", "mainnet", "alberobello"];
pub const RELAY_URL: &str = "relay.aven.ceo";
```

That network seed is HKDF salt for the network anchor, so it is **not cosmetic** —
change it and every derived key changes, which means every existing vault stops
opening. Both worlds those constants name are gone. Before reuse, make the network
seed a parameter (plugin config or builder argument) rather than a constant, and
decide deliberately what the new value is, because you only get to pick it once
per install base.

`RELAY_URL` refers to the Sprite relay, also removed. Nothing here needs it unless
you re-introduce sync.

## Re-introducing it

1. Move the crate(s) back under `libs/` and add to the workspace members.
2. Add to `app/src-tauri/Cargo.toml`:
   ```toml
   tauri-plugin-self  = { path = "../../libs/tauri-plugin-self" }
   tauri-plugin-vault = { path = "../../libs/tauri-plugin-vault" }
   ```
3. Register in `app/src-tauri/src/lib.rs`, before the app's own setup:
   ```rust
   .plugin(tauri_plugin_self::init())
   .plugin(tauri_plugin_vault::init())
   ```
4. Entitlements: the enclave key needs a keychain access group. macOS/iOS both
   want
   ```xml
   <key>keychain-access-groups</key>
   <array><string>$(AppIdentifierPrefix)*</string></array>
   ```
   which is already in `ARCHIVE/tauri-plugin-passkey/aven-os-app_iOS.entitlements`.
5. Parameterise the seed (see above) **before** any user creates a vault.

## Caveat

The Secure Enclave is Apple-only. On Linux these crates compiled against a
software fallback (`src/dev_insecure.rs`) that is exactly what its name says —
fine for development, not a security boundary. If the next architecture is
cross-platform, that fallback is the part that needs a real answer.

## See also

- `../tauri-plugin-passkey/README.md` — the other half of the identity story: RP
  ID, associated domains, and the apple-app-site-association a deployed domain
  must serve.

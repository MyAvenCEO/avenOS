# Server-rooted avenCEO + the `aven-caps` shared crate

**Status:** plan · **Supersedes:** the client-claim model in `AuthIntoServerPlan.md` §4–5 (the avenCEO bootstrap/claim/gate). The cap model, deterministic avenCEO id, and the gate *concept* stand; **who owns/mints avenCEO moves to the server.**

## Thesis

Make the **aven-server the sole author and owner of the avenCEO spark**. The server mints its genesis (server DID = owner), and the **first peer to connect is auto-granted admin** by the server. Everyone after is invited by an admin. This **deletes the entire client-side claim machinery** — local mint, claim-once, issuer compare, idempotency, and the fragile sparksStore-based gate — which is the source of every bug in the client-claim model (races, "already claimed", gate-won't-flip). One authority instead of N racing clients.

`dev:app2x` **already runs a local aven-server** (`ws://127.0.0.1:8080/sync`, built+run by `scripts/dev-two-instances.ts`) that both instances dial — so there is **no new infra**. The server just needs a new ability it lacks today.

## The gap

The aven-server is currently a **pure blind relay** — *zero* biscuit/cap/keyshare logic (it "stores & forwards encrypted batches it cannot decrypt"). All cap minting + keyshare wrapping lives **only in the app** (`app/src-tauri/src/spark_acc.rs` + the keyshare half of `crypto.rs`). So the server cannot mint avenCEO or grant admins. **Foundation first: a shared `aven-caps` crate** both the app and the server depend on (DRY — one cap implementation).

## `aven-caps` — the shared crate (S.1, the keystone)

`libs/aven-caps`, depended on by **both** `app/src-tauri` and `libs/aven-server`.

| Module | From | Contents | Deps |
|---|---|---|---|
| `caps` | `app/src-tauri/src/spark_acc.rs` | biscuit mint/grants/authorize/report, `AccOp`, `BiscuitVault`, `OWNER_RIGHTS`, `aven_ceo_spark_id`, all `attenuate_*`/`spark_*`/`authorize*` | `biscuit_auth`, `uuid`, `base64`, `groove::did_key` (peer_did codec) |
| `keyshare` | keyshare half of `app/src-tauri/src/crypto.rs` | `Dek`, `random_spark_dek`, `ed25519_pk_to_curve25519_pk`, `hkdf_kek`, `derive_kek_x25519`, `encrypt/decrypt_keyshare_payload`, `keyshare_wrap_aad` | `ed25519/x25519/curve25519-dalek`, `hkdf`, `sha2`, `chacha20poly1305`, `rand_core`, `zeroize`, `base64` |

**Stays in the app** (NOT moved): `signing_key_from_device_root` (tauri-specific — callers pass a `SigningKey`/root in); the **cell-sealing** crypto (`seal_text_cell_payload`, `column_type_slug`, `cell_seal_aad`, `groove_value_to_canonical_utf8`, …) — the server is blind, never seals row cells.

**No behavior change.** `app/src-tauri/src/spark_acc.rs` becomes `pub use aven_caps::caps::*;` and the keyshare fns re-export from `aven_caps::keyshare`, so every existing `crate::spark_acc::…` / `crate::crypto::…` call site is unchanged. Verify: `cargo test -p aven-os-app --lib spark_acc::` (the 9 cap tests) stays green; the tests move into `aven-caps` and run with `cargo test -p aven-caps`.

## Server-rooted avenCEO (S.2–S.4, in `libs/aven-server`)

- **S.2 — server biscuit identity.** Derive the server's biscuit `KeyPair` from `AVEN_SERVER_SEED` (it already loads that seed for its did:key). Build a server `BiscuitVault`.
- **S.3 — own avenCEO.** On startup, compute `aven_ceo_spark_id(network_seed)`; if the engine has no avenCEO genesis, **mint it** (server = owner) + a fresh DEK, and persist (RocksDB sparks/keyshares rows, like the app's bootstrap). The server can read avenCEO (it owns it) but stays **blind for all content sparks**.
- **S.4 — auto-grant first peer.** In the WS handshake (`ws_server.rs`), after the did:key is proven: read avenCEO's chain; if it has **no non-server owner**, append `owns(peerDid)` (server-signed third-party block) + wrap a keyshare to the peer → first admin. Persist + the engine syncs avenCEO (genesis + roster + grants) to the peer.
- **Invites (later):** an admin (holds `owns`) grants a pasted DID directly; the grant syncs through the server. (Or routed via the server — decide during build.)

## Client (S.5)

- The app **already dials the server**. Membership = **"do I hold an avenCEO cap in my vault?"** (a local vault check — `shell.vault.sparks.contains_key(avenCEO)` + role via `spark_peer_is_owner`). One IPC `avenCeoMembership() → owner | member | none`.
- **Gate** uses *only* that IPC (delete the sparksStore-based detection).
- **DELETE** the client `avenCeoClaim` mint path, claim-once, issuer/idempotency, `ensure_aven_ceo_owner_row` minting — the server owns avenCEO now. (The owner's roster row + self-publish can stay, scoped by the server-granted caps.)

## What gets deleted (the buggy surface)

Client `groove_ipc_aven_ceo_claim` (mint/claim-once/issuer/idempotent), the sparksStore membership derivation in `+layout.svelte`, the "already claimed" errors, the two-owners race. Replaced by: server mints once + auto-grants; client reads membership from its vault.

## Phases

| # | Step | Gate |
|---|---|---|
| **S.1** | extract `libs/aven-caps` (caps + keyshare); app re-exports | `cargo test -p aven-caps` (moved cap tests) + `cargo check -p aven-os-app` green |
| **S.2** | server biscuit identity from `AVEN_SERVER_SEED` | `cargo check -p aven-server` |
| **S.3** | server mints + owns avenCEO on startup | server logs avenCEO owner = server DID |
| **S.4** | auto-grant first peer admin at handshake | live `dev:app2x`: first instance becomes admin, sees the app |
| **S.5** | client membership-via-vault gate; delete client claim | gate flips on server grant; no client mint code |
| **S.6** | invites (admin grants DID) + roster/self-publish on the server-owned spark | live: onboard a 2nd device |

## Interim

Until S.5, drop the client gate back to "always show the app" so the buggy claim path doesn't block dev.

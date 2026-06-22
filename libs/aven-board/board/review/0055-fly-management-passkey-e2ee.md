---
title: Better Auth passkey (2FA + PRF) → E2EE secrets vault + Fly read-only mgmt UI
summary: ONE passkey via the Better Auth passkey plugin — registered/linked alongside Google as the avenFOUNDER→avenCEO 2nd factor, and the SAME passkey's PRF derives the vault key. Pure Better Auth, end-to-end, inside the native Tauri app (proven on TestFlight Build 4). The server holds only ciphertext. First secret: the user's Fly API token, with a read-only Fly orgs/apps/machines view. (Native tauri-plugin-passkey is NOT used — it can't link into Better Auth and Better Auth already returns PRF; it's been deleted.)
owner: claude (mainnet app + betterauth)
created: 2026-06-20
updated: 2026-06-20
tags: [vault, e2ee, passkey, prf, betterauth, fly, mainnet, app]
goal: "SLICE 1 (E2EE vault) is the build target. Pure Better Auth, end-to-end: the Better Auth passkey plugin registers/links ONE passkey (Better Auth `passkey` table → the user's 2nd factor next to Google, gating avenFOUNDER→avenCEO), and the SAME passkey's WebAuthn PRF extension (`extensions.prf` + `returnWebAuthnResponse`, run inside the native Tauri WKWebView) yields a deterministic 32-byte key. Dedicated betterauth `vault` (one/user) + `secrets` (many/vault) tables store the Fly token E2EE: a random master DEK is envelope-wrapped under HKDF(PRF) with a PINNED per-vault salt, each secret AES-256-GCM under the DEK; the server holds only ciphertext + wrapped-key + salt + nonces. A `deriveVaultKey()` helper returns the PRF from the Better Auth passkey assertion, with a DEV-flag deterministic fallback for unsigned local builds (passkeys need a signed build). Proof: a crypto round-trip test re-derives the SAME key from the pinned salt (determinism) AND asserts the serialized vault+secrets rows contain no plaintext-token / no plaintext-master-key; the Better Auth `passkey` + `vault` + `secrets` migrations apply to Neon; `/api/vault/*` returns 401 unauthenticated and a tier-gate unit test rejects a sub-tier session (403); `bun --cwd libs/betterauth run check` + app svelte-check + biome clean; app Tauri crate `cargo build` exits 0 with NO native passkey plugin. HITL (signed build / TestFlight): register a passkey (linked next to Google) → store token → reload → re-derive via the SAME pinned salt → decrypt; Neon rows hold only ciphertext."
---

# Better Auth passkey (2FA + PRF) → E2EE secrets vault + Fly read-only mgmt UI

## Context

A **reusable per-user secrets vault**, end-to-end encrypted — the Better Auth server stores
only ciphertext and can never read a secret. The **first secret** is the user's own
**Fly.io API token** (self-serve control panel; no reselling/hosting; Fly bills the user;
Fly has no consumer OAuth → a pasted token is the only mechanism). Fly API calls run
**device-side**, read-only.

The headline: **one passkey, two jobs, one plugin.** The **Better Auth passkey plugin**
registers/links a passkey to the Google-authenticated user — that's the **2nd factor** for
the avenFOUNDER→avenCEO tiers ([[0052-roles-tiers-admin-credits]]). The **same passkey**
supports the **WebAuthn PRF extension**, so the same Touch ID that proves the 2nd factor
also emits the deterministic key that decrypts the vault. Extensible: the vault holds many
secrets (Fly token today, any secret/data later).

Builds on [[0050-betterauth-mainnet-google-gate]] (`libs/betterauth` = Better Auth on
**Neon** via Kysely; Google sign-in; bearer auth in Tauri; deployed on fly app
**`api-next-aven-ceo` = `api.next.aven.ceo`**), [[0052-roles-tiers-admin-credits]] (tiers),
[[0053-generic-schema-driven-user-data]] / [[0054-aven-vibes-mainnet-data-llm-tools]] (the
`MainnetShell` nav; the vault uses its OWN tables, not `/api/data`).

### What's PROVEN + SHIPPED (settled — do not re-open)

- **Pure Better Auth / in-app WebAuthn works.** This is a **native Tauri app only** — no
  web/browser build. Inside the app's WKWebView, `navigator.credentials` (which the Better
  Auth passkey client drives) runs the ceremony. **TestFlight Build 4** proved it:
  `origin tauri://localhost`, `WebAuthn API present: true`, `create() ceremony completed`,
  `clientExtensionResults.prf {"enabled":true}`, real 32-byte PRF output. WKWebView binds
  `rp.id` to the **associated-domains entitlement**, not the page origin, once signed.
- **Passkeys require a SIGNED build.** Unsigned `cargo run` fails: origin
  `http://127.0.0.1:1420` (not a registrable domain) + ad-hoc signature (no
  `application-identifier` / `associated-domains` entitlement). → the **DEV-fallback** below
  covers local iteration; real passkeys are tested on a signed build (TestFlight).
- **AASA live + correct:** `https://api.next.aven.ceo/.well-known/apple-app-site-association`
  → `{"webcredentials":{"apps":["2P6VCHVJWB.ceo.aven.os"]}}` (200, application/json, no
  redirect), served by betterauth. iOS + macOS entitlements carry
  `webcredentials:api.next.aven.ceo`. Bundle `ceo.aven.os`, Team `2P6VCHVJWB`.
  **rp.id = `api.next.aven.ceo`.** Shipped to `next` (PR #16, build `next.4`).
- **macOS CI signs correctly:** `release-next.yml` → `build-appstore-macos.ts` signs with
  `Entitlements-appstore.plist` (has `associated-domains`) + embedded provisioning profile.
  Build 4 uploaded clean WITH the entitlement → the profile permits Associated Domains.
- **PRF is deterministic:** `PRF(credential, rp.id, salt)` → the same 32 bytes every time
  (and across synced devices). The vault **PINS one salt** per vault, so unlocks re-derive
  identically. (The probe varied only because it randomized the salt per click.)
- **Native `tauri-plugin-passkey` is NOT used.** It runs a separate ASAuthorization ceremony
  Better Auth never sees, so it can't be the "passkey linked in Better Auth as 2nd factor,"
  and Better Auth already returns PRF — it's redundant. **Deleted** (recoverable from git history / the upstream `tauri-plugin-macos-passkey` crate if ever needed).

### Decisions confirmed

- **Single path = Better Auth passkey plugin.** `addPasskey({ extensions: { prf:{} } })`
  registers/links (2nd factor); a passkey assertion with `extensions.prf.eval.first = salt`
  + `returnWebAuthnResponse` returns the PRF for the vault key. One ceremony, both jobs.
- **Envelope, master-key vault, PINNED salt.** PRF → HKDF-SHA256 → KEK; one random master
  **DEK** per user, KEK-wrapped (stored on the `vault` row with the salt); every `secrets`
  row AES-256-GCM under the DEK. One unlock opens all secrets.
- **DEV-fallback unlock** (insecure, never ships): behind a `DEV` flag, derive the KEK from a
  deterministic dev secret so the vault iterates locally without a signed-build round-trip.
- **Schema = dedicated `vault` + `secrets` tables** (NOT `/api/data`; server-blind).
- **Tier gate:** UI + `/api/vault/*` restricted to avenFOUNDER→avenCEO.
- **Platform v1 = macOS** (signed); iOS follows (same Better Auth path). Fly read-only.

## Goal

A tier-gated, Better-Auth-passkey-unlocked **E2EE vault** (server-blind) whose first secret
is the Fly token; then a Fly view lists orgs/apps/machines read-only. **Completion condition
= the frontmatter `goal`** (slice 1). End state: slice-1 vault with the single Better Auth
passkey path + dev-fallback. Proof: the re-derive + no-plaintext tests, migrations, 401/403
gate tests, green checks + `cargo build` (no native plugin), signed-build HITL. Constraints:
server never sees plaintext/master-key/PRF; pinned salt → deterministic; vault own tables;
**no native passkey plugin in the build**.

## Approach

**Schema (Kysely migration in `libs/betterauth`):**

```
vault     id pk · user_id → "user"(id) UNIQUE · credential_id text (Better Auth passkey)
          prf_salt text (PINNED) · wrapped_master_key text · wrap_nonce text · alg text
secrets   id pk · vault_id → vault(id) ON DELETE CASCADE · user_id → "user"(id)
          kind text ('fly_token') · label text? · ciphertext text · nonce text · alg text
          unique (vault_id, kind)
```
Server-blind: only `wrapped_master_key`, `ciphertext`, salts, nonces — never token/DEK/KEK/PRF.

**Passkey + PRF — `app/src/lib/auth/auth-client.ts` (+ `passkeyClient()`) + `app/src/lib/vault/unlock.ts`:**
- Register/link: `authClient.passkey.addPasskey({ name, extensions: { prf: {} }, ... })` →
  passkey in the Better Auth `passkey` table, linked to the Google user (2nd factor).
- `deriveVaultKey(salt)`: a Better Auth passkey assertion with `extensions.prf.eval.first =
  salt` + `returnWebAuthnResponse` → `clientExtensionResults.prf.results.first` (32B). If no
  passkey provider is available and `DEV` → deterministic dev fallback. Single helper; the
  rest of the code is unlock-agnostic.

**Crypto — `app/src/lib/vault/crypto.ts`:** `deriveKek(prf,salt)` (HKDF) · `wrap/unwrapMasterKey`
(AES-GCM) · `sealSecret/openSecret` (AES-GCM under the master DEK).

**Better Auth server** — add `passkey()` plugin (migrate `passkey`); `/api/vault/*`
(session + tier gated): GET/POST `/api/vault` (vault + wrap), GET/POST `/api/vault/secrets`,
PATCH/DELETE `/api/vault/secrets/:id`. rp.id `api.next.aven.ceo`.

**Fly client (slice 2) — `app/src/lib/fly/client.ts` + Rust `fly_fetch`:** read-only orgs
(GraphQL `organizations`), apps (`GET /v1/apps?org_slug`), machines
(`GET /v1/apps/{app}/machines`).

**UI — `FlyView.svelte` + `MainnetShell` nav** (tier-gated): connect/edit token + passkey
unlock + read-only lists. The Passkey probe tab stays as a dev diagnostic.

**Out of scope / trade-offs:** single unlocking passkey on the vault row (multi-passkey wrap
= follow-on); webview crypto (all-native = follow-on); macOS only; read-only Fly; passkey
does double duty (auth + encryption) — mitigated by envelope + re-pasteable secrets.

## Steps (slice 1 first; checkpoint before slice 2)

1. **Crypto + unlock + tests** — `crypto.ts` + `unlock.ts` (`deriveVaultKey` via Better Auth
   PRF + dev-fallback) + a round-trip test (mock PRF) that **re-derives the same key from a
   pinned salt** and asserts the serialized vault+secrets rows carry no plaintext-token / no
   plaintext-master-key. *(Pure TS — verify first.)*
2. **Better Auth passkey + tier gate** — `passkey()` + `passkeyClient()`; migrate `passkey`;
   tier-gate `/api/vault/*` (unit-tested 403 for sub-tier).
3. **Vault schema + endpoints** — `vault` + `secrets` migration; `/api/vault/*`.
   **Checkpoint: stop here** (secure store proven) before the Fly UI.
4. **Connect/unlock flow** — `addPasskey` (linked next to Google) → `deriveVaultKey` → create
   vault + wrap DEK → seal Fly token; unlock = derive → open.
5. **Fly read-only client** — `fly_fetch` + `client.ts`; mocked-fetch test (3 read-only
   shapes, zero writes).
6. **Fly view + nav** — `FlyView.svelte`, gated nav, i18n; green checks + signed-build HITL.

## Files to touch

Slice 1 (DONE):
- `libs/betterauth`: `+@better-auth/passkey` dep; `src/auth.ts` (`passkey()` plugin);
  `migrations/0006_vault_secrets.ts` (NEW); `src/vault.ts` (NEW endpoints); `src/tier.ts` (NEW
  pure rank SSOT — vault + `billing.ts` reference it, so DRY and unit-testable without the
  env-throwing `auth.ts` load); `src/db.ts` (vault/secret types); `src/server.ts` (routes+CORS);
  `src/vault.test.ts` (tier gate).
- `app`: `+@better-auth/passkey` dep; `src/lib/auth/auth-client.ts` (`passkeyClient()`);
  `src/lib/vault/{crypto,unlock,client}.ts` (NEW); `tests/vault-crypto.test.ts` (NEW — tests live
  in `app/tests/`, which `tsconfig` excludes from svelte-check; `bun:test` would otherwise error).
- Deleted: `ARCHIVE/tauri-plugin-passkey` (dead under the pure-Better-Auth path).

Slice 2 (TODO):
- `app/src/lib/fly/client.ts` + app Tauri crate `fly_fetch` command; `FlyView.svelte` +
  `MainnetShell` gated nav; `app/languages/{en,de}.json` `mainnet.fly.*`.

## Acceptance criteria

- [~] **Migrations applied** — migration `0006_vault_secrets.ts` written (auto-discovered by
      `migrate.ts`, applied on server boot via `bootstrap.ts`). Live-apply to Neon = review.
- [x] **PRF determinism** — `bun test tests/vault-crypto.test.ts` re-derives the SAME key from
      the pinned salt → decrypts (3 pass).
- [x] **E2EE round-trip** — seal then open a secret under a master DEK wrapped by a mock PRF.
- [x] **Server-blind** — the test asserts the serialized `vault` + `secrets` rows contain **no
      plaintext-token**, **no plaintext-master-key**, and **no PRF** substring.
- [~] **Passkey = 2nd factor + PRF** — wired: `passkey()` server plugin + `passkeyClient()`;
      `deriveVaultKey` reads PRF from a WebAuthn assertion on the registered credential. Live
      `addPasskey` → Better Auth `passkey` row needs a signed build → review/HITL.
- [x] **Auth + tier gate** — `meetsTier` unit test (avenME/free/null → false; avenFOUNDER/
      avenCEO → true) passes; `/api/vault/*` 401 live = review.
- [x] **Builds green, no native plugin** — `bun --cwd libs/betterauth run check` 0 + 2 tests pass;
      app svelte-check 0; biome clean; Rust unchanged from green `next.4` (no `tauri-plugin-passkey`
      in Cargo.toml/lib.rs; `ARCHIVE/tauri-plugin-passkey` deleted).
- [x] **Read-only Fly client** (slice 2) — `tests/fly-client.test.ts` asserts exactly the 3
      read-only shapes (GraphQL `organizations` query POST; GET `/v1/apps?org_slug`; GET
      `/v1/apps/{app}/machines`) and **zero writes**. Fly view + nav + `fly_fetch` Rust proxy
      wired; the full roundtrip runs locally via the DEV-fallback key. Live Fly data = HITL.
- [ ] **HITL (signed build):** register passkey (linked next to Google) → store token →
      reload → re-derive (same pinned salt) → decrypt; Neon rows ciphertext-only.

## Verification

```bash
bun --cwd libs/betterauth run check                 # tsc 0 (vault + passkey + tier)
(cd libs/betterauth && bun test)                     # 2 pass (events + tier gate)
(cd app && bun --bun x svelte-check --tsconfig ./tsconfig.json)   # 0 errors
(cd app && bun test tests/vault-crypto.test.ts)      # 3 pass: re-derive + server-blind + wrong-key
(cd app/src-tauri && cargo build --no-default-features --features desktop-ai,local-voice)  # exit 0, no native plugin
curl -s -o /dev/null -w '%{http_code}' http://localhost:8787/api/vault   # 401 (live = review)
# live (HITL, signed build / TestFlight): register passkey → paste token → reload → unlock → decrypt.
# Neon: SELECT user_id, credential_id, prf_salt FROM vault; SELECT kind, ciphertext FROM secrets;
```

## Hand-off

```
/aven-build 0055
```

## Out of scope (follow-on → ideate)

- Multi-passkey unlock (per-passkey wrap subtable) + recovery codes + key rotation.
- iOS / multi-device; all-native crypto; any **write** Fly actions (read-only v1).
- Additional vault secrets beyond the Fly token; a generic secrets UI.

## Progress log

Newest entry first.

- `2026-06-20` — **Built slice 2 (Fly read-only UI), green.** `app/src/lib/fly/client.ts`
  (orgs via GraphQL `organizations`; apps via GET `/v1/apps?org_slug`; machines via GET
  `/v1/apps/{app}/machines`) through a new native Rust `fly_fetch` command (`+reqwest`; the
  webview can't reach Fly — CSP/CORS), with `tests/fly-client.test.ts` asserting the 3
  read-only shapes + zero writes. `vault/store.ts` glues crypto+unlock+API into
  `connectFlyToken`/`loadFlyToken`. `MainnetFly.svelte` (paste token → encrypt → nested
  orgs→apps→machines) + a gated **Fly** nav tab + en/de i18n. Tier gate now **admin-bypasses**
  so the founder/admin account works locally. The whole roundtrip runs in **unsigned local
  dev** via the DEV-fallback key (no signed build needed to iterate). Green: app svelte-check
  0; 4 app tests pass (3 vault + 1 fly); biome clean. Live Fly data + signed-build passkey =
  HITL/review.

- `2026-06-20` — **Built slice 1 (E2EE vault), green.** `app/src/lib/vault/crypto.ts` (HKDF
  KEK + AES-GCM envelope: wrap master DEK, seal/open secrets) with `tests/vault-crypto.test.ts`
  proving PRF re-derive determinism (same pinned salt → same key → decrypts), the server-blind
  invariant (no token / no master-key / no PRF in the serialized rows), and wrong-key-fails (3
  pass). `unlock.ts` = the `deriveVaultKey` SSOT (passkey WebAuthn-PRF assertion → DEV fallback).
  betterauth: migration `0006_vault_secrets.ts` (`vault`+`secret`), `vault.ts` endpoints
  (session + `meetsTier`≥avenFOUNDER → 401/403), `passkey()` plugin (rp.id=api.next.aven.ceo,
  origins), `db.ts` types, `server.ts` routes. Extracted `tier.ts` (pure rank SSOT; `billing.ts`
  now references it — DRY + lets the gate unit-test load without `auth.ts`'s env throw).
  `+@better-auth/passkey@1.6.20` (server + app); `passkeyClient()` wired. Green: betterauth tsc 0
  + 2 tests; app svelte-check 0; biome clean; Rust untouched (no native plugin). Migration
  live-apply, live passkey row, and the signed-build HITL round-trip are for review. Moved
  build → review.
- `2026-06-20` — **Locked: pure Better Auth, single path; native plugin dropped.** Goal is
  ONE passkey via the Better Auth passkey plugin doing both jobs — registered/linked = the
  2nd factor next to Google, and its WebAuthn PRF derives the vault key. Reverted the native
  `tauri-plugin-passkey` wiring and **deleted** the plugin: it runs a separate ceremony Better Auth
  can't see (so it can't be the linked 2nd factor) and Better Auth already returns PRF —
  redundant. Confirmed it's all the native Tauri app's WKWebView (no web target); proven on
  TestFlight Build 4 (`tauri://localhost` + entitlement + AASA → real PRF). PINNED per-vault
  salt for deterministic re-derive; DEV-fallback for unsigned local builds (passkeys need a
  signed build). Sliced: slice 1 = E2EE vault; slice 2 = Fly read-only UI.
- `2026-06-20` — Shipped the domain anchor (PR #16 → `next`, build `next.4`): AASA on
  betterauth (`api.next.aven.ceo`) + macOS/iOS `webcredentials:api.next.aven.ceo` entitlements
  (macOS had none). macOS CI signs with the entitlement (Build 4 uploaded clean).
- `2026-06-20` — Storage = dedicated **`vault` + `secrets`** tables (server-blind; reusable).
- `2026-06-20` — Discovery: BYO-token control-panel (Fly has no consumer OAuth); E2EE = passkey
  PRF + envelope encryption; v1 macOS-only, read-only, device-side Fly calls.

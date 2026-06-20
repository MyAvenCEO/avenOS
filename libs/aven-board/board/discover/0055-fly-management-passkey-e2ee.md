---
title: Tier-gated secrets vault (passkey-PRF E2EE) + Fly management UI (read-only orgs/apps/machines)
summary: A passkey — linked alongside Google in Better Auth and required as the 2nd factor for the avenFOUNDER→avenCEO tiers — unlocks a per-user E2EE vault. The Better Auth server only ever holds ciphertext. First consumer: a mainnet Fly view that stores the user's Fly API token in the vault and shows read-only orgs, apps, and machines fetched device-side.
owner: claude (mainnet app + betterauth)
created: 2026-06-20
updated: 2026-06-20
tags: [vault, e2ee, passkey, 2fa, fly, mainnet, app]
goal: "The vault/Fly feature is gated to the avenFOUNDER→avenCEO tiers and unlocked by a passkey linked alongside Google in Better Auth (the same passkey is the required 2nd factor for those tiers). The user's Fly API token is stored E2EE in dedicated betterauth `vault` (one per user; holds the passkey-PRF-wrapped master key) + `secrets` (many per vault; the encrypted credentials) tables: a random master DEK is wrapped under the passkey's PRF-derived KEK (envelope encryption via the WebAuthn PRF extension — Better Auth passkey client if the WKWebView supports it, else the vendored native tauri-plugin-passkey), and each secret's ciphertext is AES-256-GCM under the master DEK, so the server never holds the token, the master key, or the PRF output. Proof: the Better Auth `passkey` + `vault` + `secrets` migrations are applied to Neon (SELECT via Neon MCP); a crypto round-trip test passes AND asserts the serialized vault+secrets rows contain no plaintext-token and no plaintext-master-key substring; the Fly client issues ONLY read-only requests (GraphQL `organizations`; GET `/v1/apps?org_slug`; GET `/v1/apps/{app}/machines`) proven by a mocked-fetch test recording zero writes; the vault endpoints return 401 unauthenticated and a tier-gate unit test rejects sub-tier users; `bun --cwd libs/betterauth run check` + app svelte-check + biome are clean and the app Tauri crate builds (`cargo build` exits 0). HITL (macOS Tauri): sign in with Google, link a passkey, paste a Fly token, see orgs/apps/machines render, reload and PRF-unlock without re-entering the token, and confirm the Neon vault/secrets rows hold only ciphertext."
---

# Tier-gated secrets vault (passkey-PRF E2EE) + Fly management UI

## Context

avenOS wants a **reusable per-user secrets vault** whose contents are **end-to-end
encrypted** — the Better Auth server stores only ciphertext and can never read a secret.
The **first secret** is a user's own **Fly.io API token**, surfaced as a self-serve Fly
control panel (no reselling, no hosting; Fly bills the user — Fly has no consumer
OAuth-delegation, so a pasted token is the only mechanism). For v1 **all Fly API calls
originate purely from the client device**, so plaintext only ever lives on-device.

The vault is **gated to the avenFOUNDER→avenCEO tiers** (per
[[0052-roles-tiers-admin-credits]]). Those tiers already require a **passkey as their 2nd
factor** — and that same passkey is what unlocks the vault. So the credential that gates
the tier *is* the credential that derives the encryption key: one passkey, **linked
alongside Google** via Better Auth account-linking, doing double duty (step-up auth +
vault unlock).

Builds on the mainnet/Alberobello stack:
- [[0050-betterauth-mainnet-google-gate]] — `libs/betterauth` (bun/hono Better Auth on
  **Neon Postgres** via Kysely), Google sign-in, bearer-token auth in Tauri. "Our pg db"
  = this Neon database. Native Google sign-in already uses a Tauri plugin because the
  embedded webview can't do Google's OAuth (a Google policy block, not a WebAuthn block).
- [[0052-roles-tiers-admin-credits]] — tiers/roles; the vault gate reuses its tier model.
- [[0053-generic-schema-driven-user-data]] / [[0054-aven-vibes-mainnet-data-llm-tools]] —
  the `MainnetShell` Chat | Vibes nav (we add a **Fly** view) and the `/api/data` pattern
  (the vault uses its OWN tables, not `/api/data` — secrets must never ride Ajv-validated
  plaintext storage).
- `ARCHIVE/tauri-plugin-passkey` — already-working native macOS passkey plugin (macOS 15+)
  exposing `register_passkey` / `login_passkey` with `salt → prf_output`. Verified: the
  Swift bridge uses `ASAuthorizationPublicKeyCredentialPRF{Registration,Assertion}Input`
  (real PRF). Kept as the Route-B fallback for the ceremony in the webview.

### Better Auth findings (researched)

- Passkey plugin: `passkey` table, `userId` FK → **multiple passkeys per user**;
  `authClient.passkey.addPasskey({ name, extensions })` registers + **links to the
  signed-in user** (account-linking alongside Google); `authClient.signIn.passkey(...)`.
- It can request the **PRF extension** via `extensions` and return
  `webauthn.clientExtensionResults` when `returnWebAuthnResponse: true` — so PRF output is
  reachable through the Better Auth client **if** the ceremony runs in a WebAuthn-capable
  context.
- The plugin drives the ceremony via browser `navigator.credentials` and exposes **no
  documented path to verify an externally-performed native ceremony**. Hence the Route
  A/B fork below.

### Decisions confirmed during discovery

- **Unlock = passkey PRF, envelope-encrypted, master-key vault.** PRF output → HKDF-SHA256
  → **KEK**; a random per-user **master DEK** is KEK-wrapped (stored on the `vault` row);
  every `secrets` row is AES-256-GCM-encrypted under the master DEK. One unlock opens all
  secrets. Envelope (not encrypt-direct) follows the recommended PRF-for-encryption
  mitigation and enables future multi-passkey/rotation without re-encrypting secrets. The
  usual "lose the credential → lose the data" risk is bounded here: secrets are
  re-pasteable, and a synced platform passkey (iCloud Keychain) yields a stable PRF across
  the user's devices.
- **Passkey reuse:** linked alongside Google via the **Better Auth passkey plugin** (the
  credential record + tier 2FA gate). Ceremony route decided by a spike (Step 1):
  **Route A** = Better Auth passkey client end-to-end (if WKWebView supports
  `navigator.credentials` + PRF on macOS 15); **Route B** = native `tauri-plugin-passkey`
  for the ceremony + PRF, reconciled with Better Auth's `passkey` record.
- **Schema = dedicated `vault` + `secrets` tables** (NOT `/api/data`). One vault per user,
  many secrets per vault. Server-blind by construction.
- **Tier gate:** the Fly/vault feature (UI + `/api/vault/*` endpoints) is restricted to
  avenFOUNDER→avenCEO, which require a verified linked passkey.
- **Platform = macOS desktop only for v1** (the native fallback is macOS 15+); iOS /
  multi-device passkey is a follow-on. **Fly calls run device-side, read-only.**

## Goal

A passkey linked alongside Google (and required as the avenFOUNDER→avenCEO 2nd factor)
unlocks a per-user E2EE vault; a mainnet Fly view stores the user's Fly token in that vault
(server sees only ciphertext) and lists their Fly orgs, apps, and machines read-only.

**Completion condition** (identical to frontmatter `goal`):

> The vault/Fly feature is gated to the avenFOUNDER→avenCEO tiers and unlocked by a passkey
> linked alongside Google in Better Auth (the same passkey is the required 2nd factor for
> those tiers). The Fly API token is stored E2EE in dedicated betterauth `vault` (one per
> user; holds the passkey-PRF-wrapped master key) + `secrets` (many per vault) tables: a
> random master DEK is wrapped under the passkey's PRF-derived KEK (WebAuthn PRF — Better
> Auth client if WKWebView supports it, else the vendored native tauri-plugin-passkey), and
> each secret is AES-256-GCM under the master DEK, so the server never holds the token, the
> master key, or the PRF output. Proof: the Better Auth `passkey` + `vault` + `secrets`
> migrations are applied to Neon (Neon MCP SELECT); a crypto round-trip test passes AND
> asserts the serialized vault+secrets rows contain no plaintext-token / no
> plaintext-master-key substring; the Fly client issues ONLY read-only requests (GraphQL
> `organizations`; GET `/v1/apps?org_slug`; GET `/v1/apps/{app}/machines`) proven by a
> mocked-fetch test recording zero writes; the vault endpoints return 401 unauthenticated
> and a tier-gate unit test rejects sub-tier users; `bun --cwd libs/betterauth run check` +
> app svelte-check + biome are clean and the app Tauri crate builds (`cargo build` exits 0).
> HITL (macOS Tauri): Google sign-in → link a passkey → paste a token → orgs/apps/machines
> render → reload PRF-unlocks without re-entry → Neon vault/secrets rows hold only ciphertext.

- **End state:** tier-gated, passkey-unlocked E2EE vault; Fly view lists orgs/apps/machines.
- **Proof:** the migration SELECTs, the crypto + no-plaintext tests, the read-only-client
  test, the 401 + tier-gate tests, green checks/build, and the HITL round-trip.
- **Constraints:** server never sees plaintext/master-key/PRF (asserted by tests); Fly
  requests read-only only (asserted); vault uses its own tables (no `/api/data`).

## Approach

**Schema (Kysely migration in `libs/betterauth`):**

```
vault                                   -- one per user; the container + its passkey unlock
  id            uuid pk
  user_id       → "user"(id)  UNIQUE     -- one vault per user
  credential_id text                     -- the passkey (Better Auth passkey.credentialID) that unlocks it
  prf_salt      text                     -- base64; salt fed to PRF to re-derive the KEK
  wrapped_master_key text                -- base64; master DEK AES-GCM-wrapped under the PRF→HKDF KEK
  wrap_nonce    text
  alg           text                     -- 'AES-256-GCM'
  created_at / updated_at  timestamptz

secrets                                 -- many per vault; the encrypted credentials
  id            uuid pk
  vault_id      → vault(id) ON DELETE CASCADE
  user_id       → "user"(id)             -- denormalized for scoping
  kind          text                     -- 'fly_token'
  label         text null
  ciphertext    text                     -- base64; secret AES-256-GCM-encrypted under the master DEK
  nonce         text
  alg           text
  created_at / updated_at  timestamptz
  unique (vault_id, kind)                -- one fly_token per vault (upsert by kind)
```

Server-blind invariant: the server only ever holds `wrapped_master_key`, `ciphertext`,
salts, nonces — never the token, master DEK, KEK, or PRF output.

**Auth/passkey:** add the Better Auth `passkey()` plugin + `passkeyClient()`; gate the Fly
view + `/api/vault/*` to avenFOUNDER→avenCEO (reuse [[0052-roles-tiers-admin-credits]]).
Ceremony per the Step-1 spike (Route A Better Auth client, or Route B native plugin →
reconcile credential with the `passkey` table).

**Crypto (client, WebCrypto) — `app/src/lib/vault/crypto.ts`:** `deriveKek(prfOutput)`
(HKDF-SHA256); `wrapMasterKey/unwrapMasterKey` (AES-GCM); `sealSecret/openSecret`
(AES-GCM under the master DEK). The serialized rows carry no plaintext or key material.

**Vault API — `libs/betterauth` `/api/vault/*` (session-gated + tier-gated):**
`GET /api/vault` (vault + its unlock wrap), `POST /api/vault` (create vault / set unlock
wrap), `GET/POST /api/vault/secrets`, `PATCH/DELETE /api/vault/secrets/:id`. Per-user.

**Fly client (read-only) — `app/src/lib/fly/client.ts` + Rust `fly_fetch`:** `listOrgs()`
(GraphQL `organizations`), `listApps(orgSlug)` (GET `/v1/apps?org_slug`),
`listMachines(app)` (GET `/v1/apps/{app}/machines`), all via a Tauri reqwest command
(`Authorization: Bearer <decrypted token>`) to dodge webview CORS. No write endpoints.

**UI — `app/src/lib/mainnet/FlyView.svelte` + `MainnetShell` nav:** **Fly** entry (visible
only to gated tiers); connect/edit token + passkey lock/unlock + read-only orgs→apps→
machines lists; brand-styled; i18n `mainnet.fly.*`.

**Out of scope / trade-offs:** single unlocking passkey on the vault row for v1
(multi-passkey-unlock = a per-passkey wrap subtable, follow-on); crypto in the webview via
WebCrypto (all-native crypto = hardening follow-on); macOS only; read-only Fly (no
deploy/scale/destroy); no auto-refresh. Accepted: the passkey does double duty
(auth + encryption) — mitigated by envelope + re-pasteable secrets + future multi-passkey.

## Steps

1. **Spike (Route A vs B):** in the macOS Tauri webview, test `navigator.credentials`
   create/get with `extensions.prf`. Works → Route A (Better Auth client). Fails → Route B
   (native `tauri-plugin-passkey`, un-archived + wired). Record the result in the log.
2. **Better Auth passkey + tier gate:** add `passkey()` + `passkeyClient()`; migrate the
   `passkey` table to Neon; gate `/api/vault/*` + the Fly view to avenFOUNDER→avenCEO with
   a unit-tested tier check.
3. **Crypto lib + tests** — `vault/crypto.ts` (HKDF KEK, wrap/unwrap master key, seal/open
   secret) + a round-trip test asserting the serialized vault+secrets rows contain no
   plaintext-token and no plaintext-master-key substring. *(Pure TS — verify first.)*
4. **Vault schema + endpoints** — `vault` + `secrets` migration; `/api/vault/*` session +
   tier gated; per-user. **Checkpoint: stop here** (secure store proven) before Fly.
5. **Connect/unlock flow** — register/link the passkey (Route A/B) → derive KEK → create
   vault + wrap master key → seal the Fly token as a secret; unlock = PRF → open.
6. **Fly read-only client** — `fly_fetch` Rust command + `client.ts`; mocked-fetch test
   asserting the three read-only shapes and zero writes.
7. **Fly view + nav** — `FlyView.svelte`, gated nav entry, i18n; then green checks + HITL.

## Files to touch

- `libs/betterauth/src/auth.ts` — add `passkey()` plugin; tier-gate config.
- `libs/betterauth/src/migrations/*` — `vault` + `secrets` tables (+ Better Auth `passkey`).
- `libs/betterauth/src/vault.ts` — NEW: session+tier-gated `/api/vault/*` endpoints.
- `app/src/lib/auth/auth-client.ts` — add `passkeyClient()`; link/register helpers.
- `app/src/lib/vault/crypto.ts` — NEW: WebCrypto HKDF KEK + envelope wrap/seal.
- `app/src/lib/vault/client.ts` — NEW: `/api/vault/*` client (vault + secrets).
- `app/src/lib/fly/client.ts` — NEW: read-only Fly API client.
- `app/src/lib/mainnet/FlyView.svelte` + `MainnetShell` — NEW gated Fly view + nav entry.
- app Tauri crate (`lib.rs`/builder + capabilities) — `fly_fetch` reqwest command; (Route B)
  un-archive + register `tauri-plugin-passkey`.
- `app/languages/{en,de}.json` — `mainnet.fly.*`.
- `app/src/lib/{vault,fly}/*.test.ts` — crypto round-trip + read-only-client tests.

## Acceptance criteria

- [ ] **Migrations applied** — Better Auth `passkey` + `vault` + `secrets` exist in Neon
      (Neon MCP `SELECT`).
- [ ] **E2EE round-trip** — a test seals then opens a secret under a master DEK wrapped by a
      mock PRF, recovering the original — crypto test exits 0.
- [ ] **Server-blind invariant** — the same test asserts the serialized `vault` + `secrets`
      rows contain **no plaintext-token** and **no plaintext-master-key** substring.
- [ ] **Read-only Fly client** — a mocked-fetch test shows exactly the three request shapes
      and records **zero** write/mutation calls.
- [ ] **Auth + tier gate** — `/api/vault/*` returns **401** unauthenticated (curl) and a
      unit test rejects a sub-tier (below avenFOUNDER) session with **403**.
- [ ] **Passkey linked alongside Google** — the chosen route registers a passkey on the
      signed-in user (Better Auth `passkey` row with the Google user's `userId`).
- [ ] **Builds/checks green** — betterauth check, app svelte-check, biome all 0; app Tauri
      crate `cargo build` exits 0.
- [ ] **HITL (macOS Tauri):** Google sign-in → link passkey → paste token → orgs/apps/
      machines render; reload → PRF-unlock **without** re-entering the token; Neon
      `vault`/`secrets` rows hold only ciphertext.

## Verification

```bash
bun --cwd libs/betterauth run check
(cd app && bun --bun x svelte-check --tsconfig ./tsconfig.json)
(cd app && bun test src/lib/vault src/lib/fly)   # crypto round-trip + no-plaintext + read-only client + tier gate
bun run dev:app:mac                               # app Tauri crate builds → Finished, exit 0
curl -s -o /dev/null -w '%{http_code}' http://localhost:8787/api/vault   # 401
# live (HITL, macOS): mainnet → Google sign-in → link passkey → Fly → paste token →
#   orgs/apps/machines; reload → PRF unlock (no re-paste). Neon MCP:
#   SELECT user_id, credential_id FROM vault;  SELECT kind, ciphertext FROM secrets;
#   → confirm only ciphertext / wrapped keys, no plaintext token or master key.
```

## Hand-off

```
/aven-build 0055
```

…or hand the condition straight to the goal loop:

```
/goal <paste the Completion condition above>
```

## Out of scope (follow-on cards → ideate)

- Multi-passkey unlock (a per-passkey wrap subtable) + recovery codes + key rotation UI.
- iOS / multi-device passkey ceremony; cross-device vault open.
- All-native crypto (HKDF/unwrap/decrypt + Fly fetch in Rust so plaintext never enters JS).
- Any **write** Fly actions (deploy, scale, restart, destroy) — read-only for v1.
- Additional vault secrets beyond the Fly token; a generic secrets UI.

## Progress log

Newest entry first.

- `2026-06-20` — Re-spec after user input: the unlock passkey is **linked alongside Google
  via the Better Auth passkey plugin** and doubles as the **avenFOUNDER→avenCEO 2nd
  factor**; the vault/Fly feature is **tier-gated** to those tiers ([[0052-roles-tiers-admin-credits]]).
  Renamed the contents table **`keys`→`secrets`** with a **master-key vault** model (one
  vault → many secrets). Researched Better Auth passkey + account-linking: PRF reachable via
  the client, but no documented native-ceremony bridge → added a Route A/B **spike** (Step
  1) for WKWebView WebAuthn/PRF, with the vendored `tauri-plugin-passkey` as the proven
  fallback. Goal updated (migrations + crypto/no-plaintext + read-only-client + 401/403 tier
  gate + green build + HITL).
- `2026-06-20` — Switched storage from `/api/data` to dedicated **`vault` + `secrets`**
  tables (server-blind by construction; reusable for future secrets).
- `2026-06-20` — Discovery: settled BYO-token control-panel (Fly has no consumer OAuth);
  locked E2EE = passkey PRF + envelope encryption reusing the already-working
  `ARCHIVE/tauri-plugin-passkey` (verified real PRF in the Swift bridge); v1 = macOS-only,
  read-only, device-side Fly calls. Created directly in `discover/` (net-new).

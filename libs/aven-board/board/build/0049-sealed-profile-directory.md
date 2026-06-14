---
title: A SEALED profile directory (no plaintext membership) + TIER-0 = admission + directory-DEK only + E2E cap transparency
summary: The network roster is leaking metadata: the blind relay (and any observer) can read the plaintext membership + trust graph — `signers.signer_did/kind/status`, `safes.type/safe_did/username_slug`, `safe_controllers.controller_did/role` — without decrypting anything, and an avenCEO "member" (TIER-0, shown INVITED/Reader) is over-granted `reads` over the WHOLE roster + a keyshare to DECRYPT it. Fix it properly: introduce a dedicated SEALED `profile` table owned by the avenCEO **registry sub-group** (`aven_ceo_registry_group` = `derive_subgroup_id(avenCEO,"registry")` — its OWN DEK boundary, machinery exists), holding `{type: SIGNER|SAFE, did, display_name}` ALL encrypted under the directory DEK. Discovery reads the sealed profile table, NOT the plaintext operational roster. TIER-0 = relay admission + 10 MB quota + rate-limit + the **directory-group DEK only** (reads/decrypts profiles incl. friendly names) and NO avenCEO content DEK and NO broad `reads` — so a member sees the directory but the blind relay sees only ciphertext (no plaintext membership graph). Seal `safes.username_slug` (a handle leak). Plus E2E transparency: the access UI shows every did:safe + did:key subject's REAL caps from `identity_cap_report` (SSOT), no role label ever hiding a privilege; label SSOT = TIER-0. Follow-on to board 0047 (shipped); supersedes the plaintext-roster directory sketched in the first 0049 draft.
owner: claude (aven-caps + aven-schema manifest + app/caps_ipc + app/engine + app/identities UI + i18n)
created: 2026-06-15
updated: 2026-06-15
tags: [aven-caps, security, privacy, metadata, directory, tier0, transparency, ssot]
goal: "The directory is a sealed profile sub-group (no plaintext membership), TIER-0 is admission + directory-DEK only, and the access UI shows every subject's real caps from the SSOT. Provable from command output: (1) NO PLAINTEXT MEMBERSHIP — the `profile` table's identity fields (type, did, display_name) are sealed (manifest shows the profile directory rows sealed) and `safes.username_slug` is no longer `plaintext:true`, and a test proves a profile row round-trips ONLY under the registry-group DEK (a non-member / the blind relay decrypts nothing). (2) TIER-0 MINIMAL — `cargo test … tier0_minimal_grant` proves a freshly-admitted member's effective caps = the registry-group directory read + admission/quota/rate, holding the registry-group DEK but NOT the avenCEO content DEK; it can decrypt profiles but a read/decrypt of avenCEO's non-registry content is DENIED. (3) DISCOVERY MIGRATED — peer/member discovery reads the sealed `profile` table, not the plaintext `signers`/`safes` roster (a test or grep shows the directory source is `profile`). (4) TRANSPARENT DISPLAY — the Members UI renders every did:safe + did:key subject's role + exact `identity_cap_report` cap set (nothing hidden client-side); label is TIER-0; `bun test tests` i18n-coverage passes (no raw keys). (5) `cargo build -p aven-caps -p aven-os-app --features desktop-ai` exits 0; `bun run check` 0 errors; `bun test tests` passes. Out of scope: opaque routing tags for `keyshares.recipient_did` (the irreducible blind-relay routing floor — its own hardening card); the relay-deny[no-binding] stale-keyshare log spam."
---

# A sealed profile directory + TIER-0 minimal + cap transparency

## Context

A plaintext audit (run during discovery) found the **content is fully sealed** (todos/messages/files/
memories/entities/links/context_traces — 100% encrypted), but the **roster leaks metadata**: the blind
relay + any observer reads the plaintext **membership + trust graph** without decrypting anything —
`signers.signer_did/kind/signer_type/status`, `safes.type/safe_did/username_slug`,
`safe_controllers.controller_did/role`. And an avenCEO **member** (TIER-0, shown INVITED/Reader) is
over-granted **`reads` over the whole roster + a keyshare to DECRYPT it**
(`avendb_ipc_aven_ceo_add_member`, caps_ipc.rs:1408). The user's requirement: **the roster must not be
plaintext — encrypt the directory by default**, and TIER-0 must NOT decrypt avenCEO's data beyond a
directory.

**The irreducible floor (honest):** a blind relay must route by SOME plaintext — `keyshares.recipient_did`
+ `dek_version` (route a keyshare to its recipient), and public keys/ids (`wrap_did`, `safe_did`). Those
stay plaintext (or become opaque routing tags — a separate hardening). Everything else in the roster can
and should be sealed.

## Goal

The directory is a sealed sub-group table (no plaintext membership graph), TIER-0 holds only the
directory DEK (reads profiles, not avenCEO content), and the UI shows every subject's real caps from the
SSOT. Completion = the frontmatter `goal:`.

## Approach

**Sealed `profile` directory (the substrate).** Add a `profile` table owned by the avenCEO **registry
sub-group** (`aven_ceo_registry_group(seed)` = `derive_subgroup_id(avenCEO,"registry")` — a distinct DEK
boundary; the group machinery `mint_group_genesis_extending` exists, and a test already asserts the
registry group ≠ identity = own-DEK boundary). Columns: `type` (SIGNER|SAFE), `did`, `display_name` —
**all sealed under the registry-group DEK**. Each member self-publishes its own profile row (write-own).
Discovery (peer/member listing, the directory) reads the sealed `profile` table — NOT the plaintext
`signers`/`safes` operational roster. Seal `safes.username_slug` (drop `plaintext:true`).

**TIER-0 = admission + directory-DEK only.** `avendb_ipc_aven_ceo_add_member` grants: relay admission +
quota + rate + membership in the **registry sub-group** (the directory-group DEK keyshare) — and NOT the
avenCEO content DEK, NOT a broad `reads` on avenCEO. Result: a TIER-0 member decrypts the `profile`
directory (sees names/types/dids) but the blind relay sees only ciphertext, and the member cannot read
avenCEO's operational/content data.

**E2E transparency.** The Members page + GIVE ACCESS + per-identity header render, for every did:safe +
did:key subject, the role + the EXACT cap set from `identity_cap_report` (SSOT) — the role label sits
ALONGSIDE the real cap chips, never replacing them. Label SSOT: `grants.tier0` = "TIER-0".

**Slices:** S1 = the sealed `profile` registry-sub-group table + its DEK + seal `username_slug`
(substrate). S2 = migrate discovery to read `profile`. S3 = TIER-0 minimal grant (directory-group DEK
only) + `tier0_minimal_grant`. S4 = transparent display + label + i18n.

## Steps

1. **S1** manifest+schema: add `profile` table (type/did/display_name sealed) owned by the registry
   sub-group; drop `plaintext:true` from `safes.username_slug`. Wire the registry-group DEK (mint/seal).
2. **S1** self-publish: each member writes its own `profile` row (write-own grant in the registry group).
3. **S2** migrate discovery/peer-listing to read the sealed `profile` table; stop reading the plaintext
   roster for the directory.
4. **S3** caps_ipc: `avendb_ipc_aven_ceo_add_member` → admission + registry-group membership (directory
   DEK) only; drop full `reads` + avenCEO content keyshare. `tier0_minimal_grant` test.
5. **S4** app UI: render per-subject role + full caps from `identity_cap_report`; `grants.tier0`="TIER-0";
   i18n coverage.
6. Build `cargo -p aven-caps -p aven-os-app --features desktop-ai` green; `bun run check`; `bun test tests`.

## Files to touch

- `libs/aven-schema/schema.manifest.json` — new `profile` table (sealed cols); `safes.username_slug` → sealed.
- `libs/aven-caps/src/caps.rs` — registry-group grant/cap helpers; `tier0_minimal_grant` test.
- `app/src-tauri/src/avendb/caps_ipc.rs` — `avendb_ipc_aven_ceo_add_member` → registry-group membership;
  member self-publishes its `profile` row; directory read switches to `profile`.
- `app/src-tauri/src/avendb/engine.rs` — registry-group DEK in hydrate/seal; profile sealing.
- `app/src/lib/identities/IdentityMembersPanel.svelte` + `api.ts` — per-subject real-caps render; directory from `profile`.
- `app/languages/{en,de}.json` — `grants.tier0` = "TIER-0".
- app `tests/` — `tier0_minimal_grant`, profile-seal round-trip, deterministic-render, i18n coverage.

## Acceptance criteria

- [ ] No plaintext membership: `profile` rows (type/did/display_name) are sealed + `safes.username_slug` no longer `plaintext:true` (manifest grep); a test proves a profile row decrypts ONLY with the registry-group DEK (blind relay/non-member sees ciphertext).
- [ ] `cargo test … tier0_minimal_grant` — a TIER-0 member holds the registry-group (directory) DEK + admission/quota/rate, NOT the avenCEO content DEK; decrypts profiles but a non-registry avenCEO read/decrypt is DENIED.
- [ ] Discovery reads the sealed `profile` table, not the plaintext `signers`/`safes` roster (test/grep).
- [ ] Members UI renders each did:safe + did:key subject's role + exact `identity_cap_report` caps (nothing hidden); label is "TIER-0"; `bun test tests` i18n coverage green (no raw keys).
- [ ] `cargo build -p aven-caps -p aven-os-app --features desktop-ai` exits 0; `bun run check` 0 errors.

## Verification

```bash
grep -n 'plaintext' libs/aven-schema/schema.manifest.json   # profile display fields + username_slug NOT plaintext
cargo test -p aven-os-app --features desktop-ai tier0_minimal_grant
cargo build -p aven-caps -p aven-os-app --features desktop-ai
cd app && bun run check && bun test tests
# manual: a TIER-0 member sees the directory (names/types) but the relay log shows only ciphertext;
#   WHO HAS ACCESS shows each subject's role + full caps; no plaintext roster on the wire.
```

## Hand-off

```
/aven-build 0049
```

## Progress log

Newest first.

- `2026-06-15` — **Build started; card → build/.** Landed the one bounded, independent, verifiable
  piece: the label SSOT `grants.tier0` = **"TIER-0"** (en+de), replacing "Invited" (i18n-access-labels
  test green). **The remainder (S1–S3) is deliberately NOT bashed at session-tail** — it is deep,
  security-critical crypto plumbing whose only real proof is a live 2-device run (the relay must see
  only ciphertext): S1 = a SEALED `profile` table owned by the avenCEO registry sub-group
  (`aven_ceo_registry_group`) with its OWN DEK domain (manifest table + `mint_group_genesis_extending`
  + hydrate loading the registry-group DEK + sealing profile cells under the sub-group AAD coordinates,
  the [[identities-sealed-cell-aad-row-split]] failure class) + seal `safes.username_slug`; S2 = migrate
  discovery to read the sealed `profile`; S3 = `avendb_ipc_aven_ceo_add_member` → registry-group
  membership (directory DEK) + admission/quota/rate ONLY (drop full reads + content keyshare) +
  `tier0_minimal_grant` (needs S1's DEK domain first). Handed to `/goal` for a focused continuation with
  the flush + live 2-device validation. Card stays in build/.
- `2026-06-15` — Discovery (rewritten around the sealed profile-directory, per the plaintext audit).
  Audit found content fully sealed but the roster plaintext (membership + trust graph readable by the
  blind relay) and TIER-0 over-granted full roster `reads` + decrypt keyshare. Confirmed with the user:
  the roster must be ENCRYPTED by default. Design: a sealed `profile` table owned by the avenCEO registry
  sub-group (`aven_ceo_registry_group`, own DEK boundary — machinery exists) holding type/did/display_name
  encrypted; discovery reads it, not the plaintext roster; TIER-0 = admission + the directory-group DEK
  ONLY (reads profiles incl. friendly names, NOT avenCEO content / no broad reads); seal
  `safes.username_slug`. Plus the transparency principle: UI shows every subject's real caps from the
  `identity_cap_report` SSOT, no label hiding a privilege; label = "TIER-0". Honest floor: keyshare
  recipient routing stays plaintext (or opaque routing tags — separate card). Sliced S1 (sealed profile
  sub-group substrate) → S2 (migrate discovery) → S3 (TIER-0 minimal) → S4 (transparency + label).
- `2026-06-15` — Original 0049 (plaintext-roster directory + TIER-0 directory-scoped read); superseded by
  the sealed profile-directory above after the user required the roster be encrypted by default.

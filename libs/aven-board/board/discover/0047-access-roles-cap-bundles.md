---
title: One access vocabulary — roles are named cap bundles (ADMIN / READER / RELAY / TIER-0), i18n-resolved + fail-closed revoked device
summary: Consolidate the scattered access-control vocabulary into ONE concept — a **role is a named bundle of caps** — and resolve it consistently across Rust (the SSOT), the app TS types, and i18n so the UI never shows a raw key. Follow-on to board 0040 (in review), which renamed the cap role `owns`→`admin` at the wire but left a LIVE i18n regression: `identity_cap_report` now emits grant kind `admin`, but the TS `IdentityGrant = 'owns'|'reads'|'replicate'` + `GRANT_KINDS` + `grantDescKey` + the `identities.share.grants.*` translations still say `owns`, so `IdentityMembersPanel.svelte` renders the raw key `IDENTITIES.SHARE.GRANTS.ADMIN`. The unified model (confirmed with the user): every access holder has ONE role = a cap bundle — **ADMIN** (read/write/delete/admit/rotate_key, per-SAFE biscuit grant), **READER** (read; rename of MEMBER/`reads`), **RELAY** (`replicate` — blind store-and-forward, NO decrypt — + service policy caps: quota/10MB, rate_limit, directory; granted by me → a relay node), and **TIER-0** (the invited/welcome network-admission tier — "you may sync on this network at all" + its quota/limits; granted to me ← the avenCEO roster). Same vocabulary, two roots: ADMIN/READER/RELAY are per-SAFE biscuit grants, TIER-0 is the network-roster admission (the SYNC-vs-RELAY directionality, now expressed as roles). Plus the 0040 fail-closed-revoked-device follow-on: a revoked device that hydrates and finds its SAFE re-sealed beyond any DEK it holds (admin cap gone) must LOCK that identity out of the UI and PURGE its local cache (physics can't force-delete remotely — the revoked device must self-purge).
owner: claude (aven-caps + app/identities UI + i18n)
created: 2026-06-15
updated: 2026-06-15
tags: [aven-caps, caps, ux, i18n, security, revocation, ssot, consolidation]
goal: "The access vocabulary is ONE role→caps model surfaced with zero raw i18n keys, and a revoked device self-locks. Provable from command output: (1) ROLE→CAPS SSOT — `cargo test -p aven-caps role_caps` proves the single mapping returns the right bundle per role (admin → read/write/delete/admit/rotate_dek; reader → read; relay → replicate + policy; and the admission tier resolves), with no separate ad-hoc cap lists. (2) NO RAW KEYS — a test (`cargo test -p aven-os-app --features desktop-ai i18n_access_labels` or a `bun` i18n-coverage check) proves every role kind and cap key that `identity_cap_report` can emit has a non-identity translation in every locale (the rendered label != the upcased key), AND the TS `IdentityGrant` union + `GRANT_KINDS` + `grantDescKey` include the role names the report emits (admin/reader/relay + the tier) — so the live `IDENTITIES.SHARE.GRANTS.ADMIN` raw-key regression is gone. (3) REVOKED-DEVICE FAIL-CLOSED — `cargo test -p aven-os-app --features desktop-ai revoked_self_fail_closed` proves the hydrate-time decision: a held SAFE whose genesis is re-sealed beyond every DEK held AND whose admin cap is absent resolves to `RevokedSelf` → lock + local-purge (vs `Active` when a DEK/cap is held). (4) `cargo build -p aven-caps -p aven-os-app --features desktop-ai` exits 0 and `bun run check` passes. Out of scope: board 0040 (in review); renaming the wire predicates `reads`/`replicate` (kept — semantically fine; role names are a report/UI layer); future TIER-1+ product tiers."
---

# One access vocabulary — roles are named cap bundles

## Context

Surfaced live testing board [[owner-binding-ssot-0040]] (the SAFE delegation model, in review): the
"WHO HAS ACCESS" panel is confusing and a rename regression is live.

- **Live i18n regression (from 0040 S1c):** `identity_cap_report` now emits grant kind `admin`
  (renamed from `owns`), but the app still speaks `owns`: `IdentityGrant = 'owns'|'reads'|'replicate'`
  (`app/src/lib/avendb/api.ts`), `GRANT_KINDS`/`grantDescKey` (`IdentityMembersPanel.svelte`), and the
  `identities.share.grants.owns` translation. So `t('identities.share.grants.admin')` misses → the UI
  shows the **raw key `IDENTITIES.SHARE.GRANTS.ADMIN`**.
- **Smeared sync vocabulary:** the "Sync relay" card shows BOTH `SYNC` and `REPLICATE` caps (+ `10MB`,
  `RATE LIMIT`, `DIRECTORY`), and there's a separate "⚡ Sync on the connected aven" button — two
  different concepts wearing the word "sync".
- **Stale data on a revoked device:** a revoked device keeps its old rows (physics — can't force-delete
  remotely) and still renders the identity; it never self-locks.

**The unified model (confirmed with the user): a role IS a named bundle of caps** — structurally what
`grant_kind_caps(role) → [caps]` already is. Collapse everything to ONE `role → caps` SSOT:

| Role | Cap bundle | Root |
| --- | --- | --- |
| **ADMIN** | read, write, delete, admit, rotate_key | per-SAFE biscuit grant (the value-owner SAFE administers it) |
| **READER** (was MEMBER/`reads`) | read | per-SAFE biscuit grant |
| **RELAY** (`replicate`) | maySync/replicate — **blind, NO decrypt** — + service policy (quota/10MB, rate_limit, directory) | granted **by me → a relay node** |
| **TIER-0** | the invited/welcome admission tier — "may sync on this network at all" + its quota/limits | granted **to me ← the avenCEO roster** |

Same vocabulary, **two roots** — ADMIN/READER/RELAY are per-SAFE biscuit grants; TIER-0 is the
network-roster admission (this is the SYNC-vs-RELAY direction split, now expressed as roles). "owner"
stays reserved for the SAFE a value belongs to (board 0040); a subject's role OVER a SAFE is one of
these. The UI presents roles uniformly; each role expands to its caps (the H2 transparency already in
`IdentityMembersPanel`).

## Goal

One `role → caps` vocabulary, resolved with zero raw i18n keys across Rust/TS/UI, and a revoked device
self-locks + purges. Completion = the frontmatter `goal:`.

**Completion condition** (identical to the frontmatter `goal:`).

## Approach

**One SSOT.** Extend the existing `grant_kind_caps` into the canonical `role → caps` map in aven-caps
(the only place cap bundles are defined). `identity_cap_report` returns role names (`admin`/`reader`/
`relay`; the admission tier surfaced from `avenCeoMembership`). The app's `IdentityGrant` union +
`GRANT_KINDS` + `grantDescKey` mirror those names; i18n gains `grants.{admin,reader,relay,tier0}` +
`capabilities.*` + `capDesc.*` so nothing renders a raw key.

**Keep the wire predicates.** `reads`/`replicate` stay as biscuit predicates (semantically fine — the
role NAME is a report/UI layer; only `owns`→`admin` needed a wire rename, done in 0040). No new
genesis-format change, no flush.

**TIER-0 = admission, surfaced as a role.** Map `avenCeoMembership` (`owner`|`member`|`none`) to the
admission tier role; present it distinctly from the per-SAFE RELAY grant (different root) — kill the
"two sync words" smear (the relay card shows RELAY + its policy caps; network admission shows TIER-0).

**Fail-closed revoked device.** A pure hydrate-time decision: for each held SAFE, if its genesis is
re-sealed beyond every DEK held AND no admin cap remains for this device → `RevokedSelf` → the app
locks that identity and purges its local cache. (Physics: we can't delete bytes on a device we no
longer control — the revoked device must self-purge.)

**Slices (agile; land in order):**
- **S1 — kill the raw-key regression:** propagate the report's role name to TS `IdentityGrant` +
  `GRANT_KINDS`/`grantDescKey` + add the missing `grants.admin` (and reader/relay) translations.
- **S2 — role→caps SSOT + names:** ADMIN/READER/RELAY as the canonical role→caps bundle; `role_caps`
  test; i18n coverage test (no raw keys).
- **S3 — TIER-0 admission role:** surface `avenCeoMembership` as the admission tier, distinct from
  RELAY; de-smear the UI.
- **S4 — fail-closed revoked device:** the `RevokedSelf` hydrate decision + lock/purge + test.

## Steps

1. **S1** app: `IdentityGrant` union + `GRANT_KINDS` + `grantDescKey` use the report's role names; add
   `identities.share.grants.{admin,reader,relay}` translations (every locale). Verify the panel shows
   labels, not raw keys.
2. **S2** aven-caps: the canonical `role → caps` map (extend `grant_kind_caps`); `identity_cap_report`
   labels via it; `role_caps` test. App i18n-coverage test/check proving no role/cap key renders raw.
3. **S3** app: map `avenCeoMembership` → the TIER-0 admission role; present it separately from RELAY in
   the access panel; the relay card shows RELAY + policy caps only.
4. **S4** app: `revoked_self` hydrate decision (genesis re-sealed beyond held DEKs + no admin cap →
   `RevokedSelf`) → lock identity + purge local cache; `revoked_self_fail_closed` test.
5. Build aven-caps + app(desktop-ai) green; `bun run check`; run the new tests.

## Files to touch

- `libs/aven-caps/src/caps.rs` — the canonical `role → caps` map (extend `grant_kind_caps`);
  `identity_cap_report` role labels; `role_caps` test.
- `app/src/lib/avendb/api.ts` — `IdentityGrant` union → the report's role names.
- `app/src/lib/identities/IdentityMembersPanel.svelte` — `GRANT_KINDS`, `grantDescKey`, role rendering;
  surface TIER-0 admission distinctly from RELAY.
- `app/src/lib/i18n/**` — `grants.{admin,reader,relay,tier0}`, `capabilities.*`, `capDesc.*` (every locale).
- `app/src-tauri/src/avendb/engine.rs` (hydrate) + the lock/purge path — the `RevokedSelf` decision.
- app `tests/` — `i18n_access_labels` (or a `bun` coverage check) + `revoked_self_fail_closed`.

## Acceptance criteria

Each box checkable from the transcript.

- [ ] `cargo test -p aven-caps role_caps` — one `role → caps` SSOT returns the right bundle per role (admin/reader/relay + tier); no ad-hoc cap lists.
- [ ] No raw keys: a test/check proves every role + cap key `identity_cap_report` can emit has a real translation (rendered label != upcased key) in every locale, AND the TS `IdentityGrant`/`GRANT_KINDS`/`grantDescKey` include the report's role names — the `IDENTITIES.SHARE.GRANTS.ADMIN` regression is gone.
- [ ] TIER-0 admission is surfaced as its own role (from `avenCeoMembership`), distinct from the per-SAFE RELAY grant — the "two sync words" smear is gone.
- [ ] `cargo test -p aven-os-app --features desktop-ai revoked_self_fail_closed` — a SAFE re-sealed beyond held DEKs + no admin cap → `RevokedSelf` (lock + purge); `Active` when a DEK/cap is held.
- [ ] `cargo build -p aven-caps -p aven-os-app --features desktop-ai` exits 0; `bun run check` passes.

## Verification

```bash
cargo test -p aven-caps role_caps
cargo test -p aven-os-app --features desktop-ai revoked_self_fail_closed
cargo test -p aven-os-app --features desktop-ai i18n_access_labels   # or the bun i18n-coverage check
cargo build -p aven-caps -p aven-os-app --features desktop-ai
bun run check
# manual: the WHO HAS ACCESS panel shows ADMIN/READER/RELAY/TIER-0 labels (no raw keys); a revoked device locks + purges.
```

## Hand-off

```
/aven-build 0047
```

…or hand the condition straight to the goal loop:

```
/goal <paste the Completion condition above>
```

## Progress log

Newest entry first.

- `2026-06-15` — Discovery. Born from live 0040 testing: a raw-key i18n regression
  (`IDENTITIES.SHARE.GRANTS.ADMIN`) + smeared sync vocabulary + a revoked device that never self-locks.
  User reframed the fix as the right model: **a role IS a named bundle of caps** (ADMIN / READER /
  RELAY / TIER-0), one `role → caps` SSOT in aven-caps surfaced consistently to TS + i18n with zero raw
  keys. Captured the two-roots nuance (per-SAFE grants vs network-roster admission = the SYNC-vs-RELAY
  direction, as roles), kept the wire predicates `reads`/`replicate` (no flush), and folded in the 0040
  fail-closed-revoked-device follow-on. Sliced S1 (kill the raw-key regression) → S2 (role→caps SSOT) →
  S3 (TIER-0 admission) → S4 (revoked-self lock/purge). Metric: `role_caps` + i18n-coverage +
  `revoked_self_fail_closed` tests + builds/`bun run check`.

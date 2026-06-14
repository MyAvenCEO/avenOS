---
title: E2E capability transparency — the UI shows every subject's REAL caps from the biscuit SSOT, and TIER-0 is re-scoped to admission + directory-only (no roster decrypt)
summary: Two coupled fixes, one overhaul. (1) SECURITY — an avenCEO "member" (shown as INVITED / labeled Reader) is today granted `reads` over the WHOLE avenCEO roster + write-own-row + a keyshare to DECRYPT it (`avendb_ipc_aven_ceo_add_member`, caps_ipc.rs:1408) — so a network member can read+decrypt the entire directory's sealed contents. That is over-granting and the label HID it. Re-scope TIER-0 (avenCEO membership) to the MINIMAL grant: relay admission + per-identity 10 MB quota + rate-limit + a DIRECTORY-only read (a table-scoped biscuit `read` on `safe:<avenCEO>:safes:` + `:signers:` ONLY, enforced by the authorizer `resource.starts_with(prefix)` rule) and NO avenCEO content DEK/keyshare — so a member sees the plaintext roster routing (who's on the network) but DECRYPTS NOTHING sealed and can read no other avenCEO data. No-DEK ⇒ no-leak. (2) TRANSPARENCY (UX) — the Members page + GIVE ACCESS section + per-identity header must show, for EVERY subject (did:safe AND did:key), their actual role(s) + caps derived DETERMINISTICALLY from `identity_cap_report` (the biscuit SSOT), complete + honest, where NO role label ever conceals a real privilege; frontend label SSOT shows TIER-0 (not "Invited"). Follow-on to board 0047 (shipped).
owner: claude (aven-caps + app/caps_ipc + app/identities UI + i18n)
created: 2026-06-15
updated: 2026-06-15
tags: [aven-caps, security, caps, transparency, ux, tier0, ssot]
goal: "TIER-0 is admission + directory-only (no avenCEO roster decrypt, no broad read), and the access UI shows every subject's real caps from the biscuit SSOT with no label hiding a privilege. Provable from command output: (1) MINIMAL GRANT — `cargo test -p aven-os-app --features desktop-ai tier0_minimal_grant` (or a caps-level test) proves a freshly-admitted avenCEO member's effective caps from `identity_cap_report` are EXACTLY {a table-scoped read on `safe:<avenCEO>:safes:` + `:signers:`} (+ the network admission/quota/rate the relay enforces) and DO NOT include a broad `read` over avenCEO nor an avenCEO content keyshare/DEK — i.e. the member can read the roster routing but decrypt nothing sealed; a paired test proves a read of a non-registry avenCEO resource is DENIED by `authorize`. (2) TRANSPARENT DISPLAY — a store/UI-level test proves the Members listing renders, for every did:safe + did:key subject, its role + the exact cap set returned by `identity_cap_report` (no caps synthesized or hidden client-side), and `bun test tests` includes an i18n-coverage assertion that the label is `TIER-0` (not Invited) and every role/cap key the report can emit has a real translation (no raw keys). (3) `cargo build -p aven-caps -p aven-os-app --features desktop-ai` exits 0; `bun run check` (app svelte-check) 0 errors; `bun test tests` passes. Out of scope: the relay-deny[no-binding] stale-keyshare log spam (separate — pre-binding stale rows, a flush clears them; a DenyPermanent-caching hardening is its own follow-on); a directory-only encryption domain for sealed display names (TIER-0 sees dids/kinds, not friendly names — acceptable)."
---

# E2E capability transparency + TIER-0 minimal grant

## Context

Found live testing the 0040/0047 access model. The "WHO HAS ACCESS" panel labels an avenCEO network
member **INVITED** (and on a normal SAFE the grant pill says **Reader**), but
`avendb_ipc_aven_ceo_add_member` ([caps_ipc.rs:1408](app/src-tauri/src/avendb/caps_ipc.rs)) actually
grants the member **`reads` over the WHOLE avenCEO roster + write-own-row + a keyshare to DECRYPT it**
(1402-1406). So a TIER-0 member can read **and decrypt** the entire network directory — and the label
**hid** that privilege. The user's explicit objection: *a TIER-0/Reader must NOT read avenCEO's SAFE
data*; TIER-0 should be "may-sync + 10 MB + rate-limit" + at most see the directory.

Two coupled problems, fixed as one overhaul:

1. **TIER-0 over-grants (security).** Re-scope it to the minimal set.
2. **The UI hides real caps (transparency).** A role label must never conceal a privilege; the display
   must be the biscuit-derived truth for every subject.

**Vocabulary (board 0047, stable):** wire predicates `owns`/`reads`/`replicate` are NEVER renamed for a
label change; role LABELS = ADMIN / READER / RELAY (per-SAFE grants you make to a subject) + TIER-0
(network admission the avenCEO admin grants you). `reads`-on-avenCEO is the TIER-0 admission (dual
label). SSOT for caps = aven-caps `grant_kind_caps` + `identity_cap_report`.

### Directory — defined securely (the crux of "doesn't leak any other data")

**Directory = a biscuit table-scoped `read` grant on EXACTLY `safe:<avenCEO>:safes:` +
`safe:<avenCEO>:signers:`** (the roster/registry tables), enforced by the authorizer rule
`allow if … resource($r), right($op,$prefix), $r.starts_with($prefix)` — so a read of ANY other table
or row in avenCEO is DENIED. **TIER-0 holds NO avenCEO content DEK / keyshare**, so it can **decrypt
nothing sealed** — it sees only the PLAINTEXT routing fields of the roster (`signer_did`, `kind`,
`status`: who is on the network). **No DEK ⇒ no leak** of any sealed avenCEO data — that is the hard
guarantee, independent of the read-scope. This is exactly the existing **blind-relay `directory`**
mechanism (`caps_ipc.rs:661,691-713` — "member of the directory … stays BLIND to user-data, holds no
DEK"). So the fix is: `avenCeoAddMember` uses the directory-scoped grant, not full `reads` + keyshare.
(Sealed display names `account_name`/`device_label` are therefore invisible to TIER-0 — acceptable; a
directory-only encryption domain for friendly names is a separate follow-on.)

## Goal

TIER-0 is admission + directory-only (no roster decrypt, no broad read), and the access UI shows every
subject's real caps from the biscuit SSOT with no label hiding a privilege. Completion = frontmatter
`goal:`.

## Approach

**Keystone — TIER-0 minimal grant (security).** In `avendb_ipc_aven_ceo_add_member`, replace the full
`reads` (whole roster) + avenCEO DEK keyshare with the **directory-scoped read** (table-scoped `read`
on `…:safes:` + `…:signers:`) and **no content keyshare** — reusing the existing blind-relay directory
path. Keep: the roster `signers` row (status active) + the relay admission + quota/rate. Result: a
TIER-0 member syncs + sees the plaintext roster routing, decrypts nothing sealed, reads no other
avenCEO data. `authorize` already enforces the prefix scope; verify a non-registry read is denied.

**Second slice — transparent display (UX).** The Members page + GIVE ACCESS + per-identity header
render, for EVERY subject (did:safe + did:key), the role + the EXACT cap set from `identity_cap_report`
(SSOT) — nothing synthesized or hidden client-side; the role label is a *summary* shown ALONGSIDE the
full cap chips, never instead of them (so "TIER-0" sits next to its real caps: directory-read, quota,
rate). Label SSOT: `grants.tier0` = "TIER-0" (not "Invited"). The cap chips already derive from the
report; close the gap where the role label can summarize-away a cap.

**Slices:** S1 = TIER-0 minimal grant + `tier0_minimal_grant` test (keystone, security). S2 =
transparent per-subject roles+caps display + the TIER-0 label + i18n coverage.

## Steps

1. **S1** caps_ipc: `avendb_ipc_aven_ceo_add_member` grants directory-scoped read (`:safes:`+`:signers:`)
   + admission/quota/rate; drop the full `reads` + avenCEO content keyshare. Reuse the blind-relay
   directory grant helper.
2. **S1** test: `tier0_minimal_grant` — a member's `identity_cap_report` caps = directory read only (no
   broad `read`, no content DEK); `authorize` denies a non-registry avenCEO read.
3. **S2** app: Members/GIVE ACCESS/header render each subject's role + full caps from
   `identity_cap_report`; role label never replaces the cap chips. `grants.tier0` = "TIER-0".
4. **S2** test: store/UI-level deterministic-render test + `bun test` i18n coverage (label = TIER-0, no
   raw keys, every emitted role/cap has a translation).
5. Build `cargo -p aven-caps -p aven-os-app --features desktop-ai` green; `bun run check`; `bun test tests`.

## Files to touch

- `app/src-tauri/src/avendb/caps_ipc.rs` — `avendb_ipc_aven_ceo_add_member` → directory-scoped grant
  (reuse the blind-relay directory path at ~691-713); drop full reads + content keyshare.
- `libs/aven-caps/src/caps.rs` — (if needed) a `grant_kind_caps`/report mapping so a directory-scoped
  member reports as TIER-0 with the directory cap; the `tier0_minimal_grant` test.
- `app/src/lib/identities/IdentityMembersPanel.svelte` — render role + full caps per subject from the
  report; ensure the label never hides a cap.
- `app/src/lib/avendb/api.ts` — types if the report surface changes.
- `app/languages/{en,de}.json` — `grants.tier0` = "TIER-0".
- app `tests/` — `tier0_minimal_grant` (or caps-level) + the deterministic-render + i18n-coverage tests.

## Acceptance criteria

- [ ] `cargo test … tier0_minimal_grant` — a freshly-admitted avenCEO member's `identity_cap_report`
  caps are EXACTLY the directory-scoped read on `:safes:`+`:signers:` (+ admission/quota/rate), with NO
  broad `read` over avenCEO and NO avenCEO content keyshare/DEK; `authorize` DENIES a non-registry read.
- [ ] Transparent display: a store/UI test proves the Members listing renders every did:safe + did:key
  subject's role + the exact `identity_cap_report` cap set (nothing hidden/synthesized client-side).
- [ ] `bun test tests` i18n coverage: the label is `TIER-0` (not Invited) and every role/cap key the
  report can emit has a real translation (no raw keys).
- [ ] `cargo build -p aven-caps -p aven-os-app --features desktop-ai` exits 0; `bun run check` 0 errors.

## Verification

```bash
cargo test -p aven-os-app --features desktop-ai tier0_minimal_grant   # or the caps-level test
cargo build -p aven-caps -p aven-os-app --features desktop-ai
cd app && bun run check && bun test tests
# manual: WHO HAS ACCESS shows each subject's role + full caps; a TIER-0 member shows
#   "TIER-0" + a directory-read cap only (no broad read), and cannot decrypt the roster's sealed fields.
```

## Hand-off

```
/aven-build 0049
```

## Progress log

Newest first.

- `2026-06-15` — Discovery. Found a real confidentiality hole: avenCEO membership (TIER-0, shown as
  INVITED/Reader) actually grants `reads` over the whole roster + a keyshare to decrypt it — the label
  hid the privilege. Confirmed with the user: TIER-0 must be admission + 10 MB quota + rate-limit + a
  DIRECTORY-only read, and must NOT decrypt the roster or read any other avenCEO data. Defined directory
  securely = a table-scoped `read` on `:safes:`+`:signers:` ONLY + NO content DEK (no-DEK ⇒ no-leak;
  sees plaintext routing, decrypts nothing) — the existing blind-relay directory mechanism. Coupled with
  the transparency principle: the access UI must show every subject's REAL caps from the
  `identity_cap_report` SSOT, no label ever hiding a privilege; label SSOT = "TIER-0". Sliced S1
  (minimal-grant security keystone) → S2 (transparent display + label). Made "done" provable via
  `tier0_minimal_grant` (caps exclude broad read + content DEK; non-registry read denied) + a
  deterministic-render test + i18n coverage + builds.

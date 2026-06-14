---
title: Cryptographically-enforced revocation — a monotonic authority epoch + forced re-hydrate
summary: Revocation of a per-SAFE / SAFE-in-SAFE delegation is not yet rollback-proof in untrusted P2P. The crypto primitives are sound (signed owner-binding + edit-sig verified at every hop incl blind relays; Ed25519 biscuit chain with did:safe: controller delegation enforced at members; DEK rotation for post-revoke confidentiality), but the genesis biscuit — the SAFE's authority document — is re-minted on revoke yet `ingest_genesis_opened` accepts ANY validly-signed genesis with no freshness guard, so a stale (pre-revoke, still-validly-signed) genesis can overwrite a newer one, and members keep authorizing against a stale in-memory vault until they happen to re-hydrate. Bind a monotonic authority epoch (= the SAFE's `dek_version`) as a signed fact in the genesis; reject ingesting/authorizing any epoch below a persisted per-SAFE high-water mark (unify with the existing DEK-downgrade defense) → post-sync rollback becomes UNREPRESENTABLE; and force a vault re-hydrate when a newer-epoch genesis for a held SAFE is applied → the new biscuit is enforced immediately, so a revoked device's writes are DenyPermanent at every legit member.
owner: claude (aven-caps + app/biscuit_resolver + app/engine hydrate)
created: 2026-06-14
updated: 2026-06-14
tags: [aven-caps, security, revocation, sync, p2p, biscuit, rollback]
goal: "Per-SAFE and SAFE-in-SAFE authority is rollback-proof under untrusted P2P via a monotonic epoch bound into the genesis, plus forced re-hydrate on a newer epoch. Provable from command output: (1) `cargo test -p aven-caps authority_epoch` passes new tests proving the epoch is a signed fact carried in the genesis (survives encode/decode), `ingest_genesis_opened` REJECTS a validly-signed genesis whose epoch < the per-SAFE high-water mark and ACCEPTS one >=, and `authorize`/`authorize_signed_edit` deny a cap rooted in a below-high-water (superseded) genesis; (2) `cargo test -p aven-os-app --features desktop-ai revocation_epoch` passes an in-process two-vault integration test: after a revoke bumps owner epoch v->v+1, a batch authored by the revoked signer is `DenyPermanent` at the legit member's `verify_on_apply`, AND a replayed pre-revoke (epoch v) genesis is rejected by ingest so it cannot re-instate the revoked member, AND applying the newer-epoch (v+1) genesis for a held SAFE triggers a vault re-hydrate so enforcement is immediate (no stale-authority window); (3) `cargo build -p aven-caps -p aven-os-app --features desktop-ai -p aven-node` exits 0 and the existing biscuit_resolver / owner_binder / apply-gate suites stay green (no regression to the 0037 binding enforcement). Out of scope (follow-on cards): controller-copy freshness, fail-closed revoked-device UX, multi-SAFE cascade hardening, and the live 2-device manual check (review's job)."
---

# Cryptographically-enforced revocation — a monotonic authority epoch + forced re-hydrate

## Context

Found live while testing board [[0037]] (owner-binding) onboarding: when device **MacB** is
removed as a signer/owner of a human SAFE (nested under the avenCEO SAFE via `did:safe:`
controller chaining), MacB keeps **stale access** — it still sees and writes into the human SAFE
and the avenCEO SAFE, the human SAFE shows "unnamed", and revocation does not reliably propagate.

The enforcement model was **verified in code** and the cryptographic *primitives* are sound:
- `verify_on_apply` (`app/src-tauri/src/biscuit_resolver.rs:144-248`) checks the **signed
  owner-binding** (authenticity, can't relabel/forge ownership) + the **edit-sig over the
  receiver-computed digest** (integrity, can't tamper) at **every hop, including untrusted blind
  relays** — no vault needed.
- Authorization is enforced **at members** via `authorize_signed_edit` walking the Ed25519
  **biscuit chain** (`owns($p, "safe:<uuid>")`), with SAFE-in-SAFE nesting expressed as a
  `did:safe:` controller fact (`mint_safe_genesis_with_controller`, `libs/aven-caps/src/caps.rs:307`).
  Blind relays correctly forward without authz (they can't read the data either).
- Post-revoke **confidentiality** is enforced by **DEK rotation** — the rotated DEK is never
  wrapped to the revoked peer (`caps_ipc.rs` rotate path), so it cannot decrypt v+1 ciphertext.
  (MacB's human SAFE showing "unnamed" is rotation *working*: MacB lost the key to read the
  re-sealed name.)

**The gap is not in the primitives — it is freshness/rollback on the genesis (the authority
document).** The genesis biscuit is re-minted on revoke (`rebuild_identity_biscuit_excluding` →
`mint_safe_genesis`, re-rooted, `caps.rs:516-540`), but:

1. **`ingest_genesis_opened` (`caps.rs:586-606`) inserts the biscuit UNCONDITIONALLY** — it
   verifies the signature but has **no monotonic/epoch guard**. The *old* genesis is *also*
   validly signed by the same SAFE root key, so signature validity cannot distinguish current
   from stale. Today, rollback safety leans on hydrate ordering ("primary safes row wins") +
   the write-gate + LWW — **not** on the genesis being intrinsically rollback-proof. A
   stale-but-valid genesis (or a stale `safe_controllers` copy) can overwrite a newer one.
2. **Revocation does not force re-hydrate** — the new biscuit syncs as a re-sealed `safes` row,
   but members keep authorizing against the **in-memory vault from last hydrate** until they
   happen to re-hydrate → the stale-authority window where a revoked device's writes are still
   accepted.

**Why biscuit-native epoch (not revocation-IDs or TTL):** biscuits are stateless offline tokens
with no inherent "newest". Revocation IDs need a *synced revocation list* (an online/shared-state
dependency — wrong for untrusted blind-relay P2P). TTL/expiry caveats need trusted clocks and
force re-issue churn without immediate revocation. A **monotonic authority epoch as a signed fact
+ a verifier-side high-water mark** is the offline-friendly equivalent of a revocation list:
instead of "is this token revoked?", the verifier asks "is this authority ≥ the freshest epoch
I have seen?".

**The honest boundary (TOFU):** a verifier with *no* high-water mark for a SAFE accepts whatever
epoch it first sees — trust-on-first-use, inherent to any anchor-less offline system. Mitigated by
convergence (LWW on the `safes` row picks the highest `dek_version`; an attacker can't forge a
higher one without the gated admin write) and by encryption (a device that can't get the current
DEK can't read anyway). The epoch guarantees **no rollback after first sync**; it does not invent
an online trust anchor and must not pretend to.

This is a security re-architecture of revocation resilience, distinct from board 0037 (whose owner-
column drop is **done and green on main**). First slice (this card): the **monotonic authority
epoch + forced re-hydrate** — the cryptographic keystone. Follow-on cards: controller-copy
freshness, fail-closed revoked-device UX, multi-SAFE cascade hardening.

## Goal

A revoked per-SAFE / SAFE-in-SAFE delegation cannot be rolled back or out-waited under untrusted
P2P: authority is gated by a signed monotonic epoch, and a newer epoch is enforced immediately.

**Completion condition** (identical to frontmatter `goal:`):

> Per-SAFE and SAFE-in-SAFE authority is rollback-proof under untrusted P2P via a monotonic epoch
> bound into the genesis, plus forced re-hydrate on a newer epoch — proven by:
> `cargo test -p aven-caps authority_epoch` (epoch is a signed genesis fact surviving round-trip;
> `ingest_genesis_opened` rejects epoch < high-water, accepts ≥; `authorize`/`authorize_signed_edit`
> deny a superseded-genesis cap); `cargo test -p aven-os-app --features desktop-ai revocation_epoch`
> (in-process two-vault test: post-revoke the revoked signer's batch is `DenyPermanent` at the legit
> member, a replayed pre-revoke genesis is rejected by ingest, and applying the newer-epoch genesis
> for a held SAFE forces a re-hydrate so enforcement is immediate); and
> `cargo build -p aven-caps -p aven-os-app --features desktop-ai -p aven-node` exits 0 with the
> existing biscuit_resolver / owner_binder / apply-gate suites green.

## Approach

**One unified counter — `dek_version` IS the authority epoch.** Every revoke already rotates the
DEK (v→v+1) and `current_dek_version` is already edit-sig-authenticated and downgrade-defended.
Don't invent a second counter (two counters = two rollback surfaces). The epoch = the
`dek_version` the genesis was minted at.

1. **Bind the epoch into the genesis as a signed fact.** `mint_safe_genesis` /
   `mint_safe_genesis_with_controller` add `authority_epoch(N)` (N = `dek_version` at mint). It is
   in the root-signed block → can't be stripped (breaks the sig) or forged higher (needs the root
   key, only the re-mint path wields it). Add a reader (`genesis_authority_epoch(&Biscuit) -> u64`).
2. **Persist a per-SAFE monotonic high-water mark, unified with the DEK-downgrade defense.** The
   shell already tracks `max dek_version` per identity (`identity_versions` / the downgrade
   defense in `engine.rs`). Treat that max as the authority high-water.
3. **`ingest_genesis_opened` rejects stale epochs.** Take the current high-water for `owner`;
   reject a genesis whose `authority_epoch < high_water` (rollback unrepresentable); on accept,
   bump the high-water to the genesis epoch. (Signature check stays.)
4. **`authorize` / `authorize_signed_edit` deny a superseded cap.** If the loaded/presented genesis
   for `owner` carries an epoch below the high-water, deny — a member can't be tricked into
   authorizing against stale authority even if a stale genesis slipped into the vault.
5. **Forced re-hydrate on a newer epoch.** When the app applies a `safes`-row update for a HELD
   SAFE whose epoch > the loaded vault's epoch, trigger a vault re-hydrate (or a targeted
   re-ingest of that SAFE's genesis) so the new biscuit is enforced on the very next `verify_on_apply`
   — no stale-authority window. Wire at the inbound-apply / change-notification path in the app.

**Trade-offs / out of scope (follow-on cards):** controller-copy (`safe_controllers`) freshness
guard; the revoked device fail-closing its own UI on detected loss-of-membership; multi-SAFE
cascade-rotation hardening (mandatory/idempotent); the live 2-device manual onboarding+revoke check
(review's job). This card is net-ADDITIVE (a security feature, not an elimination) — the 0037
net-subtractive rule does not apply.

## Steps

1. aven-caps: add `authority_epoch(N)` fact to `mint_safe_genesis` + `mint_safe_genesis_with_controller`;
   add `genesis_authority_epoch()` reader; thread the mint-time `dek_version` in. Unit-test the fact
   round-trips through encode/decode.
2. aven-caps: `ingest_genesis_opened(... , high_water: u64)` rejects `epoch < high_water`, returns the
   accepted epoch (so the caller can bump high-water). Unit-test reject-stale / accept-newer.
3. aven-caps: `authorize` / `authorize_signed_edit` deny when the effective genesis epoch for `owner`
   is below the high-water. Unit-test superseded-genesis denial.
4. app: feed the per-SAFE high-water (existing `identity_versions` max) into `ingest_genesis_opened`
   at hydrate; persist/bump it on accept.
5. app: forced re-hydrate — on applying a `safes` update for a held SAFE with a higher epoch than the
   loaded vault, re-ingest/re-hydrate that SAFE's genesis. Wire at the inbound-apply path.
6. app: the in-process two-vault `revocation_epoch` integration test (revoke → DenyPermanent at member,
   replayed pre-revoke genesis rejected, newer-epoch forces re-hydrate).
7. Build aven-caps + app(desktop-ai) + aven-node green; existing biscuit_resolver / owner_binder /
   apply-gate suites stay green; run the new tests.

## Files to touch

- `libs/aven-caps/src/caps.rs` — `mint_safe_genesis` / `mint_safe_genesis_with_controller`
  (`authority_epoch` fact), `genesis_authority_epoch()` reader, `ingest_genesis_opened` (epoch guard +
  return accepted epoch), `authorize` (superseded-genesis denial).
- `libs/aven-caps/src/ownership.rs` — `authorize_signed_edit` superseded-genesis denial; new
  `authority_epoch` unit tests.
- `app/src-tauri/src/avendb/engine.rs` — `hydrate_shell`: feed per-SAFE high-water (`identity_versions`
  max) into `ingest_genesis_opened`; persist/bump high-water on accept.
- `app/src-tauri/src/biscuit_resolver.rs` — ensure `verify_on_apply` authz reflects the epoch guard.
- `app/src-tauri/src/avendb/mod.rs` (or the inbound-apply/change path) — forced re-hydrate on a
  higher-epoch `safes` update for a held SAFE.
- `libs/aven-caps/src/caps.rs` / `ownership.rs` test mods + an app `tests/revocation_epoch.rs`
  (in-process two-vault integration test).

## Acceptance criteria

Each box checkable from the transcript (a command + its output proves it).

- [ ] `cargo test -p aven-caps authority_epoch` passes — epoch is a signed genesis fact surviving
      encode/decode; `ingest_genesis_opened` rejects `epoch < high_water` and accepts `>=`.
- [ ] aven-caps: a cap rooted in a below-high-water (superseded) genesis is denied by
      `authorize` / `authorize_signed_edit` (named test green).
- [ ] `cargo test -p aven-os-app --features desktop-ai revocation_epoch` passes — post-revoke the
      revoked signer's batch is `DenyPermanent` at the legit member; a replayed pre-revoke genesis is
      rejected by ingest (cannot re-instate the revoked member); applying the newer-epoch genesis for a
      held SAFE forces a re-hydrate (enforcement is immediate, no stale-authority window).
- [ ] `cargo build -p aven-caps -p aven-os-app --features desktop-ai -p aven-node` exits 0.
- [ ] No regression: existing `biscuit_resolver`, `owner_binder`, and aven-node apply-gate suites stay
      green (the 0037 binding enforcement is intact).

## Verification

```bash
cargo test -p aven-caps authority_epoch
cargo test -p aven-os-app --features desktop-ai revocation_epoch
cargo build -p aven-caps -p aven-os-app --features desktop-ai -p aven-node
# regression guard:
cargo test -p aven-os-app --features desktop-ai biscuit_resolver
cargo test -p aven-db owner_binder
# (live 2-device revoke check is review's job, not part of the metric)
```

## Hand-off

```
/aven-build 0038
```

…or hand the condition straight to the goal loop:

```
/goal <paste the Completion condition above>
```

## Progress log

Newest entry first.

- `2026-06-14` — Discovery. Born mid-session from a live revocation bug found while testing board
  0037 onboarding. Verified the enforcement model in code: the owner-binding + edit-sig + biscuit-chain
  primitives are cryptographically sound and hold at untrusted relays/members; the gap is genesis
  freshness/rollback (`ingest_genesis_opened` has no epoch guard) + no forced re-hydrate. Chose the
  biscuit-native fix: a monotonic authority epoch (= `dek_version`) bound as a signed genesis fact +
  a verifier high-water mark (unified with the DEK-downgrade defense) → post-sync rollback
  unrepresentable; forced re-hydrate on a newer epoch → immediate enforcement. Sliced to epoch +
  re-hydrate (the keystone); controller-copy freshness, fail-closed revoked-device UX, and cascade
  hardening are follow-on cards. Made "done" provable via aven-caps `authority_epoch` tests + an
  in-process two-vault `revocation_epoch` integration test (no live multi-device needed for the metric).

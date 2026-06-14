---
title: SAFE delegation model — one universal owned-by-subjects model, cryptographically enforced in untrusted P2P
summary: Re-architect the per-SAFE / SAFE-in-SAFE delegation under the compact/simplify/consolidate lens AND make it rollback-proof against untrusted peers. Three eliminations + two crypto-hardenings, one coherent model. ELIMINATE the arbitrary type rules (an `aven` SAFE may only admit `human` SAFEs, a `spark` only `aven`, `find_controlled_safe_of_type` hardcoding human←aven←spark) — the security CORE (aven-caps) is already type-agnostic, these exception rules live only in caps_ipc.rs. Collapse to ONE universal model: any SAFE is owned by any set of subjects, each a key (`did:key:`) or another SAFE (`did:safe:`); `type` is a UI label with ZERO core ACC semantics. CONSOLIDATE roles: there is no OWNER-vs-ADMIN tier — `owns` IS the single full-rights role (read/write/delete/admit/rotate_dek); `reads`/`replicate` are orthogonal sharing tiers, not an admin hierarchy. ENFORCE one core invariant: a SAFE can never reach zero `owns` subjects (anti-lockout), type-agnostic, at the genesis funnel. Then HARDEN: a monotonic authority epoch (= the SAFE's `dek_version`) bound as a signed fact in the genesis so ingest/authorize reject any epoch below a persisted per-SAFE high-water (rollback UNREPRESENTABLE, not raced), plus forced re-hydrate when a newer-epoch genesis for a held SAFE is applied (immediate enforcement — a revoked device's writes are DenyPermanent at every legit member).
owner: claude (aven-caps + app/caps_ipc + app/biscuit_resolver + app/engine hydrate)
created: 2026-06-14
updated: 2026-06-14
tags: [aven-caps, security, revocation, sync, p2p, biscuit, rollback, elimination, ssot]
goal: "The SAFE delegation model is ONE universal owned-by-subjects model, cryptographically enforced and rollback-proof in untrusted P2P. Provable from command output: (1) ELIMINATION — `grep -rn 'find_controlled_safe_of_type\\|safe_type_of' app/src-tauri/src` shows the type-RESTRICTION gating is gone (no match arm rejects an owner by SAFE type; `type` no longer gates ACC), and a new `cargo test -p aven-os-app --features desktop-ai universal_ownership` proves any SAFE can be owned by any subject — a SAFE admits another SAFE of ANY type AND a `did:key:` directly (cases the old rules rejected). (2) ROLE CONSOLIDATION — `cargo test -p aven-caps owns_is_the_single_role` proves `owns` carries exactly OWNER_RIGHTS (read/write/delete/admit/rotate_dek) and there is no separate admin cap; `reads`/`replicate` are the only other (sharing) tiers. (3) LAST-OWNER INVARIANT — `cargo test -p aven-caps last_owner_invariant` proves a genesis re-mint / revoke that would leave zero `owns` subjects FAILS (type-agnostic; not 'last human'). (4) AUTHORITY EPOCH — `cargo test -p aven-caps authority_epoch` proves the epoch is a signed genesis fact surviving encode/decode, `ingest_genesis_opened` rejects epoch < per-SAFE high-water and accepts >=, and `authorize`/`authorize_signed_edit` deny a cap rooted in a below-high-water (superseded) genesis. (5) FORCED RE-HYDRATE / E2E — `cargo test -p aven-os-app --features desktop-ai revocation_epoch` (in-process two-vault): after a revoke bumps epoch v->v+1, the revoked signer's batch is DenyPermanent at the legit member, a replayed pre-revoke (epoch v) genesis is rejected by ingest so it cannot re-instate the revoked member, and applying the v+1 genesis for a held SAFE forces a re-hydrate (no stale-authority window). (6) `cargo build -p aven-caps -p aven-os-app --features desktop-ai -p aven-node` exits 0 with the existing biscuit_resolver / owner_binder / apply-gate suites green (0037 binding enforcement intact); the type-rule elimination is NET-SUBTRACTIVE on caps_ipc.rs (git diff --stat). Out of scope (follow-on cards): safe_controllers controller-copy freshness, fail-closed revoked-device UX, multi-SAFE cascade hardening, live 2-device manual check (review's job)."
---

# SAFE delegation model — one universal owned-by-subjects model, cryptographically enforced

## Context

Found live testing board [[owner-binding-ssot-0037]] onboarding: when device **MacB** is removed as
an owner of a human SAFE (nested under the avenCEO SAFE via `did:safe:` controller chaining), MacB
keeps **stale access** — still sees + writes into both SAFEs, the human SAFE shows "unnamed", and
revocation does not reliably propagate. Investigating it surfaced both a **security-resilience gap**
and an **over-complicated model with arbitrary exception rules** — this card consolidates the fix
under the compact/simplify/consolidate elimination lens.

**Verified in code — the crypto PRIMITIVES are sound** and hold at untrusted relays/members:
`verify_on_apply` (`app/src-tauri/src/biscuit_resolver.rs:144-248`) checks the signed owner-binding
(authenticity) + edit-sig over the receiver digest (integrity) at **every hop incl blind relays**;
`authorize_signed_edit` walks the Ed25519 biscuit chain at members; DEK rotation handles post-revoke
confidentiality (MacB's "unnamed" is rotation *working* — it lost the key to read the re-sealed name).

**Three things to simplify (first principles — these exception rules / overloads shouldn't exist):**

1. **Arbitrary type-restricted ownership.** The security CORE (`aven-caps`) is **already
   type-agnostic** — `mint_safe_genesis` just takes owner/controller DIDs, no human/aven/spark. The
   restrictions live ONLY in the app (`caps_ipc.rs:480-530` `allow_set_safe_membership` + `1010-1028`
   `find_controlled_safe_of_type`): an `aven` SAFE may admit only `human` SAFEs, a `spark` only `aven`,
   other types only keys; and controllers are hardcoded `human ← aven ← spark`. **These are arbitrary
   app-layer exceptions.** Collapse to ONE universal model: a SAFE is owned by any set of subjects,
   each a `did:key:` (a signer) or a `did:safe:` (another SAFE of ANY type). `type` becomes a pure UI
   label with zero core-ACC meaning — the system makes no user-facing distinction.

2. **OWNER-vs-ADMIN is a phantom distinction.** The cap vocabulary (`caps.rs:138-146`) is three
   *attachment kinds*: `owns` → `OWNER_RIGHTS = [read, write, delete, admit, rotate_dek]`,
   `reads` → `[read]`, `replicate` → blind store-forward. **`owns` IS admin** (it carries `admit` +
   `rotate_dek`). There is no separate admin tier. The OWNER-vs-ADMIN feeling is a NAMING overload:
   0037's value-*owner* (the SAFE a value's binding names) vs the *`owns` subject* of a SAFE.
   Consolidate to one role (`owns`); `reads`/`replicate` are orthogonal *sharing* tiers, documented
   as such — no admin hierarchy introduced.

3. **Last-admin anti-lockout is type-coupled and scattered.** The revoke path guards `≥1 human owner`
   (`count_human_owners`). With the type distinction gone, this consolidates to ONE type-agnostic core
   invariant — **a SAFE can never reach zero `owns` subjects** — enforced once at the genesis
   mint/revoke funnel, not per-call-site, not "last human".

**Two things to harden (the rollback gap):** the genesis biscuit is re-minted on revoke, but
`ingest_genesis_opened` (`libs/aven-caps/src/caps.rs:586-606`) inserts ANY validly-signed genesis with
**no freshness guard** — the *old* genesis is also validly signed, so a stale one can roll back
authority; and members keep authorizing against the **stale in-memory vault from last hydrate**.

**The biscuit-native fix for freshness:** biscuits are stateless offline tokens — no inherent "newest".
Revocation-IDs need a synced revocation list (online dependency, wrong for blind-relay P2P); TTL needs
trusted clocks. The offline-friendly equivalent is a **monotonic authority epoch as a signed fact +
verifier high-water mark**: "is this authority ≥ the freshest epoch I've seen?". **Honest boundary:**
first-contact is trust-on-first-use (a verifier with no high-water accepts what it first sees),
inherent to any anchor-less offline system — mitigated by LWW convergence (highest `dek_version` wins;
an attacker can't forge a higher one without the gated admin write) + encryption. The epoch guarantees
no rollback **after first sync**; it must not pretend to invent an online anchor.

This is net-ADDITIVE for the crypto core but net-SUBTRACTIVE for the model (deleting the type rules).

## Goal

The SAFE delegation model is one universal owned-by-subjects model — any SAFE owned by any
keys/SAFEs, one `owns` role, a last-owner invariant — and authority is rollback-proof under untrusted
P2P via a signed monotonic epoch + forced re-hydrate. Completion = the frontmatter `goal:`.

**Completion condition** (identical to the frontmatter `goal:`).

## Approach

**The one model.** A SAFE is `(id, {owns subjects})` where each subject is a `did:key:` or a
`did:safe:` (any other SAFE, any `type`). No type gates ownership. `owns` = full rights; `reads` /
`replicate` are orthogonal sharing tiers. Invariant: never zero `owns`. The mint/revoke funnel
(`mint_safe_genesis` / `rebuild_identity_biscuit_excluding`) is the ONE place authority changes — it
stamps the epoch and enforces the last-owner invariant.

**Eliminations (net-subtractive, app-layer):** delete the `safe_type_of`-based gating in
`allow_set_safe_membership`; delete the type-coupling in `find_controlled_safe_of_type` (a controller
may be ANY specified SAFE/key — keep choosing a sensible default but never *reject* by type); replace
`count_human_owners`-at-revoke with the type-agnostic last-`owns` invariant at the funnel.

**Hardenings (aven-caps + app):** epoch = `dek_version`, stamped as a signed `authority_epoch(N)` fact
in the genesis; `ingest_genesis_opened` + `authorize`/`authorize_signed_edit` reject epoch <
per-SAFE high-water (unified with the existing DEK-downgrade `max dek_version`); the app forces a
re-hydrate when a higher-epoch genesis for a held SAFE is applied.

**Build slices (each independently verifiable; land in order):**
- **S1 — universal model:** delete type-restriction rules + the OWNER/ADMIN naming consolidation;
  `universal_ownership` + `owns_is_the_single_role` tests. (net-subtractive)
- **S2 — last-owner invariant:** type-agnostic, at the funnel; `last_owner_invariant` test.
- **S3 — authority epoch:** signed genesis fact + ingest/authorize high-water guard;
  `authority_epoch` tests.
- **S4 — forced re-hydrate + E2E:** re-hydrate on newer epoch; `revocation_epoch` two-vault test.

**Out of scope (follow-on cards):** `safe_controllers` controller-copy freshness guard; the revoked
device fail-closing its own UI on detected loss-of-membership; multi-SAFE cascade-rotation hardening;
the live 2-device manual onboarding+revoke check (review's job).

## Steps

1. **S1a** caps_ipc: delete the `safe_type_of` match gating in `allow_set_safe_membership` (any subject
   admitted); delete the type-coupling in `find_controlled_safe_of_type` (controller = any specified
   SAFE/key, sensible default kept, no rejection-by-type). Migrate `create_identity` accordingly.
2. **S1b** aven-caps: assert + document the single role — `owns_is_the_single_role` test over
   `OWNER_RIGHTS` / `grant_kind_caps`; clarify the value-owner (binding) vs `owns`-subject naming in docs.
3. **S2** aven-caps: `mint_safe_genesis` / `rebuild_identity_biscuit_excluding` enforce ≥1 `owns`
   subject (type-agnostic last-owner invariant); replace the `count_human_owners` revoke guard.
4. **S3** aven-caps: `authority_epoch(N)` signed fact in genesis (N = `dek_version`),
   `genesis_authority_epoch()` reader; `ingest_genesis_opened(..., high_water)` rejects `epoch < hw`
   and returns the accepted epoch; `authorize`/`authorize_signed_edit` deny a below-hw genesis.
5. **S4a** app: feed per-SAFE high-water (existing `identity_versions` max) into ingest at hydrate;
   persist/bump on accept.
6. **S4b** app: force re-hydrate on applying a higher-epoch `safes` update for a held SAFE
   (inbound-apply/change path).
7. Tests: `universal_ownership`, `owns_is_the_single_role`, `last_owner_invariant`, `authority_epoch`,
   `revocation_epoch`. Build aven-caps + app(desktop-ai) + aven-node green; existing suites green.

## Files to touch

- `app/src-tauri/src/avendb/caps_ipc.rs` — delete `safe_type_of` gating in `allow_set_safe_membership`;
  de-type-couple `find_controlled_safe_of_type`; revoke path uses the funnel invariant not `count_human_owners`.
- `libs/aven-caps/src/caps.rs` — `mint_safe_genesis` / `mint_safe_genesis_with_controller`
  (`authority_epoch` fact + last-`owns` invariant), `genesis_authority_epoch()`, `ingest_genesis_opened`
  (epoch guard + return), `authorize` (superseded-genesis denial), `rebuild_identity_biscuit_excluding`
  (last-owner invariant); `owns_is_the_single_role` / `last_owner_invariant` / `authority_epoch` tests.
- `libs/aven-caps/src/ownership.rs` — `authorize_signed_edit` superseded-genesis denial.
- `app/src-tauri/src/avendb/engine.rs` — `hydrate_shell` feeds per-SAFE high-water into ingest.
- `app/src-tauri/src/avendb/mod.rs` (inbound-apply/change path) — forced re-hydrate on higher epoch.
- `app/src-tauri/src/biscuit_resolver.rs` — `verify_on_apply` reflects the epoch guard.
- app `tests/` — `universal_ownership`, `revocation_epoch` (in-process two-vault).

## Acceptance criteria

Each box checkable from the transcript.

- [ ] `grep -rn 'find_controlled_safe_of_type\|safe_type_of' app/src-tauri/src` shows no type-RESTRICTION gating remains (`type` no longer rejects an owner).
- [ ] `cargo test -p aven-os-app --features desktop-ai universal_ownership` — a SAFE admits another SAFE of any type AND a `did:key:` directly (old rules rejected these).
- [ ] `cargo test -p aven-caps owns_is_the_single_role` — `owns` = OWNER_RIGHTS; no separate admin cap; only other tiers are `reads`/`replicate`.
- [ ] `cargo test -p aven-caps last_owner_invariant` — a mint/revoke leaving zero `owns` subjects FAILS (type-agnostic).
- [ ] `cargo test -p aven-caps authority_epoch` — epoch is a signed genesis fact (round-trips); ingest rejects epoch < high-water, accepts ≥; superseded-genesis cap denied.
- [ ] `cargo test -p aven-os-app --features desktop-ai revocation_epoch` — post-revoke the revoked signer's batch is `DenyPermanent` at the member; replayed pre-revoke genesis rejected; newer epoch forces re-hydrate (immediate enforcement).
- [ ] `cargo build -p aven-caps -p aven-os-app --features desktop-ai -p aven-node` exits 0; existing `biscuit_resolver` / `owner_binder` / apply-gate suites green.
- [ ] The type-rule elimination is net-subtractive on `caps_ipc.rs` (`git diff --stat`).

## Verification

```bash
grep -rn 'find_controlled_safe_of_type\|safe_type_of' app/src-tauri/src   # no type-restriction gating
cargo test -p aven-caps owns_is_the_single_role
cargo test -p aven-caps last_owner_invariant
cargo test -p aven-caps authority_epoch
cargo test -p aven-os-app --features desktop-ai universal_ownership
cargo test -p aven-os-app --features desktop-ai revocation_epoch
cargo build -p aven-caps -p aven-os-app --features desktop-ai -p aven-node
# regression: cargo test -p aven-os-app --features desktop-ai biscuit_resolver; cargo test -p aven-db owner_binder
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

- `2026-06-14` — Discovery (expanded under the compact/simplify/consolidate lens). Verified in code:
  (a) the SAFE-in-SAFE type rules (`aven`←`human`, `spark`←`aven`, controller hierarchy) are arbitrary
  app-layer exceptions — `aven-caps` core is already type-agnostic — so they collapse to ONE universal
  owned-by-subjects model (`type` = UI label only); (b) there is no OWNER-vs-ADMIN tier — `owns` is the
  single full-rights role, `reads`/`replicate` are orthogonal sharing tiers (the split is a value-owner
  vs `owns`-subject naming overload); (c) last-admin anti-lockout is type-coupled + scattered → one
  type-agnostic last-`owns` invariant at the genesis funnel. Plus the crypto rollback fix: a monotonic
  authority epoch (= `dek_version`) bound as a signed genesis fact + verifier high-water (unified with
  the DEK-downgrade defense) → post-sync rollback unrepresentable; forced re-hydrate on a newer epoch →
  immediate enforcement. Sliced S1–S4 (model first, then crypto). Made "done" provable via aven-caps
  unit tests + in-process two-vault `universal_ownership` / `revocation_epoch` (no live multi-device for
  the metric). Follow-on cards: controller-copy freshness, fail-closed revoked-device UX, cascade.
- `2026-06-14` — Original discovery (revocation epoch + re-hydrate only); superseded by the expanded
  model-consolidation scope above.

---
title: aven-node relay — CAPS as the single access gate (cap-admission + fail-closed authenticity + metadata minimization)
summary: Close audit findings A8/A1/A2/A3 on the hosted Sprite relay so capabilities are the single source of truth for access. Cap-gate the /sync handshake (only avenCEO members admitted; restricted onboarding tier) + lock the Sprite machine surface; make verify_on_apply fail-closed on spark-scoped rows (mirror the client, no exceptions); minimize/document the relay's world-readable routing metadata. Per-row read/write cap stays on the client (the blind relay cannot see sealed user caps).
owner: unassigned
created: 2026-06-12
updated: 2026-06-12
tags: [aven-node, security, access-control, caps, transport, websocket, sprites, audit]
goal: "cargo test -p aven-node and cargo test -p aven-p2p exit 0 (incl. the new admission + fail-closed apply-gate tests named in Acceptance); cargo build --release -p aven-node exits 0; bun run check and bun run lint exit 0; the deploy script + runbook + trust-boundaries doc changes named below are present (grep-provable); and every Acceptance criterion is checked"
---

# aven-node relay — CAPS as the single access gate

## Context

Follow-on from the 2026-06-12 relay audit (`docs/audit/2026-06-12-aven-node-sprite-security-audit.md`).
Findings being closed: **A8** (public internet can reach the Sprite machine), **A1**
(`may_sync` always `Allow`), **A2** (world-readable routing/relationship metadata),
**A3** (fail-open `None => Allow` on apply). Goal in the user's words: *capabilities
must be the single source of truth for any access — disk and DB rows/roles alike — and
nobody from the public may reach the Sprite machine.*

**The blind-relay constraint that shapes everything (read before building):** the relay
is a *blind* replica. Each user identity's capability chain (`genesis_b64`,
`issuer_pubkey_b64`) is **sealed under that identity's DEK** (board 0015,
`aven_ceo.rs:116-153`), which the relay never holds. So the relay **cannot** evaluate
per-row membership for user data — that is *why* `ServerApplyGate::may_sync` returns
`Allow` and `verify_on_apply` checks only authenticity (`main.rs:125-179`). Making the
relay enforce per-row read/write caps would require giving it the DEKs, which destroys
E2E. **Decision (confirmed with the user):** per-row cap enforcement stays on the client
(already fail-closed in `app/src-tauri/src/biscuit_resolver.rs:39-101`); the relay's
cap job is **connection admission + authenticity**, both of which it *can* verify
because it owns the avenCEO root.

Related: `0008-aven-server-relay-hardening` (durability/registry — separate, scoped out
there as "auth/invite/ACC model = separate work"; this is that work).

User-confirmed decisions (discovery): admission = **cap gate + Sprite URL lockdown**;
A1 scope = **admission + authenticity only**; A3 = **mirror the client** (fail-closed on
spark-scoped tables, no exceptions within that class; non-spark-scoped/local tables
unchanged); packaging = **one card, built in the three phases below with a checkpoint
after each**.

## Goal

The relay admits a `/sync` connection only when the peer proves an avenCEO capability
(full member) or a restricted onboarding capability (self-authored rows + avenCEO
genesis only); rejects every unsigned/unbound spark-scoped row on apply exactly as the
client does; exposes no more plaintext metadata than blind routing strictly needs (with
the residual documented); and the Sprite machine exposes nothing to the public but the
cap-gated `/sync` + `/health` on :8080.

**Completion condition** (identical to frontmatter `goal`):

> `cargo test -p aven-node` and `cargo test -p aven-p2p` exit 0 (including the new
> admission + fail-closed apply-gate tests named in Acceptance); `cargo build --release
> -p aven-node` exits 0; `bun run check` and `bun run lint` exit 0; the deploy-script,
> runbook, and trust-boundaries changes named below are present (grep-provable); and
> every Acceptance criterion is checked.

## Approach

Three phases, each independently verifiable; **stop and review after each**.

### Phase 1 — A3: relay apply gate fail-closed (mirror the client)
The smallest, zero-ambiguity slice. The client already denies missing owner-binding on
spark-scoped tables with "no table exclusions" (`biscuit_resolver.rs:119-130`); the
relay is the only peer still fail-open (`main.rs:144-146`). Mirror it:
- Hoist `is_spark_scoped_table` (today app-only, `app/src-tauri/src/identity_sync.rs:78`)
  into a crate both the app and aven-node depend on — **`aven-db`** (it already owns the
  schema types and the `OWNER_BINDING_META_KEY` literal, `libs/aven-db/src/capability.rs:61`).
  Compute the spark-scoped set from the embedded schema so it can't drift. App keeps a
  thin re-export to avoid churn.
- In `ServerApplyGate::verify_on_apply`, replace the unconditional `None => Allow` with:
  spark-scoped table → `DenyPermanent` (log `relay-deny[no-binding]`); non-spark-scoped →
  `Allow`. Everything after (binding authenticity, row-id match, edit-sig over the
  receiver digest) is unchanged and already correct.
- This is "no unsigned/unbound rows e2e, zero exceptions" **within the spark-scoped
  class** — matching the client byte-for-byte so the two gates can never disagree.

### Phase 2 — A8 + A1: cap-gated connection admission + machine lockdown
The relay owns avenCEO (`main.rs:222-251`) so it holds avenCEO's genesis + issuer pubkey
and **can verify a biscuit that chains to the avenCEO root**. Add an admission step to
the handshake:
- Extend `ClientAuth` (`aven-p2p/src/challenge.rs:61-67`) with an optional
  `membership_proof` (a serialized biscuit/attestation chaining avenCEO → this peer's
  SAFE/DID). Backward-tolerant serde so old peers still parse.
- In `ws_server.rs` after the did:key proof, classify the peer:
  - **Full member** — `membership_proof` verifies against the avenCEO chain → admit, full
    sync (today's behaviour, now earned not granted).
  - **Onboarding (restricted)** — no/þinvalid membership proof → admit in a restricted
    mode that the relay *can* enforce blind: outbound limited to avenCEO genesis/issuer
    rows + keyshares whose `recipient_did` == this peer (the existing self-evident
    keyshare delivery, `biscuit_resolver.rs:57-69`); inbound limited to rows whose
    owner-binding `author_did` == this peer's connection DID (self-authored onboarding:
    its own human SAFE + signer + self-keyshares). This preserves the first-human-admin
    bootstrap (`aven_ceo.rs:305-361`) — a brand-new device must connect *before* it's an
    avenCEO member.
  - **Reject** — only if the did:key proof itself fails (unchanged).
- Enforce the restriction by tagging the registered peer with its tier and checking it in
  `may_sync` (outbound) and `verify_on_apply` (inbound author-DID match) — both
  relay-verifiable without any DEK.
- **Machine lockdown (the Sprite "auth URL" half):** ensure the Sprite exposes *only*
  :8080 (`/sync` + `/health`) to the public — no other listener — and set the URL auth
  posture explicitly in the deploy script + runbook. NB tension: full Sprites
  authenticated-URL mode would block public onboarding entirely, so the platform layer
  must stay reachable for `/sync`; the realistic second barrier is (a) assert the surface
  is 8080-only, (b) an optional coarse app-embedded gate token checked at handshake
  before the cap step, and (c) document the posture. The cap gate is the real control.

### Phase 3 — A2: metadata minimization + documentation
Blind routing genuinely needs a few plaintext columns (`owner`, `type`, `recipient_did`,
`wrap_did`, `dek_version` — `aven_ceo.rs:339-344`). Scope conservatively:
- Enumerate the **minimal required** plaintext set and add a test/assert that no column
  outside it is written in the clear by the relay's authored rows.
- Where a relationship column is used only for equality routing (`recipient_did`),
  evaluate replacing it with a salted/HMAC routing tag the recipient also derives, so the
  membership graph isn't world-readable. If that proves to entangle the client keyshare
  path, mark it a follow-on `ideate/` card rather than forcing it here — but **document
  the residual exposure** in `docs/security/trust-boundaries-and-sensitive-material.md`
  (which today stops at the device and never states what the relay shows peers).

Out of scope: per-row user-cap evaluation at the relay (would de-blind — rejected);
server↔server mesh; the durability/registry work in `0008`.

## Steps

1. **P1.1** Hoist `is_spark_scoped_table` into `aven-db` (schema-derived); app re-exports.
2. **P1.2** Make `ServerApplyGate::verify_on_apply` fail-closed on spark-scoped missing
   binding; keep all downstream checks.
3. **P1.3** Tests in `aven-node`: spark-scoped no-binding → deny; non-spark no-binding →
   allow; valid bound+signed → allow; forged/relabeled/tampered → deny. **Checkpoint.**
4. **P2.1** Add `membership_proof` to `ClientAuth` (serde-tolerant) + a verifier in
   `aven-caps`/`aven-p2p` that checks a proof against the avenCEO chain.
5. **P2.2** Classify peers (member / onboarding / reject) in `ws_server.rs`; tag the
   registry entry with the tier.
6. **P2.3** Enforce the onboarding restriction in `may_sync` (outbound: avenCEO + own
   keyshares) and `verify_on_apply` (inbound: self-authored only).
7. **P2.4** Tests: member admitted full; onboarding peer can push only self-authored rows
   + pull avenCEO/own keyshares; non-member can't pull a third party's rows; bad proof →
   onboarding tier (not full). First-human bootstrap still completes (integration-style
   test or documented manual check).
8. **P2.5** Deploy script + runbook: assert 8080-only surface, set/declare URL auth
   posture, optional coarse gate token. **Checkpoint.**
9. **P3.1** Add the minimal-plaintext-set assert/test for relay-authored rows.
10. **P3.2** (stretch) salted routing tag for `recipient_did`; else follow-on card.
11. **P3.3** Document the relay's exposed metadata + residual in trust-boundaries doc.
    **Checkpoint.**
12. Run full verification; check off Acceptance; update Progress log.

## Files to touch

- `libs/aven-db/src/...` — new shared `is_spark_scoped_table` (schema-derived) + export.
- `app/src-tauri/src/identity_sync.rs` — re-export the shared fn (remove the local copy).
- `libs/aven-node/src/main.rs` — `ServerApplyGate::verify_on_apply` fail-closed; tier
  checks in `may_sync`.
- `libs/aven-node/src/ws_server.rs` — admission classification, registry tier tag,
  outbound restriction.
- `libs/aven-p2p/src/challenge.rs` — `membership_proof` field + verifier wiring.
- `libs/aven-caps/src/caps.rs` — verify a membership proof against the avenCEO chain.
- `libs/aven-node/src/aven_ceo.rs` — (P3) minimal-plaintext assertion for authored rows.
- `scripts/deploy-aven-node-sprite.ts` — URL auth posture / surface assertion / token.
- `docs/deploy/aven-server-mini.md` — runbook: admission + URL posture.
- `docs/security/trust-boundaries-and-sensitive-material.md` — relay exposure section.

## Acceptance criteria

Each checkable from the transcript.

- [ ] **A3** `cargo test -p aven-node` includes and passes
      `apply_gate_denies_spark_scoped_row_without_binding`,
      `apply_gate_allows_non_spark_scoped_without_binding`,
      `apply_gate_allows_valid_bound_signed_row`,
      `apply_gate_rejects_forged_or_tampered_row` — exits 0.
- [ ] **A3 parity** the relay and `biscuit_resolver.rs` share one
      `is_spark_scoped_table` (grep shows aven-node importing it from `aven-db`, the app
      copy removed/re-exported).
- [ ] **A8/A1 admission** `cargo test -p aven-node`/`-p aven-p2p` includes and passes
      `admits_avenceo_member_full`, `admits_unproven_peer_onboarding_restricted`,
      `onboarding_peer_cannot_pull_third_party_rows`,
      `onboarding_peer_can_push_only_self_authored` — exits 0.
- [ ] **A8 bootstrap** first-human-admin still completes under the restricted onboarding
      tier (test or a documented, reproduced manual check in the runbook).
- [ ] **A8 machine** deploy script/runbook assert the public surface is :8080-only and
      declare the URL auth posture (grep-provable change).
- [ ] **A2** a test/assert proves relay-authored rows write no plaintext column outside
      the documented minimal routing set; trust-boundaries doc has a "what the relay
      exposes to peers" section.
- [ ] `cargo build --release -p aven-node` exits 0; `bun run check` and `bun run lint`
      exit 0.

## Verification

```bash
cargo test -p aven-node
cargo test -p aven-p2p
cargo test -p aven-caps
cargo build --release -p aven-node
bun run check
bun run lint
grep -n "is_spark_scoped_table" libs/aven-node/src/*.rs        # shared, not redefined
grep -n "membership_proof" libs/aven-p2p/src/challenge.rs       # admission field present
grep -nE "auth|8080|--auth" scripts/deploy-aven-node-sprite.ts  # surface/posture
grep -n "relay" docs/security/trust-boundaries-and-sensitive-material.md  # A2 doc
```

## Hand-off

```
/aven-build 0023-aven-node-caps-single-access-gate
```

…or drive the loop directly:

```
/goal cargo test -p aven-node and cargo test -p aven-p2p exit 0 (incl. the new admission + fail-closed apply-gate tests); cargo build --release -p aven-node exits 0; bun run check and bun run lint exit 0; deploy-script + runbook + trust-boundaries changes present; all Acceptance criteria checked
```

## Progress log

- `2026-06-12` — Discovery: interviewed; uncovered that the blind relay cannot evaluate
  per-row user caps (caps sealed under user DEKs), so A1 is reframed to admission +
  authenticity with per-row enforcement staying on the client. Confirmed decisions:
  cap-gated admission + Sprite URL lockdown (A8); mirror-the-client fail-closed apply
  gate (A3); conservative metadata minimization + documentation (A2); one card built in
  three checkpointed phases. Made the goal measurable. Created in `discover/`.

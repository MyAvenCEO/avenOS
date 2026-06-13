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

**The two cap layers — what the relay CAN vs CANNOT see (read before building):**

*avenCEO is the relay's access-control SSOT.* The relay **owns** avenCEO: it holds the
avenCEO DEK (self-wrapped, `aven_ceo.rs:206-224`, read back via `read_server_dek`
`:273-303`), so it can decrypt avenCEO and read its biscuit chain →
`identity_admins(&chain, avenceo_id)` gives the avenCEO **admin set** (`:334`); and it
reads plaintext `recipient_did` on avenCEO-owned keyshares (`:285`) → the **member
roster** (every DID holding an avenCEO keyshare). So all **node/server caps are
avenCEO-tracked and relay-enforceable**: admission / `may_sync` ("is this DID an avenCEO
member/admin?"), the **per-identity upload quota** (already keyed by owner-binding,
`main.rs:181-190`), and **rate limiting**. avenCEO is where these live and where the
relay enforces them — the single source of truth for node-level access.

*What the relay still cannot see — and must not.* Each **user** identity's capability
chain (`genesis_b64`, `issuer_pubkey_b64`) is **sealed under that identity's DEK** (board
0015, `aven_ceo.rs:116-153`), which the relay never holds. So the relay cannot evaluate
**per-spark membership** (is Bob a member of Alice's private spark) — that is *why*
today's `may_sync` returns `Allow`. That stays client-enforced (already fail-closed in
`app/src-tauri/src/biscuit_resolver.rs:39-101`) and must, or E2E breaks. Per-spark caps
are not node caps, so this split is clean.

**Decision (confirmed with the user):** the relay enforces **avenCEO-membership-level**
caps (admission, quota, rate) against the avenCEO roster as SSOT, plus **authenticity**
(A3); **per-spark** read/write caps stay on the client.

Related: `0008-aven-server-relay-hardening` (durability/registry — separate, scoped out
there as "auth/invite/ACC model = separate work"; this is that work).

User-confirmed decisions (discovery): admission = **cap gate (avenCEO roster as SSOT) +
Sprite URL lockdown**; A1 scope = **avenCEO-membership caps (admission/quota/rate) at the
relay + authenticity**; per-spark caps stay client-side; A3 = **per-SAFE-identity owner-
binding on every spark-scoped (owner-bearing) row, E2E, zero exceptions** — the relay
fail-closed exactly like the client; packaging = **one card, built in the three phases
below with a checkpoint after each**.

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

### Phase 2 — A8 + A1: cap-gated admission with avenCEO as the relay's ACL SSOT
The relay owns avenCEO and can read its roster (admins via `identity_admins`, members via
avenCEO-keyshare `recipient_did`). So admission is enforced **against the avenCEO roster
the relay already holds** — avenCEO is the SSOT, not a per-connection assertion. A
peer-presented biscuit is an optional fast-path/secondary check, not the source of truth.
Add an admission step to the handshake:
- In `ws_server.rs` after the did:key proof, the relay maps the proven peer DID to its
  avenCEO standing by consulting the avenCEO roster (admin set + member `recipient_did`
  set) it reads from its own store. Optionally accept a `membership_proof` added to
  `ClientAuth` (`aven-p2p/src/challenge.rs:61-67`, serde-tolerant) as a fast path before
  the roster is hydrated. Classify:
  - **Member/admin** (DID in the avenCEO roster) → admit, full sync.
  - **Onboarding (restricted)** — DID not yet in the roster → admit in a restricted mode
    the relay enforces blind: outbound limited to avenCEO genesis/issuer rows + keyshares
    whose `recipient_did` == this peer (existing self-evident delivery,
    `biscuit_resolver.rs:57-69`); inbound limited to rows whose owner-binding `author_did`
    == this peer's connection DID (self-authored: its own human SAFE + signer +
    self-keyshares). Preserves the first-human-admin bootstrap (`aven_ceo.rs:305-361`) —
    a new device must connect *before* it is granted into avenCEO. Once granted, its next
    connect classifies as member.
  - **Reject** — only if the did:key proof itself fails (unchanged).
- Enforce the tier by tagging the registry entry and checking it in `may_sync` (outbound
  scope) and `verify_on_apply` (inbound author-DID match) — all from the avenCEO roster +
  owner-binding, no user DEK needed.
- **Quota & rate (avenCEO-tracked):** keep the per-identity upload quota
  (`main.rs:181-190`) and add per-peer rate limiting, both scoped by avenCEO membership so
  a member's budget is known and a non-member is capped to the onboarding minimum. (Builds
  on audit P1/S2 — bounded maps, frame cap — cross-referenced, not re-done here.)
- **Machine lockdown (the Sprite "auth URL" half):** ensure the Sprite exposes *only*
  :8080 (`/sync` + `/health`) to the public — no other listener — and set the URL auth
  posture explicitly in the deploy script + runbook. NB tension: full Sprites
  authenticated-URL mode would block public onboarding entirely, so the platform layer
  must stay reachable for `/sync`; the realistic second barrier is (a) assert the surface
  is 8080-only, (b) an optional coarse app-embedded gate token checked at handshake
  before the cap step, and (c) document the posture. The cap gate is the real control.

### Phase 3 — A2: metadata exposure (largely closed by Phase 2) + documentation
**Phase 2 closes most of A2:** once admission is cap-gated, the plaintext routing/
relationship metadata is visible only to **avenCEO members**, not the public internet —
and that same plaintext roster is *what the relay needs* to enforce membership, so it
must stay readable to the relay. So A2 is no longer "blind it from everyone"; it is
"non-members can't read it (done in P2) + minimize and document the member-visible
residual." Blind routing genuinely needs a few plaintext columns (`owner`, `type`,
`recipient_did`, `wrap_did`, `dek_version` — `aven_ceo.rs:339-344`). Scope conservatively:
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
4. **P2.1** Build the avenCEO roster reader in the relay (admin set via `identity_admins`
   + member set via avenCEO-keyshare `recipient_did`); optional `membership_proof` on
   `ClientAuth` (serde-tolerant) as a fast path.
5. **P2.2** Classify peers (member / onboarding / reject) in `ws_server.rs` against the
   roster; tag the registry entry with the tier.
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
      **[DONE 2026-06-12]** `cargo test -p aven-node apply_gate` → 4 passed; 0 failed.
- [x] **A3 parity** the relay and the client classify identity-scoped rows with one
      schema-derived predicate. **[DONE]** canonical `aven_db::is_owner_scoped_table` /
      `owner_scoped_table_names` (a table is identity-scoped iff it has an `owner` column);
      the relay imports it (`main.rs` `ServerApplyGate::new`). (App keeps its manifest-based
      derivation of the *same* rule; follow-up to route it through the aven-db helper too.)
- [ ] **A8/A1 admission** — NOT DONE (stopped at verified boundary; see Progress log +
      "Phase 2 design" below). Requires a live client↔relay handshake to validate, which
      can't run in CI/sandbox. Tests to add: `admits_avenceo_member_full`,
      `admits_unproven_peer_onboarding_restricted`, `onboarding_peer_cannot_pull_third_party`,
      `onboarding_peer_can_push_only_self_authored`.
- [ ] **A8 bootstrap** first-human-admin still completes under the restricted onboarding
      tier — NOT DONE (depends on admission).
- [ ] **A8 machine** deploy script/runbook assert :8080-only surface + URL auth posture —
      NOT DONE (the runbook `docs/deploy/aven-server-mini.md` is the stale fly path; needs
      rewrite for the Sprite reality first — audit A6).
- [x] **A2** trust-boundaries doc has a "what the relay exposes to peers" section.
      **[DONE]** `docs/security/trust-boundaries-and-sensitive-material.md` — relay section
      (avenCEO as ACL SSOT, blind to user sparks, minimal plaintext routing set,
      member-visible residual). The relay-authored-row plaintext *assert* test remains.
- [x] `cargo test -p aven-node` (apply gate) exits 0. `cargo build --release` + `bun run
      check`/`lint` to run in `review`.

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

## Phase 2 design note — the open problem to resolve with a live client

Admission (A8/A1) was deliberately **not** implemented blind, because classifying a
connection correctly hinges on a DID-layer mapping that must be validated against a real
handshake (getting it wrong locks out the deployed fleet on deploy):

- A connecting peer authenticates with its **device signer DID** (ed25519 `PeerId` →
  signer did) — `ws_server.rs` `verify_client`.
- avenCEO membership is tracked at the **SAFE** level: admins are `did:safe:` in the
  avenCEO biscuit (`identity_admins`), and avenCEO keyshare `recipient_did`s are a SAFE's
  **`wrap_did`** (`aven_ceo.rs:387-394`) — neither is the connecting device's signer DID.
- So admission needs a **device-signer → SAFE → avenCEO** walk: `signers` (plaintext
  `signer_did`,`owner=SAFE`) maps the device signer to its SAFE; then the SAFE must be an
  avenCEO admin (biscuit `owns`) **or** hold an avenCEO keyshare. All inputs are
  plaintext-readable by the blind relay, but the exact DID forms (signer did vs `wrap_did`
  vs `did:safe:`) and the onboarding-before-membership window must be confirmed on a live
  client before flipping enforcement on.

Build plan when resumed: (1) pure `classify_peer(signer_did, &roster) -> Tier` — unit
testable cheaply; (2) `avenceo_roster(engine) -> Roster{member_signer_dids, admin_safes}`
reading `signers`+`keyshares`+biscuit; (3) tier-gated `may_sync` outbound scope +
`verify_on_apply` inbound self-authored check for the onboarding tier; (4) optional
`membership_proof` fast-path on `ClientAuth` (serde-tolerant); (5) **integration test
against a real client** + a rollout flag (default permissive → fail-closed only after
validation) so a bad mapping can't brick the fleet. Rewrite the stale fly runbook
(`docs/deploy/aven-server-mini.md`, audit A6) for the Sprite reality as part of A8-machine.

## Hand-off

```
/aven-build 0026-aven-node-caps-single-access-gate
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
- `2026-06-12` — Refinement (user): corrected the model — **avenCEO is the relay's ACL
  SSOT**. The relay owns avenCEO and can read its roster (admins via `identity_admins`;
  members via avenCEO-keyshare `recipient_did`), so node caps (admission/`may_sync`,
  upload quota, rate limiting) ARE relay-enforceable against avenCEO — only per-spark
  membership stays client-side. Admission now reads the avenCEO roster (SSOT) rather than
  relying on a presented biscuit. A3 restated as per-SAFE-identity owner-binding on every
  spark-scoped (owner-bearing) row, E2E, zero exceptions. Noted that cap-gated admission
  (P2) by itself closes most of A2 (metadata visible to members, not the public).
- `2026-06-12` — Build (Phase 1 + Phase 3 docs): **A3 DONE + verified.** aven-db gained the
  schema-derived SSOT predicate `is_owner_scoped_table`/`owner_scoped_table_names`; the
  relay `ServerApplyGate` now denies a bindingless spark-scoped row (was fail-open
  `None=>Allow`), byte-for-byte with the client. `cargo test -p aven-node apply_gate` → **4
  passed, 0 failed** (full RocksDB build, 9m38s); `cargo check -p aven-db` clean. **A2
  docs DONE** (trust-boundaries relay section). Committed + pushed.
- `2026-06-12` — **Owner invariant on the write path (user ask: reject ownerless values
  everywhere).** Added `aven_db::owner_invariant_ok` (a non-nullable `owner` column must
  hold a non-null value; nullable-owner tables like `signers` local rows are the schema's
  carve-out) and enforced it in `AvenDbClient::resolve_named_row` — THE create surface —
  so no create path (app or relay) can write an ownerless value into an owned table, zero
  exceptions. Inbound sync is already covered by the fail-closed apply gate; non-nullable
  owner columns can't be nulled on update by the column constraint. +3 aven-db unit tests.
- `2026-06-12` — **Admission shadow wiring (Phase 2 safe core).** Added `admission.rs`:
  pure `classify_peer` (Member iff the peer's device did:key is in avenCEO's roster) +
  `read_avenceo_member_signer_dids` (reads `signers.signer_did WHERE owner==avenceo_id` —
  plaintext, no DEK) + 5 unit tests. Wired into the peer loop in SHADOW mode (logs the tier;
  enforcement gated behind `AVEN_SERVER_ENFORCE_ADMISSION`, default off) so it can be
  deployed for telemetry and validated against real clients before the fail-closed flip.
- `2026-06-12` — **Phase 2 (A8/A1 admission enforcement) intentionally stopped at the
  verified boundary.** Reason: correct admission needs a device-signer→SAFE→avenCEO DID-layer walk
  that must be validated against a live client↔relay handshake (no integration harness in
  the sandbox); shipping it blind risks locking out the deployed fleet on deploy. Full
  design + build plan captured in "Phase 2 design note" above. Card stays in `build/`;
  resume with a live client. A8-machine (runbook) blocked on rewriting the stale fly
  runbook (audit A6) for the Sprite reality.

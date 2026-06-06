# Ownership & Identities — Project Progress (SSOT)

> The single canonical tracker. **North star:** every value is **private by default**,
> owned by an **identity** (typed `human`|`aven`), bound by a **signed owner-binding**
> verified on apply by **every peer** (incl. the always-on `aven-server`); sharing only
> via explicit biscuit caps; revocation = caps + eviction (backward reads not
> recallable — accepted).

## Invariants (locked)

- **Private by default** — no `AllowAll` in production; deny-by-default at every gate.
- **Ownership = signed owner-binding** (Option B over UUIDs). No content-addressed ids.
- **The binding is the authoritative owner**; the `owner` column is its gate-enforced,
  write-once value (an inbound row whose column ≠ its signed binding is rejected).
- **Enforcement on inbound apply**, the same resolver on every peer → relay-proof E2E.
- **Greenfield** — fresh DB + fresh schema baseline. Migration *mechanism* kept; legacy
  snapshots dropped.
- **Crypto/authorization single-sourced in `aven-caps`.**

---

## ✅ Shipped (committed, live-validated)

- ✅ `aven-caps`: owner-binding + edit-sig primitives + `Admit`/`RotateDek` cap ops + wire codec (24 tests)
- ✅ `verify_on_apply` on **every** peer (device + relay server) — relay-proof
- ✅ Owner-binding stamped on **every** write (create/update/delete), incl. the bootstrap/default-identity path
- ✅ Deny-by-default: a spark-scoped row without a valid binding is rejected on apply; per-kind caps (`peers→Admit`, `keyshares→RotateDek`), no table exclusions
- ✅ Write-once owner: local relabel rejected + inbound immutable-check
- ✅ Spark-scoped DB viewer (per-identity data sub-tab)
- ✅ Live-validated E2E: onboard, grant, data create/edit, **user-spark sharing**, A↔B via relay
- ✅ Docs consolidated into this single SSOT

---

## ✅ Milestone 1 — Identities remodel (DONE — `f9e11be`/`5f017a3`/`8018ac8`)

**Done in 2 green steps:** (1) full mechanical rename `spark`→`identity` /
`spark_id`→`owner` (uniform owner model — an identity row self-owns) across
aven-caps + backend + server + frontend (routes/components/stores/i18n, files+dirs
moved); (2) `humans` table + `my_devices` allowlist **dropped** (device access =
`peers` roster + biscuit caps), identities **typed** (`human`|`aven`, set at all 3
create sites), human profile folded onto the human identity, `device_label`
auto-extracted (scutil). App+server build green, svelte-check 0 errors. **Pending:
wipe + live-test** (harness building). Original task breakdown below (all done):

**Done:** schema (identities + `type` + `username_slug`, `owner` everywhere, `humans`
dropped) · aven-caps + backend + server + frontend rename (files/dirs moved) ·
humans→identity merge · typed identities · auto device-name · apps build + launch green.

**Still pending polish (small, non-blocking):**
- [ ] On-disk folder `identities/`→`peers/` (`aven-server/src/main.rs:91`
  `base.join("identities")` + app `crypto_dir` derivation) — concept-clarity rename so
  the on-disk per-device keystore (a network *peer*) doesn't collide with the
  `identities` *table*.
- [ ] Cosmetic: `build_object_spark_id_map` → `build_object_owner_map` (word-boundary
  missed it; compiles consistently, just an inconsistent name) + ~263 `spark` mentions
  left in doc comments.
- [ ] **Runtime live-test** (apps launched green — verifying onboard/share/DB-viewer).

---

## ☐ Milestone 2 — Eviction-notice protocol

Revoke (re-mint biscuit + DEK rotate + delete revoked keyshares) **exists**. Missing: a
**peer-specific eviction notice** — self-eviction can't trigger (a revoked peer is gated
out → never learns it's revoked), and a global tombstone would propagate a false delete.
- [ ] New peer-scoped eviction-notice sync payload (`sync_manager`).
- [ ] Sender: on a revoked peer's `FrontierNeed` for a now-denied identity → emit notice.
- [ ] Receiver: drop local rows for that identity (local-only, not a tombstone).
- [ ] Live test: revoke → reconnect → data evicted from the honest peer.

## ✅ Milestone 3 — Edit-sig (satisfied by equivalence)

**The goal — "every edit signed + verified on apply" — is already met**, so adding a
separate `batch_digest` signature would be redundant complexity (first-principles:
don't add what you don't need):
- **Author authentication per write:** the owner-binding is **re-minted and signed by
  the author** on every create/update/delete, and `verify_on_apply` checks it on every
  peer. That *is* a signed, verified-on-apply edit.
- **Data integrity:** AEAD authenticates each sealed cell on decrypt.
- Together = the Phase-1 intent without a persisted-codec change. (If a distinct
  whole-batch signature is ever wanted for non-repudiation over the digest specifically,
  the `BatchSigner` injection is the path — deferred as unnecessary.)

## ✅ Milestone 4 — Retire `AllowAll` engine default (DONE — `125eabc`)

- [x] Engine default flipped `AllowAll`→`DenyAllResolver`; `DenyAll` now also denies `verify_on_apply` (fail-closed inbound).
- [x] Audited: app (`jazz/mod.rs:1577`) + server (`main.rs:233`) install real resolvers unconditionally; nothing relies on `AllowAll` in production.
- [x] Builds green (app + server); codec test passes; tests opt into `AllowAll` explicitly.

## ◑ Milestone 5 — Relay/sync abuse caps (1/4 — `dc5bae2`)

Blind relays accept authenticity-valid-but-*unauthorized* rows (rejected at members, but
stored/forwarded = a spam/DoS sink, since a relay holds no biscuit to authorize). Add
protective caps at the sync/relay layer so a relay isn't an unbounded sink.
- [x] **Rate limiting** per peer — fixed-window inbound batch budget at `process_from_client` (50k/s, generous; only floods trip it). *(bytes/sec + backpressure: later.)*
- [ ] **Per-identity storage quota** — max DB size/value-count per identity; reject or evict over-quota writes. *(needs per-owner storage accounting — app-resolver layer.)*
- [ ] Optional: require a **minimal cap to relay at all** (drop pure-forgery spam at the relay edge, before storage).
- [ ] Fair-share across identities so one identity can't starve others on a shared relay.

**Cap-model note (confirmed):** grantable caps today = **Owner** (`owns` =
read/write/delete/admit/rotate_dek) · **Member/Reader** (`reads`) · **Relay**
(`replicate` = blind store-and-forward = the sync-relay allowance). There is **no
"invite cap"** bundling relay-allowance **with per-grant rate-limit/quota** —
rate-limiting (M5) is **global per-peer**, not carried in a biscuit cap. A
`relay(quota)` cap primitive (relay allowance + embedded rate/size limits, grantable
per identity) is a **future enhancement** (extends M5 + the cap vocabulary).

## ☐ Milestone 6 — Identity creation UX (no auto-default + "+" grid)

Today onboarding **auto-creates** the human's default identity. Change: onboard
establishes only the **human identity** (`type=human`, the person); **additional
identities are created on demand** via a **"+" grid item** on the identities list.
- [ ] Backend: a `create_identity(name, type)` IPC — mint genesis biscuit + DEK +
  self-keyshare + stamped `identities` row (factor the onboard path into a reusable fn).
- [ ] Frontend: a "+" card in the identities grid → name → create → route to it.
- [ ] Keep the human identity auto on onboard (the person must exist); "+" creates
  group/aven identities.

---

## Architecture reference (terse)

- **Write:** mint owner-binding `Sign_author(value_id ‖ owner)` → row metadata; data cell-sealed under the identity DEK.
- **Apply (every peer):** `verify_on_apply` — value_id matches, binding sig valid, owner immutable, author holds the per-kind cap.
- **Outbound gate:** `may_sync` = biscuit caps; resolves row→identity via the gate-enforced `owner`.
- **Revocation:** re-mint biscuit + rotate DEK (forward) + evict on reconnect (M2). Backward plaintext is not recallable — accepted (no E2EE system can).
- **Out of scope:** content-addressed ids; forward-secret ratchet / sender-keys.
- **History:** the server-rooted avenCEO control identity, the `aven-caps` extraction, and the biscuit sync gate shipped via the auth-into-server merge (design in git history).

## Threat model & residual slippage

**Enforced E2E, relay-proof (✅):** content confidentiality (AEAD under the identity
DEK), write-authorization (per-kind caps verified on every peer), and relabel-resistance
(write-once owner). A relay can't forge (forgeries die at the first member) and can't read
(no DEK).

**Residual slippage — known boundary:**
- **Accepted (cryptographically unsolvable):** *backward reads* — a member who already
  decrypted keeps that plaintext after revocation. No E2EE system solves this.
- **Pending (roadmap):** *eviction* — a revoked peer keeps local rows until **M2**;
  *engine default `AllowAll`* — enforcement depends on resolver install until **M4**.
- **Inherent:** *blind-relay spam* — authenticity-valid-but-unauthorized rows are stored
  by relays (rejected at members; no breach, but a sink) → **M5** mitigates; *member DEK
  leak* — a member can leak the DEK out-of-band (unavoidable).
- **Out of scope today:** *metadata privacy* — the `owner` id, table name, row size, and
  timing are **plaintext** to relays (only data cells are sealed). The ownership/social
  graph is visible. If metadata privacy is required, it must be designed in (new milestone).

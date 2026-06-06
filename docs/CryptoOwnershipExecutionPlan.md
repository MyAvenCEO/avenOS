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

## ◑ Milestone 2 — Revoke DONE (forward-secrecy complete); eviction-notice = optional cleanup

**Revoke is fully implemented and security-complete** (verified in code):
- [x] Re-mint the identity biscuit **excluding** the revoked peer (`mod.rs:3017`, `caps.rs:376-387`).
- [x] **Rotate the DEK** to a new version, re-wrapped to remaining members only (`mod.rs:3012,3024-3045,3069`).
- [x] **Delete the revoked peer's keyshare rows** so honest peers drop them (`mod.rs:3077-3093`).
- ⇒ The revoked peer is gated out + never receives v+1 → **no future reads. Forward secrecy ✅.**

The **only** remainder is a best-effort **eviction notice** to drop the OLD, *already-decrypted*
rows from an honest revoked peer's local store. **Not security-critical** — the threat model
accepts backward reads as cryptographically unsolvable (the peer already saw that plaintext).
- [x] **Scaffolded** (`c1a27c5`): `SyncPayload::EvictResource { resource }` + **safe logged-only
  receiver** (a stray/forged notice can't delete data) + tracer/variant_name arms; aven-db green.
- [ ] **Completion (focused, needs live revoke→evict test):** sender = the revoke flow emits
  `EvictResource(identity_urn)` to the revoked peer; receiver = resolver-enumerate the resource's
  **data** rows → `delete_with_metadata(Hard + NoSync)` (local-only, no false tombstone).
- **3 data-loss traps the design must avoid** (found in code): (1) the keyshare hard-delete NULLs
  its own id columns → can't post-hoc detect "my keyshare for X was deleted"; (2) "has X's data
  but no keyshare" *also* matches blind relays/transit peers holding ciphertext → never blanket-
  drop; (3) a member mid-sync (data before v+1 keyshare) looks transiently revoked. The
  **revoke-direct** payload (admin→revoked-peer, drop DATA rows only) sidesteps all three.

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

## ◑ Milestone 5 — Relay/sync abuse caps (3/4 — rate `dc5bae2` + max-size `e5fce0e` + quota `c212819`)

Blind relays accept authenticity-valid-but-*unauthorized* rows (rejected at members, but
stored/forwarded = a spam/DoS sink, since a relay holds no biscuit to authorize). Add
protective caps at the sync/relay layer so a relay isn't an unbounded sink.
- [x] **Rate limiting** per peer — fixed-window inbound batch budget at `process_from_client` (50k/s, generous; only floods trip it). *(bytes/sec + backpressure: later.)*
- [x] **Max db-value size** — 64 MiB per inbound row (`e5fce0e`).
- [x] **Per-identity storage quota** — 10 MiB/identity on the aven-node (`c212819`). `CapabilityResolver::quota_for(proof)→(key,limit)`; engine does distinct-row accounting (no re-sync double-count) and **rejects** (withholds, never deletes) over-quota writes.
- [x] **Fair-share** — the per-identity 10 MiB bound means one identity can't starve others on a shared relay.
- [ ] Optional hardening: require a **minimal cap to relay at all** (drop pure-forgery spam at the relay edge, before storage).

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
- [x] Frontend "+" + typed `create_identity(name, type)` done (`517fcef`; inline input `1d61f39`).
- [x] **Superseded:** no auto human identity — onboard now tolerates **zero** identities
  (`f0fa682`); the user creates one (+ New human/aven) or is added via caps after the invite.

---

## ☐ Milestone 7 — Federated avens: per-aven default identity, registry-via-identities, invite cap

**Model (decided):** no global network. Many independent **avens**; each = an **aven-node**
that enforces its own rights + **one default identity named after itself** (avenCEO / avenMAIA
/ …, from the aven's config/seed). The **`identities` list IS the registry** (no new table):
readable by every invited member of that aven, writeable only on one's **own** row (already
enforced by owner-binding + write-once). A device can belong to many avens, each granting its
own independent allowance. Per-identity Owner/Member/Relay sharing stays as-is (orthogonal).

- [x] **(1) Generalize the `avenCEO` name** → per-aven configured name (`AVEN_SERVER_NAME`;
  `a5cdaa6`). Deterministic id stays per-seed; aven-node row authoritative.
- [◑] **(2) Shared-read of the `identities` registry** — rides on the blind relay: an
  identity replicated to the aven is forwarded to every connected member, so the directory
  syncs without new resolver code. **Empirical fork-check pending** (create on A → see on B);
  own-row-write already enforced by owner-binding + write-once.
- [x] **(3) per-identity 10 MB quota** on the aven-node (`c212819`) — the bounded relay. (The
  `replicate` grant carries the role; the 10 MB is the aven's automatic per-identity policy,
  not a per-cap setting — simpler + federated.)
- [x] **(4) "Sync & Backup" in the share screen** (`3724d8e`) — the `replicate` grant relabeled
  + bound described (en+de). Grant/IPC/gate were already wired; this names the role.

---

## ◑ Milestone 8 — Sharing resilience + caps transparency (code done — pending live re-verify)

Live testing surfaced dead-end errors + missing UI. **Done & on `main`:**
- **B1** make `peers.device_label` nullable — fixes `missing column device_label` (`b0764de`).
- **B2/B3** re-hydrate vault shell on relay-forwarded peer-sync — fixes `subject_not_owner` +
  `missing_dek_cached` "only after restart" (`1214c45`).
- **G1** remove Capabilities sub-tab (`a247ebd`). **H1/H2** cap badges + descriptions (`9a6013a`),
  with the relay's quota+rate_limit reported as **biscuit-derived caps**, not synthesized (`f0acf12`).
- **D1** real peer names — drop hardcoded "Replication Server" (`41394bb`).
- **B4** auto-retry transient shell errors so add/revoke/read self-heal (`9de9d06`).
- **#3** (Member reads): audited — `authorize_read_delegated` is correct; the failure was the
  stale biscuit → **fixed by B2/B3**. **E1** (avenCEO display): `add_member` ships the avenCEO row
  via the member's `reads` grant + re-announce → **displays once B2/B3 re-hydrates**.

⇒ #3 + E1 need a **live re-verify** (manual). Original punch-list below for reference.

### Correctness (the brittleness)
- [ ] **B1 — `missing column device_label` on grant** — the grant/publish-profile path
  reads/writes a stale `device_label` column on a table that no longer has it (post-remodel).
  Find + fix the reference; profile/device-label now lives on the peer's own identity row.
- [ ] **B2 — Member (`reads`) can't read/write** — Talk shows `identity_acc:subject_not_owner`;
  a `reads`-member's cap isn't authorizing read (and write should stay denied, but read must
  work). Audit `identity_acc::authorize` for the `reads` grant on data tables.
- [ ] **B3 — `missing_dek_cached:<id>|<ver>`** — after DEK rotation (revoke), a device lacks
  the DEK for the current version: its v+N keyshare isn't hydrated into the live shell. Re-hydrate
  on grant/revoke + on keyshare arrival; never dead-end on a transient missing DEK.
- [ ] **B4 — Resilience pass** — add/revoke shouldn't leave the UI in a broken state; surface
  recoverable states (syncing/decrypting) instead of raw error strings.

### Transparency / UX
- [ ] **D1 — Real peer names** — show each peer's name (Admina / Bobo) in "Who has access",
  not a hardcoded "Replication Server".
- [ ] **E1 — Display avenCEO registry** on member devices (M7-2 sync + display).
- [ ] **G1 — Remove the "Capabilities" sub-tab** (redundant — caps are badges per row now).
- [ ] **H1 — SYNC role cap badges** — render its real caps (replicate + **10 MB** + **rate
  limit**) as badges, like READ/WRITE.
- [ ] **H2 — Per-cap human-readable description** — collapsible "how this cap works under the
  hood" for every badge → 100% always-on transparency of effective caps.

---

## M9 — Group-owned values (per-group cryptographic ACLs)

**Problem.** One DEK *per identity* → a keyshare is all-or-nothing. The SYNC peer needs the
avenCEO DEK to read the registry, but that same DEK decrypts **everything avenCEO owns**.
The read-grant scope is only an authorization *filter*; the **key is the real boundary, and
it is too coarse**. No per-collection/per-row cryptographic isolation.

**Model (Jazz/CoJSON group-extension, rebuilt on our owner-binding).** The **Group** is the
ownership primitive. A Group = { `group_id` (UUID), per-version DEK, biscuit (members/caps),
optional **parent** }. A row's `owner` is a **group_id**. Access = holding the group's DEK —
the key is the boundary, at whatever granularity you choose.

- **Default = the identity group.** An identity's default `group_id` **is** the identity
  UUID — so every existing row (`owner = identity_id`) is already "in the identity's default
  group," DEK unchanged. **Zero migration for the common path; 100% backward-compatible.**
- **Extension (cheap granularity).** A finer group **extends** a parent: its biscuit
  delegates to the parent group, inheriting the parent's members. A value's own group costs
  ~one delegation link, not N per-member re-seals. Default inherits admin/read for free;
  break out only where the access pattern differs.
- **2-level keys.** Group key sealed to each member; value DEKs sealed to the group key.
  Add a member → one seal to the group key → reaches every value the group owns.
- **Granularity is a knob:** everything-in-identity-group (today) → per-collection group →
  per-row group. Same primitive, cost dial per need.
- **Forward secrecy preserved:** per-group DEK rotation on member-remove (as today).

**Phases (each ships value; nothing breaks):**

- [ ] **M9-1 — Group primitive (foundation, additive).** `aven-caps`: deterministic
  `derive_subgroup_id(parent,label)`; the registry-group id constant; group DEK + keyshare
  reuse the per-owner machinery; `attenuate_extend_group` (biscuit delegation to a parent).
  Unit tests. **No live-flow change** — the default group_id stays the identity id.
- [ ] **M9-2 — Registry group (first real split).** Mint avenCEO with a `registry` sub-group
  (identities/peers) that **extends** avenCEO; registry rows sealed under `DEK_registry`. The
  SYNC grant keyshares **`DEK_registry` only** → the SYNC peer is **cryptographically** blind
  to any avenCEO data (not merely authorization-filtered). Fresh-mint (wipe); no row
  migration.
- [ ] **M9-3 — Per-collection groups.** Each collection (messages/todos/files) owned by its
  own group extending the identity group; sharing a collection = sharing its group key.
  Default stays the identity group (backward-compatible).
- [ ] **M9-4 — Per-row groups (opt-in).** Per-row group for max isolation where needed.

**Delivers:** per-row crypto granularity becomes a **config choice**; the SYNC/registry
boundary becomes **key-enforced**, not assumed; the default path is unchanged.

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

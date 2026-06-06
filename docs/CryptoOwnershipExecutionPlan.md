# Ownership & Caps — Master Plan (E2E cryptographic, decentralized, enforced)

> **The single master plan.** The one canonical plan for value ownership,
> capabilities/roles, and revocation. It **replaces and deletes** the prior overlapping
> drafts — `SparkRootedOwnershipPlan.md`, `PerValueOwnershipPlan.md`,
> `AuthIntoServerPlan.md`, `ServerRootedAvenCeoPlan.md`, and board ideas `0009`/`0010` —
> with their still-relevant substance folded in here. Backed by a full six-part audit of
> the `aven-db` (groove) engine + the in-app gate + `aven-caps` crypto.
>
> **Delivered baseline (already on `main`; this builds on it):** the server-rooted
> avenCEO control spark, the extracted `aven-caps` crate, and the biscuit sync gate —
> shipped by the auth-into-server merge. Their design now lives in git history + the code.
>
> **North star:** every value is **private by default** and owned by a **spark (group)**,
> bound by a **signed owner-binding** carried with the value; **every edit is signed and
> verified on apply by every peer** (no client/server split — `aven-server` is just an
> always-on peer); per-row caps are **biscuit-delegated**; sharing happens **only via
> explicit caps**; revocation is **caps + sync-eviction** (backward reads are not
> cryptographically recallable — accepted). No mutable column is ever the source of
> ownership truth.

---

## 0. The decisions (locked)

1. **Private by default.** Every value is private to its owning spark — there is **no
   ambient or default read/write access anywhere**. Access exists **only** via an
   explicit biscuit cap (+ a DEK keyshare for reads). Deny-by-default is the posture at
   every gate; there is **no `AllowAll` in production**.
2. **Root owner = the spark**, not a device, not a per-value key. (Folds key rotation
   into the spark's membership machinery.)
3. **Ownership mechanism = signed owner-binding over UUIDs (Option B), final.**
   Content-addressed ids are **out of scope** — not deferred, not planned. B is the
   ownership model, full stop.
4. **One source of truth for ownership = the signed binding.** There is **no `spark_id`
   column** — ownership is the immutable, signed `owner_spark` header field; the
   immutable header enforces it, so no mutable copy exists (§4).
5. **Enforcement runs on inbound apply**, via one new resolver hook, installed on
   **every peer** (there is no client/server split — the `aven-server` is just an
   always-on peer) → E2E, relay-proof.
6. **Greenfield — no migration.** We build on a clean DB (the `.avenOS` folder is
   wiped). Owner-binding + signatures are **first-class in the row model from day one** —
   no additive workarounds, no format-break or migration concerns.
7. **Revocation = caps + sync-eviction, not backward crypto.** Clawing back already-read
   plaintext is **not cryptographically enforceable in a decentralized system — and we
   accept that.** Instead: remove caps + rotate the DEK (deny *future* authz/reads) and
   **evict the data at the sync layer** — any sync point auto-deletes now-unauthorized
   values from a peer on (re)connection (§6).

---

## Implementation status (current — branch `worktree-feat+aven-auth-into-server`)

**The core is implemented, live-validated, and committed:**
- ✅ `aven-caps`: owner-binding + edit-sig primitives + **`Admit`/`RotateDek` cap ops** + wire codec (24 tests).
- ✅ **verify-on-apply on every peer** (device + always-on relay server) — relay-proof.
- ✅ **Owner-binding stamped on every write** (create/update/delete) across app + server + the bootstrap/default-spark path.
- ✅ **Deny-by-default**: any spark-scoped row without a valid binding is rejected on apply. Per-kind caps (`peers→Admit`, `keyshares→RotateDek`), **no table exclusions**.
- ✅ **Live-validated**: onboarding, grants, data create/edit, **and user-spark sharing** all sync under deny-by-default.

**`may_sync` clarified:** it **is** the biscuit-caps gate (not legacy). What's legacy is the **`spark_id` column** it reads to resolve a row → its spark (`object_spark_ids`). That column is currently **gate-enforced to equal the binding** (the immutable-check rejects divergence) → a derived index, not an independent source. The binding is already the authoritative owner.

**Scoped follow-ups (each a real, separately-tested feature):**
1. **`spark_id` removal / pure-caps gate (§4).** Make the gate + hydration resolve row → spark from the **binding** (authenticated), retiring the mutable column. Needs the engine read path to expose the binding (metadata-aware). End-state: the gate is *purely* biscuit-caps + the signed binding — no mutable column anywhere. **← doing this first.**
2. **Eviction (§6) — eviction-notice protocol.** Self-eviction can't trigger alone (a revoked peer is gated out → never learns it's revoked). Correct design: a **peer-specific eviction notice** (sender → revoked peer on reconnect: "drop spark X") + receiver-side local delete. **Not** a global tombstone (those would propagate a false delete).
3. **Edit-sig over `batch_digest` (Phase 1).** Optional hardening — the owner-binding already authenticates every writer and AEAD authenticates the data. Needs a persisted-`SealedBatchSubmission` codec change + signer injection.

---

## 1. Ground truth — what the engine enforces today (audit)

Verified across `aven-db` + app + `aven-caps`:

| Property | Today | Anchor |
|---|---|---|
| Object identity | random `Uuid::now_v7()`, owner not in id | `object.rs:37` |
| Transaction signing | **none** — `SealedBatchSubmission` has BLAKE3 `batch_digest`, no signature | `batch_fate.rs:225-236`, `:232` "Authorities no longer validate transactions" |
| Row digest coverage | hashes branch, parents, data, `updated_at`, `updated_by`, metadata — **`updated_by` is unsigned data** | `row_histories/codecs.rs:35-74` |
| Inbound apply | **wide open** — rows persist with no auth/signature check | `sync_manager/inbox.rs` apply → `row_histories/mutations.rs:~298` |
| Outbound gate | `may_sync` withholds only; resolves owner from the **mutable `spark_id` column** | `capability.rs:61`, `biscuit_resolver.rs:56` |
| `RowPolicyMode` / `policy.rs` | **dead** — `PermissiveLocal` only; evaluator hardcoded `passed:true` | `query_manager/types/policy.rs`, `query_manager/policy.rs:562-574` |
| Storage | **owner-agnostic** opaque KV; `data` is **app-encrypted ciphertext** (groove is blind) | `storage/*`, `row_format.rs` |
| Relay/forwarding | **pass-through**, no proof chain → any hop can forge | `sync_manager/forwarding.rs` |
| DEK rotation / revoke | rebuild biscuit + bump DEK v→v+1 + re-keyshare remaining + delete revoked shares — **forward-only authz, NOT forward-secret reads** | `caps.rs:354-376`, `jazz/mod.rs` revoke IPC |

**Threat reality:** safe against honest-but-buggy peers; **not** against a forger or a
relabel-to-steal. That is what this plan fixes.

## 2. Target architecture — the E2E flow

```
WRITE (author device, app)
  ├─ owner-binding: sig_C( value_id ‖ owner_spark ) + biscuit cap C→spark   → row header (immutable, digest-covered)
  ├─ edit signature: sig_C( batch_digest ‖ author_did )                      → SealedBatchSubmission.author_sig
  └─ data: cell-sealed under spark DEK (already today)                       → row.data (ciphertext)
        │
WIRE (additive: optional proof fields travel with the batch/row)
        │
APPLY (every peer, before persist)
  └─ CapabilityResolver::verify_on_apply(subject, op, res, proof):
        1. verify author edit-signature over batch_digest
        2. verify owner-binding signature + biscuit chain → owner_spark root
        3. authorize(op, table, value_id, author_did)  [spark caps + per-row grants]
        → Allow → persist  |  Deny → reject  |  Pending → defer (vault not hydrated)
        │
GATE (outbound): may_sync withholds to unworthy peers; on revocation, pushes deletes (eviction)
        │
READ (app): decrypt cell under the spark DEK the member holds (caps gate the keyshare)
```

Crypto + authorization live in **`aven-caps`** (one source, shared by every peer —
interactive or always-on). The engine only gains the inbound hook + carries opaque
`proof` bytes.

## 3. The two cryptographic checks (in `aven-caps`)

- **Owner-binding (A):** `owner_binding = { owner_spark, author_did, biscuit:<C's
  create/write cap chained to spark root>, sig:Sign_C(value_id ‖ owner_spark) }`.
  Authority roots in the spark; exercised by the creator's key → any delegated writer
  can create spark-owned values **without** the spark root key.
- **Signed edit (B):** `Sign_author(batch_digest ‖ author_did)`; verified on apply +
  authorized via the biscuit chain. Binds the today-unsigned `updated_by` to crypto.

New `aven-caps` functions (reuse existing `authorize`, `mint_genesis_spark`,
`attenuate_*`, `derive_kek_x25519`): `mint_owner_binding`, `verify_owner_binding`,
`sign_batch`, `verify_signed_batch`, `authorize_signed_edit` (wraps `authorize` +
both verifications).

## 4. Single source of truth for ownership — `spark_id` is gone

**There is no `spark_id` column.** Ownership lives in the row's **immutable, signed
`owner_spark` header field** — set once at creation, covered by the digest, verified on
apply. The immutable header *already* enforces it, so there is no second mutable copy to
demote, index, or keep in sync. The gate's ACL is read **directly from that
authenticated field**; the old `build_object_spark_id_map`-over-a-mutable-column is
replaced by reading the header. One authenticated owner field, full stop.

## 5. Per-row caps + roles (folds board `0009` part 1)

The spark root delegates **`grant(did, op, value_id)`** (or prefix) via biscuit
attenuation — full per-row granularity below the single spark root. Requires the
**authorize-DSL generalization** (honor any delegated `right(op,prefix)` for a
non-owner, not just `reads`/`replicate`). **Roles** stay UI labels = recognized
canonical cap-bundles (`Owner/Member/Relay`), with **"Custom"** as the honest
fallback; UI ≈ Datalog facts, defined once in `aven-caps`.

## 6. Revocation — caps-driven sync-eviction (folds board `0009` part 2)

**Premise (accepted):** in a decentralized system you cannot cryptographically claw
back plaintext a peer already decrypted — **no** E2EE system can (Signal/Matrix
included). So we **don't try.** Revocation has two honest halves, both forward:

1. **Deny future authz + reads.** Re-mint the spark biscuit without the revoked DID
   (`rebuild_spark_biscuit_excluding`) + rotate the DEK v→v+1 + re-keyshare only the
   remaining members + delete the revoked peer's keyshares. The revoked peer can't pass
   the gate or read anything sealed under v+1. *(Exists today — `caps.rs:354-376` + the
   revoke IPC.)*
2. **Evict the data at the sync layer.** The gate already decides per (subject, op,
   resource); extend it so that on a revoked peer's **next connection to any other
   peer**, the sync point **pushes deletes/tombstones** for every resource the peer no
   longer holds a cap for, and the honest peer removes its local copy. Reuses the
   existing delete-sync plumbing. **Eviction-on-reconnect is sufficient** — no
   forward-secret KDF ratchet needed.

**Inspired by Matrix/Signal, kept light:** we keep their *trigger* — **any membership
change ⇒ rotate the group key** (megolm), so new data is unreadable to the removed
member — and deliberately **drop** the heavy double-ratchet / sender-keys machinery,
which buys forward-secrecy-against-future-key-leak, a property we are not paying for.

**Honest limit (document in UX):** a *malicious* peer that copied plaintext before
revocation, or that never reconnects, keeps that copy. That is an unavoidable property
of decentralization, not a bug. "Revoke" = deny future + evict from honest peers +
accept the irreversible past. *(Optional later: a biscuit revocation-ID edge-gate for
instant authz cutoff before re-mint propagates.)*

## 7. Execution phases (each ships value; additive unless noted)

- **Phase 0 — Immutable owner + guarded move (no format change).** Authorizer rejects
  any update that changes a value's owner; "move between sparks" becomes an explicit
  doubly-authorized op. Kills relabel-to-steal immediately.
  *Touch:* `biscuit_resolver.rs`, app write IPCs.
- **Phase 1 — Signing identity + sign edits.** Thread a signing key through
  `WriteContext` (`query_manager/session.rs`); `sign_batch` at seal
  (`runtime_core/writes.rs` seal path); add **optional** `author_sig`/`author_did` to
  `SealedBatchSubmission` (`batch_fate.rs:225-236`, additive serde). New `aven-caps`
  signing fns.
- **Phase 2 — Verify-on-apply (the core enforcement).** Add
  `verify_on_apply(subject, op, res, proof) -> CapDecision` to `CapabilityResolver`
  (`capability.rs:61`); call it at the inbox apply point **before**
  `mutations.rs:~298`; carry `proof` as optional wire bytes (`sync_manager/types.rs`,
  additive). Implement in `biscuit_resolver.rs` via `aven-caps`. **Install the same
  resolver on every peer** (the always-on `aven-server` included) → relay-proof E2E.
- **Phase 3 — Signed spark-owner binding (Option B) as SSOT.** `mint_owner_binding` at
  create; write `owner_spark` + binding as **first-class immutable header fields**
  (digest-covered); the gate's ACL reads that field directly; **no `spark_id` column**
  (§4).
- **Phase 4 — Per-row grants + roles.** `grant(did,op,value_id)` minters +
  authorize-DSL generalization + role-bundle matching in `spark_cap_report`
  (board `0009`).
- **Phase 5 — Revocation = caps + sync-eviction.** Re-mint biscuit + DEK rotate on
  membership change (exists); extend the gate to **push deletes to a now-unauthorized
  peer on reconnect** (eviction). Optional: biscuit revocation-ID edge-gate (§6).

*(Out of scope — content-addressed ids: not planned. Option B is the final ownership model.)*

## 8. Per-file change map (consolidated from the audit)

**`aven-db` (engine):**
- `capability.rs:61` — add `verify_on_apply` to the trait + a `CapError`/decision; **flip default posture to deny** (retire `AllowAllResolver` in production) **(core)**
- `sync_manager/inbox.rs` (apply point) — call `verify_on_apply` before persist; reject/defer **(core)**
- `sync_manager/types.rs` (`SyncPayload`/`StoredRowBatch`) — carry `owner_binding` + `author_sig` as first-class fields
- `batch_fate.rs:225-236` — `author_sig` + `author_did` on `SealedBatchSubmission`
- `query_manager/session.rs` (`WriteContext`) — carry the signing key
- `runtime_core/writes.rs` (seal path) — sign batch on seal
- `row_histories/{types,codecs}.rs` — `owner_spark` + `owner_binding` as **first-class system fields**, covered by the digest (greenfield: define them in the row model from the start — no migration, no additive workaround)

**App (`app/src-tauri`):**
- `biscuit_resolver.rs` — implement `verify_on_apply`; Phase-0 immutable-owner check; read owner from binding **(core)**
- `spark_sync.rs` / `jazz/mod.rs` (`build_object_spark_id_map`) — rebuild ACL from the authenticated owner field; demote `spark_id` **(Phase 3)**
- `jazz/mod.rs` write/create IPCs — mint owner-binding + sign at write **(Phase 1/3)**
- revoke IPC — ratchet step + GC old DEKs **(Phase 5)**

**`aven-caps`:**
- `caps.rs` — `mint_owner_binding`, `verify_owner_binding`, `sign_batch`, `verify_signed_batch`, `authorize_signed_edit`; authorize-DSL generalization; role-bundle matching **(new, DRY)**
- `crypto.rs` — epoch DEK derivation from `ratchet_state`; reuse `derive_kek_x25519` **(Phase 5)**

**Always-on peer (`aven-server` — same engine, serve mode):**
- install the same `verify_on_apply` resolver; `aven_ceo.rs` mint/sign reuse `aven-caps` **(Phase 2)**

## 9. Explicitly out of scope

- **Content-addressed ids** — *not planned.* Ownership is the signed binding (Option B),
  final. We decided against the engine-wide format break; UUIDv7 ids stay.
- **Data migration** — none. Greenfield clean DB (`.avenOS` wiped); the row model carries
  owner-binding from the first write.
- **Forward-secret ratchet / sender-keys** — dropped (§6); sync-eviction +
  DEK-rotate-on-membership is the revocation model.

## 10. Risks / open decisions

- **Where verify lives** — resolver `verify_on_apply` hook (chosen) vs a deeper engine
  gate. Chosen keeps crypto in `aven-caps` (DRY) + runs identically on every peer.
  Confirm the inbox call site carries enough context (proof bytes + author_did).
- **Performance** — sign per batch, verify per inbound batch. Batch-level amortizes;
  measure.
- **Relay/E2E** — every peer must *verify*, not just gate; a pass-through relay without
  verify is point-to-point only.
- **Eviction reach** — sync-eviction only removes data from **honest, reconnecting**
  peers; a malicious or never-reconnecting peer keeps copies (accepted, §6).
- **Version skew** — once first-class fields exist, all peers must run the matching
  build; a greenfield deploy makes this trivial, future upgrades need care.

## 11. Definition of done

E2E on a clean DB: every value is **private by default** (no read/write without an
explicit biscuit cap + keyshare); a forged or relabeled inbound batch is **rejected on
apply** by every peer (interactive and always-on alike); a delegated writer can create spark-owned
values verified end-to-end; a revoked member is cut off from **future** authz + reads
**and its local copies are evicted on reconnect**, with backward-irreversibility
documented. Ownership has exactly **one** authenticated source (the signed binding);
there is no `spark_id` column. All crypto/authorization is single-sourced in
`aven-caps`. Content-addressed ids are not part of the design.

---

## 12. The identities remodel (clean-slate vocabulary + domain unification)

**Decision (locked):** the core primitive **`spark` → `identity`**, and the
owner field **`spark_id` → `owner`**, everywhere (backend + frontend). **`humans`
and `sparks` unify into one typed `identities` table.** **Clean slate, fresh DB,
no migration** — the manifest is rewritten and `.avenOS` is wiped; the entire
lens/snapshot/registry machinery is dropped (moot on greenfield).

**Why a rename, NOT a rewrite:** the engine (`groove`/`aven-db`) is
schema-agnostic — it has **zero** "spark" vocabulary (it deals in
tables/rows/`ResourceCoord`/`CapabilityResolver`/biscuits). "Spark" lives only in
the **app + `aven-caps` + schema + frontend**. A rewrite would throw away the
validated crypto-ownership core for a vocabulary change. This is a
**compiler-checked mechanical rename + a two-table merge**, ~1,200 sites, *atomic*
(red until 100% done — execute as one focused push).

### New model — `identities` replaces `humans` + `sparks`
| column | type | notes |
|---|---|---|
| `id` | uuid | the identity id (was `sparks.spark_id`) |
| `type` | enum `human` \| `aven` | the kind of identity |
| `owner` | uuid | owning identity (self for a root identity); replaces `spark_id` on every data table |
| `name` | text | display name (`sparks.name` / `humans.first_name`) |
| `username_slug` | text? | human-only |
| `my_devices` | uuid[]? | human-only |
| `issuer_pubkey_b64` | text | biscuit issuer pubkey |
| `genesis_b64` | text | biscuit genesis |
| `current_dek_version` | bigint | DEK epoch |
| `created_at_ms` | bigint | |

A **Human identity** is a person (absorbs the old `humans` profile fields); an
**Aven identity** is an aven/agent (e.g. avenCEO, agent identities). Every identity
carries a biscuit (it is an owner). Profile fields sync within the identity's
read caps (as `peers.account_name` does today).

### Rename map (mechanical)
- `spark` → `identity` · `spark_id` → `owner` · `sparks` table → `identities` (+`type`, +folded human fields) · `humans` table → removed
- `spark_acc` → `identity_acc` · `spark_sync` → `identity_sync` · `BiscuitSpark` → `BiscuitIdentity` · `mint_genesis_spark` → `mint_genesis_identity` (and siblings in `aven-caps`)
- routes `/sparks/[sparkId]` → `/identities/[id]` · `Spark*.svelte` → `Identity*.svelte` · `jazzStore('sparks')` → `jazzStore('identities')`
- avenCEO = an `aven`-typed identity

### Atomic execution order (one push to green)
1. **Schema manifest** — define `identities` (merge + `type`), `spark_id`→`owner` on data tables, drop `humans`/`sparks`; delete migration snapshots/registry.
2. **`aven-caps`** — rename spark→identity primitives.
3. **App backend** — `spark_acc`/`spark_sync`/`jazz`/`jazz_engine`/`biscuit_resolver`/`peers`/`aven_ceo`; fold `humans` hydration into human-typed identities.
4. **`aven-server`** — `aven_ceo` + `main`.
5. **Frontend** — routes, components, stores, i18n.
6. **Build** (`cargo` + `svelte-check`) → green → wipe → live test (onboard, share, spark-scoped DB viewer).

**Status:** spec locked; execution pending as one focused push. The validated
private-by-default core + the spark-scoped DB viewer + write-once owner guard are
committed and are the clean checkpoint this builds on.

### 12.1 First-principles audit — *eliminate*, don't just rename

Per the compact/first-principles rules this is a **consolidation**, not a vocabulary
pass. What we **delete** (root-cause, not symptom):

1. **Two tables → one** (`humans` + `sparks` → `identities`). The dual-table split is
   the duplication: "a person" and "a spark" were two representations of *an owner*.
   One typed table = **SSOT for who owns/acts**; the humans↔spark reconciliation
   (separate profile vs. owner records) disappears.
2. **Legacy migration *snapshots* only** (NOT the mechanism). The new `identities`
   manifest is a **fresh baseline**; the migration/lens *system* stays intact (it is
   reusable infra for *future* schema evolution — ripping it out would force a wipe
   on every future change). Drop only the dead evolution chain of the abandoned
   schema: `migrations/snapshots/before-{account-name,files,peers-spark-id}.json` +
   their `registry.json` entries (they reference dropped `humans`/`sparks` tables and
   nobody migrates from them on a clean-slate wipe). **Keep** the `generate_lens` /
   load-previous-manifest / snapshot-stamping paths in `schema_manifest.rs`.
3. **Shim modules.** `app/src-tauri/src/spark_acc.rs` (17 lines) and `spark_sync.rs`
   (74) are thin re-export/glue over `aven-caps`. Where they only re-export, **delete
   and import `aven-caps` directly** (DRY: one source). Otherwise fold into a single
   `identity` module — no per-concept shim pair.
4. **`spark_id` column → the `owner` header.** One authenticated owner field; the
   gate/hydration read it. No mutable per-table duplicate of ownership.

Net: the remodel should *remove* code, not add it. Target: fewer lines after than
before, despite the new `type` field.

### 12.2 Complete file map (every site)

**Schema — SSOT (`libs/aven-schema/`):**
- `schema.manifest.json` — rewrite: `identities` (merge + `type`, +human fields nullable), `spark_id`→`owner` on `messages`/`todos`/`files`/`peers`/`keyshares`, drop `humans`+`sparks`.
- `migrations/snapshots/before-*.json` + their `registry.json` entries — drop (dead chain for dropped `humans`/`sparks`). **Keep the migration mechanism** (§12.1.2).

**`aven-caps` — crypto/caps SSOT (`libs/aven-caps/src/`):**
- `caps.rs` (132) — `spark`→`identity` across genesis/biscuit/`BiscuitSpark`→`BiscuitIdentity`/`mint_genesis_spark`→`mint_genesis_identity`; `AccOp` unchanged.
- `ownership.rs` (45) — field `owner_spark`→`owner` (binding already says "owner").
- `crypto.rs` (27) — `spark_urn`→`identity_urn`, keyshare AAD wording.
- `lib.rs` (1).

**App backend (`app/src-tauri/src/`):**
- `jazz/mod.rs` (360) — the bulk: IPCs, owner-binding stamping, hydration, `self_identity_dir`, the on-disk path (§12.3).
- `jazz/jazz_engine.rs` (118) — hydration; `build_object_spark_id_map`→`build_object_owner_map`; default-identity bootstrap; **fold `humans` profile into the human-typed identity** row.
- `biscuit_resolver.rs` (32) — `spark_id`→`owner`; `object_spark_ids`→`object_owner`.
- `spark_acc.rs` (2) + `spark_sync.rs` (24) — eliminate or rename→`identity_*` per §12.1.3.
- `peers.rs` (14) — `peers` table stays (roster of devices), `spark_id`→`owner`.
- `schema_manifest.rs` (5) — table-name consts only; **KEEP** the migration-load/lens paths (future evolution, §12.1.2).
- `network.rs` (4), `lib.rs` (3), `crypto.rs` (1).

**Always-on peer (`libs/aven-server/src/`):**
- `aven_ceo.rs` (40) — avenCEO = an `aven`-typed identity.
- `main.rs` (6) — `derive_identity_db_dir`: **the folder rename** (§12.3) + docs.

**Frontend (`app/src/`):**
- `lib/sparks/` → `lib/identities/`: `SparkMembersPanel.svelte` (90), `SparkTalkPanel.svelte` (27), `SparkMessageAttachments.svelte` → `Identity*`.
- `routes/sparks/[sparkId]/**` → `routes/identities/[id]/**`: `+layout` (23), `talk` (7), `todos` (29), `gallery` (30), `members` (8), `db` (12, just added), `settings`, `+page.ts`.
- `routes/sparks/+page.svelte` (22), `routes/settings/sparks/` → identities.
- `lib/jazz/api.ts` (38), `store.svelte.ts` (3), `intent-files.ts` (7) — `jazzStore('sparks')`→`('identities')`, types, `human` fields.
- `routes/+layout.svelte` (10), `lib/shell/MobileShellNav.svelte` (2), `lib/ui/aside-nav.ts` (3) — nav labels/links.
- `lib/i18n/locales.ts` — `sparks.*`/`nav.*` keys → identities.
- **`routes/avens/**` (resolved):** fold into the identities vocabulary too — there is **no** separate "spark" concept anywhere. Swap `sparkId` → identity id; keep the `avens`/`projectId` grouping as-is for now (no deeper restructure this pass). Avens are aven-typed identities.
- Docs routes (`routes/docs/sparks/**`, `lib/docs/sparks-collection.ts`) — content; rename paths or leave (lowest priority).

### 12.3 On-disk folder rename — `identities/` → `peers/`

Concept clarity: the on-disk per-device keystore directory is a **network peer**
(a device's keypair/db), which is a *different concept* from the `identities` data
table (owners). Renaming removes the collision:
- `libs/aven-server/src/main.rs:91` — `base.join("identities")` → `base.join("peers")` (+ the doc comments at :38/:77/:80).
- App-side — the `crypto_dir` / `self_identity_dir` derivation in `jazz/mod.rs` (~:3785–3800): rename the `.avenOS/<network>/identities/` segment to `peers/`. *(Locate the exact `join` during execution.)*
- Clean slate: `.avenOS` is wiped, so no stale `identities/` dir remains.

### 12.4 Atomic execution order (one push, red until green)
1. **Schema** — rewrite manifest (fresh baseline); drop legacy `before-*` snapshots; **keep the migration mechanism**.
2. **`aven-caps`** — rename primitives; `cargo check -p aven-caps` green.
3. **App backend** — `jazz/*`, `biscuit_resolver`, `spark_acc`/`spark_sync` (eliminate/rename), `peers`, `schema_manifest` (drop migration paths), fold `humans`→identity; on-disk path.
4. **`aven-server`** — `aven_ceo`, `main` (folder rename); `cargo build` green.
5. **Frontend** — move `lib/sparks`→`lib/identities`, `routes/sparks`→`routes/identities`, stores/api/i18n/nav; `svelte-check` 0 errors.
6. **Wipe + live test** — `.avenOS` wiped; onboard (human identity, typed), create/share, identity-scoped DB viewer, members, sync A↔B via relay.

### 12.5 Verification (done = all true)
- `cargo check` (app) + `cargo build` (server) green; `svelte-check` 0 errors.
- `grep -rin "spark" app/src-tauri/src app/src libs/aven-caps libs/aven-server` → **only** doc/comment prose, **zero** code identifiers; `grep -rn "spark_id"` → none.
- `humans` and `sparks` table names gone from the manifest; `identities` + `owner` present.
- Live: human identity auto-created on onboard with `type=human`; avenCEO is `type=aven`; sharing + the per-identity DB viewer work; A↔B converge through the relay.
- Net line count **≤** pre-remodel (elimination ≥ additions, §12.1).

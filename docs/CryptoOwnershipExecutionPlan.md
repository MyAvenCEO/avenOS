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

## ☐ Milestone 1 — Identities remodel (atomic push, NEXT)

Unify `humans` + `sparks` → one typed `identities` table; `spark`→`identity`,
`spark_id`→`owner` everywhere (incl. `avens`); fresh schema baseline.
**First-principles: eliminate** — net lines ≤ before. ~1,200 sites, red-until-green;
the engine (`groove`) is schema-agnostic → this is a rename+merge, **not** a rewrite.

**Model — `identities` (replaces `humans`+`sparks`):** `id` · `type`(human|aven) ·
`owner` · `name` · `username_slug?` · `my_devices?` · `issuer_pubkey_b64` ·
`genesis_b64` · `current_dek_version` · `created_at_ms`. Human identity absorbs the old
`humans` profile; aven identity = avenCEO/agents. Every identity carries a biscuit.

**Tasks (in order, each builds green before the next):**
- [ ] **Schema** — rewrite `libs/aven-schema/schema.manifest.json`: add `identities` (merge + `type`), `spark_id`→`owner` on `messages`/`todos`/`files`/`peers`/`keyshares`, drop `humans`+`sparks`. Delete legacy `migrations/snapshots/before-*.json` + their `registry.json` entries (**keep** the migration mechanism).
- [ ] **`aven-caps`** — `caps.rs`(132) `BiscuitSpark`→`BiscuitIdentity`, `mint_genesis_spark`→`mint_genesis_identity`; `ownership.rs`(45) `owner_spark`→`owner`; `crypto.rs`(27) `spark_urn`→`identity_urn`. → `cargo check -p aven-caps` green.
- [ ] **App backend** (`app/src-tauri/src/`) — `jazz/mod.rs`(360, IPCs/stamping/hydration), `jazz/jazz_engine.rs`(118, `build_object_spark_id_map`→`build_object_owner_map`, **fold `humans` profile → human identity**), `biscuit_resolver.rs`(32, `object_spark_ids`→`object_owner`), `peers.rs`(14), `schema_manifest.rs`(5, consts only — keep lens paths), `network.rs`/`lib.rs`/`crypto.rs`. **Eliminate** `spark_acc.rs`+`spark_sync.rs` shims → import `aven-caps` direct.
- [ ] **Ownership from the immutable header** — mint the binding first; **derive** the `owner` column from `binding.owner` (never written independently); `verify_on_apply` roots authenticity in the binding; the gate reads `owner` as the binding's digest-covered, write-once value. (Binding = single root of trust; column = its queryable derived projection — the engine stays schema-agnostic.)
- [ ] **On-disk folder `identities/`→`peers/`** — `libs/aven-server/src/main.rs:91` `base.join("identities")` + app `crypto_dir`/`self_identity_dir` derivation (`jazz/mod.rs` ~:3785).
- [ ] **`aven-server`** — `aven_ceo.rs`(40, avenCEO = `aven` identity), `main.rs`(6). → `cargo build` green.
- [ ] **Frontend** (`app/src/`) — move `lib/sparks/`→`lib/identities/` (`Spark*`→`Identity*`), `routes/sparks/[sparkId]/**`→`routes/identities/[id]/**`, `routes/avens/**` (`sparkId`→id, keep grouping), `lib/jazz/{api.ts,store.svelte.ts,intent-files.ts}` (`jazzStore('sparks')`→`('identities')`), nav (`routes/+layout.svelte`, `lib/shell/MobileShellNav.svelte`, `lib/ui/aside-nav.ts`), `lib/i18n/locales.ts`. → `svelte-check` 0 errors.
- [ ] **Wipe + live test** — `.avenOS` wiped; onboard (human identity, `type=human`), create/share, per-identity DB viewer, members, A↔B converge via relay.

**Done =** `cargo check` + `cargo build` + `svelte-check` green · `grep -rin spark` → only prose, zero identifiers · `humans`/`sparks` gone from manifest, `identities`+`owner` present · net lines ≤ before.

---

## ☐ Milestone 2 — Eviction-notice protocol

Revoke (re-mint biscuit + DEK rotate + delete revoked keyshares) **exists**. Missing: a
**peer-specific eviction notice** — self-eviction can't trigger (a revoked peer is gated
out → never learns it's revoked), and a global tombstone would propagate a false delete.
- [ ] New peer-scoped eviction-notice sync payload (`sync_manager`).
- [ ] Sender: on a revoked peer's `FrontierNeed` for a now-denied identity → emit notice.
- [ ] Receiver: drop local rows for that identity (local-only, not a tombstone).
- [ ] Live test: revoke → reconnect → data evicted from the honest peer.

## ☐ Milestone 3 — Edit-sig over `batch_digest` (optional hardening)

Redundant with owner-binding (authenticates the writer) + AEAD (authenticates data). Do
only if explicitly wanted.
- [ ] `BatchSigner` injected into the engine (mirror `set_resolver`); sign at seal.
- [ ] `author_sig`/`author_did` on `SealedBatchSubmission` (persisted codec change).
- [ ] Verify at `SealBatch` apply.

---

## Architecture reference (terse)

- **Write:** mint owner-binding `Sign_author(value_id ‖ owner)` → row metadata; data cell-sealed under the identity DEK.
- **Apply (every peer):** `verify_on_apply` — value_id matches, binding sig valid, owner immutable, author holds the per-kind cap.
- **Outbound gate:** `may_sync` = biscuit caps; resolves row→identity via the gate-enforced `owner`.
- **Revocation:** re-mint biscuit + rotate DEK (forward) + evict on reconnect (M2). Backward plaintext is not recallable — accepted (no E2EE system can).
- **Out of scope:** content-addressed ids; forward-secret ratchet / sender-keys.
- **History:** the server-rooted avenCEO control identity, the `aven-caps` extraction, and the biscuit sync gate shipped via the auth-into-server merge (design in git history).

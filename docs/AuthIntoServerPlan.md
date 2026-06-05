# Auth → folded into `aven-server` — the caps-only `admin-spark` design

**Status:** design + task breakdown · **Owner:** sync / platform · **Refines:** §3 (Part B — auth → Rust) and §4 (Part C — the aven) of [`AvenServerPlan.md`](./AvenServerPlan.md).

**What this changes vs the locked plan.** `AvenServerPlan.md` §3 decided to *port* Better-Auth to a Rust `aven-auth` crate keeping its own SQLite store. This supersedes that: **no auth crate, no SQLite, no Better-Auth port.** Auth dissolves into two things the system already has — the did:key **handshake** and the **biscuit** gate — leaving network *admission*, which becomes a **membership capability** carried in a sealed control spark (`admin-spark`). Better-Auth and the `:3000` HTTP service are **deleted outright**.

---

## 0. The reframe — most of "auth" is already redundant

Strip `aven-auth` to what it persists ([`schema.ts`](../libs/aven-auth/src/lib/auth/plugins/aven-auth/schema.ts) + Better-Auth tables):

| Better-Auth state | What it actually is | Replaced by |
|---|---|---|
| `user` | a row per DID, synthetic `device+hash@…` email | a `did:key` *is* the identity — pure shell |
| `account` | maps `providerId=self + accountId=did → userId` | redundant indirection over the DID |
| `session` | bearer token for the admin UI | the **authenticated `/sync` WS** (proven DID) |
| `self_site_config.adminUserId` | who is the first admin | who holds `owns()` on `admin-spark` |
| `self_invite` | single-use pairing token | **deleted** — onboarding inverts (§2) |
| `self_challenge` | nonce / anti-replay | the WS handshake nonce (in-memory, per-conn) |

The `user`/`account`/`session` triad is a thin wrapper around `did:key` that the biscuit model already replaces. The WS handshake at [`ws_server.rs:135`](../libs/aven-server/src/ws_server.rs) already proves the DID; `authorize`/`may_sync` already gate every frame by biscuit. **For sync, the server needs no user database.** What's left is *admission* — "may this DID participate in this network" — and that becomes a **membership capability**, not a table.

---

## 1. Decisions locked (premises)

1. **Auth collapses into the `/sync` WS.** No HTTP `:3000`, no bearer tokens, no sessions, no synthetic emails. Admin actions ride the authenticated WS. Better-Auth deleted; [`network-auth.ts`](../app/src/lib/self/network-auth.ts) rewritten.
2. **One authorizer — biscuit caps govern *sync eligibility itself*.** There is **no table-level `nosync` flag.** A row syncs to a peer **iff** that peer holds a cap on the row's spark (`may_sync` is the sole gate). "Local-only" = the degenerate case of a spark only one device holds a cap on. This restores `AvenServerPlan.md` §1's "one authorizer" invariant, which the `nosync` special-case violated.
3. **`peers` is one spark-scoped table, reused across sparks** (by `spark_id`) — not forked into a local table + a roster table. Device trust-set = `peers` rows in the device's **own private spark**; network roster = `peers` rows in **`admin-spark`**. Same schema, governed by caps.
4. **`admin-spark` is a dedicated, *sealed* control spark** (not the admin's personal default spark). The server is a **read-only replica member** of it — `replicate` **+** keyshare, **no `owns`** — so it can read the roster but never write it, and stays **blind for every content spark**.
5. **Onboarding inverts: DID-push, not token-pull.** Every device already has a local-first did:key (public). The candidate sends their DID to an admin; the admin proactively grants. No secret token, no expiry, no single-use store.
6. **First contact = server-mediated capability handoff.** The admin pre-mints the candidate's membership credential + keyshare into `admin-spark` (offline). On the candidate's first authenticated connect, the server (which can read `admin-spark`) hands the bundle over. Everything downstream is pure caps.

---

## 2. The inverted onboarding flow

> **Insight:** a `did:key` is a *public key*, not a secret — nothing to leak, expire, or single-use. So instead of the admin minting a secret token the candidate pulls (the Better-Auth invite), the **candidate pushes their public DID** and the admin grants on it. This deletes `self_invite`, `self_challenge`, the redeem race, and the single-use store.

```
1. Candidate device generates its did:key offline (already happens, local-first).
2. Candidate copies its DID, sends it to an admin over any channel (public — safe).
3. Admin's device (owns admin-spark) runs "Add member <DID>":
     → mints a network MEMBERSHIP credential for <DID> (biscuit, rooted in admin-spark)
     → wraps the admin-spark DEK to <DID>'s pubkey            (keyshare, OFFLINE)
     → writes the sealed roster row {did, label, status:active}
   All of this syncs to the server (read-only replica) like any other shell write.
4. Candidate dials wss://<server>/sync — handshake proves its DID.
5. FIRST CONTACT: candidate holds no credential yet. The server reads admin-spark
   (it has the keyshare), sees <DID> is a pending member, and HANDS OFF the bundle
   (membership credential + the candidate's keyshare).
6. Candidate decrypts, now holds its membership credential → admitted. Subsequent
   connects present the credential; pure caps from here.
7. Candidate creates its own sparks; the client auto-mints replicate(serverDid) on
   each, so the server blind-backs-up the candidate's OWN sparks.
```

Steps 3 and 7 lean on existing offline-wrap + `replicate` primitives; steps 5–6 (handoff) and the membership credential are new.

**Why DEK-wrap-offline is the unlock.** `sparkAdminAdd` derives the KEK with `derive_kek_x25519(admin_signing_key, recipient_pubkey)` and wraps the DEK under it ([`jazz/mod.rs:2027`](../app/src-tauri/src/jazz/mod.rs), [`crypto.rs:72`](../app/src-tauri/src/crypto.rs)) — it needs **only the recipient's public key**. So the admin can fully prepare a member who is offline, and the member completes onboarding even when *all admins* are offline; the server bridges them.

---

## 3. Caps-only sync — `peers` reused across sparks

The model that makes "one `peers` table" work:

> **A row syncs to a peer iff `may_sync(peer, op, resource)` allows it, where `resource` derives from the row's `spark_id`. There is no other switch.**

| Concern | Old (special-cased) | New (caps-only) |
|---|---|---|
| What makes a row sync | a table-level `nosync` flag / no `spark_id` | a cap on the row's spark — nothing else |
| Local device trust-set | the nosync `peers` table ([`peers.rs:1`](../app/src-tauri/src/peers.rs)) | `peers` rows in the **device's own private spark** (only that device holds the cap → effectively local, still backs up to the device's own replica) |
| Network roster | (didn't exist) | `peers` rows in **`admin-spark`** (admin `owns`; server `replicate`+keyshare) |
| Table count | local `peers` + a new `roster` | **one** spark-scoped `peers` table, reused by `spark_id` |

Every table becomes spark-scoped (`peers` gains `spark_id`). The schema is already centralized in [`libs/aven-schema`](../libs/aven-schema/schema.manifest.json) and embedded by both app and server; this change removes the lone exception to the cap model rather than adding a table.

**Bootstrap-ordering wrinkle (the one real cost).** The transport registration path reads the trust-set *before* spark hydration today. Under caps-only, the trust-set comes from decrypting the device's **own** private spark at startup (which the device can always do — it holds its own keyshare). This is a sequencing change in [`peers.rs`](../app/src-tauri/src/peers.rs) / the `register_peer_sync_client` path, not a blocker.

---

## 4. `admin-spark` — the sealed control spark

| Property | Value |
|---|---|
| **Genesis owner** | the first admin (bootstrap device) — `owns` + keyshare (read+write) |
| **The server** | **read-only replica** — `replicate` **+ keyshare**, **no `owns`** (decrypts the roster, cannot write it) |
| **Onboarded members** | hold a **membership credential** + a keyshare (delivered by handoff §5). Read the roster; not owners. |
| **Sole table** | `peers` (spark-scoped): `{did (plaintext routing), label (sealed), kind, role, status (sealed), added_at}` |
| **Admin-designation** | `owns()` on `admin-spark` — replaces `self_site_config.adminUserId` |
| **Bootstrap** | first DID to claim `admin-spark` becomes owner; rejected once an owner exists |

**Why sealed + server-holds-keyshare.** Roster `status` (active/revoked) is sealed, so a plain `replicate`-only relay can't read who's admitted. The server therefore holds an `admin-spark` keyshare (read-only replica) to gate admission. It reads **only** this control directory; it holds **no** keyshare for any content spark → provably blind for user data.

**Why a dedicated spark, not the admin's default.** The server holds `admin-spark`'s DEK. If the roster lived in the admin's personal spark, the server could read personal content — blindness broken. `admin-spark` scopes the server's read to a low-sensitivity directory and nothing else.

---

## 5. Admission — membership credential + first-contact handoff

The WS handshake is **open** — any valid did:key passes `verify_client` ([`ws_server.rs:135`](../libs/aven-server/src/ws_server.rs)); without admission, any DID could mint `replicate(serverDid)` on its own spark and self-enroll backup (open relay). Admission closes that, as a **capability**, not a flag:

- **Membership credential** — a biscuit issued by an admin, rooted in `admin-spark`'s issuer key, asserting "`<DID>` is a member of this network." The server trusts that root (it reads `admin-spark`).
- **Steady state** — on connect, after DID proof, the peer presents its membership credential; the server verifies it against the `admin-spark` root and against the roster `status` (revoked → reject). Admitted peers then proceed to the existing per-frame `may_sync` gate.
- **First contact (handoff)** — a brand-new member holds no credential yet. The admin has pre-minted it into `admin-spark`; the server (read-only replica) sees the pending member, and on first authenticated connect **ships the `admin-spark` shell** (the member's keyshare + credential). The member decrypts and is bootstrapped. This is the one bootstrap exception, and it is still cap-rooted: the server only hands off to a DID the admin has *granted* in `admin-spark`.
- **Revoke** — admin sets the roster row `status=revoked` and rebuilds the `admin-spark` biscuit excluding the DID (existing `rebuild_spark_biscuit_excluding`) + rotates the DEK. The server, re-reading the roster, refuses the DID at connect.

---

## 6. What gets deleted vs built

**Deleted**
- The entire `libs/aven-auth` TypeScript service (Better-Auth, SvelteKit, better-sqlite3, `:3000`).
- Tables `user`, `account`, `session`, `self_site_config`, `self_invite`, `self_challenge`; synthetic emails, bearer tokens, HTTP `/nonce` `/verify` `/invite/*` `/site/status`.
- The **table-level `nosync` concept** and the duplicate TS did:key challenge ([`challenge.ts`](../libs/aven-auth/src/lib/auth/plugins/aven-auth/challenge.ts)).
- The invite UI ([`InviteAdminPanel.svelte`](../app/src/lib/self/InviteAdminPanel.svelte), `app/src/routes/invite`).

**Already built (reuse as-is)**
- `AccOp::Replicate` + `attenuate_add_replicate_third_party` + `authorize_replicate` ([`spark_acc.rs:154`](../app/src-tauri/src/spark_acc.rs)) — the blind `replicate` cap, with `query_all`-based grant checks the membership credential can mirror.
- `sparkAdminAdd` (owns + offline DEK wrap) and `sparkReplicateAdd` (replicate, no keyshare) ([`jazz/mod.rs:1935`, `:2110`](../app/src-tauri/src/jazz/mod.rs)); offline keyshare wrap ([`crypto.rs:72`](../app/src-tauri/src/crypto.rs)).
- `rebuild_spark_biscuit_excluding` for revoke ([`spark_acc.rs:202`](../app/src-tauri/src/spark_acc.rs)); open did:key handshake; per-frame biscuit gate; shell-table sync of keyshares + genesis.

**New (the actual work — see §8)** — caps-only sync + `peers` spark-scoped; `authorize` DSL generalization (non-owner rights); read-only-replica minter; `admin-spark` bootstrap + membership credential + handoff; server admission; auto-replicate-on-create; WS admin actions; delete Better-Auth.

---

## 7. How this re-shapes `AvenServerPlan.md` P0–P3

- **P0 / P1** (dev-TCP, then TLS `ServerSyncTransport`) — unchanged; the WS sync server already exists ([`ws_server.rs`](../libs/aven-server/src/ws_server.rs)).
- **P2 (auth → Rust)** — **deleted.** No Better-Auth port. Replaced by `admin-spark` + membership credential + admission, mostly app-side. Net *less* work.
- **P3 (the aven, blind relay)** — the `replicate` cap is in; the `authorize` DSL generalization (§4.0 #4) is pulled forward here because the membership credential needs it. Remaining P3 = `admin-spark` integration + hosting.

---

## 8. Implementation task breakdown

Dependency-ordered. **Gate on every task:** `cargo check`/`cargo test` green for touched crates **and** the `aven-db` §9 sync harness stays green. Phases 0→B are strictly ordered; C can start once 0.3 + A.1 land; D lands after B+C work; E runs throughout + final.

### Phase 0 — Foundation: caps-only sync + cap vocabulary

- **T0.1 — Caps-only sync; `peers` spark-scoped.** Remove the table-level `nosync` special-case so `may_sync` is the sole sync gate. Add `spark_id` to the `peers` table; route `peers` rows to a spark like content rows. Migrate the device trust-set to `peers` rows in the device's **own private spark**; source the transport allowlist from there at startup.
  *Files:* [`schema.manifest.json`](../libs/aven-schema/schema.manifest.json), the `nosync`/shell-table decision point in `aven-db`, [`peers.rs`](../app/src-tauri/src/peers.rs), the `register_peer_sync_client` path in [`jazz/mod.rs`](../app/src-tauri/src/jazz/mod.rs).
  *Acceptance:* a fresh device still auto-connects its known peers (now sourced from its private spark); no table syncs without a cap; harness green. **This is the riskiest task — land it first and alone.**

- **T0.2 — `authorize` DSL generalization (non-owner rights).** Let a subject holding a *delegated* `read`/`member` right authorize without being an `owns`-admin — the same generalization `authorize_replicate` already does for `replicate` ([`spark_acc.rs:367`](../app/src-tauri/src/spark_acc.rs)), extended to the membership/read case. Third-party attenuation already proves the right was admin-signed.
  *Files:* [`spark_acc.rs`](../app/src-tauri/src/spark_acc.rs) (`authorize`).
  *Acceptance:* unit tests — a non-owner `read`/`member` grantee is allowed for `Read`; owner/replicate/deny paths unchanged.

- **T0.3 — Read-only-replica minter.** A bundle beside the two existing minters: `replicate` grant **+** an offline DEK-wrap keyshare, **no `owns`** (mechanically `sparkReplicateAdd` + the keyshare half of `sparkAdminAdd`). New IPC `sparkReaderAdd({ sparkId, peerDid })`.
  *Files:* [`spark_acc.rs`](../app/src-tauri/src/spark_acc.rs), [`jazz/mod.rs`](../app/src-tauri/src/jazz/mod.rs), [`api.ts`](../app/src/lib/jazz/api.ts).
  *Acceptance:* unit test — the reader decrypts + relays the spark, but `authorize` denies `Write`/`owns`.

### Phase A — `admin-spark` lifecycle (device/app)

- **A.1 — `admin-spark` bootstrap (claim-once).** First admin mints the `admin-spark` genesis, becomes `owns`-owner, persists an "this is `admin-spark`" marker; reject a second claim. Add the spark-scoped `peers` roster usage.
  *Files:* bootstrap path in [`jazz_engine.rs`](../app/src-tauri/src/jazz/jazz_engine.rs), a small `admin_spark` module, schema.
  *Acceptance:* a clean device bootstraps `admin-spark` and is its owner; a second bootstrap attempt is rejected.

- **A.2 — Enroll the server as read-only replica of `admin-spark`.** At/after bootstrap, run `sparkReaderAdd` (T0.3) for the server's DID (from config). 
  *Acceptance:* the server's DID appears with `replicate`+keyshare, no `owns`, on `admin-spark`.

- **A.3 — `addMember(did)` (DID-push onboarding).** Mint the member's **membership credential** (biscuit rooted in `admin-spark`), wrap the `admin-spark` DEK to the member's pubkey (offline keyshare), write the sealed roster row. One WS-driven admin action, gated by `owns(admin-spark)`.
  *Files:* `admin_spark` module, [`spark_acc.rs`](../app/src-tauri/src/spark_acc.rs) (credential minter), [`jazz/mod.rs`](../app/src-tauri/src/jazz/mod.rs).
  *Acceptance:* after `addMember(X)`, `admin-spark` carries X's credential grant + X's keyshare + roster row; all offline-minted.

- **A.4 — `revokeMember(did)` / `listMembers()`.** Revoke = roster `status=revoked` + `rebuild_spark_biscuit_excluding` + DEK rotation. List = read roster.
  *Acceptance:* a revoked member is dropped from the rebuilt `admin-spark` biscuit and can't decrypt the rotated roster.

### Phase B — Server admission + handoff (`aven-server`)

- **B.1 — Server reads `admin-spark`.** Hydrate `admin-spark` (read-only replica), decrypt the roster, build an in-memory member/active set; refresh on sync.
  *Files:* [`main.rs`](../libs/aven-server/src/main.rs), a server-side `admin_spark` reader.
  *Acceptance:* the server logs the live member set; a roster write on an admin device updates it.

- **B.2 — Membership verification at handshake.** After DID proof in `accept_inner`, verify the peer's membership credential against the `admin-spark` root + roster `status`; refuse non-members **above** `may_sync`.
  *Files:* [`ws_server.rs`](../libs/aven-server/src/ws_server.rs).
  *Acceptance:* a member connects; a non-member is refused post-handshake; a revoked member is refused.

- **B.3 — First-contact handoff.** If a connecting DID is a pending member with no credential yet, ship it the `admin-spark` shell (its keyshare + credential).
  *Files:* [`ws_server.rs`](../libs/aven-server/src/ws_server.rs) / the engine ship path.
  *Acceptance:* a freshly-`addMember`'d device, holding nothing, connects and converges to holding its credential + keyshare with no admin online.

- **B.4 — Server config wiring.** `admin-spark` id + server identity in [`main.rs`](../libs/aven-server/src/main.rs) `Config` (env).

### Phase C — Member onboarding UX + own-spark backup

- **C.1 — Auto-replicate-on-create.** When a member creates a spark, auto-mint `replicate(serverDid)` (server DID from config) so the server blind-backs-up the member's own sparks without a manual step.
  *Files:* spark-create path in [`jazz/mod.rs`](../app/src-tauri/src/jazz/mod.rs).
  *Acceptance:* a member's newly-created spark converges to the server and re-syncs to a second member device through it.

- **C.2 — Onboarding UX.** "Copy my DID" for the candidate; "Add member `<DID>`" (paste) for the admin → `addMember`. Remove the invite-token UI.
  *Files:* `app/src/lib/self/*`, `app/src/routes/invite` (delete).

### Phase D — Delete Better-Auth

- **D.1 — Rewrite `network-auth.ts`** to drive the WS admin actions (`addMember`/`listMembers`/`revokeMember`); drop HTTP `/nonce` `/verify` `/invite/*`, bearer tokens.
- **D.2 — Delete `libs/aven-auth`**, `scripts/dev-aven-auth.ts`, `:3000` wiring, `AVEN_AUTH_*` env, synthetic-email/challenge TS.
- **D.3 — Remove the invite route + panel.**
  *Acceptance:* the app authenticates purely via the `/sync` WS; no process listens on `:3000`; build green with `aven-auth` gone.

### Phase E — Tests & cutover

- **E.1 — Harness tests.** Caps-only: a no-cap peer receives nothing; `replicate`-only relays ciphertext blind; the read-only replica reads the roster but is denied `Write` (mirror the planned `T11`).
- **E.2 — E2E live.** Bootstrap `admin-spark` → server enrolled → DID-push onboard X (admin offline) → server hands off X's credential → X admitted → X's own spark backs up and reaches a second device through the server; a non-member DID is refused.
- **E.3 — Soak, then delete archive.**

---

## 9. Risks & open questions

| # | Question | Lean |
|---|---|---|
| R1 | T0.1 (caps-only + `peers` spark-scoped) touches the transport allowlist bootstrap | land alone, first; keep behavior parity via the device-private spark |
| R2 | Membership credential format + where the server pins the `admin-spark` root pubkey | root pubkey = `admin-spark.issuer_pubkey_b64`, which the server reads as a replica |
| R3 | Multi-admin/multi-aven: concurrent roster writes under CRDT merge | additive admits are safe; revoke+write needs a tie-break — revisit for HA |
| R4 | Revoking network membership doesn't auto-revoke `replicate` on the member's *personal* sparks | acceptable; network revoke = roster `status` + drop at connect |
| R5 | Server holds an `admin-spark` keyshare → reads the directory (DIDs+labels+status) | accepted (sealed-status decision); still blind for all content sparks |
| ~~R7~~ | ~~reuse `peers` shape vs new `roster` table~~ | **dissolved** by caps-only — one spark-scoped `peers` table |

---

## 10. Definition of done

- Better-Auth, the `:3000` service, and the six SQLite tables are gone; the app authenticates purely by the `/sync` WS handshake; the table-level `nosync` flag is gone — `may_sync` is the sole sync gate.
- One spark-scoped `peers` table serves both the device trust-set (device-private spark) and the network roster (`admin-spark`).
- A first admin bootstraps `admin-spark`, the server is enrolled as a read-only replica, and a second device is onboarded by **DID-push** (paste the candidate's DID; no token), receiving its membership credential via **server handoff** even with all admins offline.
- The server **admits only members** of `admin-spark` and blind-relays each member's own sparks (`replicate`, no keyshare) — a member's content stays ciphertext the server cannot read.
- One Rust binary: open did:key handshake + membership admission + biscuit gate, no separate auth service anywhere.

---

## 11. Build progress (branch `feat/aven-auth-into-server`)

| Task | State | Commit |
|---|---|---|
| Design doc + breakdown | ✅ | `234050d` |
| **T0.2** non-owner delegated `reads` in `authorize()` (+ `attenuate_add_reader_third_party`, `spark_readers`, unit test) | ✅ verified — `cargo test … spark_acc::` 6 passed | `f1d4099` |
| **T0.3** `sparkReaderAdd` (reads + offline keyshare, no `owns`) — IPC handler + dispatch + `api.ts` binding | ✅ compiles clean, wired | `f1d4099` |
| **T0.1** caps-only sync / `peers` spark-scoped | ⬜ specified below — needs live `dev:app2x` verification | — |
| A–E | ⬜ | — |

> **Why T0.1 is handed off, not blasted out.** It is a 13-site change across `aven-db` + `app/src-tauri` *plus* a bootstrap reorder, and the only thing that proves it (does bootstrap still build a valid shell; do `peers` rows converge through the biscuit gate) is a **live two-device run**, which an autonomous build session can't perform. Shipping it compile-only would look done while being unverified — worse than a precise guide.

### 11.1 — T0.1 site-by-site execution guide

**Schema** ([`schema.manifest.json`](../libs/aven-schema/schema.manifest.json)): add `{ "name": "spark_id", "type": "uuid", "plaintext": true, "comment": "routing — ACC + sync" }` as the **first** column of `peers`. This alone flips `peers` into `manifest_spark_scoped_table_names()` ([`schema_manifest.rs:262`](../app/src-tauri/src/schema_manifest.rs)).

**Bootstrap reorder** ([`jazz_engine.rs:741`](../app/src-tauri/src/jazz/jazz_engine.rs)): the local `peers` row is created *before* the genesis spark (line 786) and its OID feeds the `humans` row (line 770). Reorder to **mint spark → create `peers` row with `spark_id = spark_id` → create `humans` row**. The device's own spark becomes the home of its trust-set.

**`add_remote_peer`** ([`peers.rs:126`](../app/src-tauri/src/peers.rs)): take a `spark_id` (the caller's `default_spark`) and write it on the row. Update the three callers (`sparkAdminAdd`/`sparkReplicateAdd`/`sparkReaderAdd`) to pass it.

**Remove the `peers` special-cases (13 sites mapped):**
- Publish/snapshot hardcodes → delete the `if table == "peers"` branches: [`mod.rs:1021`, `1056`, `2812`](../app/src-tauri/src/jazz/mod.rs); let `peers` flow through the standard `query_table_publish` + biscuit gate.
- Insert bypass → [`mod.rs:2523`](../app/src-tauri/src/jazz/mod.rs): drop the `peers` short-circuit so it hits `inject_default_spark` + `authorize_gate`.
- P2P forward suppression → [`mod.rs:2994`](../app/src-tauri/src/jazz/mod.rs): remove the `is_spark_scoped_table` early-return for `peers`.
- Drain special-case → [`mod.rs:229`](../app/src-tauri/src/jazz/mod.rs): fold `peers` into the standard drain.
- Vault-shell list → [`spark_sync.rs:51`](../app/src-tauri/src/spark_sync.rs) `VAULT_SHELL_TABLES`: keep `peers` *out* of the shell-digest re-hydrate trigger now that it's ordinary spark data (or accept re-hydrate on roster change — decide during impl).
- Shell-catchup → [`sync_manager/mod.rs:450`](../libs/aven-db/src/sync_manager/mod.rs) `SHELL_CATCHUP_TABLES`: leave as `["sparks","keyshares"]` — `peers` now catches up as normal spark rows, not shell.
- ACL map → [`jazz_engine.rs:441`](../app/src-tauri/src/jazz/jazz_engine.rs) `build_object_spark_id_map`: automatically includes `peers` once it has `spark_id` (no change beyond the column).
- Test filter → [`delete_frontier_repro.rs:30`](../libs/aven-db/tests/delete_frontier_repro.rs): drop `peers` from the skip list.

**Verification ladder:** (1) `cargo check -p aven-os-app` + `cargo check -p aven-db`; (2) `cargo test -p aven-db` (the §9 harness, incl. `delete_frontier_repro`); (3) **live** `bun dev:app2x:mac` — a fresh device bootstraps (valid shell, trust-set present), pastes a peer DID, and a shared spark + the trust-set converge. Only (3) closes the task.

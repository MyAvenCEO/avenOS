# Capability-driven sync — architecture & execution

> **⚠️ Superseded for transport + server topics.** The **§4 (Transport)** and **M2/M3** milestones here are now driven by [`AvenServerPlan.md`](./AvenServerPlan.md), which (a) replaces the dev TCP transport with real peeroxide Hyperswarm, run locally, and (b) merges the dev TCP service, the `aven-auth` server, and the planned sync relay into **one Rust `aven-server` binary**. The capability/frontier **model** below (§0–§3, §6, §9) is unchanged and remains canonical — only the transport under it and the servers above it move.

**Status:** spec (model) · superseded (transport/server, see AvenServerPlan.md) · **Owner:** sync/aven-db · **Scope:** how AvenOS syncs spark data between peers, gated by biscuits, over a Hyperswarm-class transport.

**Thesis.** Every value syncs to exactly the peers a biscuit authorizes; the network self-assembles (discover · pair · sync · heal) in the background. The whole frontend reduces to *"manage who's in each spark."*

**Today (updated):** M0 (de-jazz collapse) and M1's engine are **landed**. Live peer forwarding now passes the real biscuit gate (`BiscuitCapabilityResolver` → `ship_frontier_diff`); the frontier engine + announce/need protocol are wired; the dev TCP transport (`dev_transport.rs`) converges two instances; the mesh UI + `peer/api.ts` are on real IPC (demo deleted); ReBAC and the server tier are removed (one authorizer, one tracker). **Remaining:** prove the live grant→sync loop end-to-end, surface convergence as "Up to date", tidy the legacy test graveyard, and — the one external blocker — the real `HyperswarmTransport` (peeroxide, sandbox-blocked). See **§10**.

**Decision — radical cut.** We commit 100% to **biscuit caps + frontier sync** as avenOS's only auth + replication model, and delete the upstream-Groove multi-tier machinery avenOS never used: ReBAC/`ClientRole`, the server tier, and the peer delivery ledger. No coexistence, no backwards-compat shim. This is cheap because none of it has an avenOS consumer (§0) — it's deletion + test rewrite, not behavior migration. The cut runs as **M0 (de-jazz collapse)** then **M1 (frontier sync)** — see §0 for the kill-boundary and §8 for sequencing.

---

## 0. Scope — the kill-boundary (read this first)

avenOS uses a **narrow slice** of upstream Groove: local `RuntimeCore` over RocksDB, the schema registry, and peer connections. It does **not** use Groove's multi-tier browser machinery — verified: the app instantiates **zero** `ClientRole::{User,Admin,Backend}`, never calls `add_server`, `forward_*_to_servers` is `#[cfg(test)]`, and the only client it registers is `ensure_client_as_peer`. ReBAC is already dead on this path (peers short-circuit `is_in_scope`; no non-peer client ever exercises it). Auth is **biscuit caps** (`spark_acc`), not ReBAC. So the cut is wide, not narrow.

**CUT — no avenOS consumer; delete + rewrite the tests that encode them:**
- **ReBAC central access control** — `ClientRole::{User,Admin,Backend}`, `is_in_scope`, the `permissions.rs` permission-check machinery, role-based row filtering. **Biscuit caps (`may_sync`) replace it wholesale.**
- **Server tier** — `ServerId`, `add_server`, `forward_*_to_servers` (test-only), catalogue **sync-to-server**. avenOS has no WebSocket/server tier (`avenos_client.rs`: "no WebSocket server").
- **Peer delivery ledger** — `ClientState.sent_batch_ids` / `DeliveryLedger` on the peer path → **stateless frontier reconciliation** (§1).
- demo `peer/api.ts`, `app/src-tauri/src/demo_mesh.rs`, placeholder `aven-p2p` → real `HyperswarmTransport` + `peerMeshStatus`/`peerRevoke` IPC.

**COLLAPSE — survives only in slimmed form:**
- `ClientState` / `ClientId` → the **peer connection handle** only. The role enum dies (peer is the sole kind); state slims from `sent_batch_ids` to per-resource frontier cursors.

**KEEP — the real avenOS engine:**
- local `RuntimeCore` + RocksDB storage + **local query subscriptions** (the webview's reactive reads go straight through `RuntimeCore`, not as a Groove client).
- schema/catalogue **registry** (validation, migrations). Only catalogue *sync-to-server* is cut, not the registry.

**The single-source-of-truth invariant this creates:** after the cut there is **one** authorizer (biscuit caps) and **one** peer tracker (the per-resource frontier). No ReBAC second-guessing caps; no `sent_batch_ids` second-guessing the frontier. T6 locks the tracker half: drop all per-peer state, re-diff, **zero** resent.

> One-line test of any future change: *"does this reintroduce a role check beside `may_sync`, a server beside the peer mesh, or a per-peer ledger beside the frontier?"* If yes, you've re-grown what M0 cut — stop.

---

## 1. The one model

Sync answers a single question, per resource, per peer: **"is this resource converged between us?"** — never "what have I delivered to whom." Three pure pieces (gate · tracker · seam) meet at one integration point.

### 1.1 Resource — opaque hierarchical URN

```rust
// aven-db — knows nothing about "spark"
pub struct ResourceCoord { pub urn: String, pub table: String, pub row_id: ObjectId }
//                              ^ opaque: "spark:UUID:todos:ROWID", "org:42:billing", …
```

Granularity lives **entirely** in how the app builds the URN and mints grants — the engine treats `urn` as opaque. `authorize()` already matches by prefix and accepts `row_id: Option<Uuid>`, so all three levels work **today** with zero engine change:

| Grant | Biscuit fact | Covers |
|-------|--------------|--------|
| Spark admin | `owns(did,"spark:S")` + `right(write,"spark:S:")` | all of spark `S` |
| Table cap | `right(write,"spark:S:messages:")` | only `messages` rows |
| Row cap | `right(read,"spark:S:files:ROW")` | one row |

### 1.2 Gate — `CapabilityResolver`

```rust
pub enum AccOp { Read, Write, Delete }
pub enum CapDecision { Allow, DenyPermanent, Pending } // Pending = ACL not hydrated → DEFER, never drop
pub trait CapabilityResolver: Send + Sync {
    fn may_sync(&self, subject: &SyncTargetId, op: AccOp, res: &ResourceCoord) -> CapDecision;
}
```

Replaces the coarse `may_deliver(target, payload)`: a structured `(subject, op, resource)` triple → a thin biscuit lookup that never re-parses payloads. The **three-state** result makes the pairing/bootstrap window correct. The app's `BiscuitCapabilityResolver` is the **only** biscuit-aware code: map `ResourceCoord` → spark (reuse live `object_spark_ids` in `spark_sync`), call `spark_acc::authorize`, return `Pending` until the ACL is hydrated.

### 1.3 Tracker — the per-resource frontier (the only tracker)

The authoritative tracker is the **per-resource frontier**: causal heads over the DAG — the analogue of Hypercore's "have"-set. **It already exists in storage:** `Storage::load_visible_region_frontier(table,branch,row_id) -> Vec<BatchId>` *is* the per-row have-set; `scan_row_branch_tip_ids` returns its heads. We add only:

- `Frontier::heads_for(resource) -> Vec<RowBatchKey>` — aggregate per-row frontiers across a resource (reuse `scan_visible_region_row_batch_branches_with_storage`).
- `frontier_diff(have, want) -> Vec<RowBatchKey>` — **pure, stateless, symmetric.** Because row-history is a **DAG** (not a linear log), this is a head-set diff **plus an ancestor reachability walk**, not a scalar length compare.
- `SyncPayload::FrontierAnnounce { resource, heads }` / `FrontierNeed { resource, heads }` (the pull half — `RowBatchNeeded` / `BatchFateNeeded` — already exists).

**No per-peer delivery ledger; nothing to persist.** Reconciliation is a stateless diff + `BatchId` dedup, so losing all cached/per-peer state forces a re-diff — never data loss, never an erroneous re-send. `DeliveryLedger` / `ClientState.sent_batch_ids` are **deleted** in M0 (§0); the frontier is the sole peer tracker.

### 1.4 Integration — one path

`forward_update_to_clients` (`forwarding.rs:381`) stops blanket-sending to peers. Per candidate it computes `frontier_diff`, applies the **per-hop** `may_sync` gate, and emits only batches that are both owed and `Allow`ed, as **stored ciphertext** (decryption is local). Connect-time announce, on-seal announce, and revoke `reevaluate` all route through this **one** path: "row changed" → "frame to DID."

---

## 2. Terminology — spark · peer · device · aven

| Term | Definition | Anchor |
|------|-----------|--------|
| **Spark** | A *capability group* = the *unit of sync*; a scope of biscuit grants mapping to **one** DHT topic `= discovery_key(hash("spark:S"))`. A set of permissions that happens to be syncable — not a node, not a place. | `spark_acc::mint_genesis_spark` |
| **Peer** | Any Ed25519 replica; its identity **is** its `did:key:`. In *0..N* sparks, one biscuit each. Every role below is just *which biscuit a peer holds* — never a special node type. | `SyncTargetId::PeerDid`; `jazz_auth::peer_did_from_ed25519` |
| **Device peer** | A human's interactive device (laptop/phone). Online intermittently; holds the DEK (reads plaintext). | `peers` table (`kind="remote"`) |
| **Aven** | An **always-on peer** = durable **mirror + rendezvous + indexer** for *1..N* sparks. Added to a spark by granting a biscuit, exactly like a person. **Blind by default**: `right(replicate,"spark:S:")` — no `owns`, no DEK → stores ciphertext, provably cannot read. | `aven-server` crate (M2); `DurabilityTier::EdgeServer` |

> Anchor sentence: *"A spark is synced by its peers. Some peers are devices; an **aven** is an always-on peer that several sparks share."* "aven" overlaps the product name → use `aven-server` in code, "aven" in prose.

---

## 3. Distributed architecture — leaf + hub

**Capability = membership = routing.** Holding a biscuit for spark S *is* the subscription to S's topic — discovery is emergent from caps, no config. A peer forwards S's batches to peer C **iff** C presents a valid biscuit for S; the gate runs at **every hop**, so a batch only flows along fully-authorized paths.

**Topology (the Keet lesson — §5):** you don't scale by all-to-all holepunching (connection count is the ceiling); you scale by **mirrors**.

- **Device peers = leaves.** Few live connections (1–2 avens + close friends); finite `maxPeers`. Reconcile by frontier diff. Hold the DEK.
- **Aven = the scaling primitive.** Server-mode on the swarm (announces every topic it holds), holds **full encrypted history** per spark, serves new devices a fast-forward from one complete replica, and bridges friends who are never online together. **One aven serves n+ sparks**, all multiplexed over **one connection per peer** (Hyperswarm 1:1 `PeerInfo`).

| Aven role | Solves |
|-----------|--------|
| **Rendezvous** | friends never online at once never converge → a lone device always finds something live |
| **Mirror / durability** | spark dies if all member devices are lost → full encrypted replica (`DurabilityTier::EdgeServer`) |
| **Indexer** | new device fast-forwards from one replica → single-signer stable frontier (simpler than Autobase's quorum; the aven is trust-rooted by its biscuit) |

> **Not a role we build: connectivity relay / holepunch.** The transport layer already relays the encrypted stream and assists NAT traversal (§5) — peeroxide gives that *free*. The aven is durability + rendezvous + indexing, not byte-relaying.

**Blind by default** (data is encrypted via DEK + `keyshares`): the aven gets a *replicate-ciphertext* grant, not `owns`, and not the DEK → availability + durability with **provably no read access** (Keet's blind mirror). A full-member replica (with DEK) is reserved for self-hosted, fully-trusted hubs. Allow **multiple avens per spark** — no single point of failure.

**Resilience.** Offline-first (full local state per held resource; works partitioned). Reconnect heals by frontier exchange alone, regardless of downtime/order. Multi-path gives redundancy; same batch via N paths dedups by `BatchId`. Integrity is **unconditional**: batches are hash-linked and biscuits unforgeable, so even a malicious *authorized* aven can stall/withhold but never forge or leak. **Caveats to design against:** topic-metadata leakage (`hash(resource)` is observable → salted/rotating topics); Sybil handshake spam (fast biscuit-reject + rate-limit).

---

## 4. Transport

Holepunch splits into **transport** (HyperDHT + Hyperswarm + secret-stream) and **data** (Hypercore + Autobase). **Groove is our data/CRDT layer — keep it; do NOT adopt Autobase** (it would duplicate Groove's DAG linearization). Adopt only the transport half, behind the existing `SyncTransport` trait. The swarm gives exactly two things — discovery-by-topic + an authenticated encrypted pipe — **not** sync; we own the frontier protocol (§1.3) over the pipe.

**Identity (free win):** secret-stream's Noise handshake uses Ed25519; our DID is already Ed25519 (`jazz_auth`). Bind the static key to the device identity → the transport-authenticated `remote_pubkey` **is** the biscuit subject DID, fed straight to `may_sync`.

**Already in `aven-db` (the seam):** `SyncTransport` (`sync_transport.rs:94`), `NullSyncTransport`, length-prefixed `SyncFrameV1`, `SyncTargetId::PeerDid`, `CapturedFrontierMember`. The future mesh is **one** `impl SyncTransport`; nothing above the seam changes.

**Implementation — `peeroxide` v1.3.1** (pure-Rust Hyperswarm port; Kademlia DHT + Noise + holepunch + reliable UDP; wire-compatible with public HyperDHT):

| `SyncTransport` need | peeroxide |
|----------------------|-----------|
| open swarm | `spawn(SwarmConfig) -> SwarmHandle` |
| topic join | derive `topic = hash("spark:S")`; peeroxide's **`discovery_key()`** (BLAKE2b) for announce/lookup — never roll our own |
| pipe + peer identity | `SwarmConnection { remote_pubkey: Ed25519, stream }` → biscuit DID |
| local identity | `KeyPair` (Ed25519) = device root key |

Wrap in a thin `HyperswarmTransport: SyncTransport` adapter (keeps the swap option open). **Unverified risk:** peeroxide's holepunch/relay-fallback parity with JS HyperDHT — spike an early two-NAT connect, not just loopback.

---

## 5. Prior-art validation (web-researched, June 2026)

What Holepunch actually does → what it confirms / changes here:

- **Bounded connections + mirrors is *the* scaling pattern.** Hyperswarm `join({limit})` defaults to `Infinity`; `maxPeers` is a hard ceiling; Keet big rooms scaled only via blind mirrors. → devices must set finite `maxPeers`; avens do fan-out.
- **One connection per peer; topics multiplex** (`PeerInfo` 1:1). → "n+ sparks per aven" is **one** stream, not N.
- **Two distinct "blind" roles.** Transport **relay** (relays encrypted stream + holepunch assist, free from peeroxide) vs data **mirror** (durable replica). → the aven builds only the mirror.
- **Identity = Noise keypair from a 32-byte seed.** → exactly our device-key → DID → biscuit-subject binding.
- **Sparse replication = have-set + Merkle proof + pull-missing.** → validates frontier diff; but Hypercore is *linear* (one length) while we sync a *DAG* (multi-head) → diff must walk ancestors (T2).
- **Autobase = the linearizer we already are.** Quorum-signed checkpoints let laggards fast-forward → our single-signer stable frontier. Confirms: don't adopt it.
- **Blind pairing is a real first-contact best-practice.** Keet `blind-pairing-core`: invite carries `{discoveryKey, seed}`; candidate signs a request; member verifies + returns the join key; neither identity leaks until both prove legitimacy. → target this for V2, not raw-DID paste.

**Sources:** [hyperswarm](https://github.com/holepunchto/hyperswarm) · [hypercore](https://github.com/holepunchto/hypercore) · [autobase DESIGN](https://github.com/holepunchto/autobase/blob/main/DESIGN.md) · [blind-pairing-core](https://github.com/holepunchto/blind-pairing-core) · [Keet/blind mirrors](https://blog.dat-ecosystem.org/meet-mathias/) · [Pears docs](https://docs.pears.com/).

---

## 6. Invariants (the contract — each locked by a §9 test)

**Generic engine** — aven-db holds **zero** biscuit/spark knowledge; all policy is behind `CapabilityResolver`. Adding a granularity level (spark→table→row) is a grant + URN change only; engine/trait/`authorize()` untouched.

**One authorizer, one tracker** — after M0, biscuit caps (`may_sync`) is the **only** authorizer (ReBAC deleted) and the per-resource frontier is the **only** peer tracker (`sent_batch_ids` deleted, §0). Peer sync holds **no non-derivable state**: dropping it forces a re-diff, never loss or erroneous resend (T6). Rows travel as stored **ciphertext**.

**Gate** — every outbound peer frame passes **exactly one** `may_sync`, **at every hop** (T8). `Pending` defers, never drops; only `DenyPermanent` is terminal (T1). Revoke is **not retroactive** — `reevaluate` stops *new* batches; it never deletes what a peer already holds (T8).

**Resilience** — convergence is path/order-independent; same batch via N paths dedups by `BatchId` (T7). Partition heals on reconnect by frontier exchange alone (T9). Integrity is unconditional (hash-linked batches + unforgeable biscuits).

---

## 7. UX model

**The whole frontend = "manage who's in each spark."** Three seams where the magic must be made honest:
1. **First contact needs trust once** → one invite/scan step, automatic forever after.
2. **Direct p2p converges only when both are online** → the aven makes offline-friendly sync real; surface as *"add an always-on relay so this spark syncs even when devices are offline at different times."*
3. **Revoke is not retroactive** → *"stops sharing new changes; they may keep what they already received"* — never *"removes access."*

**Two layers, never fused:** **People/Network** (one-time DID trust — the only home for pairing, reusable across sparks) vs **Spark Access** (pure capability toggles on *known* DIDs, no networking concepts; sync shown as status, never configured).

**Four views:**

| View | Purpose | Key elements |
|------|---------|--------------|
| **V1 — Spark › Members** *(primary)* | who's in + access | member rows: name · role (capability bundles) · **sync chip** (Synced ●/Syncing ◌/Waiting ○/via Relay ⇄) · revoke. **+ Add member** (pick contact). **+ Add relay/backup** (distinct; Blind badge). |
| **V2 — First contact** | the one human step | invite link + QR carrying `{discoveryKey, seed}` (blind pairing, §5) — not a raw DID; DID established cryptographically on accept. Copy: *"They'll receive the full history of this spark."* |
| **V3 — Sync status** | calm observability | per-member chips + one global "all synced / N pending". **Never** a diagnostics JSON dump. |
| **V4 — Network / People** | contacts registry | known DIDs (people + avens), each showing shared sparks; home for one-time pairings. |

**Honest-design rules:** status must be visible (a calm *"Waiting — Bob is offline"* beats silent sync); revoke wording stops at "future changes"; Blind badge says **can't read** yet **does store**; "adding = full history" stated before confirm; "add relay" is a distinct affordance from "add person."

---

## 8. Execution — M0 / M1 / M2 / M3

### M0 — de-jazz collapse (clean the base before building on it)
*Goal: aven-db = local `RuntimeCore` + RocksDB + schema registry + peer connection handles, with **biscuit caps as the sole authorizer**. Delete the upstream multi-tier machinery avenOS never used (§0). Pure deletion + test rewrite — no behavior migration, because nothing in the avenOS path consumes it.*

**Verified preconditions (the cut is safe):**
- App consumes **none** of it: zero `ServerId` / `ClientRole` / `add_server` / `permission` refs in `app/src-tauri`, `aven-self`, `aven-city`.
- Local reactive reads are **server-independent**: `immediate_tick` fires subscription callbacks straight from `query_manager.take_updates()`; the server-propagation path is gated behind `should_send_local_subscription_upstream(..) && has_servers_or_pending_servers()` — **always false** in avenOS. The server tier is already *inert*, so deletion is cleanup, not behavior change.
- The only client avenOS registers is `ensure_client_as_peer`; ReBAC's `is_in_scope` branch is never exercised (peers short-circuit it).

**Surface (what the trace found — the cut is wide, ~28 src + 13 test files):**
- `ServerId` threads through: `sync_targets.rs`, `sync_manager/{types,mod,sync_logic,forwarding,sync_tracer,inbox}.rs`, `runtime_core/{ticks,mod,sync,writes}.rs`, `runtime_tokio.rs`, `query_manager/{subscriptions,server_queries,manager,writes}.rs`, `lib.rs`.
- `ClientRole`/ReBAC: `sync_manager/{types,mod,forwarding,permissions,sync_logic,inbox}.rs`, `runtime_core/sync.rs`, `query_manager/{server_queries,manager}.rs`.
- Tests to delete/rewrite: `runtime_core/tests/{sync_replay,basic,schema_catalogue,query_subscription,fk_remove_error,write_batch/*}.rs`, `schema_manager/integration_tests/tests/{query_subscription,sync,catalogue}.rs`.

**Order (delete leaves first, then the trunk — compile + test gate after each step):**
1. ✅ **Server tier** — *DONE* (commit `37df60f`, ~1850 lines / 18 files). Deleted `ServerId`, `ServerState`, the `Server` variants of `Source`/`Destination`/`SyncTargetId`, `add_server`/`remove_server` (RuntimeCore + TokioRuntime + SyncManager), `forward_*_to_servers`, `seal`/`force`/`retransmit_*_to_servers`, catalogue sync-to-server, `send_query_*_to_servers`, upstream subscription forwarding, and the `*_server_seq` / `parked_sync_messages_by_server_seq` ordering. `retained_batch_terminal_tier` rewritten local-only; **`DurabilityTier` enum kept** (batch_fate persistence). lib green both features; §9 harness 13/13; app green.
2. ✅ **ReBAC** — *DONE* (commit `899eae1`). The write-permission/policy-graph path was already dead (nothing ever constructed `PendingPermissionCheck`/`PolicyCheckState`). Deleted `permissions.rs`, `PendingPermissionCheck`, `pending_permission_checks`, `active_policy_checks`, `pick_up_pending_permission_checks`/`evaluate_write_permission`/`settle_policy_checks` + helpers. `ClientRole`/`is_in_scope`/role row-filtering were already absent on this path. `may_sync` (caps) is the only authorizer.
3. ✅ **Collapse client→peer** — *DONE incidentally*: `ClientState` is already a peer handle (`session` + `queries`, no role enum); `sent_batch_ids`/`sent_metadata` lived on the now-deleted `ServerState`; the peer path is frontier-driven (no per-peer ledger).
4. ⏳ **Tests** — *pending (M0-C)*. The in-crate runtime_core/schema_manager test suite is a **pre-existing broken graveyard** (~154 compile errors from removed helpers, predates this work) and `tests/{sync_core,sync_transport_codec}.rs` encode the killed tiers. The live acceptance suite is the §9 harness (`tests/{capability_gate,frontier_reconcile,dev_transport,loopback_transport}.rs`), which is green. Close-out: delete the machinery-encoding legacy tests and `DeliveryLedger` (exported but never instantiated). See §10.

**Risk & discipline:** this is the highest-blast-radius milestone (core query engine, hundreds of cascading compile errors). It is **pure cleanup of inert code**, not a fix — so it can be done in one focused pass but must gate on `cargo build -p groove` then `cargo test -p groove` after *each* of steps 1–3, never deleting ahead of a green compile. No app changes, no new features.

> M0 makes the next three milestones land on a base with one authorizer and one connection kind. Skipping it means M1 grows the frontier *beside* dead ReBAC/server code instead of replacing it.

### M1 — local two-instance live sync (device ↔ device, no aven)
*Goal: `bun dev:app2x:mac` → two devices discover by spark topic, biscuit-gate the Noise handshake, converge a spark's rows live, and heal across restart/reconnect. Proves transport + gate + frontier with zero server.*

**Build order (test-first):** §9 drives steps 1, 3, 5 red→green first (pure primitives on loopback); then 4 + 6 (reconcile loop + forwarding); then transport 7–9; then app 10–12. Each layer green before the next.

**aven-db** (additive, behind `peer-transport`; `AllowAll`/`DenyAll` keep local-only + tests unaffected):
1. ✅ **`CapabilityResolver` + `AccOp`/`ResourceCoord`/`CapDecision`** (§1.2) — the gate. *Landed* `src/capability.rs`; **T1 green** (`tests/capability_gate.rs`). The single authorizer; `may_sync(subject, op, res)` three-state.
2. `resource_urn(spark)` → 32-byte `topic = hash("spark:S")`; peeroxide computes the `discovery_key()` (§4).
3. **Frontier-diff tracker** (§1.3): ✅ `FrontierDag::heads` + pure stateless `frontier_diff` (DAG ancestor walk) *landed* `src/frontier.rs` (ungated, storage-free); **T2 + T6 green** (`tests/frontier_reconcile.rs`). *Remaining:* `FrontierAnnounce`/`FrontierNeed` payloads (couples to `SyncPayload`) + a storage adapter feeding the real DAG into `FrontierDag`.
4. **Anti-entropy reconcile loop** — ✅ pure core landed as `FrontierDag::pull_from` (frontier_diff → transfer missing → converge; **T5 green**). *Remaining (wiring):* emit `FrontierAnnounce(S)` on connect + on local seal; on `FrontierNeed`, ship the diff as **stored ciphertext** batches (so M2's blind mirror needs zero wire change).
5. ✅ **`LoopbackTransport: SyncTransport`** landed in `sync_transport.rs` (beside `NullSyncTransport`); **T4 green**. In-memory connected pair, drives the seam before any UDP.
6. **Peer-mesh forwarding** = `frontier_diff` → per-hop `may_sync` → `BatchId` dedup. After M0 the only clients are peers, so `forward_update_to_clients` **becomes** the frontier path outright (no role branch, no `sent_batch_ids` — both deleted). Wire **revoke** → `reevaluate` (stops new batches, never retro-deletes).

**aven-p2p** (fills the placeholder crate):
7. `HyperswarmTransport: SyncTransport` over peeroxide — `KeyPair`=device key, `discovery_key()`=topic join. Devices join **client mode**, finite `maxPeers`, sparks multiplex over one connection (§5).
8. **Handshake gate** — `remote_pubkey` → DID → `may_sync`; reject unauthorized fast, rate-limit Sybil. The DID *becomes* the biscuit subject here.
9. **Local bootstrap node** — one `peeroxide-dht` on `127.0.0.1` from `scripts/dev-two-instances.ts`; both instances bootstrap to it. Real DHT path, offline, no throwaway.

**app:**
10. **First contact (V4) — the one manual step.** M1 dev shortcut: paste DID → `sparkAdminAdd`. Shipping target: **blind pairing** (§5/V2). Without this, M1 has no authorized peer to converge with.
11. ✅ **`BiscuitCapabilityResolver` (§1.2) — injected, `AllowAll` retired.** *Landed* `app/src-tauri/src/biscuit_resolver.rs`: maps `SyncTargetId::Client(PeerId)` → did:key, `ResourceCoord(table,row)` → spark via the live `object_spark_ids` (`spark_sync`), then `spark_acc::authorize`; returns `Pending` until the vault + ACL hydrate (defers, never drops). Plumbed `set_resolver` `RuntimeCore → TokioRuntime → JazzClient` and injected in `jazz_connect`; `ship_frontier_diff` consults it before every spark-data frame. The shell catch-up (`SHELL_CATCHUP_TABLES` = sparks/keyshares) stays **ungated** so a new peer can still obtain its biscuits — full spark-data catch-up is now biscuit-gated. The resolver reads a `std::sync::RwLock` mirror of the shell (`ManagedJazz.sync_shell`) because `may_sync` is sync.
12. **Members (V1) + status (V3):** grant UI **done**; **revoke done** (`SparkMembersPanel.svelte` → `sparkAdminRevoke` IPC; honest confirm copy "stops new changes, keeps what they already received" per §7; backend wires `→ reevaluate`); **sync chip done** (per-member dot+label from the live `peerMeshSnapshot` via `meshPeerPhase`, never re-derived) and **global status done** ("everyone up to date" / "N still syncing"). i18n keys added (`sparks.share.{revoke,revoking,revokeConfirm,revokedNote,allSynced,pending,…}`, en+de). ✅ **Real mesh status landed:** `demo_mesh.rs` → `mesh.rs` (demo snapshot + command deleted); both the pushed `avenos:runtime` snapshot and the `meshStatus` IPC now build from real trusted-peer rows + `JazzClient::peer_client_ids` (live links) — a registered peer is `Syncing`/`LiveSyncing`, otherwise `Searching`/`Connecting`. *Remaining:* **convergence → `Ready`/`Usable`** — those variants were dropped because the stateless frontier model keeps no per-peer head ledger, so "fully converged" can't be asserted cheaply; emitting it needs a small per-peer "last diff empty" signal in `SyncManager` (a single bool, not the deleted batch ledger).

*Post-M1 (no engine change):* table/row-scoped grant minting in `spark_acc` (new URN builders, §1.1).

### M2 — local always-on aven (the scale primitive)
*Goal: a local `aven-server` binary, added to a spark by biscuit, that blind-mirrors so non-overlapping devices converge and n+ sparks scale.*
- New `aven-server` crate: headless `SyncManager` + `HyperswarmTransport` in **server mode**, full ciphertext history, `DurabilityTier::EdgeServer`, blind (replicate grant, no DEK).
- Multi-tenant: joins n+ topics; devices reconcile against it instead of all-to-all. Indexer serves a signed stable frontier for fast catch-up.
- App: **+ Add relay/backup** (distinct affordance, Blind badge). Multiple avens per spark. **No new gating** — the resolver already gates it by biscuit.

### M3 — hosted aven (deferred)
- Containerize the **same** `aven-server` → fly.io; bootstrap against public HyperDHT; salted/rotating topics. Graduation `Peer`→`Server` role: same biscuit, same protocol, zero code change above bootstrap config.

---

## 9. M1 TDD harness — frontier-diff convergence

Proof of the model with **zero networking**, on `LoopbackTransport` + N in-process `SyncManager`s. Colocated under `libs/aven-db/tests/`, behind `peer-transport`, mirroring `sync_core.rs`. Three pure units: `CapabilityResolver` (gate), `frontier_diff` (tracker), `LoopbackTransport` (seam).

| # | Test | Locks |
|---|------|-------|
| T1 ✅ | `resolver_three_state` — Allow/DenyPermanent/Pending for granted/revoked/un-hydrated | three-state; Pending never drops |
| T2 ✅ | `frontier_diff_is_pure` — exact missing batches; empty when equal; **DAG case** walks ancestors, not just head delta | stateless diff over a DAG |
| T3 ✅ | `heads_for_matches_union_of_storage_frontiers` — `heads_for` == union of `load_visible_region_frontier` | frontier == storage have-set (`tests/frontier_reconcile.rs`) |
| T4 ✅ | `loopback_delivers_frame` — frame on A arrives at B's `recv_inbound` | the seam (`tests/loopback_transport.rs`) |
| T5 ✅ | `a_to_b_converges` — row on A → one announce/need round → B's heads == A's | convergence *(`FrontierDag::pull_from`)* |
| T6 ✅ | `redirect_after_cache_loss_no_resend` — drop all per-peer state, re-diff → **zero** resent | no non-derivable state |
| T7 ✅ | `multi_hop_via_hub` — no direct A↔B; A↔H↔B (blind H) converges; 2-path dedup by `BatchId` | multi-hop safe; blind relay |
| T8 ✅ | `capability_gates_every_hop` — H relays to B iff B's biscuit grants S; revoke stops new, keeps old | per-hop gate; revoke wording (`gated_pull`, `tests/capability_gate.rs`) |
| T9 ✅ | `partition_heals_on_reconnect` — diverge offline, reconnect → frontier exchange heals | offline-first resilience |

**9 of 9 green (T1–T9)** — every invariant of the model is proven (`tests/frontier_reconcile.rs`, `tests/capability_gate.rs`, `tests/loopback_transport.rs`). `FrontierDag::pull_from` is the anti-entropy reconcile step (§8 M1 step 4); `gated_pull` is the per-hop gate ⨯ tracker integration point (step 6) — both stateless, idempotent, dedup-by-`BatchId`, path/order-independent, revoke-not-retroactive. **T6 + T7 green is the proof that a per-peer ledger is unnecessary** — peeroxide is now just one more `impl SyncTransport` under an already-proven model. **The entire §9 harness is green.** What remains is purely the *production wiring* — swapping these proven primitives (`frontier_diff`, `pull_from`, `gated_pull`, `heads_for`, `may_sync`) into the live `forward_update_to_clients`, adding `FrontierAnnounce`/`FrontierNeed` to `SyncPayload`, and deleting `sent_batch_ids` — a mechanical change onto an already-green model, plus the (sandbox-blocked) peeroxide transport.

---

## 10. Close-out — prove & finish the live loop

M0 (de-jazz collapse) and M1's *engine* are landed: one authorizer (biscuit
caps), one tracker (frontier), real dev transport, real mesh UI. What remains is
not architecture — it is **proving the live loop end-to-end** and tidying two
loose ends. Each item names its **acceptance check**; gate on `cargo build`
(lib default + `client-p2p`) + the §9 harness staying green.

> **Status (current).** Code-complete + harness-verified (§9 now **14 green**):
> - ✅ **10.2** convergence → "Up to date" (`3e1b362`).
> - ✅ **10.4** dead-code (`DeliveryLedger`/`SyncAuthorizer`) removed (`cede88f`).
> - ✅ **Live bug fixes landed:** shell-bootstrap on connect — the spark now
>   crosses (`b2d1a2e`); grant → `rebroadcast_all_peer_clients_and_flush` so
>   pre-grant data re-ships (`4521702`); per-row gate-verdict tracing (`e553f44`);
>   **T10** test proving grant→reship (`6ba2e17`).
> - ⏳ **10.1** the *live two-instance GUI* confirmation is the one thing that
>   can't be automated here — mechanisms are harness-proven; a human runs the
>   final `dev:app2x:mac` check (the `gate:` trace names any remaining withhold).
> - ⛔ **10.3** real `HyperswarmTransport` — **environment-blocked** (peeroxide
>   unavailable in sandbox), not a code gap. Dev-TCP is the working stand-in.
> - ◻️ **UX (design choices, deferred to owner):** invite-code pairing (replace
>   two-sided DID paste) + peer **name exchange** (peers table is local-only today,
>   so a peer renders as "Peer"). Not bugs — product decisions.

### 10.1 Prove the live grant→sync loop (`bun dev:app2x:mac`)
The whole point: *"select peers, then sync based on the admin biscuits of a spark
member."* Verify the chain that the unit harness proves in-process actually fires
across two real instances over the dev TCP transport.

1. **Pair.** A & B each open the Peers screen, copy their DID, paste the other's,
   Add. `AVENOS_DEV_PEER_SYNC` connects the dev TCP transport (A listens, B
   dials `127.0.0.1:14290`). **Check:** each peer chip flips `Connecting →
   Syncing` (real `peer_client_ids` registration), not stuck.
2. **Bootstrap trust.** Shell catch-up (`SHELL_CATCHUP_TABLES` = sparks,
   keyshares) ships **ungated** so B's vault receives the spark biscuit chain.
   **Check:** B's `BiscuitVault.sparks` contains the spark after pairing.
3. **Grant.** On A, Spark Members → add B's DID (`sparkAdminAdd`) → mints a
   biscuit grant for B on spark S. **Check:** B's vault holds a grant whose
   subject is B's did:key for `spark:S:`.
4. **Gated convergence.** A writes a row in spark S → `FrontierAnnounce` →
   B `FrontierNeed` → `ship_frontier_diff` → `may_sync(Client(B), Write,
   spark:S:row)` → **Allow** → B converges. **Check (positive):** the row
   appears on B. **Check (negative):** a row in a spark B is *not* a member of
   → `DenyPermanent` → never reaches B (no leak).
5. **Revoke not retroactive.** A `sparkAdminRevoke(B)` → `reevaluate` stops
   *new* batches; B keeps what it already holds. **Check:** post-revoke writes
   on A do not reach B; pre-revoke rows remain on B.

*If a step fails, the fix is wiring/ordering (e.g. re-announce after vault
hydrate so the resolver re-asks once it can authorize), not model change.*

### 10.2 Convergence → `Ready`/`Usable` (deferred status)
Today a linked peer shows `Syncing` forever — the stateless frontier keeps no
per-peer head ledger, so "caught up" can't be asserted. Add the **one** cheap
signal that does not reintroduce a ledger: after `ship_frontier_diff` computes an
**empty** diff for a peer, record a single `bool` ("frontier converged for this
peer") in `SyncManager`; clear it on any local seal/announce. Surface it through
the mesh snapshot → re-add `PeerMeshPhase::Ready` / `PeerUsability::Usable`.
**Check:** after convergence the chip reads "Up to date"; a new local write flips
it back to `Syncing` until the next empty diff.

### 10.3 Real transport (`aven-p2p` `HyperswarmTransport`) — external blocker
Steps 7–9 (peeroxide `HyperswarmTransport` + local bootstrap DHT) are
**sandbox-blocked** (peeroxide dependency). The seam is ready: it is "one more
`impl SyncTransport`" under the already-proven model, and `dev_transport.rs`
(TCP) is the working stand-in. **Action:** unblock peeroxide, then implement
`HyperswarmTransport` and wire it from the app host exactly where
`try_dev_peer_transport` wires the TCP one. No engine change.

### 10.4 Legacy test graveyard + `DeliveryLedger` (M0-C cleanup)
The in-crate `runtime_core`/`schema_manager` test modules (~154 pre-existing
compile errors, removed helpers) and `tests/{sync_core,sync_transport_codec}.rs`
encode the killed server/ReBAC tiers. Per §0 "delete + rewrite the tests that
encode them": delete the machinery-encoding cases; keep/restore only
local-query + schema-registry coverage if cheap. Also delete `DeliveryLedger` /
`delivery_ledger.rs` (exported but never instantiated). **Check:**
`cargo test -p aven-db` compiles and the surviving suite is green.

**Definition of done:** §10.1 all checks pass live; §10.2 chip reaches "Up to
date"; §10.4 `cargo test` green. §10.3 stays open until peeroxide is unblocked —
the only thing standing between the dev-TCP proof and a real mesh.

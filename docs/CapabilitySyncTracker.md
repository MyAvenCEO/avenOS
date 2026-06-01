# Capability-driven sync — architecture & execution

**Status:** spec · **Owner:** sync/aven-db · **Scope:** how AvenOS syncs spark data between peers, gated by biscuits, over a Hyperswarm-class transport.

**Thesis.** Every value syncs to exactly the peers a biscuit authorizes; the network self-assembles (discover · pair · sync · heal) in the background. The whole frontend reduces to *"manage who's in each spark."*

**Today:** the biscuit check is real and row-capable (`spark_acc::authorize`); the transport seam is real and DID-keyed (`SyncTransport`, `SyncTargetId::PeerDid`); but live peer forwarding has **no capability gate** and no real transport (`peer/api.ts` is demo, `aven-p2p` is a placeholder). This doc closes that gap with **one model** and ships it in three phases (§8).

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

**No per-peer delivery ledger; nothing to persist.** Reconciliation is a stateless diff + `BatchId` dedup, so losing all cached/per-peer state forces a re-diff — never data loss, never an erroneous re-send. (The legacy `DeliveryLedger` / `ClientState.sent_batch_ids` stays confined to the old client/server path; the mesh path never touches it.)

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

**One tracker** — the per-resource frontier is the only authority; any per-peer/cached state is a derivable optimization, never truth. Mesh sync holds **no non-derivable state**: dropping it forces a re-diff, never loss or erroneous resend (T6). Rows travel as stored **ciphertext**.

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

## 8. Execution — M1 / M2 / M3

### M1 — local two-instance live sync (device ↔ device, no aven)
*Goal: `bun dev:app2x:mac` → two devices discover by spark topic, biscuit-gate the Noise handshake, converge a spark's rows live, and heal across restart/reconnect. Proves transport + gate + frontier with zero server.*

**Build order (test-first):** §9 drives steps 1, 3, 5 red→green first (pure primitives on loopback); then 4 + 6 (reconcile loop + forwarding); then transport 7–9; then app 10–12. Each layer green before the next.

**aven-db** (additive, behind `peer-transport`; `AllowAll`/`DenyAll` keep local-only + tests unaffected):
1. `CapabilityResolver` + `AccOp`/`ResourceCoord`/`CapDecision` (§1.2) — the gate.
2. `resource_urn(spark)` → 32-byte `topic = hash("spark:S")`; peeroxide computes the `discovery_key()` (§4).
3. **Frontier-diff tracker** (§1.3): `heads_for`, stateless `frontier_diff` (DAG ancestor walk), `FrontierAnnounce`/`FrontierNeed`.
4. **Anti-entropy reconcile loop** — emit `FrontierAnnounce(S)` on connect + on local seal; on `FrontierNeed`, ship the diff as **stored ciphertext** batches (so M2's blind mirror needs zero wire change). Makes T5 pass.
5. **`LoopbackTransport: SyncTransport`** in `test_support` → drive the §9 suite (A↔B and A↔H↔B) before any UDP.
6. **Peer-mesh forwarding** = `frontier_diff` → per-hop `may_sync` → `BatchId` dedup. Wire **revoke** → `reevaluate` (stops new batches, never retro-deletes). Do **not** extend `DeliveryLedger`.

**aven-p2p** (fills the placeholder crate):
7. `HyperswarmTransport: SyncTransport` over peeroxide — `KeyPair`=device key, `discovery_key()`=topic join. Devices join **client mode**, finite `maxPeers`, sparks multiplex over one connection (§5).
8. **Handshake gate** — `remote_pubkey` → DID → `may_sync`; reject unauthorized fast, rate-limit Sybil. The DID *becomes* the biscuit subject here.
9. **Local bootstrap node** — one `peeroxide-dht` on `127.0.0.1` from `scripts/dev-two-instances.ts`; both instances bootstrap to it. Real DHT path, offline, no throwaway.

**app:**
10. **First contact (V4) — the one manual step.** M1 dev shortcut: paste DID → `sparkAdminAdd`. Shipping target: **blind pairing** (§5/V2). Without this, M1 has no authorized peer to converge with.
11. `BiscuitCapabilityResolver` (§1.2) — inject into `SyncManager`.
12. **Members aside (V1):** grant UI **done**; remaining — **revoke** (`sparkAdminRemove` + button → `reevaluate`) and the **sync chip (V3)**; replace demo `peer/api.ts` with real `peerMeshStatus`/`peerRevoke` IPC.

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
| T1 | `resolver_three_state` — Allow/DenyPermanent/Pending for granted/revoked/un-hydrated | three-state; Pending never drops |
| T2 | `frontier_diff_is_pure` — exact missing batches; empty when equal; **DAG case** walks ancestors, not just head delta | stateless diff over a DAG |
| T3 | `heads_for_matches_storage` — `heads_for` == union of `load_visible_region_frontier` | frontier == storage have-set |
| T4 | `loopback_delivers_frame` — frame on A arrives at B's `recv_inbound` | the seam |
| T5 | `a_to_b_converges` — row on A → one announce/need round → B's heads == A's | convergence |
| T6 | `redirect_after_cache_loss_no_resend` — drop all per-peer state, re-diff → **zero** resent | no non-derivable state |
| T7 | `multi_hop_via_hub` — no direct A↔B; A↔H↔B (blind H) converges; 2-path dedup by `BatchId` | multi-hop safe; blind relay |
| T8 | `capability_gates_every_hop` — H relays to B iff B's biscuit grants S; revoke stops new, keeps old | per-hop gate; revoke wording |
| T9 | `partition_heals_on_reconnect` — diverge offline, reconnect → frontier exchange heals | offline-first resilience |

**T6 + T7 are load-bearing** — exactly what a per-peer ledger *cannot* express and the frontier model makes trivial. Build T1–T5 (single hop, happy path) first, then T6–T9. If T6/T7 pass on loopback, peeroxide is just one more `impl SyncTransport` under an already-proven model.

# Capability-driven sync tracker — architecture spec

**Status:** draft · **Owner:** sync/aven-db · **Supersedes:** the deleted legacy P2P forwarding gate (`spark_sync::should_forward_p2p`, `biscuit_sync_authorizer`).

One **transport-independent** utility that, for every row batch, answers a single question:

> *Which remote peer DIDs is this row owed to, which have already received it, and which may never receive it?*

The **only** input to that decision is the **biscuit capability set** — `subject_did × op × resource`. Spark-scoping is just *one* resource-naming convention; the engine must never know the word "spark."

---

## 1. Why

Three layers exist today, none connected:

| Layer | Status | Where |
|-------|--------|-------|
| **Capability check** (biscuit) | ✅ Already generic & row-capable | `app/src-tauri/src/spark_acc.rs:202` (`authorize`) |
| **DID-keyed delivery tracker** | ⚠️ Exists, **never wired** | `libs/aven-db/src/delivery_ledger.rs` |
| **Authorizer trait** | ⚠️ Too coarse (payload-level), never instantiated | `libs/aven-db/src/sync_authorizer.rs` |
| **Live peer forwarding** | ❌ **No capability gate** — sends all to any `Peer`; tracking dies on disconnect | `libs/aven-db/src/sync_manager/forwarding.rs:391` |

The biscuit resource URN is **already** hierarchical — `spark:{id}:{table}:{row_id}` checked via `right(op, prefix)` + `$r.starts_with($prefix)`. Row-level caps already *work*; nothing mints or enforces them. The work is to **unify these three layers into one capability-driven, DID-keyed tracker owned by the engine.**

---

## 2. Core model

### 2.1 Resource addressing — opaque hierarchical URN

```rust
// aven-db — knows nothing about "spark"
pub struct ResourceCoord {
    pub urn: String,      // opaque: "spark:UUID:todos:ROWID", "org:42:billing", …
    pub table: String,
    pub row_id: ObjectId,
}
```

The engine treats `urn` as opaque. **Granularity lives entirely in how the app builds the URN and mints grants.** No engine change is needed to add a granularity level:

| Grant | Biscuit fact | Covers |
|-------|--------------|--------|
| Spark admin (today) | `owns(did,"spark:S")` + `right(write,"spark:S:")` | all tables & rows in spark `S` |
| Table cap | `right(write,"spark:S:messages:")` | only `messages` rows |
| Row cap | `right(read,"spark:S:files:ROW")` | one row |

Because `authorize()` already matches by **prefix** and already accepts `row_id: Option<Uuid>`, all three are expressible **today** with zero engine change. That is the test of "fully generically abstracted."

### 2.2 `CapabilityResolver` — replaces the coarse `SyncAuthorizer`

```rust
// aven-db — policy-free
pub enum AccOp { Read, Write, Delete }   // shared vocabulary, lifted down from the app

pub enum CapDecision {
    Allow,
    DenyPermanent,   // local-only table, revoked → never re-queue
    Pending,         // ACL not hydrated / trust not yet established → DEFER, don't drop
}

pub trait CapabilityResolver: Send + Sync {
    fn may_sync(&self, subject: &SyncTargetId, op: AccOp, res: &ResourceCoord) -> CapDecision;
}
```

Upgrade over today's `may_deliver(target, payload)`: the ledger hands the resolver a **structured `(subject, op, resource)`** triple, so the resolver is a thin biscuit lookup — it never re-parses `SyncPayload`. The **three-state** decision makes the pairing/bootstrap window correct (the old implicit `bootstrap_hold` vs `permanent` drop, now first-class).

### 2.3 The tracker — engine-owned, DID-keyed, four states

Decision **(answer #1): the ledger lives inside `aven-db`'s `SyncManager`** as the single source of truth, replacing the per-connection `ClientState.sent_batch_ids` bookkeeping.

```rust
pub struct SyncLedger {
    delivered: HashMap<SyncTargetId, HashSet<RowBatchKey>>, // durable memo (see §3)
    pending:   HashMap<SyncTargetId, HashSet<RowBatchKey>>, // allowed, not yet sent
    deferred:  HashMap<SyncTargetId, HashSet<RowBatchKey>>, // blocked on Pending caps
    denied:    HashMap<SyncTargetId, HashSet<RowBatchKey>>, // DenyPermanent memo
}
```

- **Keyed by `SyncTargetId::PeerDid`** → the record exists *before the peer ever connects* ("future remote peer", transport-independent). This is the structural fix: durable "what's owed" moves **out of** `ClientState` (which dies on disconnect) into DID-keyed state. A live `ClientId` becomes a transient *route* to a DID, not the identity itself.
- **`offer(target, key, op, res)`** consults the resolver → `Allow`→`pending`, `Pending`→`deferred`, `DenyPermanent`→`denied`. Idempotent across all four sets.
- **`reevaluate(target)`** on capability-epoch change (grant/revoke):
  - newly **allowed**: `deferred → pending`,
  - newly **revoked**: `delivered`/`pending → denied` (this is what makes "stop syncing on revoke" actually happen).
- **"What was synced to whom"** = a pure read of `delivered`.

> **Correction (per Hypercore/Keet prior art, §6.1).** The *authoritative* tracker is the **local per-resource frontier** (their "have" bitfield over a log; ours = causal heads over the DAG). The four per-peer sets above are an **optimization cache, not a source of truth** — reconciliation is a stateless frontier *diff*, so losing the cache forces a re-diff, never incorrectness. Build the per-resource frontier first; treat the per-peer ledger as bandwidth-saving on top.

### 2.4 Single integration point

`forward_update_to_clients` (`forwarding.rs:381`) stops blanket-sending to `Peer` clients. Per peer candidate it resolves the row's `ResourceCoord`, calls `ledger.offer(...)`, and emits the `OutboxEntry` only for `pending`. Catch-up replay (`queue_full_catchup_to_peer_*`) and revoke-invalidation route through the **same** ledger — one code path from "row changed" → "frame to DID."

### 2.5 App-side resolver (only biscuit-aware code)

`BiscuitCapabilityResolver` (app) implements `CapabilityResolver`:

1. map `ResourceCoord` → spark UUID (salvage `object_spark_ids` / `spark_id`-column logic from the deleted `spark_sync`),
2. call `spark_acc::authorize(vault, spark, op, table, row_id, subject_did)`,
3. return `Pending` when the ACL snapshot / biscuit for that resource isn't hydrated yet.

This is the deleted `should_forward_p2p`, reborn behind the generic trait and fed structured coords.

---

## 3. Persistence — does the ledger belong in the Groove/Jazz DB? *(open question from review)*

**Recommendation: split by re-derivability, and dogfood only the part that can't be recomputed — as a local-only table.**

Of the four ledger sets, three are **ephemeral** and must be recomputed at unlock, never persisted:
- `pending` / `deferred` — a function of (current row state) × (current biscuit ACL). Both inputs are already durable (rows in storage; `sparks`/`keyshares` rows). Recompute on hydrate.
- `denied` — re-derivable from policy; a memo only.

Only **`delivered`** (the per-DID acked-batch set) is genuinely non-derivable — it records a *past network fact*. Persisting it is the only thing that prevents re-sending every batch to every paired peer after a restart.

**If we persist `delivered`, storing it in the Groove DB is reasonable dogfooding — but with three hard guardrails:**

1. **Local-only / `no-sync` table.** The ledger gates what syncs to peers; if the ledger table itself synced, you get a feedback loop (tracking the delivery of your delivery-tracking rows). It must sit alongside `peers`/`humans` on the never-forwarded list (`forwarding.rs:648`).
2. **Write-behind checkpoint, not hot-path authority.** The in-memory `SyncLedger` in `SyncManager` stays the per-frame decision surface (HashMap lookups). The table is flushed asynchronously and read **only** at hydrate to seed `delivered`. Forwarding must never hit storage per candidate.
3. **Compact, append-coalesced.** Store a per-DID high-water set (or batch-id roaring set), not one row per `(DID, batch)` transition — otherwise every delivered batch becomes its own row-history batch, doubling write volume into RocksDB.

**Alternative (simpler, ship-first):** keep `delivered` in-memory only and accept idempotent re-send after restart (the receiver dedups by `BatchId`). This matches today's rebroadcast-on-reconnect model and needs no schema. Recommended for Phase 1; promote to the guarded Groove-DB table in a later phase if restart bandwidth proves to be a real cost.

---

## 4. Phasing

1. **aven-db (additive, no behavior change):** add `AccOp`, `ResourceCoord`, `CapDecision`, `CapabilityResolver`; fold the four buckets into `DeliveryLedger` → `SyncLedger`. Keep `AllowAll`/`DenyAll` as trivial resolvers.
2. **aven-db (wire-in):** drive `forward_update_to_clients` through `SyncLedger` + a resolver handle; migrate `ClientState.sent_batch_ids` → DID-keyed ledger. Default resolver `AllowAll` so servers/tests are unaffected.
3. **app:** implement `BiscuitCapabilityResolver` (salvage spark→resource mapping); inject into `SyncManager`. Re-establishes the biscuit enforcement that was dormant.
4. **app:** add table/row-scoped grant minting in `spark_acc` (new URN builders) once spark-scope is proven end-to-end.
5. **(optional) persistence:** add the guarded local-only `delivered` checkpoint table in the Groove DB per §3.

---

## 5. Distributed end-state (target: trusted friend mesh)

The eventual goal is a **strong P2P trusted network of friends — up to ~500 paired peers each — auto-routing and syncing every value the biscuits permit, including multi-hop mesh relaying**, over a Hyperswarm-style transport (peeroxide: DHT discovery, holepunch, noise streams). Granularity is **spark/group-scoped** (not row-level), and **each spark may name an always-on hub peer** (which can later graduate into a DHT/relay-hosted server).

Three reframes make that scale (vs. the per-peer Phase-1 ledger):

1. **Delivery tracking → convergence.** In a CRDT mesh there is no "did I deliver batch X to peer P." There is only "is resource S converged between me and P." Same batch via 3 paths dedups by `BatchId`; gaps self-heal via `BatchFateNeeded`. **Path and order stop mattering — which is what makes multi-hop relaying safe by construction.**
2. **Per-(peer × batch) sets → per-resource frontier + per-(peer,resource) cursor.** Reconcile by exchanging causal frontiers (heads) and shipping the diff. Memory O(peers × batches) → O(resources × frontier + peers × resource-cursor). This is what survives 500 peers.
3. **Capability = swarm membership = routing constraint.** Holding a biscuit for spark S *is* the subscription to S (`topic = hash("spark:S")`). Discovery is emergent from caps — no config. A relay forwards S's batches to peer C **iff C presents a valid biscuit for S**; the capability check runs at *every hop*, so a batch only flows along fully-authorized paths.

**Resilience properties:** offline-first (full local state per held resource; works partitioned); reconnect heals via frontier exchange regardless of downtime or path; multi-path mesh gives redundancy. Integrity is unconditional — batches are hash-linked and biscuits unforgeable, so a malicious *authorized* relay can stall but cannot forge or leak; availability through one bad relay isn't guaranteed (→ multiple paths).

### 5.1 The per-spark hub (relay + backup + indexer)

Each spark **may name an always-on hub peer** that unifies three roles, all expressed as a single capability grant — the hub is not a special node type, just a peer with a particular biscuit:

| Role | Solves | Maps to |
|------|--------|---------|
| **Relay / rendezvous** | friends never online simultaneously never converge | Hyperswarm *server mode* — announces the spark topic continuously |
| **Backup / durability** | spark dies if all member devices are lost | holds the **full** row-history; `DurabilityTier::EdgeServer` |
| **Indexer / fast catch-up** | new devices fast-forward from one complete replica, not fragments from flaky peers | hub-signed *stable frontier* (Autobase "signed length" analogue, on `confirmed_tier`) |

**Decision — blind vs. full member (default: blind).** Spark data is encrypted (DEK + `keyshares`, `rotate_dek`):
- **Model A — Blind relay/backup (default).** Hub stores/forwards *ciphertext* and keeps full encrypted history, but is **not** granted the DEK → guarantees availability + durability and **cannot read content** (this is Keet's "blind mirror"). Biscuit grants *replicate ciphertext for `spark:S`*, not `owns`.
- **Model B — Full member replica.** Hub also holds the DEK → can read plaintext, enabling server-side query/indexing, but becomes a **trust party** (compromise = content leak). Reserve for self-hosted/fully-trusted hubs.

**Graduation:** today a friend's always-on device (`Peer` role) → later a hosted VPS announcing the topic (`Server` role). Same biscuit, same protocol. Allow **multiple hubs per spark** so the hub is not a single point of failure. Integrity is unconditional regardless of hub trust — batches are hash-linked and signed, so a malicious hub can stall/withhold but never forge.

**Known caveats to design against:** topic explosion (mitigated by spark-grain discovery — never one topic per row); connection count is the real ceiling (500 live holepunched streams on mobile → connection scheduling + hub rendezvous, not memory); DHT metadata leakage (`hash(resource)` is observable → salted/rotating topics); Sybil handshake spam (fast biscuit-reject + rate-limit).

---

## 6. Interface preparation (buildable today, zero networking)

**Key finding: the transport seam and wire format already exist and are already transport-agnostic.** Hyperswarm/peeroxide is *only* a future `impl SyncTransport`. So preparation means filling the layers **above** the transport and exercising them over a loopback transport — no UDP required.

Already present in `aven-db`:
- `SyncTransport` trait — `send_to(target, payload)` / `recv_inbound() -> InboxEntry` (`sync_transport.rs:94`). The future mesh is one impl of this.
- `SyncFrameV1 { target, payload }` + length-prefixed bincode framing — the over-the-wire bytes are already defined and transport-neutral.
- `SyncTargetId::PeerDid` — addressing already keyed by DID, not connection.
- `NullSyncTransport` — the local-only impl swapped out later.
- `CapturedFrontierMember = (object_id, branch, batch_id)` in `batch_fate.rs` — the frontier primitive already exists at seal time.

What to build now, all pure/local and testable:

| # | Prep item | Where | Notes |
|---|-----------|-------|-------|
| 1 | **`CapabilityResolver`** (`AccOp`/`ResourceCoord`/`CapDecision`) + `BiscuitCapabilityResolver` (spark-scoped) | aven-db trait + app impl | The one real gap; also the per-hop relay gate. Re-enables biscuit enforcement **today**, in-process. |
| 2 | **Resource→topic derivation** — `resource_urn(spark)`, `topic_key(urn)->[u8;32]` | new pure module | Deterministic; lock it now so the future topic is stable forever. |
| 3 | **Per-spark hub role** — optional `hub_did`, modeled as a preferred `SyncTargetId` | spark metadata + resolver flag | Inert/loopback today; `Peer`→`Server` upgrade later with zero gating change. |
| 4 | **Frontier-exchange vocabulary** — `SyncPayload::FrontierAnnounce { resource, heads }` / `FrontierNeed` | extend `SyncPayload` | Pull half already exists (`RowBatchNeeded`/`BatchFateNeeded`). |
| 5 | **Per-resource frontier API** — `heads_for(resource) -> Vec<RowBatchKey>` | aven-db | Reuses `captured_frontier`/`row_histories`. The reconciliation atom. |
| 6 | **`SyncLedger` as resource cursors** (per-(peer,resource), not `HashSet<RowBatchKey>`) | the §2.3 ledger | Build the 500-peer shape from day one. |
| 7 | **In-memory loopback `SyncTransport`** wiring 2+ `SyncManager`s | `test_support` | Simulate A↔B↔C multi-hop + capability gating + convergence entirely in tests — validates the model before networking exists. |

```
            ┌─ CapabilityResolver  (biscuit: who may sync resource S)   ← #1
SyncManager ┼─ SyncLedger          (per-(peer,resource) cursors)         ← #6
            ├─ Frontier API        (heads_for(S))                        ← #5
            └─ anti-entropy loop ── FrontierAnnounce/Need ───┐           ← #4
                                                             │
                            ┌────────────────────────────────┴──┐
                            │        SyncTransport (trait)        │       ← already exists
                            ├──────────────┬─────────────────────┤
                       NullSyncTransport   │   LoopbackTransport  │  …future: HyperswarmTransport
                                           └──────── #7 ──────────┘
```

When peeroxide lands, you write **one** new `impl SyncTransport` plus a `topic_key`→swarm-join binding. Nothing above the line changes — resolver, ledger, frontier protocol, and tests already exercise that exact boundary. Items **#1** (real enforcement now) and **#7** (multi-hop test harness) carry immediate value beyond future-proofing.

### 6.1 Transport choice (decided)

**Layering:** Holepunch's stack splits into transport (HyperDHT + Hyperswarm + secret-stream) and data (Hypercore + Autobase). **Groove *is* our data/CRDT layer** — keep it; do **not** adopt Autobase (it would duplicate Groove's DAG linearization). Adopt only the **transport** half, behind `SyncTransport`. The swarm gives exactly two things — peer discovery by topic + an authenticated encrypted pipe — **not** sync; we still own the frontier-reconciliation protocol (#4/#5) over the pipe.

**Identity alignment (free win):** secret-stream uses a Noise XX handshake with **Ed25519** keypairs; our DID is already Ed25519-derived (`jazz_auth`). Bind the secret-stream static key to the device identity → the transport-authenticated remote key **is** the biscuit subject DID, feeding `CapabilityResolver::may_sync` directly.

**Rust implementation — `peeroxide` v1.3.1 (confirmed pure-Rust library crate).** "Rust port of Hyperswarm" over `peeroxide-dht` (Kademlia DHT + Noise handshake + holepunching) + `libudx` (reliable UDP); wire-compatible with the public HyperDHT network, no JS. API maps directly onto `SyncTransport`:

| `SyncTransport` need | peeroxide API |
|----------------------|---------------|
| open swarm | `spawn(SwarmConfig) -> SwarmHandle` |
| topic join (`topic_key`) | `JoinOpts` + **`discovery_key()`** — call *theirs* (BLAKE2b-256) so topics stay wire-compatible; do **not** roll our own hash in #2 |
| authenticated pipe + peer identity | `SwarmConnection { remote_pubkey, stream }` — `remote_pubkey` is **Ed25519** → bind to the biscuit DID |
| local identity key | `KeyPair` (Ed25519) = device root key |
| hub presence / signed frontiers (optional) | `HyperDhtHandle` mutable/immutable storage |

Still wrap it in a thin `HyperswarmTransport: SyncTransport` adapter (good hygiene, keeps the swap option open: `datrs/hyperswarm-rs` or a Bare sidecar), but no blocking risk remains. The §6 prep work is independent of this and can proceed now.

### 6.2 Prior art validation (Hyperswarm / Hypercore / Autobase / Keet)

- **"Unlimited peers" = bounded live connections + relays/mirrors.** Hyperswarm caps with `maxPeers`; Keet's *big rooms* only scaled via **Blind Mirrors** (relay/mirror peers). Confirms: 500-way fan-out is a topology problem → solved by the §5.1 hub, not the tracker.
- **Per-resource summary, not per-peer-per-item.** Hypercore replication = compressed "have" **bitfield** + Merkle tree, sparse pull. Validates per-resource frontier over `HashSet<RowBatchKey>`.
- **Autobase == our model.** Multi-writer logs → causal DAG → deterministic linearized `apply`, forks reordered as info arrives; **signed-length checkpoints** let peers fast-forward → our hub-signed stable frontier (§5.1) + `DurabilityTier`.

---

## 7. Invariants

- aven-db contains **zero** biscuit/spark knowledge; all policy is behind `CapabilityResolver`.
- Every outbound peer frame passes through exactly one `ledger.offer(...)`.
- `Pending` never drops a frame — it defers; only `DenyPermanent` is terminal.
- The ledger is keyed by DID, so it is meaningful for peers that have **never connected** and survives reconnects.
- Adding a granularity level (spark → table → row) is a grant-minting + URN-building change only; the engine, trait, and `authorize()` are untouched.

---

## 8. UX model

**Mental model:** the entire frontend reduces to *"manage who's in each spark"* — grant/revoke biscuits — and the network self-assembles (pair · sync · link · heal) in the background. Three seams where "magic" must be made honest in the UI:

1. **First contact needs the peer's DID** → one unavoidable invite/scan step; **automatic forever after** for that contact.
2. **Direct p2p only converges when both devices are online at once** → the per-spark **blind hub (§5.1)** is what makes *offline-friendly* sync real; surface it as *"add an always-on relay so this spark syncs even when devices are offline at different times."*
3. **Revoke is not retroactive** → wording is *"stops sharing new changes; they may keep a copy of what they already received,"* never *"removes access to the data."*

### 8.1 Two-layer separation (the key principle)

Do **not** build one "peers" screen. It is two surfaces, and separating them is what makes it feel magical:

```
  PEOPLE / NETWORK            per-SPARK ACCESS
  (who you know)              (what they can do)
  ── one-time DID trust ──►   ── pure capability toggles ──►  background: pair · sync · link · heal
  invite / scan once          grant / revoke biscuits
```

- **People/Network layer** — the *only* home for first-contact/pairing; reusable across all sparks. Successor to the removed "Connect with Peer" UI.
- **Spark Access layer** — pure access control on *known* DIDs; contains **no networking concepts**. Sync is shown as a status consequence, never configured.

### 8.2 The four views

| View | Purpose | Key elements |
|------|---------|--------------|
| **V1 — Spark › People & Access** (primary) | who's in the spark + their access | member rows: name · **role** (Admin/Member/Viewer = capability bundles) · **sync chip** (Synced ● / Syncing ◌ / Waiting–offline ○ / via Relay ⇄) · revoke. **+ Add member** (pick contact / invite new). **+ Add relay/backup** (distinct; **Blind** by default, badge *"keeps a backup, cannot read"*). |
| **V2 — First contact** | the one human step | invite link + QR (bundles the future biscuit + spark topic + your DID); acceptance returns their DID and completes the grant. Copy: *"They'll receive the full history of this spark."* |
| **V3 — Sync status** | calm, ambient observability | per-member chips; optional disclosure (direct vs relayed, last synced, items pending). **Never** a diagnostics JSON dump (that was the old anti-pattern). One global "all synced / N pending" signal. |
| **V4 — Network / People** | contacts registry | known DIDs (people + relays/hubs), each showing which sparks are shared; home for one-time pairings. |

### 8.3 Honest-design rules

- **Status must be visible** — invisible background sync is frightening when a peer is offline; a calm *"Waiting — Bob is offline"* chip turns silence into an understood state.
- **Revoke wording** stops at "future changes," never implies remote deletion.
- **Blind relay** badge: clearly **can't read** (trust comfort) yet **does store** ciphertext (privacy honesty).
- **Adding = full history** — state it before confirm.
- **Add relay = distinct affordance** from adding a person, framed by the offline-sync need.

> Build order suggestion: **V1** first (the hub everything hangs off), then **V2** (first contact), then **V3** (status) layered in as the transport lands; **V4** can start as a thin list and grow.

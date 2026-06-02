# Aven Server — unified TCP/TLS sync-backup + auth platform (end-to-end plan)

**Status:** plan · **Owner:** sync / platform · **Supersedes:** the *Transport* (§4) and *M2/M3* milestones of [`CapabilitySyncTracker.md`](./CapabilitySyncTracker.md). The capability/frontier model (§0–§3, §6, §9 of that doc) stands unchanged — this plan only sets the **transport** under it and **consolidates the servers above it**.

**Thesis.** Today three things sit beside the engine: a dev **TCP transport** (a 2-peer localhost stand-in), a TypeScript **auth-server** (`aven-auth`, device registration / invites), and a *planned* **sync relay** (the always-on "aven"). Three runtimes, three identities, three deploys. This plan collapses them into **one Rust binary — `aven-server`** — the network's *single source of truth*: it **admits devices** (auth), and it is the **blind mirror + rendezvous + indexer** reachable over **one authenticated TCP/TLS port**. N device peers dial the aven, converge via the already-proven frontier protocol, and get blind off-device durability — **no DHT, no NAT holepunch**. Everything that matters — frontier reconciliation, the biscuit gate, the blind-relay capability, the auth↔pairing merge — lives **above** the `SyncTransport` seam, so it is built once here.

> **Direct peer-to-peer mesh (peeroxide Hyperswarm) is explicitly out of scope of this plan** and parked as a board item — [`libs/aven-board/board/inbox/0003-p2p-mesh-peeroxide.md`](../libs/aven-board/board/inbox/0003-p2p-mesh-peeroxide.md). Its P0 spike is *already done and proven* (API pinned, duplex solved, local bootstrap working, smoke passing) and preserved there; it returns later as a *second* `impl SyncTransport` behind the same seam, **after** this TCP/TLS server ships and its NAT-holepunch risk is measured. Nothing here depends on it.

**Decisions locked (this plan's premises).**
1. **`aven-server` is one Rust binary.** The did:key challenge/verify/invite flow is ported from TypeScript/Better-Auth into a Rust `aven-auth` crate; `aven-p2p` (the transport crate) + a headless `SyncManager` run in the same process. One fly deploy, one identity substrate.
2. **This is the canonical plan.** `CapabilitySyncTracker.md` is marked historical for transport + server topics.
3. **TCP/TLS is the transport — full stop, for this plan.** A hardened, authenticated **`ServerSyncTransport`** (N-client fan-out over `tokio-rustls`) is *the* wire. The 2-peer `dev_transport.rs` stays a throwaway test harness; the real server transport is built fresh in `aven-p2p`. Direct mesh is a future board item, not a coexisting branch here.
4. **Auth keeps its own SQLite store** (not the RocksDB/groove engine) — see §3. "Single source of truth" = one binary / one authority, not one storage engine.

---

## 0. What's scattered today (the starting state)

| Piece | Where | Runtime | Role | Fate |
|-------|-------|---------|------|------|
| **Dev TCP transport** | [`libs/aven-db/src/dev_transport.rs`](../libs/aven-db/src/dev_transport.rs) + `try_dev_peer_transport` in [`app/src-tauri/src/jazz/mod.rs`](../app/src-tauri/src/jazz/mod.rs) | in-app (Rust) | 2-peer localhost `127.0.0.1:14290` stand-in, plaintext 32-byte identity handshake | **keep as test harness** — **superseded by** a hardened `ServerSyncTransport` (§2). Not promoted; the real server transport is built fresh. |
| **aven-auth** | [`libs/aven-auth/`](../libs/aven-auth/) | TypeScript · SvelteKit · Better-Auth · better-sqlite3 · `:3000` | did:key challenge/verify, invites, bootstrap-admin, network-seed | **port to Rust**, archive TS |
| **aven-p2p** | [`libs/aven-p2p/`](../libs/aven-p2p/) | Rust | the transport crate | **fill** — TCP/TLS `ServerSyncTransport` |
| **aven-server** | — | — | the always-on "aven" (M2 of the tracker) | **create** (the unified binary) |
| **Sync engine** | [`libs/aven-db/`](../libs/aven-db/) (`groove`) | Rust | `RuntimeCore` + frontier sync + `SyncTransport` seam | **keep**, unchanged below the seam |
| **Direct P2P mesh** | — | — | peeroxide Hyperswarm direct sync | **deferred → board [`0003`](../libs/aven-board/board/inbox/0003-p2p-mesh-peeroxide.md)** |

The frontier protocol is **already wired** in the engine — `SyncPayload::FrontierAnnounce` / `FrontierNeed` exist ([`inbox.rs`](../libs/aven-db/src/sync_manager/inbox.rs), [`forwarding.rs`](../libs/aven-db/src/sync_manager/forwarding.rs)), the `SyncTransport` trait is the seam ([`sync_transport.rs`](../libs/aven-db/src/sync_transport.rs)), and `BiscuitCapabilityResolver` gates every frame. **Nothing in this plan touches the engine below `SyncTransport`.** The transport is "one more `impl SyncTransport`"; the server is "a headless host of the same engine." The engine already models off-device durability: `DurabilityTier::{Local, EdgeServer, GlobalServer}` ([`batch_fate.rs`](../libs/aven-db/src/batch_fate.rs)) — "a server confirmed this batch is durably stored" is a first-class concept the backup server lights up.

---

## 1. Target architecture — one binary, three library crates

```
                       ┌───────────────────────────────────────────────┐
                       │  aven-server  (libs/aven-server)  — THE BINARY  │
                       │  the always-on "aven" · one fly deploy          │
                       │                                                 │
   HTTP :3000  ───────▶│  ┌──────────────┐   ┌────────────────────────┐ │
   (device admission)  │  │  aven-auth   │   │  headless SyncManager   │ │
                       │  │  (Rust crate)│   │  (groove, server-mode)  │ │
                       │  │ did challenge │   │  blind mirror·indexer   │ │
                       │  │  invite·seed │   └───────────┬────────────┘ │
                       │  └──────────────┘               │              │
   TCP/TLS :4290 ─────▶│  ┌────────────────────────────────────────┐   │
   (sync/backup —      │  │  aven-p2p :: ServerSyncTransport (TLS)   │   │
    N clients dial in) │  │  (Rust crate) — impl SyncTransport       │   │
                       │  └────────────────────────────────────────┘   │
                       └───────────────────────────────────────────────┘
                                          ▲           ▲
            same SyncTransport seam       │           │   same did:key identity
                                          │           │
   ┌──────────────────────────────────────┐         (every device is a peer;
   │  app/src-tauri  (the device peer)      │          the aven is just an
   │  groove + aven-p2p ServerSyncTransport │          always-on peer dialed
   │  (dials the aven over TLS)             │          over TLS)
   └──────────────────────────────────────┘
```

**Crate graph (Rust, standalone crates — there is no root cargo workspace):**

| Crate | Path | Kind | Owns | Depends on |
|-------|------|------|------|------------|
| `aven-db` (`groove`) | `libs/aven-db` | lib | engine, `SyncTransport` seam, frontier, `CapabilityResolver` trait | — |
| `aven-p2p` | `libs/aven-p2p` | lib | `ServerSyncTransport: SyncTransport` (TLS client) + `ServerListener` (N-client fan-out), topic derivation + did:key handshake gate | `aven-db`, `tokio-rustls` |
| `aven-auth` | `libs/aven-auth` | lib | did:key challenge/verify, invite issue/redeem, bootstrap-admin, network-seed, bearer sessions, sqlite store | `axum`/`rusqlite` (no `aven-db`) |
| `aven-server` | `libs/aven-server` | **bin** | the always-on aven: boots auth HTTP + headless `SyncManager` + the TLS `ServerListener` under one identity & config | `aven-db`, `aven-p2p`, `aven-auth` |

The **device app** (`app/src-tauri`) depends on `aven-db` + `aven-p2p` (client side: `ServerSyncTransport::dial`). It does **not** depend on `aven-server` — server and device share *libraries*, not the host. This is the M3 graduation promise: device-peer and aven run the *same* engine + *same* transport crate, differing only in mode (dial vs serve) and which biscuit they hold.

> **Single-source-of-truth invariant.** The tracker established *one authorizer* (biscuit caps) and *one tracker* (the frontier). This plan adds: **one transport** (`ServerSyncTransport`, no second wire in this plan) and **one server** (`aven-server`, no TS auth-server + separate relay beside it). Smell test of any future change: *"does this introduce an **authorizer** beside biscuit caps, a **frontier** beside the engine's, an **auth service** beside `aven-auth`, a **server process** beside `aven-server`, or a **transport** beside `ServerSyncTransport`?"* If yes, stop. (A future *second* transport — the deferred mesh, board `0003` — is the one sanctioned exception, and only behind this same seam, after this plan ships.)

---

## 2. Part A — the TCP/TLS sync/backup transport (`aven-p2p`)

The headline ask: **a real, authenticated TCP/TLS `SyncTransport` where N device peers dial one always-on aven and converge.** It depends on *nothing* in Parts B/C beyond the did:key challenge primitive (shared with auth) — it ships first and proves off-device durable sync end-to-end.

### 2.1 The seam (unchanged)

```rust
#[async_trait]
pub trait SyncTransport: Send + Sync {
    async fn send_to(&self, target: SyncTargetId, payload: SyncPayload) -> crate::Result<()>;
    async fn recv_inbound(&self) -> Option<InboxEntry>;
    async fn shutdown(&self) -> crate::Result<()> { Ok(()) }
}
```

`ServerSyncTransport` is one `impl` of this — exactly as the dev `TcpSyncTransport` and `LoopbackTransport` already are ([`dev_transport.rs:130`](../libs/aven-db/src/dev_transport.rs)). The app wires it where `try_dev_peer_transport` wires the dev TCP today ([`jazz/mod.rs`](../app/src-tauri/src/jazz/mod.rs)). Frames are already transport-agnostic, length-prefixed `SyncFrameV1` via `encode_length_prefixed` / `decode_length_prefixed` ([`sync_transport.rs`](../libs/aven-db/src/sync_transport.rs)) — reused verbatim.

### 2.2 From the 2-peer dev stand-in to a real server transport

The dev transport ([`dev_transport.rs`](../libs/aven-db/src/dev_transport.rs)) already does the *byte-pipe* half right: connect, exchange identity, spawn a read-pump that decodes length-prefixed frames into `InboxEntry { source: Source::Client(remote), payload }` ([`dev_transport.rs:79-113`](../libs/aven-db/src/dev_transport.rs)). The real server transport keeps that decode/queue half and changes **four** things — only one subtle:

| # | Change | Dev transport today | What the server needs |
|---|--------|---------------------|------------------------|
| 1 | **N clients, not 2 peers** | `DevRole::{Listen, Dial}`, exactly one `accept()` | a server accept-loop + a connection registry keyed by authenticated remote DID; `send_to` routes / fans out by `target` |
| 2 | **Authenticated handshake** ⚠️ | plaintext 32-byte `PeerId` exchange, **spoofable** ([`dev_transport.rs:72-77`](../libs/aven-db/src/dev_transport.rs)) | **TLS** (server cert) **+ a did:key challenge** proving the client controls its DID private key. The one place we must not cut corners — the biscuit gate trusts `remote` as the subject DID. Reuse the *same* did:key challenge `aven-auth` implements (§3) |
| 3 | **Routing vocabulary** | `Source::Client(remote)` only | route a frame to the connection whose authenticated DID matches `SyncTargetId::PeerDid`/`Client` ([`sync_targets.rs`](../libs/aven-db/src/sync_targets.rs)); fan a `FrontierAnnounce` to all topic members |
| 4 | **Headless server host** | app-driven, two side-by-side Tauri instances | `JazzClient::connect_with_sync_transport` ([`avenos_client.rs:228`](../libs/aven-db/src/avenos_client.rs)) in server-mode, no UI; clients registered via `register_peer_sync_client` ([`avenos_client.rs:274`](../libs/aven-db/src/avenos_client.rs)) — the path the dev transport already feeds |

> **Why build fresh, not promote `dev_transport.rs`.** Keeping the real transport in its own crate (`aven-p2p`) — leaving `dev_transport.rs` as the throwaway 2-peer harness — keeps the spoofable plaintext handshake out of any production path. The dev transport stays useful for the loopback/2-peer test harness.

### 2.3 `aven-p2p` work items

1. **`ServerSyncTransport: SyncTransport` (client side)** — dial `host:port` over `tokio-rustls`, complete the **TLS + did:key challenge** handshake, then run the dev transport's read-pump decode/queue half unchanged. `send_to` writes a length-prefixed `SyncFrameV1` to the server connection.
2. **`ServerListener` (server side)** — bind one TLS listener, accept N clients, run the challenge per connection, maintain a `HashMap<Did, Connection>` registry. `send_to(target)` resolves `target → connection`; topic fan-out ships a `FrontierAnnounce` to every member holding that spark.
3. **Authenticated identity binding.** The did:key challenge yields the **proven** remote DID — fed straight to `may_sync`. One identity model: the device's Ed25519 root key signs the challenge; the server verifies it against the claimed `did:key`.
4. **Handshake gate.** On a new connection: `proven did → may_sync(subject, Replicate, resource)`. Reject unauthorized peers fast; rate-limit to blunt handshake spam — the same gate the engine applies per-frame, applied once at connect to drop hostile peers early.
5. **Topic derivation.** `resource_urn(spark) -> topic`; holding a biscuit for S *is* the subscription to S. The server announces every spark it holds; a device subscribes to the sparks it holds. The connection registry is keyed by DID; the topic registry maps spark → member DIDs for fan-out.

### 2.4 App + dev-harness wiring

- Add `try_server_transport` (TLS) replacing `try_dev_peer_transport`: read the aven's `host:port` + server cert (or trust anchor) + the device keypair, `ServerSyncTransport::dial`, register the server peer via the existing `register_peer_sync_client` path. The revoke-skip logic ([`jazz/mod.rs:1400-1411`](../app/src-tauri/src/jazz/mod.rs)) carries over unchanged.
- [`scripts/dev-two-instances.ts`](../scripts/dev-two-instances.ts) starts **one local `aven-server`** (TLS on `127.0.0.1:PORT`) before the two Tauri instances; both dial it. Two devices that are *never online together* converge through it — the durable-backup property, proven locally.
- The dev 2-peer TCP path (`AVENOS_DEV_PEER_SYNC` / `AVENOS_DEV_INSTANCE`) stays as a no-server loopback harness; it is **not** the production transport.

### 2.5 Acceptance ladder (each rung green before the next)

1. **Loopback parity** — `ServerSyncTransport` over an in-memory TLS pair passes the same convergence the §9 `LoopbackTransport` harness proves (T4/T5).
2. **Local aven, N instances** — `dev:app2x:mac` with a local `aven-server`: A & B dial the aven, TLS + did:key handshake, biscuit-gate, converge a row live, and — the headline — **two devices never online together converge through the aven** (the tracker's §10.1 live loop + the store-and-forward backup property).
3. **Hosted aven over the open internet** — a device on a real network dials a fly-hosted `aven-server` over TLS and converges a real spark. (No NAT holepunch — client→server TLS is reachable by construction.)

### 2.6 Relay — two senses, both apply

"Relay" means two different things; the aven does **both**, and only one is something we build:

| Sense | What it is | Who provides it | Build? |
|-------|-----------|-----------------|--------|
| **Transport relay** | when two peers can't reach each other directly, a reachable third node forwards the *bytes* | the **TLS aven** *is* one by construction — every client dials it (a star) | **No** — free from the topology |
| **Data relay (store-and-forward / mirror)** | a node *holds* a spark's batches (as ciphertext) and *ships them onward* to other authorized peers on `FrontierNeed` — bridging devices never online together | **the aven**, via the frontier protocol | **Yes** — the aven's core job |

The data relay is **already proven in the §9 harness**: `T7 multi_hop_via_hub` shows a **blind** hub H bridge A→B (never directly connected), `T8 capability_gates_every_hop` shows H relays to B *iff* B's biscuit grants the spark. The aven is exactly that blind hub, made always-on — and over TLS it is the *simplest possible* realization (a star, no DHT). **What's missing is not the relay mechanism but the *capability vocabulary* to express "relay-only, blind" without making the node an owner** — see §4.0.

### 2.7 Identity · topics · pairing — how a peer actually connects

**Three independent coordinates** answer three different questions — conflating them is the classic sync security bug:

| Coordinate | Question | Value | Property |
|-----------|----------|-------|----------|
| **Address** | *where do I look?* | the aven's `host:port` (TLS) | a rendezvous coordinate — **not a secret, not authorization** |
| **DID** | *who is this?* | did:key challenge response (the client signs the server's nonce) | cryptographically **authenticated** — the peer proved it holds the private key |
| **Biscuit** | *are they allowed?* | `may_sync(did, op, resource)` | the gate — the **only** thing that authorizes |

> The address gets you **found**, the challenge proves **who**, the biscuit decides **whether**. The server address being known is *fine* — knowing where the door is isn't the key. Authorization never rests on rendezvous secrecy.

**Pairing — first contact (app-level).** How a *brand-new* peer goes from "knows nothing" → "holds a biscuit for S". Two stages:

- **dev shortcut** — raw-DID paste → `sparkAdminAdd` mints a grant. Fine for `dev:app2x`.
- **Shipping target — invite/seed pairing** (Keet `blind-pairing-core`, tracker §7-V2): inviter mints an invite `{ seed, … }`, shares it out-of-band (QR / deep-link); the candidate authenticates with the seed-derived key inside the authenticated TLS stream, sends its DID; the inviter mints a biscuit grant for that DID — read/write for a person, **`replicate` for an aven** (§4.0) — and returns the spark id + biscuit chain. **The invite token `aven-auth` issues today (§3) and the pairing seed are the same primitive** — a one-time, expiring secret that admits a new DID. Merging them means the **aven issues one invite** that admits the device to the network (auth) *and* seeds the spark pairing (sync). One issuer, one invite, one source of truth.

**Two different "blind"s** (each a separate layer; the aven can be both at once):

| "Blind" | Layer | Means | Where |
|---------|-------|-------|-------|
| blind **relay** | transport | forwards bytes; the TLS star bridges every client | the topology (free) |
| blind **mirror** | data | replicate-only member; stores **ciphertext**, holds no DEK, can't read | we build (§4.0) |

---

## 3. Part B — auth → Rust (`aven-auth` crate)

The app's auth client ([`app/src/lib/self/network-auth.ts`](../app/src/lib/self/network-auth.ts)) consumes a **small, fixed slice** of Better-Auth. The Rust port must preserve that wire contract **byte-for-byte** so the app keeps working unchanged. **The did:key challenge built here is reused by the transport handshake (§2.2 #2)** — auth and transport share one challenge primitive, a reason this lands early.

> **Decision — auth keeps its own SQLite store** (not the RocksDB/groove engine). The two stores serve different masters: auth is transactional OLTP with **single-use** semantics (redeem-invite-once, unique `token_hash`, nonce-once) and must be **plaintext-readable**; the groove store is a replicated **DAG/CRDT** of **blind ciphertext**. Putting single-use tokens behind CRDT merge risks double-spend, and auth couldn't live in the blind mirror anyway. *Revisit only if* multi-aven HA requires shared auth state — and then with a consensus design, not naive CRDT.

### 3.1 The contract to preserve (do not change)

**Endpoints** (under `/api/auth/aven-auth/`), carried by **Bearer token** (cross-site cookies don't survive the webview hop):

| Method · Path | Body / Query | Returns |
|---|---|---|
| `GET /site/status` | — | `{ bootstrapped, hasAdmin }` |
| `GET /invite/check` | `?token` | `{ valid, expiresAt? }` |
| `POST /invite/create` | `{ expiresInSeconds? }` (admin only) | `{ inviteToken, inviteDeepLink, expiresAt }` |
| `GET /invite/list` | — (admin only) | `{ invites: [{ id, createdAt, expiresAt, consumedAt, boundDid, status }] }` |
| `POST /nonce` | `{ did, flow, inviteToken? }` | `{ nonce, message }` |
| `POST /verify` | `{ did, message, signature, flow, inviteToken? }` | `{ success, isAdmin, user, token }` |

**Challenge message** — exact text, parsed by both ends ([`challenge.ts`](../libs/aven-auth/src/lib/auth/plugins/aven-auth/challenge.ts)):

```
{domain} wants you to sign in with your Aven Self identity.

URI: {authUrl}
Network: {networkSeed}
DID: {did}
Nonce: {nonce}
Issued At: {issuedAt}
Expiration Time: {expirationTime}
```

**did:key decode** — Ed25519 multicodec `0xed 0x01` + 32-byte pubkey, base58btc (`z` prefix) ([`did.ts`](../libs/aven-auth/src/lib/did.ts)). **Signature** — ed25519 over the UTF-8 challenge bytes. **Invite hash** — `sha256(token)` hex; **synthetic email** — `device+{sha256(did)[..12]}@{domain}` ([`crypto.ts`](../libs/aven-auth/src/lib/auth/plugins/aven-auth/crypto.ts)).

**Flows** — `bootstrap` (first identity becomes sole site admin; rejected once an admin exists) and `invite` (single-use token, bound to the redeeming DID on consume). 5-minute challenge TTL; configurable invite TTL.

**Tables** — `self_site_config`, `self_invite`, `self_challenge` ([`schema.ts`](../libs/aven-auth/src/lib/auth/plugins/aven-auth/schema.ts)) + Better-Auth's `user` / `account` / `session`. The Rust port replaces the last three with a minimal equivalent (a `session` row keyed by bearer token, an `account` mapping `providerId="self" + accountId=did → userId`).

### 3.2 `aven-auth` (Rust) work items

1. **HTTP server** — `axum` router exposing the 6 endpoints under `/api/auth/aven-auth/`, plus `GET /health`. `trustedOrigins` / CORS preserved (`tauri://localhost`, `localhost:1420`, the prod host).
2. **Store** — **SQLite via `rusqlite`** (decided above) over the same logical schema. Keep `AVEN_AUTH_DB_PATH` so existing dev DBs migrate trivially. Sits beside the engine's RocksDB dir on one fly volume (§4.4).
3. **Crypto** — `ed25519-dalek` verify; reuse the in-tree did:key codec (`jazz_auth::ed25519_public_from_peer_did`) so encode/decode is identical across app, device, and server. **The same verify path backs the transport handshake (§2.2).**
4. **Sessions** — issue an opaque bearer token on `verify`, validate it on the admin-only endpoints. (~30 lines, replacing Better-Auth's `bearer()` plugin.)
5. **Config** — `AvenAuthConfig { auth_url, secret, db_path, domain, network_seed, invite_ttl, invite_scheme }` from env (same names as [`env.ts`](../libs/aven-auth/src/lib/env.ts)), so `.env` is unchanged.
6. **Parity smoke** — port [`scripts/smoke-api.ts`](../libs/aven-auth/scripts/smoke-api.ts) to run against the Rust server; assert identical JSON shapes + status codes. **This is the cutover gate.**

### 3.3 Transition (no big-bang)

- **Start P2:** move the TS package `libs/aven-auth` → `ARCHIVE/aven-auth-ts` (frees the name); the archived TS server still boots in dev so the app never loses auth.
- **Build** the Rust crate at `libs/aven-auth`. App keeps hitting the TS server until parity smoke passes.
- **Cut over:** dev scripts ([`scripts/dev-aven-auth.ts`](../scripts/dev-aven-auth.ts)) boot the Rust binary (eventually `aven-server`, §4) instead of the TS server on `:3000`. The app's `network-auth.ts` is **untouched** (same URL, same shapes). Delete `ARCHIVE/aven-auth-ts` after a soak.

---

## 4. Part C — `aven-server` binary (the always-on aven)

One process = **device-admission authority + rendezvous + blind mirror + indexer**, all under one did:key identity and one config, reachable over one authenticated TLS port. This is the tracker's M2 ("local always-on aven") and M3 ("hosted aven"), now unified with auth.

### 4.0 The blind-relay capability — the aven is *just a member*

**The aven is added to a spark exactly like a person: a `did:key` granted a biscuit.** The *only* difference from adding a human is the **capability bundle** it receives. It needs one new, mostly-additive piece (a `replicate` right) because two things are true of the model today:

- **Sync-membership and read-capability are orthogonal axes.** Sync (receive/store/forward batches) is gated by `may_sync`; read (decrypt) requires a wrapped DEK in the `keyshares` table. A peer with **no keyshare holds ciphertext it provably cannot read** — "blind" is automatic, just *don't mint it a keyshare*.
- **But today every member is minted as a full owner.** [`attenuate_add_owner_third_party`](../app/src-tauri/src/spark_acc.rs) grants `owns(did, spark)`; the genesis rights are `read · write · delete · admit · rotate_dek` (no `replicate`); the ship path checks `AccOp::Write` ([`forwarding.rs:153`](../libs/aven-db/src/sync_manager/forwarding.rs)); and `authorize`'s DSL requires the subject be a `trusted_admin`. So there is no way to express "may sync, may not read, may not write, is not an owner" — which is exactly the aven.

**The blind-relay bundle (work items, mostly additive):**

1. **A `replicate` right** in the vocabulary (alongside `read/write/delete/admit/rotate_dek`). It authorizes *transfer of ciphertext* (receive · store · forward) — strictly weaker than read or write. Add `replicate` to the genesis grant too, so existing members satisfy a `replicate` check.
2. **`AccOp::Replicate`** in [`capability.rs`](../libs/aven-db/src/capability.rs) + `spark_acc`, and **gate the ship/transfer path on `Replicate`** instead of `Write` ([`forwarding.rs:153`](../libs/aven-db/src/sync_manager/forwarding.rs)). Shipping stored ciphertext is a replicate action — read/write members still pass (they hold `replicate` too), and a replicate-only aven now passes.
3. **A non-owner grant minter** — `attenuate_add_replicate_third_party(spark, aven_did)`: a third-party block (signed by an admin key) granting **only** `right(replicate, "spark:S:")` — **no `owns`, no read/write, no keyshare.**
4. **Generalize `authorize`'s DSL** — allow a subject holding a *delegated* `right(replicate, prefix)` even when it is **not** a `trusted_admin`. Biscuit third-party attenuation already guarantees the right was admin-signed, so the authorizer can trust a delegated right without the subject being an owner. **This is the same DSL generalization the tracker deferred for table/row caps — it pays for both.**
5. **Blind = no keyshare.** Omit replicate-only DIDs from DEK/keyshare distribution and `rotate_dek`. No new mechanism — just never wrap the DEK for them.

> Net: a person = `owns` + read/write + a keyshare (reads plaintext). An aven = `replicate` only + **no** keyshare (stores ciphertext, provably can't read). Both are members; both are `did:key` peers; the difference is one capability bundle. This is the **"Blind" badge** and the **"+ Add relay/backup"** affordance (tracker §7 V1) made real. Multiple avens per spark — no SPOF.

### 4.1 What it runs

```rust
// libs/aven-server/src/main.rs (sketch)
#[tokio::main]
async fn main() -> Result<()> {
    let cfg = AvenServerConfig::from_env()?;          // one config for all roles
    let identity = load_or_create_keypair(&cfg)?;     // one did:key for the aven

    // 1. device admission (HTTP) — the ported aven-auth crate
    let auth = aven_auth::serve(cfg.auth.clone());     // axum on :3000

    // 2. the sync/backup transport — TLS server, N clients dial in
    let transport = aven_p2p::ServerSyncTransport::serve(
        identity.clone(), cfg.tls.clone(), cfg.topics_for_held_sparks(),
    ).await?;
    let engine = JazzClient::connect_with_sync_transport(headless_ctx(&cfg), transport, None).await?;

    // 3. blind by default — replicate grant, no DEK; stores ciphertext, provably can't read
    engine.set_durability_tier(DurabilityTier::EdgeServer);

    tokio::try_join!(auth, run_server(engine))?;
    Ok(())
}
```

### 4.2 Properties

- **Star-topology sync/backup** — the aven announces every topic it holds; devices dial it over TLS and reconcile against it instead of all-to-all. **One aven serves n+ sparks**, multiplexed over one connection per peer. Two devices never online together converge *through* it.
- **Blind by default** — the aven gets `right(replicate,"spark:S:")` (§4.0), **not** `owns`, and **no DEK**. It stores full ciphertext history (`DurabilityTier::EdgeServer`) and **provably cannot read** (Keet's blind mirror). A full-member replica (with DEK) is reserved for self-hosted, fully-trusted hubs.
- **Added by biscuit, like a person** — "+ Add relay/backup" in the app mints the replicate bundle (§4.0) for the aven's DID. The **resolver plumbing** is unchanged (`BiscuitCapabilityResolver` already maps DID→spark→`authorize`); what's new is the `replicate` right it can now authorize.
- **Indexer** — serves a single-signer stable frontier for new-device fast-forward (simpler than Autobase quorum; the aven is trust-rooted by its biscuit).
- **Auth + sync share identity** — the aven's did:key is both its biscuit subject (sync) and its admin identity (it can be the bootstrap admin that issues invites). One key, one source of truth for "who is this network's authority."

### 4.3 Run it locally, then host it

- **P3 (local):** `aven-server` runs on the dev machine, TLS on `127.0.0.1:PORT`. Two non-overlapping devices (never online together) converge **through** the aven over TLS. The dev harness can start it as a third process.
- **P3.5 (hosted, TLS):** containerize the **same** binary → fly.io. One TLS port for sync + the auth endpoints at `auth.testnet.aven.ceo` — **same binary, config only.** A device on the open internet dials it and converges with **no DHT, no holepunch** (client→server is reachable by construction). This is the durable off-device backup, in production.

### 4.4 Persistence — the aven keeps two stores (same engine + storage as a device)

The aven runs the **same `aven-db` (groove) engine a device runs**, whose backend is **RocksDB** (`RocksDBStorage::open`, behind the `rocksdb` feature `client-p2p` pulls in). It persists replicated data exactly like a device — **just blind**:

| Store | Tech | Path (default) | Holds | Readable by the aven? |
|-------|------|----------------|-------|------------------------|
| **Engine** (the mirror) | **RocksDB** (a *directory*) | `db/` (`AVEN_OS_GROOVE_DATA_DIR`) | every mirrored spark's batches as **ciphertext** + the frontier (`DurabilityTier::EdgeServer`) | **No** — no DEK, provably can't decrypt |
| **Auth** | **SQLite** (a *file*) | `aven-auth.db` | invites · challenges · site-config / admin (§3) | n/a (its own metadata) |

> Note on naming: there is no single `aven.db` engine file — the engine store is a **RocksDB directory**. The only `.db` *file* is the SQLite **auth** store. On fly both live on one persistent volume.

This is the M3 graduation made literal: **device and aven are the same code over the same RocksDB storage**, differing only in *mode* (serve vs dial), *which biscuit* they hold (`replicate` vs `owns`/read/write), and *whether they hold a DEK* (the aven doesn't → blind). A self-hosted, fully-trusted hub that *should* read plaintext is the same binary **with** a DEK — a config/grant difference, not a code difference.

---

## 5. Execution — phases P0–P3

Each phase: **goal · work · acceptance · gate.** Gate on `cargo build` (lib default + `client-p2p`) **and** the §9 harness staying green after every step.

**Staging (strictly ordered — simplest working thing first):** **P0** recovers plain **dev-TCP** frontier sync between two app2x instances (validate the architecture in dev — no auth, no TLS, no peeroxide). Only once that is solid do we **P1** harden the wire to authenticated **TLS** (`ServerSyncTransport`), **P2** port **auth** to Rust, and **P3** consolidate into the **aven-server** binary (blind backup/relay). P1 and P2 can then proceed in parallel — they meet at the shared did:key challenge; P3 needs both. Direct P2P mesh stays deferred (board [`0003`](../libs/aven-board/board/inbox/0003-p2p-mesh-peeroxide.md)).

### P0 — recover dev-TCP frontier sync in app2x ⟵ START HERE (the working baseline)
*Goal: the simplest possible proof the frontier architecture syncs two real devices — pure dev **TCP**, **no auth, no TLS, no peeroxide, no aven-server**. The foundation every later phase builds on; nothing else lands until this is solid.*
- **Work:** the app transport is the dev TCP `try_dev_peer_transport` / `TcpSyncTransport` ([`dev_transport.rs`](../libs/aven-db/src/dev_transport.rs)); `dev:app2x:mac` starts two instances (A listens, B dials `127.0.0.1:14290`). **No** `aven-p2p`, **no** `aven-auth`, **no** TLS on this path. *(Peeroxide was reverted out of the app — it broke this flow by stalling the live connection; preserved on board [`0003`](../libs/aven-board/board/inbox/0003-p2p-mesh-peeroxide.md).)*
- **Acceptance (the live UX flow):** on `bun dev:app2x:mac` — (1) A & B each paste the other's DID and Add; each peer chip flips `Connecting → Syncing`. (2) On A, share a spark with B as **admin** (`sparkAdminAdd`). (3) **B's grid shows the shared spark** (shell catch-up ships `sparks` + `keyshares` + biscuit). (4) A writes a row → appears on B live; B writes → appears on A. (5) Revoke on A → new writes stop reaching B; pre-revoke rows remain.
- **Gate:** `cargo check` app green (✓); §9 harness green; the human `dev:app2x` run shows the shared spark crossing both ways. **If a spark does not cross, the fix is in the dev-TCP shell-catchup / grant-reship path — not a new transport.**

### P1 — crate skeletons + authenticated TCP/TLS `ServerSyncTransport` ⟵ the headline
- **Work:** create `libs/aven-server` (bin) + fill `libs/aven-p2p` (lib, `tokio-rustls`); §2.3 (TLS path: `ServerSyncTransport` client + `ServerListener` server, N-client fan-out, TLS + did:key challenge handshake) + §2.4 (app + dev-harness wiring). Reuse the did:key challenge from P2 (or a thin shared module if P2 lags).
- **Acceptance:** §2.5 ladder rungs 1–2 — loopback parity + **two devices never online together converge through a local `aven-server` over TLS**, incl. grant→sync and revoke-not-retroactive (tracker §10.1).
- **Gate:** §9 harness green; `dev:app2x:mac` converges over the TLS server; the handshake proves the remote DID (no plaintext-identity path in production).

### P2 — auth → Rust (`aven-auth` crate) ‖ parallel to P1
- **Work:** §3.2 (axum + rusqlite + ed25519 + bearer + parity smoke); §3.3 transition (archive TS). Expose the did:key verify path for P1's handshake to reuse.
- **Acceptance:** ported smoke-api asserts byte-identical responses to the TS server for all 6 endpoints + both flows; app registers a device against the Rust server unchanged.
- **Gate:** parity smoke green; app's `network-auth.ts` untouched.

### P3 — `aven-server` binary, always-on aven over TLS (= tracker M2, unified)
- **Work:** **§4.0 the blind-relay capability first** (the `replicate` right + `AccOp::Replicate` + non-owner minter + `authorize` DSL generalization + keyshare omission) — without it there is no "relay-only, blind" peer to add; then §4.1 (boot auth + headless engine + TLS server transport under one identity/config); "+ Add relay/backup" UI mints the replicate grant (Blind badge); multi-tenant topic join. Then **P3.5:** Dockerfile + fly config + TLS cert + prod auth host (§4.3) — the **same** binary hosted, durable backup in production over TLS.
- **Acceptance:** a `replicate`-only peer converges (receives + forwards ciphertext) but its `may_sync` denies `Write`/`Read` and it holds **no** keyshare; two devices never online together converge through the aven (local, then hosted over TLS); n+ sparks over one connection; auth served by the same binary. New harness test `T11 replicate_only_relays_blind` locks it (mirrors `T7`/`T8`).
- **Gate:** the tracker's §3 aven properties demonstrated; §9 harness (incl. T11) green; auth parity smoke green against `aven-server`; a hosted device converges a real spark over TLS.

> **Beyond P3 — direct P2P mesh (deferred).** Adding peeroxide Hyperswarm as a *second* `impl SyncTransport` (so devices that can holepunch sync directly, with the aven's TLS endpoint as fallback) is captured as board item [`0003`](../libs/aven-board/board/inbox/0003-p2p-mesh-peeroxide.md). Its P0 spike is already done; it is **not** part of this plan's definition of done.

---

## 6. Risks & open questions

| Risk | Severity | Mitigation |
|------|----------|------------|
| **TCP/TLS handshake auth** — the biscuit gate trusts the proven DID; a weak handshake spoofs the subject | **High (P1)** | TLS server cert + a real did:key challenge (§2.2 #2), reusing `aven-auth`'s verify (§3). Never ship the dev transport's plaintext 32-byte identity in a server path. The one corner we don't cut. |
| **`authorize` DSL generalization** (§4.0) — "membership ≡ ownership" → "authorize by delegated right" | Medium (blocks P3 + deferred table/row caps) | the same change the tracker deferred for granular caps; biscuit third-party attenuation already proves a right was admin-signed. Land behind `capability_gate` tests + new T11. |
| **Star topology = bottleneck / SPOF** | Medium | the frontier model already supports **N** avens per spark (§4.0) — run more than one. A "backup server" being on the data path is by-definition acceptable for the backup role; the deferred mesh (board `0003`) later removes it from the hot path for peers that can holepunch. |
| **Better-Auth feature parity** — sessions, bearer, admin gating | Medium | a *small slice*; the §3.1 contract is fully enumerated. Port exactly those 6 endpoints + bearer; the §3.2.6 parity smoke is the gate. |
| **TLS cert distribution** — devices must trust the aven's cert | Medium | dev: a generated self-signed cert pinned via config; prod (fly): a real cert (Let's Encrypt / fly-managed) for `auth.testnet.aven.ceo`. The did:key challenge authenticates the *client*; the cert authenticates the *server*. |
| **did:key codec divergence** across app / device / server | Low | reuse the in-tree `jazz_auth` codec in the Rust auth + transport crates — single implementation. |

---

## 7. Definition of done

- **P0:** `dev:app2x:mac` over plain **dev-TCP** — two instances pair by DID, a spark shared as admin **appears in the other device's grid**, rows sync live both ways, revoke is not retroactive. No auth, no TLS, no peeroxide. (App compiles ✓; awaits the human live run.)
- **P1:** `dev:app2x:mac` converges a spark through a local `aven-server` over **authenticated TLS** (two devices never online together), with grant→sync and revoke-not-retroactive verified live; the handshake proves the remote DID; §9 harness green.
- **P2:** the Rust `aven-auth` crate passes the parity smoke for all 6 endpoints + both flows; the app authenticates against it unchanged; TS package archived; its did:key verify backs the transport handshake.
- **P3:** the **blind-relay capability** (§4.0) lands (a `replicate`-only peer syncs ciphertext but is denied read/write and holds no keyshare, locked by T11); one `aven-server` binary serves **auth + blind mirror + rendezvous + indexer** under one identity, **hosted over TLS**; two non-overlapping devices converge through it; n+ sparks over one connection — **durable off-device backup, in production, with no DHT.**

**Net at done:** one Rust binary built from three modular crates, serving **auth + blind sync/backup** over a hardened TLS transport — the conceptual split between "auth-server", "relay", and "transport" collapsed into one process. Direct P2P mesh remains a deferred, already-spiked board item ([`0003`](../libs/aven-board/board/inbox/0003-p2p-mesh-peeroxide.md)) for after this ships.

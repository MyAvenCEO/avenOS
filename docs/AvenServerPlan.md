# Aven Server — unified sync/backup + auth platform (end-to-end plan)

**Status:** plan · **Owner:** sync / platform · **Supersedes:** the *Transport* (§4) and *M2/M3* milestones of [`CapabilitySyncTracker.md`](./CapabilitySyncTracker.md). The capability/frontier model (§0–§3, §6, §9 of that doc) stands unchanged — this plan only chooses the **transport staging** under it and **consolidates the servers above it**.

**Thesis.** Today three things sit beside the engine: a dev **TCP transport** (a 2-peer localhost stand-in), a TypeScript **auth-server** (`aven-auth`, device registration / invites), and a *planned* **sync relay** (`aven-server`, the always-on "aven"). They are three runtimes, three identities, three deploys. This plan collapses them into **one Rust binary — `aven-server`** — that is the network's *single source of truth*: it admits devices (auth), and it is the rendezvous + blind mirror + indexer (sync/backup). The first shippable step is **an authenticated TCP/TLS sync-backup server**: a real `impl SyncTransport` where N device peers dial one always-on aven, converge via the already-proven frontier protocol, and get blind off-device durability — **without** depending on a DHT or NAT holepunch. Direct peer-to-peer over **peeroxide Hyperswarm** is then added as a **second** `impl SyncTransport` behind the *same seam*, plug-and-play. Because everything that matters — frontier reconciliation, the biscuit gate, the blind-relay capability, the auth↔pairing merge — lives **above** the transport, it is built once and shared by both paths.

**Why this order.** The `SyncTransport` seam ([`sync_transport.rs:97`](../libs/aven-db/src/sync_transport.rs)) means a transport is "one more `impl`" — that cuts both ways: a TCP/TLS server is as much "just one more `impl SyncTransport` hosting the same engine" as the mesh is. TCP-first buys down the two real unknowns by *deferring* them behind the seam rather than betting on them up front: peeroxide's **local-bootstrap DHT constructor** (an open question — §6) and its **NAT holepunch parity** with JS HyperDHT (the High-severity risk — §6). A single TLS port deploys trivially (fly.io, one TCP listener, no UDP/DHT), survives corporate firewalls, and is trivial to observe. We ship durable off-device sync now; we add direct mesh when its risks are *measured*, not assumed.

**Decisions locked (this plan's premises).**
1. **`aven-server` is one Rust binary.** The did:key challenge/verify/invite flow is ported from TypeScript/Better-Auth into a Rust `aven-auth` crate; `aven-p2p` (the transport crate) + a headless `SyncManager` run in the same process. One fly deploy, one identity substrate.
2. **This is the canonical plan.** `CapabilitySyncTracker.md` is marked historical for transport + server topics.
3. **One seam, transports may coexist.** The first shipped transport is a **hardened, authenticated TCP/TLS `ServerSyncTransport`** (N-client fan-out) — *not* the 2-peer dev stand-in, which stays a throwaway test harness. **peeroxide Hyperswarm is added as a second `impl SyncTransport`** behind the same seam (§2.6). They are parallel impls of one seam, not two architectures.
4. **The keep-vs-delete-TCP call is deferred — on purpose.** Whether the TCP/TLS path becomes a *permanent fallback* (the reliable route for NAT'd / firewalled clients) or a *retired stepping stone* is decided in P4, **after the two-NAT holepunch spike yields real numbers** (§5 P4, §6). Building both transports behind the seam keeps that decision a one-line wiring change. Until then we neither promise nor delete it.

---

## 0. What's scattered today (the starting state)

| Piece | Where | Runtime | Role | Fate |
|-------|-------|---------|------|------|
| **Dev TCP transport** | [`libs/aven-db/src/dev_transport.rs`](../libs/aven-db/src/dev_transport.rs) + `try_dev_peer_transport` in [`app/src-tauri/src/jazz/mod.rs:1321`](../app/src-tauri/src/jazz/mod.rs) | in-app (Rust) | 2-peer localhost `127.0.0.1:14290` stand-in, plaintext 32-byte identity handshake | **keep as test harness**, then retire — **superseded by** a hardened `ServerSyncTransport` (§2). It is *not* promoted; the real server transport is built fresh. |
| **aven-auth** | [`libs/aven-auth/`](../libs/aven-auth/) | TypeScript · SvelteKit · Better-Auth · better-sqlite3 · `:3000` | did:key challenge/verify, invites, bootstrap-admin, network-seed | **port to Rust**, archive TS |
| **aven-p2p** | [`libs/aven-p2p/`](../libs/aven-p2p/) | Rust (placeholder, empty) | the transport crate | **fill** — TCP/TLS `ServerSyncTransport` first, `HyperswarmTransport` (peeroxide) second, both behind the seam |
| **aven-server** | — | — | the always-on "aven" (M2 of the tracker) | **create** (the unified binary) |
| **Sync engine** | [`libs/aven-db/`](../libs/aven-db/) (`groove`) | Rust | `RuntimeCore` + frontier sync + `SyncTransport` seam | **keep**, unchanged below the seam |

The frontier protocol is **already wired** in the engine — `SyncPayload::FrontierAnnounce` / `FrontierNeed` exist ([`types.rs:206`](../libs/aven-db/src/sync_manager/types.rs), [`inbox.rs:1014`](../libs/aven-db/src/sync_manager/inbox.rs), [`forwarding.rs:106`](../libs/aven-db/src/sync_manager/forwarding.rs)), the `SyncTransport` trait is the seam ([`sync_transport.rs:97`](../libs/aven-db/src/sync_transport.rs)), and `BiscuitCapabilityResolver` gates every frame. **Nothing in this plan touches the engine below `SyncTransport`.** Each transport is "one more `impl SyncTransport`"; the server is "a headless host of the same engine." The engine already models off-device durability: `DurabilityTier::{Local, EdgeServer, GlobalServer}` ([`batch_fate.rs`](../libs/aven-db/src/batch_fate.rs)) — "a server confirmed this batch is durably stored" is a first-class concept the backup server lights up.

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
                       │  │  did challenge│  │  blind mirror·indexer   │ │
                       │  │  invite·seed │   └───────────┬────────────┘ │
                       │  └──────────────┘               │              │
   TCP/TLS :4290 ─────▶│  ┌────────────────────────────────────────┐   │   ← ships first (P1/P3)
   (sync/backup, N     │  │  aven-p2p :: ServerSyncTransport (TLS)    │   │
    clients dial in)   │  │  aven-p2p :: HyperswarmTransport (P2P)    │   │   ← added behind same seam (P4)
   UDP / DHT  ┄┄┄┄┄┄┄▶│  │  (Rust crate) — both impl SyncTransport  │   │
   (direct mesh, later)│  └────────────────────────────────────────┘   │
                       └───────────────────────────────────────────────┘
                                          ▲           ▲
            same SyncTransport seam       │           │   same did:key identity
                                          │           │
   ┌──────────────────────────────────────┐         (every device is a peer;
   │  app/src-tauri  (the device peer)      │          the aven is just an
   │  groove + aven-p2p transport (TLS now, │          always-on peer)
   │  +Hyperswarm later — same seam)        │
   └──────────────────────────────────────┘
```

**Crate graph (Rust, standalone crates — there is no root cargo workspace):**

| Crate | Path | Kind | Owns | Depends on |
|-------|------|------|------|------------|
| `aven-db` (`groove`) | `libs/aven-db` | lib | engine, `SyncTransport` seam, frontier, `CapabilityResolver` trait | — |
| `aven-p2p` | `libs/aven-p2p` | lib | `ServerSyncTransport: SyncTransport` (TLS, N-client fan-out), `HyperswarmTransport: SyncTransport` (peeroxide), shared topic/discovery-key derivation + did:key handshake gate | `aven-db`, `tokio-rustls`, (later) `peeroxide` |
| `aven-auth` | `libs/aven-auth` | lib | did:key challenge/verify, invite issue/redeem, bootstrap-admin, network-seed, bearer sessions, sqlite store | `axum`/`rusqlite` (no `aven-db`) |
| `aven-server` | `libs/aven-server` | **bin** | the always-on aven: boots auth HTTP + headless `SyncManager` + the selected transport(s) (server-mode) under one identity & config | `aven-db`, `aven-p2p`, `aven-auth` |

The **device app** (`app/src-tauri`) depends on `aven-db` + `aven-p2p` (client-mode transport). It does **not** depend on `aven-server` — server and device share *libraries*, not the host. This is the M3 graduation promise: device-peer and aven run the *same* engine + *same* transport crate, differing only in mode (client vs server) and which biscuit they hold.

> **Single-source-of-truth invariant (revised: one *seam*, one authority — not one wire).** The tracker established *one authorizer* (biscuit caps) and *one tracker* (the frontier). This plan adds: **one transport seam** (`SyncTransport` — transports may coexist behind it) and **one server** (`aven-server`, no TS auth-server + separate relay beside it). The smell test of any future change: *"does this introduce an **authorizer** beside biscuit caps, a **frontier** beside the engine's, an **auth service** beside `aven-auth`, or a **server process** beside `aven-server`?"* If yes, stop. **A second *transport* behind the one seam is explicitly allowed** — that is how TCP/TLS and the mesh coexist (§2.6). What is *not* allowed is a second authorization model, reconciliation protocol, or server runtime.

---

## 2. Part A — the sync/backup transport (`aven-p2p`), TCP/TLS-first

This is the headline ask: **a real, authenticated TCP/TLS `SyncTransport` where N device peers dial one always-on aven and converge.** It depends on *nothing* in Parts B/C beyond the did:key challenge primitive (shared with auth) — it ships first and proves off-device durable sync end-to-end with no DHT.

### 2.1 The seam (unchanged)

```rust
#[async_trait]
pub trait SyncTransport: Send + Sync {
    async fn send_to(&self, target: SyncTargetId, payload: SyncPayload) -> crate::Result<()>;
    async fn recv_inbound(&self) -> Option<InboxEntry>;
    async fn shutdown(&self) -> crate::Result<()> { Ok(()) }
}
```

`ServerSyncTransport` (TLS) and `HyperswarmTransport` (peeroxide) are each one `impl` of this — exactly as the dev `TcpSyncTransport` and `LoopbackTransport` already are ([`dev_transport.rs:130`](../libs/aven-db/src/dev_transport.rs)). The app wires the chosen one where `try_dev_peer_transport` wires the dev TCP today ([`jazz/mod.rs:1392`](../app/src-tauri/src/jazz/mod.rs)). Frames are already transport-agnostic, length-prefixed `SyncFrameV1` via `encode_length_prefixed` / `decode_length_prefixed` ([`sync_transport.rs`](../libs/aven-db/src/sync_transport.rs)) — both transports reuse them verbatim.

### 2.2 From the 2-peer dev stand-in to a real server transport

The dev transport ([`dev_transport.rs`](../libs/aven-db/src/dev_transport.rs)) already does the *byte-pipe* half right: connect, exchange identity, spawn a read-pump that decodes length-prefixed frames into `InboxEntry { source: Source::Client(remote), payload }` ([`dev_transport.rs:79-113`](../libs/aven-db/src/dev_transport.rs)). The real server transport keeps that decode/queue half and changes **four** things — only one of which is subtle:

| # | Change | Where the dev transport is today | What the server needs |
|---|--------|----------------------------------|------------------------|
| 1 | **N clients, not 2 peers** | `DevRole::{Listen, Dial}`, exactly one `accept()` ([`dev_transport.rs:47-66`](../libs/aven-db/src/dev_transport.rs)) | a server accept-loop + a connection registry keyed by authenticated remote DID; `send_to` routes / fans out by `target` |
| 2 | **Authenticated handshake** ⚠️ | plaintext 32-byte `PeerId` exchange, **spoofable** ([`dev_transport.rs:72-77`](../libs/aven-db/src/dev_transport.rs)) | **TLS** (server cert) **+ a did:key challenge** proving the client controls its DID private key. This is the one place we must not cut corners: the biscuit gate trusts `remote` as the subject DID. Reuse the *same* did:key challenge `aven-auth` implements (§3) — auth and transport share one challenge primitive |
| 3 | **Routing vocabulary** | `Source::Client(remote)` only | route a frame to the connection whose authenticated DID matches `SyncTargetId::PeerDid` / `Client` ([`sync_targets.rs`](../libs/aven-db/src/sync_targets.rs)); fan a `FrontierAnnounce` to all topic members |
| 4 | **Headless server host** | app-driven, two side-by-side Tauri instances | `JazzClient::connect_with_sync_transport` ([`avenos_client.rs:228`](../libs/aven-db/src/avenos_client.rs)) in server-mode, no UI; clients registered via `register_peer_sync_client` ([`avenos_client.rs:274`](../libs/aven-db/src/avenos_client.rs)) — the path the dev transport already feeds |

> **Why build fresh, not promote `dev_transport.rs`.** Keeping the real transport in its own module/crate (`aven-p2p`) — leaving `dev_transport.rs` as the throwaway 2-peer harness it is labelled — keeps the keep-vs-delete decision (Decision 4) a clean drop, and keeps the spoofable plaintext handshake out of any production path. The dev transport stays useful for the loopback/2-peer harness until P4 cleanup.

### 2.3 `aven-p2p` work items (TCP/TLS path)

1. **`ServerSyncTransport: SyncTransport` (client side)** — dial `host:port` over `tokio-rustls`, complete the **TLS + did:key challenge** handshake, then run the dev transport's read-pump decode/queue half unchanged. `send_to` writes a length-prefixed `SyncFrameV1` to the server connection.
2. **`ServerListener` (server side)** — bind one TLS listener, accept N clients, run the challenge per connection, and maintain a `HashMap<Did, Connection>` registry. `send_to(target)` resolves `target → connection`; topic fan-out ships a `FrontierAnnounce` to every member holding that spark.
3. **Authenticated identity binding.** The did:key challenge yields the **proven** remote DID — fed straight to `may_sync`, exactly as the Noise handshake will under peeroxide (§2.6). One identity model, two handshakes producing the same `did:key` subject.
4. **Handshake gate.** On a new connection: `proven did → may_sync(subject, Replicate, resource)`. Reject unauthorized peers fast; rate-limit to blunt handshake spam — the same gate the engine applies per-frame, applied once at connect to drop hostile peers early.
5. **Topic derivation (shared).** `resource_urn(spark) -> topic`; holding a biscuit for S *is* the subscription to S. The server announces every spark it holds; a device subscribes to the sparks it holds. Same derivation reused by the mesh path (§2.6) so a peer found over TLS and a peer found over the DHT route identically.

### 2.4 App + dev-harness wiring

- Add `try_server_transport` (TLS) beside `try_dev_peer_transport`: read the aven's `host:port` + server cert + the device keypair, `ServerSyncTransport::dial`, register the discovered server peer via the existing `register_peer_sync_client` path. The revoke-skip logic ([`jazz/mod.rs:1400-1411`](../app/src-tauri/src/jazz/mod.rs)) carries over unchanged.
- [`scripts/dev-two-instances.ts`](../scripts/dev-two-instances.ts) starts **one local `aven-server`** (TLS on `127.0.0.1:PORT`) before the two Tauri instances; both dial it. Two devices that are *never online together* converge through it — the durable-backup property, proven locally.
- The dev 2-peer TCP path (`AVENOS_DEV_PEER_SYNC` / `AVENOS_DEV_INSTANCE`) stays as a no-server loopback harness until P4 cleanup; it is **not** the production transport.

### 2.5 Acceptance ladder (each rung green before the next)

1. **Loopback parity** — `ServerSyncTransport` over an in-memory TLS pair passes the same convergence the §9 `LoopbackTransport` harness proves (T4/T5).
2. **Local aven, N instances** — `dev:app2x:mac` with a local `aven-server`: A & B dial the aven, TLS + did:key-handshake, biscuit-gate, converge a row live, and — the headline — **two devices never online together converge through the aven** (the tracker's §10.1 live loop + the store-and-forward backup property).
3. **Hosted aven over the open internet** — a device on a real network dials a fly-hosted `aven-server` over TLS and converges a real spark. (No NAT holepunch involved — client→server TLS is reachable by construction.)

### 2.6 The second transport — peeroxide Hyperswarm, behind the same seam (P4)

Direct device-to-device sync is added as a **second `impl SyncTransport`**, not a replacement. Source-confirmed from `peeroxide@1.3.1` (`peeroxide/src/{lib,swarm}.rs`, `peeroxide-dht/src/*`): a cargo workspace of `peeroxide` (swarm) + `peeroxide-dht` (HyperDHT, Noise, holepunch, **`blind_relay`**) + `libudx` (reliable UDP) + `peeroxide-cli`.

```rust
use peeroxide::{spawn, discovery_key, JoinOpts, SwarmConfig};
let (handle, mut connections) = spawn(SwarmConfig::with_public_bootstrap()).await?;
let topic = discovery_key(b"spark:<S>");          // BLAKE2b-256, 32 bytes
handle.join(topic, JoinOpts { server: false, client: true }).await?;
while let Some(conn) = connections.recv().await {  // SwarmConnection
    let did = did_key(conn.remote_public_key());    // &[u8;32], Noise-authenticated
    // → may_sync(did, …) → frontier protocol over conn — IDENTICAL to the TLS path
}
```

| `SyncTransport` need | peeroxide@1.3.1 (confirmed) | …vs the TLS path |
|----------------------|------------------------------|------------------|
| open transport | `spawn(SwarmConfig) -> (SwarmHandle, receiver<SwarmConnection>)` | TLS listener / dialer |
| local identity | `SwarmConfig.key_pair` (Ed25519) = device root key | same device root key, presented in the did:key challenge |
| topic join | `handle.join(discovery_key("spark:S"), JoinOpts{server,client})` — **never roll our own** | same `discovery_key` derivation, used as the server's topic registry key |
| peer identity | `SwarmConnection::remote_public_key()` — **Noise-authenticated** static key → DID | did:key challenge → **proven** DID. Same subject, fed to the same `may_sync` |
| reachability | DHT discovery + holepunch + relay-fallback | none needed — client dials a known server address |
| relay / holepunch | `peeroxide-dht/src/{holepuncher,blind_relay}.rs`; `SwarmConfig.relay_through` | **n/a** — the TLS server *is* the reachable rendezvous |

**The mesh reuses everything above the seam unchanged** — the frontier protocol, the biscuit gate, the blind-relay `replicate` capability (§4.0), the topic derivation, the headless host. Adding it is: implement `HyperswarmTransport`, wire it as an alternative at `jazz/mod.rs`, and let the aven join `server`-mode while devices join `client`-mode. **The aven keeps its TLS endpoint** as the always-reachable fallback for any client that can't holepunch.

> **Open P0 spike for the mesh path:** confirm a **custom/local-bootstrap `HyperDhtConfig`** (not just `with_public_bootstrap()`) so two local nodes converge against a `127.0.0.1` bootstrap offline. This is the one load-bearing unknown — and because it's gated to P4, it **never blocks shipping the TCP/TLS backup server**.

### 2.7 Relay — two senses, both apply

"Relay" means two different things; the aven does **both**, and only one is something we build:

| Sense | What it is | Who provides it | Build? |
|-------|-----------|-----------------|--------|
| **Transport relay** | when two peers can't reach each other directly, a reachable third node forwards the *encrypted bytes* | the **TLS aven** *is* one by construction (both clients dial it); under peeroxide, the DHT's hole-punch + `blind_relay` adds it for direct mesh | **No** — free from the topology / transport |
| **Data relay (store-and-forward / mirror)** | a node *holds* a spark's batches (as ciphertext) and *ships them onward* to other authorized peers on `FrontierNeed` — bridging devices never online together | **the aven**, via the frontier protocol | **Yes** — it's the aven's core job |

The data relay is **already proven in the §9 harness**: `T7 multi_hop_via_hub` shows a **blind** hub H bridge A→B (A and B never directly connect), `T8 capability_gates_every_hop` shows H relays to B *iff* B's biscuit grants the spark. The aven is exactly that blind hub, made always-on — and over TLS it is the *simplest possible* realization of it (a star, no DHT). **What's missing is not the relay mechanism but the *capability vocabulary* to express "relay-only, blind" without making the node an owner** — see §4.0.

### 2.8 Identity · topics · pairing — how a peer actually connects

**Three independent coordinates** answer three different questions — conflating them is the classic P2P security bug, and it holds identically over TLS and over the mesh:

| Coordinate | Question | Value (TLS path · mesh path) | Property |
|-----------|----------|------------------------------|----------|
| **Topic** | *where do I look?* | the dialed server address · `discovery_key(b"spark:S")` | a rendezvous coordinate — **not a secret, not authorization** |
| **DID / static key** | *who is this?* | did:key challenge response · `conn.remote_public_key()` (Noise) | cryptographically **authenticated** — the peer proved it holds the private key |
| **Biscuit** | *are they allowed?* | `may_sync(did, op, resource)` | the gate — the **only** thing that authorizes |

> Topic gets you **found**, the handshake proves **who**, the biscuit decides **whether**. The TLS server address being known (or the DHT topic being derivable) is *fine* — knowing where the door is isn't the key. Authorization never rests on rendezvous secrecy.

**Pairing — first contact (app-level).** Pairing is how a *brand-new* peer goes from "knows nothing" → "holds a biscuit for S". Two stages of ambition, identical regardless of transport:

- **P1 dev shortcut** — raw-DID paste → `sparkAdminAdd` mints a grant. Fine for `dev:app2x`.
- **Shipping target — invite/seed pairing** (Keet `blind-pairing-core`, tracker §5/§7-V2): inviter mints an invite `{ seed, … }`, shares it out-of-band (QR / deep-link); candidate authenticates with the seed-derived key inside an encrypted stream, sends its DID; inviter mints a biscuit grant for that DID — read/write for a person, **`replicate` for an aven** (§4.0) — and returns the spark id + biscuit chain. Over TLS this stream is the authenticated server connection; over the mesh it is secret-stream on an ephemeral pairing topic. **The invite token `aven-auth` issues today (§3) and the pairing seed are the same primitive** — a one-time, expiring secret that admits a new DID. Merging them means the **aven issues one invite** that admits the device to the network (auth) *and* seeds the spark pairing (sync). One issuer, one invite, one source of truth.

**Three different "blind"s — do not conflate** (each a separate layer; the aven can be all three at once):

| "Blind" | Layer | Means | Where |
|---------|-------|-------|-------|
| blind **relay** | transport | forwards *encrypted bytes*; has no stream keys, sees no plaintext | the TLS star (free) · peeroxide `blind_relay.rs` (free) |
| blind **pairing** | first contact | invite/seed handshake; identities don't leak until both prove legitimacy | we build (§2.8) |
| blind **mirror** | data | replicate-only member; stores **ciphertext**, holds no DEK, can't read | we build (§4.0) |

---

## 3. Part B — auth → Rust (`aven-auth` crate)

The app's auth client ([`app/src/lib/self/network-auth.ts`](../app/src/lib/self/network-auth.ts)) consumes a **small, fixed slice** of Better-Auth. The Rust port must preserve that wire contract **byte-for-byte** so the app keeps working unchanged. **The did:key challenge built here is reused by the transport handshake (§2.2 #2)** — auth and transport share one challenge primitive, which is a reason this lands early.

> **Decision — auth keeps its own SQLite store** (not the RocksDB/groove engine). The two stores serve different masters: auth is transactional OLTP with **single-use** semantics (redeem-invite-once, unique `token_hash`, nonce-once) and must be **plaintext-readable**; the groove store is a replicated **DAG/CRDT** of **blind ciphertext**. Putting single-use tokens behind CRDT merge risks double-spend, and auth couldn't live in the blind mirror anyway. "Single source of truth" is satisfied by **one binary / one authority**, not one storage engine. *Revisit only if* multi-aven HA requires shared auth state — and then with a consensus design, not naive CRDT.

### 3.1 The contract to preserve (do not change)

**Endpoints** (under `/api/auth/aven-auth/`), carried by **Bearer token** (the session token `verify` returns — cross-site cookies don't survive the webview hop):

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

**did:key decode** — Ed25519 multicodec `0xed 0x01` + 32-byte pubkey, base58btc (`z` prefix) ([`did.ts`](../libs/aven-auth/src/lib/did.ts)). **Signature** — ed25519 over the UTF-8 challenge bytes.

**Flows** — `bootstrap` (first identity becomes sole site admin; rejected once an admin exists) and `invite` (single-use token, bound to the redeeming DID on consume). 5-minute challenge TTL; configurable invite TTL.

**Tables** — `self_site_config`, `self_invite`, `self_challenge` ([`schema.ts`](../libs/aven-auth/src/lib/auth/plugins/aven-auth/schema.ts)) + Better-Auth's `user` / `account` / `session`. The Rust port replaces the last three with a minimal equivalent (a `session` row keyed by bearer token, an `account` mapping `providerId="self" + accountId=did → userId`).

### 3.2 `aven-auth` (Rust) work items

1. **HTTP server** — `axum` router exposing the 6 endpoints under `/api/auth/aven-auth/`, plus `GET /health`. `trustedOrigins` / CORS preserved (`tauri://localhost`, `localhost:1420`, the prod host).
2. **Store** — **SQLite via `rusqlite`** (decided above) over the same logical schema. Keep `AVEN_AUTH_DB_PATH` so existing dev DBs migrate trivially. Sits beside the engine's RocksDB dir on one fly volume (§4.4).
3. **Crypto** — `ed25519-dalek` verify; reuse the app's existing did:key codec (`jazz_auth::ed25519_public_from_peer_did` is the inverse already in-tree) so encode/decode is identical across app, device, and server. **The same verify path backs the transport handshake (§2.2).**
4. **Sessions** — issue an opaque bearer token on `verify`, validate it on the admin-only endpoints. (~30 lines, replacing Better-Auth's `bearer()` plugin.)
5. **Config** — `AvenAuthConfig { auth_url, secret, db_path, domain, network_seed, invite_ttl, invite_scheme }` from env (same names as [`env.ts`](../libs/aven-auth/src/lib/env.ts)), so `.env` is unchanged.
6. **Parity smoke** — port [`scripts/smoke-api.ts`](../libs/aven-auth/scripts/smoke-api.ts) to run against the Rust server; assert identical JSON shapes + status codes. **This is the cutover gate.**

### 3.3 Transition (no big-bang)

- **Start P2:** move the TS package `libs/aven-auth` → `ARCHIVE/aven-auth-ts` (frees the name); the archived TS server still boots in dev so the app never loses auth.
- **Build** the Rust crate at `libs/aven-auth`. App keeps hitting the TS server until parity smoke passes.
- **Cut over:** dev scripts ([`scripts/dev-aven-auth.ts`](../scripts/dev-aven-auth.ts)) boot the Rust binary (eventually `aven-server`, §4) instead of the TS server on `:3000`. The app's `network-auth.ts` is **untouched** (same URL, same shapes). Delete `ARCHIVE/aven-auth-ts` after a soak.

---

## 4. Part C — `aven-server` binary (the always-on aven)

One process = **device-admission authority + rendezvous + blind mirror + indexer**, all under one did:key identity and one config. This is the tracker's M2 ("local always-on aven") and M3 ("hosted aven"), now unified with auth — and reachable first over TLS, later additionally over the mesh.

### 4.0 The blind-relay capability — the aven is *just a member*

**The aven is added to a spark exactly like a person: a `did:key` granted a biscuit.** The *only* difference from adding a human is the **capability bundle** it receives. This is **transport-independent** — it is identical whether the aven is reached over TLS or the mesh — and it needs one new, mostly-additive piece (a `replicate` right) because two things are true of the model today:

- **Sync-membership and read-capability are orthogonal axes.** Sync (receive/store/forward batches) is gated by `may_sync`; read (decrypt) requires a wrapped DEK in the `keyshares` table. A peer with **no keyshare holds ciphertext it provably cannot read** — "blind" is automatic, just *don't mint it a keyshare*.
- **But today every member is minted as a full owner.** [`attenuate_add_owner_third_party`](../app/src-tauri/src/spark_acc.rs) grants `owns(did, spark)`; the genesis rights are `read · write · delete · admit · rotate_dek` (no `replicate`); the ship path checks `AccOp::Write` ([`forwarding.rs:153`](../libs/aven-db/src/sync_manager/forwarding.rs)); and `authorize`'s DSL requires the subject be a `trusted_admin`. So there is no way to express "may sync, may not read, may not write, is not an owner" — which is exactly the aven.

**The blind-relay bundle (work items, mostly additive):**

1. **A `replicate` right** in the vocabulary (alongside `read/write/delete/admit/rotate_dek`). It authorizes *transfer of ciphertext* (receive · store · forward) — strictly weaker than read or write. Add `replicate` to the genesis grant too, so existing members satisfy a `replicate` check.
2. **`AccOp::Replicate`** in [`capability.rs`](../libs/aven-db/src/capability.rs) + `spark_acc`, and **gate the ship/transfer path on `Replicate`** instead of `Write` ([`forwarding.rs:153`](../libs/aven-db/src/sync_manager/forwarding.rs)). Shipping stored ciphertext is a replicate action, not a write — read/write members still pass (they hold `replicate` too), and a replicate-only aven now passes.
3. **A non-owner grant minter** — `attenuate_add_replicate_third_party(spark, aven_did)`: a third-party block (signed by an admin key) granting **only** `right(replicate, "spark:S:")` — **no `owns`, no read/write, no keyshare.**
4. **Generalize `authorize`'s DSL** — allow a subject holding a *delegated* `right(replicate, prefix)` even when it is **not** a `trusted_admin`. Biscuit third-party attenuation already guarantees the right was admin-signed, so the authorizer can trust a delegated right without the subject being an owner. **This is the same DSL generalization the tracker deferred for table/row caps (§1.1) — it pays for both.**
5. **Blind = no keyshare.** Omit replicate-only DIDs from DEK/keyshare distribution and `rotate_dek`. No new mechanism — just never wrap the DEK for them.

> Net: a person = `owns` + read/write + a keyshare (reads plaintext). An aven = `replicate` only + **no** keyshare (stores ciphertext, provably can't read). Both are members; both are `did:key` peers; the difference is one capability bundle. This is the **"Blind" badge** and the **"+ Add relay/backup"** affordance (tracker §7 V1) made real. Multiple avens per spark — no SPOF.

### 4.1 What it runs

```rust
// libs/aven-server/src/main.rs (sketch)
#[tokio::main]
async fn main() -> Result<()> {
    let cfg = AvenServerConfig::from_env()?;          // one config for all three roles
    let identity = load_or_create_keypair(&cfg)?;     // one did:key for the aven

    // 1. device admission (HTTP) — the ported aven-auth crate
    let auth = aven_auth::serve(cfg.auth.clone());     // axum on :3000

    // 2. the sync/backup transport — TLS server, N clients dial in (ships first)
    let transport = aven_p2p::ServerSyncTransport::serve(
        identity.clone(), cfg.tls.clone(), cfg.topics_for_held_sparks(),
    ).await?;
    // 2b. (P4) optionally also join the mesh, behind the same seam:
    //     aven_p2p::HyperswarmTransport::server(identity, cfg.bootstrap, …)
    let engine = JazzClient::connect_with_sync_transport(headless_ctx(&cfg), transport, None).await?;

    // 3. blind by default — replicate grant, no DEK; stores ciphertext, provably can't read
    engine.set_durability_tier(DurabilityTier::EdgeServer);

    tokio::try_join!(auth, run_mesh(engine))?;
    Ok(())
}
```

### 4.2 Properties

- **Star-topology sync/backup (now)** — the aven announces every topic it holds; devices dial it over TLS and reconcile against it instead of all-to-all. **One aven serves n+ sparks**, multiplexed over one connection per peer. Two devices never online together converge *through* it.
- **Direct mesh (later, additive)** — the same aven joins `server`-mode on peeroxide; devices that *can* holepunch get a direct path, and fall back to the aven's TLS endpoint when they can't. No code above the seam changes.
- **Blind by default** — the aven gets `right(replicate,"spark:S:")` (§4.0), **not** `owns`, and **no DEK**. It stores full ciphertext history (`DurabilityTier::EdgeServer`) and **provably cannot read** (Keet's blind mirror). A full-member replica (with DEK) is reserved for self-hosted, fully-trusted hubs.
- **Added by biscuit, like a person** — "+ Add relay/backup" in the app mints the replicate bundle (§4.0) for the aven's DID. The **resolver plumbing** is unchanged (`BiscuitCapabilityResolver` already maps DID→spark→`authorize`); what's new is the `replicate` right it can now authorize.
- **Indexer** — serves a single-signer stable frontier for new-device fast-forward (simpler than Autobase quorum; the aven is trust-rooted by its biscuit).
- **Auth + sync share identity** — the aven's did:key is both its biscuit subject (sync) and its admin identity (it can be the bootstrap admin that issues invites). One key, one source of truth for "who is this network's authority."

### 4.3 Run it locally, then host it

- **P3 (local):** `aven-server` runs on the dev machine, TLS on `127.0.0.1:PORT`. Two non-overlapping devices (never online together) converge **through** the aven over TLS. The dev harness can start it as a third process.
- **P3.5 (hosted, TLS):** containerize the **same** binary → fly.io. One TLS port for sync + the auth endpoints at `auth.testnet.aven.ceo` — **same binary, config only.** A device on the open internet dials it and converges with **no DHT, no holepunch** (client→server is reachable by construction). This is the durable off-device backup, in production.
- **P4 (mesh, additive):** the same binary *also* joins peeroxide; the `Peer → direct-mesh` graduation is "same biscuit, same protocol, zero code change above bootstrap config," with the TLS endpoint retained as fallback.

### 4.4 Persistence — the aven keeps two stores (same engine + storage as a device)

The aven runs the **same `aven-db` (groove) engine a device runs**, whose backend is **RocksDB** (`RocksDBStorage::open`, behind the `rocksdb` feature `client-p2p` pulls in). It persists replicated data exactly like a device — **just blind**:

| Store | Tech | Path (default) | Holds | Readable by the aven? |
|-------|------|----------------|-------|------------------------|
| **Engine** (the mirror) | **RocksDB** (a *directory*) | `db/` (`AVEN_OS_GROOVE_DATA_DIR`) | every mirrored spark's batches as **ciphertext** + the frontier (`DurabilityTier::EdgeServer`) | **No** — no DEK, provably can't decrypt |
| **Auth** | **SQLite** (a *file*) | `aven-auth.db` | invites · challenges · site-config / admin (§3) | n/a (its own metadata) |

> Note on naming: there is no single `aven.db` engine file — the engine store is a **RocksDB directory**. The only `.db` *file* is the SQLite **auth** store. On fly both live on one persistent volume.

This is the M3 graduation made literal: **device and aven are the same code over the same RocksDB storage**, differing only in *mode* (server vs client), *which biscuit* they hold (`replicate` vs `owns`/read/write), and *whether they hold a DEK* (the aven doesn't → blind). A self-hosted, fully-trusted hub that *should* read plaintext is the same binary **with** a DEK — a config/grant difference, not a code difference.

---

## 5. Execution — phases P0–P4

Each phase: **goal · work · acceptance · gate.** Gate on `cargo build` (lib default + `client-p2p`) **and** the §9 harness staying green after every step. P1 (TCP/TLS transport) and P2 (auth) can proceed in parallel — they meet at the shared did:key challenge; P3 needs both.

### P0 — crate skeletons, the seam, & isolation (no behavior)
- **Work:** create `libs/aven-server` (bin) + flesh `libs/aven-p2p` (lib) Cargo manifests; define `ServerSyncTransport`, `HyperswarmTransport`, and `AvenServerConfig` as stubs **behind the seam**. Build the real transport *in `aven-p2p`*, leaving `dev_transport.rs` as the throwaway harness (keeps Decision 4 a clean drop). Pull in `tokio-rustls`. **Parallel, off the critical path:** `cargo add peeroxide@1.3.1` in a throwaway `examples/swarm_smoke.rs` and confirm the §2.6 surface + a **local-bootstrap `HyperDhtConfig`** — buying down the mesh risk early *without* gating anything on it.
- **Acceptance:** both crates build; `ServerSyncTransport`/`HyperswarmTransport` are distinct `impl SyncTransport` stubs; peeroxide compiles in-tree.
- **Gate:** green build; the mesh's local-bootstrap question answered (recorded as fact for P4), but P1 unblocked regardless.

### P1 — authenticated TCP/TLS sync/backup transport ⟵ the headline
- **Work:** §2.3 (`aven-p2p` TLS path: `ServerSyncTransport` client + `ServerListener` server, N-client fan-out, TLS + did:key challenge handshake) + §2.4 (app + dev-harness wiring). Reuse the did:key challenge from P2 (or a thin shared crate if P2 lags).
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

### P4 — direct mesh (peeroxide), second transport + the keep/delete decision
- **Work:** implement `HyperswarmTransport` (§2.6) as a second `impl SyncTransport`; wire it as an alternative at `jazz/mod.rs`; the aven joins `server`-mode while keeping its TLS endpoint as fallback; salted/rotating topics for public-DHT metadata privacy. Run the **two-NAT holepunch spike** (the one *unverified* risk): two machines behind different NATs converge via holepunch/relay-fallback against a non-local bootstrap.
- **Acceptance:** a device gains a direct mesh path *and* still falls back to the aven's TLS endpoint; two-NAT holepunch proven (or its absence measured).
- **Gate & DECISION (Decision 4 resolved here):** with real holepunch numbers in hand —
  - **holepunch reliable** → the TLS path is demoted to optional/fallback (or scheduled for deletion); `dev_transport.rs` and the 2-peer dev env wiring are removed.
  - **holepunch flaky / blocked in common networks** → the TLS path **graduates to a permanent, supported fallback transport**; both coexist behind the seam indefinitely.
  - either way the change is a wiring/config selection at `jazz/mod.rs`, not a rewrite — which is the whole point of building both behind the seam.

---

## 6. Risks & open questions

| Risk | Severity | Mitigation |
|------|----------|------------|
| **TCP/TLS handshake auth** — the biscuit gate trusts the proven DID; a weak handshake spoofs the subject | **High (P1)** | TLS server cert + a real did:key challenge (§2.2 #2), reusing `aven-auth`'s verify (§3). Never ship the dev transport's plaintext 32-byte identity in a server path. This is the one corner we don't cut even though Decision 4 is deferred. |
| **peeroxide local bootstrap** — surface + version (**1.3.1**) source-confirmed (§2.6); open item is a **custom/local-bootstrap `HyperDhtConfig`** | Low — **no longer blocks shipping** | spiked in P0 as fact-finding only; gated to P4. If absent, run the bundled `peeroxide-dht`/`peeroxide-cli` as the dev bootstrap node. The TCP/TLS backup server ships regardless. |
| **Holepunch / relay-fallback parity** with JS HyperDHT | Medium — **blocks only the direct-mesh upgrade, not backup** | the P4 **two-NAT spike**. If parity is missing, the aven's TLS endpoint already bridges every client (it's the reachable rendezvous), so the network degrades gracefully to server-relayed — and Decision 4 resolves to "TLS is permanent fallback." |
| **`authorize` DSL generalization** (§4.0) — "membership ≡ ownership" → "authorize by delegated right" | Medium (blocks P3 + deferred table/row caps) | the same change the tracker deferred for granular caps; biscuit third-party attenuation already proves a right was admin-signed. Land behind `capability_gate` tests + new T11. |
| **Star topology = bottleneck / SPOF** (P3, before mesh) | Medium | the frontier model already supports **N** avens per spark (§4.0) — run more than one; the mesh upgrade (P4) removes the aven from the hot path for peers that can holepunch. A "backup server" being on the data path is by-definition acceptable for the backup role. |
| **Better-Auth feature parity** — sessions, bearer, admin gating | Medium | a *small slice*; the §3.1 contract is fully enumerated. Port exactly those 6 endpoints + bearer; the §3.2.6 parity smoke is the gate. |
| **Two transports coexisting** (TLS + peeroxide) | Low — **intended** | they are parallel `impl SyncTransport`s sharing one seam, one authorizer, one frontier (§1 invariant). The revised invariant permits it; the *unresolved* question is only whether to keep both long-term (Decision 4, P4). |
| **Topic-metadata leakage** — `hash("spark:S")` observable on a public DHT | Medium (P4 only) | salted/rotating topics; deferred to P4 where the DHT is public. The TLS path leaks no DHT topics at all. |
| **did:key codec divergence** across app / device / server | Low | reuse the in-tree `jazz_auth` codec in the Rust auth + transport crates — single implementation. |

---

## 7. Definition of done

- **P1:** `dev:app2x:mac` converges a spark through a local `aven-server` over **authenticated TLS** (two devices never online together), with grant→sync and revoke-not-retroactive verified live; the handshake proves the remote DID; §9 harness green.
- **P2:** the Rust `aven-auth` crate passes the parity smoke for all 6 endpoints + both flows; the app authenticates against it unchanged; TS package archived; its did:key verify backs the transport handshake.
- **P3:** the **blind-relay capability** (§4.0) lands (a `replicate`-only peer syncs ciphertext but is denied read/write and holds no keyshare, locked by T11); one `aven-server` binary serves **auth + blind mirror + rendezvous + indexer** under one identity, **hosted over TLS**; two non-overlapping devices converge through it; n+ sparks over one connection — **durable off-device backup, in production, with no DHT.**
- **P4:** `HyperswarmTransport` is added as a second `impl SyncTransport`; a device gains a direct mesh path with the TLS endpoint as fallback; the two-NAT holepunch spike yields the numbers that **resolve Decision 4** (TLS permanent-fallback vs retired stepping stone) as a wiring change, not a rewrite.

**Net at done:** one Rust binary built from three modular crates, serving **auth + blind sync/backup** over a hardened TLS transport first and an optional direct mesh second — with the "is TCP forever?" decision made *on evidence* at P4, and the conceptual split between "auth-server", "relay", and "transport" collapsed into one process the whole way through.

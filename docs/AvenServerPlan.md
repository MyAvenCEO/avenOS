# Aven Server — unified P2P + auth platform (end-to-end plan)

**Status:** plan · **Owner:** sync / platform · **Supersedes:** the *Transport* (§4) and *M2/M3* milestones of [`CapabilitySyncTracker.md`](./CapabilitySyncTracker.md). The capability/frontier model (§0–§3, §6, §9 of that doc) stands unchanged — this plan only swaps the **transport** under it and **consolidates the servers above it**.

**Thesis.** Today three things sit beside the engine: a dev **TCP transport** (a localhost stand-in), a TypeScript **auth-server** (`aven-auth`, device registration / invites), and a *planned* **sync relay** (`aven-server`, the always-on "aven"). They are three runtimes, three identities, three deploys. This plan collapses them into **one Rust binary — `aven-server`** — that is the network's *single source of truth*: it admits devices (auth), it is the rendezvous + blind mirror + indexer (relay), and it speaks the real mesh transport (peeroxide). The first executable step is local: **replace the dev TCP transport with peeroxide Hyperswarm, running against a local bootstrap DHT**, so `dev:app2x:mac` converges over the *real* transport with no server at all — then grow the same transport into the always-on aven.

**Decisions locked (this plan's premises).**
1. **`aven-server` is one Rust binary.** The did:key challenge/verify/invite flow is ported from TypeScript/Better-Auth into a Rust `aven-auth` crate; `aven-p2p` (peeroxide) + a headless `SyncManager` run in the same process. One fly deploy, one identity substrate.
2. **This is the canonical plan.** `CapabilitySyncTracker.md` is marked historical for transport + server topics.
3. **Peeroxide replaces the dev TCP transport** — no permanent stand-in. `dev_transport.rs` is deleted once the local peeroxide mesh is green.

---

## 0. What's scattered today (the starting state)

| Piece | Where | Runtime | Role | Fate |
|-------|-------|---------|------|------|
| **Dev TCP transport** | [`libs/aven-db/src/dev_transport.rs`](../libs/aven-db/src/dev_transport.rs) + `try_dev_peer_transport` in [`app/src-tauri/src/jazz/mod.rs:1321`](../app/src-tauri/src/jazz/mod.rs) | in-app (Rust) | localhost `127.0.0.1:14290` stand-in for the mesh | **delete** (→ peeroxide) |
| **aven-auth** | [`libs/aven-auth/`](../libs/aven-auth/) | TypeScript · SvelteKit · Better-Auth · better-sqlite3 · `:3000` | did:key challenge/verify, invites, bootstrap-admin, network-seed | **port to Rust**, archive TS |
| **aven-p2p** | [`libs/aven-p2p/`](../libs/aven-p2p/) | Rust (placeholder, empty) | future transport home | **fill** (peeroxide) |
| **aven-server** | — | — | the always-on "aven" (M2 of the tracker) | **create** (the unified binary) |
| **Sync engine** | [`libs/aven-db/`](../libs/aven-db/) (`groove`) | Rust | `RuntimeCore` + frontier sync + `SyncTransport` seam | **keep**, unchanged below the seam |

The frontier protocol is **already wired** in the engine — `SyncPayload::FrontierAnnounce` / `FrontierNeed` exist ([`sync_manager/inbox.rs:1014`](../libs/aven-db/src/sync_manager/inbox.rs), [`forwarding.rs:106`](../libs/aven-db/src/sync_manager/forwarding.rs)), the `SyncTransport` trait is the seam ([`sync_transport.rs`](../libs/aven-db/src/sync_transport.rs)), and `BiscuitCapabilityResolver` gates every frame. **Nothing in this plan touches the engine below `SyncTransport`.** The mesh is "one more `impl SyncTransport`"; the server is "a headless host of the same engine."

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
   UDP / DHT  ────────▶│  ┌────────────────────────────────────────┐   │
   (mesh, rendezvous)  │  │  aven-p2p :: HyperswarmTransport         │   │
                       │  │  (Rust crate, peeroxide)                 │   │
                       │  └────────────────────────────────────────┘   │
                       └───────────────────────────────────────────────┘
                                          ▲           ▲
            same SyncTransport seam       │           │   same did:key identity
                                          │           │
   ┌──────────────────────────────────────┐         (every device is a peer;
   │  app/src-tauri  (the device peer)      │          the aven is just an
   │  groove + aven-p2p HyperswarmTransport │          always-on peer)
   └──────────────────────────────────────┘
```

**Crate graph (Rust, standalone crates — there is no root cargo workspace):**

| Crate | Path | Kind | Owns | Depends on |
|-------|------|------|------|------------|
| `aven-db` (`groove`) | `libs/aven-db` | lib | engine, `SyncTransport` seam, frontier, `CapabilityResolver` trait | — |
| `aven-p2p` | `libs/aven-p2p` | lib | `HyperswarmTransport: SyncTransport`, topic/discovery-key derivation, handshake gate, local bootstrap helper | `aven-db`, `peeroxide` |
| `aven-auth` | `libs/aven-auth` | lib | did:key challenge/verify, invite issue/redeem, bootstrap-admin, network-seed, bearer sessions, sqlite store | `axum`/`rusqlite` (no `aven-db`) |
| `aven-server` | `libs/aven-server` | **bin** | the always-on aven: boots auth HTTP + headless `SyncManager` + `HyperswarmTransport` (server-mode) under one identity & config | `aven-db`, `aven-p2p`, `aven-auth` |

The **device app** (`app/src-tauri`) depends on `aven-db` + `aven-p2p` (client-mode transport). It does **not** depend on `aven-server` — server and device share *libraries*, not the host. This is the M3 graduation promise: device-peer and aven run the *same* engine + *same* transport, differing only in mode (client vs server) and which biscuit they hold.

> **Single-source-of-truth invariant, extended.** The tracker established *one authorizer* (biscuit caps) and *one tracker* (the frontier). This plan adds: **one transport** (`HyperswarmTransport`, no TCP beside it) and **one server** (`aven-server`, no TS auth-server + separate relay beside it). One-line test of any future change: *"does this reintroduce a transport beside `HyperswarmTransport`, an auth service beside `aven-auth`, or a server process beside `aven-server`?"* If yes, stop.

---

## 2. Part A — peeroxide transport (`aven-p2p`), local-first

This is the headline ask: **replace the dev TCP transport with the real Hyperswarm transport, locally.** It depends on *nothing* in Parts B/C — it ships first and proves the mesh end-to-end against a local DHT.

### 2.1 The seam (unchanged)

```rust
#[async_trait]
pub trait SyncTransport: Send + Sync {
    async fn send_to(&self, target: SyncTargetId, payload: SyncPayload) -> crate::Result<()>;
    async fn recv_inbound(&self) -> Option<InboxEntry>;
    async fn shutdown(&self) -> crate::Result<()> { Ok(()) }
}
```

`HyperswarmTransport` is one `impl` of this — exactly as `TcpSyncTransport` and `LoopbackTransport` already are. The app wires it where `try_dev_peer_transport` wires TCP today ([`jazz/mod.rs:1392`](../app/src-tauri/src/jazz/mod.rs)).

### 2.2 peeroxide mapping (source-confirmed from `peeroxide@1.3.1`)

Confirmed by reading the crate source (`peeroxide/src/{lib,swarm}.rs`, `peeroxide-dht/src/*`) — **version 1.3.1** (the README's "1.0.0" line is stale; `Cargo.toml` says 1.3.1). The crate is a cargo workspace: `peeroxide` (swarm) + `peeroxide-dht` (HyperDHT, Noise, holepunch, **`blind_relay`**) + `libudx` (reliable UDP) + `peeroxide-cli`.

```rust
use peeroxide::{spawn, discovery_key, JoinOpts, SwarmConfig};
let (handle, mut connections) = spawn(SwarmConfig::with_public_bootstrap()).await?;
let topic = discovery_key(b"spark:<S>");          // BLAKE2b-256, 32 bytes
handle.join(topic, JoinOpts { server: false, client: true }).await?;
while let Some(conn) = connections.recv().await {  // SwarmConnection
    let did = did_key(conn.remote_public_key());    // &[u8;32], Noise-authenticated
    // → may_sync(did, …) → frontier protocol over conn
}
```

| `SyncTransport` need | peeroxide@1.3.1 (confirmed) |
|----------------------|------------------------------|
| open swarm | `spawn(SwarmConfig) -> (SwarmHandle, receiver<SwarmConnection>)` — the receiver is our connection-accept loop |
| local identity | `SwarmConfig.key_pair: Option<KeyPair>` (Ed25519; generated if `None`) = device root key |
| topic join | `handle.join(topic: [u8;32], JoinOpts { server, client })`; `topic = discovery_key(b"spark:S")` — **never roll our own** |
| client vs server mode | `JoinOpts { server: announce, client: lookup }` (both default true). Device = client; aven = server |
| pipe + peer identity | `SwarmConnection::remote_public_key() -> &[u8;32]` — the **Noise-authenticated** remote static key → biscuit DID |
| bootstrap | `SwarmConfig::with_public_bootstrap()` (prod); **local DHT via `SwarmConfig.dht: HyperDhtConfig` with custom bootstrap** — confirm the exact `HyperDhtConfig` ctor in P0 (the one load-bearing item for offline `dev:app2x`) |
| relay / holepunch | `peeroxide-dht/src/{holepuncher,blind_relay}.rs`; `SwarmConfig.relay_through: Option<pubkey>` forces server conns through a named relay via the **blind-relay protocol**. Free; we don't build it (§2.6) |

**One P0 item remains:** confirm the custom/local-bootstrap constructor on `HyperDhtConfig`. Everything else above is read from source.

### 2.3 `aven-p2p` work items

1. **`HyperswarmTransport: SyncTransport`** — wrap a `SwarmHandle`. `send_to` writes a length-prefixed `SyncFrameV1` (reuse `encode_length_prefixed` from `aven-db`) onto the connection for `target`'s DID; a per-connection read-pump decodes frames into `InboxEntry { source: Source::Client(remote), payload }` and feeds an mpsc the way `dev_transport.rs` already does. The decode/queue half is a near-copy of `dev_transport.rs:80-113` — only the byte-pipe changes.
2. **Identity binding (free win).** secret-stream's Noise handshake is Ed25519; our DID is already Ed25519. Bind the swarm `KeyPair` to the device root key (`ed25519_public` in `jazz_auth`); the authenticated `remote_pubkey` **is** the biscuit subject DID, fed straight to `may_sync`. No separate identity exchange (the TCP transport's 32-byte handshake disappears — the Noise handshake supplies it).
3. **Topic derivation.** `resource_urn(spark) -> topic = hash("spark:S")`; join the topic via `discovery_key()`. Holding a biscuit for S *is* the subscription to S's topic (capability = membership = routing). Devices join **client mode** with finite `maxPeers`; sparks multiplex over one connection per peer (`PeerInfo` 1:1).
4. **Handshake gate.** On a new connection: `remote_pubkey → did:key → may_sync(subject, …)`. Reject unauthorized peers fast; rate-limit to blunt Sybil handshake spam. The DID *becomes* the biscuit subject here — the same gate the engine already applies per-frame, applied once at connect to drop hostile peers early.
5. **Local bootstrap helper.** A `spawn_local_bootstrap(addr) -> BootstrapHandle` that runs one peeroxide DHT node on `127.0.0.1` — the real DHT code path, offline, no public network. This is what makes "local peeroxide" possible.

### 2.4 App + dev-harness wiring

- Replace `try_dev_peer_transport` (TCP) with `try_peer_transport` (peeroxide): read bootstrap addr + device keypair, `HyperswarmTransport::join(topic_for_each_held_spark)`, register discovered peers via the existing `register_peer_sync_client` path. The revoke-skip logic ([`jazz/mod.rs:1400-1411`](../app/src-tauri/src/jazz/mod.rs)) carries over unchanged.
- [`scripts/dev-two-instances.ts`](../scripts/dev-two-instances.ts) starts **one local bootstrap DHT** (a tiny `aven-p2p --bootstrap 127.0.0.1:PORT` mode, or a dev helper bin) before the two Tauri instances; both bootstrap to it. No throwaway — the same bootstrap mechanism a self-hosted network uses.
- **Delete** `dev_transport.rs`, `tests/dev_transport.rs`, the `AVENOS_DEV_PEER_SYNC` / `AVENOS_DEV_INSTANCE` TCP env wiring, once the loopback→local-DHT→two-NAT ladder (§6 acceptance) is green.

### 2.5 Acceptance ladder (each rung green before the next)

1. **Loopback parity** — `HyperswarmTransport` over an in-memory peeroxide pair passes the same convergence the §9 `LoopbackTransport` harness proves (T4/T5).
2. **Local DHT, two instances** — `dev:app2x:mac` with the local bootstrap: A & B discover by spark topic, Noise-handshake, biscuit-gate, converge a row live, and heal across restart (the tracker's §10.1 live loop, now over the real transport).
3. **Two-NAT spike** (the one *unverified risk*) — two machines behind different NATs converge via holepunch/relay-fallback against a non-local bootstrap. Proves peeroxide's holepunch parity with JS HyperDHT before we depend on it.

### 2.6 Relay — two senses, both apply (this is the crux of "the server relays")

"Relay" means two different things and the aven does **both**; only one is something we build:

| Sense | What it is | Who provides it | Build? |
|-------|-----------|-----------------|--------|
| **Transport relay** | when two peers can't holepunch (NAT), a reachable third node forwards the *encrypted bytes* | **peeroxide's DHT** (hole-punching + relay, confirmed §2.2) — and any always-on, publicly-reachable aven naturally serves as one | **No** — free from the transport |
| **Data relay (store-and-forward / mirror)** | a node *holds* a spark's batches (as ciphertext) and *ships them onward* to other authorized peers on `FrontierNeed` — bridging devices never online together | **the aven**, via the frontier protocol | **Yes** — it's the aven's core job |

The data relay is **already proven in the §9 harness**: `T7 multi_hop_via_hub` shows a **blind** hub H bridge A→B (A and B never directly connect), and `T8 capability_gates_every_hop` shows H relays to B *iff* B's biscuit grants the spark. So the engine already supports a blind relaying hub — the aven is exactly that hub, made always-on. **What's missing is not the relay mechanism but the *capability vocabulary* to express "relay-only, blind" without making the node an owner** — see §4.0.

> Reconciles the tracker's "not a role we build: connectivity relay." That line meant *don't reimplement transport byte-relay* — correct, peeroxide gives it. It did **not** mean the aven doesn't bridge data: the mirror **is** a data relay, and we build it.

### 2.7 Secret-stream · topics · pairing — how a peer actually connects

This is the part that ties identity to authorization. **Three independent coordinates** answer three different questions — conflating them is the classic P2P security bug:

| Coordinate | Question | Value | Property |
|-----------|----------|-------|----------|
| **Topic** | *where do I look?* | `discovery_key(b"spark:S")` (BLAKE2b-256) | a rendezvous coordinate — **derivable by anyone who knows S**; not a secret, not authorization |
| **Static key / DID** | *who is this?* | `conn.remote_public_key()` from the Noise handshake | cryptographically **authenticated** — the peer proved it holds the private key |
| **Biscuit** | *are they allowed?* | `may_sync(did, op, resource)` | the gate — the **only** thing that authorizes |

> Topic gets you **found**, secret-stream proves **who**, the biscuit decides **whether**. The topic being public is *fine* — knowing where the door is isn't the key. Authorization never rests on topic secrecy (only metadata-privacy does → salted/rotating topics in P4).

**(a) Secret-stream — the authenticated pipe** (`peeroxide-dht/src/{noise,secret_stream,secretstream}.rs`).
After the DHT holepunches a `libudx` (reliable-UDP) connection, a **Noise handshake** runs over it: **XX** when neither side knows the other's static key (discovery), **IK** when the dialer already knows the responder's key (peeroxide ships both — `noise_golden_interop` + `noise_ik_golden_interop` tests). The result is an encrypted, mutually-authenticated duplex whose `remote_public_key()` is the **proven** remote static Ed25519 key.

This is the tracker's "identity free win" made concrete: our `SwarmConfig.key_pair` **is** the device root key, so `remote_public_key()` **is** the peer's `did:key` — fed straight to `may_sync`. **No application-level identity handshake** — the dev TCP transport's hand-rolled 32-byte exchange (`dev_transport.rs:73-77`) is deleted; the Noise handshake supersedes it.

**(b) Topic join & discovery** (`peeroxide/src/{swarm,peer_discovery}.rs`).
`handle.join(discovery_key("spark:S"), JoinOpts { server, client })`: **server** announces (publishes itself on the DHT under the topic), **client** looks up (queries for announcers). The DHT returns peers, holepunches, the secret-stream authenticates, and a `SwarmConnection` arrives on the receiver. **Capability = membership = routing**: the reason a peer joins S's topic is that it holds a biscuit for S — but because the topic is *derivable*, joining ≠ authorization. The biscuit gate at connect (and per-frame) is what actually admits. Devices join **client** (finite `maxPeers`); the aven joins **server** for every spark it holds, so devices always find something live.

**(c) The connect→authorize flow** (one path, both for devices and the aven):

```
for each held spark S:
    handle.join(discovery_key("spark:S"), JoinOpts{ client:true, server:is_aven })
on SwarmConnection conn:                     // Noise already authenticated remote_public_key()
    did = did_key(conn.remote_public_key())
    if may_sync(did, Replicate, resource(S)) == DenyPermanent:  drop  // fast Sybil reject + rate-limit
    else: register peer; run frontier protocol (FrontierAnnounce/Need) over conn
```

**(d) Pairing — first contact (app-level; peeroxide gives the primitives, not the protocol).**
peeroxide provides topic + secret-stream; it has **no pairing module** (confirmed — no `pair*` in the tree). Pairing is how a *brand-new* peer goes from "knows nothing" → "holds a biscuit for S". Two stages of ambition:

- **P1 dev shortcut** — raw-DID paste → `sparkAdminAdd` mints a grant. Works, but both sides must trade DIDs out-of-band and the inviter must already know the invitee's DID. Fine for `dev:app2x`.
- **Shipping target — blind pairing** (Keet `blind-pairing-core`, tracker §5/§7-V2), built over secret-stream on an **ephemeral pairing topic**:
  1. Inviter mints `invite = { pairing_topic = discovery_key(random_seed), seed }`; shares it out-of-band (QR / deep-link).
  2. Candidate joins `pairing_topic` (client), opens a secret-stream, and sends a pairing **request** authenticated with the seed-derived key, carrying its own DID.
  3. Inviter (announcing on `pairing_topic`) verifies the request against the seed, then **mints a biscuit grant** for the candidate's DID — read/write for a person, **`replicate` for an aven** (§4.0) — and returns the spark id + biscuit chain.
  4. Candidate now holds the biscuit → joins the **real** spark topic → converges via the frontier protocol.
  - **Why "blind":** the pairing topic is *random and ephemeral* (not the spark's), and DIDs are exchanged only **inside** the authenticated secret-stream — so a passive DHT observer learns neither the spark nor the participants' long-term identities until both have proven legitimacy. The same flow pairs a person or an aven; the aven just runs the candidate side once, then is a permanent member.

**(e) Pairing unifies with auth (why this lives in `aven-server`).** The invite token `aven-auth` issues today (§3) and the blind-pairing seed are the *same primitive* — a one-time, expiring secret that admits a new DID. Merging them means the **aven issues one invite** that simultaneously admits the device to the network (auth) and seeds the spark pairing (mesh). One issuer, one invite, one source of truth for "who may join" — exactly the consolidation this plan is for.

**(f) Three different "blind"s — do not conflate** (each is a separate layer; the aven can be all three at once):

| "Blind" | Layer | Means | Where |
|---------|-------|-------|-------|
| blind **relay** | transport | forwards *encrypted bytes* for NAT'd peers; has no stream keys, sees no plaintext | peeroxide `blind_relay.rs` / `SwarmConfig.relay_through` — **free** |
| blind **pairing** | first contact | invite/seed handshake; identities don't leak until both prove legitimacy | we build over secret-stream (§2.7d) |
| blind **mirror** | data | replicate-only member; stores **ciphertext**, holds no DEK, can't read | we build (§4.0) |

---

## 3. Part B — auth → Rust (`aven-auth` crate)

The app's auth client ([`app/src/lib/self/network-auth.ts`](../app/src/lib/self/network-auth.ts)) consumes a **small, fixed slice** of Better-Auth. The Rust port must preserve that wire contract **byte-for-byte** so the app keeps working unchanged.

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
2. **Store** — **SQLite via `rusqlite`** (decided above) over the same logical schema. Keep `AVEN_AUTH_DB_PATH` so existing dev DBs migrate trivially (same table/column names → a one-shot data copy, or just re-bootstrap in dev). Sits beside the engine's RocksDB dir on one fly volume (§4.4).
3. **Crypto** — `ed25519-dalek` verify; reuse the app's existing did:key codec (`jazz_auth::ed25519_public_from_peer_did` is the inverse already in-tree) so encode/decode is identical across app, device, and server.
4. **Sessions** — issue an opaque bearer token on `verify`, validate it on the admin-only endpoints. (Replaces Better-Auth's `bearer()` plugin with ~30 lines.)
5. **Config** — `AvenAuthConfig { auth_url, secret, db_path, domain, network_seed, invite_ttl, invite_scheme }` from env (same names as [`env.ts`](../libs/aven-auth/src/lib/env.ts)), so `.env` is unchanged.
6. **Parity smoke** — port [`scripts/smoke-api.ts`](../libs/aven-auth/scripts/smoke-api.ts) to run against the Rust server; assert identical JSON shapes + status codes. **This is the cutover gate.**

### 3.3 Transition (no big-bang)

- **Start P2:** move the TS package `libs/aven-auth` → `ARCHIVE/aven-auth-ts` (frees the name); the archived TS server still boots in dev so the app never loses auth.
- **Build** the Rust crate at `libs/aven-auth`. App keeps hitting the TS server until parity smoke passes.
- **Cut over:** dev scripts ([`scripts/dev-aven-auth.ts`](../scripts/dev-aven-auth.ts)) boot the Rust binary (eventually `aven-server`, §4) instead of the TS server on `:3000`. The app's `network-auth.ts` is **untouched** (same URL, same shapes). Delete `ARCHIVE/aven-auth-ts` after a soak.

---

## 4. Part C — `aven-server` binary (the always-on aven)

One process = **device-admission authority + rendezvous + blind mirror + indexer**, all under one did:key identity and one config. This is the tracker's M2 ("local always-on aven") and M3 ("hosted aven"), now unified with auth.

### 4.0 The blind-relay capability — the aven is *just a member*

**The aven is added to a spark exactly like a person: a `did:key` granted a biscuit.** The *only* difference from adding a human is the **capability bundle** it receives. This needs one new, mostly-additive piece — a `replicate` right — because two things are true of the model today:

- **Sync-membership and read-capability are orthogonal axes.** Sync (receive/store/forward batches) is gated by `may_sync`; read (decrypt) requires a wrapped DEK in the `keyshares` table. A peer with **no keyshare holds ciphertext it provably cannot read** — "blind" is automatic, just *don't mint it a keyshare*.
- **But today every member is minted as a full owner.** [`attenuate_add_owner_third_party`](../app/src-tauri/src/spark_acc.rs) grants `owns(did, spark)`; the genesis rights are `read · write · delete · admit · rotate_dek` (no `replicate`); the ship path checks `AccOp::Write` ([`forwarding.rs:153`](../libs/aven-db/src/sync_manager/forwarding.rs)); and `authorize`'s DSL requires the subject be a `trusted_admin`. So there is no way to express "may sync, may not read, may not write, is not an owner" — which is exactly the aven.

**The blind-relay bundle (work items, mostly additive):**

1. **A `replicate` right** in the vocabulary (alongside `read/write/delete/admit/rotate_dek`). It authorizes *transfer of ciphertext* (receive · store · forward) — strictly weaker than read or write. Add `replicate` to the genesis grant too, so existing members (who can obviously also relay) satisfy a `replicate` check.
2. **`AccOp::Replicate`** in [`capability.rs`](../libs/aven-db/src/capability.rs) + `spark_acc`, and **gate the ship/transfer path on `Replicate`** instead of `Write` ([`forwarding.rs:153`](../libs/aven-db/src/sync_manager/forwarding.rs)). Shipping stored ciphertext is a replicate action, not a write — read/write members still pass (they hold `replicate` too), and a replicate-only aven now passes.
3. **A non-owner grant minter** — `attenuate_add_replicate_third_party(spark, aven_did)`: a third-party block (signed by an admin key, like the owner minter) granting **only** `right(replicate, "spark:S:")` — **no `owns`, no read/write, no keyshare.**
4. **Generalize `authorize`'s DSL** — allow a subject holding a *delegated* `right(replicate, prefix)` even when it is **not** a `trusted_admin`. Today the DSL hard-requires `trusted_admin($p)` (membership ≡ ownership); biscuit third-party attenuation already guarantees the right was signed by an admin, so the authorizer can trust a delegated right without the subject being an owner. **This is the same DSL generalization the tracker deferred for table/row caps (§1.1) — it pays for both.**
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

    // 2. the mesh — same engine the device runs, headless, server-mode
    let transport = aven_p2p::HyperswarmTransport::server(
        identity.clone(), cfg.bootstrap.clone(), cfg.topics_for_held_sparks(),
    ).await?;
    let engine = JazzClient::connect_with_sync_transport(headless_ctx(&cfg), transport, None).await?;

    // 3. blind by default — replicate grant, no DEK; stores ciphertext, provably can't read
    engine.set_durability_tier(DurabilityTier::EdgeServer);

    tokio::try_join!(auth, run_mesh(engine))?;
    Ok(())
}
```

### 4.2 Properties (from tracker §3, now concrete)

- **Server-mode swarm** — announces every topic it holds; devices reconcile against it instead of all-to-all. **One aven serves n+ sparks**, multiplexed over one connection per peer.
- **Blind by default** — the aven gets `right(replicate,"spark:S:")` (§4.0), **not** `owns`, and **no DEK**. It stores full ciphertext history (`DurabilityTier::EdgeServer`) and **provably cannot read** (Keet's blind mirror). A full-member replica (with DEK) is reserved for self-hosted, fully-trusted hubs.
- **Added by biscuit, like a person** — "+ Add relay/backup" in the app mints the replicate bundle (§4.0) for the aven's DID. The **resolver plumbing** is unchanged (`BiscuitCapabilityResolver` already maps DID→spark→`authorize`); what's new is the `replicate` right it can now authorize.
- **Indexer** — serves a single-signer stable frontier for new-device fast-forward (simpler than Autobase quorum; the aven is trust-rooted by its biscuit).
- **Auth + mesh share identity** — the aven's did:key is both its biscuit subject (mesh) and its admin identity (it can be the bootstrap admin that issues invites). One key, one source of truth for "who is this network's authority."

### 4.3 Run it locally, then host it

- **P3 (local):** `aven-server` runs on the dev machine, bootstrapped to the same local DHT as `dev:app2x`. Two non-overlapping devices (never online together) converge **through** the aven. The dev harness can optionally start it as a third process.
- **P4 (hosted):** containerize the **same** binary → fly.io. Bootstrap against public HyperDHT; salted/rotating topics (blunt topic-metadata leakage). The auth endpoints move from `localhost:3000` to `auth.testnet.aven.ceo` — **same binary, config only.** The `Peer → Server` graduation is "same biscuit, same protocol, zero code change above bootstrap config."

### 4.4 Persistence — the aven keeps two stores (same engine + storage as a device)

The aven runs the **same `aven-db` (groove) engine a device runs**, whose backend is **RocksDB** (`RocksDBStorage::open`, behind the `rocksdb` feature `client-p2p` pulls in). So it persists replicated data exactly like a device — **just blind**:

| Store | Tech | Path (default) | Holds | Readable by the aven? |
|-------|------|----------------|-------|------------------------|
| **Engine** (the mirror) | **RocksDB** (a *directory*) | `db/` (`AVEN_OS_GROOVE_DATA_DIR`) | every mirrored spark's batches as **ciphertext** + the frontier (`DurabilityTier::EdgeServer`) | **No** — no DEK, provably can't decrypt |
| **Auth** | **SQLite** (a *file*) | `aven-auth.db` | invites · challenges · site-config / admin (§3) | n/a (its own metadata) |

> Note on naming: there is no single `aven.db` engine file — the engine store is a **RocksDB directory**. The only `.db` *file* is the SQLite **auth** store. On fly (P4) both live on one persistent volume.

This is the M3 graduation made literal: **device and aven are the same code over the same RocksDB storage**, differing only in *mode* (server vs client), *which biscuit* they hold (`replicate` vs `owns`/read/write), and *whether they hold a DEK* (the aven doesn't → blind). A self-hosted, fully-trusted hub that *should* read plaintext is the same binary **with** a DEK — a config/grant difference, not a code difference.

---

## 5. Execution — phases P0–P4

Each phase: **goal · work · delete · acceptance · gate.** Gate on `cargo build` (lib default + `client-p2p`) **and** the §9 harness staying green after every step. Phases are mostly independent — P1 (transport) and P2 (auth) can proceed in parallel; P3 needs both.

### P0 — crate skeletons & boundaries (no behavior)
- **Work:** create `libs/aven-server` (bin) + flesh `libs/aven-p2p` (lib) Cargo manifests; define `HyperswarmTransport` and `AvenServerConfig` as stubs; `cargo add peeroxide` and in a throwaway `examples/swarm_smoke.rs` **pin the version** and **confirm the §2.2 surface** — especially a **local/custom bootstrap** constructor (not just `with_public_bootstrap()`) and the connection-receiver channel from `spawn()`.
- **Acceptance:** workspace builds; peeroxide compiles in-tree; the spike opens a swarm against a **local** bootstrap, derives a `discovery_key`, joins a topic, and accepts a connection exposing `remote_public_key()`.
- **Gate:** green build; §6 *peeroxide* risk closed (version pinned + local bootstrap confirmed, or §2.2 corrected to the real surface).

### P1 — real transport, local (replaces dev TCP) ⟵ the headline
- **Work:** §2.3 (`aven-p2p`) + §2.4 (app + dev harness wiring) + local bootstrap helper.
- **Delete:** `dev_transport.rs`, `tests/dev_transport.rs`, TCP dev-env wiring.
- **Acceptance:** §2.5 ladder rungs 1–2 (loopback parity + local-DHT two-instance live convergence, incl. grant→sync and revoke-not-retroactive from tracker §10.1).
- **Gate:** §9 harness green; `dev:app2x:mac` converges over peeroxide with no TCP.

### P2 — auth → Rust (`aven-auth` crate) ‖ parallel to P1
- **Work:** §3.2 (axum + rusqlite + ed25519 + bearer + parity smoke); §3.3 transition (archive TS).
- **Delete:** (deferred to end) `ARCHIVE/aven-auth-ts` after soak.
- **Acceptance:** ported smoke-api asserts byte-identical responses to the TS server for all 6 endpoints + both flows; app registers a device against the Rust server unchanged.
- **Gate:** parity smoke green; app's `network-auth.ts` untouched.

### P3 — `aven-server` binary, local always-on aven (= tracker M2, unified)
- **Work:** **§4.0 the blind-relay capability first** (the `replicate` right + `AccOp::Replicate` + non-owner minter + `authorize` DSL generalization + keyshare omission) — without it there is no "relay-only, blind" peer to add; then §4.1 (boot auth + headless engine + server-mode transport under one identity/config); "+ Add relay/backup" UI mints the replicate grant (Blind badge); multi-tenant topic join.
- **Delete:** `scripts/dev-aven-auth.ts`'s TS-server boot → boot `aven-server` instead; the separate `:3000` TS process.
- **Acceptance:** a `replicate`-only peer converges (receives + forwards ciphertext) but its `may_sync` denies a `Write`/`Read` op and it holds **no** keyshare (can't decrypt); two devices never online together converge through the local aven; n+ sparks over one connection; auth served by the same binary. A new harness test `T11 replicate_only_relays_blind` locks it (mirrors `T7`/`T8`, asserting deny-on-read/write + empty-keyshare).
- **Gate:** the tracker's §3 aven properties demonstrated locally; §9 harness (incl. T11) green; auth parity smoke still green against `aven-server`.

### P4 — hosted aven (= tracker M3)
- **Work:** Dockerfile + fly config for the **same** binary; public HyperDHT bootstrap; salted/rotating topics; prod auth at `auth.testnet.aven.ceo` from the same process; persistent volume for the ciphertext store + auth sqlite.
- **Acceptance:** a device on the open internet pairs (auth), is granted into a spark, and converges through the hosted aven; two-NAT holepunch (§2.5 rung 3) proven in the wild.
- **Gate:** prod smoke (auth + a real spark convergence) green; rollback = redeploy previous image.

---

## 6. Risks & open questions

| Risk | Severity | Mitigation |
|------|----------|------------|
| **peeroxide local bootstrap** — surface + version (**1.3.1**) now source-confirmed (§2.2); the one open item is a **custom/local-bootstrap `HyperDhtConfig`** for the offline dev DHT | Medium (blocks P1's local rung only) | **P0 spike** — `cargo add peeroxide@1.3.1`, confirm `HyperDhtConfig` accepts custom bootstrap addrs and that two nodes converge against a `127.0.0.1` bootstrap. If absent, run the bundled `peeroxide-dht`/`peeroxide-cli` as the dev bootstrap node. Do **not** start P1 until the spike connects two local nodes. |
| **Holepunch / relay-fallback parity** with JS HyperDHT | High (blocks P4, not P1) | the §2.5 **two-NAT spike** (rung 3) — explicitly *not* loopback. If parity is missing, the always-on aven's transport-relay still bridges (aven is a public-reachable node both peers can dial), so P3/P4 degrade gracefully to relayed rather than holepunched. |
| **`authorize` DSL generalization** (§4.0) — moving from "membership ≡ ownership" to "authorize by delegated right" | Medium (blocks P3 + the deferred table/row caps) | the change is the *same* one the tracker deferred for granular caps; biscuit third-party attenuation already proves a right was admin-signed. Land it behind the existing `capability_gate` tests + new T11 before wiring the aven. |
| **Better-Auth feature parity** — sessions, bearer, admin gating | Medium | we use a *small slice*; the §3.1 contract is fully enumerated. Port exactly those 6 endpoints + bearer; the §3.2.6 parity smoke is the objective gate. |
| **sqlite in two runtimes during transition** | Low | dev re-bootstraps; prod is a fresh deploy. Keep column/table names identical for an optional one-shot copy. |
| **Topic-metadata leakage** — `hash("spark:S")` is observable | Medium (P4) | salted/rotating topics (tracker §3 caveat); deferred to P4 where it matters (public DHT). |
| **One binary = one blast radius** — auth + mesh fail together | Low/Medium | they already share an identity; for HA, run **multiple avens per spark** (tracker §3) — the model already allows N, no SPOF. |
| **did:key codec divergence** across app / device / server | Low | reuse the in-tree `jazz_auth` codec in the Rust auth crate — single implementation, not a re-derivation. |

---

## 7. Definition of done

- **P1:** `dev:app2x:mac` converges a spark over **peeroxide against a local bootstrap DHT**, with grant→sync and revoke-not-retroactive verified live; `dev_transport.rs` deleted; §9 harness green.
- **P2:** the Rust `aven-auth` crate passes the parity smoke for all 6 endpoints + both flows; the app authenticates against it unchanged; TS package archived.
- **P3:** the **blind-relay capability** (§4.0) lands (a `replicate`-only peer syncs ciphertext but is denied read/write and holds no keyshare, locked by T11); one `aven-server` binary, run locally, serves **auth + blind mirror + rendezvous + indexer** under one identity; two non-overlapping devices converge through it; n+ sparks over one connection.
- **P4:** the **same** binary, hosted on fly, admits a device and converges a real spark over public HyperDHT; two-NAT holepunch proven.

**Net deletion at done:** `dev_transport.rs` (+ test + env wiring), the TypeScript `aven-auth` server, the standalone `:3000` dev process, and the conceptual split between "auth-server", "relay", and "transport" — collapsed into one Rust binary built from three modular crates.

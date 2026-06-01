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

### 2.2 peeroxide mapping (verify against the crate before coding — see §6)

The tracker captured this surface from [peeroxide](https://rightbracket.github.io/peeroxide/); **treat as unverified until a `cargo add peeroxide` spike confirms the exact names/signatures** (external docs were unreachable at planning time):

| `SyncTransport` need | peeroxide (expected) |
|----------------------|----------------------|
| open swarm | `spawn(SwarmConfig) -> SwarmHandle` |
| topic join | derive `topic = blake3("spark:S")`; peeroxide `discovery_key()` (BLAKE2b) for announce/lookup — **never roll our own** |
| pipe + peer identity | `SwarmConnection { remote_pubkey: Ed25519, stream }` → biscuit DID |
| local identity | `KeyPair` (Ed25519) = device root key |
| client vs server mode | `join({ server, client, limit })`-style flags |
| bootstrap | `SwarmConfig { bootstrap: Vec<SocketAddr> }` |

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

---

## 3. Part B — auth → Rust (`aven-auth` crate)

The app's auth client ([`app/src/lib/self/network-auth.ts`](../app/src/lib/self/network-auth.ts)) consumes a **small, fixed slice** of Better-Auth. The Rust port must preserve that wire contract **byte-for-byte** so the app keeps working unchanged.

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
2. **Store** — `rusqlite` (or `sqlx`-sqlite) over the same logical schema. Keep `AVEN_AUTH_DB_PATH` so existing dev DBs migrate trivially (same table/column names → a one-shot data copy, or just re-bootstrap in dev).
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
- **Blind by default** — the aven gets `right(replicate,"spark:S:")`, **not** `owns`, and **no DEK**. It stores full ciphertext history (`DurabilityTier::EdgeServer`) and **provably cannot read** (Keet's blind mirror). A full-member replica (with DEK) is reserved for self-hosted, fully-trusted hubs.
- **Added by biscuit, like a person** — "+ Add relay/backup" in the app mints a replicate-grant for the aven's DID. **No new gating** — `BiscuitCapabilityResolver` already authorizes it.
- **Indexer** — serves a single-signer stable frontier for new-device fast-forward (simpler than Autobase quorum; the aven is trust-rooted by its biscuit).
- **Auth + mesh share identity** — the aven's did:key is both its biscuit subject (mesh) and its admin identity (it can be the bootstrap admin that issues invites). One key, one source of truth for "who is this network's authority."

### 4.3 Run it locally, then host it

- **P3 (local):** `aven-server` runs on the dev machine, bootstrapped to the same local DHT as `dev:app2x`. Two non-overlapping devices (never online together) converge **through** the aven. The dev harness can optionally start it as a third process.
- **P4 (hosted):** containerize the **same** binary → fly.io. Bootstrap against public HyperDHT; salted/rotating topics (blunt topic-metadata leakage). The auth endpoints move from `localhost:3000` to `auth.testnet.aven.ceo` — **same binary, config only.** The `Peer → Server` graduation is "same biscuit, same protocol, zero code change above bootstrap config."

---

## 5. Execution — phases P0–P4

Each phase: **goal · work · delete · acceptance · gate.** Gate on `cargo build` (lib default + `client-p2p`) **and** the §9 harness staying green after every step. Phases are mostly independent — P1 (transport) and P2 (auth) can proceed in parallel; P3 needs both.

### P0 — crate skeletons & boundaries (no behavior)
- **Work:** create `libs/aven-server` (bin) + flesh `libs/aven-p2p` (lib) Cargo manifests; define `HyperswarmTransport` and `AvenServerConfig` as stubs; spike `cargo add peeroxide` and **verify the §2.2 API names** in a throwaway `examples/swarm_smoke.rs`.
- **Acceptance:** workspace builds; peeroxide compiles in-tree; the spike opens a swarm + derives a discovery key.
- **Gate:** green build; §6 risk *peeroxide-API* downgraded from "unverified" to "confirmed" (or the plan's §2.2 table corrected).

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
- **Work:** §4.1 (boot auth + headless engine + server-mode transport under one identity/config); "+ Add relay/backup" UI mints the replicate grant (Blind badge); multi-tenant topic join.
- **Delete:** `scripts/dev-aven-auth.ts`'s TS-server boot → boot `aven-server` instead; the separate `:3000` TS process.
- **Acceptance:** two devices never online together converge through the local aven; the aven holds ciphertext only (no DEK, can't decrypt); n+ sparks over one connection; auth served by the same binary.
- **Gate:** the tracker's §3 aven properties demonstrated locally; §9 green; auth parity smoke still green against `aven-server`.

### P4 — hosted aven (= tracker M3)
- **Work:** Dockerfile + fly config for the **same** binary; public HyperDHT bootstrap; salted/rotating topics; prod auth at `auth.testnet.aven.ceo` from the same process; persistent volume for the ciphertext store + auth sqlite.
- **Acceptance:** a device on the open internet pairs (auth), is granted into a spark, and converges through the hosted aven; two-NAT holepunch (§2.5 rung 3) proven in the wild.
- **Gate:** prod smoke (auth + a real spark convergence) green; rollback = redeploy previous image.

---

## 6. Risks & open questions

| Risk | Severity | Mitigation |
|------|----------|------------|
| **peeroxide API drift** — §2.2 names captured from docs we couldn't re-fetch at planning time | High (blocks P1) | **P0 spike first** — `cargo add peeroxide`, confirm `spawn`/`SwarmConfig`/`discovery_key`/`SwarmConnection`/`KeyPair`; correct §2.2 before building. Do **not** start P1 until the spike compiles. |
| **Holepunch / relay-fallback parity** with JS HyperDHT | High (blocks P4, not P1) | the §2.5 **two-NAT spike** (rung 3) — explicitly *not* loopback. If parity is missing, the always-on aven's transport-relay still bridges (aven is a public-reachable node), so P3/P4 degrade gracefully to relayed rather than holepunched. |
| **Better-Auth feature parity** — sessions, bearer, admin gating | Medium | we use a *small slice*; the §3.1 contract is fully enumerated. Port exactly those 6 endpoints + bearer; the §3.2.6 parity smoke is the objective gate. |
| **sqlite in two runtimes during transition** | Low | dev re-bootstraps; prod is a fresh deploy. Keep column/table names identical for an optional one-shot copy. |
| **Topic-metadata leakage** — `hash("spark:S")` is observable | Medium (P4) | salted/rotating topics (tracker §3 caveat); deferred to P4 where it matters (public DHT). |
| **One binary = one blast radius** — auth + mesh fail together | Low/Medium | they already share an identity; for HA, run **multiple avens per spark** (tracker §3) — the model already allows N, no SPOF. |
| **did:key codec divergence** across app / device / server | Low | reuse the in-tree `jazz_auth` codec in the Rust auth crate — single implementation, not a re-derivation. |

---

## 7. Definition of done

- **P1:** `dev:app2x:mac` converges a spark over **peeroxide against a local bootstrap DHT**, with grant→sync and revoke-not-retroactive verified live; `dev_transport.rs` deleted; §9 harness green.
- **P2:** the Rust `aven-auth` crate passes the parity smoke for all 6 endpoints + both flows; the app authenticates against it unchanged; TS package archived.
- **P3:** one `aven-server` binary, run locally, serves **auth + blind mirror + rendezvous + indexer** under one identity; two non-overlapping devices converge through it; n+ sparks over one connection.
- **P4:** the **same** binary, hosted on fly, admits a device and converges a real spark over public HyperDHT; two-NAT holepunch proven.

**Net deletion at done:** `dev_transport.rs` (+ test + env wiring), the TypeScript `aven-auth` server, the standalone `:3000` dev process, and the conceptual split between "auth-server", "relay", and "transport" — collapsed into one Rust binary built from three modular crates.

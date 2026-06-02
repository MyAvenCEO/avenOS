---
title: Direct P2P mesh transport (peeroxide Hyperswarm) — deferred behind TCP/TLS
summary: A second SyncTransport for direct device↔device sync over a DHT. P0 spike DONE & proven; parked behind the TCP/TLS aven-server until its NAT-holepunch risk is measured.
owner: unassigned
created: 2026-06-02
updated: 2026-06-02
tags: [sync, transport, p2p, deferred]
goal:
---

# Direct P2P mesh transport (peeroxide Hyperswarm)

> **Status: deferred, not dead.** This was the original P1 of the aven-server plan,
> then re-sequenced to TCP/TLS-first (see [`docs/AvenServerPlan.md`](../../../../docs/AvenServerPlan.md)).
> The **P0 spike is complete and proven** — all the hard unknowns are answered and
> recorded below so this can be revived cold. It returns as a **second
> `impl SyncTransport` behind the same seam**, *after* the TCP/TLS aven-server ships.

## Context

`peeroxide` is a pure-Rust port of Hyperswarm (Kademlia DHT + Noise secret-stream +
UDP holepunch + relay, wire-compatible with the JS HyperDHT). It gives exactly two
things behind the existing `SyncTransport` seam: **discovery-by-topic** + an
**authenticated encrypted pipe** — not sync. We keep Groove's frontier protocol over
the pipe (do **not** adopt Autobase).

Why deferred (not chosen now): the TCP/TLS path buys down two real unknowns by
*deferring* them — peeroxide's local-bootstrap story (answered below) and, the one
genuinely unmeasured risk, **NAT holepunch parity** with JS HyperDHT (needs a
two-NAT spike, not loopback). A single TLS port deploys trivially (fly.io, one
listener, no UDP/DHT), survives corporate firewalls, and is trivial to observe. We
ship durable off-device sync first; add direct mesh when its risk is *measured*.

## What's already PROVEN (P0 spike — do not re-discover)

Verified by reading `peeroxide@1.3.1` source + a passing `swarm_smoke` example
(two nodes connected over a **local** bootstrap DHT and exchanged a frame, offline):

**Crate:** `peeroxide = "1.3.1"` (+ `peeroxide-dht`, `libudx`). Compiles clean in-tree
(~24s cold). The README says "1.0.0" but `Cargo.toml` is **1.3.1** — pin 1.3.1.

**API surface (source-confirmed):**
```rust
use peeroxide::{spawn, discovery_key, JoinOpts, SwarmConfig};
// spawn(config) -> (JoinHandle, SwarmHandle, mpsc::Receiver<SwarmConnection>)
let (_task, handle, mut conn_rx) = spawn(cfg).await?;
let topic = discovery_key(b"spark:<S>");          // BLAKE2b-256, 32 bytes
handle.join(topic, JoinOpts{ server, client }).await?;   // server=announce, client=lookup
while let Some(conn) = conn_rx.recv().await {
    let did = conn.remote_public_key();            // &[u8;32], NOISE-AUTHENTICATED → biscuit DID
    let stream = conn.peer.stream;                 // SecretStream<UdxAsyncStream>
}
```

**Gotchas already hit & solved:**
- `SwarmConfig`, `JoinOpts`, `DhtConfig` are all `#[non_exhaustive]` → **no struct
  literals**. Construct via `::default()` / `SwarmConfig::with_public_bootstrap()` then
  mutate public fields (`cfg.dht.dht.bootstrap`, `opts.server`, …).
- **Identity binding is free:** `KeyPair::from_seed([u8;32])` derives from the device's
  Ed25519 root seed; `public_key` == the did:key pubkey. So `remote_public_key()` *is*
  the peer's biscuit-subject DID — fed straight to `may_sync`. No app-level identity
  handshake (the dev-TCP plaintext 32-byte exchange is gone).
- **Local/offline bootstrap recipe** (the load-bearing open question — ANSWERED):
  `cfg.dht.dht.bootstrap = vec!["127.0.0.1:PORT"]`, `host="127.0.0.1"`, `port=PORT`,
  `ephemeral=Some(false)`, `firewalled=false`. A node with **empty** bootstrap +
  fixed port + non-ephemeral is the DHT root; others point at it. Two members + one
  root converged on localhost.
- **Duplex problem & solution:** `SecretStream` is a single `&mut`-only,
  non-cancel-safe, non-splittable duplex (`read()` uses `read_exact` — cancelling
  mid-frame desyncs). Direct `select!` over `read()`+writes corrupts the stream.
  **Solution: protomux** (`peeroxide_dht::protomux`). `Mux::new(stream)` spawns a task
  that owns the stream; a `Channel` gives **mpsc-backed `recv()` (cancel-safe)** +
  **non-blocking `send()`**. A per-connection `select!` over `channel.recv()` + an
  outbound mpsc is then fully correct. Both sides `create_channel("avenos/sync", …)`.
- **Connection keep-alive:** `SwarmConnection`/`PeerConnection` have **no `Drop`**, so
  partial-moving `conn.peer.stream` into the mux is OK — but keep the rest of `conn`
  in scope (UDX runtime/socket guards) for the connection's life.
- **Relay is built in:** `peeroxide-dht/src/blind_relay.rs` + `SwarmConfig.relay_through`
  → transport byte-relay/holepunch is free; we don't build it.
- **Noise:** XX (discovery) + IK (known key) both shipped with golden interop tests.

**The working code exists in git history** (branch `feat/aven-server-peeroxide`,
commit `ef72581`): `libs/aven-p2p/src/transport.rs` (`HyperswarmTransport: SyncTransport`,
protomux duplex, dynamic peer discovery via `next_peer()`), `libs/aven-p2p/src/lib.rs`
(`spark_topic`, `member_config`, `local_bootstrap_config`, `join_opts`), and
`examples/swarm_smoke.rs` (the passing proof). Revive from there — do not rewrite.

## The three coordinates (the model — keep when revived)

Topic = *where* (`discovery_key("spark:S")`, public/derivable) · DID = *who*
(`remote_public_key()`, Noise-authenticated) · biscuit = *whether* (`may_sync`).
Topic finds you, secret-stream proves who, the biscuit decides whether. Authorization
never rests on topic secrecy (only metadata-privacy → salted/rotating topics on the
public DHT).

**Pairing** (first contact) is app-level — peeroxide gives topic + secret-stream, not
the invite/grant protocol. Target: blind pairing (Keet `blind-pairing-core`) over an
ephemeral pairing topic; the invite seed == the aven-auth invite token (one primitive).

## Three different "blind"s (don't conflate)

| "Blind" | Layer | Means | Where |
|---|---|---|---|
| blind **relay** | transport | forwards encrypted bytes for NAT'd peers | peeroxide `blind_relay.rs` — free |
| blind **pairing** | first contact | identities don't leak until both prove legit | we build over secret-stream |
| blind **mirror** | data | replicate-only member, stores ciphertext, no DEK | the TCP/TLS aven-server (shared!) |

> The **blind-mirror / replicate capability** is NOT peeroxide-specific — it's built in
> the TCP/TLS aven-server (P3) and reused verbatim when this mesh revives.

## Goal (when revived)

Direct device↔device sync over peeroxide as a second `impl SyncTransport`, selected
at `jazz/mod.rs` alongside the TLS path; the aven joins `server`-mode while keeping
its TLS endpoint as fallback. The keep/delete-TLS decision is made here, with real
holepunch numbers.

## Acceptance criteria (when revived)

- [ ] `HyperswarmTransport` restored from `ef72581` and builds against the current seam.
- [ ] `dev:app2x` converges a spark over peeroxide + local bootstrap (no TLS) — proven by the two-instance run.
- [ ] **Two-NAT spike** (the one unmeasured risk): two machines behind different NATs converge via holepunch/relay-fallback against a non-local bootstrap — proven, or its failure rate measured.
- [ ] Keep/delete-TLS decision recorded with the holepunch numbers.

## Progress log

- `2026-06-02` — Created in inbox. P0 spike already DONE (peeroxide@1.3.1 API
  pinned, protomux duplex solved, local-bootstrap recipe proven, `swarm_smoke`
  passing). Code preserved at commit `ef72581`. Deferred behind the TCP/TLS
  aven-server per direction change; this card is the revival spec.

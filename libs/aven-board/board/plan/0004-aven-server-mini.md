---
title: Aven Server Mini — authenticated TLS sync transport + Docker→fly deploy pipeline
summary: A headless, stateless aven — an encrypted TLS ServerSyncTransport (server-auth cert + client did:key challenge) plus a Docker image and fly.toml ready to push to a remote fly machine.
owner: unassigned
created: 2026-06-02
updated: 2026-06-02
tags: [sync, server, transport, tls, security, deploy]
goal: "`cargo build --release --manifest-path libs/aven-server/Cargo.toml` and `cargo test --manifest-path libs/aven-p2p/Cargo.toml` exit 0; the `tls_did_challenge` tests prove two engines converge through a local TLS `ServerSyncTransport` AND that forged-DID / stale-nonce / untrusted-cert handshakes are rejected; `docker build -f libs/aven-server/Dockerfile .` succeeds and the image boots + answers a TCP healthcheck; `bun run lint` exits 0; `fly.toml` declares no `[mounts]`; every Acceptance criterion below is checked. The live `fly deploy` is the documented human step (org + secrets required)."
---

# Aven Server Mini — authenticated TLS sync transport + Docker→fly deploy pipeline

## Context

The canonical [`docs/AvenServerPlan.md`](../../../../docs/AvenServerPlan.md) lands the
full always-on aven as **P3**: one stateful binary (RocksDB blind **mirror** + SQLite
**auth** on a fly volume) serving auth + blind backup + rendezvous + indexer. That is
the durable destination, but it bundles three hard axes at once: the transport, the
*persistence/blind-mirror capability*, and the *auth port*.

**Aven Server Mini** carves off the two axes you can ship first and prove on a real
remote box: **(1) a hardened, encrypted peer↔server transport** and **(2) a Docker→fly
deploy pipeline**. It is **headless** (no UI) and **stateless** (in-memory engine, no
fly volume — a redeploy/restart starts blank). It is a live **rendezvous + relay** for
peers that are online together; it is **not** the durable blind mirror.

This card resolves the inbox open questions in its favour:
- **TLS from the first push** (not plain TCP) — the user asked for proper security.
- **Stateless = `MemoryStorage`** (`libs/aven-db/src/storage/memory.rs`), no fly
  `[mounts]`.
- **Code lives in the existing crates** — fill `aven-p2p` (transport) + flesh out the
  `aven-server` bin; no new crate.

### Where the seams already are (verified against the tree)

- **The transport trait** is `groove::SyncTransport`
  ([`libs/aven-db/src/sync_transport.rs:96`](../../../../libs/aven-db/src/sync_transport.rs)):
  `send_to(SyncTargetId, SyncPayload)`, `recv_inbound() -> Option<InboxEntry>`,
  `shutdown()`. Frames are transport-agnostic, length-prefixed `SyncFrameV1` via
  `encode_length_prefixed` / `decode_length_prefixed` (same file) — **reused verbatim**.
- **The model to copy** is the dev TCP transport
  ([`libs/aven-db/src/dev_transport.rs`](../../../../libs/aven-db/src/dev_transport.rs)):
  connect → handshake → spawn a read-pump that decodes frames into
  `InboxEntry { source: Source::Client(remote), payload }`. We keep that decode/queue
  half and replace **two** things: the spoofable plaintext 32-byte identity exchange
  ([`dev_transport.rs:72-77`](../../../../libs/aven-db/src/dev_transport.rs)) → **TLS +
  did:key challenge**, and the 2-peer shape → **N-client fan-out**.
- **The did:key codec already exists** in
  [`app/src-tauri/src/jazz_auth.rs`](../../../../app/src-tauri/src/jazz_auth.rs)
  (`peer_did_from_ed25519`, `ed25519_public_from_peer_did`, Ed25519 multicodec
  `0xed01` + base58btc). To avoid the "codec divergence" risk (plan §6) we **lift it
  into `aven-db`** so app, device, and `aven-p2p` share one implementation.
- **The challenge message format** is pinned by
  [`libs/aven-auth/src/lib/auth/plugins/aven-auth/challenge.ts`](../../../../libs/aven-auth/src/lib/auth/plugins/aven-auth/challenge.ts)
  — we reproduce its exact text so this handshake and the future Rust `aven-auth`
  (plan §3) share one challenge primitive.
- **The app wiring point** is `try_dev_peer_transport`
  ([`app/src-tauri/src/jazz/mod.rs:1321`](../../../../app/src-tauri/src/jazz/mod.rs)),
  called at `jazz/mod.rs:1392`, registering the peer via `register_peer_sync_client`
  with the revoke-skip guard at `jazz/mod.rs:1400-1411`. We add a sibling
  `try_server_transport` and **leave the dev path intact**.
- **Crates are standalone — there is no root cargo workspace** (`.cargo/config.toml`
  pins `target-dir = "target/rust"`); every `cargo` command is per-`--manifest-path`.
  `aven-server`'s `Cargo.toml` already depends on `groove` (feature `client-p2p`) +
  `aven-p2p` + tokio.

### Explicitly out of scope (stays in the full plan)

- The **blind-relay `replicate` capability** (plan §4.0) — no `AccOp::Replicate`, no
  non-owner minter, no `authorize` DSL change. Mini authenticates peers and relays
  live; it is **not** a durable blind mirror.
- **Auth port to Rust** (plan §3 / P2) — mini does not serve the `/api/auth` endpoints.
- **RocksDB persistence + fly volume** (plan §4.4) — mini is in-memory by design.
- **Direct P2P mesh** (board [`0003`](./0003-p2p-mesh-peeroxide.md)).

## Goal

A headless, stateless `aven-server` runs the mini transport: N device peers dial it
over **TLS** (server authenticated by cert; **client authenticated by a did:key
challenge bound to the TLS session**), the engine converges a spark live through it,
and the binary is packaged as a Docker image with a `fly.toml` ready to push to a
remote fly machine — with the actual `fly deploy` left as the documented human step.

**Completion condition** (identical to frontmatter `goal`):

> `cargo build --release --manifest-path libs/aven-server/Cargo.toml` and
> `cargo test --manifest-path libs/aven-p2p/Cargo.toml` exit 0; the `tls_did_challenge`
> tests prove two engines converge through a local TLS `ServerSyncTransport` AND that
> forged-DID / stale-nonce / untrusted-cert handshakes are rejected;
> `docker build -f libs/aven-server/Dockerfile .` succeeds and the image boots +
> answers a TCP healthcheck; `bun run lint` exits 0; `fly.toml` declares no `[mounts]`;
> every Acceptance criterion below is checked. The live `fly deploy` is the documented
> human step (org + secrets required).

The `/goal` evaluator reads the transcript only, so every clause above is proven by a
command we actually run; the one human step (a real `fly deploy`, which needs an org +
secrets and is outward-facing) is deliberately excluded from the condition.

## The security design (the headline)

Two layers, two distinct jobs — never conflated (plan §2.7):

| Layer | Job | Mechanism |
|---|---|---|
| **TLS (rustls)** | encrypt the channel + **authenticate the server** | `tokio-rustls`; server presents a cert; client verifies it against a trust anchor |
| **did:key challenge** | **authenticate the client** (prove it holds the DID privkey) | Ed25519 sign-over-nonce **inside** the TLS stream, bound to the TLS session |

### Handshake (per connection, inside the established TLS stream)

1. **TLS handshake** completes → channel encrypted, **server authenticated** by cert.
2. **Server → client:** a fresh 32-byte random `nonce` (single-use, 5-min TTL) plus the
   canonical challenge message (the `challenge.ts` text: `domain`, `URI`, `Network`
   seed, `DID` placeholder, `Nonce`, `Issued At`, `Expiration Time`).
3. **Channel binding (anti-relay):** the server also derives a binding value via
   rustls `export_keying_material(b"avenos/sync-mini v1", ...)` and folds it into the
   signed message. This ties the signature to *this* TLS session, so a credential
   captured on one connection cannot be replayed onto another (defeats a
   forward/MITM-relay of the challenge).
4. **Client → server:** `{ did, signature }` where `signature = Ed25519(message_bytes)`
   using the device root signing key (`signing_key_from_device_root`).
5. **Server verifies:** decode `did:key` → Ed25519 pubkey; verify the signature over
   the exact message bytes; assert nonce is unconsumed + unexpired; assert the
   channel-binding value matches. **On success the proven DID is the peer's identity** —
   `PeerId` is derived from the pubkey, exactly as the engine expects.
6. **Register** the connection in `HashMap<PeerId, ConnHandle>`; from here it is the
   dev-transport read-pump verbatim, tagging inbound frames `Source::Client(peer)`.

A failed/forged/stale/relayed handshake is **rejected before any frame is read**, with
a small per-IP rate-limit to blunt handshake spam (plan §2.2 #4).

> Authorization (`may_sync`) remains the engine's per-frame job via the existing
> `BiscuitCapabilityResolver`. Mini's transport proves **who** (authenticated DID) and
> secures the channel; it does **not** add the connect-time `Replicate` gate (that's
> P3 §4.0). Mini accepts any peer that passes the challenge; the biscuit gate still
> decides **whether** each frame is honoured.

## Approach

Four parts, strictly ordered; each builds and tests green before the next.

### Part A — shared did:key codec → `aven-db` (kills divergence risk)
Move `peer_did_from_ed25519` / `ed25519_public_from_peer_did` into a new
`groove::did_key` module; have `app/src-tauri/src/jazz_auth.rs` **re-export** them so
the app is unchanged behaviourally and `aven-p2p` (which depends on `aven-db`) gets the
*same* implementation. One codec, three consumers.

### Part B — `ServerSyncTransport` + `ServerListener` in `aven-p2p` (TLS)
Fill the placeholder crate. Add deps: `tokio-rustls`, `rustls`, `rustls-pemfile`,
`rcgen` (dev cert gen), `ed25519-dalek`, `rand`, `sha2`, `async-trait`, `tracing`,
`thiserror`, and `groove` (path). Two `impl`s of the shared seam:

- **`ServerSyncTransport` (client)** — `dial(addr, server_trust, signing_key)`:
  TCP connect → `tokio_rustls::TlsConnector` handshake (verify server cert against the
  trust anchor / pinned SPKI) → receive nonce → build + sign the channel-bound
  challenge → send `{did, sig}` → await `Ok` → run the `dev_transport` read-pump
  unchanged. `send_to` writes a length-prefixed `SyncFrameV1`.
- **`ServerListener` (server)** — `serve(identity, tls_acceptor, bind_addr)`: bind one
  TLS listener; accept loop; per connection run the challenge; register
  `HashMap<PeerId, ConnHandle>` (each `ConnHandle` = an outbound mpsc to a per-conn
  writer task). It exposes a `SyncTransport` whose `send_to(target)` resolves
  `SyncTargetId::Client(peer)` / `PeerDid(did)` → connection (fan a `FrontierAnnounce`
  to all connected members in mini), and whose `recv_inbound()` drains a shared inbound
  mpsc fed by every read-pump.
- **Trust config** — `ServerTrust::{ PinnedSpki(fingerprint), WebpkiRoots }`. Dev uses
  `rcgen` self-signed + SPKI-pin; prod can pin a fly-provided cert's SPKI (no public CA
  dependency) — documented in Part D.

### Part C — headless stateless server boot in `aven-server`
Replace the `println!` skeleton with the real boot (plan §4.1 sketch, minus auth +
persistence):
- `AvenServerConfig::from_env()` — `AVEN_SERVER_BIND` (e.g. `0.0.0.0:4290`),
  `AVEN_SERVER_TLS_CERT` / `AVEN_SERVER_TLS_KEY` (PEM paths or inline), identity seed
  (`AVEN_SERVER_SEED`, else generate-and-log for dev), `AVEN_SERVER_DOMAIN` /
  `AVEN_SERVER_NETWORK_SEED` for the challenge message.
- Build the headless engine on **`MemoryStorage`** (stateless) and wire the
  `ServerListener` transport. If `JazzClient::connect_with_sync_transport` only opens
  RocksDB ([`avenos_client.rs:192`](../../../../libs/aven-db/src/avenos_client.rs)), add
  a thin `connect_headless_with_storage(ctx, Box<dyn Storage>, transport)` constructor
  in `aven-db` that injects `MemoryStorage` — the one engine change Part C needs.
- A tiny TCP `:8080` `/healthz`-style liveness responder (or a bare TCP accept) for the
  fly + Docker healthcheck.
- Fix `Cargo.toml`'s stale description ("…over peeroxide") to "…authenticated TLS".

### Part D — Docker → fly deploy pipeline preparation
- **`libs/aven-server/Dockerfile`** — multi-stage. Builder `rust:1.93-bookworm` (matches
  `rust-toolchain.toml` 1.93.1) with `clang libclang-dev build-essential` (the
  `rust-rocksdb` C++ build needs them even though mini runs MemoryStorage — the
  `client-p2p` feature still compiles the backend). **Build context = repo root** (the
  crates are path-linked: `aven-server` → `../aven-db`, `../aven-p2p`); `COPY libs/
  .cargo/ rust-toolchain.toml`, then
  `cargo build --release --manifest-path libs/aven-server/Cargo.toml`. Runtime stage
  `debian:bookworm-slim` + `libstdc++6 ca-certificates`, copy the single binary,
  `EXPOSE 4290 8080`, non-root user, `ENTRYPOINT ["aven-server"]`.
- **`libs/aven-server/fly.toml`** — `app = "aven-server-mini"`; `primary_region`; a
  `[[services]]` exposing the sync port as a **raw TCP passthrough** (`handlers = []`,
  TLS terminated *in-process* by rustls) on `internal_port = 4290`; a `[checks]` TCP
  healthcheck on `8080`; **no `[mounts]`** (the stateless invariant); `[env]` for
  non-secret config. The cert/key + seed go in **fly secrets**, not the image.
- **`docs/deploy/aven-server-mini.md`** — the runbook: `fly launch --no-deploy`,
  `fly secrets set AVEN_SERVER_TLS_CERT=… AVEN_SERVER_TLS_KEY=… AVEN_SERVER_SEED=…`,
  `fly deploy`, then how a device is pointed at the host (`AVENOS_SERVER_ADDR` + the
  pinned SPKI). This is the **human** step — outward-facing, needs an org + secrets — so
  it is prepared and documented, **not executed** here.
- **`.github/workflows/deploy-aven-server-mini.yml`** — manual-dispatch (+ tag) workflow
  that builds the image and runs `flyctl deploy --remote-only` using `FLY_API_TOKEN`.
  Validated by `bun run lint` / yaml parse; it does not run a real deploy in this card.

### App wiring (small, additive — keeps dev path intact)
Add `try_server_transport(local, signing_key)` beside `try_dev_peer_transport`
([`jazz/mod.rs:1321`](../../../../app/src-tauri/src/jazz/mod.rs)), gated by
`AVENOS_SERVER_SYNC=1` + `AVENOS_SERVER_ADDR` + trust config; on success register the
server peer via the existing `register_peer_sync_client` path (the revoke-skip guard at
`jazz/mod.rs:1400-1411` carries over). The dev 2-peer TCP path is untouched.

## Steps

1. **Part A** — `groove::did_key` module + re-export from `jazz_auth.rs`;
   `cargo build` app + `--manifest-path libs/aven-db/Cargo.toml` green.
2. **Part B.1** — `aven-p2p` deps + `ServerSyncTransport::dial` (client TLS + challenge).
3. **Part B.2** — `ServerListener::serve` (server TLS + challenge + N-client registry +
   fan-out) + `SyncTransport` impl.
4. **Part B.3** — `tls_did_challenge` tests: happy-path convergence over a local TLS
   pair; forged-DID rejected; stale/replayed-nonce rejected; untrusted-cert rejected.
5. **Part C** — `connect_headless_with_storage` (MemoryStorage) in `aven-db`; real
   `aven-server` boot + healthcheck; fix Cargo.toml description.
6. **Part D.1** — `Dockerfile`; `docker build` green; image boots + TCP healthcheck.
7. **Part D.2** — `fly.toml` (no `[mounts]`) + `docs/deploy/aven-server-mini.md` +
   `.github/workflows/deploy-aven-server-mini.yml`.
8. **App wiring** — `try_server_transport`; app `cargo check` green; dev path intact.
9. **Gates** — full Verification block below.

## Files to touch

- `libs/aven-db/src/did_key.rs` *(new)* + `libs/aven-db/src/lib.rs` — shared codec.
- `app/src-tauri/src/jazz_auth.rs` — re-export the codec from `groove::did_key`.
- `libs/aven-db/src/avenos_client.rs` — add `connect_headless_with_storage` (MemoryStorage inject).
- `libs/aven-p2p/Cargo.toml` — add tokio-rustls/rustls/rcgen/ed25519-dalek/groove/… deps.
- `libs/aven-p2p/src/lib.rs` (+ `server_transport.rs`, `challenge.rs`, `tls.rs` new) — the two transports + handshake.
- `libs/aven-server/src/main.rs` — real headless stateless boot + healthcheck.
- `libs/aven-server/Cargo.toml` — fix description; add `rustls`/`rcgen`/`tracing-subscriber` as needed.
- `app/src-tauri/src/jazz/mod.rs` — `try_server_transport` beside `try_dev_peer_transport`.
- `libs/aven-server/Dockerfile` *(new)*, `libs/aven-server/fly.toml` *(new)*.
- `docs/deploy/aven-server-mini.md` *(new)*, `.github/workflows/deploy-aven-server-mini.yml` *(new)*.

## Acceptance criteria

Each must be provable from the transcript (a command + its output).

- [ ] **Shared codec** — `groove::did_key` exists; the app still builds
      (`cargo check --manifest-path app/src-tauri/Cargo.toml` or the app gate) — proven by exit 0.
- [ ] **Transport builds** — `cargo build --release --manifest-path libs/aven-p2p/Cargo.toml` exits 0.
- [ ] **Happy path** — `tls_did_challenge` test: two engines converge a spark through a
      local TLS `ServerSyncTransport` (mirrors the §9 loopback convergence) — `cargo test … -p aven-p2p` exit 0.
- [ ] **Server auth proven** — the same test rejects an **untrusted server cert** (client refuses to dial).
- [ ] **Client auth proven** — the test rejects a **forged DID** (signature over the nonce fails verification).
- [ ] **Replay/binding proven** — the test rejects a **stale/replayed nonce** and a signature lacking the channel-binding value.
- [ ] **Server boots stateless** — `aven-server` (release) starts on `MemoryStorage` with **no** data dir and answers the TCP healthcheck — proven by a boot+probe command.
- [ ] **Image builds & boots** — `docker build -f libs/aven-server/Dockerfile .` exits 0 and `docker run` answers the healthcheck.
- [ ] **No volume** — `fly.toml` contains no `[mounts]` — proven by `! grep -q '\[mounts\]' libs/aven-server/fly.toml`.
- [ ] **Deploy pipeline prepared** — `Dockerfile`, `fly.toml`, runbook, and CI workflow exist; runbook documents the human `fly deploy` step.
- [ ] **App path intact** — `try_server_transport` added; the dev TCP path unchanged; app `cargo check` exit 0.
- [ ] **Repo gates** — `bun run lint` exit 0; the Rust gates (`scripts/verify-aven-db-gates.sh`) stay green.

## Verification

```bash
# Shared codec + engine
cargo build --release --manifest-path libs/aven-db/Cargo.toml --features client-p2p

# Transport + the security tests (happy path + forged-DID + stale-nonce + untrusted-cert)
cargo test --manifest-path libs/aven-p2p/Cargo.toml -- tls_did_challenge

# Headless stateless server binary
cargo build --release --manifest-path libs/aven-server/Cargo.toml
# boot + healthcheck (background the binary, probe :8080, then kill)

# Deploy artifacts
docker build -f libs/aven-server/Dockerfile -t aven-server-mini:ci .
! grep -q '\[mounts\]' libs/aven-server/fly.toml   # stateless invariant

# Repo gates
scripts/verify-aven-db-gates.sh
bun run lint
```

> **Not run here (human step):** `fly launch` / `fly secrets set …` / `fly deploy` —
> outward-facing, needs a fly org + TLS secrets. Documented in
> `docs/deploy/aven-server-mini.md`.

## Hand-off

```
/board-goal plan/0004-aven-server-mini
```

…or hand the condition straight to the built-in goal loop:

```
/goal cargo build --release --manifest-path libs/aven-server/Cargo.toml and cargo test --manifest-path libs/aven-p2p/Cargo.toml exit 0; the tls_did_challenge tests prove two engines converge through a local TLS ServerSyncTransport AND that forged-DID / stale-nonce / untrusted-cert handshakes are rejected; docker build -f libs/aven-server/Dockerfile . succeeds and the image boots + answers a TCP healthcheck; bun run lint exits 0; fly.toml declares no [mounts]; every Acceptance criterion is checked. The live fly deploy is the documented human step.
```

## Progress log

- `2026-06-02` — Planned. Moved inbox → plan. Resolved the inbox open questions
  (TLS-from-first-push · stateless `MemoryStorage` · code in existing crates). Wrote the
  TLS + did:key channel-bound handshake design, the four-part execution order (codec →
  transport → headless boot → Docker/fly pipeline), files to touch, acceptance criteria,
  and a transcript-provable completion condition that excludes the human `fly deploy`.
  Grounded against the real seams: `SyncTransport` (`sync_transport.rs:96`), the dev
  transport model (`dev_transport.rs`), the did:key codec (`jazz_auth.rs`), the app
  wiring (`jazz/mod.rs:1321`), `MemoryStorage`, and the standalone-crate / no-workspace
  build layout.
- `2026-06-02` — Created in inbox (idea capture).
</content>

# aven-server on Sprites — durable storage + hibernate-safe sync

**Status:** Plan / iteration 1
**Branch:** `claude/rocksdb-tigris-backend`
**Scope:** Host `aven-server` (the blind replica) on [Sprites](https://sprites.dev) so it gets
durable, Tigris-backed storage **with zero storage-engine changes**, and make device↔server
sync tolerant of Sprite hibernation. **Out of scope:** server↔server mesh (deferred), and the
RocksDB-Cloud FFI work (obviated — see below).

---

## 1. Why Sprites (and why this kills the FFI plan)

We previously scoped two ways to get RocksDB's data durable on Tigris:

1. **True RocksDB-Cloud (FFI)** — vendor Rockset's C++ fork, write a `librocksdb-cloud-sys`
   shim to reach `CloudFileSystem`/`NewAwsEnv` (not in the C API), link the AWS C++ SDK,
   cross-compile for the deploy image. Weeks of work + permanent maintenance divergence
   from `rust-rocksdb` 0.48.
2. **Snapshot/restore to Tigris** — keep local RocksDB, add an S3 client, checkpoint + upload
   + restore-on-boot. Days, but net-new S3 code in our tree.

**Sprites makes both unnecessary.** A Sprite provides a **standard ext4 filesystem on NVMe**,
and transparently backs it to durable object storage (JuiceFS-like model: data chunks on the
object store, metadata in local SQLite kept durable with Litestream; NVMe is a read-through
cache). Crucially, the **live** filesystem is a real block device — RocksDB's WAL appends,
atomic renames, file locks, and mmap all behave exactly as on local disk. The object-storage
layer sits *underneath* the block device as durability, **not** in the write path's semantics.

This is categorically different from the TigrisFS / S3-FUSE approach we rejected, where the
*live* filesystem was object storage pretending to be POSIX (broken fsync/rename/append). Here
the object store is only the durability tier.

And the object store under Sprites **is Tigris** (both are Fly.io products), so "RocksDB on
Sprites" *is* "RocksDB durably backed by Tigris" — exactly the original goal, with no FFI and
no S3 code in avenOS.

**Net effect on our code:** `aven-server` keeps calling
`RocksDBStorage::open(AVEN_SERVER_DATA_DIR, 64 MiB)` unchanged (`libs/aven-server/src/main.rs`).
We point `AVEN_SERVER_DATA_DIR` at a path on the Sprite's persistent ext4. The storage work
becomes **deployment config + a small device-side wake step**, not an engine change.

---

## 2. The hibernate problem

Sprites are designed to **hibernate when idle** (default inactivity timeout ~30s) and **wake on
demand**. State survives — they resume with the exact same filesystem — but while hibernated a
Sprite is "off": no CPU, no listening sockets. That collides with `aven-server`'s job: it is a
**network sync endpoint** that devices dial over a custom TLS port and that relays encrypted
batches.

Two questions must be answered:

- **Wake:** how does a device cause a hibernated Sprite to come back and accept its sync
  connection?
- **Durability:** if compute is reclaimed (idle or unclean), are acknowledged writes safe?

---

## 3. Networking model on Sprites

From the Sprites docs (confirmed):

- Every Sprite has its own **URL with automatic TLS**, routed to **port 8080** (or the first
  HTTP port opened). A request to that URL **wakes the Sprite when paired with a Service**
  (cold start typically **< 1s**; warm resume a few hundred ms). **This is the documented,
  reliable wake trigger.** Note this URL has **Sprites-terminated TLS**.
- **Arbitrary TCP** is reached via the **Port Proxy**: *"after a brief WebSocket handshake the
  connection becomes a transparent relay to any port."* Because it's a **transparent byte
  relay**, our own TLS terminates **inside** the Sprite — channel binding is preserved (unlike
  the 8080 URL, whose TLS is proxy-terminated).
- **Staying awake / hibernating:** *"Your Sprite stays awake while there's activity. Activity
  includes active exec/console commands, **open TCP connections**, running TTY sessions, and
  active Services with open connections."* → **an open sync connection keeps the Sprite warm.**
- **Services:** *"processes that auto-restart whenever your Sprite wakes up."* `aven-server`
  **must be defined as a Sprites Service** so it is running and ready after a wake.

`aven-server` already binds **two** ports (`libs/aven-server/src/main.rs`):

| Port | Env (default) | Purpose |
|------|---------------|---------|
| `8080` | `AVEN_SERVER_HEALTH_BIND` (`0.0.0.0:8080`) | HTTP `200 ok` health endpoint |
| `4290` | `AVEN_SERVER_BIND` (`0.0.0.0:4290`) | Authenticated TLS sync transport (`ServerListener`) |

This is a lucky fit: **the health endpoint is already on 8080 — the exact port Sprites proxies
and uses as its wake trigger.**

> **Why not just run sync on 8080 behind the Sprites TLS proxy?** Because our sync handshake
> binds the did:key challenge to the *live TLS session* via exported keying material (channel
> binding, `aven-p2p/src/challenge.rs` + `tls.rs`). The 8080 URL has **Sprites-terminated TLS**,
> so the device's TLS session would be with the proxy, not the server process — breaking channel
> binding. We therefore keep **end-to-end TLS** to port 4290 over the **Port Proxy's transparent
> byte tunnel** (which does *not* terminate our TLS), and use the HTTP 8080 path only as the
> wake trigger.

> **Reaching 4290 is not a plain `TcpStream::connect`.** The Port Proxy requires a brief
> WebSocket-upgrade handshake before it relays bytes. So the device transport must run rustls
> over a **proxy-tunneled stream**, not a raw socket — see §4.3 / §6.

---

## 4. The hibernate solution

Two existing properties make this clean; we add one small client-side step.

### 4.1 Property A — the frontier protocol is already reconnect-safe

Sync reconciliation is the stateless `frontier_diff(local_dag, remote_heads)` (`frontier.rs`).
It is derived from storage, never persisted per-peer. Therefore:

- A dropped connection (Sprite hibernating mid-idle) is a **non-event**: on reconnect the
  device re-announces its heads and the diff resumes — **zero batches resent** (invariant T6).
- A hibernation gap behaves exactly like a network partition, which the DAG heals on reconnect
  (invariant T9).

So we do **not** need the server to stay up to preserve correctness. Hibernate/wake cycles are
already tolerated by the protocol. We only need to *trigger* the wake at the right moment.

### 4.2 Property B — the device dial is already a retry loop

`try_server_transport` (`app/src-tauri/src/jazz/mod.rs:1405`) already:

- is gated by `AVENOS_SERVER_SYNC=1`,
- reads `AVENOS_SERVER_ADDR` + `AVENOS_SERVER_CERT_PIN` (pinned cert → `ServerTrust::Pinned`),
- **retries `ServerSyncTransport::dial` for up to 30s with 400ms backoff.**

That 30s tolerant loop already absorbs a sub-second cold-start latency — *once the Sprite is
waking*. The only missing piece is the request that *starts* the wake.

### 4.3 The added step — wake-before-dial (HTTP poke on 8080)

Add an optional **wake URL** to the device transport setup. Before entering the dial loop, the
device issues a short HTTP `GET` to the Sprite's public URL (which maps to the server's 8080
health endpoint). That request is the documented Sprites wake trigger; it assigns compute and
boots the process. The device then proceeds into the existing dial-retry loop, which now
succeeds within the cold-start window.

```text
device wants to sync
   │
   ├─ GET https://<sprite-url>/        ← wakes the Sprite (Sprites URL → Service on :8080 health)
   │     (retry/backoff until 200, ~<1s cold)
   │
   ├─ open Port-Proxy WS tunnel → port 4290   (transparent byte relay into the Sprite)
   │
   └─ rustls + did:key challenge over the tunneled stream   (end-to-end TLS, channel binding intact)
         (existing 30s retry loop; succeeds once warm)
   │
   └─ FrontierAnnounce → frontier_diff → batches flow → converge
         (the open tunnel connection now keeps the Sprite awake for the session)
```

**Code changes:**

1. **Wake poke (localized to `try_server_transport`, `app/src-tauri`):** new env var
   `AVENOS_SERVER_WAKE_URL` (the Sprite's public `https://…` URL). If set, before the dial loop
   `GET` it with a short retry/backoff (~10s, 500ms steps) until 2xx, then continue. If unset,
   behavior is unchanged (local dev / non-Sprite hosting). Needs an HTTP client (`reqwest`/`ureq`)
   in `app/src-tauri` only.
2. **Tunneled dial (transport layer, `aven-p2p`):** `ServerSyncTransport::dial` currently does
   `TcpStream::connect(addr)` then rustls over it. To reach 4290 through the Port Proxy, the
   underlying stream must be the **WS-tunneled** byte stream. Parameterize `dial` over an
   `AsyncRead + AsyncWrite` (instead of a hard `TcpStream`) and add a "connect via Sprites Port
   Proxy" stream constructor (WS upgrade → tunneled duplex → wrap in rustls). The handshake and
   protocol *above* rustls are unchanged; channel binding still uses the device↔server TLS
   session, which is end-to-end through the transparent relay. The existing 30s retry loop is
   kept as the boot-tail safety net.

> If verification (§7.1) shows Sprites also exposes a **direct TCP ingress** for a port (no WS
> tunnel), change #2 collapses to "point `AVENOS_SERVER_ADDR` at that address" with no transport
> change. Build the wake poke (#1) first; gate #2 on that finding.

No change to the wire protocol or the server's listener.

### 4.4 Keeping a session warm (optional, for active use)

**Largely resolved by the docs:** an **open TCP connection counts as activity**, so while the
device holds its sync connection open the Sprite **stays warm on its own** — no heartbeat needed
during a session. A heartbeat is only relevant if we *deliberately* keep the connection open
through long *silent* gaps and want to avoid even a reconnect; given §4.1 (reconnect is
zero-cost) that is not worth doing in iteration 1.

- **Default:** hold the connection open during active use (keeps it warm for free); when the
  device closes it and the Sprite idles out, §4.3 re-wakes on next activity. Correctness-safe by
  §4.1.

Recommendation: ship §4.3 only in iteration 1; no heartbeat.

---

## 5. Durability

### 5.1 The bar is lower than a primary DB — by design

`aven-server` is a **blind replica**: it holds `Replicate` (not `Write`), stores **ciphertext
it cannot decrypt**, and is a durable backup + relay, **not the source of truth**. The
authoritative copy lives on the devices. Combined with §4.1 (stateless frontier, self-healing),
the worst case of losing the last few seconds of *server-side* writes on an unclean compute loss
is **self-correcting**: the device re-announces and re-ships the missing batches on next sync.

So we do not need a zero-loss durability guarantee from the host — "good enough, self-healing"
is the bar, and Sprites clears it.

**The boundary of self-healing (important).** Frontier resync copies missing batches *from a
peer that still holds them*. It therefore heals any loss **as long as the batch lives on ≥2
nodes.** The single non-recoverable case is **replication-factor-1 data**: a freshly authored
batch that has reached *exactly one* node, whose sole holder is then **permanently** lost before
a second peer copied it. This is exactly the failure the server exists to prevent — it is
**copy #2** for device-authored data (`DurabilityTier::EdgeServer` = "confirmed at ≥2 nodes").
Two consequences for this plan:
- *Temporary* loss of the server (hibernate/reboot/crash) is benign — devices remain the source
  of truth and the server re-pulls on wake (and on Sprites the FS is restored anyway, so usually
  nothing to re-pull).
- The thing worth protecting is the **window before a new batch reaches the server**. That is a
  property of the device→server sync path being live, **not** of the server's own disk
  durability — and §4 keeps that path healable across hibernation.
- A fully wiped node re-pulling the entire DAG is a **bandwidth/latency** cost, not data loss;
  Sprites' persistent FS makes it rare.

### 5.2 What Sprites gives us

- **Continuous** object-storage backing of the ext4 (chunks + Litestream'd metadata).
- **Clean-hibernate capture:** idle transition flushes state; resume restores the exact FS.
- **Checkpoints API:** a ~300ms point-in-time full-disk snapshot, restorable later
  (create/list/get/restore via the Sprites REST API/SDK).

### 5.3 What we add

1. **Graceful shutdown flush.** Handle `SIGTERM` (Sprites' hibernation/stop signal) in
   `aven-server`: flush the RocksDB WAL and the engine, then exit. This guarantees the
   pre-hibernate FS image is fully consistent. (`Storage`/engine already expose `flush` /
   `flush_wal`; wire a `tokio::signal` handler in `main.rs` to call it before returning.)
2. **Optional periodic checkpoint.** A scheduled job (external cron calling the Sprites
   checkpoint API, or a small in-process timer with an API token) takes a checkpoint every
   N minutes as an explicit durability + rollback point. Deferred unless §5.1's self-healing
   is deemed insufficient for a given deployment.

---

## 6. Concrete change list (iteration 1)

### Code
- **`app/src-tauri/src/jazz/mod.rs` (`try_server_transport`)** — add `AVENOS_SERVER_WAKE_URL`
  handling: HTTP-poke-then-dial (§4.3 #1). Add an HTTP client dep to `app/src-tauri`.
- **`libs/aven-p2p/src/transport.rs` (`ServerSyncTransport::dial`)** — parameterize over a
  generic `AsyncRead + AsyncWrite` stream and add a Sprites **Port-Proxy WS-tunnel** connector
  (§4.3 #2). *Gated on §7.1*: skipped entirely if a direct TCP ingress exists.
- **`libs/aven-server/src/main.rs`** — add a `SIGTERM`/`SIGINT` handler that flushes RocksDB
  (WAL + engine) before exit (§5.3.1). No storage-engine change; no new feature flag.

### Deployment / ops (new files, no engine impact)
- **`aven-server` as a Sprites Service** — define it as a Service so it **auto-restarts on wake**
  (required for wake-on-request to work). Health/HTTP on `8080` (the routed/wake port), sync TLS
  listener on `4290`, data dir on the persistent FS.
- **Sprite image** for `aven-server`: build the binary; the Service runs it on boot/wake.
- **Env mapping** (Sprite secrets/config):
  | Env | Value |
  |-----|-------|
  | `AVEN_SERVER_DATA_DIR` | a path on the Sprite's persistent ext4 (e.g. `/data/aven`) |
  | `AVEN_SERVER_SEED` | 32-byte hex identity seed → **stable DID** across wakes (secret) |
  | `AVEN_SERVER_BIND` | `0.0.0.0:4290` (sync TLS) |
  | `AVEN_SERVER_HEALTH_BIND` | `0.0.0.0:8080` (wake/health — must be 8080) |
  | `AVEN_SERVER_TLS_CERT` / `_KEY` | real cert/key, or self-signed (device pins DER) |
  | `AVEN_SERVER_DOMAIN` / `_URI` / `_NETWORK_SEED` | challenge params |
- **Device config:** `AVENOS_SERVER_SYNC=1`, `AVENOS_SERVER_ADDR=<sprite-tcp-endpoint>:4290`,
  `AVENOS_SERVER_CERT_PIN=<hex DER>`, `AVENOS_SERVER_WAKE_URL=https://<sprite-url>/`.
- **Network policy:** iteration 1 server is inbound-only (no mesh) — outbound policy can be
  locked down to just what the runtime needs (none for sync). Revisit when mesh lands.

### Docs
- This file; plus a note in `docs/self/developers/05-storage-and-state.md` /
  `docs/AvenServerPlan.md` that the hosted blind replica's durability tier is provided by the
  Sprite's Tigris-backed ext4 (no RocksDB-Cloud, no app-level S3).

---

## 7. Open questions to verify before/while building

1. **Raw-TCP exposure mechanism.** Docs confirm arbitrary TCP is reached via the **Port Proxy**
   (a WebSocket-tunnel transparent relay). **Open:** is there *also* a direct TCP ingress
   (stable host:port) that avoids the WS tunnel? If yes, §4.3 #2 (transport change) is dropped.
   Also confirm the proxy/tunnel itself wakes a cold Sprite — the §4.3 #1 HTTP poke is
   deliberately independent of this (uses the guaranteed 8080/Service path).
2. **~~Idle timeout vs. open connections.~~ RESOLVED** — docs: *open TCP connections count as
   activity*, so an open sync connection keeps the Sprite warm. No heartbeat needed (§4.4).
3. **Unclean-loss durability window.** Read the Fly "Design & Implementation of Sprites" post to
   quantify how recent an `fsync` is guaranteed durable on unclean compute reclaim — to decide
   whether §5.3.2 periodic checkpoints are worth enabling. (Bounded in impact by §5.1's
   self-healing for any batch already replicated to a device.)
4. **Cold-start budget.** Measure real cold-start for our image (Service auto-restart + RocksDB
   open); ensure it fits inside the device's wake-poll + 30s dial window (should, given < 1s
   documented).

---

## 8. Testing

- **Unit/loopback (unchanged):** existing `tests/frontier_reconcile.rs` and
  `tests/loopback_transport.rs` already prove convergence + reconnect-zero-resent; these are the
  correctness backstop for hibernate/wake cycles.
- **Wake step:** unit-test `try_server_transport`'s new path with a stub HTTP server (200 after
  N tries) asserting it poke-waits then dials.
- **Graceful flush:** test that `aven-server` flushes on `SIGTERM` (write a batch, send SIGTERM,
  reopen the data dir, assert the batch is present).
- **Manual end-to-end on Sprites:** deploy, let it hibernate (>30s idle), then sync from a
  device cold; assert convergence and acceptable latency.

---

## 9. Milestones

1. **M1 — host as-is:** `aven-server` as a Sprites **Service** + image + env; device wake poke
   (`AVENOS_SERVER_WAKE_URL`) + dial (`ADDR`/`PIN`). Manual cold-wake sync works. (Storage
   durability via Sprite ext4; minimal code beyond the wake poke.)
2. **M1.5 — verify §7.1 (TCP ingress):** if only the Port Proxy is available, land the tunneled
   `dial` (§4.3 #2); if a direct TCP ingress exists, skip it.
3. **M2 — graceful flush:** `SIGTERM` WAL/engine flush in `aven-server`.
4. **M3 — verify remaining caveats (§7):** durability window + cold-start budget; enable periodic
   checkpoints only if needed.
5. **~~M4 — keep-warm heartbeat~~ — dropped** (open connection keeps the Sprite warm; §4.4).
6. **Later (separate plan) — server↔server mesh** (static roster dial + mutual `Replicate`),
   independent of this hosting change.

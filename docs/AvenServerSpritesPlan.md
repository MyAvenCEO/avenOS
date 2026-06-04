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

From the Sprites docs:

- Every Sprite has its own **URL with automatic TLS**, proxied to whatever listens on
  **port 8080**. A request to that URL **assigns new compute if the Sprite is inactive**
  (cold start typically **< 1s**; warm resume a few hundred ms). **This is the documented,
  reliable wake trigger.**
- **Raw TCP** can be **tunneled directly** to a service inside the Sprite (for non-HTTP
  protocols). TLS connections route by SNI.

`aven-server` already binds **two** ports (`libs/aven-server/src/main.rs`):

| Port | Env (default) | Purpose |
|------|---------------|---------|
| `8080` | `AVEN_SERVER_HEALTH_BIND` (`0.0.0.0:8080`) | HTTP `200 ok` health endpoint |
| `4290` | `AVEN_SERVER_BIND` (`0.0.0.0:4290`) | Authenticated TLS sync transport (`ServerListener`) |

This is a lucky fit: **the health endpoint is already on 8080 — the exact port Sprites proxies
and uses as its wake trigger.**

> **Why not just run sync on 8080 behind the Sprites TLS proxy?** Because our sync handshake
> binds the did:key challenge to the *live TLS session* via exported keying material (channel
> binding, `aven-p2p/src/challenge.rs` + `tls.rs`). If the Sprites proxy terminated TLS, the
> device's TLS session would be with the proxy, not the server process, breaking channel
> binding. We therefore keep **end-to-end TLS** to port 4290 over a raw-TCP tunnel, and use the
> HTTP 8080 path only as the wake trigger.

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
   ├─ GET https://<sprite-url>/        ← wakes the Sprite (Sprites proxy → :8080 health)
   │     (retry/backoff until 200, ~<1s cold)
   │
   └─ ServerSyncTransport::dial(AVENOS_SERVER_ADDR :4290, pinned-cert, did-key)
         (existing 30s retry loop; succeeds once warm)
   │
   └─ FrontierAnnounce → frontier_diff → batches flow → converge
```

**Code change (small, localized to `try_server_transport`):**

- New env var `AVENOS_SERVER_WAKE_URL` (the Sprite's public `https://…` URL).
- If set, before the dial loop: `GET` it with a short retry/backoff (e.g. up to ~10s, 500ms
  steps) until a 2xx, then continue. If unset, behavior is unchanged (local dev / non-Sprite
  hosting). This needs an HTTP client; `reqwest` (or a minimal `ureq`) added to
  `app/src-tauri` only.
- The existing 30s dial loop is kept as the safety net for the boot tail.

No change to the wire protocol, the transport crate, or the server.

### 4.4 Keeping a session warm (optional, for active use)

During an active session a device may want low-latency pushes rather than re-waking each time.
Two cheap options, both client-side and optional for iteration 1:

- **Heartbeat:** while a sync UI is foregrounded, the device sends a periodic lightweight
  `FrontierAnnounce` (or hits the wake URL) inside the ~30s idle window to keep the Sprite warm.
- **Re-wake on demand:** accept hibernation between bursts and rely on §4.3 to re-wake on the
  next activity. This is the default and is correctness-safe by §4.1.

Recommendation: ship §4.3 only in iteration 1; add the heartbeat behind a flag if push latency
proves annoying in practice.

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
  handling: HTTP-poke-then-dial (§4.3). Add an HTTP client dep to `app/src-tauri`.
- **`libs/aven-server/src/main.rs`** — add a `SIGTERM`/`SIGINT` handler that flushes RocksDB
  (WAL + engine) before exit (§5.1). No storage-engine change; no new feature flag.

### Deployment / ops (new files, no engine impact)
- **Sprite image** for `aven-server`: build the binary, expose health on `8080` and the sync
  TLS listener on `4290`, set the data dir on the persistent FS.
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

1. **Raw-TCP exposure & wake.** Confirm the exact mechanism Sprites uses to expose a raw TCP
   port (4290) to external clients (stable host:port vs. SDK tunnel), and whether a TCP-tunnel
   connection *also* wakes a cold Sprite. The §4.3 HTTP-wake design is deliberately independent
   of this (it uses the guaranteed 8080 path), but if TCP-tunnel wake is confirmed reliable we
   can drop the HTTP poke and simplify to a plain dial.
2. **Idle timeout vs. open connections.** Confirm whether an open-but-silent TLS connection
   counts as activity (keeps the Sprite warm) or whether the ~30s idle timer hibernates it
   despite the socket. Drives whether §4.4's heartbeat is needed.
3. **Unclean-loss durability window.** Read the Fly "Design & Implementation of Sprites" post to
   quantify how recent an `fsync` is guaranteed durable on unclean compute reclaim — to decide
   whether §5.3.2 periodic checkpoints are worth enabling.
4. **Cold-start budget.** Measure real cold-start for our image; ensure it fits inside the
   device's wake-poll + 30s dial window (it should, given < 1s documented).

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

1. **M1 — host as-is:** Sprite image + env + device `AVENOS_SERVER_WAKE_URL`/`ADDR`/`PIN`;
   manual cold-wake sync works. (Storage durability via Sprite ext4; no code change beyond the
   wake poke.)
2. **M2 — graceful flush:** `SIGTERM` WAL/engine flush in `aven-server`.
3. **M3 — verify caveats (§7):** TCP exposure/wake, idle timeout, durability window; enable
   periodic checkpoints only if needed.
4. **M4 (deferred) — keep-warm heartbeat** if push latency warrants.
5. **Later (separate plan) — server↔server mesh** (static roster dial + mutual `Replicate`),
   independent of this hosting change.

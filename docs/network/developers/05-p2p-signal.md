---
title: Central P2P signal (discovery)
---

Centralized **discovery / pairing** for AvenOS. User-facing transport modes: [Connection status](../founders/04-connection-status.md).

**`AVEN_RELAY` defaults on** (alias **`AVENOS_RELAY`**). Set **`AVEN_RELAY=false`** for public Holepunch HyperDHT.

When central mode is on, **`AVEN_RELAY_URL` is required** (no implicit default — set it in `.env`, launch env, or CI). It selects **embedded local** Rust HyperDHT vs **remote** bootstrap only.

| `AVEN_RELAY` | `AVEN_RELAY_URL` (required if central) | Discovery | Dev scripts spawn signal? | Data plane |
|--------------|----------------------------------------|-----------|---------------------------|------------|
| **default / true** | `127.0.0.1`, `localhost`, or `::1` | Embedded **Rust HyperDHT + co-hosted blind-relay** (UDP **49737**) | Yes (`scripts/p2p-signal.ts`) | **Blind-relay only** (`prefer_relay_only`, `relay_through`) |
| **default / true** | e.g. `relay.aven.ceo` | Remote bootstrap + blind-relay from manifest (both **49737**) | No subprocess | Same — manifest serves `relayPublicKeyHex` + `relayUdpPort: 49737` |
| **`false`** | (ignored) | Public Holepunch HyperDHT roots | No | Direct P2P + public relays (non-vault builds) |

Connectivity matches [peeroxide’s documented stack](https://rightbracket.github.io/peeroxide/concepts/dht-and-routing.html) (vendored as `libs/aven-p2p`): the DHT coordinates discovery and **in-band handshake relay** (`PEER_HANDSHAKE`). Production vault builds use a **relay-only profile**: peer data never uses LAN direct, reflexive direct, or UDP holepunch — only blind-relay after Noise IK. Fly runs **one Rust process** on UDP **49737** (HyperDHT bootstrap + `PEER_HANDSHAKE` + Hyperswarm blind-relay control/data).

### Connect path (relay-only profile)

After Noise IK completes via bootstrap relay, aven-p2p uses **blind-relay only** (see `libs/aven-p2p/src/dht/hyperdht.rs`, `relay_link.rs`):

1. **DHT rendezvous** — per-pair topic announce/lookup (or single bootstrap candidate when `prefer_relay_only`).
2. **Noise IK** — `PEER_HANDSHAKE` relayed through bootstrap; both sides exchange `relay_through` with a **deterministic pair token** derived from `(pair_topic, relay_pk)` (stable across heal retries).
3. **Blind-relay pair** — dominant outbound half `pair(false, token)`; subordinate inbound half `pair(true, token)` on the co-hosted relay (UDP **49737**). Coordinator sends `unpair` on timeout or control-session drop.
4. **SecretStream + Groove mux** — end-to-end encrypted data plane; relay sees opaque UDX bytes only.

**Dial authority:** higher ed25519 static key outbound-dials; subordinate waits for inbound pair. During invite, swarm stores **`active_pair_topic`** so both halves use the same blind-relay token. **One in-flight connect** per remote pk (`connect_epoch` cancels stale attempts); pairing retries bypass `waiting` deadlock.

Transport heal is consolidated to **`PeerCtl::transport_tick(TickMode)`** — see [Auto-heal & coordinator](06-auto-heal-and-coordinator.md).

Outbound **Jazz / Groove** mesh rows use a dedicated **peer catch-up worker** (see `aven-os-app`'s `peer_catchup` module): per Hyperswarm `ClientId` we track Idle / Pending / Flushing / Ready, coalesce **`rebroadcast_peer_catchup` + single `flush_peer_sync`** batches, bump state on link up/down rather than spawning unbounded reconcile flushes, and treat **Ready only after flush Ok** while the Jazz `conn_epoch` still matches — so reconnects replay catch-up reliably without starving table subscribe IPC.

### Mesh snapshot triggers (app shell)

| Trigger | Groove actor path | Effect |
|--------|-------------------|--------|
| Hyperswarm ready, invite paired persisted, explicit retry | `mesh_refresh` (full) | Allowlist sync + Groove register + publish |
| Connect UI substate change, `peer:mesh-push`, pairing nudge | `publish_mesh` | Mesh snapshot only (JSON-deduped) |
| Periodic reconcile tick | `mesh_reconcile(true)` | Nudge + register + probe + publish |
| Path change / foreground (after plugin heal) | `mesh_reconcile(false)` | Register + publish only |

Details: [Auto-heal & coordinator](06-auto-heal-and-coordinator.md).

---

## Hosted relay on Fly (`relay-aven-ceo`)

Production bootstrap lives on Fly (**Frankfurt**) as app **`relay-aven-ceo`**. Deploy from repo root:

```bash
bun run deploy:relay-fly
```

Uses [`libs/aven-relay/fly.toml`](../../../../libs/aven-relay/fly.toml) + [`Dockerfile`](../../../../libs/aven-relay/Dockerfile). Org: set **`FLY_ORG`**, or the script infers a Maia/Aven-ish org by **slug or display name**.

Allocate **IPv4** (included in deploy flow), then DNS at **`aven.ceo`**:

| Type | Name | Value | Purpose |
|------|------|-------|---------|
| **A** | `relay` | Fly dedicated IPv4 | HyperDHT + blind-relay UDP **49737** |

Do **not** CNAME **`relay`** → **`*.fly.dev`** for UDP unless you have confirmed Fly UDP behavior — **A → dedicated IPv4** is the documented safe path here.

Optional **HTTPS** (manifest `/.well-known/aven-relay.json` / health wake — **UDP** is the control/data plane):

```bash
fly certs add relay.aven.ceo -a relay-aven-ceo
```

After DNS propagates:

```bash
dig +short relay.aven.ceo A
curl -s https://relay.aven.ceo/.well-known/aven-relay.json
```

Manifest includes `bootstrap`, `relayPublicKeyHex`, and **`relayUdpPort: 49737`** (same as `dhtUdpPort`).

**Fly UDP ingress:** the DHT process must bind **`fly-global-services`** (resolved to its IPv4 at runtime), **not** `0.0.0.0`. Binding to `0.0.0.0` breaks public UDP replies (HTTP health still works). See [Fly UDP docs](https://fly.io/docs/networking/udp-and-tcp/).

---

## Local embedded dev (`AVEN_RELAY_URL` local host)

**.env**:

```bash
AVEN_RELAY=true
AVEN_RELAY_URL=127.0.0.1
```

```bash
bun run dev:app2x:mac
# or dev:app:mac / dev:app2x:linux
```

Logs:

```text
[p2p-signal] central discovery (local) — bootstrap=127.0.0.1@127.0.0.1:49737 blindRelay=127.0.0.1:49737 relayPk=…
```

---

## Remote bootstrap dev (`AVEN_RELAY_URL` = Fly hostname)

No local subprocess; Tauri merges bootstrap + blind-relay from **`relay.aven.ceo`** manifest (`/.well-known/aven-relay.json` via `relay-bootstrap.ts`) or explicit **`AVENOS_DHT_BOOTSTRAP`** / **`AVENOS_HYPERSWARM_RELAY_*`**. Port overridable with **`AVENOS_P2P_SIGNAL_PORT`** when deriving from **`AVEN_RELAY_URL`**.

Packaged builds compile-time embed: **`AVEN_RELAY_URL`**, **`AVENOS_DHT_BOOTSTRAP`**, **`AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX`**, **`AVENOS_HYPERSWARM_RELAY_ADDR`** — sourced from repo **`.env`** (`AVENOS_RELAY_PUBLIC_KEY_HEX`) via [`scripts/relay-env.ts`](../../../../scripts/relay-env.ts), not live manifest fetch. See [`libs/tauri-plugin-p2p/src/lib.rs`](../../../../libs/tauri-plugin-p2p/src/lib.rs).

---

## Relay identity env (single source of truth)

Set in repo-root **`.env`** (relay seed + pubkey for deploy). **`deploy:relay-fly`** pushes secrets to Fly.

| Env var | Role |
|---------|------|
| **`AVENOS_RELAY_SEED_HEX`** | 32-byte Ed25519 seed (64 hex). Server + Fly secret. **Never commit.** |
| **`AVENOS_RELAY_PUBLIC_KEY_HEX`** | Blind-relay public key (64 hex). App Store compile embed + startup sanity check. |

Priority on the relay server ([`relay_host.rs`](../../../../libs/aven-relay/src/relay_host.rs)): **env seed → volume file → auto-generate (local dev only)**. Fly requires env or mounted seed.

Bootstrap HyperDHT node identity (`bootstrap-hyperdht.seed`) remains file/volume-backed (clients do not embed it).

---

## Public Hyperswarm (opt out)

```bash
AVEN_RELAY=false bun run dev:app:mac
```

Or **`.env`**: `AVEN_RELAY=false`.

Legacy: **`AVENOS_SKIP_P2P_SIGNAL=1`** also disables central mode.

---

## What runs locally when `AVEN_RELAY=true` and URL is localhost

1. **Rust** — [`libs/aven-relay`](../../../../libs/aven-relay): UDP **49737** HyperDHT bootstrap **and** co-hosted Hyperswarm blind-relay. Stdout JSON includes `bootstrap`, `relayPublicKeyHex`, `relayUdpPort`.

Orchestration: [`scripts/p2p-signal.ts`](../../../../scripts/p2p-signal.ts). Entrypoints [`scripts/dev-app-macos.ts`](../../../../scripts/dev-app-macos.ts), [`scripts/dev-app-linux.ts`](../../../../scripts/dev-app-linux.ts), [`scripts/dev-two-instances.ts`](../../../../scripts/dev-two-instances.ts) call **`startP2pSignal`** and merge **`envAugment`**.

Relay blind-relay identity: **`AVENOS_RELAY_SEED_HEX`** + **`AVENOS_RELAY_PUBLIC_KEY_HEX`** in repo **`.env`** (see above). One-time migration from legacy `relay-hyperdht.seed`: **`bun run migrate:relay-env`**.

**Central env (Tauri)**:

- `AVEN_RELAY=1`
- `AVEN_RELAY_URL=<as given>`
- `AVENOS_DHT_ISOLATED=1`
- `AVENOS_DHT_BOOTSTRAP=…`
- `AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX=…` (64-char hex)
- `AVENOS_HYPERSWARM_RELAY_ADDR=<host>:49737`

---

## Smoke test

```bash
AVEN_RELAY=true AVEN_RELAY_URL=127.0.0.1 bun -e '
import { startP2pSignal } from "./scripts/p2p-signal.ts"
const h = await startP2pSignal()
console.log(JSON.stringify(h.envAugment, null, 2))
await h.dispose()
'
```

**Foreground**:

```bash
AVEN_RELAY=true AVEN_RELAY_URL=127.0.0.1 bun run dev:p2p-signal
```

**Blind-relay reachability** (remote or local):

```bash
RELAY_PK=<64-hex-from-manifest> RELAY_ADDR=<host>:49737 \
  cargo run -q --manifest-path scripts/remote-relay-dht-smoke/Cargo.toml --bin test-remote-relay-blind
```

---

## Ports

- **49737** — Rust HyperDHT bootstrap + co-hosted blind-relay (**`AVENOS_P2P_SIGNAL_PORT`**; `relayUdpPort` in manifest matches)

Stale listeners on macOS/Linux: **`lsof`** + SIGTERM/KILL round in **`scripts/p2p-signal.ts`**.

Legacy **49738** Node blind-relay was removed; use this Rust stack only (`libs/aven-relay`, UDP **49737**).

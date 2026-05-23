---
title: Central P2P signal (discovery)
---

Centralized **discovery / pairing** for AvenOS desktop. **`AVEN_RELAY` defaults on** (alias **`AVENOS_RELAY`**). Set **`AVEN_RELAY=false`** for public Holepunch HyperDHT.

When central mode is on, **`AVEN_RELAY_URL` is required** (no implicit default — set it in `.env`, launch env, or CI). It selects **embedded local** Rust HyperDHT vs **remote** bootstrap only.

| `AVEN_RELAY` | `AVEN_RELAY_URL` (required if central) | Discovery | Dev scripts spawn signal? | Data plane |
|--------------|----------------------------------------|-----------|---------------------------|------------|
| **default / true** | `127.0.0.1`, `localhost`, or `::1` | Embedded **Rust HyperDHT** + **Node blind-relay** | Yes (`scripts/p2p-signal.ts`) | LAN → holepunch → **blind-relay fallback** (`relay_through`) |
| **default / true** | e.g. `relay.aven.ceo` | Remote bootstrap (**49737**) + blind-relay (**49738**) from manifest | No subprocess | Same — manifest serves `relayPublicKeyHex` + UDP **49738** |
| **`false`** | (ignored) | Public Holepunch HyperDHT roots | No | Direct P2P + public relays |

Connectivity matches [peeroxide’s documented stack](https://rightbracket.github.io/peeroxide/concepts/dht-and-routing.html): the DHT coordinates discovery, **in-band handshake relay**, holepunching, and blind-relay fallback. Fly runs **two UDP services**: **49737** (HyperDHT bootstrap + `PEER_HANDSHAKE` / `PEER_HOLEPUNCH`) and **49738** (Hyperswarm blind-relay, last resort only).

### Connect path (Hyperswarm / HyperDHT order)

After Noise IK completes, peeroxide tries endpoints in this order (see `third_party/peeroxide-dht/src/hyperdht.rs`):

1. **LAN direct** — both sides advertise local IPv4s in handshake `addresses4` (Personal Hotspot `172.20.10.x`, RFC1918, etc.). If `match_address` finds a shared subnet, UDX opens on the tether/Wi‑Fi LAN address (skips carrier same-IP holepunch).
2. **Reflexive direct** — public address from the relayed handshake when firewall is open or not holepunchable.
3. **UDP holepunch** — `PEER_HOLEPUNCH` rounds via the same bootstrap that relayed the handshake (fixes from build ~17–20: no eager UDX to Fly, recv-drain, `FIREWALL_UNKNOWN` probe fallback).
4. **Blind relay (last resort)** — when both sides advertise `relay_through` in Noise (from `AVENOS_HYPERSWARM_RELAY_*` env / compile embed) and steps 1–3 fail. Peeroxide opens an encrypted stream via the hosted blind-relay UDP service (**49738**). Diagnostics: **`holepunchBlindRelayFallbackTotal > 0`** on cross-network pairs where holepunch could not complete.

This preserves the **b76bec0** relayed-handshake fixes; we are not reintroducing legacy “always blind-relay” or “UDX straight to bootstrap” behaviour.

Outbound **Jazz / Groove** mesh rows use a dedicated **peer catch-up worker** (see `aven-os-app`'s `peer_catchup` module): per Hyperswarm `ClientId` we track Idle / Pending / Flushing / Ready, coalesce **`rebroadcast_peer_catchup` + single `flush_peer_sync`** batches, bump state on link up/down rather than spawning unbounded reconcile flushes, and treat **Ready only after flush Ok** while the Jazz `conn_epoch` still matches — so reconnects replay catch-up reliably without starving table subscribe IPC.

---

## Hosted relay on Fly (`relay-aven-ceo`)

Production bootstrap lives on Fly (**Frankfurt**) as app **`relay-aven-ceo`**. Deploy from repo root:

```bash
bun run deploy:relay-fly
```

Uses [`projects/aven-p2p-signal/fly.toml`](../../../../projects/aven-p2p-signal/fly.toml) + [`Dockerfile`](../../../../projects/aven-p2p-signal/Dockerfile). Org: set **`FLY_ORG`**, or the script infers a Maia/Aven-ish org by **slug or display name**.

Allocate **IPv4** (included in deploy flow), then DNS at **`aven.ceo`**:

| Type | Name | Value | Purpose |
|------|------|-------|---------|
| **A** | `relay` | Fly dedicated IPv4 | HyperDHT UDP **49737** + blind-relay UDP **49738** |

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

Fly may **scale to zero**; first pairing after sleep can incur wake latency.

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
[p2p-signal] central discovery (local) — bootstrap=127.0.0.1@127.0.0.1:49737 blindRelay=127.0.0.1:49738 relayPk=…
```

---

## Remote bootstrap dev (`AVEN_RELAY_URL` = Fly hostname)

No local subprocess; Tauri merges bootstrap + blind-relay from **`relay.aven.ceo`** manifest (`/.well-known/aven-relay.json` via `relay-bootstrap.ts`) or explicit **`AVENOS_DHT_BOOTSTRAP`** / **`AVENOS_HYPERSWARM_RELAY_*`**. Port overridable with **`AVENOS_P2P_SIGNAL_PORT`** / **`AVENOS_P2P_SIGNAL_RELAY_PORT`** when deriving from **`AVEN_RELAY_URL`**.

Packaged builds compile-time embed: **`AVEN_RELAY_URL`**, **`AVENOS_DHT_BOOTSTRAP`**, **`AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX`**, **`AVENOS_HYPERSWARM_RELAY_ADDR`** — see [`projects/tauri-plugin-peer/src/lib.rs`](../../../../projects/tauri-plugin-peer/src/lib.rs).

---

## Public Hyperswarm (opt out)

```bash
AVEN_RELAY=false bun run dev:app:mac
```

Or **`.env`**: `AVEN_RELAY=false`.

Legacy: **`AVENOS_SKIP_P2P_SIGNAL=1`** also disables central mode.

---

## What runs locally when `AVEN_RELAY=true` and URL is localhost

1. **Rust** — [`projects/aven-p2p-signal`](../../../../projects/aven-p2p-signal): UDP **49737**, prints `bootstrap`.
2. **Node** — [`infra/p2p-signal-relay`](../../../../infra/p2p-signal-relay): UDP **49738** blind-relay (Hyperswarm wire-compatible), prints `{ ready, publicKey, host, port }`.

Orchestration: [`scripts/p2p-signal.ts`](../../../../scripts/p2p-signal.ts). Entrypoints [`scripts/dev-app-macos.ts`](../../../../scripts/dev-app-macos.ts), [`scripts/dev-app-linux.ts`](../../../../scripts/dev-app-linux.ts), [`scripts/dev-two-instances.ts`](../../../../scripts/dev-two-instances.ts) call **`startP2pSignal`** and merge **`envAugment`**.

**Central env (Tauri)**:

- `AVEN_RELAY=1`
- `AVEN_RELAY_URL=<as given>`
- `AVENOS_DHT_ISOLATED=1`
- `AVENOS_DHT_BOOTSTRAP=…`
- `AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX=…` (64-char hex)
- `AVENOS_HYPERSWARM_RELAY_ADDR=<host>:49738`

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

---

## Ports

- **49737** — Rust HyperDHT (**`AVENOS_P2P_SIGNAL_PORT`**)
- **49738** — Node blind-relay fallback (**`AVENOS_P2P_SIGNAL_RELAY_PORT`**)

Stale listeners on macOS/Linux: **`lsof`** + SIGTERM/KILL round in **`scripts/p2p-signal.ts`**.

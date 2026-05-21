---
title: Central P2P signal (discovery)
---

Centralized **discovery / pairing** for AvenOS desktop. **`AVEN_RELAY` defaults on** (alias **`AVENOS_RELAY`**). Set **`AVEN_RELAY=false`** for public Holepunch HyperDHT.

When central mode is on, **`AVEN_RELAY_URL` is required** (no implicit default — set it in `.env`, launch env, or CI). It selects **embedded local** signal stacks vs **remote** HyperDHT bootstrap only.

| `AVEN_RELAY` | `AVEN_RELAY_URL` (required if central) | Discovery | Dev scripts spawn signal? | Data plane |
|--------------|----------------------------------------|-----------|---------------------------|------------|
| **default / true** | `127.0.0.1`, `localhost`, or `::1` | Embedded **Rust HyperDHT** + blind-relay **node** (isolated) | Yes (`scripts/p2p-signal.ts`) | **Direct P2P only** |
| **default / true** | e.g. `relay.aven.ceo` | Remote bootstrap `127.0.0.1@{host}:{port}` (**49737** by default) | No subprocess | **Direct P2P only** |
| **`false`** | (ignored) | Public Holepunch HyperDHT roots | No (`AVEN_RELAY=false` skips central path) | **Direct P2P only** |

**Data plane**: AvenOS keeps **`AVENOS_P2P_DIRECT_ONLY` / `AVENOS_P2P_IGNORE_RELAY_ENV`** so peeroxide **never** wires **`relay_through`** from **`AVENOS_HYPERSWARM_RELAY_*`**. Blind-relay stays on the **signal stack**, not Jazz sync transports.

Outbound **Jazz / Groove** mesh rows use a dedicated **peer catch-up worker** (see `aven-os-app`'s `peer_catchup` module): per Hyperswarm `ClientId` we track Idle / Pending / Flushing / Ready, coalesce **`rebroadcast_peer_catchup` + single `flush_peer_sync`** batches, bump state on link up/down rather than spawning unbounded reconcile flushes, and treat **Ready only after flush Ok** while the Jazz `conn_epoch` still matches — so reconnects replay catch-up reliably without starving table subscribe IPC.
---

## Hosted relay on Fly (`relay-aven-ceo`)

Production-style bootstrap lives on Fly (**Frankfurt**) as app **`relay-aven-ceo`**. Deploy from repo root:

```bash
bun run deploy:relay-fly
```

Uses [`projects/aven-p2p-signal/fly.toml`](../../../../projects/aven-p2p-signal/fly.toml) + [`Dockerfile`](../../../../projects/aven-p2p-signal/Dockerfile). Org: set **`FLY_ORG`**, or the script infers a Maia/Aven-ish org by **slug or display name** (e.g. **`maia-city`**, **`Maia City`**); **`SHARED`** is preferred when both **`PERSONAL`** and **`SHARED`** rows match.

Allocate **IPv4** (included in deploy flow), then DNS at **`aven.ceo`**:

| Type | Name | Value | Purpose |
|------|------|-------|---------|
| **A** | `relay` | Fly dedicated IPv4 | HyperDHT UDP **49737** + relay **49738** |

Do **not** CNAME **`relay`** → **`*.fly.dev`** for UDP unless you have confirmed Fly UDP behavior for that setup — **A → dedicated IPv4** is the documented safe path here.

Optional **HTTPS** (manifest / health wake only — clients still bootstrap over **UDP**, not HTTPS):

```bash
fly certs add relay.aven.ceo -a relay-aven-ceo
```

After DNS propagates:

```bash
dig +short relay.aven.ceo A
curl -s https://relay.aven.ceo/.well-known/aven-relay.json
```

Fly may **scale to zero**; first pairing after sleep can incur wake latency — use `fly scale` / `fly machine start` if needed during testing.

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
[p2p-signal] central discovery (local embedded) — bootstrap=… relayNode=127.0.0.1:49738 …
```

---

## Remote bootstrap dev (`AVEN_RELAY_URL` = Fly hostname)

No local Rust/relay subprocess; Tauri merges bootstrap from **`AVEN_RELAY_URL`** (ports overridable with **`AVENOS_P2P_SIGNAL_PORT`** / **`AVENOS_P2P_SIGNAL_RELAY_PORT`** for the script-side only; swarm uses **`AVENOS_P2P_SIGNAL_PORT`** for **`127.0.0.1@{host}:{dhtUdp}`**).

```bash
AVEN_RELAY=true
AVEN_RELAY_URL=relay.aven.ceo
```

Expect:

```text
[p2p-signal] central discovery (remote host) — bootstrap=127.0.0.1@relay.aven.ceo:49737 …
```

Packaged builds (no **`scripts/p2p-signal`**): set **`AVEN_RELAY_URL`** and optionally **`AVENOS_DHT_BOOTSTRAP`** in process env — see [`projects/tauri-plugin-peer/src/lib.rs`](../../../../projects/tauri-plugin-peer/src/lib.rs). If **`AVENOS_DHT_BOOTSTRAP`** is omitted, the plugin derives **`127.0.0.1@{AVEN_RELAY_URL}:{udp}`**.

---

## Public Hyperswarm (opt out)

```bash
AVEN_RELAY=false bun run dev:app:mac
```

Or **`.env`**: `AVEN_RELAY=false`. Dev scripts merge **`AVENOS_DHT_PUBLIC=1`** and skip central helpers.

Legacy: **`AVENOS_SKIP_P2P_SIGNAL=1`** also disables central mode.

---

## What runs locally when `AVEN_RELAY=true` and URL is localhost

1. **Rust** — [`projects/aven-p2p-signal`](../../../../projects/aven-p2p-signal): UDP **49737**, prints `bootstrap`.
2. **Node.js** (preferred) or Bun — [`infra/p2p-signal-relay/blind-relay-server.cjs`](../../../../infra/p2p-signal-relay/blind-relay-server.cjs): UDP **49738**.

Orchestration: [`scripts/p2p-signal.ts`](../../../../scripts/p2p-signal.ts). Entrypoints [`scripts/dev-app-macos.ts`](../../../../scripts/dev-app-macos.ts), [`scripts/dev-app-linux.ts`](../../../../scripts/dev-app-linux.ts), [`scripts/dev-two-instances.ts`](../../../../scripts/dev-two-instances.ts) call **`startP2pSignal`** and merge **`envAugment`**.

**Central env (Tauri)** — typical merged keys:

- `AVEN_RELAY=1`
- `AVEN_RELAY_URL=<as given>`
- `AVENOS_DHT_ISOLATED=1`
- `AVENOS_DHT_BOOTSTRAP=…`
- `AVENOS_P2P_DIRECT_ONLY=1`
- `AVENOS_P2P_IGNORE_RELAY_ENV=1`

**Public env**: `AVEN_RELAY=0`, `AVENOS_DHT_PUBLIC=1`, `AVENOS_P2P_DIRECT_ONLY=1`.

Tauri logs: **`direct P2P data plane`** and **not** **`relay_through set`**.

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

- **49737** — Rust isolated DHT (**`AVENOS_P2P_SIGNAL_PORT`**)
- **49738** — central relay node (**`AVENOS_P2P_SIGNAL_RELAY_PORT`**)

Stale listeners on macOS/Linux: **`lsof`** + SIGTERM/KILL round in **`scripts/p2p-signal.ts`**.

---

## Persisted relay key

**`<repo>/.avenOS/dev/p2p-signal/relay-hyperdht.seed`** when embedded local central mode runs (gitignored).

---

## Slow two-instance startups

Two **`tauri dev`** runs share one **`target/`** compile lock — often **10–30s** extra; unrelated to pairing.

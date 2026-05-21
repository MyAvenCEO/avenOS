---
title: Local P2P signal
---

# Local P2P signal (localhost)

Centralized **discovery / pairing** for AvenOS desktop dev. **`AVEN_RELAY` defaults on** (alias **`AVENOS_RELAY`**). Set **`AVEN_RELAY=false`** for public Holepunch HyperDHT.

| `AVEN_RELAY` | Discovery | Data plane (Groove / Jazz sync) |
|--------------|-----------|----------------------------------|
| **default / unset / true** | Embedded **`aven-p2p-signal-dht`** + relay **node** (isolated bootstrap) | **Direct P2P only** |
| **`false`** | Public Holepunch HyperDHT roots | **Direct P2P only** |

Remote hosting (Fly, Docker in production) is **out of scope until localhost is green** — treat [`projects/aven-p2p-signal/Dockerfile`](../../../../projects/aven-p2p-signal/Dockerfile) as experimental.

## Discovery vs data plane

**`AVEN_RELAY`** turns on the **central signal service** (DHT bootstrap + relay **node** as infrastructure). That stack helps peers **announce, lookup, and rendezvous** on pairing topics.

It does **not** mean “sync goes through our server.” Once peeroxide links up, **CoValues replicate over normal hyperswarm peer connections**. AvenOS sets **`AVENOS_P2P_DIRECT_ONLY=1`** so peeroxide **never** applies **`AVENOS_HYPERSWARM_RELAY_*`** (`relay_through` would force blind-relay transport — forbidden here).

The blind-relay subprocess joins the **same isolated DHT** as a network node; it is **not** wired into the Tauri swarm config.

## Enable central discovery (default)

No `.env` entry needed — dev scripts start central mode automatically.

```bash
bun run dev:app2x:mac
# or dev:app:mac / dev:app2x:linux
```

Expect:

```text
[p2p-signal] central discovery ready — bootstrap=127.0.0.1@127.0.0.1:49737 relayNode=127.0.0.1:49738 …
```

Tauri logs should show **`AVEN_RELAY central discovery`** and **`direct P2P data plane — AVENOS_HYPERSWARM_RELAY_* ignored`**, not **`relay_through set`**.

## Public Hyperswarm (opt out)

```bash
AVEN_RELAY=false bun run dev:app:mac
```

Or in **`.env`**: `AVEN_RELAY=false`. Dev scripts skip subprocesses and merge **`AVENOS_DHT_PUBLIC=1`**:

```text
[p2p-signal] off (AVEN_RELAY=false) — public Holepunch HyperDHT
```

Legacy alias: **`AVENOS_SKIP_P2P_SIGNAL=1`** also disables central mode.

## What runs when `AVEN_RELAY=true`

1. **Rust** — [`projects/aven-p2p-signal`](../../../../projects/aven-p2p-signal): UDP **49737**, prints `bootstrap`.
2. **Node.js (preferred)** or Bun — [`infra/p2p-signal-relay/blind-relay-server.cjs`](../../../../infra/p2p-signal-relay/blind-relay-server.cjs): UDP **49738**, DHT peer on the isolated network (signal infra only).

Orchestration: [`scripts/p2p-signal.ts`](../../../../scripts/p2p-signal.ts). Entrypoints [`scripts/dev-app-macos.ts`](../../../../scripts/dev-app-macos.ts), [`scripts/dev-app-linux.ts`](../../../../scripts/dev-app-linux.ts), [`scripts/dev-two-instances.ts`](../../../../scripts/dev-two-instances.ts) call **`startP2pSignal`** and merge **`envAugment`**.

**Central mode env (Tauri):**

- `AVEN_RELAY=1`
- `AVENOS_DHT_ISOLATED=1`
- `AVENOS_DHT_BOOTSTRAP=…`
- `AVENOS_P2P_DIRECT_ONLY=1`
- `AVENOS_P2P_IGNORE_RELAY_ENV=1`

**Public mode env:**

- `AVEN_RELAY=0`
- `AVENOS_DHT_PUBLIC=1`
- `AVENOS_P2P_DIRECT_ONLY=1`

Plugin: [`projects/tauri-plugin-peer/src/lib.rs`](../../../../projects/tauri-plugin-peer/src/lib.rs).

## Smoke test

```bash
AVEN_RELAY=true bun -e '
import { startP2pSignal } from "./scripts/p2p-signal.ts"
const h = await startP2pSignal()
console.log(JSON.stringify(h.envAugment, null, 2))
await h.dispose()
'
```

**Foreground:**

```bash
AVEN_RELAY=true bun run dev:p2p-signal
```

## Slow two-instance startups

Two **`tauri dev`** runs share one **`target/`** lock — often **10–30s** extra compile time; unrelated to pairing.

## Ports

- **49737** — Rust isolated DHT (`AVENOS_P2P_SIGNAL_PORT`)
- **49738** — central relay node (`AVENOS_P2P_SIGNAL_RELAY_PORT`)

Override ports via env; script frees stale UDP listeners via `lsof`.

## Persisted relay key

**`<repo>/.avenOS/dev/p2p-signal/relay-hyperdht.seed`** when central mode runs (gitignored).

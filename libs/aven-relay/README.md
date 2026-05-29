# aven-relay

Single **central P2P discovery** stack for AvenOS:

| Piece | Role |
|-------|------|
| `aven-relay-dht` (Rust) | HyperDHT bootstrap + co-hosted Hyperswarm blind-relay on UDP **49737** |
| `start-fly.ts` (Bun) | Fly.io PID1: supervises Rust binary, serves `/.well-known/aven-relay.json` on **:8080** |

Depends on [`libs/aven-p2p`](../aven-p2p).

## Local dev

`scripts/p2p-signal.ts` runs `cargo run` on this crate when `AVEN_RELAY_URL` is `127.0.0.1` / `localhost`.

## Production (Fly)

From repo root:

```sh
bun run deploy:relay-fly
```

Uses `fly.toml` + `Dockerfile` here (build context = repo root). App name **`relay-aven-ceo`**, region **fra**, volume **`/data/p2p-signal`**.

Relay identity: **`AVENOS_RELAY_SEED_HEX`** + **`AVENOS_RELAY_PUBLIC_KEY_HEX`** in root `.env` (synced to Fly secrets by the deploy script).

## History

Older **Node** `infra/p2p-signal-relay` (UDP **49738**, separate blind-relay process) was removed — its role is fully covered by the Rust co-hosted relay in this package.

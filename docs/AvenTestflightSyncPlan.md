# TestFlight ⇄ Sprite sync — plan (M1 local transport, M2 TestFlight)

**Goal:** iOS + macOS apps sync over the hosted `aven-ceo` Sprite, with no
`sprite proxy` and no shell env on the device.

## The core constraint (why this needs a transport change)

A packaged app reaches the server only over the **public internet**. A Sprite's
only public ingress is its **URL → port 8080, TLS terminated at the Sprites
proxy**. The current sync transport is **raw TCP :4290 + in‑process rustls +
did:key challenge bound to the live TLS session (channel binding)** — unreachable
that way (raw 4290 needs the CLI proxy; the proxy terminates TLS so channel
binding can't hold).

**So sync must move to the public URL on :8080**, which means:
1. **Transport → WebSocket** over the Sprites proxy (`wss://<sprite>.sprites.app/sync`); server speaks plain HTTP/WS on :8080 (proxy does TLS).
2. **Handshake → nonce‑only** (drop channel binding). Replay still prevented by the server‑issued single‑use 5‑min nonce; data stays E2E‑encrypted (blind replica).
3. **Config → compile‑time** baked URL (`option_env!`/Tauri config), runtime‑overridable for dev.
4. **URL `--auth public`** (devices have no org token); `/sync` still gated by did:key challenge + per‑frame biscuit `may_sync`.

The split: **M1 builds and proves the new transport entirely on the dev machine
(local instances syncing over the public `wss://…` URL — the exact path a device
takes). M2 only packages that same build to TestFlight.** Nothing about the
transport changes between M1 and M2 — M2 is pure deployment.

---

## M1 — Transport upgrade, proven locally

### M1.0 — De‑risk (cheap, do first)
Confirm the Sprites proxy forwards a **WebSocket upgrade** to :8080 from a public
client: run a throwaway WS echo on :8080, URL public, connect `wss://aven-ceo-bmrha.sprites.app/` from the Mac. 101 + echo → proceed. If not → replan (fallback: hosted transparent TCP relay, heavier).

### M1.1 — WS sync transport (`aven-p2p`)
Add a WebSocket transport pair beside the TCP one:
- **server**: accept WS, run the existing `ServerHello → ClientAuth → AuthResult` handshake over WS messages with `channel_binding = ""`, then pump length‑prefixed bincode frames as WS **binary** messages.
- **client** (`WsClientTransport`): `connect_async(wss://…/sync)`, same handshake + framing.
Reuse `challenge.rs` (cb‑less `build_message`), `encode/decode_length_prefixed` (aven-db), and the `SyncTransport` trait (engine wiring unchanged). Dep: `tokio-tungstenite` (rustls). Keep the TCP path under a `dev-tcp` feature.

### M1.2 — Server serves HTTP+WS on :8080 (`aven-server`)
Replace the hand‑rolled health loop + raw‑TCP listener with one HTTP server on
:8080 (axum) serving `GET /health` and `GET /sync` (WS upgrade → WS transport).
Keep the graceful‑shutdown + self‑heal already landed. Rebuild on the Sprite →
`bun run deploy:server:sprite`. Endpoint: `wss://aven-ceo-bmrha.sprites.app/sync`.

### M1.3 — App dials the WS endpoint (`app/src-tauri`)
`try_server_transport` builds `WsClientTransport` from a sync URL resolved as
`std::env::var("AVENOS_SERVER_WS_URL")` (dev) → `option_env!(…)` (baked) → prod
default `wss://aven-ceo-bmrha.sprites.app/sync`. `connected_relay_did`/revoke/
on‑inbound wiring unchanged.

### M1.4 — Local verification (the M1 done‑bar)
- `curl https://aven-ceo-bmrha.sprites.app/health` → ok; WS handshake to `/sync`.
- **No proxy:** `AVENOS_SERVER_WS_URL=wss://aven-ceo-bmrha.sprites.app/sync bun run dev:app2x:mac` (new harness mode: skip `sprite proxy`, dial the public URL directly) → two instances **converge a spark over the public URL**. This is precisely a device's path — green here ⇒ a baked build works on device.

---

## M2 — Same transport, via TestFlight

### M2.1 — Bake the URL in the release pipeline
`build-appstore-macos.ts` / `tauri-ios-asc.ts`: thread `AVENOS_SERVER_WS_URL` into
the `tauri build` env so it compiles in (prod default covers it if unset).

### M2.2 — Build + sign + upload
`bun run release:app:mac` / `release:app:ios` → `.pkg` / `.ipa` → App Store
Connect. **Requires the user's Apple creds** (`.env.apple.local`: team, signing
identity, ASC API key); this step is user/CI‑run, not automatable here.

### M2.3 — Device verification
Install via TestFlight on an iPhone + a Mac, sign in, create/edit a spark on one,
confirm it syncs to the other through `aven-ceo`. (Same transport as M1.4, now on
real devices over the App Store build.)

---

## Security notes
Dropping channel binding is acceptable over the trusted Sprites TLS proxy +
single‑use nonce + E2E encryption (see earlier analysis). Public URL ⇒ anyone can
hit `/sync` and wake the Sprite (anti‑abuse gap — fine for testnet; closed later
by the invite/ACC work). The relay seed stays a gitignored secret; the relay is a
blind replica (no keyshares).

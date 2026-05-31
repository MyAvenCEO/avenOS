# iOS TestFlight — foreground P2P (Hyperswarm) smoke checklist

Exercise **hyperswarm + UDP DHT bootstrap** on a **physical iPhone/iPad** from a signed **store IPA**. Do **not** rely on the iOS Simulator for Secure Enclave or production-like networking—the supported QA path matches [iOS upload via Transporter](ios-testflight-upload-transporter.md).

**Goal:** After unlock, the app completes invite/pair flows, **auto-reconnects** on path changes, and syncs admin-granted sparks — similar to sandboxed macOS TestFlight builds on compatible betas.

**Docs:** User expectations — [Staying connected](../network/founders/05-staying-connected.md), [Connection status](../network/founders/04-connection-status.md). Developer heal reference — [Auto-heal & coordinator](../network/developers/06-auto-heal-and-coordinator.md).

**UI:** Trusted peers / mesh chips refresh from **push-only** `avenos:runtime` (mesh + subscribed `peers` table)—no peers-screen polling.

## Prerequisites

- iOS IPA from `bun run release:app:ios 13 --no-upload` (or pass without `--no-upload` to push to TestFlight; bump the build number for every upload).
- Build logs from `scripts/tauri-ios-asc.ts` should show **`embedding AVENOS_DHT_BOOTSTRAP=`<host>@<relay>:49737** and **`AVENOS_HYPERSWARM_RELAY_ADDR=`<host>:49737** (co-hosted blind-relay on the same UDP port as HyperDHT bootstrap). Sanity-check `.aven-ios-compile.env` under **`app/gen/apple/`** before Xcode runs if troubleshooting.
- Companion device: preferably **macOS TestFlight build** with matching relay/genesis assumptions (see [macOS TestFlight sandbox smoke](macos-testflight-sandbox-smoke.md)) for cross-platform mesh tests.

## Smoke steps

1. **Launch + local-network prompt**

   - [ ] On first swarm activity, accept the **Local Network** permission—the copy comes from **`NSLocalNetworkUsageDescription`** in `Info.ios.plist`.
   - [ ] Cold start completes; WebView/UI loads.

2. **Identity**

   - [ ] Unlock with Face ID / Touch ID where configured; quit and reopen without identity loops.

3. **Swarm lifecycle**

   - [ ] **Retry swarm** (Self → peers) works without capability errors when needed (`p2p:default`).

4. **P2P handshake + connect (with macOS or second iPhone)**

   - [ ] Invite and accept pairing; chips progress **Pairing…** → **Connecting…** → **Up to date**.

   **Hotspot tether (iPhone 5G + Mac on Personal Hotspot):** expect **LAN** on `172.20.10.x`.

   Diagnostics (both devices within ~60s):

   - [ ] **`linkedCount >= 1`** on both sides (mux-ready only — not inflated by ghost transport).
   - [ ] **`groove_p2p link up peer=… mode=Lan`** on same Wi‑Fi (or **`Relay`/`Punched`** cross-network).
   - [ ] Within ~30s: catch-up flush OK; admin-grant sparks appear without endless **`Groove mux not send-ready`**.

5. **Auto-heal scenarios** (after initial pair succeeds)

   - [ ] **Kill remote app → reopen** — **Connecting…** then **Up to date** within ~15s; log may show `reconnect_peers`.
   - [ ] **iPhone Wi‑Fi → 5G** (Mac stays Wi‑Fi) — brief **Connecting…**; transport **Relay** or **Punched**; sync resumes without new invite.
   - [ ] **Airplane mode toggle** (one device) — heal after path satisfied (~10–30s).
   - [ ] **Background 5+ min → foreground** — heal without manual retry; no duplicate DHT storm (plugin heal + register-only reconcile).

6. **Jazz + Sparks sanity**

   - [ ] Spark surfaces load after **Grant admin**; non-granted sparks stay private.

## If something fails

| Symptom | Next check |
|---------|-------------|
| `peer_swarm_retry` forbidden | Regenerate app schemas; confirm `p2p:default` capability. |
| Swarm up but never **Connecting…** | Relay reachability, bootstrap embed, Local Network, firewall. |
| **Connecting…** stuck >2 min on 5G | Logs for `reconnect_peers`; phantom suppress; try same Wi‑Fi to isolate relay. |
| **Up to date** but empty spark | **Grant admin**, not pairing. |
| No local-network dialog | Reinstall after plist/entitlement change; trigger swarm once. |

When this checklist passes alongside macOS TestFlight smoke, coordinate versioning via **Internal testing** before external rollout.

User troubleshooting: [Troubleshooting](../network/founders/06-troubleshooting.md).

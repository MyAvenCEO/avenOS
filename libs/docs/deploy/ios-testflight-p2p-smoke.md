# iOS TestFlight — foreground P2P (Hyperswarm) smoke checklist

Exercise **hyperswarm + UDP DHT bootstrap** on a **physical iPhone/iPad** from a signed **store IPA**. Do **not** rely on the iOS Simulator for Secure Enclave or production-like networking—the supported QA path matches [iOS upload via Transporter](ios-testflight-upload-transporter.md).

**Goal:** After unlock, the app can retry/configure the swarm (`peer_swarm_retry`), subscribe to Jazz surfaces, and complete invite/pair flows similar to sandboxed macOS TestFlight builds when both ends run compatible betas.

**UI:** Trusted peers / mesh chips refresh from **push-only** `avenos:runtime` (mesh + subscribed `peers` table)—no peers-screen polling smoke expectation.

## Prerequisites

- iOS IPA from `bun run release:app:ios 13 --no-upload` (or pass without `--no-upload` to push to TestFlight; bump the build number for every upload).
- Build logs from `scripts/tauri-ios-asc.ts` should show **`embedding AVENOS_DHT_BOOTSTRAP=`<host>@<relay>:49737** and **`AVENOS_HYPERSWARM_RELAY_ADDR=`<host>:49737** (co-hosted blind-relay on the same UDP port as HyperDHT bootstrap). Sanity-check `.aven-ios-compile.env` under **`lib/app/gen/apple/`** before Xcode runs if troubleshooting.
- Companion device: preferably **macOS TestFlight build** with matching relay/genesis assumptions (see [macOS TestFlight sandbox smoke](macos-testflight-sandbox-smoke.md)) for cross-platform mesh tests.

## Smoke steps

1. **Launch + local-network prompt**

   - [ ] On first swarm activity, accept the **Local Network** permission—the copy comes from **`NSLocalNetworkUsageDescription`** in `Info.ios.plist`.
   - [ ] Cold start completes; WebView/UI loads.

2. **Identity**

   - [ ] Unlock with Face ID / Touch ID where configured; quit and reopen without identity loops.

3. **Swarm lifecycle**

   - [ ] Trusted peers / pairing UI exposes **retry swarm** paths without “permission denied” from the **`peer_swarm_retry`** ACL (capabilities include `peer:default`).

4. **P2P handshake + connect (with macOS or second iPhone)**

   - [ ] Invite and accept pairing; observe mesh progressing past searching when both devices share relay/genesis.

   **Hotspot tether (iPhone 5G + Mac on Personal Hotspot):** expect **LAN direct** on `172.20.10.x`, not carrier same-IP holepunch. Requires **build 21+** (handshake `addresses4` + LAN `match_address`).

   Diagnostics / success signals (Rust trace → `avenos_dht_trace_snapshot` when enabled; copy from both devices within ~60s):

   - [ ] **`lastConnectRelayed === true`** and **`lastRemoteHolepunchable === true`** on the initiating side after Noise completes (relay advertised `HolepunchInfo` — client must not open UDX to Fly bootstrap).
   - [ ] Log line **`connect path: post-handshake endpoint selection`** with **`lan_match=Some(...)`** and **`direct=172.20.10.x:…`** on hotspot tether (or holepunch on separate networks).
   - [ ] On hotspot: **no** **`holepunch aborted`** if LAN direct succeeds first.
   - [ ] **`swarmPeerConnectedTotal >= 1`** and **`linkedCount >= 1`** after pairing settles.
   - [ ] **`holepunchBlindRelayFallbackTotal === 0`** on **hotspot tether** (LAN direct should win before blind-relay).
   - [ ] On **cross-network** pairs (e.g. Mac on Wi‑Fi + iPhone on 5G): **`holepunchBlindRelayFallbackTotal > 0`** is OK when holepunch fails but pairing still reaches **`linkedCount >= 1`** with transport **Relay** or **Punched** (build 24+ embeds blind-relay at **`relay.aven.ceo:49737`**).

5. **Jazz + Sparks sanity**

   - [ ] `/sparks` or primary subscriber surfaces load without persistent ~30 s timeouts when the upstream is healthy.

## If something fails

| Symptom | Next check |
|---------|-------------|
| `peer_swarm_retry` forbidden / capability errors | Confirm `projects/tauri-plugin-peer` **`allow-peer-swarm-retry`** in default permissions and regenerated app schemas under `lib/app/src-tauri/gen/schemas/`. |
| Swarm starts but peers never locate | Relay reachability (`AVEN_RELAY_URL`), **`AVENOS_DHT_BOOTSTRAP`** correctness, App ID **Networking** caps, firewall; compare with macOS smoke console filters for `peeroxide` / hyperswarm startup. |
| No local-network dialog | Hyperswarm may not probe LAN yet; reinstall or reset privacy for the app once on a lab device after entitlement/plist edits. |

When this checklist passes alongside macOS TrackFlight smoke, coordinate TestFlight versioning (for example macOS **7** + iOS **4**) via **Internal testing** cohorts before external rollout.

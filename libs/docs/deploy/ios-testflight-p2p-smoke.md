# iOS TestFlight — foreground P2P (Hyperswarm) smoke checklist

Exercise **hyperswarm + UDP DHT bootstrap** on a **physical iPhone/iPad** from a signed **store IPA**. Do **not** rely on the iOS Simulator for Secure Enclave or production-like networking—the supported QA path matches [iOS upload via Transporter](ios-testflight-upload-transporter.md).

**Goal:** After unlock, the app can retry/configure the swarm (`peer_swarm_retry`), subscribe to Jazz surfaces, and complete invite/pair flows similar to sandboxed macOS TestFlight builds when both ends run compatible betas.

## Prerequisites

- iOS IPA from `bun run release:app:ios 13 --no-upload` (or pass without `--no-upload` to push to TestFlight; bump the build number for every upload).
- Build logs from `scripts/tauri-ios-asc.ts` should show **`embedding AVENOS_DHT_BOOTSTRAP=`<host>@<relay>:49737** (HyperDHT bootstrap; manifest `.well-known/aven-relay.json` no longer advertises a second UDP relay port). Sanity-check `.aven-ios-compile.env` under **`lib/app/gen/apple/`** before Xcode runs if troubleshooting.
- Companion device: preferably **macOS TestFlight build** with matching relay/genesis assumptions (see [macOS TestFlight sandbox smoke](macos-testflight-sandbox-smoke.md)) for cross-platform mesh tests.

## Smoke steps

1. **Launch + local-network prompt**

   - [ ] On first swarm activity, accept the **Local Network** permission—the copy comes from **`NSLocalNetworkUsageDescription`** in `Info.ios.plist`.
   - [ ] Cold start completes; WebView/UI loads.

2. **Identity**

   - [ ] Unlock with Face ID / Touch ID where configured; quit and reopen without identity loops.

3. **Swarm lifecycle**

   - [ ] Trusted peers / pairing UI exposes **retry swarm** paths without “permission denied” from the **`peer_swarm_retry`** ACL (capabilities include `peer:default`).

4. **P2P handshake + holepunch (with macOS or second iPhone)**

   - [ ] Invite and accept pairing; observe mesh progressing past searching when both devices share relay/genesis (Wi‑Fi LAN, or **5G via HyperDHT in-band handshake relay + NAT holepunch** when direct UDP fails).

   Diagnostics / success signals (Rust trace → `avenos_dht_trace_snapshot` when enabled):

   - [ ] **`lastConnectRelayed === true`** and **`lastRemoteHolepunchable === true`** on the initiating side after Noise completes (proves swarm advertised `HolepunchInfo` relayed handshake path — avoids immediate UDX to the Fly bootstrap).
   - [ ] Logs show **`PEER_HOLEPUNCH`** / holepunch rounds, not **`establishing UDX stream`** straight to the public DHT UDP address.
   - [ ] **`swarmPeerConnectedTotal >= 1`** and **`linkedCount >= 1`** after pairing settles.

5. **Jazz + Sparks sanity**

   - [ ] `/sparks` or primary subscriber surfaces load without persistent ~30 s timeouts when the upstream is healthy.

## If something fails

| Symptom | Next check |
|---------|-------------|
| `peer_swarm_retry` forbidden / capability errors | Confirm `projects/tauri-plugin-peer` **`allow-peer-swarm-retry`** in default permissions and regenerated app schemas under `lib/app/src-tauri/gen/schemas/`. |
| Swarm starts but peers never locate | Relay reachability (`AVEN_RELAY_URL`), **`AVENOS_DHT_BOOTSTRAP`** correctness, App ID **Networking** caps, firewall; compare with macOS smoke console filters for `peeroxide` / hyperswarm startup. |
| No local-network dialog | Hyperswarm may not probe LAN yet; reinstall or reset privacy for the app once on a lab device after entitlement/plist edits. |

When this checklist passes alongside macOS TrackFlight smoke, coordinate TestFlight versioning (for example macOS **7** + iOS **4**) via **Internal testing** cohorts before external rollout.

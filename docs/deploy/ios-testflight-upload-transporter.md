# iOS TestFlight upload via Transporter (AvenOS — identity)

Store IPAs are built via `scripts/tauri-ios-asc.ts`. Network identity is hardcoded (`ceo.aven/testnet/abagana`). Live P2P transport has been removed — the app runs local Groove + demo mesh UI only.

We still **avoid the simulator** as the authoritative QA lane for AvenOS identity: Secure Enclave and store signing behave differently from lab simulators—produce a signed **IPA**, upload via Transporter, and validate on **physical devices through TestFlight**.

## 1. Prerequisites

- Xcode + CocoaPods toolchain installed locally (the generated project uses XcodeGen + Pods).
- **iOS device platform** installed in Xcode (**Settings → Components**). Simulator runtimes are not required for this workflow.
- **`gen/apple/` is gitignored.** After clone / config updates, scaffold from **`app`**: `CI=true bunx tauri ios init --ci`  
  Entitlements are re-synced automatically during `bun run release:app:ios` from **`app/src-tauri/ios-template/`**.
- `APPLE_DEVELOPMENT_TEAM` via **`<repo-root>/.env.apple.local`** (template **`scripts/apple-env.local.template`**, quotable paths, never commits with `.gitignore` **`.env.*`**), **`tauri.ios.conf.json`**, or your shell — **do not commit** secrets.
- Network identity is hardcoded in the app binary (`ceo.aven/testnet/abagana`) — no genesis env required.

If you enabled **Push** + **Associated Domains** on the App ID, read [iOS Associated Domains + Push](ios-associated-domains-and-push.md) (regenerate provisioning profile; replace entitlement placeholders).

Increment **`AVEN_IOS_CF_BUNDLE_VERSION`** (or **`bundle.iOS.bundleVersion`**) for **every upload** — Apple rejects duplicate build numbers inside the same app record.

## 2. Build the IPA (device / App Store only)

From repo root:

```bash
bun run release:app:ios 14 --no-upload
```

(or from `app`: `bun run tauri:ios:build:asc`)

This runs `tauri ios build --export-method app-store-connect --target aarch64 --ci` — **arm64 device**, not simulator.

Output (copied by the script):

`dist/ios-appstore/avenOS-<version>-build<N>.ipa`

## 3. Upload to App Store Connect

**One command builds and uploads** — runs the Tauri iOS build, then `xcrun altool --upload-app` using the API key in `.env.apple.local`:

```bash
# build iOS with CFBundleVersion=14 and upload to TestFlight
bun run release:app:ios 14

# do both macOS .pkg AND iOS .ipa with the same build number
bun run release:app:all 14
```

The trailing integer is the **CFBundleVersion / build number**. Apple rejects duplicates inside an app record — bump it for every upload.

Requires **`APPLE_API_KEY`**, **`APPLE_API_ISSUER`**, and **`APPLE_API_KEY_PATH`** in `.env.apple.local` (App Store Connect → Users and Access → Keys). The script sets `API_PRIVATE_KEYS_DIR=$(dirname "$APPLE_API_KEY_PATH")` so the `.p8` can live anywhere on disk.

Opt-out flags for the rare local-only cases:
- `bun run release:app:ios 14 --no-upload` → build only, keep the IPA under `dist/ios-appstore/` for manual upload
- `bun run release:app:ios --no-build` → upload the **newest** existing IPA (handy after a transient network failure)

**GUI fallback** — same outcome, useful for one-offs: drag the produced `.ipa` into **Transporter** → **Deliver**.

Do **not** use `tauri ios dev`, `tauri ios build --open`, or simulator targets for AvenOS iOS QA — TestFlight on hardware is the supported path.

For **locally installed simulator runtimes** (future dev only, not TestFlight), see [ios-simulator-local.md](ios-simulator-local.md).

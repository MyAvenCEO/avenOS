# iOS TestFlight upload via Transporter (AvenOS v1 — no P2P)

iOS v1 builds omit Hyperswarm; they focus on Secure Enclave identity + Jazz/UI surfaces. **We do not test on the iOS Simulator** — Secure Enclave and store signing differ from device/TestFlight builds. Produce a signed **IPA**, upload via Transporter, and validate on **physical devices through TestFlight only**.

## 1. Prerequisites

- Xcode + CocoaPods toolchain installed locally (the generated project uses XcodeGen + Pods).
- **iOS device platform** installed in Xcode (**Settings → Components**). Simulator runtimes are not required for this workflow.
- **`gen/apple/` is gitignored.** After clone / config updates, scaffold from **`lib/app`**: `CI=true bunx tauri ios init --ci`  
  Entitlements are re-synced automatically by `build:app:ios:appstore` from **`lib/app/src-tauri/ios-template/`**.
- `APPLE_DEVELOPMENT_TEAM` via **`<repo-root>/.env.apple.local`** (template **`scripts/apple-env.local.template`**, quotable paths, never commits with `.gitignore` **`.env.*`**), **`tauri.ios.conf.json`**, or your shell — **do not commit** secrets.
- **`GENESIS_NETWORK_ID`** in repo **`.env`** (or shell) — embedded at compile time like macOS TestFlight builds.

If you enabled **Push** + **Associated Domains** on the App ID, read [iOS Associated Domains + Push](ios-associated-domains-and-push.md) (regenerate provisioning profile; replace entitlement placeholders).

Increment **`AVEN_IOS_CF_BUNDLE_VERSION`** (or **`bundle.iOS.bundleVersion`**) for **every upload** — Apple rejects duplicate build numbers inside the same app record.

## 2. Build the IPA (device / App Store only)

From repo root:

```bash
bun run build:app:ios:appstore
```

(or from `lib/app`: `bun run tauri:ios:build:asc`)

This runs `tauri ios build --export-method app-store-connect --target aarch64 --ci` — **arm64 device**, not simulator.

Output (copied by the script):

`dist/ios-appstore/avenOS-<version>-build<N>.ipa`

## 3. Upload with Transporter

1. Drag the produced **`.ipa`** into **Transporter** → **Deliver**.
2. Confirm processing in App Store Connect → **Apps → iOS** → **TestFlight**.
3. Complete **encryption export** + **privacy** questionnaires if prompted.
4. Add internal testers → install **TestFlight** on a physical iPhone/iPad → accept invite and test.

Do **not** use `tauri ios dev`, `tauri ios build --open`, or simulator targets for AvenOS iOS QA — TestFlight on hardware is the supported path.

For **locally installed simulator runtimes** (future dev only, not TestFlight), see [ios-simulator-local.md](ios-simulator-local.md).

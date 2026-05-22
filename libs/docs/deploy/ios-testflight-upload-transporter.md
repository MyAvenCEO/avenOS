# iOS TestFlight upload via Transporter (AvenOS v1 — no P2P)

iOS TrackFlight builds omit Hyperswarm; they focus on Secure Enclave identity + Jazz/UI surfaces. Produce a signed **IPA** archive and upload it exactly like other App Store binaries.

## 1. Prerequisites

- Xcode + CocoaPods toolchain installed locally (the generated project uses XcodeGen + Pods).
- **`gen/apple/` is gitignored.** After clone / config updates, scaffold from **`lib/app`**: `CI=true bunx tauri ios init --ci`  
  **`tauri ios init` regenerates Xcode output** — re‑apply entitlement changes (Associated Domains, `aps-environment`) under `gen/apple/…/aven-os-app_iOS.entitlements`, or duplicate them into a snippet you paste after init.
- `APPLE_DEVELOPMENT_TEAM` via **`<repo-root>/.env.apple.local`** (template **`scripts/apple-env.local.template`**, quotable paths, never commits with `.gitignore` **`.env.*`**), **`tauri.ios.conf.json`**, or your shell — **do not commit** secrets.

If you enabled **Push** + **Associated Domains** on the App ID, read [iOS Associated Domains + Push](ios-associated-domains-and-push.md) (regenerate provisioning profile; replace entitlement placeholders).

Increment **`bundle.iOS.bundleVersion`** (or `--build-number` on the CLI where supported) for **every upload** — Apple rejects duplicate build numbers inside the same app record.

## 2. Build the IPA / archive

Inside `lib/app`:

```bash
# TEAM + paths: optional /.env.apple.local — see scripts/apple-env.local.template (gitignored).
bun run tauri:ios:build:asc
```

(or run manually with export):

```bash
export APPLE_DEVELOPMENT_TEAM=YOURTEAMID
bunx tauri ios build --export-method app-store-connect --ci -v
```

Common outputs appear under:

`src-tauri/gen/apple/build/arm64/avenOS.ipa`

(or the path echoed by the CLI for your Xcode version — follow the INFO log.)

### Debug via Xcode where needed

```bash
cd lib/app
bunx tauri ios build --open
```

## 3. Upload with Transporter

1. Drag the produced **`.ipa`** into **Transporter** → **Deliver**.
2. Confirm processing in App Store Connect → **Apps → iOS** → **TestFlight**.
3. Complete **encryption export** + **privacy** questionnaires if prompted.

### Device testing note

Simulator builds **do not** exercise full Secure Enclave behavior; perform Touch ID/Face ID + SE flows on hardware.

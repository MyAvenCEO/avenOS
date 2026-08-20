# AvenOS scripts

Repo-root automation for the **avenCITY Tauri app**, the Aven API, and releases.

## Wired in root `package.json` (daily use)

| Script | File | Purpose |
|--------|------|---------|
| `dev:app` | — | Browser-only Vite in `app/` |
| `dev:api` | — | Identity API development server in `services/aven-api` |
| `build:api` / `check:api` / `test:api` | — | API build and verification |
| `db:migrate:api` | — | Explicit API database migration |
| `dev:app:all` | `dev-app-all.ts` | macOS/Linux Tauri dev (dispatches to platform script) |
| `dev:app:mac` | `dev-app-macos.ts` | Tauri dev (macOS) |
| `dev:app:linux` | `dev-app-linux.ts` | Tauri dev (Linux) |
| `dev:app:ios` | `dev-app-ios.ts` | iOS Simulator dev |
| `clean:app:rust` | `clean-app-tauri-target.ts` | Wipe shared `target/rust` |
| `gc:rust` | `gc-rust-target.sh` | Reclaim space in the shared Rust target dir |
| `icons` | `generate-app-icons.ts` | Rebuild every app icon from one svg/png/jpg source |
| `build:app:mac` | `build-appstore-macos.ts` | Signed Mac App Store `.pkg` |
| `build:app:linux` | `build-app-linux.ts` | Linux build with native dependency preflight |
| `release:app:*` | `release-app.ts` | macOS `.pkg` / iOS `.ipa` build + altool upload |
| `next-version` / `set-version` | `next-version.ts`, `set-version.ts` | CalVer derivation + stamping |
| `release:next` | `release-next.ts` | Cut the `next` prerelease locally |

## Called indirectly (keep)

| File | Used by |
|------|---------|
| `free-dev-server-port.ts` | `app` predev, all `dev-app-*` |
| `dev-app-desktop.ts` | `dev-app-macos.ts`, `dev-app-linux.ts` |
| `rust-toolchain.ts` | `tauri-ios-asc.ts`, desktop dev |
| `linux-native-deps.ts` | `build-app-linux.ts`, `dev-app-linux.ts` |
| `apple-env.ts` | `release-app`, `build-appstore-macos`, `tauri-ios-asc` |
| `build-appstore-macos.ts` | `release-app.ts` (mac) |
| `tauri-ios-asc.ts` | `app` `tauri:ios:build:asc`, `release-app.ts` (ios) |
| `generate-app-icons.ts` | `bun run icons`, `tauri-ios-asc.ts` (iOS sizes + xcassets sync) |

## Manual / rare (not in `package.json`)

| File | When |
|------|------|
| `apple-env.local.template` | Copy → `.env.apple.local` for signing/upload |

## Removed by card 0121 (the avenCITY strip)

- `aven-server.ts`, `deploy-aven-node-sprite.ts` — relay / server deploy
- `revendor-aven-db.sh`, `verify-aven-db-gates.sh` — CRDT store vendoring + gates
- `ensure-sidecar.ts`, `fetch-onnxruntime.ts`, `build-sherpa-ios.sh`, `moss-tts-nano-tokenizer.py` — on-device AI sidecars
- `fetch-webcm.ts` — webcm assets
- `dev-two-instances.ts` — two-device peer-sync QA

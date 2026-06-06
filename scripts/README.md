# AvenOS scripts

Repo-root automation for the **Tauri app**, **App Store releases**, and **aven-db** maintenance. Marketing site (`libs/aven-website`) has no scripts here.

## Wired in root `package.json` (daily use)

| Script | File | Purpose |
|--------|------|---------|
| `dev:app` | — | Browser-only Vite in `app/` |
| `dev:app:all` | `dev-app-all.ts` | macOS/Linux Tauri dev (dispatches to platform script) |
| `dev:app:mac` | `dev-app-macos.ts` | Tauri dev (macOS) |
| `dev:app:linux` | `dev-app-linux.ts` | Tauri dev (Linux) |
| `dev:app:ios` | `dev-app-ios.ts` | iOS Simulator dev |
| `dev:app2x:mac` / `dev:app2x:linux` | `dev-two-instances.ts` | Two desktop instances (UI QA) |
| `dev:all` | — | `aven-website` + `app` concurrently |
| `dev:aven-website` | — | Marketing SvelteKit site |
| `dev:ocr-example` | — | Python OCR CLI help (`ARCHIVE/ocr-example`) |
| `clean:app:rust` | `clean-app-tauri-target.ts` | Wipe shared `target/rust` (mac dev uses this) |
| `verify:aven-db` | `verify-aven-db-gates.sh` | Post–re-vendor Rust + `app` check gates |
| `fetch:webcm` | `fetch-webcm.ts` | Download webcm into `app/static/webcm/` |
| `release:app:*` | `release-app.ts` | macOS `.pkg` / iOS `.ipa` build + altool upload |

## Called indirectly (keep)

| File | Used by |
|------|---------|
| `free-dev-server-port.ts` | `app` predev, all `dev-app-*`, `dev-two-instances` |
| `apple-env.ts` | `release-app`, `build-appstore-macos`, `tauri-ios-asc` |
| `build-appstore-macos.ts` | `release-app.ts` (mac) |
| `tauri-ios-asc.ts` | `app` `tauri:ios:build:asc`, `release-app.ts` (ios) |
| `generate-ios-icons.py` | `tauri-ios-asc.ts` |

## Manual / rare (not in `package.json`)

| File | When |
|------|------|
| `revendor-aven-db.sh` | Re-copy Maia `jazz-tools` into `libs/aven-db` (see `libs/aven-db/UPSTREAM.md`) |
| `apple-env.local.template` | Copy → `.env.apple.local` for signing/upload |

## Removed (P2P/relay rip-out)

- `p2p-signal.ts`, `relay-env.ts`, `relay-bootstrap.ts`, `deploy-relay-fly.ts`, `derive-relay-pubkey.ts`, `migrate-relay-seed-to-env.ts`
- `libs/aven-relay/`, `libs/tauri-plugin-p2p/`, `scripts/remote-relay-dht-smoke/`

## Docs package

`docs/scripts/check-word-count.ts` — run via `bun run docs:words` from `app/` (not this folder).

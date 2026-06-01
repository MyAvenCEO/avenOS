# AvenOS scripts

Repo-root automation for the **Tauri app**, **P2P relay**, **App Store releases**, and **aven-db** maintenance. Marketing site (`libs/aven-website`) has no scripts here.

## Wired in root `package.json` (daily use)

| Script | File | Purpose |
|--------|------|---------|
| `dev:app` | — | Browser-only Vite in `app/` |
| `dev:app:all` | `dev-app-all.ts` | macOS/Linux Tauri dev (dispatches to platform script) |
| `dev:app:mac` | `dev-app-macos.ts` | Tauri dev + local P2P signal |
| `dev:app:linux` | `dev-app-linux.ts` | Same on Linux |
| `dev:app:ios` | `dev-app-ios.ts` | iOS Simulator dev |
| `dev:app2x:mac` / `dev:app2x:linux` | `dev-two-instances.ts` | Two desktop instances (mesh QA) |
| `dev:p2p-signal` | `p2p-signal.ts` | Embedded HyperDHT + blind-relay only |
| `dev:all` | — | `aven-website` + `app` concurrently |
| `dev:aven-website` | — | Marketing SvelteKit site |
| `dev:ocr-example` | — | Python OCR CLI help (`ARCHIVE/ocr-example`) |
| `clean:app:rust` | `clean-app-tauri-target.ts` | Wipe shared `target/rust` (mac dev uses this) |
| `verify:aven-db` | `verify-aven-db-gates.sh` | Post–re-vendor Rust + `app` check gates |
| `fetch:webcm` | `fetch-webcm.ts` | Download webcm into `app/static/webcm/` |
| `release:app:*` | `release-app.ts` | macOS `.pkg` / iOS `.ipa` build + altool upload |
| `deploy:relay-fly` | `deploy-relay-fly.ts` | Fly.io `relay-aven-ceo` deploy |
| `dev:aven-self` | — | Local aven-self auth API (`libs/aven-self`, port 3000) |
| `migrate:aven-self` | — | Better Auth DB migrate for aven-self |
| `test:aven-self` | — | HTTP smoke test (server must be running) |
| `test:aven-self:once` | — | Start aven-self, smoke test, stop |
| `derive:relay-pubkey` | `derive-relay-pubkey.ts` | Pubkey from `AVENOS_RELAY_SEED_HEX` |
| `migrate:relay-env` | `migrate-relay-seed-to-env.ts` | One-time: legacy seed file → `.env` |

## Called indirectly (keep)

| File | Used by |
|------|---------|
| `free-dev-server-port.ts` | `app` predev, all `dev-app-*`, `dev-two-instances` |
| `p2p-signal.ts` | `dev-app-macos`, `dev-app-linux`, `dev-two-instances`, `dev:p2p-signal` |
| `relay-env.ts` | `p2p-signal`, `deploy-relay-fly`, `build-appstore-macos`, `tauri-ios-asc`, `derive-relay-pubkey`, `migrate-relay-seed-to-env` |
| `relay-bootstrap.ts` | `p2p-signal`, `build-appstore-macos`, `tauri-ios-asc` |
| `apple-env.ts` | `release-app`, `build-appstore-macos`, `tauri-ios-asc`, `relay-env` |
| `build-appstore-macos.ts` | `release-app.ts` (mac) |
| `tauri-ios-asc.ts` | `app` `tauri:ios:build:asc`, `release-app.ts` (ios) |
| `generate-ios-icons.py` | `tauri-ios-asc.ts` |

## Manual / rare (not in `package.json`)

| File | When |
|------|------|
| `revendor-aven-db.sh` | Re-copy Maia `jazz-tools` into `libs/aven-db` (see `libs/aven-db/UPSTREAM.md`) |
| `remote-relay-dht-smoke/` | `cargo run` DHT/blind-relay smoke (see `docs/network/developers/05-p2p-signal.md`) |
| `apple-env.local.template` | Copy → `.env.apple.local` for signing/upload |

## Removed (legacy / unused)

- `node-connect-relay.mjs` — ad-hoc Node hyperdht probe; nothing referenced it
- `strip-ios-icon-alpha.py` — unused; icon pipeline uses `generate-ios-icons.py`
- `kill-stuck-cargo.sh` — never existed; comment in `verify-aven-db-gates.sh` updated

## Docs package

`docs/scripts/check-word-count.ts` — run via `bun run docs:words` from `app/` (not this folder).

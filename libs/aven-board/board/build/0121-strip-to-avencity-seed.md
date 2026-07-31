---
title: Strip avenOS to the avenCITY seed
summary: Delete the testnet and mainnet worlds, their libs and all server deploy CI; keep avenCITY, the app icon, and passkey/biometric as documented reference packages.
owner: claude (build agent)
created: 2026-07-31
updated: 2026-07-31
tags: [architecture, deletion, simplify]
goal: "`bun run lint`, `bun --cwd app run check` and `cargo check --manifest-path app/src-tauri/Cargo.toml` all exit 0; `ls libs` prints exactly `aven-board` and `aven-city`; `rg -il 'abagana|alberobello|better-auth|aven-db|deploy-relay|selectedNetwork' app libs scripts .github` prints nothing; `ARCHIVE/tauri-plugin-biometric/README.md` and `ARCHIVE/tauri-plugin-passkey/README.md` both exist and document RP ID + apple-app-site-association; and `bun run dev:app:mac` opens the Tauri window straight into avenCITY with no Select Network step"
---

# Strip avenOS to the avenCITY seed

## Context

avenOS carries three worlds. Two of them — testnet/**Abagana** (vault, CRDT sync,
Secure Enclave onboarding) and mainnet/**Alberobello** (Better Auth, Neon
Postgres, skills/vibes/flows) — are roughly 150k lines across 17 libs, plus a
Sprite relay and a Fly auth server that both cost money and break builds. The
third, **avenCITY**, is a self-contained three.js island that needs none of it.

The goal is not to ship avenCITY as a product and not to save money, though both
follow. It is to get back to a **base small enough to hold in your head**, so the
next architecture can grow on a clean seed instead of being negotiated against
this one.

The trap this card exists to avoid: the two things worth keeping are *inside* the
two things being deleted.

- **Biometric** is `libs/tauri-plugin-self` (2.4k LOC, Secure Enclave P-256) — and
  it is hardcoded to the testnet seed `ceo.aven/testnet/abagana`.
- **Passkey** is `libs/betterauth` + `@better-auth/passkey` + `app/src/lib/auth`
  — all mainnet, all 23k LOC of auth server.

So "keep them" means **extract before delete**, not "leave them alone". Two
things already help: `ARCHIVE/` is the established parking convention (and
`ARCHIVE/tauri-plugin-passkey/` already exists, unlinked from the app), and
`docs/deploy/ios-associated-domains-and-push.md` already documents
`webcredentials:aven.ceo`.

Decisions taken during discovery (do not re-litigate):

- The **Select Network picker is deleted**. With one world there is nothing to
  pick; the app boots into the game. `NetworkId`, the network store and the
  "← Select network" button all go.
- **`libs/aven-board` stays.** It is the kanban and this card lives in it. Only
  the in-app board *viewer* route goes.
- The passkey reference is **native + domain scaffolding only** — no server code
  parked. The 23k-LOC Better Auth server is deleted outright.

Related: [[0119]] shipped the dynamic-skills arc that this deletes; recovering any
of it means `git revert` or reading history, which is accepted.

## Goal

One sweep leaves a repo whose only working app is avenCITY, whose `libs/` holds
two packages, and whose CI builds macOS/iOS/Linux apps and deploys nothing.

**Completion condition:**

> `bun run lint`, `bun --cwd app run check` and `cargo check --manifest-path app/src-tauri/Cargo.toml` all exit 0; `ls libs` prints exactly `aven-board` and `aven-city`; `rg -il 'abagana|alberobello|better-auth|aven-db|deploy-relay|selectedNetwork' app libs scripts .github` prints nothing; `ARCHIVE/tauri-plugin-biometric/README.md` and `ARCHIVE/tauri-plugin-passkey/README.md` both exist and document RP ID + apple-app-site-association; and `bun run dev:app:mac` opens the Tauri window straight into avenCITY with no Select Network step

## Approach

**Extract first, then delete.** Every reference package is moved and documented
*before* anything is removed, so the deletion never has to be undone to recover
something. A half-done deletion does not build, so there is one checkpoint (after
step 3) and then a straight run to the end.

The reference packages are parked **unbuilt** — they are removed from the Cargo
workspace and are not expected to compile in place. Their value is the source
plus a README that explains how to wire them back. This is stated so a later
reader does not mistake them for live code.

Explicitly out of scope: rewriting avenCITY, extracting a new architecture,
changing the app icon or logo, and touching `main`. This card lands on a branch.

## Steps

1. **Park the biometric reference.** `git mv libs/tauri-plugin-self` and
   `libs/tauri-plugin-vault` → `ARCHIVE/tauri-plugin-biometric/`. Write its
   README: what Secure Enclave P-256 + ECDH gives you, the `PEER_ID_<device>`
   flow, that the network seed is hardcoded and must be parameterised on
   re-introduction, and how to register the plugin in `lib.rs` + `Cargo.toml`.
2. **Write the passkey reference.** `ARCHIVE/tauri-plugin-passkey/README.md`
   covering, for a native Tauri app: the **RP ID** and why it must equal the
   HTTPS domain; the `com.apple.developer.associated-domains` entitlement
   (`webcredentials:<domain>`); the exact
   `https://<domain>/.well-known/apple-app-site-association` JSON, its
   `application/json` content-type and no-redirect rule; the `webcredentials`
   `apps: ["<TEAMID>.<bundleid>"]` entry; and how to test locally against a
   deployed domain. Copy `app/src-tauri/ios-template/aven-os-app_iOS.entitlements`
   and the relevant part of `docs/deploy/ios-associated-domains-and-push.md` in
   beside it.
3. **Checkpoint — stop and look.** Both READMEs reviewed by a human before a
   single deletion happens. Nothing has been removed yet, so this is the last
   cheap moment to add to the reference packages.
4. **Delete the mainnet world.** `libs/betterauth`, `libs/aven-skills`,
   `libs/aven-vibes`, `libs/aven-ontology`, `libs/aven-schema`, `libs/aven-voice`,
   `libs/aven-website`, plus `app/src/lib/{auth,billing,data,vault,fly,net,query,composer,draw,gallery,llm,tts,asr,voice,embed,ingestor,intents,intent-mock,brain,docs,sandbox}` and the routes they serve.
5. **Delete the testnet world.** `libs/aven-db`, `libs/aven-caps`, `libs/aven-p2p`,
   `libs/aven-node`, `libs/aven-brain`, `libs/aven-ai`,
   `libs/tauri-plugin-sandbox-quickjs`, plus `app/src/lib/{avendb,identities,peer,settings,runtime,tauri,debug}` and their routes.
6. **Delete the picker.** `app/src/lib/settings/network*.ts`,
   `NetworkSelect.svelte`, `AvenCityWorld.svelte`'s exit button; `+layout.svelte`
   renders `<AvenCityGame />` directly.
7. **Strip the Tauri crate.** Remove `aven-db`, `aven-brain`, `aven-caps`,
   `aven-p2p`, `aven-ai`, `tauri-plugin-self`, `tauri-plugin-vault`,
   `tauri-plugin-sandbox-quickjs`, `tauri-plugin-google-auth` from
   `app/src-tauri/Cargo.toml` and their `.plugin(...)` lines from `lib.rs`.
8. **Strip the server CI and scripts.** Delete
   `.github/workflows/deploy-aven-server-mini.yml` and the `deploy-relay` +
   `deploy-auth` jobs from `release-next.yml`; keep `release`, `release-macos`,
   `release-ios`, `release-linux` and `commitlint.yml`. Delete
   `scripts/{aven-server,deploy-aven-node-sprite,ensure-sidecar,fetch-onnxruntime,fetch-webcm}.ts`,
   `scripts/{revendor-aven-db,verify-aven-db-gates,build-sherpa-ios}.sh` and
   `scripts/moss-tts-nano-tokenizer.py`, and their `package.json` entries.
9. **Prune the manifests.** Root + app `package.json` dependencies and scripts;
   drop `docs:words` from `app`'s `check` if `docs/` no longer ships a package.
10. **Green the gates**, then run the mac dev app and confirm it opens into the
    island.

## Files to touch

- `ARCHIVE/tauri-plugin-biometric/**` — new home for `tauri-plugin-self` + `tauri-plugin-vault`, with README.
- `ARCHIVE/tauri-plugin-passkey/README.md` — new; RP ID + AASA + entitlements scaffolding.
- `ARCHIVE/README.md` — update the table to describe both as reference packages.
- `libs/` — everything except `aven-board/` and `aven-city/` is deleted or moved.
- `app/src/routes/**` — all route groups except the root layout are deleted.
- `app/src/lib/**` — reduced to `assets/` (fonts), `ui/AvenLogo.svelte`, and whatever the game needs.
- `app/src/routes/+layout.svelte` — renders the game directly; no picker branch.
- `app/src-tauri/Cargo.toml`, `app/src-tauri/src/lib.rs` — drop deleted crates and plugin registrations.
- `.github/workflows/release-next.yml` — drop `deploy-relay` + `deploy-auth`.
- `.github/workflows/deploy-aven-server-mini.yml` — delete.
- `scripts/**`, `package.json`, `app/package.json` — prune to app-build only.
- **Untouched on purpose:** `app/src-tauri/icons/**`, `app/static/aven-logo.svg`, `app/static/app-icon.png`, `app/static/favicon.png`, `scripts/generate-app-icons.ts`, `libs/aven-board/**`, `libs/aven-city/**`.

## Acceptance criteria

- [ ] `libs/` holds exactly two packages — proven by `ls libs` printing `aven-board` and `aven-city` only.
- [ ] No dead references to either world remain — proven by `rg -il 'abagana|alberobello|better-auth|aven-db|deploy-relay|selectedNetwork' app libs scripts .github` printing nothing.
- [ ] Frontend gates green — proven by `bun --cwd app run check` and `bun run lint` exiting 0.
- [ ] Rust builds without the deleted crates — proven by `cargo check --manifest-path app/src-tauri/Cargo.toml` exiting 0.
- [ ] The app opens straight into avenCITY — proven by `bun run dev:app:mac` logging `[perf] map … tiles` with no Select Network screen, plus a screenshot.
- [x] Biometric reference is parked and explained — proven by `find ARCHIVE/tauri-plugin-biometric -name '*.rs' | wc -l` → **20**, and `rg -c 'network seed' ARCHIVE/tauri-plugin-biometric/README.md` → **2**.
- [x] Passkey reference documents the domain contract — proven by `rg -io 'apple-app-site-association|webcredentials|RP ID' ARCHIVE/tauri-plugin-passkey/README.md | sort -u` → all **3/3**.
- [ ] App release CI survives, server CI does not — proven by `rg -c 'release-macos|release-ios|release-linux' .github/workflows/release-next.yml` returning 3 and `rg -l 'deploy-relay|deploy-auth|sprite|fly' .github/workflows/` printing nothing.
- [ ] The icon and logo are untouched — proven by `git diff --stat next -- app/src-tauri/icons app/static/aven-logo.svg app/static/app-icon.png app/static/favicon.png` being empty. (Baseline is `next`, NOT `main`: `main` predates the brain-icon work, so diffing against it would always show a change.)

## Verification

```bash
ls libs
rg -il 'abagana|alberobello|better-auth|aven-db|deploy-relay|selectedNetwork' app libs scripts .github
bun run lint
bun --cwd app run check
cargo check --manifest-path app/src-tauri/Cargo.toml
rg -i 'apple-app-site-association|webcredentials|RP ID' ARCHIVE/tauri-plugin-passkey/README.md
rg -l 'deploy-relay|deploy-auth' .github/workflows/
git diff --stat next -- app/src-tauri/icons app/static/aven-logo.svg app/static/app-icon.png
bun run dev:app:mac   # window opens straight into the island
```

## Hand-off

```
/aven-build 0121
```

## Progress log

Newest entry first.

- `2026-07-31` — **Steps 1–2 done; stopped at the step-3 checkpoint.** Biometric parked (`libs/tauri-plugin-self` + `libs/tauri-plugin-vault` → `ARCHIVE/tauri-plugin-biometric/`, 20 `.rs` files) with a README covering the Secure-Enclave flow, the hardcoded network seed, re-registration steps, and the Linux `dev_insecure` caveat. Passkey README written covering RP ID, the associated-domains entitlement, and the exact AASA file + its content-type/no-redirect/no-`.json` rules, plus the `?mode=developer` cache bypass and why `localhost` cannot be an RP ID. **Spec correction:** the card assumed `ARCHIVE/tauri-plugin-passkey` was an existing plugin to preserve — it was 2 394 tracked files / 115 MB of `swift-lib/.build` output with **no source ever committed**. Deleted the build output; the reference is documentation + the real entitlements file. Nothing else deleted yet — no world, lib, script or workflow has been touched.

- `2026-07-31` — Discovery: goal is a clean seed to rebuild from, not a product or a cost cut. Confirmed picker deleted, board kept, passkey reference is native+domain scaffolding only. Found that both keepers live inside the deletions, so the card leads with extraction and puts the human checkpoint before the first deletion. Moved ideate → discover.

---
title: 'Composer deploy to Tigris — HITL-gated publish from chat'
summary: A `deploy_website` chat tool that, on a HITL confirm, has the betterauth server reuse buildSite(src) and upload the site to the live www.next.aven.ceo Tigris bucket (admin-gated; creds in the server env)
owner: build agent (composer / board 0057 lineage)
created: 2026-06-21
updated: 2026-06-21
tags: [composer, deploy, betterauth, tigris]
# goal — the upload LOGIC is the measurable heart (deploySite against an injected storage, no real
# creds needed); the HITL routing + admin gate are grep/handler-provable; the LIVE deploy is HITL.
goal: "`bun test skills/composer/tests/publish.test.ts` exits 0 — proving `deploySite(SEED_SRC, storage, { host })` builds via `buildSite` and uploads the FULL assembled key set (per-locale home/blog/article pages + their slash-key aliases, `styles.css`, `404.html`, `sitemap.xml`, `robots.txt`) to the INJECTED storage, with `${BASE_URL}` resolved to the host (the uploaded `en/index.html` contains the host in its canonical link), deterministically; AND `deploy_website` is in `COMPOSER_TOOLS`, the `ai.ts` tool loop routes it through the HITL confirm gate (emits `aven_hitl`, does NOT upload inline), and the confirm handler is admin-gated — `grep -q \"deploy_website\" skills/composer/tools.ts`, `grep -q \"aven_hitl\" libs/betterauth/src/ai.ts` in the deploy branch, an admin check in `aiConfirmAction`; AND `cd skills && bun run check`, `cd libs/betterauth && bun run check`, `cd app && bunx svelte-check --tsconfig ./tsconfig.json` exit 0; AND `bunx biome check` clean on touched files."
---

# Composer deploy to Tigris — HITL-gated publish from chat

## Context

Board 0057 made the composer a real SSG: `buildSite(src)` assembles the deployable `public/` key
map (per-locale pages, slash-keys, 404, sitemap) — used identically by the preview and (now) the
deploy. What's missing is **publishing**: pushing that assembled site to the live web.

**This card** wires a **HITL-gated publish from chat**. The user asks to publish; a `deploy_website`
tool fires; a confirm card appears (*"Publish to www.next.aven.ceo?"*); on confirm the **betterauth
server** — which holds the Tigris credentials in its env — reuses `buildSite(src)` and uploads the
site to the **live `www.next.aven.ceo` Tigris bucket** (the existing `dark-wind-6797` bucket). It
reuses the 0055 HITL machinery (`aven_hitl` + `/api/ai/confirm`), exactly like the delete-confirm.

Decisions locked in discovery (2026-06-21):
- **Credentials on betterauth (server env):** the Fly-Tigris S3 vars — `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` (`https://fly.storage.tigris.dev`), `AWS_REGION`
  (`auto`), `BUCKET_NAME` (`dark-wind-6797`) — plus `SITE_HOST` (default `https://www.next.aven.ceo`).
  **Now wired** into the worktree `.env.samuel` (copied from main; gitignored). The publish code maps
  these to the `@storagesdk` adapter (tigris/s3 reads `AWS_*`/endpoint/`BUCKET_NAME`); absent creds →
  a clear "deploy not configured" error so the build/test never needs live creds.
- **Direct to live** on confirm (the confirm card IS the gate; the existing `deploy.ts` auto-snapshots
  each live deploy, so a bad publish is rollback-able). Fork-preview-then-promote is a later option.
- **Admin-role-gated** (reuse the same gate as `/api/admin/set-tier`). Per-user buckets + the
  `avenFOUNDER`/`avenCEO` tier-gate come later.
- **Stateless HITL:** the `deploy_website` `aven_hitl` action carries the spark's `src` (the server
  already received it as `body.publicFiles`); on confirm the server builds + uploads `action.src`.
  No server-side pending store (simplest; the payload is small).

## Goal

From chat, an admin can publish the composer site to the live `www.next.aven.ceo` bucket behind a
single HITL confirm; the server reuses `buildSite` and uploads via `@storagesdk`.

**Completion condition** (identical to frontmatter `goal`):

> `bun test skills/composer/tests/publish.test.ts` exits 0 — `deploySite(SEED_SRC, storage, { host })`
> uploads the full assembled key set (per-locale pages + slash-keys, `styles.css`, `404.html`,
> `sitemap.xml`, `robots.txt`) to the injected storage with `${BASE_URL}`→host; AND `deploy_website`
> is advertised + routes through the HITL confirm gate (`aven_hitl`, not inline) with an admin-gated
> confirm handler; AND `skills` + `betterauth` checks + app `svelte-check` exit 0; AND biome clean.

## Approach

- `skills/composer/publish.ts` (**new**, pure): `deploySite(src, storage, opts)` —
  `buildSite(src, { baseUrl: opts.host })` → for each object `storage.upload(key, body, {
  contentType, cacheControl })`. `storage` is a STRUCTURAL type (`{ upload(...) }`) so the real
  `@storagesdk` Storage and a test mock both satisfy it — fully testable without real creds. Returns
  `{ count, url }`.
- `skills/composer/tools.ts`: add `DEPLOY_WEBSITE_TOOL` (name `deploy_website`) to `COMPOSER_TOOLS`.
- `libs/betterauth/src/ai.ts`:
  - tool loop: a `deploy_website` branch that does NOT upload inline — it emits `aven_hitl`
    `{ tool:'deploy_website', label:'Publish to www.next.aven.ceo', action:{ src: turnFiles, host } }`
    and pushes a tool result ("awaiting your confirmation").
  - `aiConfirmAction`: handle a `deploy_website` action — **admin-gate** (reuse the `/api/admin/set-tier`
    check); build a Storage from the env creds (map BUCKET_NAME/AWS_* → the @storagesdk tigris/s3 adapter) (clear
    error if unconfigured); `deploySite(action.src, storage, { host })`; return `{ url, count }`.
- `app`: the existing generic `aven_hitl` card already renders + confirms `deploy_website` (no new UI
  needed); add `deploy_website` to the chat system prompt so the model knows to call it on "publish".

Trade-off: the live upload (network) isn't unit-tested (no creds in CI) — but the deploy LOGIC is,
via the injected mock storage, and the live publish is the HITL review step.

## Steps

1. `publish.ts` — `deploySite(src, storage, opts)` (structural storage type) + `cacheControl`.
2. `tools.ts` — `DEPLOY_WEBSITE_TOOL` → `COMPOSER_TOOLS`; export `deploySite` from `index.ts`.
3. `tests/publish.test.ts` — mock storage records uploads; assert the key set + host substitution + count.
4. `ai.ts` tool loop — `deploy_website` branch emits `aven_hitl` (src + host), no inline upload.
5. `ai.ts` `aiConfirmAction` — admin-gate + Storage from env (AWS_*/BUCKET_NAME) + `deploySite` + return url.
6. System prompt — teach the model to call `deploy_website` on "publish/deploy/go live".

## Files to touch

- `skills/composer/publish.ts` — **new**: `deploySite`.
- `skills/composer/tools.ts`, `skills/composer/index.ts` — `deploy_website` tool + export.
- `skills/composer/tests/publish.test.ts` — **new**: the metric.
- `libs/betterauth/src/ai.ts` — deploy branch (HITL) + admin-gated confirm handler.
- `app/src/lib/shell/MainnetChat.svelte` — system prompt mentions `deploy_website` (+ nicer label, optional).
- `.env.samuel` (worktree) — AWS_*/BUCKET_NAME/SITE_HOST: DONE (copied from main). The Fly betterauth prod env still needs them set.

## Acceptance criteria

- [x] `deploySite(SEED_SRC, mock, { host })` uploads the full assembled key set (per-locale pages +
  slash-keys, `styles.css`, `404.html`, `sitemap.xml`, `robots.txt`) to the injected storage (test).
- [x] The uploaded `en/index.html` body has `${BASE_URL}` resolved to the host (canonical link) and
  the returned `count` matches the object count; deterministic (test).
- [x] `bun test skills/composer/tests/publish.test.ts` exits 0 (4 pass / 0 fail).
- [x] `deploy_website` is in `COMPOSER_TOOLS` (`grep`); the `ai.ts` deploy branch emits `aven_hitl`
  and does NOT call `deploySite`/`storage.upload` inline (HITL-routed — proven by the awk scan).
- [x] `aiConfirmAction` handles `deploy_website` and is **admin-gated** (`role !== 'admin'` → 403,
  the same check as `aiSetTier`); builds the Storage from `tigrisStorageFromEnv()` (503 if unconfigured).
- [x] `cd skills && bun run check`, `cd libs/betterauth && bun run check`, `cd app && bunx
  svelte-check --tsconfig ./tsconfig.json` exit 0; `bunx biome check` exits 0 on touched files.
- [x] App boots clean: betterauth loads `@avenos/skills/composer/publish` (+ `@storagesdk`) with no
  import error, and the `AWS_*`/`BUCKET_NAME` creds are present in the server env.
- [ ] (HITL, review) Live: an admin says "publish" in chat → the confirm card → confirm →
  `https://www.next.aven.ceo/en/` serves the new site (non-admin: 403, no deploy).

## Verification

```bash
bun test skills/composer/tests/publish.test.ts            # the metric (mock storage)
cd skills && bun run check
cd libs/betterauth && bun run check
cd app && bunx svelte-check --tsconfig ./tsconfig.json
bunx biome check skills/composer libs/betterauth/src/ai.ts
grep -q "deploy_website" skills/composer/tools.ts && echo "tool advertised ✓"
# then in-app (review/HITL, needs the AWS_*/BUCKET_NAME env): "publish my site" → confirm → check www.next.aven.ceo
```

## Hand-off

```
/aven-build 0058
```

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
Newest entry first.

- `2026-06-21` — **Built (build → review).** `skills/composer/publish.ts`: `deploySite(src, storage,
  {host})` (reuses `buildSite`, uploads each object; structural storage type → testable with a mock)
  + `tigrisStorageFromEnv()` (constructs a `@storagesdk` tigris adapter from the Fly-Tigris
  `AWS_*`/`BUCKET_NAME`/`AWS_ENDPOINT_URL_S3` env) + `deployHost()`. Exposed via a server-only
  `@avenos/skills/composer/publish` subpath (kept OFF the composer barrel so the browser preview
  never pulls `@storagesdk`). `DEPLOY_WEBSITE_TOOL` added to `COMPOSER_TOOLS`. `ai.ts`: a
  `deploy_website` tool branch that emits `aven_hitl` (carrying the spark's `src` + host) instead of
  uploading inline; `aiConfirmAction` handles the confirm — admin-gated (`role !== 'admin'` → 403),
  builds the Storage from env (503 if unconfigured), `deploySite`, returns the live URL. System
  prompt teaches the model to call `deploy_website` on "publish". Creds copied into the worktree
  `.env.samuel`. Metric `publish.test.ts` = 4 pass / 0 fail; skills + betterauth tsc 0, app
  svelte-check 0 errors, biome 0; betterauth boots with the deploy code + creds, no import error.
  Fixed a `*/`-in-JSDoc that closed a comment early. Live publish is the HITL review step.

- `2026-06-21` — Discovery: interviewed the goal. Locked: HITL-gated `deploy_website` chat tool;
  betterauth holds the Tigris creds (env, not yet in `.env.samuel`); direct-to-live on confirm
  (snapshot-backed); admin-gated; stateless HITL (action carries `src`); reuse `buildSite` +
  `@storagesdk`. Metric = `deploySite` against an injected mock storage (no live creds needed); live
  publish is the HITL review. Follow-on to 0057. Created directly in `discover/`.

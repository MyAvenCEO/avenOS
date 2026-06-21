---
title: '@avenos/skills/composer: deterministic SSG + routing-faithful preview (one skill SDK)'
summary: Unify website+composer into one @avenos/skills package; the composer sub-skill owns generate/edit logic as an SDK; the vibe + chat are thin adapters; the in-app preview navigates byte-identically to the deployed Tigris+edge routing
owner: build agent (composer / board 0055 lineage)
created: 2026-06-21
updated: 2026-06-21
tags: [composer, skills, mainnet, static-site]
# goal — provable from command output. The routing CORRECTNESS (a pure generator + resolver) is
# the measurable heart; the package move + thin-adapter rewire are proven by grep + the checks.
goal: "`bun test skills/composer/tests/site-generator.test.ts` exits 0 — proving `buildSite` is deterministic (incl. `${BASE_URL}` resolution) and `resolveRoute` returns `/`→302 `/en/`, `/en`→301 `/en/`, `/en/`→200 `en/`, `/en/blog/`→200 `en/blog/`, `/styles.css`→200, `/nope`→404 `404.html`; AND `cd skills && bun run check` and `cd libs/betterauth && bun run check` exit 0; AND `cd app && bunx svelte-check --tsconfig ./tsconfig.json` reports 0 errors; AND `bunx biome check` is clean on touched files; AND every Acceptance criterion below is checked (the `@avenos/skills` package exists and `editWebsiteDiff`/`COMPOSER_AUTHORING_GUIDE`/`buildSite` resolve from `@avenos/skills/composer`, with zero `skills/website` references remaining)."
---

# @avenos/skills/composer — deterministic SSG + routing-faithful preview

## Context

The mainnet/Alberobello **composer** (board 0055) lets a user build a static website by
chatting (the GLM `edit_website` tool writes locale-routed files under a spark's `public/`).
The site is hosted the **next.aven.ceo way**: a Tigris bucket serves every byte (slash-keys
`en/`, `en/blog/` + `index.html` fallbacks, `404.html`, `robots.txt`, `sitemap.xml`) and a tiny
Fly edge door does `/`→`/en/` and `/en`→`/en/`. The hosting/deploy contract is
`skills/website/README.md` + `skills/website/deploy.ts` (builds the full key→object map, uploads
via `@storagesdk`).

**Two problems:**
1. The composer preview uses a sandboxed `srcdoc` iframe showing ONE page with no routing —
   clicking `/en/blog/` does nothing, `/`→`/en/` never happens. So it does **not** behave like
   the deployed site, and the generation logic is duplicated/implicit, not one function.
2. The composer's logic is scattered: `editWebsiteDiff` lives in `libs/betterauth/src/ai.ts`, the
   tool schemas in `libs/aven-vibes/src/composer-tools.ts`, the deploy/SSG-contract in
   `skills/website/`. There is no single SDK that both the in-app preview and the server deploy
   call.

**This card (slice 1 of 2):** create one workspace package **`@avenos/skills`** (future code-skills
live here) whose **`composer` sub-skill** (`@avenos/skills/composer`) owns the composer logic as an
SDK — the deterministic generator, the GLM edit, the authoring guide. The vibe and the chat tool
loop become **thin adapters** that call it. The preview runs a local router off the SAME generator
output so it navigates byte-identically to Tigris+edge. No credentials, no network — unit-verifiable.

Decisions locked in discovery (2026-06-21):
- **Preview fidelity = full click-through routing** (mimics edge+Tigris exactly).
- **Separation of concerns:** GLM edits **source content files only** (`public/en/…html`,
  `public/styles.css`) and references absolute URLs through a single **`${BASE_URL}` placeholder**; it
  must NOT emit routing artifacts (slash-keys, no-slash stubs, `index.html` fallbacks, `404.html`,
  `robots.txt`, `sitemap.xml`, canonical/hreflang) — those are 100% the generator's job (README §2).
- **`${BASE_URL}` placeholder:** GLM writes `${BASE_URL}` for any absolute reference (canonical, og:image)
  and root-absolute `/en/…` for internal nav. `buildSite(source, { baseUrl })` substitutes
  `${BASE_URL}`→`baseUrl` deterministically: **preview** baseUrl = the preview origin (links resolve in
  the iframe); **deploy** baseUrl = `https://www.next.aven.ceo` (per-user host later). Same source,
  both instances correct; GLM never knows the host.
- **SDK home = `@avenos/skills`** (new workspace package), composer sub-skill at
  `skills/composer/`, exported as `@avenos/skills/composer`. Add `"skills"` to root `workspaces`.
- **Slice 1 merge:** move `buildSite`/`resolveRoute` + `editWebsiteDiff` + `COMPOSER_AUTHORING_GUIDE`
  + the tool schemas into the SDK; `ai.ts` and the vibe become thin adapters. **Deploy** (`deploy()`
  via `buildSite` + the admin-gated betterauth endpoint + HITL "Publish to www?") = follow-on 0057.
- **Deploy model (0057):** aven manages every bucket server-side; a bucket **per user** eventually.
  MVP = **one** bucket, edit/deploy gated to the **admin role** (the `avenFOUNDER`/`avenCEO`
  tier-gate arrives with per-user buckets).

## Goal

One `@avenos/skills/composer` SDK owns the composer logic; the vibe + chat are thin adapters; the
in-app preview navigates exactly like the deployed Tigris+edge site.

**Completion condition** (identical to frontmatter `goal`):

> `bun test skills/composer/tests/site-generator.test.ts` exits 0 — proving `buildSite` is
> deterministic (incl. `${BASE_URL}` resolution) and `resolveRoute` returns `/`→302 `/en/`, `/en`→301
> `/en/`, `/en/`→200 `en/`, `/en/blog/`→200 `en/blog/`, `/styles.css`→200,
> `/nope`→404 `404.html`; AND `cd skills && bun run check` and `cd libs/betterauth && bun run check`
> exit 0; AND `cd app && bunx svelte-check --tsconfig ./tsconfig.json` reports 0 errors; AND `bunx
> biome check` is clean on touched files; AND every Acceptance criterion below is checked.

## Approach

**Create `@avenos/skills`** (`skills/package.json`, added to root `workspaces`), with the composer
sub-skill at `skills/composer/` exported via `"./composer"`. It is a PURE SDK on the generator/guide
side (no DOM/Storage) so the app preview, the betterauth server, and `aven-vibes` can all import it;
`editWebsiteDiff` reads `TINFOIL_*` from `process.env` (runs in the betterauth process).

`skills/composer/` layout:
- `site-generator.ts` — `buildSite(source, opts)` → the deterministic deploy/preview key→object map
  (README §2: each `public/<rel>` minus `public/`; a slash-key alias for every `.../index.html`;
  `404.html`; root `index.html` redirect to `/<defaultLocale>/`; `${BASE_URL}` substituted from
  `opts.baseUrl`). `resolveRoute(path, keys, opts)` → the edge+Tigris router (200 key / 301-302
  redirect / 404).
- `edit.ts` — `editWebsiteDiff` + `parseEditBlocks` (moved verbatim from `ai.ts`).
- `authoring.ts` — `COMPOSER_AUTHORING_GUIDE` (compact source-authoring contract for the prompt).
- `tools.ts` — `SHOW_WEBSITE_TOOL`, `EDIT_WEBSITE_TOOL`, `COMPOSER_TOOLS` (moved from
  `aven-vibes/composer-tools.ts`).
- `index.ts` — barrel re-export.
- `deploy.ts`, `edge/`, `README.md` — moved from `skills/website/` (the architecture SSOT;
  `deploy.ts`'s refactor to call `buildSite` is 0057).
- `tests/site-generator.test.ts` — the metric.

**Thin adapters:**
- `libs/betterauth/src/ai.ts` — import `editWebsiteDiff` + `COMPOSER_AUTHORING_GUIDE` from
  `@avenos/skills/composer`; the `edit_website` tool branch just calls them; the system prompt is
  rescoped to source-authoring and injects the guide. Add `@avenos/skills` dep.
- `libs/aven-vibes/src/tools.ts` — import `COMPOSER_TOOLS` from `@avenos/skills/composer`; delete
  `composer-tools.ts`. Add `@avenos/skills` dep.
- `app/src/lib/composer/Composer.svelte` — import `buildSite`/`resolveRoute` from
  `@avenos/skills/composer`; hold the live `source` map + `currentPath` (default `/en/`); render the
  resolved page into `srcdoc` (styles inlined, `${BASE_URL}`→preview origin) + a click-shim that
  `postMessage`s hrefs to the parent, which calls `resolveRoute` (following redirects) to update
  `currentPath`. Add `@avenos/skills` dep to `app`.

Trade-off: the preview navigation is DOM-driven and not unit-tested directly, but the routing logic
it depends on (`resolveRoute`) and `buildSite` are fully unit-tested, so correctness is provable and
the preview is a thin consumer. Out of scope (→ 0057): `deploy()` via `buildSite`, the admin-gated
betterauth deploy endpoint, Tigris credentials, per-user buckets, the HITL "Publish to www?" card,
the tier-gate.

## Steps

1. `skills/package.json` = `@avenos/skills` (private, type module, exports `{".": "./index.ts",
   "./composer": "./composer/index.ts"}`, deps `@storagesdk/core`/`@storagesdk/adapters`/
   `@tigrisdata/storage`, scripts `check`/`test`) + `skills/tsconfig.json`; add `"skills"` to root
   `workspaces`; `bun install`.
2. `git mv skills/website/* skills/composer/`; fix path refs (`deploy.ts` header, `README.md`
   self-refs, the two doc-comments in `tauri-fs-adapter.ts` + `composer-tools.ts`).
3. `skills/composer/site-generator.ts` — `buildSite` (incl. `${BASE_URL}` substitution from
   `opts.baseUrl`) + `resolveRoute`; `skills/composer/index.ts` barrel.
4. Move `editWebsiteDiff` + `parseEditBlocks` from `ai.ts` → `skills/composer/edit.ts` (read
   `TINFOIL_*` from env); move `COMPOSER_AUTHORING_GUIDE` content → `skills/composer/authoring.ts`;
   move the tool schemas → `skills/composer/tools.ts`; delete `aven-vibes/composer-tools.ts`.
5. Rewire adapters: `ai.ts` imports `editWebsiteDiff` + `COMPOSER_AUTHORING_GUIDE` and injects the
   guide into the (source-only) `edit_website` prompt; `aven-vibes/tools.ts` imports `COMPOSER_TOOLS`;
   add the `@avenos/skills` dep to `betterauth`, `aven-vibes`, `app`.
6. `Composer.svelte` — navigable preview off `buildSite`/`resolveRoute` (+ click-shim, styles inline).
7. `skills/composer/tests/site-generator.test.ts` — deterministic `buildSite` (incl. `${BASE_URL}`) +
   every `resolveRoute` case in the goal.

## Files to touch

- `skills/package.json`, `skills/tsconfig.json` — **new**: the `@avenos/skills` package.
- `package.json` (root) — add `"skills"` to `workspaces`.
- `skills/composer/site-generator.ts`, `index.ts`, `edit.ts`, `authoring.ts`, `tools.ts` — **new** /
  moved: the composer SDK.
- `skills/composer/{deploy.ts,edge/,README.md}` — moved from `skills/website/`.
- `skills/composer/tests/site-generator.test.ts` — **new**: the metric.
- `libs/betterauth/src/ai.ts` — thin adapter: import edit + guide; rescope the prompt; add dep.
- `libs/aven-vibes/src/tools.ts` — import `COMPOSER_TOOLS` from the skill; delete
  `libs/aven-vibes/src/composer-tools.ts`; add dep.
- `app/src/lib/composer/Composer.svelte` — navigable preview off the SDK; `app/package.json` add dep.

## Acceptance criteria

Each box must be checkable from the transcript (a command + its output proves it).

- [x] `buildSite` is deterministic — same input → identical sorted output, incl. `${BASE_URL}` resolved
  to `opts.baseUrl` (test).
- [x] `buildSite` owns routing — for a source map with none of them, the produced key set includes
  the slash-key aliases, `404.html`, and the root `/`→`/en/` redirect (test).
- [x] `resolveRoute` returns `/`→302 `/en/`, `/en`→301 `/en/`, `/en/`→200 `en/` (the Tigris-direct
  slash-key), `/en/blog/`→200 `en/blog/`, `/styles.css`→200, `/nope`→404 — proven by
  `bun test skills/composer/tests/site-generator.test.ts` (11 pass / 0 fail).
- [x] The package resolves: `cd skills && bun run check` exits 0; betterauth + the app import
  `@avenos/skills/composer` (and the app the pure `…/composer/site-generator` subpath) and tsc/svelte-check pass.
- [x] Logic moved, adapters thin: `grep -q "from '@avenos/skills/composer'" libs/betterauth/src/ai.ts`
  AND `! grep -q "async function editWebsiteDiff" libs/betterauth/src/ai.ts` AND
  `! test -f libs/aven-vibes/src/composer-tools.ts`.
- [x] GLM scoped to source-only: `COMPOSER_AUTHORING_GUIDE` is the website-model system prompt —
  `grep -q "COMPOSER_AUTHORING_GUIDE" skills/composer/edit.ts` — and the prompt instructs no routing
  mechanics (the guide's text forbids slash-keys/stubs/404/sitemap/robots).
- [x] Rename complete: no `skills/website` reference remains in code
  (`grep -rn "skills/website" --include='*.ts' --include='*.svelte' --include='*.rs' --include='*.json' .`
  excluding node_modules → none; the only mentions are in this card's prose).
- [x] `cd libs/betterauth && bun run check` exits 0; `cd app && bunx svelte-check --tsconfig
  ./tsconfig.json` reports 0 errors; `bunx biome check` exits 0 on touched files (only info-level
  `useTemplate` notes remain on the legacy `deploy.ts`, slice-2 territory).
- [x] App boots clean: betterauth + Vite ready, no `process` ReferenceError and no
  `effect_update_depth_exceeded` in the dev log (the white-screen regressions, fixed).
- [ ] (HITL, review) In-app composer preview navigates: clicking a nav link loads the target page;
  `/` shows the `/en/` home; a missing path shows the 404 page.

## Verification

```bash
bun test skills/composer/tests/site-generator.test.ts        # the metric
cd skills && bun run check                                    # @avenos/skills tsc
cd libs/betterauth && bun run check                           # adapter tsc
cd app && bunx svelte-check --tsconfig ./tsconfig.json        # 0 errors
bunx biome check skills/composer app/src/lib/composer/Composer.svelte   # exit 0 (infos only)
grep -q "from '@avenos/skills/composer'" libs/betterauth/src/ai.ts && \
  ! grep -q "async function editWebsiteDiff" libs/betterauth/src/ai.ts && \
  ! test -f libs/aven-vibes/src/composer-tools.ts && \
  grep -q "COMPOSER_AUTHORING_GUIDE" skills/composer/edit.ts && echo "adapters thin + guide wired ✓"
grep -rn "skills/website" --include='*.ts' --include='*.svelte' --include='*.rs' --include='*.json' . | grep -v node_modules   # → no matches
# then in-app (review/HITL): open the composer, click between pages, hit a bad URL → 404
```

## Hand-off

```
/aven-build 0056
```

…or hand the condition straight to the goal loop:

```
/goal bun test skills/composer/tests/site-generator.test.ts exits 0 (deterministic buildSite incl ${BASE_URL} + resolveRoute /→302 /en/, /en→301 /en/, /en/→200 en/, /en/blog/→200 en/blog/, /styles.css→200, /nope→404) AND skills + betterauth check AND app svelte-check 0 errors AND biome clean AND editWebsiteDiff/COMPOSER_AUTHORING_GUIDE resolve from @avenos/skills/composer AND no skills/website refs
```

## Follow-on (card to create in ideate/)

- **0057 — Composer admin-gated deploy to the aven bucket (betterauth + HITL).** Add `deploy()` to
  `@avenos/skills/composer` (refactor the moved `deploy.ts` to build via `buildSite`, `${BASE_URL}` →
  the deploy host); a betterauth `/api/composer/deploy` endpoint gated to the **admin role**; a HITL
  "Publish to www?" confirm card (reuse the `aven_hitl` gate from 0055); upload to ONE Tigris bucket
  via `@storagesdk`. Later: a bucket per user + the `avenFOUNDER`/`avenCEO` tier-gate.

## Progress log

Newest entry first.

- `2026-06-21` — **Built (build → review).** Created the `@avenos/skills` workspace package
  (`skills/` added to root `workspaces`) with the `composer` sub-skill SDK: `site-generator.ts`
  (`buildSite`/`resolveRoute` + `${BASE_URL}` substitution), `edit.ts` (`editWebsiteDiff` moved from
  `ai.ts`), `authoring.ts` (`COMPOSER_AUTHORING_GUIDE`, now the GLM system prompt), `tools.ts` (moved
  from `aven-vibes/composer-tools.ts`), `index.ts` barrel. `git mv skills/website → skills/composer`
  (deploy.ts/edge/README) + biome-formatted them. Rewired `ai.ts` + `aven-vibes/tools.ts` as thin
  adapters; `Composer.svelte` now drives a navigable preview off `buildSite`/`resolveRoute` (click
  shim → `resolveRoute`, styles inlined, address bar). All checks green: metric test 11/0, skills +
  betterauth tsc 0, app svelte-check 0 errors, biome exit 0. **Reality-vs-spec:** `resolveRoute`
  returns the Tigris-direct **slash-key** (`/en/`→`en/`), not the index.html fallback — updated the
  goal/acceptance to match. **Runtime fixes** (white-screen regressions caught by restarting the
  app): (1) the app imported the composer barrel which pulls server-only `edit.ts` (`process.env`) →
  added a browser-safe `@avenos/skills/composer/site-generator` subpath export and pointed the vibe
  at it; (2) the live-mirror `$effect` read+wrote `source` → wrapped the read in `untrack`. Also
  learned: a literal `</script>` anywhere in a `.svelte` file (even a comment) ends the block — the
  nav-shim tag name is assembled from a variable.
- `2026-06-21` — Architecture refined to a single SDK: `skills/` becomes the `@avenos/skills`
  workspace package; `composer` sub-skill (`@avenos/skills/composer`) owns generate/edit logic;
  vibe + chat are thin adapters. Added the `${BASE_URL}` placeholder (generator-resolved per instance).
  Slice 1 moves generator + `editWebsiteDiff` + guide + tool schemas into the SDK; deploy endpoint +
  HITL → 0057. Updated goal/steps/files/acceptance/verification.
- `2026-06-21` — Refined separation of concerns: GLM edits source files ONLY; the deterministic
  generator owns ALL routing (README §2). Added the compact `COMPOSER_AUTHORING_GUIDE` for the prompt
  and the `skills/website` → composer rename.
- `2026-06-21` — Discovery: interviewed the goal. Locked: full click-through preview routing; slice 1
  = generator + navigable preview only; deploy model = aven-managed buckets (per-user eventually),
  MVP one bucket gated to admin role (→ 0057). Wrote the spec with a unit-test-provable metric.
  Created directly in `discover/` (idea arrived fully-formed; no separate `ideate/` stub).

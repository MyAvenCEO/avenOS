---
title: 'Composer SSG v2 — components/layouts + markdown + i18n (src→build→public)'
summary: GLM maintains src/ (plain-HTML components/layouts, i18n JSON, pages/blog markdown); buildSite assembles public/ per-locale with a language switcher + blog index; reseed spark1 with a bilingual EN/DE example
owner: build agent (composer / board 0056 lineage)
created: 2026-06-21
updated: 2026-06-21
tags: [composer, skills, static-site, i18n]
# goal — provable from command output. The engine (assembly + md + i18n + per-locale fan-out) is
# the measurable heart, proven by a fixture→output unit test; the composer rewiring + reseed are
# HITL-verified in review.
goal: "`bun test skills/composer/tests/site-generator-v2.test.ts` exits 0 — proving that for a fixture `src/` (a `page` + `article` layout, `nav`/`footer` components, `en`+`de` i18n JSON, `en`+`de` `home.md`, and one bilingual blog article), `buildSite(src)` DETERMINISTICALLY assembles `public/`: per-locale home + blog-index + article pages each with their slash-key alias, and each home page contains (a) the nav markup from the included component, (b) that locale's i18n nav labels (en `Home`/`Blog`, de `Start`/`Blog`), (c) the rendered markdown body (a known phrase from `home.md`), and (d) an EN↔DE language switcher link to the same page in the other locale; the article page contains its frontmatter title + rendered markdown; plus `404.html`, `sitemap.xml`, and the `/`→`/en/` redirect; and `resolveRoute` resolves `/en/`, `/de/`, `/en/blog/`, `/en/blog/<slug>/`. AND `cd skills && bun run check` and `cd app && bunx svelte-check --tsconfig ./tsconfig.json` exit 0; AND `bunx biome check` is clean on touched files."
---

# Composer SSG v2 — components/layouts + markdown + i18n

## Context

Board 0056 shipped the composer's deterministic **routing** generator (`@avenos/skills/composer`:
`buildSite`/`resolveRoute`) + a routing-faithful preview. Today GLM still authors **full HTML per
page**, which doesn't scale to multi-page, multi-locale sites: the nav/footer are duplicated in
every page × every locale, and there's no clean place for articles or translated strings.

**This card** evolves the SSG to a real **source → build → output** model. GLM stops writing whole
HTML pages; it maintains a small `src/` of **plain-HTML components/layouts + markdown content + i18n
JSON**, and `buildSite` ASSEMBLES the deployable `public/` site (per-locale pages, a language
switcher, a blog index, routing). The preview and the deploy both run the same `buildSite(src)`, so
they stay byte-identical (the 0056 guarantee).

Decisions locked in discovery (2026-06-21):
- **Templating = minimal slots + engine-owned logic.** Components/layouts are plain HTML with
  `{{token}}` slots and `{{> partial}}` includes; markdown carries frontmatter (`title`, `date`,
  `layout`, `summary`). ALL logic — the blog-index loop, the EN/DE locale fan-out, active-nav, the
  language switcher — is hardcoded in `buildSite`. GLM never writes loops/conditionals. No
  template-language dependency; `marked` (already a repo dep via aven-vibes) renders markdown.
- **Source → build → output:** GLM maintains `src/` only; `buildSite` generates ALL of `public/`
  on save; `public/` is never hand-edited. Deploy + preview both consume `buildSite(src)`.
- **Reseed** `spark1` with a concrete **bilingual EN/DE** example (home + one blog article), built
  from the current site's look — deployable, GLM-editable, previewable.
- **Out of scope** (separate follow-on **0058**): the admin-gated Tigris **deploy** endpoint + HITL
  publish. This card stops at "the engine assembles `public/` and the composer previews it".

## Goal

One `buildSite(src)` engine assembles a multi-page, bilingual site from plain components + markdown +
i18n; the composer previews the generated output; `spark1` ships a working EN/DE example.

**Completion condition** (identical to frontmatter `goal`):

> `bun test skills/composer/tests/site-generator-v2.test.ts` exits 0 — for a fixture `src/`,
> `buildSite(src)` deterministically assembles per-locale home/blog-index/article pages (+ slash-keys)
> where each home contains the included nav, the locale's i18n labels (en `Home`/`Blog`, de
> `Start`/`Blog`), the rendered markdown body, and an EN↔DE switcher; the article has its frontmatter
> title + rendered markdown; plus `404.html`, `sitemap.xml`, `/`→`/en/`; and `resolveRoute` resolves
> `/en/`, `/de/`, `/en/blog/`, `/en/blog/<slug>/`. AND `cd skills && bun run check` and `cd app &&
> bunx svelte-check --tsconfig ./tsconfig.json` exit 0; AND `bunx biome check` clean on touched files.

## Approach

Rework `@avenos/skills/composer` so `buildSite`'s INPUT is the `src/` tree (not `public/` HTML), and
its OUTPUT is the same `public/` key→object map `resolveRoute` already understands (0056 routing is
reused unchanged). New pure modules in the skill (browser-safe — the app preview imports them):

- `src/` authoring contract (GLM-maintained):
  - `components/*.html` — partials with `{{token}}` slots (`nav.html`, `footer.html`,
    `article-card.html`). `nav.html` carries the `{{lang_switcher}}` + i18n `{{t.nav.*}}` slots.
  - `layouts/*.html` — page skeletons: `page.html` (home/landing), `article.html` (blog post).
    They include partials (`{{> nav}}`) and a `{{content}}` slot.
  - `i18n/<locale>.json` — `{ "title": …, "nav": { "home": …, "blog": … } }`.
  - `pages/<locale>/<name>.md` — frontmatter (`title`, `layout: page`) + body.
  - `blog/<locale>/<slug>.md` — frontmatter (`title`, `date`, `summary`, `layout: article`) + body.
  - `styles.css`.
- Engine (`buildSite`, deterministic, hardcoded):
  1. Parse frontmatter (a tiny `--- … ---` YAML-subset parser; no dep) + render body via `marked`.
  2. Resolve `{{> partial}}` includes (recursively, with a depth cap) and `{{t.path}}` i18n tokens
     from the page's locale JSON; substitute page tokens (`{{title}}`, `{{date}}`, `{{content}}`).
  3. Apply the frontmatter `layout`. Emit one page per locale (locale fan-out).
  4. Generate the **language switcher** per page (links to the same logical path in each locale) and
     the **blog index** per locale (loop `blog/<locale>/*.md` → `article-card` component, sorted by
     date desc).
  5. Substitute `${BASE_URL}`; reuse the 0056 routing tail (slash-key aliases, `/`→`/<default>/`,
     `404.html`, `sitemap.xml`, `robots.txt`).
- `resolveRoute` is unchanged — it already resolves whatever keys `buildSite` emits.
- Composer (`Composer.svelte`): the file list + editor operate on `src/`; the preview = `buildSite(src)`
  rendered through the existing `resolveRoute` + iframe; "save" rewrites a `src/` file → rebuild.
- Reseed (`sparks.rs` + a seed module): replace `spark1`'s migrated page with the bilingual `src/`
  example; first-run migration moves any legacy `public/` page aside.

Trade-off: the markdown/i18n/assembly is bigger than 0056's routing, but it's all PURE and
fixture-testable, so correctness stays provable; the composer rewiring + reseed are the HITL part.

## Steps

1. `frontmatter.ts` — parse `--- … ---` (title/date/layout/summary) + return `{ data, body }`.
2. `assemble.ts` — `{{> partial}}` include resolution + `{{token}}`/`{{t.*}}` substitution (pure).
3. Rewrite `site-generator.ts` `buildSite(src, opts)`: md render (marked) → assemble → layout →
   per-locale fan-out → language switcher + blog index → 0056 routing tail. Keep `resolveRoute`.
4. Add `marked` to `skills/package.json` deps.
5. `tests/site-generator-v2.test.ts` — the fixture `src/` + all goal assertions.
6. `Composer.svelte` — read/preview `src/` (file list = src/, preview = buildSite(src)).
7. Reseed `spark1/src/` with the bilingual EN/DE example (layouts, components, i18n, home.md ×2,
   one article ×2, styles.css); migrate legacy `public/` aside.

## Files to touch

- `skills/composer/site-generator.ts` — `buildSite` v2 (src→public assembly); `resolveRoute` kept.
- `skills/composer/frontmatter.ts`, `skills/composer/assemble.ts` — **new** pure helpers.
- `skills/composer/seed.ts` — **new**: the bilingual `src/` example (shared by Rust seed + tests).
- `skills/composer/tests/site-generator-v2.test.ts` — **new**: the metric.
- `skills/package.json` — add `marked`.
- `app/src/lib/composer/Composer.svelte` — operate on `src/`, preview `buildSite(src)`.
- `app/src/lib/composer/active-spark.ts` — read `src/` files for the AI edit context.
- `app/src-tauri/src/sparks.rs` — seed `src/` instead of `public/en/index.html`.
- `libs/betterauth/src/ai.ts` (+ `skills/composer/authoring.ts`) — update the GLM guide to the new
  `src/` contract (write markdown + components + i18n; never hand-write `public/`).

## Acceptance criteria

Each box checkable from the transcript.

- [x] `buildSite(src)` is deterministic — same fixture `src/` → identical sorted output (test).
- [x] Per-locale fan-out: output has `en/index.html`+`en/`, `de/index.html`+`de/`,
  `en/blog/index.html`+`en/blog/`, `en/blog/<slug>/index.html`+`en/blog/<slug>/`, `de/…` (test).
- [x] Assembly: `en/index.html` contains the nav component markup, the EN labels (`Home`/`Blog`),
  the rendered `home.md` body (a known phrase), and a `/de/` switcher link; `de/index.html` has DE
  labels (`Start`/`Blog`) + a `/en/` link (test).
- [x] Article: `en/blog/<slug>/index.html` contains the frontmatter `title` + rendered markdown;
  the blog index lists it via the `article-card` component (test).
- [x] Routing tail present + resolvable: `404.html`, `sitemap.xml`, `/`→`/en/`; `resolveRoute`
  returns 200 for `/en/`, `/de/`, `/en/blog/`, `/en/blog/<slug>/` and 404 for a bad path (test).
- [x] `bun test skills/composer/tests/site-generator-v2.test.ts` exits 0 (14 pass / 0 fail).
- [x] `cd skills && bun run check` exits 0; `cd app && bunx svelte-check --tsconfig ./tsconfig.json`
  reports 0 errors; `bunx biome check` exits 0 on touched files.
- [x] App boots clean (Rust compiles, betterauth + Vite up, no client errors) and `spark1/src/`
  auto-seeds the 12-file bilingual example on first composer/chat load.
- [ ] (HITL, review) In-app: the composer lists `src/` files; editing `home.md` or adding an article
  updates the preview; the EN↔DE switcher swaps nav labels + content; a bad URL shows 404.

## Verification

```bash
bun test skills/composer/tests/site-generator-v2.test.ts   # the metric
cd skills && bun run check                                 # @avenos/skills tsc
cd app && bunx svelte-check --tsconfig ./tsconfig.json     # 0 errors
bunx biome check skills/composer app/src/lib/composer/Composer.svelte
# then in-app (review/HITL): edit a .md, add an article, toggle EN/DE, hit a bad URL
```

## Hand-off

```
/aven-build 0057
```

…or the goal loop directly:

```
/goal bun test skills/composer/tests/site-generator-v2.test.ts exits 0 (deterministic buildSite(src): per-locale home/blog-index/article with slash-keys, nav include, i18n labels en Home/Blog + de Start/Blog, rendered markdown, EN↔DE switcher, 404 + sitemap + /→/en/, resolveRoute /en/ /de/ /en/blog/ /en/blog/<slug>/) AND skills + app checks AND biome clean
```

## Follow-on

- **0058 — Composer admin-gated deploy to the aven bucket (betterauth + HITL).** Reuse `buildSite(src)`
  server-side; upload `public/` to ONE Tigris bucket via `@storagesdk`; gate to the admin role; HITL
  "Publish to www?" card (reuse the `aven_hitl` gate). (This was sketched as the 0056 follow-on; SSG
  v2 took 0057, so deploy becomes 0058.)

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
Newest entry first.

- `2026-06-21` — **Built (build → review).** Engine: `frontmatter.ts` (YAML-subset parser),
  `assemble.ts` (`{{> include}}` + `{{token}}`/`{{t.*}}` substitution, no template language),
  rewrote `buildSite` to take `src/` → assemble per-locale pages (layout + `marked` markdown + i18n),
  generate the language switcher + blog index, keep the 0056 routing tail/`resolveRoute`; added
  `marked` dep + `localesOf` + `en`-preferring default locale. `seed.ts` = the bilingual EN/DE
  example (shared by the test fixture + the app seeding). Rewired the app: `Composer.svelte` lists +
  previews `src/` via `buildSite(src)` (locales passed to `resolveRoute`); `active-spark.ts` adds
  `readSrcFiles`/`writeSrcFiles`/`ensureSeeded`; `MainnetChat` edits `src/`; `edit.ts` retargeted to
  `src/`; the authoring guide rewritten to the `src/` contract; `sparks.rs` just ensures dirs (the app
  seeds `src/` from `SEED_SRC`). Metric `site-generator-v2.test.ts` = 14 pass / 0 fail; skills +
  betterauth tsc 0, app svelte-check 0 errors, biome 0, betterauth + aven-vibes tests 0 fail. App
  boots clean; `spark1/src/` auto-seeded the 12-file example. Removed the superseded v1 routing test.
- `2026-06-21` — Discovery: interviewed the architecture. Locked: source→build→output model; minimal
  `{{token}}`/`{{> include}}` templating with ALL logic engine-owned (no template-language dep, GLM
  writes plain HTML + markdown); markdown via `marked`; per-locale fan-out + language switcher + blog
  index generated; reseed `spark1/src/` bilingual EN/DE. Wrote the spec with a fixture→output
  unit-test metric. Follow-on to 0056; deploy split to 0058. Created directly in `discover/`.

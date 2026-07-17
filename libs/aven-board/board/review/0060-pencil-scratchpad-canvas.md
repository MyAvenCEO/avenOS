---
title: Apple Pencil scratchpad — a /draw main (in-memory, web canvas)
summary: A new top-level "Draw" main — one big web canvas optimized for Apple Pencil on iPad, with pen, eraser, and basic select. In-memory only, no persistence.
owner: unassigned
created: 2026-07-01
updated: 2026-07-01
tags: [app-ui, ipad]
goal: "From app/: `bun run check` exits 0 and `bun test tests` passes incl. new app/tests/sketch-model.test.ts (add-stroke, whole-stroke erase-on-hit, rect-select, move-selection). Scoped `biome check` over the 0060 files exits 0 (repo-wide `bun run lint` is pre-existing-red — out of scope). The /draw main is wired into desktop + mobile nav and renders DrawCanvas. No persistence, avenDB, or schema changes (git diff touches no libs/aven-schema/** or app/src-tauri/**)."
---

# Apple Pencil scratchpad — a `/draw` main (in-memory, web canvas)

## Context

The user wants a minimalistic handwritten-notes + freeform-sketch surface optimized
for Apple Pencil on iPad — "grab pencil, sketch a mockup or jot an idea, glance at it
later." Discovery pinned the real goal as **A: a scratchpad / thinking surface** —
speed-to-first-stroke is everything, it mostly never leaves the iPad, organization
barely matters.

The iPad build itself already exists (universal `.ipa`; board work on
`claude/ipad-ci-deploy-strategy-eyshox`). Apple Pencil in the Tauri WKWebView delivers
`PointerEvent`s with `pressure`/`tilt` and `getCoalescedEvents()`, so a **web canvas can
be pencil-optimized without any native code** — the pragmatic minimal path.

Codebase facts that shape this (from exploration):
- **Mains are static SvelteKit routes** under `app/src/routes/*`, with active-state +
  nav entries in exactly two files: `app/src/routes/+layout.svelte` (desktop nav) and
  `app/src/lib/shell/MobileShellNav.svelte` (mobile nav). Adding `/draw` is that pattern.
- **No drawing/canvas primitives exist** anywhere — greenfield.
- i18n labels resolve via `t('nav.x')` against `app/languages/{en,de}.json`; a missing
  key falls back to the key string (non-fatal).

### Decisions locked in discovery (load-bearing)
- **Scope:** pen + eraser + **basic** select. **No** multi-note list/sidebar.
- **Canvas:** one **big fixed** canvas (viewport-filling), **not** infinite pan/zoom.
- **Rendering:** **web canvas** (HTML5 `<canvas>` + Pointer Events), not native PencilKit.
- **Storage:** **in-memory only** — no persistence, no avenDB, no localStorage. Strokes
  reset on reload / navigating away. (Persistence is a deliberate later slice — flip to
  option B "synced Jazz/avenDB note" if the scratchpad proves useful.)

## Goal

A new **Draw** main you can open on iPad, draw freehand with the Apple Pencil (pressure-
aware), erase strokes, and lasso-select strokes to move or delete them — on one big
canvas, all in memory.

**Completion condition** (identical to frontmatter `goal`):

> From `app/`: `bun run check` exits 0 and `bun test tests` passes incl. new
> `app/tests/sketch-model.test.ts` (add-stroke, whole-stroke erase-on-hit, rect-select,
> move-selection). Scoped `biome check` over the 0060 files exits 0. The `/draw` main is
> wired into desktop + mobile nav and renders `DrawCanvas`. No persistence, avenDB, or
> schema changes (git diff touches no `libs/aven-schema/**` or `app/src-tauri/**`).

The pencil *feel* (latency, palm rejection, pressure curve) is inherently visual — it's a
**human-verify (HITL) item at review**, checked in `bun run tauri:dev` / on-device, not a
machine-provable criterion. The machine-provable core is the pure sketch model + wiring.

**Metric reconciled with reality during build (build skill: surface, don't pretend):**
The repo-wide `bun run lint` (`biome check .`) is **pre-existing red on `next`** — ~41
errors across ~20 unrelated files (brain, composer, identities, aven-city, aven-vibes,
scripts, betterauth). Fixing that is a separate cleanup, out of this card's scope, so the
lint criterion is **scoped to the 0060 files** (which are 0-error/0-warning). Separately,
`bun run check` (svelte-check) was **also** pre-existing red — a repo-wide blocker where
`app/src/app.d.ts`'s trailing `export {}` made `declare const __APP_VERSION__` module-scoped
(so it was invisible everywhere). That one-line fix (move it inside `declare global`) was
**necessary** to make *any* card's `bun run check` pass, so it's included here and called
out explicitly rather than done silently.

## Approach

Split the feature into **pure logic** (testable, no DOM) and a **thin renderer**:

1. `app/src/lib/draw/sketch-model.ts` — a pure module holding all state + geometry:
   `Point {x,y,pressure?}`, `Stroke {id, points, color, width}`,
   `SketchState {strokes, selectedIds}`, and pure functions `addStroke`, `eraseAt`
   (whole-stroke removal when a pointer is within `radius` of any segment), `selectInRect`,
   `moveSelection(dx,dy)`, plus helpers (`pointNearStroke`, `strokeBounds`). This is where
   the metric's tests live — no Svelte, no canvas.

2. `app/src/lib/draw/DrawCanvas.svelte` — a `<canvas>` that fills the main area
   (devicePixelRatio-aware), handles `pointerdown/move/up` using `getCoalescedEvents()` +
   `event.pressure` for smooth pencil strokes, holds the active tool (`pen | eraser |
   select`), and re-renders `SketchState` each frame via `requestAnimationFrame`. A small
   floating toolbar toggles the three tools. All mutations go through `sketch-model.ts`.

3. **Surface it in the mainnet (Alberobello) shell** — `DrawCanvas` mounts as a **Draw tab**
   in `app/src/lib/shell/MainnetShell.svelte` (the mainnet view's own tab bar: Chat | Vibes |
   Draw | DB | Fly), with a `mainnet.nav.draw` label in `app/languages/{en,de}.json`. The
   mainnet view is a component shell (tab-switched), not route-based — so no `/draw` route.

   *(Correction during build: an earlier pass wired `/draw` into the LOCAL-app primary nav
   [`+layout.svelte` / `MobileShellNav.svelte`] + a route. Wrong surface — the scratchpad
   belongs in the mainnet shell. That wiring + the route were removed.)*

**Tool semantics (kept deliberately basic):**
- **Pen** — freehand stroke; width scales with `pressure` (falls back to a constant when
  pressure is 0/undefined). Single default color for v1.
- **Eraser** — whole-stroke removal on touch (`eraseAt`); simplest fit for a vector model.
- **Select** — drag a rectangle → strokes intersecting it highlight; drag inside the
  selection to move; Delete/eraser removes the selected strokes.

**Out of scope (explicit):** persistence/sync of any kind; multi-note list + sidebar;
infinite/pannable/zoomable canvas; native PencilKit; undo/redo; export/PNG; color & brush
palettes beyond a default. Each is a candidate follow-on card back in `ideate/`.

## Steps

1. Write `sketch-model.ts` (pure) + `app/tests/sketch-model.test.ts`; get `bun test tests`
   green. *(checkpoint — the metric's core is provable before any UI.)*
2. Build `DrawCanvas.svelte` (canvas render loop + pointer/pen handling + 3-tool toolbar).
3. Mount `DrawCanvas` as a **Draw tab** in `MainnetShell.svelte` + `mainnet.nav.draw` i18n.
4. `cd app && bun run check`; scoped `biome check`; fix types/lint. *(checkpoint.)*
5. Manual pencil pass in `bun run tauri:dev` (and on-device iPad) — HITL, for review.

## Files to touch

- `app/src/lib/draw/sketch-model.ts` — NEW, pure state + geometry (all tested logic).
- `app/src/lib/draw/DrawCanvas.svelte` — NEW, canvas renderer + pointer/pen + toolbar.
- `app/src/lib/shell/MainnetShell.svelte` — EDIT, add the **Draw tab** (Alberobello shell)
  rendering `DrawCanvas`.
- `app/languages/en.json`, `app/languages/de.json` — EDIT, add `mainnet.nav.draw` + a
  `draw.*` toolbar block (`pen`/`eraser`/`select`/`clear`/`tools`).
- `app/tests/sketch-model.test.ts` — NEW, unit tests (the metric).
- `app/src/app.d.ts` — EDIT (out-of-card but necessary), move `declare const
  __APP_VERSION__` inside `declare global` so `bun run check` can pass at all. See the note
  under Completion condition.

## Acceptance criteria

Each checkable from the transcript.

- [x] `cd app && bun run check` exits 0 — svelte-check compiles `MainnetShell.svelte`
      (Draw tab), `DrawCanvas.svelte`, and `sketch-model.ts`. *(0 errors after the
      `app.d.ts` global fix; 1 pre-existing unrelated warning in `aven-city`.)*
- [x] Scoped lint clean — `biome check` over the 9 touched files exits 0, **0 errors /
      0 warnings**. *(Repo-wide `bun run lint` stays pre-existing-red — see the note; not
      this card's scope.)*
- [x] `cd app && bun test tests` passes, including `app/tests/sketch-model.test.ts`
      *(11 pass / 0 fail)*:
  - [x] add-stroke → `strokes.length` increases and the points are recorded
  - [x] `eraseAt` removes only the stroke within `radius` of the point; others remain
  - [x] `selectInRect` selects strokes inside the rect and excludes ones outside
  - [x] `moveSelection(dx,dy)` translates only selected strokes' points; others unchanged
- [x] Registration present — `git grep -n "'draw'" app/src/lib/shell/MainnetShell.svelte`
      shows the Draw tab (id + label + render branch) in the Alberobello shell. No `/draw`
      route or local-app primary-nav entry (that mis-wiring was removed).
- [x] In-memory constraint held — `git diff --name-only` touches **no** file under
      `libs/aven-schema/` or `app/src-tauri/`.
- [ ] HITL (review, not machine): on iPad in `bun run tauri:dev` the Pencil draws smoothly,
      eraser removes strokes, select moves/deletes a lasso'd group. *(pending human verify)*

## Verification

```bash
# from app/
cd app
bun run check          # svelte-kit sync + svelte-check (compiles route + component + model)
bun test tests         # incl. app/tests/sketch-model.test.ts (the metric's core)

# scoped lint over just the 0060 files (repo-wide `bun run lint` is pre-existing-red)
cd ..
bunx biome check \
  app/src/lib/draw/sketch-model.ts app/src/lib/draw/DrawCanvas.svelte \
  app/src/lib/shell/MainnetShell.svelte app/src/app.d.ts \
  app/tests/sketch-model.test.ts app/languages/en.json app/languages/de.json

# registration (Draw tab in the Alberobello shell) + in-memory constraint
git grep -n "'draw'" app/src/lib/shell/MainnetShell.svelte
git diff --name-only | grep -E '^(libs/aven-schema/|app/src-tauri/)' && echo "VIOLATION: touched persistence" || echo "ok: no schema/backend changes"

# manual (HITL, review): pencil feel on device
bun run tauri:dev
```

## Hand-off

Pick this up with the board command (resolves the item, loads it, drives it):

```
/aven-build 0060
```

…or hand the condition straight to the built-in goal loop:

```
/goal From app/: `bun run check` exits 0 and `bun test tests` passes incl. new app/tests/sketch-model.test.ts (add-stroke, whole-stroke erase-on-hit, rect-select, move-selection). From repo root: `bun run lint` exits 0. The /draw main is wired into desktop + mobile nav and renders DrawCanvas. No persistence, avenDB, or schema changes.
```

## Progress log

Newest entry first.

- `2026-07-01` — Rewired to the correct surface: `DrawCanvas` now mounts as a **Draw tab in
  the mainnet (Alberobello) shell** (`MainnetShell.svelte`, Chat | Vibes | Draw | DB | Fly)
  with a `mainnet.nav.draw` label. Removed the earlier mis-wiring — the `/draw` route
  (`app/src/routes/draw/`), the local-app primary-nav entries in `+layout.svelte` /
  `MobileShellNav.svelte`, and the `nav.draw` label. `bun run check` exit 0, tests 11/11,
  scoped lint clean.
- `2026-07-01` — Built. `sketch-model.ts` (pure) + 11 passing unit tests; `DrawCanvas.svelte`
  (canvas + pointer/pen + pen/eraser/select toolbar); `/draw` route + nav wiring (desktop +
  mobile) + i18n (`nav.draw`, `draw.*`). `bun run check` exits 0, `bun test tests` 11/11,
  0060 files 0-error/0-warning. Two pre-existing repo gates surfaced: fixed the `app.d.ts`
  `__APP_VERSION__` global blocker (needed for `check` to pass at all); repo-wide `bun run
  lint` left as-is (pre-existing debt, out of scope) with lint scoped to the touched files.
  Moved build → review.

- `2026-07-01` — Discovery: uncovered goal (A/scratchpad); locked scope (pen+eraser+basic
  select, big fixed web canvas, in-memory only, no notes list); made "done" provable via a
  pure `sketch-model` unit test + `check`/`lint` + a no-schema-diff constraint. Created in
  `discover/`.

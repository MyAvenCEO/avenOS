---
title: Vibe definitions as DB config (vibe.view / vibe.style / vibe.logic) — one vibe end-to-end
summary: Complete the config-as-data stack. Today flow.* (skills) and predicate_type.* (ontology types) live in the DB as admin-owned Layer-A config, and user data lives in data_schema/data_value (Layer B) — but the VIBE definitions (the declarative view tree, the style tokens, and the JS logic that runs in sandbox-quickjs) live in TS FILES under libs/aven-vibes/src/vibes/<name>/ (view.ts, style.ts, the logic string). A vibe is ALREADY pure config — a `UiFixtureShell` { view: ViewDef, style: StyleDef, state, interface, logic: string } fed to the view-engine + sandbox. Move those definitions into the DB as SEPARATE admin-config rows — vibe_view / vibe_style / vibe_logic (the `vibe.*` registry) — so a view/style/logic can be shared or swapped independently, and the app becomes a pure runtime: it LOADS a vibe bundle from the DB and renders it through the existing engine, no rebuild. This makes "the same vibe everywhere (chat/runs/skills)" a GUARANTEE (one engine, one DB source) and supersedes board 0094's hardcoded-Svelte approach. First slice: ONE vibe — the `todos` pilot (the most complete existing engine-vibe) — fully DB-driven end-to-end. Only the rendering/definition config moves; the predicate data_schema/data_value (dynamic user data) is untouched; aven-db CRDT untouched.
owner: claude
created: 2026-06-30
updated: 2026-06-30
goal: Vibe definitions live in the DB as separate admin-config rows — `vibe_view` / `vibe_style` / `vibe_logic` (the `vibe.*` registry, Layer A alongside flow + predicate_type) — and the pilot vibe `todos` is fully DB-driven end-to-end: a migration seeds its view + style + logic from the current files, and the render path LOADS the bundle from the DB through the existing view-engine + sandbox-quickjs. Proven by — (1) a command prints the `todos` rows with `vibe_view.body` + `vibe_style.body` non-empty jsonb and `vibe_logic.body` non-empty; (2) a headless test loads the todos bundle FROM THE DB and runs the view-engine, producing a view tree equal to the file definition (`todoView`); (3) the app renders todos via the DB loader — the direct `todoView`/`todoStyle` file import is gone from the render path (`rg` shows the loader/endpoint, not the file import); (4) `bun run check` (aven-vibes / aven-ui / betterauth) + `bun --bun x svelte-check` (app) exit 0 and the todos vibe still renders. Only `todos` is migrated — the other vibes + their files stay until their follow-on. aven-db CRDT untouched; data_schema/data_value unchanged.
---

## Context

The config-as-data architecture is most of the way there:
- **`flow`** table — skills/flows as data (board 0083/0088/0093). ✓
- **`predicate_type`** table — ontology composite types as data (board 0088/0092). ✓
- **`data_schema` / `data_value`** — dynamic user data + per-predicate schemas (Layer B). ✓
- **Vibe definitions** — the declarative UI: `view` (a `ViewNode` tree with `$bindings`/`$each`/`$on`),
  `style` (`StyleDef` tokens/components/selectors), and `logic` (the JS string run in sandbox-quickjs).
  These live in **TS files** (`libs/aven-vibes/src/vibes/<name>/view.ts`, `style.ts`, …) and are
  rendered by the existing engine (`aven-ui|aven-vibes/src/engine`: view-engine, style-engine,
  validators, security/sandbox). **Still files, not data.** ✗

A vibe is ALREADY a pure `UiFixtureShell` (`{ view, style, state, interface, logic }`) — so this is a
relocation, not a redesign. Moving it into the DB makes the app a pure runtime (load a bundle by name,
render it; edit it without a rebuild), enables per-tenant / runtime vibe authoring, and makes "the same
vibe in Chat + Runs + the Skills editor" a **structural guarantee** (one engine + one DB source) rather
than three hand-maintained copies. That is why this **supersedes board 0094** (which tried to unify the
THREE hardcoded Svelte dispatch paths) — once the source is one DB-driven engine, the unification is free.

**Decisions (confirmed):** SEPARATE `vibe.view` / `vibe.style` / `vibe.logic` configs (independently
shareable/swappable); ONE vibe end-to-end first (pilot = `todos`); supersede/fold 0094.

See [[two-layer-schema-split]], [[flow-engine-actor-model]], [[avenos-brand-design-system]],
[[universal-predication-schema-0084]].

## Goal

**Vibe rendering is config-as-data: the app loads a vibe's view/style/logic from the DB and renders it
through the existing engine.** The decision this unlocks: a vibe is authored/edited as DATA (like a flow
or a type), in one place, and is therefore identical wherever it renders — no per-view Svelte copy, no
rebuild to change a card.

**Completion condition:** *(identical to `goal:` — the four numbered proofs, pilot = `todos`.)*

## Approach

- **Three admin-config tables** (the `vibe.*` registry, Layer A): `vibe_view` (name PK, body jsonb),
  `vibe_style` (name PK, body jsonb), `vibe_logic` (name PK, body text/jsonb). Separate so a style/view/
  logic is an independent, shareable entity (a vibe binds them by name — explicit cross-name binding is a
  follow-on; the pilot binds by convention: vibe `todos` → the `todos` rows).
- **Seed migration** — write the current `todoView` (view.ts) + `todoStyle` (style.ts) + the todos logic
  string into `vibe_view`/`vibe_style`/`vibe_logic` as `todos`. The TS files become the seed SOURCE only.
- **Loader + endpoint** — `GET /api/vibe/:name` (betterauth) returns `{ view, style, logic }` from the
  three tables; a small client loader fetches + caches it. The app's vibe mount renders the DB bundle
  through the SAME view-engine + sandbox-quickjs it uses today (no engine change).
- **Pilot wiring** — the todos vibe renders from the DB loader instead of importing `todoView`/`todoStyle`.
- **Headless proof** — a test loads the todos bundle from the DB and runs the view-engine, asserting the
  produced view tree equals the file definition (so "DB == file" is proven, not eyeballed).

**Out of scope (follow-on cards):** migrating the other vibes (invoice/doc-compare/bookkeeping/…) — incl.
authoring the document `ingest`/`classify` cards as engine-vibes (the heart of the folded 0094); a vibe
EDITOR UI; explicit cross-name binding (a vibe referencing a shared style by a different name); versioning
/ history of vibe rows; the classify-RESULT fix (the invoice→'Sonstiges' vision bug — a separate small card).

## Steps (small, checkpointed)

1. **Schema** — migration creates `vibe_view` / `vibe_style` / `vibe_logic`. **Checkpoint.**
2. **Seed todos** — migration writes todoView + todoStyle + todos logic into the three tables (from the
   files). A command prints the rows (non-empty). **Checkpoint.**
3. **Loader + endpoint** — `GET /api/vibe/:name` + a client loader returning `{view,style,logic}`. **Checkpoint.**
4. **Render todos from DB** — the todos mount uses the loader (drop the direct file import); the engine
   renders the DB bundle. **Checkpoint.**
5. **Headless equivalence test** — DB-loaded todos view tree == the file `todoView`. **Checkpoint.**
6. **Verify** — checks + svelte-check exit 0; todos still renders.

## Files to touch

- `libs/betterauth/migrations/00NN_vibe_registry.ts` — the three tables + seed todos.
- `libs/betterauth/src/data.ts` or a new `vibe.ts` + route — `GET /api/vibe/:name`.
- `app/src/lib/…` — a client vibe loader; the todos mount renders the DB bundle.
- `libs/aven-vibes/src/vibes/todos/*` — kept as the seed source (not deleted this card).
- A test under `libs/aven-vibes/tests` or `libs/betterauth` — DB-bundle == file-bundle equivalence.

## Acceptance criteria

- [ ] `vibe_view` / `vibe_style` / `vibe_logic` tables exist; a command prints the `todos` rows with non-empty view + style jsonb + logic body.
- [ ] `GET /api/vibe/todos` returns `{ view, style, logic }` matching the seeded rows.
- [ ] The app renders the todos vibe from the DB loader; the direct `todoView`/`todoStyle` import is gone from the render path (`rg` shows the loader, not the file import).
- [ ] A headless test loads the todos bundle from the DB, runs the view-engine, and asserts the view tree equals the file `todoView`.
- [ ] `bun run check` (aven-vibes / aven-ui / betterauth) + `bun --bun x svelte-check` (app) exit 0; the todos vibe still renders.
- [ ] Only `todos` is in the DB; other vibes + their files unchanged; `data_schema`/`data_value` + aven-db untouched.

## Verification

```bash
(cd libs/betterauth && bun run check)
(cd libs/aven-vibes && bun run check && bun test)
(cd app && bun --bun x svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -3)
# Live (auth server, .env.samuel):
#   SELECT name FROM vibe_view;  → includes 'todos'; body jsonb non-empty
#   curl localhost:8787/api/vibe/todos → { view, style, logic }
#   headless: load todos bundle FROM DB → view-engine → tree deep-equals file `todoView`
rg -n "todoView|todoStyle" app/src   # → not imported on the render path (loader instead)
```

## Hand-off

```
/aven-build 0095
```

## Progress log

Newest entry first.

- `2026-06-30` — **BUILT + verified. All proofs pass.** Migration `0034` creates the `vibe.*` registry —
  three admin-config tables `vibe_view` / `vibe_style` (jsonb) + `vibe_logic` (text) — and seeds the
  `todos` pilot from its files (`todoView` + `todoStyle` rows, `todoLogic` 5643 chars). `loadVibe` +
  `GET /api/vibe/:name` (betterauth) serve the bundle (404 on unknown). The app's `loadVibeBundle` client
  + `TodosVibe` now LOAD view/style/logic from the DB and override the file shell (interface/source stay
  as instant defaults) — `rg` shows no `todoView`/`todoStyle` import on the render path, just the loader.
  Headless test `vibe-registry.test.ts` proves the DB bundle == the file definition (canonical
  key-order-independent deep-equal; 1 pass / 3 asserts) — so the engine renders the same tree. svelte-check
  **0 errors**, betterauth check 0. Only `todos` migrated; other vibes + their files untouched; aven-db +
  data_schema/data_value unchanged. The config-as-data stack is now complete: flow.* + predicate_type.* +
  data_* + **vibe.***. Follow-ons (noted): the other vibes' migration (incl. authoring ingest/classify as
  engine-vibes — folded 0094), a vibe editor, the classify-result vision fix.
- `2026-06-30` — Discovery. The config-as-data stack has flow + predicate_type + data_* in the DB, but
  vibe definitions (view/style/logic) are still TS files — though a vibe is already a pure UiFixtureShell
  fed to the engine + sandbox-quickjs. User decisions: SEPARATE vibe_view/vibe_style/vibe_logic configs
  (independently shareable); ONE vibe end-to-end first (pilot = todos, the most complete engine-vibe);
  SUPERSEDE 0094 (the hardcoded-Svelte unify) — 0094 folded back to ideate/, its StepVibe edit reverted.
  Goal made measurable via a DB-bundle == file-bundle headless equivalence + the loader replacing the
  file import. Out of scope: the other vibes' migration (incl. authoring the doc ingest/classify cards as
  engine-vibes — the substance of folded 0094), a vibe editor, the classify-RESULT vision fix. Created in discover/.

---
title: Fully dynamic config (skills · tools · vibes as data) + standardized DB viewer
summary: Move the skill + tool (actor) registries out of hardcoded TS into DB tables (config-as-data, handler-by-name), and standardize the DB viewer into a 7-category rail + 50/50 list·detail layout that displays them all
owner: Claude Code (build agent)
created: 2026-07-03
updated: 2026-07-03
tags: [config-as-data, db-viewer, dispatch, actors]
goal: "`bun test libs/betterauth/tests/dynamic-config.test.ts` exits 0 — proving the skill + tool (actor) registries LOAD from DB tables (seeded to parity with the old TS: todos→[data_crud], ontology→[ontology,query,mutate,bundle], website→[show_website,edit_website,deploy_website]), a DB-only skill+tool row (no code) is routable + advertised with its handler resolved by name, and the router payload stays schema-free; AND `bunx tsc -p libs/betterauth/tsconfig.json`, `bunx tsc -p skills/tsconfig.json`, and `cd app && bunx svelte-check` all exit 0 with the DB viewer exposing 7 categories (schemas·values·bundles·vibes·skills·tools·runs) in a category-selector rail + 50/50 list·detail layout; existing betterauth + dispatch tests stay green."
---

# Fully dynamic config (skills · tools · vibes as data) + standardized DB viewer

## Context

Verified current state (this session): the *execution* engines are already generic and
config-as-data works end-to-end for **data** — predicates (`data_schema`, AI-mintable),
predications (`data_value`), bundles (`data_bundles`, 1 row `todos`), operations
(`data_operations`, 6 rows incl. 2 GLM-authored at runtime), vibes (`vibe_view/style/logic`,
9 each — render loads from DB), and runs (`flow_run`, live). What's **still hardcoded in TS**
is the last mile of *config*:

- **`SKILL_REGISTRY`** (skill→tools map) — `skills/tools/registry.ts`.
- **Tool definitions** — each actor's `.definition` (name/description/params) lives in code
  (`data-crud.ts`, `queries.ts`, `bundle.ts`, `ontology.ts`), and the 3 website/Composer tools
  are still **inline in `ai.ts`** (never even actors).
- The viewer's left rail lists every item under stacked headers; there's no SKILLS / TOOLS /
  RUNS category, and the layout isn't standardized.

**Actors are the unifying primitive** (board 0083): a *tool* IS a leaf actor (address · mailbox ·
behavior · vibe), a *skill* IS an actor-hub (`flow` row + `nodes`). So making skills + tools
config dynamic **is** making actors dynamic — no separate actor table. Flow-node wiring is already
in `flow.nodes`; vibes are already in `vibe_*`. The gap is the **skill registry** and the **tool
(actor) definitions**.

Decisions locked in discovery (2026-07-03):
- **All in one go** — one card covers both the config→DB migration AND the viewer standardization.
- **Config in DB, handler by name** — the DB holds the *definition* (name, description, params,
  skill→tools map); the runtime resolves the actual handler/engine from code by name (`TOOL_ACTORS`).
  No arbitrary code shipped as data.
- **Vibes are already config-as-data** — this card *displays* them in the new layout; GLM *authoring*
  of vibes stays a separate card ([[0106]]-glm-vibes).

**Absorbs** the earlier follow-ons: **0107** (website tools → tool-actors) and **0108** (skill
registry → DB table) are subsumed here and should be closed as superseded.

Related: [[0106]] (dispatch skill — the router this makes DB-driven), the config-as-data north star.

## Goal

The skill + tool (actor) registries live in DB tables and are editable without a deploy (add a
row → new routable skill / advertised tool, handler resolved by name); and the DB viewer is one
standardized surface — a category-selector rail (SCHEMAS · VALUES · BUNDLES · VIBES · SKILLS ·
TOOLS · RUNS) with a 50/50 item-list · detail split — that displays all of them.

**Completion condition** (identical to frontmatter `goal`):

> `bun test libs/betterauth/tests/dynamic-config.test.ts` exits 0 — proving the skill + tool registries LOAD from DB tables (seeded to parity with the old TS), a DB-only skill+tool row is routable + advertised with its handler resolved by name, and the router stays schema-free; AND `bunx tsc -p libs/betterauth/tsconfig.json`, `bunx tsc -p skills/tsconfig.json`, and `cd app && bunx svelte-check` exit 0 with the viewer exposing 7 categories in a category-selector rail + 50/50 list·detail layout; existing betterauth + dispatch tests stay green.

## Approach

Two phases in one card. Keep the TS registries as the **seed source** (a migration copies them
into DB tables), then flip the runtime to read the DB; the hardcoded maps become the fixture, not
the source of truth — same pattern as `data_bundles`/`data_operations`.

### Phase 1 — config → DB (skills + tools = actors)
- **Migration** `00NN_skill_tool_registry.ts`: create `skill (id, label, description, tools jsonb, position, timestamps)` and `tool (name, description, params jsonb, skill_id, kind, position, timestamps)`. Seed `skill` from `SKILL_REGISTRY` (todos/ontology/website) and `tool` from every actor's `.definition` + the 3 Composer definitions.
- **Website tools → actors** (absorbs 0107): move `show_website`/`edit_website`/`deploy_website` handlers out of `ai.ts` into `ToolActor`s in `@avenos/skills/tools`; register in `TOOL_ACTORS`.
- **DB-driven resolution** (absorbs 0108): `SKILL_REGISTRY`/`advertisedTools`/`chatToolDefinitionsFor` read from the `skill`/`tool` tables (cached), not the TS literal. `routeSkill` builds its menu from DB skills; `TOOL_ACTORS[name].handle` stays the by-name handler dispatch. The TS `SKILL_REGISTRY` remains only as the migration seed.

### Phase 2 — standardized viewer (`app/src/lib/shell/MainnetDb.svelte`)
- Left rail becomes a **pure category selector**: SCHEMAS · VALUES · BUNDLES · VIBES · SKILLS · TOOLS · RUNS (one active at a time).
- Main area is a **50/50 split**: left = the selected category's **item list**; right = the **selected item's detail** (keeping the existing per-type detail — value table, bundle traits/view, operation breakdown, vibe UI tabs, all with Readable/Raw JSON where present).
- New categories read: SKILLS ← `skill` table (+ `flow` hub), TOOLS ← `tool` table (definition + which skill + handler-present), RUNS ← `flow_run`. Context providers: `loadContext('skills')`, `loadContext('tools')`, `loadContext('runs')` (or reuse existing where present).

Trade-off / risk: this is a **large** card (migration + actor refactor + runtime flip + full viewer
re-layout). Explicitly out of scope: GLM-authoring of skills/tools/vibes (config is editable-as-data
here; AI *minting* new skills/tools is a follow-on), and any change to handler code beyond moving the
website handlers into actors. Build in the phase order above and checkpoint after Phase 1 (backend
green) before the viewer re-layout.

## Steps

1. Migration: `skill` + `tool` tables, seeded from the TS registries + Composer defs.
2. Website tools → `ToolActor`s (out of `ai.ts`), registered in `TOOL_ACTORS`.
3. Flip `SKILL_REGISTRY`/`advertisedTools`/`chatToolDefinitionsFor`/`routeSkill` to read the DB (cached); handler stays by-name. Add `skills`/`tools`/`runs` context providers.
4. `dynamic-config.test.ts`: parity + DB-only-row-routable + handler-by-name + schema-free router.
5. Viewer: category-selector rail (7) + 50/50 list·detail; wire SKILLS/TOOLS/RUNS.
6. `tsc` (betterauth+skills) + `svelte-check` + full betterauth suite green; commit; close 0107/0108 as superseded; `git mv` build → review.

## Files to touch

- `libs/betterauth/migrations/00NN_skill_tool_registry.ts` (new) — tables + seed.
- `libs/betterauth/src/db.ts` — `skill` + `tool` table types.
- `skills/tools/registry.ts` + `skills/tools/dispatch.ts` — DB-backed skill/tool resolution (TS map → seed only).
- `skills/tools/website.ts` (new) + `skills/tools/registry.ts` — website tools as actors.
- `libs/betterauth/src/ai.ts` — drop inline website handlers; router menu from DB.
- `libs/betterauth/src/*` — `skills`/`tools`/`runs` context providers.
- `app/src/lib/shell/MainnetDb.svelte` — category-selector rail + 50/50 layout + 3 new categories.
- `libs/betterauth/tests/dynamic-config.test.ts` (new) — the proof.

## Acceptance criteria

- [ ] `skill` + `tool` tables exist, seeded to **parity**: `advertisedTools('todos')==['data_crud']`, `('ontology')==['ontology','query','mutate','bundle']`, `('website')==['show_website','edit_website','deploy_website']` — resolved FROM the DB. Proven by `dynamic-config.test.ts`.
- [ ] **DB-only dynamism**: inserting a `skill` + `tool` row (no TS change) makes that skill routable and its tool advertised, handler resolved by name. Proven by the test.
- [ ] Website tools are `ToolActor`s; `ai.ts` has no inline `if (tc.name === 'edit_website')` blocks — proven by grep in the test/verification.
- [ ] Router stays schema-free (no tool schemas / hint in `buildRouterRequest`). Proven by the test.
- [ ] `bunx tsc` (betterauth + skills) + `cd app && bunx svelte-check` exit 0; full betterauth + dispatch suites green.
- [ ] **(HITL / review)** Viewer shows the 7-category selector rail + 50/50 list·detail, standardized across all categories, with SKILLS/TOOLS/RUNS populated — visual sign-off.

## Verification

```bash
bunx tsc --noEmit -p libs/betterauth/tsconfig.json
bunx tsc --noEmit -p skills/tsconfig.json
bun test libs/betterauth/tests/dynamic-config.test.ts   # parity + DB-only-row + handler-by-name + schema-free
bun test libs/betterauth                                 # existing suites stay green
cd app && bunx svelte-check --tsconfig ./tsconfig.json   # viewer compiles
```

## Hand-off

```
/aven-build 0110
```

…or hand the condition straight to the built-in goal loop:

```
/goal <paste the Completion condition above>
```

## Progress log

Newest entry first.

- `2026-07-03` — Discovery: interviewed; decided ALL-IN-ONE (config→DB + viewer standardization) with config-in-DB / handler-by-name. Clarified actors = the unifying primitive (tool = leaf actor, skill = actor-hub) → no separate actor table; skill+tool tables ARE the actor config. Absorbs 0107 (website→actors) + 0108 (skill registry→DB). Made "done" a `bun test` proving DB-backed skill/tool resolution + parity + DB-only-row dynamism + handler-by-name + schema-free router, plus tsc/svelte-check for the 7-category 50/50 viewer. Written into `discover/`.

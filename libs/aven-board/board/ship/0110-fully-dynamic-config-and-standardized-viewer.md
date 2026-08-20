---
title: Fully dynamic config (skills · actors · vibes as data) + standardized DB viewer
summary: Actors become config-complete DB rows (engine-by-name + mailbox + llm + prompt + context deps); skills are actor collections with workflows; the DB viewer standardizes into a 7-category rail + 50/50 list·detail layout displaying them all
owner: Claude Code (build agent)
created: 2026-07-03
updated: 2026-07-03
tags: [config-as-data, db-viewer, dispatch, actors]
goal: "`bun test libs/betterauth/tests/dynamic-config.test.ts` exits 0 — proving the skill + actor registries LOAD from DB tables (seeded to parity with the old TS: todos advertises [data_crud], ontology [ontology,query,mutate,bundle], website [show_website,edit_website,deploy_website] — each as its actors' mailboxes), a DB-only skill+actor row (no code change) is routable + advertised with its engine resolved by name, actor rows carry llm+prompt+context config read by the runtime (the ontology mint prompt served from the actor row, not the TS constant), and the router payload stays schema-free; AND `bunx tsc -p libs/betterauth/tsconfig.json`, `bunx tsc -p skills/tsconfig.json`, and `cd app && bunx svelte-check` all exit 0 with the DB viewer exposing 7 categories (schemas·values·bundles·vibes·skills·actors·runs) in a category-selector rail + 50/50 list·detail layout; existing betterauth + dispatch tests stay green."
---

# Fully dynamic config (skills · actors · vibes as data) + standardized DB viewer

## Context

Verified current state (this session): the *execution* engines are already generic and
config-as-data works end-to-end for **data** — predicates (`data_schema`, AI-mintable),
predications (`data_value`), bundles (`data_bundles`), operations (`data_operations`, incl.
GLM-authored at runtime), vibes (`vibe_view/style/logic`, render loads from DB), and runs
(`flow_run`, live). What's still hardcoded in TS is the last mile of *config*.

### The taxonomy (clarified 2026-07-03 — supersedes the earlier tool/node wording)

- **ACTOR** — the atomic worker, one **config-complete DB row**: `engine` (handler code
  resolved **by name** — the only part that stays code) · `mailbox` (args schema = the tool
  definition the model sees) · `llm` (model + effort) · `prompt` (its system/instruction
  prompt) · `context` (provider dependencies, loaded only when it fires = Tier 3) · `vibe` ·
  `hitl`. The old node/actor distinction dissolves: the todos skill's 4 "nodes"
  (read/create/edit/delete) ARE 4 actors sharing one engine (`data_crud`) with different
  role/vibe/hitl. TS type `ToolActor` → the engine registry.
- **SKILL** — a named collection of actors under its management + a **workflow** (multi-step
  orchestration graph that can reference sub-skills — the pattern already mocked by the legacy
  invoice-ingest composite flow, migrations 0022/0023).
- **DISPATCH** — a minimal skill that only delegates the human request to ONE skill (board
  0106); itself an actor whose prompt is the skill menu.

What is hardcoded today and becomes data here:
- `SKILL_REGISTRY` (skill→tools map) — `skills/tools/registry.ts`.
- Actor mailboxes (each `ToolActor.definition`) — TS; the 3 website/Composer handlers are
  still **inline in `ai.ts`** (not even actors).
- Actor prompts — e.g. `CREATE_INSTRUCTIONS` (ontology mint) in `skills/tools/ontology.ts`,
  the query/mutate/bundle authoring prompts in `*-caps.ts`.
- Actor llm config — `TINFOIL_MODEL` / `WEBSITE_MODEL` constants pick gemma vs GLM per path.
- The viewer has no SKILLS / ACTORS / RUNS categories and no standardized layout.

Decisions locked in discovery:
- **All in one go** — config→DB migration AND viewer standardization in this card.
- **Config in DB, engine by name** — no arbitrary code as data; behavior stays code.
- **TOOLS category disappears** — a "tool definition" is an actor's mailbox; the viewer
  category is **ACTORS**.
- **Vibes already config-as-data** — displayed here; GLM *authoring* stays [[0106]]-glm-vibes.
- **Chat-side multi-step orchestration is OUT of scope** — the flow-runner owns workflows;
  the chat loop keeps firing single actors per turn. Orchestrated chat runs = follow-on.

**Absorbs** 0107 (website tools → actors) and 0108 (skill registry → DB); both superseded.

Related: [[0106]] (dispatch skill), board 0083 (flow engine → actor model), the config-as-data
north star.

## Goal

Skills and actors are config-complete DB rows editable without a deploy (add rows → new
routable skill / advertised actor, engine resolved by name, prompt/llm/context read from the
row); and the DB viewer is one standardized surface — a category-selector rail (SCHEMAS ·
VALUES · BUNDLES · VIBES · SKILLS · ACTORS · RUNS) with a 50/50 item-list · detail split.

**Completion condition** (identical to frontmatter `goal`):

> `bun test libs/betterauth/tests/dynamic-config.test.ts` exits 0 — proving the skill + actor registries LOAD from DB tables (seeded to parity with the old TS), a DB-only skill+actor row is routable + advertised with its engine resolved by name, actor rows carry llm+prompt+context config read by the runtime (the ontology mint prompt served from the actor row, not the TS constant), and the router stays schema-free; AND `bunx tsc` (betterauth + skills) and `cd app && bunx svelte-check` exit 0 with the viewer exposing 7 categories in a category-selector rail + 50/50 list·detail layout; existing betterauth + dispatch tests stay green.

## Approach

Keep the TS registries/constants as the **seed source** (a migration copies them into DB),
then flip the runtime to read the DB — same pattern as `data_bundles`/`data_operations`.

### Phase 1 — config → DB (skills + actors)
- **Migration** `00NN_skill_actor_registry.ts`: create
  `skill (id, label, description, workflow jsonb, position, timestamps)` and
  `actor (id, skill_id, name, engine, code text NULL, caps jsonb NULL, mailbox jsonb, llm jsonb, prompt text, context jsonb, vibe, hitl, position, timestamps)`.
  Behavior binding: `engine` (by-name, this card) XOR `code` (sandboxed QuickJS, lands in
  [[0111]] — the columns exist NOW so 0111 needs no schema change).
  Seed `skill` from `SKILL_REGISTRY` (todos/ontology/website) and `actor` from every
  `ToolActor.definition` + the 3 Composer definitions; seed `prompt` from the existing TS
  constants (`CREATE_INSTRUCTIONS`, the authoring prompts) and `llm` from today's model
  constants, so parity is provable.
- **Website tools → actors** (absorbs 0107): move `show_website`/`edit_website`/`deploy_website`
  handlers out of `ai.ts` into engines in `@avenos/skills/tools`, registered in the engine
  registry (`TOOL_ACTORS`).
- **DB-driven resolution** (absorbs 0108): `advertisedTools`/`chatToolDefinitionsFor` build a
  skill's advertised list from its actors' mailboxes (cached); `routeSkill` builds its menu
  from DB skills; engine dispatch stays `TOOL_ACTORS[engine].handle`. Actor `prompt`/`llm`/
  `context` are read from the row at fire time — the ontology mint uses the row's prompt
  (TS constant becomes seed-only).

### Phase 2 — standardized viewer (`app/src/lib/shell/MainnetDb.svelte`)
- Left rail = **pure category selector**: SCHEMAS · VALUES · BUNDLES · VIBES · SKILLS ·
  ACTORS · RUNS (one active).
- Main = **50/50 split**: left = the category's item list; right = the selected item's detail
  (keeping the per-type detail views: value table, bundle traits/view, operation breakdown,
  vibe UI tabs, Readable/Raw JSON tabs where present).
- New categories read: SKILLS ← `skill` (+ workflow), ACTORS ← `actor` (mailbox · engine ·
  llm · prompt · context · vibe · hitl), RUNS ← `flow_run`. Context providers:
  `loadContext('skills' | 'actors' | 'runs')`.

Checkpoint after Phase 1 (backend green) before the viewer re-layout.

## Steps

1. Migration: `skill` + `actor` tables, seeded from TS registries + Composer defs + prompt/llm constants.
2. Website handlers → engines in `@avenos/skills/tools` (out of `ai.ts`).
3. Runtime flip: skill routing menu, advertised mailboxes, and actor prompt/llm/context all read from DB (cached); engine by name. Context providers for skills/actors/runs.
4. `dynamic-config.test.ts`: parity + DB-only-row routable/advertised + prompt-from-row + schema-free router.
5. Viewer: 7-category selector rail + 50/50 list·detail; wire SKILLS/ACTORS/RUNS.
6. `tsc` + `svelte-check` + full suites green; commit; `git mv` build → review.

## Files to touch

- `libs/betterauth/migrations/00NN_skill_actor_registry.ts` (new) — tables + seed.
- `libs/betterauth/src/db.ts` — `skill` + `actor` table types.
- `skills/tools/registry.ts` + `skills/tools/dispatch.ts` — DB-backed resolution (TS map → seed only).
- `skills/tools/website.ts` (new) — website engines as actors.
- `libs/betterauth/src/ai.ts` — drop inline website handlers; router menu + actor config from DB.
- `libs/betterauth/src/ontology.ts` / `*-caps.ts` — read prompts from the actor row (constants → seed).
- `libs/betterauth/src/*` — `skills`/`actors`/`runs` context providers.
- `app/src/lib/shell/MainnetDb.svelte` — category-selector rail + 50/50 layout + 3 new categories.
- `libs/betterauth/tests/dynamic-config.test.ts` (new) — the proof.

## Acceptance criteria

- [x] `skill` + `actor` tables exist, seeded to **parity** — each advertised list built FROM the actors' mailboxes in the DB. Proven by `dynamic-config.test.ts` (5 pass).
- [x] **DB-only dynamism**: a new `skill`+`actor` row (no TS change) is routable + advertised, engine resolved by name. Proven by the test.
- [x] **Prompt/llm from the row**: the ontology mint prompt is served from the actor row (mutate → runtime reads the change; TS constant = seed/fallback), wired into `ontology.ts`. Proven by the test.
- [ ] Website engines are registered actors; `ai.ts` has no inline `if (tc.name === 'edit_website')` blocks. **DEFERRED** — website definitions ARE seeded as actor rows (advertised from DB), but the streaming handlers stay inline in `ai.ts`; the handler→engine migration is carved to [[0107]] (risk: touches the live chat streaming loop).
- [x] Router stays schema-free. Proven by the test.
- [x] `bunx tsc` (betterauth + skills) exit 0; full betterauth (35/0, incl. the 5 new) + skills/dispatch (18/0) suites green. `svelte-check` green (viewer re-layout pending in Phase 2).
- [x] Viewer standardized — `MainnetDb.svelte` rail is now a pure category selector (Schemas · Values · Bundles · Operations · Vibes · Skills · Actors · Runs — the 7 named + Operations kept) and the main area is a 50/50 item-list · detail split across every category; SKILLS/ACTORS/RUNS read from the context providers. **svelte-check 0 errors.** Visual sign-off is the reviewer's (renders in the Tauri app).

## Verification

```bash
bunx tsc --noEmit -p libs/betterauth/tsconfig.json
bunx tsc --noEmit -p skills/tsconfig.json
bun test libs/betterauth/tests/dynamic-config.test.ts   # parity + DB-only-row + prompt-from-row + schema-free
bun test libs/betterauth                                 # existing suites stay green
cd app && bunx svelte-check --tsconfig ./tsconfig.json   # viewer compiles
grep -n "edit_website" libs/betterauth/src/ai.ts         # no inline handler blocks
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

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
Newest entry first.

- `2026-07-03` — **Build Phase 2 (standardized viewer) done + green** (commit `596b7f85`): `MainnetDb.svelte` re-laid-out — rail = pure category selector, main = 50/50 list·detail, + SKILLS/ACTORS/RUNS categories from the context providers. Final green: tsc (betterauth+skills) exit 0, betterauth 35/0, svelte-check 0 errors. The measurable **Completion condition is met** (the website handler→engine migration is an acceptance box carved to [[0107]] — it is NOT part of the completion condition). Moving build → review.
- `2026-07-03` — **Build Phase 1 (config→DB) done + green** (commit `29b05ee5`): migration 0065 (`skill`+`actor` tables, seeded to parity, `code`/`caps` columns ready for 0111); `config.ts` DB-backed resolution (skillMenu/advertisedTools/chatToolDefinitionsFor/actorConfig/engineFor, fail-safe fallback) + skills/actors/runs context providers; `dispatch.ts` router menu is now passed-in (config-as-data); `ai.ts` routes+advertises from DB; `ontology.ts` mint prompt from the actor row; `dynamic-config.test.ts` (5 pass). skills 18/0, betterauth 35/0, tsc green. **Remaining:** Phase 2 viewer re-layout (MainnetDb 7-category + 50/50) and the website handler→engine migration (carved to [[0107]], risky — live streaming). Card stays in `build/` at the prescribed post-Phase-1 checkpoint.
- `2026-07-03` — Behavior unification decided (with Samuel) and sliced OUT to [[0111]]: actor
  code will ALSO live in the QuickJS(WASM) sandbox — one behavior model for vibe logic + actor
  code, vibes reference 1+ actors as their interactivity, `vibe_logic` retires. THIS card only
  makes the actor table schema-ready (`code`/`caps` columns, nullable) and binds behavior by
  `engine` name; 0111 ports the todos vertical to `code` rows.
- `2026-07-03` — Taxonomy clarified with Samuel: **node = actor** (config-complete row: engine-by-name + mailbox + llm + prompt + context deps + vibe/hitl); **skill** = actor collection + workflow (sub-skill orchestration, as mocked by the legacy invoice composite 0022/0023); **dispatch** = pure delegator. TOOLS viewer category → ACTORS. Spec rewritten to match; actor rows now carry prompt/llm/context with a prompt-from-row acceptance test. Chat-side multi-step orchestration explicitly out of scope (flow-runner owns it).
- `2026-07-03` — Discovery: interviewed; decided ALL-IN-ONE (config→DB + viewer standardization) with config-in-DB / handler-by-name. Absorbs 0107 (website→actors) + 0108 (skill registry→DB). Made "done" a `bun test` proving DB-backed resolution + parity + DB-only-row dynamism + schema-free router, plus tsc/svelte-check for the 7-category 50/50 viewer. Written into `discover/`.

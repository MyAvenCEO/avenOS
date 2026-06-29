---
title: Todos vertical end-to-end + the two-layer split (flow-config PG vs dynamic predications)
summary: Wire the todos vibe fully in the new architecture — todos→gismu predications (task/valid/due/prioritized) in the dynamic data_schema/data_value store, a project-planner flow skill + all skill/flow CONFIGS seeded into Neon as admin-owned Kysely-migrated PG tables, and the chat skill/tool snippets rewired. Establishes the rule: actor/flow/skill-config = PG migrations (admin); data_schema/data_value = dynamic AI/user predication roundtrips. aven-db CRDT untouched.
owner: claude
created: 2026-06-29
updated: 2026-06-29
tags: [postgres, schema, flow, ui, admin]
goal: On mainnet Neon — a Kysely migration creates an admin-owned `flow` table seeded with the existing example flows + a `project-planner` flow (`SELECT count(*) FROM flow` ≥ existing+1, and `SELECT id FROM flow WHERE id='project-planner'` returns a row); `pred:task`, `pred:valid`, `pred:due`, `pred:prioritized` exist in `data_schema`; a todo created via the rewired `data_crud` path writes a `task` + `valid` predication that `v_task` returns as open; the admin flow-CRUD route returns 403 for a non-admin and 200 for an admin (server test); `SkillsView`/`RunsView` load flows from the API not the static JSON import (grep shows no `EXAMPLE_FLOWS` import) and render only when `isAdmin`; and `bun run check`, `bun run lint`, and the new tests all exit 0.
---

# Todos vertical end-to-end + the two-layer split

## Context

Two storage layers, kept strictly apart (the keystone of this card — "you see the difference?"):

- **Layer A — system / actor / flow / skill-config** → **normal Postgres tables via Kysely migrations**, **admin-owned CRUD**. Static structure the platform ships. Today these are *static JSON files* (`libs/aven-skills/configs/flows.json` → `EXAMPLE_FLOWS`, imported directly by `SkillsView`/`RunsView`, no API, no gating). This card moves the **configs** (not instance runs) into seeded PG tables, admin-scoped.
- **Layer B — dynamic** → `data_schema` + `data_value` (`libs/betterauth/src/data.ts`), reserved for **dynamic AI/user-generated predication roundtrips**. The gismu-derived predicate vocab (`pred:*`) is seeded *here* (it's dynamic vocabulary), per board 0085.

**aven-db (Rust CRDT) is out of scope and untouched** — see [[avendb-crdt-vs-mainnet-postgres]].

Grounding facts (from the merged dev code):
- Flow types in `libs/aven-skills/src/flow.ts`: `Flow { id, name, description, nodes: RecipeNode[], edges: Edge[], triggers?, resourceLabels? }`, `RecipeNode`, `Edge`, `FlowRun`, `TraceStep`. Configs load via `import flowsJson from '../configs/flows.json'` → `EXAMPLE_FLOWS` (flow.ts:7,420). Runs = `runs.json` → `EXAMPLE_RUNS` (instance traces — **out of scope**, stay example/runtime).
- `SkillsView.svelte`/`RunsView.svelte` import `EXAMPLE_FLOWS`/`EXAMPLE_RUNS` directly, **no admin gate**; reached as sub-tabs inside `MainnetChat`.
- Admin: `user.role === 'admin'` (first signup = admin, `auth.ts`), `adminGate(c)` helper in `inbox.ts:92`, `isAdmin` in `MainnetShell.svelte:75`. Data API is user-scoped, no role gate (correct — Layer B stays user-scoped).
- Todos: `libs/aven-vibes/src/vibes/todos/tools.json` (a `data_crud`-backed `todos` tool), `TodosVibe.svelte` (`TODOS_SCHEMA {title, done}` via the data client), chat dispatch `todos`→`TodosVibe` via `VIBE_MARKER`/`aven_vibe` in `MainnetChat.svelte` (~line 680); server tool exec `executeDataTool` (data.ts:266) + `ai.ts` emits the vibe.
- **Self-contained / e2e:** the predicate **compiler** (definition→Ajv) + vocab seeding are BUILT IN THIS CARD (no dependency on 0085 being built first). [[universal-predication-schema-0084]] (0085) remains the broader *all-doctypes* vocab program; this card builds the compiler for the todos slice. Source of place structures = the [[ontology-gismu-skill]] lexicon (`.claude/skills/ontology/gismu.json`). Viewer sibling = [[0086-predication-aware-db-viewer]].

Clean DB reset is acceptable (Samuel clears Neon manually) — no need to preserve existing todo rows.

## Goal

The todos vibe works end-to-end as gismu predications in the dynamic store, a `project-planner` flow skill + all skill/flow configs live in admin-owned PG tables, the chat snippets are rewired, and the two-layer split is enforced.

**Completion condition** (identical to frontmatter `goal`):

> On mainnet Neon — a Kysely migration creates an admin-owned `flow` table seeded with the existing example flows + a `project-planner` flow (`SELECT count(*) FROM flow` ≥ existing+1, and `SELECT id FROM flow WHERE id='project-planner'` returns a row); `pred:task`, `pred:valid`, `pred:due`, `pred:prioritized` exist in `data_schema`; a todo created via the rewired `data_crud` path writes a `task` + `valid` predication that `v_task` returns as open; the admin flow-CRUD route returns 403 for a non-admin and 200 for an admin (server test); `SkillsView`/`RunsView` load flows from the API not the static JSON import (grep shows no `EXAMPLE_FLOWS` import) and render only when `isAdmin`; and `bun run check`, `bun run lint`, and the new tests all exit 0.

## Approach

**Predicate vocab (Layer B), gismu-sourced via the ontology skill.** Seed four `data_schema` rows (self-documenting Ajv per board 0085; `pattern` not `format`):
- `pred:task` — name `task`, gismu candidate `zukte`/`platu` (confirm in `gismu.json`): x1 agent (ref→user), x2 what (value string).
- `pred:valid` — reusable temporal (gismu `temci`/`ranji`): x1 fact (ref *), x2 from (value date-time), x3 to (value date-time|null). "done" = set x3.
- `pred:due` — gismu `detri`/`mokca`: x1 task (ref *), x2 date (value date-time).
- `pred:prioritized` — gismu `vajni`: x1 task (ref *), x2 level (value string|number).

A todo = `task` + `valid` (+ optional `due`/`prioritized` referencing the task id). `v_task` view projects open/done.

**Skill/flow config layer (Layer A).** Kysely migration adds a `flow` table modelling the `Flow` type (`id text pk, name, description, nodes jsonb, edges jsonb, triggers jsonb, resource_labels jsonb, created_at, updated_at`). A seed step inserts the current `EXAMPLE_FLOWS` + a new `project-planner` flow. Admin-only routes `/api/admin/flows` (GET/POST/PATCH/DELETE) wrapped with `adminGate`. `SkillsView`/`RunsView` fetch from `/api/admin/flows` (drop the static `EXAMPLE_FLOWS` import) and only render under `isAdmin`. **Runs (instance traces) stay out** — `EXAMPLE_RUNS` may remain a fixture for now.

**Project-planner skill** = a `Flow` config authored against the flow schema, bundling the todo tooling: e.g. node `plan` (LLM step, `system_prompt` "break the goal into tasks", `tools: ["todos"]`) → node `todos` (renders the `todos` vibe). Seeded into the `flow` table.

**Chat snippet rewire.** The `todos` tool (`tools.json`) + `TodosVibe.svelte` + the `MainnetChat` dispatch read/write the predication shape (task/valid/due/prioritized; open/done from valid) instead of `{title, done}`. The `data_crud`/`executeDataTool` path is reused unchanged (predications are just `data_value` rows).

**Out of scope:** instance-run persistence (runs stay fixtures), migrating non-todo doctypes (0085 program), the predication-aware viewer (0086), LLM predicate-minting, /ship cutover.

## Steps (small, checkpointed)

1. **Predicate vocab** — author task/valid/due/prioritized definitions (gismu-sourced from `gismu.json`), compile to Ajv, seed as `data_schema` rows; unit-test the compiler output. **Checkpoint.**
2. **Todos→predications** — migration/script: each todo → `task` + `valid` (+ due/priority if present); create `v_task` view. (Clean reset OK.) **Checkpoint.**
3. **Rewire todos tool + TodosVibe + chat dispatch** to the predication shape; data_crud path unchanged. Verify create/list/toggle round-trip. **Checkpoint.**
4. **Layer-A migration** — `flow` table; seed `EXAMPLE_FLOWS` + `project-planner`; admin CRUD routes with `adminGate`; server test for 403/200. **Checkpoint.**
5. **Wire SkillsView/RunsView to the API** (drop static import) + gate the whole Skills/Runs UI to `isAdmin`. **Checkpoint.**
6. **Verify** all criteria + repo gates.

## Files to touch

- `<server data pkg>/.../predicate/*` — the predicate compiler (definition→Ajv) + task/valid/due/prioritized defs (built here, e2e).
- `libs/betterauth/migrations/NNNN_flow_configs.ts` (new, Kysely) — `flow` table + seed (EXAMPLE_FLOWS + project-planner).
- `libs/betterauth/migrations/NNNN_predication_todos.ts` (new) — seed pred:* + migrate todos + `v_task` view.
- `libs/betterauth/src/flows.ts` (new) — admin flow CRUD handlers (`adminGate`-wrapped); `server.ts` route wiring.
- `libs/aven-vibes/src/vibes/todos/tools.json` — predication-shaped tool.
- `app/src/lib/shell/TodosVibe.svelte` — render task/valid/due/priority; `MainnetChat.svelte` dispatch unchanged-name `todos`.
- `app/src/lib/shell/SkillsView.svelte` + `RunsView.svelte` — fetch from API; `isAdmin` gate (in `MainnetChat`/`MainnetShell`).
- `libs/aven-skills/configs/flows.json` — add `project-planner` (also the seed source).
- `libs/aven-board/board/discover/0087-todos-vertical-two-layer-split.md` — this card.

## Acceptance criteria

Each provable from the transcript.

- [ ] `flow` table exists, admin-owned; seeded with example flows + `project-planner` — `SELECT count(*) FROM flow` and `SELECT id FROM flow WHERE id='project-planner'`.
- [ ] `pred:task`/`pred:valid`/`pred:due`/`pred:prioritized` in `data_schema` — `SELECT name FROM data_schema WHERE name LIKE 'pred:%'` returns all 4.
- [ ] A todo created via `data_crud` writes a `task` + `valid` predication; `SELECT * FROM v_task WHERE open` returns it — proven by a server/integration test.
- [ ] Admin flow-CRUD: non-admin → 403, admin → 200 — server test exercising `adminGate`.
- [ ] `SkillsView`/`RunsView` no longer statically import `EXAMPLE_FLOWS` (grep is empty) and fetch from the API; UI gated to `isAdmin` — component test + grep.
- [ ] `data_schema`/`data_value` remain user-scoped (no admin gate added there) — confirmed by diff.
- [ ] `bun run check`, `bun run lint`, and the new tests exit 0.

## Verification

```bash
bun run check
bun run lint
bun test libs/betterauth   # flow CRUD admin gate + todos predication round-trip
rg -n "EXAMPLE_FLOWS" app/src/lib/shell/SkillsView.svelte app/src/lib/shell/RunsView.svelte   # expect: no import
# Mainnet (via Neon, output in transcript):
#   SELECT count(*) FROM flow; SELECT id FROM flow WHERE id='project-planner';
#   SELECT name FROM data_schema WHERE name LIKE 'pred:%';
#   SELECT what, open FROM v_task;
```

## Hand-off

```
/aven-build 0087
```

## Progress log

Newest entry first.

- `2026-06-29` — Build ckpt 1 ✅ **the predicate engine** (the "Lojban system" core): `libs/aven-vibes/src/predicate/{compile,vocab,index}.ts` — definition→self-documenting-Ajv compiler + the 4 gismu-sourced todo predicates (task≡zukte, valid≡temci, due≡detri, prioritized≡vajni), `pattern` not `format`, `pred:<name>` schema names, `todoPredicateSchemas()` seed helper. Unit test `tests/predicate.test.ts` **5 pass / 31 assertions**. Typecheck clean for the new module (only `tsc` error is a pre-existing unrelated `skills/composer/edit.ts` node-types issue). Added `./predicate` package export. Moved discover→build.
  REMAINING (deploy-gated — the mainnet-SQL + UI criteria prove at review after Samuel's Neon reset + deploy): ckpt 2 seed pred:* + migrate todos + `v_task` (Kysely migration); ckpt 3 rewire todos tool/`TodosVibe`/chat dispatch; ckpt 4 `flow` table + seed + admin CRUD routes; ckpt 5 SkillsView/RunsView fetch-from-API + `isAdmin` gate.
- `2026-06-29` — Discovery: mapped merged flow engine (configs = static JSON, no admin gate), admin model (`role==='admin'`, `adminGate`, `isAdmin`), todos tool/vibe/chat dispatch, and the data layer. Locked: whole vertical in one card; todo = task+valid+due+prioritized; two-layer split = flow/skill configs in admin-owned Kysely PG tables vs dynamic predications in data_schema/data_value; runs/viewer/other-doctypes out of scope. Builds on 0085 (predicate compiler/vocab) + ontology gismu lexicon. Created in discover/.

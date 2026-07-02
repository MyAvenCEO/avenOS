---
title: Unified data_operations DSL — bundles compile to ops, todos 100% migrated
summary: Merge data_queries + data_mutations into ONE data_operations table (kind query|mutation); bundles stay the definition layer and DERIVE their standard ops as real rows; todos CRUD reroutes through the ops engine and its chat cards render from vibe.* registry rows — the whole skill becomes visible data, zero special code paths.
owner: claude
created: 2026-07-02
updated: 2026-07-02
tags: [data-brain, operations-dsl, bundles, vibes, todos]
goal: "`cd libs/betterauth && bunx tsc --noEmit` exits 0 and `bun --env-file=../../.env.samuel test tests` exits 0 including a new operations suite proving (a) migration: the pre-existing GLM specs (incl. m-i-ate-2-bananas) live in data_operations with the right kind and the old tables are gone, (b) deriveOps(todo bundle) emits list/create/update/delete data_operations rows, (c) PARITY: on a seeded fixture the derived todos.list returns exactly executeDataTool('todos' list).items and derived create/update/delete round-trip to the same projected state as the old engine, (d) executeDataTool('todos') reports via:'operations' (the CRUD path runs through the ops engine); `cd app && bun run check` reports 0 errors; live review gate: DB viewer shows Bundles + Operations (banana op visible — the 0-rows bug fixed) and todos chat cards render from vibe_view/style/logic registry rows."
---

# Unified data_operations DSL — bundles compile to ops, todos 100% migrated

## Context

After 0100–0103 every layer is AI-authorable, but the pieces are fragmented and
partly invisible:

- `data_queries` + `data_mutations` are two tables for one species (operations —
  one reads, one writes). **Merge decision (Samuel, 2026-07-02): ONE
  `data_operations` table, `kind: 'query' | 'mutation'`.**
- A **bundle** is a different species — a NOUN (the kind-definition: traits +
  view), not a verb. SQL analogy: bundles = DDL, operations = DML. **Decision:
  bundles do NOT fold into the ops table; instead they COMPILE to ops** — from
  the todo bundle the system derives `todos.list` / `todos.create` /
  `todos.update` / `todos.delete` as real `data_operations` rows, and the
  engine executes ONLY operations.
- Todos CRUD currently executes through a special path (`executeDataTool →
  runType` interpreting the bundle directly via the aven-ontology engine) — the
  operations exist nowhere as data. After this card, todos is 100% visible
  data: 1 bundle row + N derived ops rows + 3 vibe rows.
- **Bug found in discovery (live DB):** `data_mutations` HAS the
  `m-i-ate-2-bananas` row for the session user, yet the DB viewer shows
  "Mutations 0" — the registry display path silently returns empty. Must be
  diagnosed + fixed (no silent-empty: surface fetch errors).
- **Viewer gap:** Bundles (the `types` provider) are not in the DB viewer rail.
- **Vibes half-migrated:** `vibe_view/style/logic` rows are data (seeded from
  files — a seed source is fine), but chat cards still render through hardcoded
  Svelte (`TodosVibe` mode cards, `QueryVibe`, `OntologyVibe`, `BundleVibe`).
  The `all`-mode todos card already renders through the engine — the pattern
  exists; the rest must follow it.

Definitions (settled): **query** = ASK (read-only rows) · **mutation** = CHANGE
(atomic predication writes) · **bundle** = DEFINE A KIND (traits + view). An op
row is a TEMPLATE — execution is always scoped to the calling user (the engine
forces `user_id = uid`), so bundle-derived ops are global rows (user_id NULL)
while GLM-authored ones stay user-scoped.

Related: [[0101-dynamic-queries-mutations]], [[0102-dynamic-bundles]],
[[0103-reified-nested-facts]], vibe registry board 0095.

## Goal

One operations table, one execution engine, and the todos skill expressed 100%
as inspectable data — definition (bundle) → derived standard ops (operations) →
rendering (vibe rows) — with parity proven against the old engine before the
old path is retired.

**Completion condition** (= frontmatter `goal`):

> `cd libs/betterauth && bunx tsc --noEmit` exits 0 and `bun --env-file=../../.env.samuel test tests` exits 0 including a new operations suite proving (a) migration: the pre-existing GLM specs (incl. m-i-ate-2-bananas) live in data_operations with the right kind and the old tables are gone, (b) deriveOps(todo bundle) emits list/create/update/delete data_operations rows, (c) PARITY: on a seeded fixture the derived todos.list returns exactly executeDataTool('todos' list).items and derived create/update/delete round-trip to the same projected state as the old engine, (d) executeDataTool('todos') reports via:'operations'; `cd app && bun run check` reports 0 errors; live review gate: DB viewer shows Bundles + Operations (banana op visible) and todos chat cards render from vibe registry rows.

## Approach — five staged checkpoints, each green before the next

**Stage A — unify + visibility.** Migration: create `data_operations`
`(id, user_id text NULL, name, kind text CHECK (kind IN ('query','mutation')),
spec jsonb, derived_from text NULL, timestamps)`; copy rows from
`data_queries`/`data_mutations` with their kind; drop the old tables.
`query-caps.ts` reads/writes the new table; ONE `data_operations` context
provider (kind chip per row) replaces the two. DB viewer rail: Dynamic →
**Bundles** (the existing `types` provider) + **Operations**; diagnose + fix
the 0-rows bug (and stop swallowing fetch errors — show them).

**Stage B — bounded DSL growth** (`queries.ts`), exactly what todos needs:
- Query: `join[].kind: 'left'`; projection entries may be objects
  `{ place, as }` / `{ join: <index>, place, as }` / `{ join: i, exists: true,
  as }` (presence-boolean, e.g. `done`); keep the bare-place shorthand.
- Mutation: op-level `when: { param: <name> }` guard (skip when the param is
  null/absent); a new `update` op `{ op:'update', predicate, where, cells }`
  (patch places in place — a delete+insert would mint a NEW row id and break
  referents); reserved bind `{ bind: '$user' }` in cells/values, injected by
  the executor. All additive; existing specs stay valid.

**Stage C — bundles compile to ops.** Pure `deriveOps(bundle): OpRow[]` in
betterauth: list (left-join projection over the traits/view), create
(when-guarded inserts incl. `$user` binds), update (when-guarded
update/replace per trait), delete (cascade deletes over linked predicates).
`saveType` regenerates the bundle's derived ops on every save (`derived_from =
<bundle>`, global rows) — minting a bundle = minting its ops. Seed migration
derives the todos ops. Scope guard: `children` traits are NOT derivable yet —
`deriveOps` must throw/skip loudly (log which bundle fell back), never
silently cap.

**Stage D — reroute execution + parity.** `runOperation(uid, opName|row,
params)` executes any ops row through the 0101 engine. `executeDataTool`
routes a bundle's list/create/update/delete through its derived ops (result
carries `via: 'operations'`); the `runType` interpretation path stays ONLY as
the loud fallback for non-derivable bundles. The parity suite is the gate:
same fixture, old engine vs derived ops, identical projected results for all
four CRUD verbs — only then does the reroute land.

**Stage E — chat cards render from vibe rows.** Follow the existing
engine-render pattern (the todos `all` card): register `vibe_view/style/logic`
rows for the todos mode cards (`created`/`edited`/`deleted`) and the
`query-result`/`mutation-result`/`ontology`/`bundle-created` cards; one
generic vibe-host component replaces the per-card Svelte layouts in
chat/StepVibe (Svelte files retired as their registry row lands). If a card
needs a ViewDef primitive the engine lacks, extend the engine minimally —
surface it, don't fake it in Svelte. Checkpoint per card; this stage may land
card-by-card.

Out of scope: renaming `data_schema`/`data_value` (settled: keep); children
bundle derivation (loud fallback); GLM authoring UX changes; reuse-first spec
matching.

## Steps

1. Stage A — migration 0061 (merge + drop), query-caps on `data_operations`,
   `data_operations` provider, viewer rail (Bundles + Operations), 0-rows bug
   fixed + fetch errors surfaced. ✅ checkpoint: viewer shows the banana op.
2. Stage B — DSL growth (left join, object projection, exists, `when`,
   `update` op, `$user` bind) + unit tests per construct.
3. Stage C — `deriveOps` + saveType regeneration + todos seed migration +
   derive tests.
4. Stage D — `runOperation` + parity suite + reroute (`via: 'operations'`).
5. Stage E — vibe rows + generic vibe host per chat card; retire the Svelte
   layouts as each lands.
6. Full green pass; live human check (review gate).

## Files to touch

- `libs/betterauth/migrations/0061_*.ts` (+ a todos-ops seed migration) — merge + seed.
- `libs/betterauth/src/queries.ts` — DSL growth + `runOperation`.
- `libs/betterauth/src/query-caps.ts` — `data_operations` read/write + provider.
- `libs/betterauth/src/type-caps.ts` — `deriveOps` + saveType regeneration.
- `libs/betterauth/src/data.ts` — reroute `executeDataTool` (via:'operations').
- `libs/betterauth/src/db.ts` — `DataOperationsTable`.
- `libs/betterauth/tests/operations.test.ts` — migration/derive/parity suite.
- `app/src/lib/shell/MainnetDb.svelte` — Bundles + Operations entries, error surfacing.
- `app/src/lib/shell/` vibe host + `MainnetChat/StepVibe` — Stage E.
- `app/languages/en.json` / `de.json` — labels.

## Acceptance criteria

- [ ] Old tables gone; migrated rows (incl. `m-i-ate-2-bananas`) in `data_operations` with correct kind — proven by the operations suite + `\dt` check in tests.
- [ ] DSL: left join + object projection + exists + `when` + `update` + `$user` each covered by a unit test.
- [ ] `deriveOps(todo bundle)` emits the 4 standard ops; `saveType` regenerates them — proven by tests.
- [ ] PARITY: derived ops == old engine on the same fixture for list/create/update/delete — proven by the suite.
- [ ] `executeDataTool('todos')` result carries `via: 'operations'` — proven by a test.
- [ ] Viewer shows Bundles + Operations; the banana op visible; fetch errors no longer silent — live review gate + svelte-check 0 errors.
- [ ] Todos chat cards render from vibe registry rows (Svelte layouts retired per card) — live review gate.

## Verification

```bash
cd libs/betterauth && bunx tsc --noEmit
bun --env-file=../../.env.samuel test tests
cd ../../app && bun run check
```

## Hand-off

```
/aven-build 0104
```

## Progress log

- `2026-07-02` — Discovery: fact-checked the live DB (banana op EXISTS —
  viewer 0-rows is a display bug; bundles missing from the rail; vibes
  half-migrated). Settled definitions (query=ask, mutation=change,
  bundle=define-a-kind) and the shape: ops merge + bundles COMPILE to ops
  (SQL DDL/DML analogy) — confirmed by Samuel, who chose the staged mega-card
  over slicing. Spec written straight into discover/.

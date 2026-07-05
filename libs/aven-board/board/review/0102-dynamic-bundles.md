---
title: Dynamic bundles — GLM-authored composite types (TypeSpec) on the Brain skill
summary: The last seeded layer goes dynamic — GLM mints validated bundle recipes (traits + view) into predicate_type, immediately CRUD-able through the existing generic engine with zero new code.
owner: claude
created: 2026-07-02
updated: 2026-07-02
tags: [data-brain, ontology, ai-authoring, bundles]
goal: "`cd libs/betterauth && bunx tsc --noEmit` exits 0, `bun --env-file=../../.env.samuel test tests/dynamic-type.test.ts` exits 0 (all tests pass incl. the round-trip: author a `library` TypeSpec → create → list projects {title, owner} through executeDataTool), `cd app && bun run check` reports 0 errors, and the GLM authoring layer (a `create_bundle` brain action registered + dispatched, with a bundle vibe) compiles green — live GLM mint quality is the human check in review."
---

# Dynamic bundles — GLM-authored composite types on the Brain skill

## Context

Boards 0100/0101 made predicates (the relation vocabulary) and queries/mutations
(the operations) AI-authored at runtime. The one remaining **seeded** layer of the
data brain is the composite type: `TODO_SPEC` etc. are hand-written `TypeSpec`
config in `predicate_type`, seeded by migrations. The generic engine
(`executeDataTool → loadTypeSpec → runType` in `libs/betterauth/src/data.ts`,
engine in `libs/aven-ontology`) already runs CRUD/projection for ANY registered
spec with zero per-type code — so persisting a validated spec makes a new kind
("a book with an author and a rating") immediately usable.

**Taxonomy (settled in session, bundle-theory wording):** an **entity** is a live
bundle of **predications**; a **bundle** (the recipe, currently `TypeSpec`) is a
named set of **traits** (currently `PartSpec`) plus a **view** (the flat
projection, currently `project`). Table naming (settled 2026-07-02): keep
`data_schema`, `data_value`, `data_queries`, `data_mutations`; **rename
`predicate_type` → `data_bundles`** so the whole dynamic brain lives in one
`data_` namespace — this card includes that rename (a new `ALTER TABLE … RENAME`
migration + code refs in db.ts / data.ts / predicate-types.ts / type-caps.ts;
historical migrations stay untouched, they run before the rename on replay).

Related: [[0100-dynamic-ontology-skill]], [[0101-dynamic-queries-mutations]],
follow-on [[0103-reified-nested-facts]].

## Goal

A user can say "track books I read with a rating" in chat and get a working new
data kind — GLM authors the bundle (and any missing predicates), the engine
validates + persists it, and `data_crud` list/create/update/delete works on it
immediately, visible in the DB viewer.

**Completion condition:**

> `cd libs/betterauth && bunx tsc --noEmit` exits 0, `bun --env-file=../../.env.samuel test tests/dynamic-type.test.ts` exits 0 (all tests pass incl. the round-trip: author a `library` TypeSpec → create → list projects {title, owner} through executeDataTool), `cd app && bun run check` reports 0 errors, and the GLM authoring layer (a `create_bundle` brain action registered + dispatched, with a bundle vibe) compiles green — live GLM mint quality is the human check in review.

## Approach

Same two-slice shape as 0100/0101: deterministic engine first, GLM authoring on
top.

1. **Engine slice (DONE, commit `0f393338`)** — `libs/betterauth/src/type-caps.ts`:
   `TYPE_META_SCHEMA` (AJV meta-language for TypeSpec incl. recursive `childSpec`),
   `validateTypeSpec`, `saveType` (persist to `predicate_type`), `typePredicates`,
   the `types` transparency context provider, `typeCaps()`. Proven by
   `tests/dynamic-type.test.ts` (3 pass): meta-schema accept/reject, recursive
   childSpec, and the full round-trip through the SAME engine todos uses.
2. **GLM authoring slice (REMAINING)** — mirror the 0100 mint pattern:
   - `brainCaps`/a new cap: GLM-5.2 authors a bundle spec from plain language,
     grounded in the live predicate registry + the TypeSpec meta-language +
     existing bundles (reuse-first); missing predicates are minted first via the
     existing 0100 path (full gismu place structure).
   - a `create_bundle` action on the brain tool actor (or a sibling actor),
     registered + dispatched through the existing registry loop.
   - a bundle vibe (created recipe: traits + view) in chat/Runs/Skills.
   - migration: a `bundle` node on the Brain hub with attached context
     (`types` + `predicates` providers).

## Steps

1. ~~Engine slice: meta-schema + validate + persist + round-trip test.~~ (done)
2. Rename migration: `predicate_type` → `data_bundles` (+ db.ts type, data.ts
   loadTypeSpec, predicate-types.ts routes, type-caps.ts) — green before the
   authoring work stacks on it.
3. **Todos bundle → fully dynamic (retire the hardcoded specs).** VERIFIED
   (2026-07-02): the live table holds exactly one row (`todos`) and the runtime
   reads ONLY the DB — `TODO_SPEC` in code is dead at runtime, referenced only
   by historical migrations (0014/0025; legacy 0018/0020/0027/0029/0031 import
   DOCUMENT/INVOICE/COMPANY/PERSON/TRANSACTION specs) and by engine tests. So:
   freeze byte-identical JSON snapshots of each spec INLINE into those
   historical migrations (kysely tracks migrations by filename, so editing the
   import → inline JSON is replay-safe and decouples history from live code);
   delete `todo-spec.ts`, `document-spec.ts`, `invoice-spec.ts`,
   `contact-spec.ts` + their index exports from `libs/aven-ontology`; port
   `engine.test.ts` to inline synthetic specs (keep the discriminated-replace +
   todos coverage, no test loss). The `todos` bundle then exists ONLY as
   dynamic `data_bundles` config — same status a GLM-minted bundle has.
4. GLM cap: `mintBundle(request)` — author → AJV-validate → check referenced
   predicates exist (mint missing ones) → `saveType`.
5. Actor: `create_bundle` action, HITL not required (additive config), vibe.
6. Migration: Brain hub node + context; register vibe rendering (StepVibe/chat).
7. Green pass + live human mint check ("track books I read with a rating").

> Residual seed (explicitly OUT of scope, note for a follow-on): the per-user
> ATOMIC-predicate bootstrap (`ensurePredicateSchemas` seeding task/done/due/
> prioritized/owned_by from `aven-vibes` vocab.ts) is the last code-side seed —
> the predicate layer's equivalent of this step. Candidate: a "default bundle
> pack" seeded as data. See memory [[schema-actor-dynamic-predicates]].

## Files to touch

- `libs/betterauth/migrations/00XX_rename_data_bundles.ts` — `ALTER TABLE predicate_type RENAME TO data_bundles`.
- `libs/betterauth/src/db.ts` / `data.ts` / `predicate-types.ts` — table refs → `data_bundles`.
- `libs/betterauth/src/type-caps.ts` — table refs + add the GLM `mintBundle` authoring cap.
- `skills/tools/brain.ts` (or a sibling) — the `create_bundle` action.
- `skills/tools/types.ts` — extend `ToolCtx`.
- `libs/betterauth/src/ai.ts` — inject cap + record runs.
- `app/src/lib/shell/` — bundle vibe + StepVibe/chat wiring.
- `libs/betterauth/migrations/00XX_brain_bundle_node.ts` — hub node + context.

## Acceptance criteria

- [x] Meta-schema validates/rejects TypeSpecs incl. recursive childSpec — proven by `bun --env-file=../../.env.samuel test tests/dynamic-type.test.ts`.
- [x] A validated spec persisted via `saveType` is immediately CRUD-able through `executeDataTool` (create "Dune" → list projects `{title, owner}`) — same test.
- [x] Table renamed `predicate_type` → `data_bundles`; migrate exits "up to date" (0058), all 12 betterauth tests pass, tsc exit 0.
- [x] Hardcoded specs retired: the 4 domain specs deleted from `libs/aven-ontology/src` (only engine/index/memstore/types remain); 11 historical migrations repointed to a frozen `libs/betterauth/src/legacy-bundle-fixtures.ts` (byte-identical, never imported at runtime); `engine.test.ts` ported to inline fixtures — 8/8 aven-ontology tests pass, betterauth tsc 0, migrate up-to-date, 12/12 betterauth tests pass.
- [x] `bundle` actor (the create-a-kind action) registered + dispatched via the existing registry loop; caps injected in ai.ts; betterauth + skills tsc exit 0.
- [x] Bundle vibe (`BundleVibe.svelte`) renders in chat + Runs (StepVibe) — `cd app && bun run check` 0 errors; server restarted clean.
- [ ] Live human check: a chat request ("track books I read with a rating") mints a usable bundle (review gate).

## Verification

```bash
cd libs/betterauth && bunx tsc --noEmit
bun --env-file=../../.env.samuel test tests/dynamic-type.test.ts
cd ../../app && bun run check
```

## Hand-off

```
/aven-build 0102
```

## Progress log

- `2026-07-02` — Steps 4–6 done (GLM authoring): `type-caps.ts` gains
  `mintBundle` (GLM-5.2 authors a TypeSpec grounded in live predicates + the
  bundle meta-language + existing bundles, AJV-validated) + `typeCaps(uid)`
  (list/mint/save). New `skills/tools/bundle.ts` actor: author → mint any missing
  predicates via the `brain` (0100) → `saveType` → `bundle-created` vibe;
  registered + dispatched. `ai.ts` injects the cap + records the run.
  `BundleVibe.svelte` (traits + view + minted predicates) wired into chat +
  StepVibe. Migration 0059 adds the `bundle` node to the Brain hub with
  predicates+types context. Green: betterauth/skills tsc, app svelte-check 0
  errors, 12/12 tests, migrate up-to-date, server restarted clean. Remaining:
  live human mint check (review gate).
- `2026-07-02` — Step 3 done (retire hardcoded specs): verified the todos bundle
  is ALREADY runtime-dynamic (one `data_bundles` row, runtime reads DB only,
  TODO_SPEC runtime-dead). Deleted todo/document/invoice/contact specs from
  aven-ontology; froze their exact JSON as `betterauth/src/legacy-bundle-fixtures.ts`
  and repointed all 11 seed migrations to it (byte-identical replay, decoupled
  from live code); ported engine.test.ts to inline fixtures. Green: aven-ontology
  tsc + 8 tests, betterauth tsc + 12 tests, skills tsc, migrate up-to-date.
- `2026-07-02` — Step 2 done: migration 0058 renames `predicate_type` →
  `data_bundles` (table-only, `type` column kept); updated db.ts
  (PredicateTypeTable → DataBundlesTable), data.ts loadTypeSpec, predicate-types.ts
  routes, type-caps.ts + dynamic-type.test.ts. Green: tsc 0, migrate up-to-date,
  12/12 betterauth tests pass.
- `2026-07-02` — Filed retroactively into build/: the deterministic engine slice
  was built + committed (`0f393338`) before the card existed. Taxonomy settled
  (bundle/trait/view/entity; table renames out of scope). GLM authoring slice
  remains.

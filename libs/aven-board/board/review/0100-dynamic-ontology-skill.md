---
title: Dynamic self-validating ontology skill (GLM mints x1–x5 predicates)
summary: A GLM-5.2 ontology actor that reads existing predicate schemas + mints NEW validated x1–x5 Lojban predicates on the fly, on ONE consolidated data_schema registry with real x1–x5 columns
owner: aven (Claude Code)
created: 2026-07-02
updated: 2026-07-02
tags: [ontology, predication, skills, ai]
goal: "A NEW x1–x5 predicate can be defined + used with ZERO TypeScript changes — proven green: `cd libs/betterauth && bun test tests` (new ontology.test.ts: a novel predicate JSON-Schema seeded into data_schema validates a data_value written to its x1–x5 columns via AJV; a near-duplicate create resolves to the existing predicate; the todos suite still passes) AND `bun run check` exits 0, with the todos vertical still working end-to-end."
---

# Dynamic self-validating ontology skill (GLM mints x1–x5 predicates)

## Context

Board 0099 stripped avenOS to the Todos actor hub and proved the **CRUD/query engine
is already fully generic** (`runType(spec, args)` from a `TypeSpec` — "no domain code
per type"). What is NOT yet generic is the **atomic vocabulary**: the x1–x5 place
structures are hardcoded TS (`TODO_PREDICATES` in `libs/aven-vibes/src/predicate/vocab.ts`)
and seeded into `data_schema` by `ensurePredicateSchemas` (`libs/betterauth/src/data.ts`).
So adding a relationship today needs TS glue + a seed migration.

This card makes the ontology **fully dynamic + self-validating**, and adds the
**"schema" actor** ([[schema-actor-dynamic-predicates]]): alongside the todos skill, a
GLM-5.2 ontology skill that, from a plain-language request, **searches the predicates
already in the DB, reuses a match, or mints a NEW x1–x5 predicate** — gismu-inspired,
AJV-validated — and persists it as config. Two storage decisions (confirmed with the
user) make the foundation clean and DRY:

1. **ONE registry.** `data_schema` is the single source of every definition — each row a
   validated x1–x5 predicate JSON-Schema (the vocab). No new `predicate_vocab` table (it
   would duplicate `data_schema`). Composite `TypeSpec`s (todos) fold in as a `data_schema`
   row with `kind='type'`, retiring the separate `predicate_type` table → one registry
   serving `data_value`.
2. **Enforced x1–x5 shape.** Only Lojban x1–x5 predications are legal (no free-form), so
   `data_value` gets real columns `(id, user_id, predicate, x1, x2, x3, x4, x5)` instead of a
   jsonb blob. Columns enforce the *structure*; the `data_schema` AJV config validates the
   *values* per place. Every place becomes indexable/joinable.

Model: **GLM 5.2** (`glm-5-2`), reused via the existing Tinfoil path (`WEBSITE_MODEL` in
`skills/composer/edit.ts`). The **full raw `gismu.json`** (~1 MB, 1300+ roots at
`.claude/skills/ontology/gismu.json`) goes into the create/read tool system prompts —
GLM-5.2's ~1M-token window absorbs it. Per-interaction **vibe views** + **runs** mirror
the todos actor hub (0099): create (single + batch) and read each stream their own
engine-rendered card and record a run.

## Goal

A user can express any relationship in natural language and the system either reuses an
existing predicate or mints a new validated x1–x5 one — with no code change — on a single
`data_schema` registry backed by real x1–x5 columns.

**Completion condition** (identical to frontmatter `goal`):

> A NEW x1–x5 predicate can be defined + used with ZERO TypeScript changes — proven green:
> `cd libs/betterauth && bun test tests` (new `ontology.test.ts`: a novel predicate
> JSON-Schema seeded into `data_schema` validates a `data_value` written to its x1–x5
> columns via AJV; a near-duplicate create resolves to the existing predicate; the todos
> suite still passes) AND `bun run check` exits 0, with the todos vertical still working
> end-to-end.

The **LLM minting quality** (GLM picks the right gismu, fills sensible places) is
non-deterministic, so it is NOT in the goal — it's a human-checked acceptance criterion
(review). The goal proves the deterministic pipeline: consolidated registry + x1–x5
columns + AJV self-validation + dedup, with no regression.

## Approach

- **Storage foundation (deterministic, testable):**
  - Migrate `data_value` → columns `(id, user_id, predicate, x1, x2, x3, x4, x5, created_at, updated_at)`;
    backfill from the existing `data->>'xN'` jsonb. Update `aven-ontology` `pgStore`
    (`create`/`query`/`update`/`remove`) to read/write the columns instead of `data`.
  - Make `data_schema` the single vocab SSOT: `ensurePredicateSchemas` becomes GENERIC —
    it reads the predicate schemas from `data_schema` (no hardcoded `todoPredicateSchemas()`).
    Seed the 5 todo predicate schemas once via a migration (from `TODO_PREDICATES` →
    `compilePredicate`) so todos keeps working with zero per-request TS seeding.
  - (Optional, same card or follow-on) fold `predicate_type` `TypeSpec`s into `data_schema`
    rows with `kind='type'`; `loadTypeSpec` reads from there.
- **The GLM ontology actor** (`skills/tools/ontology.ts`, a `ToolActor` like `dataCrud`):
  - **read**: list the existing predicates in `data_schema` (name + x1–x5 places) → render
    the read-vibe. Prompt carries the full `gismu.json` for grounding.
  - **create** (single + batch): (1) DEDUP — first search existing `data_schema` predicates
    for a same/similar relation and REUSE it if found; (2) else prompt GLM-5.2 with the full
    `gismu.json` + the existing predicates to mint an x1–x5 `PredicateDef` (pick/adapt a
    gismu, fill place roles/kinds); (3) `compilePredicate` → AJV self-validate the produced
    schema; (4) persist to `data_schema`; (5) stream a create-vibe + record a run.
  - **CREATE PROMPT — canonical FULL place structure (pre-instruction):** the mint prompt
    hard-instructs GLM to define **ALL x1–x5 places the chosen gismu declares in `gismu.json`**
    (its complete, canonical place structure), each with its correct per-place AJV validation
    config (role/gloss + `kind` `ref`/`value` + type/`references`) — **even when the immediate
    request only fills a subset of them**. The stored predicate schema is the gismu's WHOLE place
    structure, never a request-trimmed one: a request that uses fewer places still persists the
    full x1–x5 schema (unused places declared, nullable). This keeps every minted predicate a
    faithful, reusable gismu — mirrors the existing `ref()`/`val()` "carry ALL of its gismu's
    places" rule in `libs/aven-vibes/src/predicate/compile.ts`.
  - Registered in the `@avenos/skills/tools` registry; dispatched by the chat loop exactly
    like `data_crud`; server caps (GLM key, data access) injected via `ctx`.
- **Vibes + runs**: `ontology` (read) + `ontology-created` vibe views (single + batch),
  engine-rendered like the todos modes; `recordActorRun` per firing so the Runs explorer
  shows ontology actions; `ActorConfig` surfaces the create/read tool schema + prompt.

**Out of scope (follow-on cards):** edit/delete of predicates + their vibes; a GLOBAL
(vs per-user) shared vocab; auto-generating composite `TypeSpec`s from minted predicates;
the schema-actor proposing whole new *types* (not just atomic predicates); embeddings-based
dedup (start with name/gloss + place-structure match).

## Steps

1. `data_value` x1–x5 columns migration + `pgStore` read/write on columns; todos suite green.
2. `data_schema` as the single vocab SSOT: generic `ensurePredicateSchemas` (reads DB, no TS
   list) + a migration seeding the 5 todo predicate schemas. Todos still works.
3. `ontology.test.ts` — the deterministic pipeline: seed a novel predicate schema → write a
   `data_value` to its x1–x5 columns → AJV validates; a near-duplicate create resolves to the
   existing one (dedup). This is the measurable goal.
4. The GLM ontology `ToolActor` (read + create, dedup-first, gismu-prompted, AJV-gated) in
   `@avenos/skills/tools`; registered + dispatched.
5. `ontology` + `ontology-created` vibe views (single + batch) + runs wiring + `ActorConfig`.
6. `bun run check` / `bun run lint` green; verify todos + a live "people can own companies"
   mint by hand (acceptance).

## Files to touch

- `libs/betterauth/migrations/NNNN_*.ts` — data_value x1–x5 columns + backfill; seed todo predicate schemas into data_schema.
- `libs/aven-ontology/src/*` (pgStore) — read/write x1–x5 columns.
- `libs/betterauth/src/data.ts` — generic `ensurePredicateSchemas` (read from data_schema).
- `skills/tools/ontology.ts` (+ `registry.ts`, `index.ts`) — the GLM ontology actor.
- `libs/betterauth/src/ai.ts` — dispatch + runs for the ontology actor (already registry-driven).
- `app/src/lib/shell/OntologyVibe.svelte` (+ StepVibe/MainnetChat wiring) — create/read vibe views.
- `libs/betterauth/tests/ontology.test.ts` — the deterministic proof.

## Acceptance criteria

- [ ] `cd libs/betterauth && bun test tests` green, incl. `ontology.test.ts` — proven by test output.
- [ ] A novel predicate schema seeded into `data_schema` validates a `data_value` written to its
      x1–x5 columns via AJV — asserted in `ontology.test.ts`.
- [ ] A near-duplicate create resolves to the EXISTING predicate (no new row) — asserted in the test.
- [ ] A minted predicate carries the gismu's FULL place structure: every place the gismu declares in
      `gismu.json` is present in the stored schema with a valid per-place config, even when the request
      filled only a subset (e.g. a 4-place gismu → x1–x4 all present) — asserted with a fixed mint in the
      test + human-checked live.
- [ ] Todos vertical still works: existing todos tests + a manual add/edit/delete round-trip.
- [ ] `bun run check` and `bun run lint` exit 0.
- [ ] (Human/review) A live chat "people can own companies" → GLM reuses or mints a sensible
      `ponse`-family x1–x5 predicate, renders the create-vibe, and shows a run.

## Verification

```bash
cd libs/betterauth && bun test tests      # ontology.test.ts + todos suite green
bun run check                             # svelte-kit sync + svelte-check + docs
bun run lint                              # biome
# live acceptance (manual): chat a novel relationship, inspect data_schema + the vibe + the run
```

## Hand-off

```
/aven-build 0100
```

## Progress log

Newest entry first.

- `2026-07-02` — FULL build done (steps 4-5, the human-acceptance layer) + LIVE-verified. New `ontology`
  ToolActor: `read` (list the data_schema predicate registry) + `create` (deterministic dedup gate →
  GLM-5.2 mint → compilePredicate → AJV self-validate → persist to data_schema). Server adapter
  `libs/betterauth/src/ontology.ts` loads the full `gismu.json` into the mint prompt + enforces the FULL
  place structure; `ToolCtx` gains injected `ontology` caps; `ai.ts` injects them + records `ontology`
  runs. `OntologyVibe` renders read/created everywhere (chat + Runs + Skills preview via StepVibe
  delegation). Migration 0050 seeds the `ontology` actor hub. LIVE PROOF (human-acceptance criterion):
  "a person can be a member of a project" → GLM-5.2 chose gismu `cmima` → minted `member_of` (x1 member ·
  x2 set, full place structure) → AJV-validated → persisted. Green: skills/betterauth tsc, app svelte-check,
  betterauth 4 tests. NOTE: mint is ~50s (the ~900k-char gismu prompt) — a compact gismu projection /
  streaming is the obvious latency follow-on. Also follow-on: edit/delete of predicates.
- `2026-07-02` — BUILD (measurable goal MET + proven green). Foundation done: (1) `data_value` has real
  `(predicate, x1..x5)` columns + indexes; `pgStore` + the history trigger read/write them (migration 0049);
  todos create/update/delete round-trips on the columns. (2) `ensurePredicateSchemas` is generic — `data_schema`
  is the single vocab registry, resolving EVERY predicate (todo + minted) from the DB by the `predicate`
  discriminator, so a new relation = insert a `data_schema` row, ZERO TS. (3) `skills/tools/ontology.ts` pure
  core (`findExistingPredicate` dedup + `CREATE_INSTRUCTIONS` full-place rule) + `ontology.test.ts` proving a
  novel predicate is AJV self-validating with its gismu's FULL place structure + dedup reuses an existing one.
  **Verified:** `cd libs/betterauth && bun test tests` = 4 pass / 0 fail; betterauth tsc, app svelte-check,
  aven-vibes 16 tests all green. **REMAINING (human-acceptance, non-deterministic — the card's own out-of-metric
  slice):** the GLM-5.2 create/read ToolActor (load full `gismu.json` → dedup → mint → AJV-gate → persist to
  `data_schema`), its `ontology`/`ontology-created` vibe views, and runs wiring. Follow-on build; the
  deterministic pipeline it sits on is proven.
- `2026-07-02` — Spec update (user): the CREATE mint prompt must always define the chosen gismu's FULL
  x1–x5 place structure (all places the dictionary declares) with correct per-place AJV configs, even
  when the request only fills a subset — the stored schema is the canonical gismu, never request-trimmed.
  Added to Approach (create) + a new acceptance criterion.
- `2026-07-02` — Discovery. Uncovered the goal (fully-dynamic self-validating ontology skill,
  GLM-5.2, full gismu prompt, create-with-dedup + read, vibes + runs like todos). Confirmed the
  two load-bearing storage decisions: (1) consolidate the vocab into the single `data_schema`
  registry — NO separate `predicate_vocab` table; (2) enforce x1–x5 with real `data_value`
  columns. Carved the measurable first slice = the deterministic foundation (registry + columns +
  AJV + dedup) proven by `ontology.test.ts` + `bun run check`, with LLM minting quality as a
  human-checked acceptance criterion. Edit/delete of predicates, global vocab, and composite-type
  auto-gen noted as follow-ons. Created directly in discover/.

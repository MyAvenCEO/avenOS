---
title: Dynamic GLM-authored queries + mutations as validated specs over the x1–x5 store
summary: data_queries + data_mutations tables hold AJV-validated JSON specs; a generic executor compiles them to safe parameterized SQL / transactional predication writes; GLM authors them on the fly as new ontology-skill actors
owner: aven (Claude Code)
created: 2026-07-02
updated: 2026-07-02
tags: [ontology, predication, queries, mutations, ai]
goal: "A validated query spec (filter + join + count) and a validated mutation spec run correctly over the x1–x5 store with ZERO per-query/mutation code — proven green: `cd libs/betterauth && bun test tests` (new queries.test.ts: over seeded predications, a filter+join+count query spec returns the correct rows incl. a HAVING threshold; a malformed spec is AJV-rejected; a transfer mutation spec applies the correct predication writes transactionally and a bad op rolls back) AND `bun run check` exits 0, with todos + the brain skill still working."
---

# Dynamic GLM-authored queries + mutations as validated specs over the x1–x5 store

## Context

Board 0100 made the DATA layer self-extending at the SCHEMA level: [[schema-actor-dynamic-predicates]]
— GLM-5.2 mints validated x1–x5 predicates into `data_schema`, and `data_value` now has real
`(predicate, x1..x5)` columns (migration 0049). But the OPERATIONS are still fixed: `data_crud` only does
`list` (return all) / `create` / `update` / `delete` via a type's `TypeSpec`. There is no way to *query*
across predications (filter / join / aggregate) or to run a *custom multi-predicate mutation* — and no way
for the system to author new ones on the fly.

This card adds the next config-driven layer: **queries + mutations as validated JSON specs, stored in
Postgres, GLM-authored, executed by a generic engine** — mirroring exactly how 0100 does predicates. The
x1–x5 columns make it feasible: a query is a declarative spec over indexed columns that compiles to ONE
safe parameterized SQL; a mutation is a validated, transactional list of predication writes.

**Load-bearing decisions (confirmed with the user):**
1. **Both queries AND mutations** in this card (not queries-only).
2. **Two tables — `data_queries` + `data_mutations`** — each an AJV-validated JSON spec, named like the
   rest of the store (`data_schema`/`data_value`).
3. **Filter + join + count** expressiveness (enough for "people who own > 3 companies"); full algebra
   (sum/avg/nested/order) is a follow-on.
4. **SAFETY — GLM authors a validated SPEC, NEVER raw SQL.** The executor compiles the spec to a single
   parameterized SQL (queries) or a transactional predication-write sequence (mutations). Destructive
   mutations (any `delete` op) are HITL-gated like `data_crud` delete.

New actors extend the brain skill (the self-extending data hub): `create_query` / `run_query` /
`create_mutation` / `run_mutation`. Each stored spec is inspectable through the universal context panel
(board 0100) so you can see the compiled SQL / op list.

## Goal

The system can define and run new relationship queries + multi-predicate mutations from natural language,
as validated specs, with no code change — safely (validated specs → parameterized SQL, never raw).

**Completion condition** (identical to frontmatter `goal`):

> A validated query spec (filter + join + count) and a validated mutation spec run correctly over the
> x1–x5 store with ZERO per-query/mutation code — proven green: `cd libs/betterauth && bun test tests`
> (new `queries.test.ts`: over seeded predications, a filter+join+count query spec returns the correct
> rows incl. a HAVING threshold; a malformed spec is AJV-rejected; a transfer mutation spec applies the
> correct predication writes transactionally and a bad op rolls back) AND `bun run check` exits 0, with
> todos + the brain skill still working.

The **GLM authoring quality** (it writes a sensible spec from NL) is non-deterministic → NOT in the goal;
it's a human-checked acceptance criterion. The goal proves the deterministic engine: spec language + AJV
validation + query executor (filter/join/count) + mutation executor (transactional) + no regression.

## Approach

- **Storage:** two tables `data_queries` / `data_mutations` — `(id, user_id, name, spec jsonb, ...)`. A spec
  is AJV-validated against a fixed META-SCHEMA (the spec language) before it's stored OR run.
- **Query spec + executor (deterministic):** spec = `{ from: predicate, where: [{place, op, value|param}],
  join: [{predicate, on: {place: ref}}], group_by?: place, count?: {having: {op, value}}, project: [places] }`.
  A generic compiler turns a validated spec + runtime params → ONE parameterized SQL over
  `data_value(predicate, x1..x5)` (Kysely expression builder, bound params — no string interpolation). Ops
  limited to a safe allow-list (`eq/neq/gt/gte/lt/lte/in`). Returns rows.
- **Mutation spec + executor (deterministic, transactional):** spec = `{ params: [...], ops: [{op: 'insert'
  |'delete', predicate, where?: [...], cells?: {place: value|param}}] }`. The executor runs all ops in ONE
  transaction (all-or-nothing); any `delete` op makes the whole mutation HITL-gated (confirm before run),
  like `data_crud` delete. Never raw SQL — each op compiles to a parameterized insert/delete.
- **GLM authoring actors (on the ontology skill):** `create_query` / `create_mutation` — GLM writes a spec
  from NL (grounded in the existing predicates + the meta-schema), AJV-validated, persisted. `run_query` /
  `run_mutation` — execute a stored spec by name with params. All via the registry/`ToolCtx` pattern (0099).
- **Transparency:** `data_queries` / `data_mutations` context providers (board 0100) so a spec + its
  compiled SQL / op list is inspectable in the Skills/Runs aside. Vibes for query results + mutation diffs.

## Steps

1. `data_queries` + `data_mutations` tables (migration) + the meta-schema + AJV validation of a spec.
2. Query executor: compile a validated `{from, where, join, group_by, count, project}` spec + params → ONE
   parameterized SQL; run it. Deterministic.
3. Mutation executor: compile a validated `{ops}` spec → a single transaction of parameterized
   insert/delete predication writes; destructive → HITL. Deterministic.
4. `queries.test.ts` — THE measurable proof (seed predications → query returns correct rows incl. HAVING;
   malformed spec AJV-rejected; transfer mutation applies correctly + rolls back a bad op).
5. GLM `create_query`/`create_mutation` + `run_query`/`run_mutation` actors on the ontology skill; register
   + dispatch; context providers + result/diff vibes + runs.
6. `bun run check`/`bun run lint` green; todos + ontology still work; live human-check a NL query + mutation.

## Files to touch

- `libs/betterauth/migrations/NNNN_*.ts` — data_queries + data_mutations tables; seed the meta-schema.
- `libs/betterauth/src/queries.ts` (new) — spec meta-schema, AJV validate, query compiler+runner, mutation
  compiler+runner (transactional), the `create_/run_` actor caps.
- `skills/tools/queries.ts` (new) — the query/mutation ToolActors (config + behavior, ctx-injected).
- `libs/betterauth/src/ai.ts` — inject the caps + record runs (registry-driven already).
- `app/src/lib/shell/QueryVibe.svelte` (+ dispatch/StepVibe) — query results + mutation diff vibes.
- `libs/betterauth/tests/queries.test.ts` — the deterministic proof.

## Acceptance criteria

- [ ] `cd libs/betterauth && bun test tests` green incl. `queries.test.ts` — proven by test output.
- [ ] A filter+join+count query spec over seeded predications returns the correct rows, incl. a HAVING
      threshold (e.g. owners with > 3 `owned_by`) — asserted in the test.
- [ ] A malformed query/mutation spec is AJV-rejected (never reaches SQL) — asserted in the test.
- [ ] A `transfer_ownership` mutation spec applies the right predication writes in ONE transaction, and a
      spec with a bad op rolls back with NO partial writes — asserted in the test.
- [ ] The query executor emits parameterized SQL (bound params), never string-interpolated values — proven
      by a test asserting an injection-y param value is treated as data, not SQL.
- [ ] Todos + the ontology skill still work; `bun run check` and `bun run lint` exit 0.
- [ ] (Human/review) A live NL "who owns more than 3 companies?" → GLM authors a valid query spec that runs;
      "transfer ownership of X from A to B" → a valid mutation (HITL-confirmed) applies.

## Verification

```bash
cd libs/betterauth && bun test tests      # queries.test.ts + existing suites green
bun run check                             # svelte-kit sync + svelte-check + docs
bun run lint                              # biome
# live acceptance (manual): a NL query + a NL mutation, inspect the compiled SQL/ops in the context panel
```

## Hand-off

```
/aven-build 0101
```

## Progress log

Newest entry first.

- `2026-07-02` — Discovery. Uncovered the goal: the next self-extending-data layer after 0100's dynamic
  schema — dynamic QUERIES + MUTATIONS as validated JSON specs over the x1–x5 store, GLM-authored, run by a
  generic engine. Confirmed load-bearing decisions: (1) both queries AND mutations this card; (2) two tables
  `data_queries` + `data_mutations` (AJV-validated specs); (3) filter+join+count expressiveness; (4) SAFETY —
  GLM authors a validated SPEC, never raw SQL; executor compiles to parameterized SQL / transactional writes,
  destructive mutations HITL-gated. Measurable first slice = the deterministic engine (spec validation + query
  executor + mutation executor) proven by `queries.test.ts` + `bun run check`; GLM authoring quality = human
  acceptance. Follow-ons: full query algebra (sum/avg/nested/order/pagination), a visual builder, mutations as
  reusable "recipes". Created directly in discover/.

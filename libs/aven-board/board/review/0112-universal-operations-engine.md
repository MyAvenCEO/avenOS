---
title: One universal operations engine — chained graph joins, DB-stored, GLM-authorable
summary: The ONLY data path is runOperation over data_operations specs; the query grammar gains chained (arbitrary-explicit-depth) joins; the redundant runtime composite path is deleted; the GLM authoring prompts move into the actor rows.
owner: claude
created: 2026-07-03
updated: 2026-07-03
tags: [betterauth, data-engine, predications, first-principles]
goal: "`bun --env-file=.env.samuel test libs/betterauth/tests/` exits 0 (including a NEW chain-join test proving a 3-level referent chain query over the live store), `bunx tsc --noEmit -p libs/betterauth/tsconfig.json` exits 0, `cd app && bunx svelte-check` reports 0 errors, AND `grep -rnE \"executeDataTool|runViaOps|runTypeInterpreted|loadTypeSpec\" libs/betterauth/src skills` produces NO matches (the runtime composite path is deleted end-to-end), AND a test proves queryCaps/mutationCaps read their authoring instructions from the query/mutate actor rows' prompt column."
---

# One universal operations engine — chained graph joins, DB-stored, GLM-authorable

## Context

The north star (boards 0085/0102/0103, memory `all-dynamic-data-is-predications`):
ALL dynamic data is x1–x5 predications; ALL operations are validated JSON specs
(`QuerySpec`/`MutationSpec`) in `data_operations`, compiled by ONE engine
(`queries.ts` `runOperation`) into parameterized SQL. Vocab (`data_schema`),
types (`data_bundles`), vibes (`vibe_*`), skills/actors (`skill`/`actor`) are all
DB config already. Board 0107 (this session) collapsed chat/HTTP CRUD onto
`crud()` → named ops, added join-targeted filters + `isnull`/`notnull`, and made
list filtering universal over the projection.

Three foundational gaps remain between the code and the principle — this card
closes all three. It is the FOUNDATION for the follow-on end goal (0113, ideate):
GLM authors complete new skills (mint gismu vocab → seed ops → author vibes →
register skill/actor rows) with zero deployed code.

1. **No graph depth.** `JoinSpec.on.base` can only reference the BASE row
   (star-shaped, depth 1). A chain task→referent→referent (reified quantities,
   entity graphs — the 0103 model) is inexpressible. "Arbitrary depth" =
   **chained joins**: a join may correlate to any EARLIER join. (Full recursive
   closure/CTEs deliberately out of scope — a later grammar extension.)
2. **A second engine still exists.** `data.ts` keeps the runtime composite-type
   path — `executeDataTool` → `loadTypeSpec` → `runType` → `runViaOps` /
   `runTypeInterpreted` (the aven-ontology interpreter) — even though bundle ops
   are ALREADY seeded into `data_operations` at mint time (`type-caps.ts`
   `regenerateDerivedOps`). Proven redundancy (~350 lines): it re-derives at
   runtime what mint-time already persisted. Delete it; `deriveOps` survives
   ONLY as the mint-time seeder.
3. **The GLM authoring prompt is code, not config.** `QUERY_INSTRUCTIONS` /
   `MUTATION_INSTRUCTIONS` are hardcoded in `query-caps.ts`. They must live on
   the `query`/`mutate` ACTOR rows' `prompt` column (config-as-data SSOT, TS
   constant kept only as the fail-safe seed/fallback — the config.ts pattern),
   so a future GLM-minted skill can carry its own authoring prompt.

Decisions confirmed with Samuel (2026-07-03): chained joins not recursion; the
elimination folds into THIS card (one card = one engine, leaving a second engine
alive contradicts the goal); prompts move to the DB.

## Goal

Every data read/write in the system flows through the ONE spec engine over
`data_operations`; the grammar expresses explicit-depth predication graphs; the
authoring layer is DB config.

**Completion condition** (identical to frontmatter `goal`):

> `bun --env-file=.env.samuel test libs/betterauth/tests/` exits 0 (including a
> NEW chain-join test proving a 3-level referent chain query over the live
> store), `bunx tsc --noEmit -p libs/betterauth/tsconfig.json` exits 0,
> `cd app && bunx svelte-check` reports 0 errors, AND
> `grep -rnE "executeDataTool|runViaOps|runTypeInterpreted|loadTypeSpec" libs/betterauth/src skills`
> produces NO matches (the runtime composite path is deleted end-to-end), AND a
> test proves queryCaps/mutationCaps read their authoring instructions from the
> query/mutate actor rows' prompt column.

## Approach

Three slices, one card. Elimination-first mindset (compact-simplify-consolidate):
don't optimize the second engine — delete it after 100% migration of its callers.

**S1 — chained joins (the grammar).** In `queries.ts`, extend
`JoinSpec.on.base: Place | 'id' | { join: number; place: Place | 'id' }` — a
join may correlate to any STRICTLY EARLIER join's alias (fail-closed: forward
refs and self-refs are AJV/compile errors, mirroring the `{ref:N}` mutation
rule). `where`/`project` already target joins by index — unchanged. One flat
parameterized SQL as today; every value still bound; places still allow-listed.
New test: seed `task → quantity(ref) → unit(ref)` (3 levels) and prove the chain
query projects across all three; plus a compile-error test for a forward ref.

**S2 — delete the second engine.** Migrate the 3 caller sites to the universal
path, then delete:
- `skills-run.ts`: `loadTypeSpec(kind)` existence-check + `executeDataTool`
  create → check `<kind>.create` exists in `data_operations` (fetchOp) + `crud()`.
- `tests/operations.test.ts` + `tests/dynamic-type.test.ts`: assert through
  `crud()`/`runOperation` instead of `executeDataTool`/`runViaOps`/
  `runTypeInterpreted` (same behavioral assertions — parity is the point).
- THEN delete from `data.ts`: `executeDataTool`, `runType`, `runViaOps`,
  `runTypeInterpreted`, `loadTypeSpec`, and the now-unused aven-ontology
  interpreter imports (`create/query/remove/update`, `pgStore` wiring if
  orphaned). `deriveOps` + `type-caps.ts` mint-time seeding stay untouched.
  `skills/tools/types.ts` ctx.data doc-comment updated.

**S3 — authoring prompts → actor rows.** Migration 0071 writes
`QUERY_INSTRUCTIONS` (upgraded: teach chained-join grammar + the 0107
filter/null-op grammar) into the `query` actor's `prompt` and
`MUTATION_INSTRUCTIONS` into `mutate`'s. `authorSpec()` in `query-caps.ts` reads
the prompt via `actorConfig(name)` with the TS constant as fail-safe fallback
(exactly config.ts's seed-fallback pattern — no new abstraction). Test: the live
authoring path uses the DB prompt (e.g. mutate the row to a sentinel, observe it
in the built system prompt).

Out of scope: recursive closure queries; the GLM skill-minting flow (0113);
collapsing the per-todos REST handlers; any UI work.

## Steps

1. S1 grammar: `JoinSpec` chained `base`, AJV meta-schema, compile with
   earlier-join aliasing + fail-closed ref checks. `tsc` green.
2. S1 test `tests/chain-join.test.ts`: 3-level referent chain over the live
   store; forward-ref rejection. Suite green.
3. S2 migrate `skills-run.ts` to fetchOp-existence + `crud()`. Suite green.
4. S2 migrate `operations.test.ts` + `dynamic-type.test.ts` to the universal
   path (same assertions). Suite green.
5. S2 delete the dead symbols + interpreter imports from `data.ts`; grep proves
   no matches. `tsc` + svelte-check green.
6. S3 migration 0071 seeds both actor prompts (with the upgraded grammar);
   `authorSpec` reads prompt-from-actor with TS fallback; prompt-SSOT test.
7. Full verification block; update the card's Progress log; `git mv` → build
   happens via `/aven-build 0112`.

## Files to touch

- `libs/betterauth/src/queries.ts` — chained `JoinSpec.on.base` (type + AJV + compile, fail-closed).
- `libs/betterauth/tests/chain-join.test.ts` — NEW: 3-level chain + forward-ref rejection.
- `libs/betterauth/src/skills-run.ts` — universal path (fetchOp existence + `crud()`).
- `libs/betterauth/tests/operations.test.ts`, `tests/dynamic-type.test.ts` — assert via `crud()`/`runOperation`.
- `libs/betterauth/src/data.ts` — DELETE executeDataTool/runType/runViaOps/runTypeInterpreted/loadTypeSpec + interpreter imports (~350 lines out).
- `libs/betterauth/src/actor-run.ts` — export `fetchOp` for skills-run (already exists internally).
- `libs/betterauth/src/query-caps.ts` — prompt-from-actor (fallback = TS constant); grammar upgrade in the constants.
- `libs/betterauth/migrations/0071_authoring_prompts.ts` — NEW: seed query/mutate actor prompts.
- `libs/betterauth/tests/query-caps-prompt.test.ts` — NEW: prompts read from the actor rows.
- `skills/tools/types.ts` — ctx.data doc-comment (no behavioral change).

## Acceptance criteria

- [ ] A 3-level chained-join query (base → join0 via ref → join1 via join0) returns the correct rows over the live store — proven by `bun --env-file=.env.samuel test libs/betterauth/tests/chain-join.test.ts` (0 fail).
- [ ] A join referencing a forward/self join index is REJECTED before SQL — proven by the same test file (assertion on the thrown error).
- [ ] `grep -rnE "executeDataTool|runViaOps|runTypeInterpreted|loadTypeSpec" libs/betterauth/src skills` → no output (exit 1).
- [ ] The composite-type behavioral assertions still pass through the universal path — proven by `operations.test.ts` + `dynamic-type.test.ts` in the suite run.
- [ ] queryCaps/mutationCaps build their system prompt from the actor rows — proven by `query-caps-prompt.test.ts` (0 fail).
- [ ] Full suite: `bun --env-file=.env.samuel test libs/betterauth/tests/` → 0 fail.
- [ ] `bunx tsc --noEmit -p libs/betterauth/tsconfig.json` exits 0 and `cd app && bunx svelte-check --tsconfig ./tsconfig.json` reports 0 errors.
- [ ] Net line count of `libs/betterauth/src/data.ts` decreases by ≥300 lines — proven by `wc -l` before/after in the transcript.

## Verification

```bash
bun --env-file=.env.samuel test libs/betterauth/tests/            # 0 fail (incl. chain-join + prompt tests)
bunx tsc --noEmit -p libs/betterauth/tsconfig.json                 # exit 0
(cd app && bunx svelte-check --tsconfig ./tsconfig.json)           # 0 errors
grep -rnE "executeDataTool|runViaOps|runTypeInterpreted|loadTypeSpec" libs/betterauth/src skills; echo "grep exit: $?"   # no matches, exit 1
wc -l libs/betterauth/src/data.ts                                  # ≥300 lines below the pre-card 790
```

## Hand-off

```
/aven-build 0112
```

…or hand the condition straight to the goal loop:

```
/goal <paste the Completion condition above>
```

## Progress log

Newest entry first.

- `2026-07-03` — Built, all green → review. S1 chained joins (grammar + AJV + fail-closed compile; chain-join.test 3-level item→quantity→unit over the live store + forward/self-ref rejection). S2 second engine DELETED after 100% caller migration (skills-run → fetchOp+crud; schemasPromptHint + listDataType → crud; operations.test re-anchored from the retired interpreter-parity gate to crud()→seeded-ops on a FRESH user; dynamic-type.test → crud). NEW vocab.ts carries the per-user bootstrap at the crud() seam. data.ts 790→454 (−336). S3 authoring prompts seeded onto the query/mutate actor rows (migration 0071, chain grammar included); authoringInstructions() DB-first + TS fail-safe; query-caps-prompt.test proves seeded/sentinel/fallback. Verification: suite 62/0 · tsc 0 · svelte-check 0 errors · dead symbols grep-empty · −336 lines.

- `2026-07-03` — Discovery: replanned from scratch with Samuel. Vision = ONE universal JSON operations engine (query+mutate, chained graph joins over x1–x5, DB-stored, GLM-authorable) as the foundation for GLM-authored complete skills (split out as follow-on 0113). Decisions: chained joins not recursion; elimination of the runtime composite path folds into this card; authoring prompts move to the query/mutate actor rows. Audit grounded in the 0107 session work (crud() collapse, universal filter, join-filters/null-ops already landed).

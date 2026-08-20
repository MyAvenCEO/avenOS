---
title: Reified nested facts — cross-op referents in mutations + reify-first authoring
summary: Keep (predicate, x1..x5) as the ONLY fact shape; nested "clusters" (e.g. "2 bananas") become reified referents — a mutation spec op can bind a previous insert's generated id, and GLM authoring reifies structured slot-fillers instead of packing strings.
owner: claude
created: 2026-07-02
updated: 2026-07-02
tags: [data-brain, ontology, query-engine]
goal: "`bun --env-file=../../.env.samuel test tests/queries.test.ts` exits 0 with new tests proving: (1) a mutation spec whose insert cell `{\"ref\": 0}` binds op 0's generated row id executes transactionally (\"I ate 2 bananas\" → 3 predications sharing referent B: banana(row=B), quantity(x1=B,x2=\"2\"), eat(x1=me,x2=B)); (2) a join query over the referent reads the quantity through it (`Number(row.x2) === 2`) and the join correlates on the real referent id; (3) a forward/self ref AND a ref to a delete op each roll the transaction back; and `cd libs/betterauth && bunx tsc --noEmit` exits 0 with no regression in the other queries tests."
---

# Reified nested facts — cross-op referents + reify-first authoring

## Context

Session design decision (2026-07-02), triggered by a live 0101 result: the mutate
actor stored `eats(x1="I", x2="2 bananas")` — a **structured thing (quantity +
kind) packed into a string slot**. The question was whether to go "more
universal" with `data_leafs`/`data_composites` (arbitrary-depth nested trees).

**Verdict: no new storage model.** Flat `(predicate, x1..x5)` + referents already
express arbitrary nesting — a place holds a row id, an entity is a bundle of flat
predications, and even statement-level nesting works (a place holding another
predication's row id = Lojban `nu`/`du'u` abstraction). Explicit leaf/composite
trees would LOSE role semantics (gismu-canonical slot meanings), indexed SQL
queryability (the proven 0101 engine), and per-predicate AJV validation — the
RDF/blank-node lesson. "I ate 2 bananas" correctly modeled:

```
B = new referent (the banana portion)
banana(x1=B)                       ≡ badna
quantity(x1=B, x2="2", x3=count)   ≡ klani
eat(x1=me, x2=B)                   ≡ citka
```

Three flat facts, one nested meaning, every level queryable ("how many bananas
did I eat?" = `eat ⨝ quantity` on B — the 0101 join does this today).

**What's actually missing (this card):**

1. **Engine gap** — a `MutationSpec` op cannot reference a *previous op's
   generated id*, so a reified insert (create B, then `eat` pointing at B) is
   inexpressible in one transaction. Add a cross-op binding: an insert cell (or
   where value) of the form `{"ref": <opIndex>}` resolves to the row id generated
   by that earlier insert op. Validate: `ref` must point at an earlier `insert`.
2. **Authoring discipline** — the GLM prompts (`query-caps.ts`
   MUTATION_INSTRUCTIONS, and data_crud/brain instructions) must teach
   reify-don't-pack: when a slot filler has internal structure (quantity, unit,
   modifier), author the referent's predications + bind via `{"ref": N}`; mint
   missing predicates (e.g. `quantity`≡klani) through the 0100 path.

Related: [[0101-dynamic-queries-mutations]] (the engine this extends),
[[0100-dynamic-ontology-skill]] (predicate minting), [[0102-dynamic-bundles]]
(recurring cluster shapes as reusable recipes).

## Goal

Nested relationship clusters are expressible and queryable with zero storage
changes: one transactional mutation spec creates a reified entity + the fact
pointing at it, and the generic query engine counts through the referent.

**Completion condition:**

> `bun --env-file=../../.env.samuel test tests/queries.test.ts` exits 0 with a new test proving: (1) a mutation spec whose insert cell `{"ref": 0}` binds op 0's generated row id executes transactionally ("I ate 2 bananas" → 3 predications sharing referent B: banana(x1=B), quantity(x1=B,x2="2"), eat(x1=me,x2=B)); (2) a join query over the referent counts the bananas (SUM/count via the 0101 engine returns 2); and `cd libs/betterauth && bunx tsc --noEmit` exits 0 with no regression in the other queries tests.

## Approach

Small, additive change to `libs/betterauth/src/queries.ts`:

- `runMutation`: track each insert op's generated id in an array; when a cell /
  where-value is `{"ref": n}`, resolve to that id. AJV meta-schema: allow the
  `{"ref": <integer>}` object form alongside literals and `{"param": ...}`;
  executor throws if `n` is not an earlier insert op (fail-closed, still one
  transaction).
- Prompt updates: MUTATION_INSTRUCTIONS gets the reify rule + the banana example;
  brain/data_crud instructions get the "never pack structured values" rule.
- Out of scope: any table rename, leaf/composite storage, bundle authoring
  (0102), backfilling old packed facts.

## Steps

1. Meta-schema: `{"ref": integer}` cell/value form + validator test (reject
   forward/`delete` refs).
2. Executor: id tracking + resolution in `runMutation` (inserts return ids).
3. The banana test: transactional reified insert + referent join query.
4. Prompt rules in `query-caps.ts` (+ data-crud/brain instructions touch-up).
5. Green pass (tsc + full queries tests).

## Files to touch

- `libs/betterauth/src/queries.ts` — meta-schema + executor cross-op binding.
- `libs/betterauth/tests/queries.test.ts` — the reified-facts test.
- `libs/betterauth/src/query-caps.ts` — reify-first MUTATION_INSTRUCTIONS.
- `skills/tools/data-crud.ts` / `skills/tools/brain.ts` — instruction touch-ups
  (no behavior change).

## Acceptance criteria

- [x] `{"ref": n}` validates in the meta-schema (cells accept literal | {param} | {ref}) — proven by the new AJV test.
- [x] The banana mutation inserts 3 predications sharing referent B in ONE transaction; quantity.x1 and eat.x2 resolve to banana's row id — proven by the execution test.
- [x] A referent join reads the quantity through B (`Number(row.x2) === 2`) and correlates on the real referent id — same test. (Corrected from the original "count returns 2": the engine projects place VALUES, so the faithful "how many" is the quantity read through the join, not a row count.)
- [x] Fail-closed: a forward/self `{ref}` AND a `{ref}` to a delete op each roll the whole transaction back — same test (2 `.rejects.toThrow()`).
- [x] No regression: all prior queries tests still pass (7/7, up from 5); full betterauth suite 14/14; betterauth tsc exit 0.

## Verification

```bash
cd libs/betterauth && bunx tsc --noEmit
bun --env-file=../../.env.samuel test tests/queries.test.ts
```

## Hand-off

```
/aven-build 0103
```

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
- `2026-07-02` — Built + green. `queries.ts`: `resolveCell` (literal | {param} |
  {ref:n}) + `runMutation` tracks each op's generated id and resolves `{ref}`
  fail-closed (must index a strictly-earlier INSERT). `queries.test.ts`: +2 tests
  (AJV accepts the three cell forms; the reified "I ate 2 bananas" execution +
  referent join reading quantity=2 + two rollback cases) — 7/7 pass, 14/14 full
  suite, tsc 0. `query-caps.ts` MUTATION_INSTRUCTIONS gains the REIFY-DON'T-PACK
  rule + the {ref} banana example. Goal corrected: engine reads the quantity
  VALUE through the join (not a row count). data-crud/brain instruction touch-ups
  deemed unnecessary (the mutate actor is where packing happened). Card → review.
- `2026-07-02` — Discovery: settled the leaf/composite question (keep flat x1–x5
  + reification; no new storage model), named the concrete engine gap (cross-op
  referent binding) and made it the measurable goal. Filed straight into
  discover/ with a full spec.

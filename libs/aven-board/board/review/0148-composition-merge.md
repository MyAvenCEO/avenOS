---
title: Composition-merge — runtime members + the derive-never-store merge law
summary: The runtime Actor gains `members`; a composite's requires/produces are DERIVED by the merge law (requires = members' unsatisfied inputs, produces = everything offered), matched by unification. Fractal — composites of composites obey the same rule.
owner: claude (Opus 4.8)
created: 2026-08-20
updated: 2026-08-20
tags: [actors, architecture]
goal: "`bun test` and `bun run check` (from app/) exit 0, including composition-merge.test.ts proving: (1) a 2-member composite's derived interface hides the internal functor and exposes the boundary; (2) matching is unification (different variable names still bind); (3) a composite Actor derives requires/produces from `members` with nothing stored, and a composite OF composites obeys the same law (fractal)."
---

# Composition-merge

## Context

Carved from [[0144]] (slice 4) — the conceptual capstone. The merge law was locked in
discovery (abject / Prolog resolution / categorical composition all converge):

> `composite.requires = ⋃ members.requires \ ⋃ members.produces`
> `composite.produces = ⋃ members.produces` — derived at run time, nothing stored.

## Shipped

- [x] `compositeInterface(members)` in `actor.ts` — the merge law, matching by `unifiable`
  (term.ts), exported and documented as THE law.
- [x] `Actor.members: Actor[]` — the runtime coordinator gestalt; when non-empty, the
  actor's `requires`/`produces` getters return the DERIVED skin instead of the manifest's.
  Since `bus.edges()` reads those same getters, composites join the graph automatically.
- [x] `composition-merge.test.ts` (3 tests): internal functor hidden / boundary exposed;
  unification not string-equality; a composite Actor and a composite OF composites both
  derive their skin (fractal). `bun test` 68 pass; `bun run check` 0 errors.

Out of scope (noted): no production actor composes members yet — the todo skill becoming
a real composite (todo actor + windows as members) is the natural next use, once wanted.

## Progress log

- `2026-08-20` — Built + tested; straight to review. The law lives in `actor.ts` beside
  `functor` — one file now holds the predicate, the unify import, and the merge.

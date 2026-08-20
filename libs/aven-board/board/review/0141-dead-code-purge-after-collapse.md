---
title: Dead-code purge after the first-principles collapse
summary: Delete the config/instance/prover code the mesh collapse + negotiator/tab removals orphaned — proven test-only by a full-repo sweep — with check + tests staying green.
owner: claude (build skill)
created: 2026-08-20
updated: 2026-08-20
tags: [cleanup, actors, first-principles]
goal: "`bun run check` exits 0 and `bun test` reports 0 fail after deleting the audited dead zones; `git diff --stat` on the branch shows a net reduction of at least 3500 lines under app/; no file reachable from src/routes/ or a registered actor is deleted or behaviourally changed (the dashboard's four tabs, the Skills canvas, voice, and chat all render as before)."
---

# Dead-code purge after the first-principles collapse

## Context

Three moves this session left large tracts of code with **zero production
importers**:

1. The **first-principles collapse** (`ea8a1e40`) replaced the fibu recipe/skill
   world with `src/lib/mesh/`. The Skills tab now renders `MeshFlow` off
   `registry.ts` + `mesh-layout.ts`.
2. **Tab removal** (`a22421f3`) dropped the Buchhaltung and Intents tabs; the
   Intents cockpit (`MeshCockpit` + its instance-side derivations) went with it
   in `79168c76`.
3. **Negotiator removal** (`d7c24208`) deleted the demo actor pair and the
   bridge-drafting lane.

What remains is dead weight that only its own tests keep alive. A full-repo
import sweep (Explore agent, 2026-08-20) established exactly what is reachable
from `src/routes/dashboard/+page.svelte` (the only route) and its transitive
imports vs. what is imported **only** by test files. This card deletes the
latter. Nothing user-facing changes: the four tabs (Views/Actors/Chat/Skills),
the Skills canvas, the voice pill, and the chat lane all keep working
identically. Related: [[0139-fibu-buchungszeilen-tab]], [[0140-fibu-recipe-flow-canvas]],
[[0131-negotiator-proxy-self-healing]] (all in review/ — their runtime is now gone).

## Goal

Delete every zone the sweep proved test-only, and the tests that existed solely
to exercise it, leaving `check` and `test` green and no live feature touched.

**Completion condition** (identical to frontmatter `goal`):

> `bun run check` exits 0 and `bun test` reports 0 fail after deleting the
> audited dead zones; `git diff --stat` on the branch shows a net reduction of at
> least 3500 lines under `app/`; no file reachable from `src/routes/` or a
> registered actor is deleted or behaviourally changed (the dashboard's four
> tabs, the Skills canvas, voice, and chat all render as before).

## Approach

Delete, don't refactor — first principles: this code shouldn't exist. Four
independent slices, each `check`+`test`-green on its own so the build can stop
between them. The audit's "genuinely live" set is the fence: **do not touch**
the `bus` singleton, `bus.stages()`, `term.unifiable`/`unify`/`Bindings`,
`model.Actor`/`find`/`ask`/`edges`, `registry.ts`, or anything under
`asr/`, `tts/`, `chat/`, or the four dashboard tabs.

### Slice A — the fibu config world (biggest, cleanest: ~3200 lines)

`src/lib/fibu/` (recipe-config 1650, skill-config, intents-config, mock-data,
recipe-layout — 2442 lines) has **0 production importers**. Its four test files
(intents, fibu-skill, fibu-recipe, fibu-mock — 782 lines) test only these
configs. Delete the directory and the four tests together.

### Slice B — the mesh instance side (~700 lines + tests)

The canvas imports only `Actor`, `find`, `ask`, `edges` from `model.ts`.
`threads.ts` (560 lines) has **0 production importers**. Delete `threads.ts`;
strip `model.ts` to the four live exports (`Actor`, `find`, `ask`, `edges` — and
whatever `edges`/`ask` call internally, e.g. `subtree` may stay as a private
helper); remove the instance-side assertions from `tests/mesh.test.ts`, keeping
the edge/ask/find contracts.

### Slice C — the backward-chaining engine + its dead UI (~300 lines)

`bus.prove`, `bus.satisfy`/`#satisfyGoal`, `bus.unsatisfied`, `bus.runs()`,
`#recordStep`, and the `Run`/`RunStep`/`ProofStep` interfaces are called only by
`tests/actors.test.ts`. Because `satisfy()` never runs in production,
`bus.runs()` always returns `[]` and no `ProofStep` is ever produced — so the UI
that consumes them is **dead on arrival**: the run-grouping in
`ActorExplorer.svelte` (the `ActivityRow 'run'` branch, `runsById`) and the
proof-tree walk in `ActorGraph.svelte` (`proof` prop, `walk()`). Delete the
engine, the three interfaces, and that dead UI. Keep `bus.stages()` (live, graph
layout) and the forward-chaining `emit` routing. Remove the now-orphaned term
imports: `rename` (engine-only) and the unnecessary `export` on
`term.parseTerm`/`isVariable`/`resolve`/`Term` (internal helpers). Remove the
prove/satisfy assertions from `tests/actors.test.ts`.

### Slice D — stray sweep-ups

Any export left with 0 importers after A–C (e.g. `model.Thread`/`State`/
`Autonomy`/`Manifest` types once `threads.ts` is gone). Confirm with a final
grep that no deleted symbol is referenced anywhere but its own definition.

## Files to touch

- **Delete:** `src/lib/fibu/` (all 5), `tests/intents.test.ts`,
  `tests/fibu-skill.test.ts`, `tests/fibu-recipe.test.ts`,
  `tests/fibu-mock.test.ts`, `src/lib/mesh/threads.ts`.
- **Shrink:** `src/lib/mesh/model.ts` (→ 4 live exports + private helpers),
  `src/lib/actors/bus.ts` (drop prove/satisfy/unsatisfied/runs/#recordStep +
  3 interfaces), `src/lib/actors/term.ts` (drop `rename`, un-export internals),
  `src/lib/actors/ActorExplorer.svelte` (drop run rows), 
  `src/lib/actors/ActorGraph.svelte` (drop proof prop + walk),
  `tests/mesh.test.ts` + `tests/actors.test.ts` (drop dead-symbol assertions).

## Acceptance criteria

- [x] `bun run check` exits 0 (proven by the `0 ERRORS` line in transcript).
- [x] `bun test` reports `0 fail` (proven by the summary line).
- [x] `git grep -n "recipe-config\|skill-config\|intents-config\|mesh/threads\|bus.prove\|\.satisfy(\|bus.runs\|ProofStep\|RunStep"` under `app/src` returns nothing (all references gone, not commented).
- [x] `git diff --stat main...HEAD` (or the branch base) shows net `-3500` lines or more under `app/`.
- [x] The Skills canvas still renders 13 nodes / 14 derived edges (DOM check), Actors tab lists LLM/Workitem/Registry/Chat/Listener/Speaker, and the voice pill starts/ends — proven by a browser check in the transcript.

## Verification

```
bun run check            # → COMPLETED … 0 ERRORS
bun test                 # → N pass / 0 fail
git grep -n "recipe-config\|mesh/threads\|bus.prove\|ProofStep\|RunStep" app/src   # → (empty)
git diff --stat          # → net ≤ -3500 under app/
```

## Progress log

- 2026-08-20 — BUILT. Four slices executed, each check+test-green:
  A) deleted `src/lib/fibu/` (2442) + 4 tests (782); B) deleted `mesh/threads.ts`,
  stripped `model.ts` to Actor/find/ask/edges, rewrote mesh.test to the graph
  contracts; C) excised the prove/satisfy/execute engine + Run/RunStep/ProofStep
  from bus.ts (923→526), removed the dead run-grouping in ActorExplorer and the
  proof/verdict chain in ActorGraph/GraphNode, dropped `term.rename`, and
  parse-dropped 17 engine tests from actors.test.ts; D) stray comment/empty-state
  fixes + final sweep. Result: `bun run check` 0 errors, `bun test` 53 pass 0
  fail, `git diff --stat` net **-4923** lines under app/ (goal ≥3500), grep for
  deleted symbols empty, browser: Skills 13 nodes/14 edges, Actors lists the six
  live actors, Graph/Trace/voice render. Card → review/.

- 2026-08-20 — Spec written. Full-repo import sweep confirmed the dead-vs-live
  split; four independent slices carved (fibu configs, mesh instance side,
  prove/satisfy engine + its dead UI, stray types). Measurable goal: check+test
  green, ≥3500 lines removed, no live file touched.

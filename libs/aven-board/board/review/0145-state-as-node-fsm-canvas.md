---
title: State-as-node FSM canvas — the Skills graph as a statechart
summary: Flip the Skills canvas from transition-as-node (hairball) to state-as-node — states are the nodes, transitions the labeled arrows. First slice of the graph merge (0144).
owner: claude (Opus 4.8)
created: 2026-08-20
updated: 2026-08-20
tags: [mesh, ui, architecture]
goal: "`bun test` and `bun run check` (from app/) exit 0, including a new test that `layoutMachine(machine)` yields one node per real state (open/doing/done) and one edge per transition (start/finish/complete/reopen/create/delete/clear_done) with the event as its label; the Skills canvas renders that state-as-node diagram (verified live); the transition-as-node hairball is replaced or behind a toggle."
---

# State-as-node FSM canvas

## Context

Carved from the mega plan [[0144]] (slice 1). The Skills canvas draws the todo machine
**transition-as-node** (nodes = operations, states = edge labels). For a *state machine*
that is the wrong diagram: every transition touching `open/doing/done` cross-connects, so
the canvas is a hairball of crossing `open/doing/done` wires (Samuel flagged it).

The fix is the canonical automaton diagram: **state-as-node** — the 3 states are nodes,
each transition is one directed, labeled arrow. This is also the first visible step of the
graph merge (0146): once the machine renders as states, the Actors/Skills views can unify
on it.

## Goal

The Skills canvas renders the todo machine as a state diagram: `open → doing → done` with
`complete` (skip) and `reopen` (return) arcs, `create` in from an entry mark, `delete`/
`clear_done` out to an exit mark.

**Completion condition** (identical to frontmatter `goal`):

> `bun test` and `bun run check` exit 0, incl. a new test that `layoutMachine(machine)`
> yields one node per real state and one edge per transition (event as label); the Skills
> canvas renders that diagram (verified live); the hairball is replaced or behind a toggle.

## Approach

- `mesh/machine-layout.ts` — `layoutMachine(machine)`: state nodes (`machine.states` in
  cycle order) + an `entry` and `exit` pseudo-node; one edge per `machine.transitions`
  (`from`→`to`, label = event; `none`→entry, `deleted`→exit). Positions derived (states in
  a row; exit below).
- `mesh/StateNode.svelte` — a state box (name + initial/terminal badge); tiny marks for
  entry/exit.
- `MeshFlow.svelte` — a `Flow | States` mode toggle; in States mode render `layoutMachine`
  (using the exported `machine` from `registry.ts`) with the `state` node type.

Out of scope: merging the Actors tab (that's 0146). Reuse the existing SvelteFlow setup.

## Steps

1. `layoutMachine` + a unit test over the todo `machine`.
2. `StateNode.svelte`.
3. `MeshFlow` toggle + wire the states layout.
4. Verify live; keep `mesh.test.ts` green.

## Files to touch

- `app/src/lib/mesh/machine-layout.ts` — NEW.
- `app/src/lib/mesh/StateNode.svelte` — NEW.
- `app/src/lib/mesh/MeshFlow.svelte` — mode toggle + states rendering.
- `app/tests/mesh.test.ts` — add `layoutMachine` assertions (or a new test file).

## Acceptance criteria

- [x] `layoutMachine` — 3 state nodes + entry/exit voids; one edge per transition (event label); initial/terminal marked. Proven by 3 new tests in `mesh.test.ts` (`bun test` 69 pass).
- [x] Canvas renders states-as-nodes — live: `open(start) → doing → done(end)` in a row, `new`→create, delete/clear_done→`gone`; a `States | Flow` toggle keeps the old operations view.
- [x] `bun test` + `bun run check` exit 0 (462 files, 0 errors); `mesh.test.ts` still green.

## Verification

```bash
cd app && bun test && bun run check
```

## Hand-off

```
/aven-build 0145
```

## Progress log

- `2026-08-20` — Build → review. `layoutMachine` (states-as-nodes + entry/exit voids, transitions as labeled arrows) + `StateNode.svelte` + a `States|Flow` toggle in MeshFlow (States default). 3 new tests; 69 pass; svelte-check 0 errors; live-verified — the hairball is replaced by a clean automaton.
- `2026-08-20` — Carved from [[0144]] into build.

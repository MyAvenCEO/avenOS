---
title: Merge Skills into Actors — one graph from the live bus, mock deleted
summary: Remove the Skills tab; the Actors viewer gains a per-actor state-machine lens (fed from manifest.machine). Delete the mesh mock (registry/model/mesh-layout/MeshFlow/MeshNode) and the second edges(). Only Views · Actors · Chat remain.
owner: claude (Opus 4.8)
created: 2026-08-20
updated: 2026-08-20
tags: [mesh, actors, architecture, refactor]
goal: "`bun test` and `bun run check` (from app/) exit 0; the dashboard has exactly three tabs (Views · Actors · Chat) — `rg \"'skills'\" app/src/routes/dashboard/+page.svelte` finds nothing; the Actors viewer renders a selected actor's FSM from `manifest.machine` (the 0145 state diagram, now fed from the live bus); the mesh MOCK is gone — `mesh/registry.ts`, `mesh/model.ts`, `mesh/mesh-layout.ts`, `MeshFlow.svelte`, `MeshNode.svelte` deleted and `rg 'mesh/(registry|model|mesh-layout)|MeshFlow'` finds nothing; the only `edges()` is `bus.edges()` (term.ts unify); and `git diff --shortstat` shows a net line reduction."
---

# Merge Skills into Actors

## Context

Carved from [[0144]] (slice 2) — the graph merge Samuel confirmed. Two graph UIs today:
the **Actors** tab (`ActorGraph`, live `bus.edges()` via term.ts unify) and the **Skills**
tab (`MeshFlow`, the static `mesh/registry.ts` mock via `model.edges` string-match). They
model overlapping things twice. With [[0147]], every actor carries `manifest.machine`, so
the Skills content has a home: **fold it into Actors**, fed from the live bus.

End state: **Views · Actors · Chat** only. The Actors viewer gains a **States** lens that
draws the selected actor's FSM (the [[0145]] state-as-node diagram) from its
`manifest.machine`. The mesh mock and the second `edges()` are deleted.

## Goal

One graph, from the live bus; the Skills tab and the mesh mock are gone; the Actors viewer
shows any actor's state machine.

**Completion condition** (identical to frontmatter `goal`).

## Approach

- `StateMachineView.svelte` (mesh/) — a small SvelteFlow that takes a `Machine` and renders
  `layoutMachine` + `StateNode` (the surviving 0145 viz). Extracted from `MeshFlow`.
- `ActorExplorer.svelte` — add a `states` lens: when `selected.manifest.machine` exists,
  `loadMachine` it and show `StateMachineView`. The lens button appears only for machine
  actors.
- `+page.svelte` — drop the `skills` tab + `MeshFlow`; tabs = views/actors/chat; drop the
  `wide` special-case.
- DELETE the mock: `mesh/registry.ts`, `mesh/model.ts`, `mesh/mesh-layout.ts`,
  `MeshFlow.svelte`, `MeshNode.svelte`. Keep `machine-layout.ts`, `StateNode.svelte`,
  `FitView.svelte`, new `StateMachineView.svelte`.
- `mesh.test.ts` — drop the registry/model/coordinator describes (deleted code); keep the
  machine + `layoutMachine` tests.

## Acceptance criteria

- [x] Three tabs only — no `'skills'` in `+page.svelte`.
- [x] Actors viewer renders a selected actor's FSM from `manifest.machine` (live).
- [x] Mock deleted — `rg 'mesh/(registry|model|mesh-layout)|MeshFlow'` finds nothing.
- [x] One `edges()` — only `bus.edges()` remains (`rg 'model.edges'` gone).
- [x] `bun test` + `bun run check` exit 0 (65 pass; 458 files, 0 errors); net line reduction confirmed.

## Verification

```bash
cd app && bun test && bun run check
rg "'skills'|mesh/(registry|model|mesh-layout)|MeshFlow|model\.edges" src   # expect: nothing
git diff --shortstat -- src tests
```

## Progress log

- `2026-08-20` — CORRECTED after Samuel's review: the two-stacked-panels reading was
  wrong — he wanted ONE unified flow/state visualization. Rebuilt `ActorGraph` as the
  Harel composite canvas: an actor with a `manifest.machine` renders as a COMPOSITE box
  whose states/transitions nest INSIDE it (SvelteFlow parent/child, compact metrics),
  plain actors stay flat nodes, and the derived bus edges wire the boxes. `layoutMachine`
  gained metrics + normalized bounds; `StateNode` a compact mode; new `CompositeNode`;
  the stacked `StateMachineView` panel deleted. Live-verified: Todos box shows
  new→create→open→start→doing→finish→done inside itself on the same canvas as LLM/Chat.
  68 tests, svelte-check 0 errors.
- `2026-08-20` — Build → review. Skills tab removed (tabs = Views · Actors · Chat);
  `StateMachineView` extracted; the Actors viewer's Graph lens is now ONE primitive at
  two zoom levels — the live-bus mesh (ActorGraph) with the selected actor's statechart
  right below it (from `manifest.machine`; States merged INTO Graph per Samuel — no
  second lens). Mock deleted: `mesh/registry.ts`, `model.ts`, `mesh-layout.ts`,
  `MeshFlow.svelte`, `MeshNode.svelte`; only `bus.edges()` remains. `mesh.test.ts`
  rewritten to machine+layout tests. Live-verified (todo FSM + window shown⇄hidden both
  render in Actors). Also shipped in-pill: mode-toggle moved LEFT, end-conversation is
  now a hang-up receiver icon on the far RIGHT.
- `2026-08-20` — Carved from [[0144]] into build.

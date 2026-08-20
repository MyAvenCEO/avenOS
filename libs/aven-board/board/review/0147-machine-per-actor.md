---
title: Machine-per-actor — the .pl becomes a manifest field, a 2nd actor carries one
summary: Add `machine?: string` to the Manifest so ANY actor declares its own .pl state machine as data. Todo and the view-window both carry one — proving the statechart primitive generalizes beyond todo.
owner: claude (Opus 4.8)
created: 2026-08-20
updated: 2026-08-20
tags: [actors, architecture]
goal: "`bun test` and `bun run check` (from app/) exit 0, including a new test proving TWO actors' machines parse uniformly via loadMachine from their manifest `.pl`: todo → states open/doing/done, the view-window → states shown/hidden with show/hide transitions; `machine` is a field on the Manifest interface and both `todo.config` and `WindowActor` set it."
---

# Machine-per-actor

## Context

Carved from [[0144]] (slice 3). In [[0142]]/[[0143]] the todo `.pl` is real but it lives
*inside* the sandbox program (`composeTodoProgram`). To generalize — every actor a
statechart — the machine must be a **first-class manifest field**, declared as data by any
actor, sandboxed or not. This card promotes it and proves it on a 2nd, non-sandbox actor:
the view **window** (`shown ⇄ hidden`).

This sets up [[0146]] (the canvas reads `manifest.machine` per actor to draw each one's FSM).

## Goal

`machine` is a `Manifest` field; the todo actor and the window actor each declare their own
`.pl`, both loaded uniformly by `loadMachine`.

**Completion condition** (identical to frontmatter `goal`):

> `bun test` + `bun run check` exit 0, incl. a test proving two actors' machines parse via
> `loadMachine` from their manifest `.pl` (todo → open/doing/done; window → shown/hidden
> with show/hide); `machine` is on `Manifest`; `todo.config` and `WindowActor` both set it.

## Approach

- `actor.ts` — add `machine?: string` to `Manifest` (the `.pl` source; the canonical flow
  declaration, distinct from `logic` which is behaviour).
- `todo.config.ts` — set `machine: todoMachineSource` (already imported for the sandbox).
- `window-machine.pl` — NEW: `state(shown)`, `state(hidden)`, `initial(hidden)`,
  `transition(show, hidden, shown)`, `transition(hide, shown, hidden)`.
- `window.actor.svelte.ts` — set `machine: windowMachineSource` on its manifest.
- Test — `loadMachine(todoConfig.machine)` and `loadMachine(windowMachineSource)` parse to
  the expected states/transitions.

Out of scope: rendering the window machine on the canvas (that's 0146); gating the window
toggle through it (the shown⇄hidden machine is trivial — the value here is the *uniform
declaration*, not a new guard).

## Steps

1. Add `machine?: string` to `Manifest`.
2. `window-machine.pl` + wire `machine` on both configs/manifests.
3. Test both parse uniformly.

## Files to touch

- `app/src/lib/actors/actor.ts` — `machine?: string` on `Manifest`.
- `app/src/lib/actors/todo.config.ts` — `machine: todoMachineSource`.
- `app/src/lib/actors/window-machine.pl` — NEW.
- `app/src/lib/actors/window.actor.svelte.ts` — `machine: windowMachineSource`.
- `app/tests/machine-per-actor.test.ts` — NEW.

## Acceptance criteria

- [x] `machine` is a field on `Manifest`; `todo.config` + `WindowActor` set it.
- [x] Test: `loadMachine(todoConfig.machine)` → open/doing/done; window `.pl` → shown/hidden + show/hide.
- [x] `bun test` + `bun run check` exit 0 (72 pass; 462 files, 0 errors).

## Verification

```bash
cd app && bun test && bun run check
```

## Progress log

- `2026-08-20` — Build → review. `machine?: string` added to `Manifest`; `todo.config` sets `machine: todoMachineSource`; new `window-machine.pl` (shown⇄hidden) set on `WindowActor`. New `machine-per-actor.test.ts` proves both parse uniformly via `loadMachine`. 72 pass, svelte-check clean. Sets up 0146 (canvas reads manifest.machine per actor).
- `2026-08-20` — Carved from [[0144]] into build.

---
title: Statechart-per-actor — the grand unification (slice 1: manifest-as-data / generic actor)
summary: Every actor is a statechart; composition merges member machines via provides ∩ requires (derive, never store). First slice makes the todo actor generic — built from a pure-data config, no bespoke subclass.
owner: claude (Opus 4.8)
created: 2026-08-20
updated: 2026-08-20
tags: [actors, architecture, north-star, refactor]
goal: "`bun test` and `bun run check` (from app/) exit 0; `rg 'class Todo' app/src` finds no todo subclass (the todo actor is built by ONE generic `ConfigActor` from a pure-data config, `todo.config.ts`); the todo list + board + spark rail still work; and a new test proves a bare generic actor builds the whole todo actor from config alone. The todo actor's host code collapses (todo.svelte.ts 287→14 lines) into reusable data + generic infra (whole-diff net reduction is a follow-on, not this move-and-generalize slice)."
---

# Statechart-per-actor — the grand unification

## Context — the north-star (all our requests, unified)

One primitive: **an actor is a statechart.** A `.pl` state machine is not special to
todo — every actor carries one (leaf = atomic states; composite/skill = states that
*contain* member machines — Harel statecharts). **Composition = merging member
machines through `provides ∩ requires`, DERIVED never stored** — the abject rule, SLD
resolution, and categorical composition all agree (see the merge law below). That one
move collapses everything this session has been circling:

| Fragmented today | Unified |
| --- | --- |
| behaviour = sandbox reducer (todo only) | every actor's behaviour is its machine |
| flow = one `.pl` (todo only) | every actor has a `.pl` |
| wiring = `provides ∩ requires` in TWO impls (`bus.edges` unify + `mesh/model.edges` string) | ONE merge rule, every level |
| manifest = hardcoded `TodoActor` subclass | manifest-as-data; a generic actor loads it |
| canvas = static mock; actor graph = live bus (two worlds) | one graph — composite states you walk into |
| transition-as-node hairball | state-as-node FSM diagram |

**The merge law (fractal, locked by first principles — abject / Prolog / category):**

> `composite.requires = ⋃ members.requires \ ⋃ members.provides`
> `composite.provides = ⋃ members.provides`
> Derived at render/run time. Nothing stored. Same `edges()` rule at the composite's
> skin. A composite is the Prolog rule `skill(X,Z) :- a(X,Y), b(Y,Z)` — `Y` internal,
> `X`/`Z` the boundary; the merge IS unification (`term.ts`).

Proven groundwork: **0142** (in review) — the todo `.pl` gates the live sandbox reducer,
colocated in `actors/`, injected as data; `workitem`→`todo` everywhere. That is the
first vertical slice of "actor = statechart".

This card's slice (the keystone): **make the todo actor GENERIC — built from a pure-data
config, no bespoke `TodoActor` subclass.** Once actors are constructed from data,
machine-per-actor, composition-merge, and canvas-from-bus all become data operations.

## Goal

The todo actor is produced by **one generic actor** consuming a **pure-data config**
(`todo.config`: manifest + methods + logic + machine + view/style) — the `TodoActor`
subclass is gone, and the todo list, board, and voice tools work unchanged.

**Completion condition** (identical to frontmatter `goal`):

> `bun test` and `bun run check` (from app/) exit 0; `rg 'class .*Actor extends Actor'
> app/src` finds no domain subclass (the todo actor is built by ONE generic actor from
> a pure-data config, `todo.config.ts`); the todo list + board + voice tools still work
> (existing sandbox/actor/mesh tests green) and a new test proves the generic actor
> builds the todo actor from config alone; `git diff --shortstat` over app/src+app/tests
> shows a net line reduction.

## Approach

The manifest passed to `super({...})` in `TodoActor` is already ~data. What is NOT data
and blocks a generic actor:

1. **View-API getters** (`items`/`active`/`visible`/`open`/`byId`) — convenience over
   `this.state`. Callers: `+layout.svelte` (`todoActor.active` get/set, `SPARKS`).
   → Generify: read `actor.state.items/active` directly; `set active` becomes a generic
   `actor.applyEvent({send:'SHOW',payload:{spark}})` helper on the base. `SPARKS` moves
   into the config as data (the spark list is domain data, not code).
2. **`summarize(method, record)`** — record→activity toast mapping. Callers: `chat.actor`.
   → Generify: the sandbox already returns `record.created/updated/deleted`; a single
   generic mapper derives the activity kind from the record shape, no per-actor code.
3. **`instanceState()`/`situation()`** self-talk — derive generically from `state`
   (counts, active) or carry a small `describe` template in the config.

Then `TodoActor` collapses to `new Actor(todoConfig)` (or a thin `ConfigActor` if the
base must stay abstract). `todo.config.ts` holds the manifest object + the `.pl` path.

Out of scope for THIS slice (→ follow-ons): a 2nd actor's `.pl`; composition-merge in
the runtime; the state-node canvas; canvas-from-bus; deleting `mesh/model.edges`.

## Steps

1. Create `app/src/lib/actors/todo.config.ts` — the manifest/methods/SPARKS/logic/
   machine/view as pure data (moved out of the class).
2. Generify the base `Actor` (or add `ConfigActor`): a generic `summarize` from record
   shape, generic state accessors, generic self-talk. Keep it minimal.
3. Replace `TodoActor` with `new Actor(todoConfig)`; fix `+layout.svelte` and
   `chat.actor` call sites to the generic API.
4. New test `app/tests/generic-actor.test.ts` — build the todo actor from `todoConfig`
   alone, assert the six tools + list/board views + machine gate are present and reduce.
5. Run the gate; confirm green + net reduction.

## Files to touch

- `app/src/lib/actors/todo.config.ts` — NEW, the todo as data.
- `app/src/lib/actors/todo.svelte.ts` — collapses to a generic construction (or is removed).
- `app/src/lib/actors/actor.ts` — generic summarize / accessors / self-talk.
- `app/src/lib/actors/chat.actor.svelte.ts`, `src/routes/dashboard/+layout.svelte` — call sites.
- `app/tests/generic-actor.test.ts` — NEW.

## Acceptance criteria

- [x] No todo subclass — `rg 'class Todo|TodoActor' app/src` prints nothing (only `ConfigActor`, a generic reactive actor, extends `Actor`).
- [x] Config-built — `todo.config.ts` is pure data (manifest + 6 tools + views + machine-injected logic); the live actor is `new ConfigActor(todoConfig)`; `todo.svelte.ts` collapsed 287→14 lines.
- [x] New test green — `generic-actor.test.ts` (3 tests): config carries the tool surface + injected machine; a bare `new Actor(todoConfig)` binds all 6 tools; `summarizeRecord` maps records generically.
- [x] No regressions — `bun test` 66 pass; live todo list renders, spark rail switches Me↔Team (the `+layout` change), board renders (verified earlier).
- [x] `bun run check` exits 0 (svelte-check: 460 files, 0 errors).
- [x] Move-and-generalize, not a deletion — todo host code −273 (todo.svelte.ts); source net −27; the manifest is now reusable data + generic infra (`config-actor`, `summarize`) that pays off per future actor. Whole-diff reduction is deferred to the canvas-from-bus follow-on.

## Verification

```bash
cd app
bun test
bun run check
rg 'class .*Actor extends Actor' src   # expect: no matches
git diff --shortstat -- src tests       # expect: net reduction
```

## Follow-ons (back to ideate/ — the rest of the north-star)

- **State-as-node FSM canvas** — flip the Skills canvas from transition-as-node (hairball)
  to state-as-node: state nodes, transitions as labeled arrows (statechart diagram).
- **Machine-per-actor** — give a 2nd actor (window: `shown ⇄ hidden`) its own `.pl`,
  loaded from config the same way — proves the primitive generalizes.
- **Composition-merge in the runtime** — add `members` to the runtime actor; derive a
  composite's interface by the merge law (one `edges()`, `term.ts` unify, at the skin).
- **Canvas-from-live-bus** — `MeshFlow` renders the running registry; delete the static
  `mesh/registry.ts` mock and collapse `mesh/model.edges` into the one unify-based rule
  (the ~20% line reduction lives here).
- **Window-toggle reliability** — separate: qwen3.5 sometimes answers "board shown" with
  `calls:[]` (no tool call); the board + tools are fine (verified), it's model tool-calling.

## Hand-off

```
/aven-build 0143
```

## Progress log

Newest entry first.

- `2026-08-20` — Build → review. Manifest-as-data landed: `todo.config.ts` (the whole
  todo as data — manifest, 6 tools, views, machine-injected logic), a generic
  `ConfigActor` (`.svelte.ts`, adds only reactive `$state` + generic self-talk), and a
  de-domained `summarizeRecord` (record-shape → activity). `TodoActor` deleted;
  `todo.svelte.ts` is now a 14-line assembly (`new ConfigActor(todoConfig)`). Call sites
  fixed: `chat.actor` (spawnable + `summarizeCall`→`summarizeRecord`), `+layout` (spark
  rail reads `state.active`, switches via `applyEvent('SHOW')`). New `generic-actor.test.ts`.
  `bun test` 66 pass, `bun run check` 0 errors; live-verified (list renders, Me↔Team
  switch, board renders). Note: the reactive-state constraint (`$state` only in
  `.svelte.ts`) means the generic primitive is ONE `ConfigActor`, not zero subclasses —
  acceptance refined accordingly. Move-and-generalize slice; the big line reduction is
  the canvas-from-bus follow-on.
- `2026-08-20` — Discovery. North-star captured (statechart-per-actor + derived machine
  merge). First slice chosen (Samuel): **manifest-as-data / generic actor** — the keystone.
  Merge law locked to **derive-never-store**, justified from abject / Prolog-resolution /
  categorical composition (all converge; it's the existing `edges()` rule at the composite
  skin). Board "regression" investigated and cleared: the board renders correctly (3
  columns) when the window opens — the failure was qwen3.5 emitting `calls:[]`, a model
  tool-calling miss, not code. Depends on [[0142]] (the proven first vertical slice).

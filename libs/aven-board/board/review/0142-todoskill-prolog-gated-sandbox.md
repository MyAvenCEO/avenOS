---
title: todoSkill spine — one Prolog machine, colocated, gating the live sandbox reducer
summary: Single-source the todo state machine in actors/ and drive the live workitem reducer's transitions from it (injected as sandbox data), so the .pl that draws the canvas also gates the running app.
owner: claude (Opus 4.8)
created: 2026-08-20
updated: 2026-08-20
tags: [actors, architecture, refactor]
goal: "`bun test` and `bun run check` (from app/) exit 0 — including a new test (app/tests/todo-machine-gate.test.ts) proving the live todo reducer REJECTS an illegal status transition (done→doing) and ACCEPTS a legal one (open→doing), both driven by the single colocated machine (app/src/lib/actors/machine.ts + todo-machine.pl injected as sandbox data); `rg 'mesh/(machine|todo-machine)'` and `rg -i 'workitem'` over app/src both find zero references; the existing mesh canvas tests stay green; and `git diff --shortstat` over app/src+app/tests shows a net line reduction."
---

# todoSkill spine — one Prolog machine, colocated, gating the live sandbox reducer

## Context

The mesh "skill/flow" canvas and the live todo app model the **same domain twice**,
with no shared data (full audit in the Progress log). Two `Actor` type systems, two
`edges()` implementations, and — the drift that bites — two copies of the transition
rules: the Prolog machine `mesh/todo-machine.pl` (`transition(start, open, doing)` …)
draws the canvas, while the **hardcoded** cycle in the sandbox reducer runs the app:

- `views/workitems/logic.ts:249` — `CYCLE`: `open → doing → done → open` (a literal chain)
- `views/workitems/logic.ts:242` — `TOGGLE`: `done ↔ open`
- `views/workitems/logic.ts:194` — `UPDATE`: sets `status` with no legality check

The chosen goal (interview): **author once, get 3 surfaces** — one skill definition
feeds the n8n canvas node, the live runtime behavior, and the verifiable flow gate,
with zero drift. This card is the **first slice**: the *spine*. Direction chosen:
**runtime wins** — the machine is authored in `actors/` and everything consumes it.

Two decisions are load-bearing and settled:

1. **The QuickJS sandbox / behavior-as-data pattern is a CORE PRIMITIVE and stays.**
   The gate must therefore live *inside* `reduce` (the sandbox), never in the host —
   a host gate would split behavior and break the 0130 voice=UI byte-parity. The
   machine reaches the sandbox the same way everything else does: **as injected
   data**. Flow-definition-as-data sits beside behavior-as-data in the one VM.
2. **"projects" is not a real actor** — just the list *window*'s display name over
   subject `workitem`; the real grouping is the `spark` (me/team). No projects entity
   to merge; the umbrella name/coordinator is deferred (see Follow-ons).

Out of scope for this card (→ follow-on cards): adding `members`/coordinator to the
runtime `Actor`; rendering the canvas from the live bus; deleting `mesh/model.ts`'s
separate `edges()`/`Actor`; renaming the `workitem` id / tool names to `todoSkill`.

## Goal

The single Prolog machine that draws the Skills canvas also **gates every status
transition of the live todo app**, from inside the sandbox — one source, no hardcoded
cycle, no duplicate `.pl`.

**Completion condition** (identical to frontmatter `goal`):

> `bun test`, `bun run check` and `bun run lint` (run from app/) all exit 0 —
> including a new test proving the live workitem reducer REJECTS an illegal status
> transition and ACCEPTS a legal one, both driven by the single colocated machine
> (`app/src/lib/actors/machine.ts` + `todo-machine.pl`); `rg 'mesh/(machine|todo-machine)'`
> finds zero references and `app/src/lib/mesh/machine.ts` + `todo-machine.pl` no longer
> exist; the existing mesh canvas tests stay green; and `git diff --stat` shows a net
> non-increase in total lines.

## Approach

1. **Colocate the machine with the primitives.** Move `machine.ts` + `todo-machine.pl`
   from `mesh/` into `actors/`. `mesh/registry.ts` imports the machine from `actors/`.
   `machine.ts` already reuses `actors/term.ts` — the move makes the dependency honest
   (mesh depends on actors, not the reverse). Delete the `mesh/` copies.
2. **Inject the transition table into the sandbox as data.** In `WorkItemsActor`,
   `loadMachine()` once, serialize its `transitions` to a JSON literal, and prefix the
   `workitemsLogic` program string with `var TRANSITIONS = [...]`. No functions cross
   the boundary — only ground data (the same discipline as the `.pl` itself).
3. **Drive the reducer's transitions from the table.** Inside the sandbox, add two
   tiny pure helpers over `TRANSITIONS`: `legalStatus(from, to)` and `nextStatus(from)`.
   - `CYCLE` → `nextStatus(item.status)` (delete the literal `open→doing→done` chain).
   - `UPDATE` / `TOGGLE` → apply only if `legalStatus(item.status, target)`; otherwise
     leave state untouched and return a not-ok record (`{ ok:false, error:'illegal …' }`).
   The `create → open` and `delete` transitions stay as they are (creation/removal, not
   status moves).
4. **Prove it.** New `app/tests/todo-machine-gate.test.ts`: build the actor (or reduce
   directly), attempt an illegal move (e.g. `UPDATE` a fresh `open` item straight to
   `done` — `finish` is only legal from `doing`), assert state unchanged + `ok:false`;
   attempt `start` (`open→doing`), assert it applies. Keep `mesh.test.ts` green.

Trade-off: the sandbox now carries a small data table + two helpers (a few lines) but
sheds the hardcoded chain and, more importantly, can never disagree with the canvas.

## Steps

1. `git mv` `app/src/lib/mesh/machine.ts` → `app/src/lib/actors/machine.ts` and
   `app/src/lib/mesh/todo-machine.pl` → `app/src/lib/actors/todo-machine.pl`; fix the
   `import '../actors/term'` path (now `./term`) and update `mesh/registry.ts` +
   `mesh/mesh.test.ts` imports to `../actors/…`.
2. In `workitems.svelte.ts`, load the machine and inject `var TRANSITIONS = <json>` in
   front of `workitemsLogic` (or thread it through the sandbox program assembly).
3. In `views/workitems/logic.ts`, add `legalStatus`/`nextStatus` over `TRANSITIONS`;
   rewrite `CYCLE`, `UPDATE`, `TOGGLE` to use them; delete the literal cycle chain.
4. Write `app/tests/todo-machine-gate.test.ts` (illegal rejected + legal accepted).
5. Run the full gate; confirm net non-increase via `git diff --stat`.

## Files to touch

- `app/src/lib/actors/machine.ts` — moved from mesh/ (import path fix).
- `app/src/lib/actors/todo-machine.pl` — moved from mesh/ (the single source).
- `app/src/lib/mesh/registry.ts` — import machine from `../actors/machine` + `.pl`.
- `app/src/lib/mesh/machine.ts`, `app/src/lib/mesh/todo-machine.pl` — DELETED.
- `app/src/lib/actors/workitems.svelte.ts` — load machine, inject `TRANSITIONS`.
- `app/src/lib/actors/views/workitems/logic.ts` — table-driven transitions; drop the
  hardcoded cycle.
- `app/tests/todo-machine-gate.test.ts` — new gate test.
- `app/tests/mesh.test.ts` — import-path update only; assertions unchanged.

## Acceptance criteria

- [x] Illegal transition rejected — `bun test` runs `todo-machine-gate.test.ts`: a `done→doing` UPDATE leaves the task `done`, `record.ok === false`, one entry in `rejected`. (The original example `open→done` turned out LEGAL — the list checkbox does it — so the machine gained `complete: open→done` and the genuinely-illegal move is `done→doing`.)
- [x] Legal transition accepted — same test: `open→doing` applies; `open→done` checkbox (complete) applies; CYCLE follows the `.pl` order.
- [x] No duplicate machine — `rg 'mesh/(machine|todo-machine)'` prints nothing; `mesh/machine.ts` + `mesh/todo-machine.pl` absent (moved to `actors/`).
- [x] Hardcoded cycle gone — CYCLE/TOGGLE/UPDATE call `nextStatus`/`legalStatus` over the injected `STATES`/`STATUS_MOVES`/`CYCLE`; the literal `open?doing:…` chain is deleted.
- [x] Single terminology — `rg -i 'workitem'` and `rg 'Project List'` over `app/src` print nothing; the entity is `todo` end to end (id `todo`, tools `todo_*`, types `Todo`/`TodoStatus`, `todo(T)`, window "Todos").
- [x] Canvas unbroken — `bun test` shows `mesh.test.ts` green; live canvas renders the todo machine (9 nodes / 24 wires incl. `Complete`) from the colocated `.pl`.
- [x] `bun run check` exits 0 (svelte-check: 457 files, 0 errors). *(`bun run lint` is whole-monorepo biome with a pre-existing dirty baseline of 308 errors — out of scope; all touched files are biome-clean.)*
- [x] Net reduction — `git diff --shortstat` over `app/src`+`app/tests`: 260 insertions, 1789 deletions (−1529).

## Verification

```bash
cd app
bun test                     # incl. todo-machine-gate.test.ts + mesh.test.ts
bun run check                # svelte-kit sync + svelte-check
bun run lint                 # biome
rg 'mesh/(machine|todo-machine)'   # expect: no matches
git diff --stat              # expect: net non-increase in lines
```

## Follow-ons (back to ideate/ after this slice)

- **todoSkill coordinator** — add `members`/coordinator to the runtime `Actor`; make
  the todo operations + list/board views members of one `todoSkill` actor.
- **Canvas from the live bus** — `MeshFlow` renders the running registry; delete the
  parallel `mesh/registry.ts` mock.
- **One `Actor`/`edges()`** — collapse `mesh/model.ts`'s string `edges()` into the
  `term.ts` unification the bus already uses; one primitive, one derivation (the ~20%
  line-reduction lives here).

## Hand-off

```
/aven-build 0142
```

## Progress log

Newest entry first.

- `2026-08-20` — Build → review. Machine colocated in `actors/` (deleted the
  `mesh/` copies; `mesh/registry.ts` imports from `actors/`). The `.pl` is injected
  into the QuickJS sandbox as data (`composeTodoProgram` prepends `STATES` /
  `STATUS_MOVES` / `CYCLE`); the reducer's CYCLE/TOGGLE/UPDATE now gate through
  `nextStatus`/`legalStatus`, the hardcoded chain deleted. **Two mid-build
  requirements folded in (Samuel):** (1) single terminology — `workitem`→`todo`
  everywhere (id, tools, types, views dir, window "Todos"); (2) purely
  data-driven flows — states/moves/cycle come from the `.pl`, nothing hardcoded.
  **Spec correction (reality vs spec):** the PARITY test proves the list checkbox
  does `open→done`, so that move is LEGAL (added `complete: open→done`); the
  genuinely-illegal move is `done→doing`, which the gate rejects. `bun test` 63
  pass (4 new gate tests); `bun run check` 0 errors; live app verified (Todos list
  + checkbox `complete`; canvas 9 nodes/24 wires from the same `.pl`). Follow-on:
  labels/sparks/wire-vocab are still constants in the program — moving them to the
  injected config completes "nothing hardcoded".
- `2026-08-20` — Discovery. Interview settled the goal (**author once, 3 surfaces**),
  direction (**runtime wins**) and first slice (**spine: single-source + gate**).
  Full-stack audit: mesh vs runtime are two worlds sharing only `term.ts`; two
  `Actor` types + two `edges()`; the reducer hardcodes the transition cycle that the
  `.pl` also defines; "projects" is a window label, not an actor; canvas is a mock
  disconnected from the bus. Load-bearing decision confirmed with human: the QuickJS
  **behavior-as-data sandbox stays the core primitive**, so the machine is injected as
  sandbox DATA and the gate lives inside `reduce` — never a host gate. Moved ideate → discover.

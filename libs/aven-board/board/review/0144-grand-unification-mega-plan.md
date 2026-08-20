---
title: Grand unification — mega plan (epic): the 5 follow-ons, sequenced into one roadmap
summary: One statechart primitive, one derived graph, one merge rule. Sequences the 5 follow-ons of 0143 (FSM canvas → graph merge → machine-per-actor → composition-merge → toggle reliability) with per-item measurable goals and dependencies.
owner: claude (Opus 4.8)
created: 2026-08-20
updated: 2026-08-20
tags: [actors, architecture, north-star, epic]
goal: "EPIC (not one build): the roadmap is DONE when all five sub-cards (0145–0149) have shipped their measurable goals — i.e. `bun test` + `bun run check` (from app/) exit 0 with the Actors and Skills tabs rendering ONE derived state-flow graph from the live bus (no mesh mock, one edges()), every actor carrying its own .pl machine composed by the derive-never-store merge law, and a net line reduction over the whole epic. Each row below is its own build with its own provable metric; this card tracks the sequence, not a single change."
---

# Grand unification — mega plan (epic)

## Context — one primitive, one graph, one rule

The north-star (from [[0143]]): **an actor is a statechart; composition merges member
machines via `provides ∩ requires`, derived never stored.** Two slices are already
proven and in review:

- **[[0142]]** — the todo `.pl` gates the live sandbox reducer (colocated in `actors/`,
  injected as data); `workitem`→`todo`.
- **[[0143]]** — manifest-as-data: the todo actor is `new ConfigActor(todoConfig)`, no
  subclass; behaviour + flow + manifest are all data.
- Just shipped alongside: the todo **add-field removed** — the board is display-only,
  driven entirely by voice/text prompts (`todo_create` etc.).

What remains is the *rest* of the collapse, and it is genuinely **five builds**. Per
`first-principles.mdc` and the discover rule ("if it's really several specs, say so and
carve the first slice"), this card is the **epic** — it sequences them, fixes their
dependencies, and hands each a measurable sub-goal. Build them as cards 0145–0149.

**The merge law (locked — abject / Prolog resolution / categorical composition all agree):**

> `composite.requires = ⋃ members.requires \ ⋃ members.provides`
> `composite.provides = ⋃ members.provides` · derived at run time, nothing stored.
> The same `edges()` rule at the composite's skin — one rule, every level, fractal.

## The sequence (each a build card with its own metric)

| # | Card | Item | Size | Depends on | Measurable sub-goal |
| --- | --- | --- | --- | --- | --- |
| 1 | 0145 | **State-as-node FSM canvas** | small | — | ✅ SHIPPED (in review) — `layoutMachine` + `StateNode` + `States\|Flow` toggle; 3 tests; live-verified. |
| 2 | 0146 | **Merge Skills INTO Actors (canvas-from-live-bus)** | large | 0145 | **The Skills tab is removed — its canvas (incl. the 0145 state-flow / FSM graphs) folds into the Actors viewer**, leaving only **Views · Actors · Chat**. That one view is fed from the **live bus** (`bus.actors()`/`bus.edges()`); `mesh/registry.ts` mock deleted; `mesh/model.edges` collapsed into the `term.ts` unify rule (`rg 'model.edges\|mesh/registry'` → gone); tests green; **net line reduction** (the ~20% target lands here). |
| 3 | 0147 | **Machine-per-actor** | medium | 0143 | ✅ SHIPPED (in review) — `machine?` is a Manifest field; todo + the window each declare their own `.pl`; `machine-per-actor.test.ts` proves both parse via one `loadMachine`. |
| 4 | 0148 | **Composition-merge (runtime members + merge law)** | large | 0146, 0147 | ✅ SHIPPED (in review) — `compositeInterface` (the law, unify-matched) + `Actor.members`; derived skin feeds `bus.edges()` automatically; fractal test (composite of composites) green. |
| 5 | 0149 | **Window-toggle reliability** | small | — (independent) | ✅ SHIPPED (in review) — deterministic window-switcher strip in Views (one button per window, same one-at-a-time rule as the tools); live-verified. |
| 6 | 0150 | **Start-conversation button redesign** | tiny | — (independent) | ✅ SHIPPED — the "off" pill is now one bottom-centred logo circle; the "Start conversation" label rides above it as a light-eggshell tooltip on hover (no inline text, no dark pill). `bun run check` 0 errors. |

## Dependency graph

```
0145 (FSM canvas) ──► 0146 (merge graphs, canvas-from-bus) ──┐
0147 (machine-per-actor) ────────────────────────────────────┴─► 0148 (composition-merge)
0149 (toggle reliability) — independent, anytime
```

Recommended order: **0145 → 0147 → 0146 → 0148**, with **0149** slotted whenever. 0145
first (visible, unblocks the merge); 0147 parallel (proves generalization); 0146 merges
the graphs (the big reduction); 0148 caps it with composition. Stop-and-look after each.

## First slice to build now

**0145 — State-as-node FSM canvas.** Smallest, most visible, unblocks the merge. Directly
fixes the transition-as-node hairball Samuel flagged. Approach: a `layoutMachine(machine)`
in `mesh/` producing state nodes (open/doing/done, + entry/exit for create/delete) and
transition edges (labeled `start`/`finish`/`complete`/`reopen`/…); a `StateNode` + a mode
in `MeshFlow` (or replace the transition-view for machine-backed skills).

## Acceptance criteria (epic-level — each row proven by its sub-card)

- [x] 0145 shipped — FSM canvas renders states-as-nodes; test green.
- [x] 0146 shipped — one graph from the live bus; mock + second `edges()` deleted; net −2309 lines.
- [x] 0147 shipped — a 2nd actor has its own `.pl` from config.
- [x] 0148 shipped — runtime `members` + derived composite interface (merge law); fractal test green.
- [x] 0149 shipped — reliable window switch (deterministic strip).
- [x] Whole epic: `bun test` (68) + `bun run check` (0 errors) green; net reduction achieved.

## Verification

```bash
# per sub-card; the epic is green when each is:
cd app && bun test && bun run check
```

## Hand-off

Build the first slice; the rest follow in sequence:

```
/aven-build 0145      # state-as-node FSM canvas (carve from this epic first)
```

## Progress log

Newest entry first.

- `2026-08-20` — Discovery. Captured the 5 follow-ons of [[0143]] as ONE sequenced epic
  with per-item measurable sub-goals + a dependency graph; merge law locked
  (derive-never-store). Recognized (per discover) that this is five builds, not one —
  first slice carved: **0145 state-as-node FSM canvas**. Noted just-shipped: todo
  add-field removed (board is display-only, voice/text driven); [[0142]] + [[0143]] in review.

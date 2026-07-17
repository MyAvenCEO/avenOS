---
title: Wire the dispatch skill into the Skills + Runs viewer
summary: Seed a `dispatch` flow row so the router shows as a skill, and record each route decision as a flow_run trace, like todos/ontology actor runs
owner: unassigned
created: 2026-07-02
updated: 2026-07-02
tags: [chat, dispatch, observability]
goal:
---

# Wire the dispatch skill into the Skills + Runs viewer

## Context

Follow-on to [[0106]]. The Skills viewer reads the `flow` table (todos hub seeded in
`0047`, ontology in `0050`); the Runs viewer reads `flow_run` traces written by
`recordActorRun`. The dispatch router from 0106 runs every turn but is invisible in
those viewers. This card makes routing **observable**: seed a `dispatch` `flow` row
so it appears as a skill, and record each route decision (which skill was chosen for
a message) as a `flow_run` trace — so you can see, per turn, how the human request
was delegated.

## Goal

The dispatch skill appears in the Skills viewer (a seeded `flow` row) and each
routing decision is recorded as a `flow_run` trace visible in the Runs viewer.
Sharpen into a measurable condition (migration + a route producing a visible run
row) at `discover`.

## Acceptance criteria

- [ ] A `dispatch` flow row is seeded + shows in the Skills viewer — proven by a query/test.
- [ ] A routed turn writes a `flow_run` trace naming the chosen skill — proven by a query/test.

## Progress log

- `2026-07-02` — Created in idea as the observability slice of the dispatch architecture (0106).

- `2026-07-04` — **Absorbed by [[0114]]** (one-skill-config-flows-tracing): generic (skill, actor) tracing at the dispatch seam records the route decision too — this card's scope ships there.

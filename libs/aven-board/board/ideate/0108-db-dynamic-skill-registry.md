---
title: Skill/tool registry as config-as-data (DB skill table)
summary: Move SKILL_REGISTRY from hardcoded TS into a DB `skill` table so skills + their tool/context bindings are dynamic, like data_bundles/data_operations/vibes
owner: unassigned
created: 2026-07-02
updated: 2026-07-02
tags: [chat, dispatch, config-as-data]
goal:
---

# Skill/tool registry as config-as-data (DB skill table)

## Context

Follow-on to [[0106]]. That card introduces `SKILL_REGISTRY` (skill id → tool ids)
as a hardcoded TS map — deliberately, as a clean seam. This card moves it into the
DB as **config-as-data**, matching the "fully dynamic data brain" north star where
`data_bundles`, `data_operations`, and the vibe registry already live in Postgres.
A `skill` row names its label/description, its tool bindings, and its Tier-3 context
providers; the router menu + `advertisedTools` read from the DB, so a new skill is
added with a row, not a code change.

## Goal

`SKILL_REGISTRY` is sourced from a DB `skill` table (seeded via a betterauth
migration); the router and `advertisedTools`/`chatToolDefinitionsFor` resolve skills
from the DB; adding a skill needs no TS change. Sharpen into a measurable condition
(a migration + a test proving a DB-defined skill is routable + advertises its tools)
at `discover`.

## Acceptance criteria

- [ ] A `skill` table exists + is seeded (todos/ontology/website); the router menu + advertised tools derive from it — proven by a test.
- [ ] Adding a skill row (no TS change) makes it routable — proven by a test.

## Progress log

- `2026-07-02` — Created in idea as the config-as-data slice of the dispatch architecture (0106).

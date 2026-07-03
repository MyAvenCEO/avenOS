---
title: Migrate Composer/website tools into proper tool-actors
summary: Move the inline server-side show/edit/deploy_website tools into the @avenos/skills/tools actor registry, like data_crud and ontology
owner: unassigned
created: 2026-07-02
updated: 2026-07-02
tags: [chat, dispatch, refactor]
goal:
---

# Migrate Composer/website tools into proper tool-actors

## Context

Follow-on to [[0106]] (dispatch skill). The website/Composer tools
(`show_website`, `edit_website`, `deploy_website`) still carry their handlers
**inline in `libs/betterauth/src/ai.ts`**, unlike `data_crud` / `ontology` /
`query` / `mutate` / `bundle`, which are self-contained tool-actors (config +
behavior) in `@avenos/skills/tools` dispatched via `TOOL_ACTORS`. The registry
comment in [`skills/tools/registry.ts`](../../../../skills/tools/registry.ts)
already flags them as "next to migrate to a tool-actor." 0106 routes to them as a
bucket but leaves the internals inline; this card finishes the job.

## Goal

The three website tools are `ToolActor`s in `@avenos/skills/tools` with their
handlers moved out of `ai.ts`; `chatToolDefinitionsFor('website')` resolves them
from `TOOL_ACTORS`; the `ai.ts` tool loop no longer special-cases them; the website
flow still works (show → edit → deploy HITL) end-to-end. Sharpen into a measurable
completion condition (tests + a green website round-trip) at `discover`.

## Acceptance criteria

- [ ] `show_website` / `edit_website` / `deploy_website` are `ToolActor` modules; `ai.ts` has no inline `if (tc.name === 'edit_website')` blocks — proven by grep.
- [ ] `bunx tsc` green; website show/edit/deploy still works (HITL confirm intact).

## Progress log

- `2026-07-02` — Created in idea as the website slice of the dispatch architecture (0106).

- `2026-07-03` — **Superseded by [[0110]]** (fully-dynamic-config-and-standardized-viewer), which absorbs this scope into the all-in-one config→DB + viewer card.

- `2026-07-03` — **Reactivated**: 0110 built the config→DB core but DEFERRED the website handler→engine migration (it touches the live chat streaming loop). This card carries that remaining slice: move show/edit/deploy_website handlers out of ai.ts into ToolActor engines so `engineFor(name)` resolves them (their actor DEFINITIONS are already seeded + advertised from the DB by 0110).

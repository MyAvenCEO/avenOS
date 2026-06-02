---
title: Bootstrap aven-board
summary: Stand up the aven-board package, the /board nav route, and the agent workflow docs.
owner: agent
created: 2026-06-02
updated: 2026-06-02
tags: [meta, infra]
goal: "`bun run check` and `bun run lint` exit 0, `/board` renders the four columns, and a card opens its full doc with a bottom-center back button"
---

# Bootstrap aven-board

## Context

AvenOS needed a place to track work: somewhere to throw ideas, spec them, let an
agent build them, and verify the result — all git-based, no database.

## Approach

A standalone `@avenos/aven-board` package holds the kanban engine (markdown
loader, parser, renderer), the presentational Svelte components, the board
content folders, the templates, and the agent instructions. The Tauri app mounts
it at the `/board` nav route.

## Acceptance criteria

- [x] `idea / plan / test / done` columns, each backed by a folder of `.md` files
- [x] Cards show a title + summary; clicking opens the full doc full-screen with a bottom-center back button
- [x] `AGENTS.md` / `CLAUDE.md` explain the workflow
- [x] Templates for plans and work items
- [x] `board` item in the app's main nav

## Progress log

- `2026-06-02` — Shipped. This card is the first inhabitant of **done**.

---
title: Window-toggle reliability — a deterministic window switcher
summary: "Show the board" no longer depends on the model choosing to call a tool — a window-switcher strip in the Views tab opens any window with one click, same one-at-a-time rule as the *_window_toggle tools.
owner: claude (Opus 4.8)
created: 2026-08-20
updated: 2026-08-20
tags: [ui, actors, reliability]
goal: "`bun run check` (from app/) exits 0 and the Views tab renders one deterministic button per window actor (verified live: clicking 'Kanban Board' opens the board and closes the list without any model involvement); the voice tools (*_window_toggle) drive the SAME open state."
---

# Window-toggle reliability

## Context

Carved from [[0144]] (slice 5). Repro (chat export): "show me kanban board" → the model
answered "Board is shown" with **`calls: []`** — no tool call, nothing happened. The board
itself was verified healthy; the failure was qwen3.5's tool-calling flakiness. The fix is
not a better prompt but removing the model as the single point of failure for a pure view
change: **a deterministic affordance** driving the same state the tools drive.

## Shipped

- [x] A window-switcher strip at the top of the Views tab — one button per window actor
  (`bus.actors().filter(isWindow)`), one-at-a-time on click (identical rule to the
  `*_window_toggle` handler), `registryTick` bumped so the surface re-renders.
- [x] Voice keeps working through the same state: the tools and the buttons write the
  same `open` flags — two doors, one truth.
- [x] Live-verified: click "Kanban Board" → board opens (3 columns), list closes; click
  "Todos" → back. `bun run check` 0 errors.

## Progress log

- `2026-08-20` — Built + verified live; straight to review (small slice of [[0144]]).

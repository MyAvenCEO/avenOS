---
title: Voice pill + todo view UI polish
summary: The batch of voice-modal and todo-view refinements — inline loading, text-mode mute, add-field removal, and the start-conversation button redesign (bordered circle, standing tooltip with arrow, marine hover, auto-focus on text).
owner: claude (Opus 4.8)
created: 2026-08-20
updated: 2026-08-20
tags: [ui, voice]
goal: "`bun run check` (from app/) exits 0; the voice pill never grows a second row while loading; text mode stops STT + mutes TTS and voice mode restores both; the todo view has no add-field; the off-state is one bordered logo circle with a standing eggshell tooltip (down-arrow) that fills marine on hover; switching to text mode auto-focuses the input."
---

# Voice pill + todo view UI polish

## Context

A running batch of UI refinements to the dashboard voice pill and the todo view,
requested interactively while the grand-unification work (0142–0148) proceeded. Small,
verifiable, mostly Tauri-surfaced. Captured here as one record.

## Shipped

- [x] **Loading progress inline** — the STT/TTS load bar shares the pill's one line
  (word + thin `h-1` bar + percent); the separate bottom row that grew the notch is gone.
- [x] **Text mode deactivates voice** — a `muted` flag on the Speaker core (`feed`/`flush`
  no-op when muted); entering text `listener.stop()` + `speaker.silence()` + `muted=true`;
  returning to voice unmutes + re-arms the mic; `beginConversation` always unmutes.
- [x] **Todo add-field removed** — the list view has no "Add a task" input; the board is
  display-only, driven by voice/text prompts (`todo_create` etc.).
- [x] **Start-conversation button redesign** — the "off" pill is one bottom-centred logo
  circle: a **bordered circle** (edge), the "Start conversation" label a **standing**
  eggshell tooltip **with a down-arrow** pointing at it (always shown, not hover-only),
  and a **marine hover** (fills `bg-primary` + ring) instead of the grow animation.
- [x] **Auto-focus on text** — switching voice→write lands the cursor in the input (an
  `$effect` focuses the textarea when `typing` flips true).

Verification: `bun run check` — 0 errors (462 files). Behaviours surface in the Tauri app
(loading, off-state, voice/text toggle) — verify there; the todo add-field removal is
visible in the browser preview too.

## Note — the Skills→Actors merge is 0146

Samuel confirmed the end-state: **fold the Skills tab into the Actors viewer** (including
the state-flow / FSM graphs from [[0145]]), leaving only **Views · Actors · Chat**. That
is the scope of [[0144]]'s card **0146** (canvas-from-bus / merge the two graphs) — refined
there, not built here.

## Progress log

- `2026-08-20` — Shipped as a batch alongside 0145; recorded for review. Merge-into-Actors
  intent folded into 0146's scope.

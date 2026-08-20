---
title: Persist the voice-driven todos
summary: 0122's todos live in a browser `$state` store and vanish on reload. Give them a real home — and decide whether that home is predications, aven-db, or something simpler.
owner: unassigned
created: 2026-08-09
updated: 2026-08-09
tags: [todos, data, voice]
goal:
---

# Persist the voice-driven todos

## Context

[[0122]] deliberately keeps todo state in the browser: a Svelte `$state` store is
the single source of truth and the agent mutates it over LiveKit RPC. That is the
right shape for proving the loop, and the wrong shape for actually using it —
reload and the list is gone.

The interesting question is not "add a database", it is **which** store, given
[[0121]] stripped everything. Prior art worth re-reading before choosing:
[[0087]] (todos vertical, two-layer schema split) and [[0085]]/[[0102]] (the
universal Lojban x1–x5 predication model — a todo is a predication, not a flat
row). Repeating a flat `todos` table would walk back a decision the board already
made.

Whatever is chosen, the RPC contract in `libs/aven-voice-agent/src/protocol.ts`
should not need to change — the store behind it should.

## Goal

Todos survive a reload, and the persistence choice is consistent with the
predication model rather than a one-off table.

## Progress log

- `2026-08-09` — Created in ideate; carved out of 0122 during its discovery.

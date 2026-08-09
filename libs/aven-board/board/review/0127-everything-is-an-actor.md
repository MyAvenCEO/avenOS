---
title: Everything is an actor — real mesh, real execution engine
summary: Finish the migration board 0126 started. The mocked intent-router stubs are deleted; in their place the app's REAL pipeline becomes the mesh — Listener (ears), Chat (brain), WorkItems (hands), Speaker (voice) — each an actor with a manifest and Prolog contracts. The execution engine is forward-chaining over contracts — bus.emit(predicate, payload) delivers to every actor whose requires unifies with the predicate, into a real per-actor MAILBOX (async, one message at a time, ordered) — so what the Actor Explorer shows and what actually runs are the same graph. The page stops constructing/wiring the pipeline; it renders actor state.
owner: claude
created: 2026-08-09
updated: 2026-08-09
tags: [actors, abject, execution, mailbox, migration]
goal: "`bun run check` exits 0 AND `bun test app/tests/actors.test.ts` exits 0 including new engine tests (emit() fan-out reaches exactly the actors whose requires unify with the emitted predicate; a per-actor mailbox processes async handlers strictly one at a time in arrival order; an async handler's rejection is contained as a structured error, not an unhandled rejection) AND app/src/lib/actors/seed.ts is deleted AND the dashboard page constructs no pipeline (`grep -cE \"new (Chat|Speaker|Listener)\\(\" app/src/routes/dashboard/+page.svelte` prints 0) AND the registry holds listener, chat, speaker and workitems actors with contracts (`grep -n \"utterance\\|reply\" app/src/lib/actors/*.svelte.ts` shows the pipeline predicates) AND every Acceptance criterion below is checked"
---

# Everything is an actor — real mesh, real execution engine

## Context

Board 0126 built the primitive (Actor, bus, ask(), explorer) and rebuilt the todo app on it, but
the voice pipeline still lives outside the mesh: the page constructs Speaker/Listener/Chat and
wires them with callbacks, and the mesh's only interesting edges come from mocked intent-router
stubs. The user's call: delete the mocks, migrate the real pieces, and make the engine real —
"everything is an actor, wire the currently existing actors with the proper execution engine."

Decided in discovery:
- **Mailboxes are real.** Async handlers, one message at a time per actor, arrival order — the
  classic actor shape the abject spec assumes ("bounded mailboxes, one message at a time").
- **The engine is forward-chaining over contracts.** `bus.emit(predicate, payload)` delivers to
  every actor whose `requires` unifies with the predicate's functor; the handler for a
  subscribed predicate is the handler named after its functor. Produce/require stops being
  documentation and becomes routing — the Prolog-enforced determinism the primitive promised.
- **The real pipeline is the seed.** utterance(T): Listener → Chat. delta(D) + reply(R):
  Chat → Speaker. interrupted(): Listener → Chat + Speaker (barge-in). work via envelopes:
  Chat → WorkItems (tool calls, as today). The explorer then shows the graph that actually runs.
- **Wrappers, not rewrites.** Speaker/Listener/Chat keep their proven internals (TTS clock,
  VAD, degeneration guards); actors wrap the existing instances, expose manifests, contracts,
  instanceState() and handlers. The UI keeps reading the same runes state.
- The intent-router seed stubs are deleted (ignore mocked inbox/intent things).

## Goal

The app's real pipeline runs as contract-routed messages between registered actors, with real
mailboxes, and the page merely renders it.

**Completion condition** (identical to frontmatter `goal`): see frontmatter.

## Approach

- `actor.ts`: `Handler` may return a Promise; `Actor` gains a mailbox — `deliver(method,
  payload)` enqueues and returns a Promise resolved when that message is processed; an internal
  pump processes strictly sequentially; handler throws become structured error results.
- `bus.ts`: `send/dispatch` route through mailboxes (async now); `emit(predicate, payload,
  from)` fans out to actors whose `requires` unify (handler name = functor). `edges()` and the
  explorer stay as-is — they already derive from the same contracts.
- `speaker.actor.svelte.ts`, `listener.actor.svelte.ts`, `chat.actor.svelte.ts`: wrappers with
  manifests + contracts + instanceState(); the pipeline callbacks become emits.
- Page: registration + emits move into an `actors/wire.ts` (or the actors themselves); the page
  imports the singletons for rendering only.
- Delete `seed.ts`; explorer shows four live actors.

## Steps

1. Mailbox + async handlers + emit in actor.ts/bus.ts; engine tests (fan-out, ordering,
   containment) in app/tests/actors.test.ts.
2. Speaker/Listener/Chat actor wrappers with contracts; wire emits; page slims to rendering.
3. Delete seed.ts; adjust explorer copy if needed.
4. `bun run check` + tests green; live verify: text turn end-to-end, voice states intact,
   explorer shows the real mesh with four green instances; ask() the Chat actor.

## Files to touch

- edit: `app/src/lib/actors/{actor,bus}.ts`, `app/tests/actors.test.ts`,
  `app/src/routes/dashboard/+page.svelte`
- new: `app/src/lib/actors/{speaker.actor.svelte.ts,listener.actor.svelte.ts,chat.actor.svelte.ts}`
  (+ wiring)
- delete: `app/src/lib/actors/seed.ts`

## Acceptance criteria

- [ ] Engine tests green: emit fan-out by unification; strict per-actor ordering under async
      handlers; thrown handler → structured error result
- [ ] seed.ts deleted; explorer lists listener/chat/speaker/workitems, all with live instances
- [ ] Page constructs no pipeline (grep prints 0); a text turn works end-to-end through emits
- [ ] Voice phases (Bereit/Hört zu/Denkt nach/Spricht) still derive correctly from actor state
- [ ] `bun run check` exits 0

## Verification

- `bun test app/tests/actors.test.ts`
- `bun run check`
- `grep -cE "new (Chat|Speaker|Listener)\(" app/src/routes/dashboard/+page.svelte` → 0
- live preview walkthrough (turn + explorer + ask)

## Progress log

- 2026-08-09 — discovered (from /aven-discover interview): scope = migrate the real pipeline,
  delete mocks, engine = contract-routed emit + real mailboxes; card written to discover/.
- 2026-08-09 — built: mailboxes (strict per-actor ordering, containment) + emit forward-chaining
  in the engine (12 tests green); Speaker/Listener/Chat wrapped as actors with English-syntax
  predicates (utterance/interrupted/delta/reply/discard); seed stubs deleted; page constructs
  nothing. Live-verified: turn ran emit→mailbox→envelopes→list; explorer shows the real mesh
  with live instances and derived relations. Moved to review/.

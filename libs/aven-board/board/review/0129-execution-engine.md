---
title: Execution engine — proofs run, goals become runs
summary: The tier the primitive was built for — bus.satisfy(goal, facts) executes what prove() plans. The proof tree is walked postorder with TYPED payloads (0128's unification bindings carry real values); each step delivers an envelope to its producer; the whole thing is recorded as a RUN with per-step state (in/out payloads, ok, duration, attempts). Contract-only actors declared `llm: true` execute via the injected LLM — description as instruction, requires-payload in, produces-payload out — so an actor minted by actor_create RUNS immediately; deterministic actors stay deterministic and the LLM boundary stays explicit (law amended: LLM only where declared — ask() and llm-actors — never in dispatch or routing). Step failure triggers RUNTIME BACKTRACKING: the next producer of the same predicate is tried, exactly like the static prover, and the run records both the failure and the alternative. UI: the Beweis card gains Ausführen (goal + facts input); a Runs panel below lists past runs expandable to per-step detail. A goal_run tool lets the model execute goals by voice.
owner: claude
created: 2026-08-09
updated: 2026-08-09
tags: [actors, execution, runs, llm-actors, backtracking]
goal: "`bun run check` exits 0 AND `bun test app/tests/actors.test.ts` exits 0 including new engine tests ((1) a two-step deterministic chain executes with value passing — the second actor receives the first actor's output bound through the shared variable; (2) runtime backtracking — a producer whose handler keeps throwing is abandoned and the next producer of the same predicate completes the run, with BOTH attempts recorded on the run; (3) an actor declared llm:true with no handlers executes via an injected fake LLM, its description appearing in the system prompt and its produces-payload returned; (4) an llm:true actor without an injected LLM fails the step as a structured error, not a throw; (5) a run records goal, status, and per-step {actor, predicate, in, out, ok, duration}) AND the explorer has Ausführen and a Runs panel (`grep -n \"Ausführen\\|Runs\" app/src/lib/actors/ActorExplorer.svelte` shows both) AND goal_run is a registered tool (`grep -n \"goal_run\" app/src/lib/actors/*.ts` non-empty) AND every Acceptance criterion below is checked"
---

# Execution engine — proofs run, goals become runs

## Context

Boards 0126–0128 built the complete static primitive: mailboxes, envelopes, emit forward-
chaining, prove() with NAF + backtracking, supervision-retry, ask(), windows-as-actors, and
(0128, specced) real unification + trace + actor_create + registry-actor. The proof tree has
been "the execution plan the runtime will one day emit" since 0127. This card is that day.

Decided in discovery (user-confirmed, all on the recommended option):
- **LLM actors as a declared kind.** `llm: true` on a manifest makes the description the
  instruction: requires-payload in, produces-payload out, via the injected LLM. actor_create
  mints runnable actors. The unification law is amended, not broken: LLM only where declared —
  ask() and llm-actors — never in dispatch or routing.
- **Runtime backtracking.** A step that fails (handler error after supervision retry, or bad
  LLM output) does not end the run: the next producer of the same predicate is tried, mirroring
  the static prover. The run records the failed attempt AND the successful alternative.
- **Runs live in the explorer.** The Beweis card gains Ausführen (payload/facts input beside
  the goal); a Runs panel lists past runs, expandable to per-step state. No fourth tab.

Dependency: **0128 builds first** — execution needs its unification bindings (typed payloads),
its trace (runs reference envelope history), and actor_create (the llm-actor demo path).

## Goal

prove() plans it, satisfy() runs it: goals execute over the registry with typed payloads,
runtime backtracking, LLM actors as declared, and runs as first-class visible history.

**Completion condition** (identical to frontmatter `goal`): see frontmatter.

## Approach

- `bus.satisfy(goal, facts)` — prove with bindings; walk postorder; per step: resolve the
  producer, build the payload from bound values, `deliver(functor, payload)`; parse the
  result's record for produced values; bind them onward. Failure → next producer (backtracking)
  → exhausted = failed run.
- LLM handler synthesis: an actor with `llm: true` and no handler for the functor gets one at
  receive-time — system prompt from manifest description + contract, JSON-shaped output
  validated against produces; missing bus.llm = structured step failure.
- `Run` record `{ id, goal, status, startedAt?, steps: [{ actor, predicate, in, out, ok,
  duration, attempt }] }` in a ring buffer on the bus; `bus.runs()`.
- `goal_run` tool (on the registry actor or bus tool list): `{ goal, facts? }` → satisfy →
  wire-prose result for the model.
- Explorer: Ausführen button + facts textarea on the Beweis card; Runs panel listing
  `bus.runs()` newest-first, expandable per-step; failed steps red, backtracked attempts
  visible.
- Tests as in the goal line; all prior tests stay green.

## Steps

1. Build 0128 (prerequisite — separate card).
2. satisfy() + Run records + tests (chain, backtracking, llm-actor, llm-missing, run shape).
3. LLM handler synthesis behind `llm: true`; actor_create accepts the flag.
4. goal_run tool; explorer Ausführen + Runs panel.
5. `bun run check`; live verify: mint an llm-actor by voice, run its goal, inspect the run.

## Acceptance criteria

- [x] Deterministic chain runs with value passing through shared variables
- [x] Runtime backtracking: failed producer abandoned, alternative completes, both recorded
- [x] llm:true actor executes via injected LLM; without one, fails structured
- [x] Runs panel shows per-step state; Ausführen runs a goal with facts from the UI
- [x] goal_run callable by the model; all prior tests green; `bun run check` exits 0

## Verification

- `bun test app/tests/actors.test.ts`
- `bun run check`
- live: "Erschaffe einen Actor der aus text(M) eine zusammenfassung(M) macht" → goal_run →
  Runs panel shows the run with the LLM step

## Progress log

- 2026-08-09 — BUILT: bus.satisfy() executes the proof tree postorder (clause-body handler =
  the produced functor; payload = requirement outputs keyed by functor over external facts);
  runtime backtracking across producers with both attempts on the run; llm:true actors get a
  receive-time handler over bus.llm (raw complete() lane — the prose lane's brace-stripping
  had gutted the JSON, fixed); goal_run on the registry; explorer Beweis card gained
  Ausführen + facts input and a Runs panel (expandable per-step, Versuch-Badge); the generic
  face runs its first produced goal directly (freeform input wraps as first requirement).
  30/30 tests green incl. the 5 engine tests; bun run check 0 errors. Live: voice-minted
  "uebersetzer" (Kimi-K3 composer, separate model lane) translated real text via goal_run
  AND via its face. Beyond the card: composer lane (actor_create/update take wunsch/
  anweisung, kimi-k3 drafts the manifest), single-active window rule, board+list as own
  window actors.
- 2026-08-09 — discovered (/aven-discover, "the next round"): scope = proofs run; three
  load-bearing decisions confirmed (llm-actors as declared kind, runtime backtracking, runs in
  the explorer with Ausführen). Depends on 0128 building first.

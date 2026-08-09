---
title: Wire the rest, locally — registry-actor, trace/runs, actor_create, real unification
summary: The four remaining abject.world/Prolog pieces that are wireable NOW without capabilities, P2P or a KnowledgeBase (all excluded by the user). (1) Registry-as-actor — the bus's directory becomes interviewable and tool-reachable (registry_list/registry_describe). (2) Trace/Runs — every envelope and emit recorded in a ring buffer; the explorer gains a Trace panel, giving actors run history instead of one eternal anonymous present (instances vs templates, made visible). (3) actor_create — the ObjectCreator v0: the model mints a new contract-carrying actor from a manifest JSON at runtime; it appears in the registry, graph, tools and prover instantly — growth by adoption, live. (4) Argument unification — predicates parsed as terms (uppercase = variable), unify with substitution in prove() and unifiability checks in edges/emit; closes the biggest honest Prolog gap (mail(M) currently matches by functor name only).
owner: claude
created: 2026-08-09
updated: 2026-08-09
tags: [actors, abject, prolog, unification, trace, registry]
goal: "`bun run check` exits 0 AND `bun test app/tests/actors.test.ts` exits 0 including new tests (term parsing + unification with variable binding: intent(M, hoch) unifies with intent(X, hoch) but not intent(X, niedrig); prove() carries bindings; registry actor answers registry_list with every registered id; actor_create registers a manifest-only actor that immediately appears in edges()/prove(); the trace records an envelope with sender, method and ok) AND the explorer shows a Trace panel (`grep -n \"Trace\" app/src/lib/actors/ActorExplorer.svelte` non-empty) AND the registry actor is registered (`grep -n \"registry\" app/src/lib/actors/*.ts` shows a RegistryActor) AND every Acceptance criterion below is checked"
---

# Wire the rest, locally

## Context

After boards 0126/0127 and the window-actor step, the local primitive is complete: mailboxes,
envelopes, emit forward-chaining, prove() with NAF + backtracking, supervision-retry, ask(),
derived tools/edges/stages, windows as actors. The remaining abject.world column, minus what the
user excluded (capabilities, P2P, KnowledgeBase) and minus what needs typed executable payloads
(proxy/negotiator/self-healing codegen, scrum runtime), leaves four pieces that are wireable
against today's registry:

1. **Registry-as-actor** — the claim "a layer the bus can't see doesn't exist" is currently
   half-true: the directory is bus methods, not an actor. Wrap it: `registry_list`,
   `registry_describe(id)` as methods; ask() answers about the whole mesh.
2. **Trace / Runs** — actors currently live in one eternal anonymous present. A ring buffer of
   every envelope (id, from→to, method, ok, duration) + every emit fan-out gives run history;
   an explorer Trace panel shows the last N, filterable by the selected actor. This is the
   template/instance split extended into time — instances have biographies.
3. **actor_create** — ObjectCreator v0: a tool taking a manifest JSON, validating it, and
   registering a contract-carrying (handler-less) actor at runtime. Tool list, graph, stages
   and prover pick it up instantly. "Erschaffe einen Actor, der aus text(M) eine
   zusammenfassung(M) macht" becomes a real, provable registry change by voice.
4. **Argument unification** — predicates become terms: `intent(M, hoch)` parses to functor +
   args, uppercase-initial args are variables. `unify(a, b)` with substitution; prove() threads
   bindings through the tree (rendered in the proof UI); edges()/emit() use unifiability
   instead of functor equality. Constants must match: `intent(X, hoch)` no longer unifies with
   `intent(M, niedrig)`.

Explicitly out (user): capabilities/permission gates, P2P/CRDT, KnowledgeBase. Out (needs typed
payload execution): runProof, proxy generation, self-healing, scrum loop.

## Goal

The four pieces wired and visible: an interviewable registry, envelope history in the explorer,
runtime actor creation by the model, and proofs that bind variables.

**Completion condition** (identical to frontmatter `goal`): see frontmatter.

## Approach

- `term.ts` — parse(predicate) → { functor, args }, isVariable (uppercase initial), unify(a, b,
  bindings) → bindings | null, applyBindings. Pure, tested.
- `bus.ts` — edges()/emit()/stages() route on unifiability; prove() threads bindings and stores
  them per ProofStep (render as `M = …` chips); trace ring buffer (cap ~200) written in
  send/emit; `trace()` accessor.
- `registry.actor.ts` — RegistryActor with registry_list/registry_describe + actor_create
  (manifest JSON validated: id/name/description/tags/methods shape, id collision refused).
- Explorer — Trace panel (last N envelopes, filter by selected actor); proof nodes show
  bindings.
- Tests for all four in app/tests/actors.test.ts.

## Steps

1. term.ts + unification tests; swap bus matching to unifiability (all existing tests must stay
   green — functor-only cases still unify).
2. Trace buffer + tests; explorer Trace panel.
3. RegistryActor + actor_create + tests; register in chat.actor wiring order (before ChatActor
   so its tools include the registry).
4. `bun run check`; live verify: create an actor by chat, watch it join graph + stages + prover;
   trace shows the turn's envelopes.

## Acceptance criteria

- [ ] unify: variable binding, constant mismatch rejection, variable-variable, bindings threaded
      through prove() and visible in the proof UI
- [ ] registry_list names every actor; registry_describe returns manifest prose
- [ ] actor_create by the model: new actor visible in registry list, graph, and provable
- [ ] Trace panel shows the envelopes of a live turn, filterable by actor
- [ ] All prior 18 tests still green; `bun run check` exits 0

## Verification

- `bun test app/tests/actors.test.ts`
- `bun run check`
- live: chat "Erschaffe einen Actor …" → Actors tab shows it; Trace shows the turn

## Progress log

- 2026-08-09 — discovered (from the e2e audit): the four wireable-now pieces named, exclusions
  confirmed by user (capabilities, P2P, KnowledgeBase); card written to discover/.

---
title: Local actor core — one primitive, ask(), actor explorer
summary: Decomplexify the dashboard's skills/flows/actors ontology into ONE primitive, the Actor (Abject-inspired, local-only, no P2P) — { id, manifest, handlers, mailbox } on a minimal message bus. Every actor answers ask() (the one LLM-touching handler; manifest fallback without LLM). The model's tool list is DERIVED from the registry's manifests instead of hand-assembled; tool calls become ordinary envelopes. Flow templates are deleted — truest to the theory ("compression, not abstraction"), the Flows tab renders the LIVE registry as a Svelte Flow (@xyflow/svelte) graph, edges derived by unifying produces→requires contracts, grouped by tags. WorkItems becomes the first real actor; the intent-router chain seeds as contract-carrying stub actors.
owner: claude
created: 2026-08-09
updated: 2026-08-09
tags: [actors, abject, flows, architecture, svelte-flow]
goal: "`bun run check` exits 0 AND `bun test app/tests/actors.test.ts` exits 0 (envelope routing via the bus; edge derivation from produces→requires unification; ask() falls back to manifest prose when no LLM is injected) AND the chat's tool specs are derived from the actor registry, not imported constants AND the Actors tab renders the explorer (`grep -n \"ActorExplorer\" app/src/routes/dashboard/+page.svelte` non-empty) with template and instance as separate cards AND app/src/lib/skills is deleted AND every Acceptance criterion below is checked"
---

# Local actor core — one primitive, ask(), derived flows

## Context

The dashboard grew a three-level ontology (skills → flows → actors) in one session. The Abject
architecture (abject.world) shows the consolidation: there is ONE species — an actor with an id,
a manifest, private state, and handlers, on a message bus — and everything else (skills, flows,
registries, views) is composition over it. Its key arguments adopted here:

- **The big idea is messaging** — design the space between modules, not the modules.
- **Compression, not abstraction** — stored descriptions (flow templates!) freeze a judgment and
  drift; derived views regenerate. Hence: delete templates, derive the flow graph from the live
  registry.
- **ask() as the one LLM-touching handler** — every actor can be interviewed; ordinary messages
  stay deterministic.
- **Manifest as self-description** — the LLM's tool list derives from manifests: register an
  actor, the model can call it ("grows by adoption").

Decided in discovery (load-bearing, user-confirmed):
- Name: **Actor** (not Abject, not Aven). `app/src/lib/actors/`.
- **ask() ships in this slice** (LLM via injected function; manifest-prose fallback keeps it pure).
- Flows: **pure derivation, no templates** — "whatever is truest to the clean abjects actor
  architecture".
- Envelope: **minimal, growable** — `{ id, from, to, method, payload, correlationId? }`.
- **Local only.** No P2P, no CRDT, no WASM sandbox, no supervision, no scrum loop — later cards.
- Reuse **Svelte Flow (@xyflow/svelte)** for the graph, per user.

## Goal

One actor primitive under everything the dashboard does, with the flow graph derived live from
the registry and rendered in Svelte Flow.

**Completion condition** (identical to frontmatter `goal`): see frontmatter.

## Approach

- `app/src/lib/actors/actor.ts` — `Manifest` (id, name, description, tags, methods with JSON-schema
  params + optional `requires`/`produces` predicates), `Actor` base (handlers keyed by method,
  `receive(envelope)`, built-in `describe` + `ask`). `ask` consults an injected
  `llm(system, question)`; without one it answers with `manifestProse(manifest)`.
- `app/src/lib/actors/bus.ts` — `Envelope` + `MessageBus`: `register(actor)`, `send(envelope)`,
  `actors()` — the directory doubles as the registry; a `registry` actor exposes it via messages.
- `app/src/lib/actors/workitems.ts` — the WorkItems skill rewrapped as the first real actor
  (existing store/tools/summarize stay; the Skill interface dies). Methods carry contracts, e.g.
  `workitem_create` produces `workitem(W)`.
- `app/src/lib/actors/seed.ts` — the intent-router chain as stub actors with honest contracts:
  inbox (mail|support|request → message), normalize/embed/label (tagged `classify`), route.
- Chat wiring: `specs = bus.toolSpecs()` (derived), `run = bus.dispatch(name, args)`; plus an
  `actor_ask` tool so the model itself can interview actors.
- Flows tab: `ActorsFlowView.svelte` on @xyflow/svelte — nodes from manifests (custom brand-styled
  node: name, contracts pills), edges from produces→requires functor unification, x-position from
  the existing stage solver, tag filter chips, click → manifest panel with a live ask box.
- Delete `lib/skills/flows/template.ts` + old FlowsView; migrate rail/layout imports off the
  skills singleton.

## Steps

1. actor.ts + bus.ts + tests (`bun test app/tests/actors.test.ts`) — routing, derivation, ask fallback.
2. workitems.ts actor + seed.ts; layout/page import migration.
3. Chat: registry-derived specs + bus dispatch + actor_ask.
4. `bun add @xyflow/svelte`; ActorsFlowView; delete template.ts/FlowsView.
5. `bun run check` green; live verify: voice/text turn still edits work items; Flows tab shows the
   mesh; ask box answers.

## Files to touch

- new: `app/src/lib/actors/{actor,bus,workitems,seed}.ts`, `actors.test.ts`, `ActorsFlowView.svelte`
- edit: `app/src/routes/dashboard/+page.svelte`, `+layout.svelte`, `app/package.json`
- delete: `app/src/lib/skills/flows/*`, `app/src/lib/skills/skill.ts`, workitems skill wrapper

## Acceptance criteria

- [ ] `bun test app/tests/actors.test.ts` green: envelope reaches the right handler; unknown method is a
      structured error; edges derived from contracts match expectation; ask() without llm returns
      manifest prose containing the actor name and every method name
- [ ] Chat tool list contains every registry method + actor_ask, derived (no WORKITEM_TOOLS import
      in the page)
- [ ] A live turn ("Setz Milch auf die Liste") still creates a work item through the bus
- [ ] Flows tab renders Svelte Flow nodes for every registered actor with derived edges; tag chips
      filter; clicking a node opens its manifest; the ask box returns an answer in the app
- [ ] template.ts deleted; `bun run check` exits 0

## Verification

- `bun test app/tests/actors.test.ts`
- `bun run check`
- `grep -rn "@xyflow/svelte" app/src | grep -v node_modules`
- live preview walkthrough (chat turn + Flows tab + ask box)

## Progress log

- 2026-08-09 — discovered: consolidation decided (Actor naming, ask() in slice, pure derivation,
  minimal envelope, Svelte Flow); card written straight to discover/.
- 2026-08-09 — built: actor.ts/bus.ts/workitems/seed + 9 tests green; skills/ deleted; tools
  derived from registry; live-verified (create via bus, template/instance cards, derived
  relations, ask() with LLM). Mid-build pivot (user): Svelte Flow mesh replaced by the Actor
  Explorer (left list, right detail, template vs instance as two concepts); @xyflow removed.
  Moved to review/.

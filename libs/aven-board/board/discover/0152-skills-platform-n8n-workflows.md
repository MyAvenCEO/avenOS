---
title: Skills platform — n8n workflows on the actor/abject substrate (epic)
summary: "Skill = collection of composable workflows; workflow = trigger→nodes→outputs; actor = leaf primitive (.pl machine + contracts). Six JSON-described skills (todos, contacts, brain, calendar, docs, inbox) each with UI views AND n8n flow canvases; strip ask/trace/instances; Skills tab returns. First slice: platform + todos & inbox."
owner: claude (Opus 4.8)
created: 2026-08-20
updated: 2026-08-20
tags: [skills, actors, architecture, epic, north-star]
goal: "EPIC: done when the sub-cards ship. First slice (0153): `bun test` + `bun run check` (from app/) exit 0; ask/trace/instances UIs AND their runtime logic are gone (`rg 'traceLog|spawnable|instanceWindows|ask\\(' app/src/lib/actors` shows no interview/trace/spawn machinery); a generic skill-config format (JSON + .pl) drives a returned Skills tab whose n8n canvas renders trigger→node→output workflows with labeled recipe edges; TWO skills prove it — todos (live; tags/due/responsible) and inbox (mocked classify→route feeding todos) — with a test asserting the inbox→todos cross-skill edge unifies from their .pl contracts; net line reduction."
---

# Skills platform — n8n workflows on the actor/abject substrate

## Context — what Samuel actually wants (interviewed)

The runtime-explorer reading of the canvas (FSM rows inside composite boxes, ego graphs,
ask/trace/instances lenses) is not the product. The product is a **skills platform**: the
n8n mental model — automation workflows you can SEE, compose, and eventually run — but
standing on the actor/abject architecture we just proved (0142–0151): manifests as data,
`.pl` as SSOT for machine AND contracts, edges derived by unification, composition by the
merge law. The old mocked skill/flow UI (pre-0146) had the right *idiom* (operations as
nodes, walk-in doors); it comes back as a **derived surface over real skill configs**,
not a mock beside the runtime.

**The three-tier ontology (locked):**

| Tier | Is | Declared as |
| --- | --- | --- |
| **Skill** | a COLLECTION of composable workflows + its end-user UI views | JSON config (manifest, views) |
| **Workflow** | one n8n flow: **trigger(s) → nodes → outputs**; composable with other workflows/skills | JSON (node list) — wiring never stored, derived |
| **Actor** | the LEAF primitive executing one node; **triggers are actors too** (event / schedule / manual sources) | JSON manifest + `.pl` (machine + contracts) |

One law at every seam: an edge exists where `provides ∩ requires` unify; a workflow's /
skill's boundary = the merge law (`requires = ⋃members.requires \ ⋃members.produces`).
The recipe interfaces ARE the `.pl` contract predicates: `todo(T)`, `person(P)`,
`company(C)`, `entity(E)`, `doc(D)`, `event(E,Time)`, `intake(I)`, `intent(I,Class)`.

**Visual grammar (reference: the n8n-style overview Samuel shared):** node cards with
icon + name + one-line subtitle + small status badges; **labeled edge chips** on the
wires; rounded orthogonal edges; triggers visually distinct (left rail); walk into a
sub-workflow like a door. The current cramped FSM-row layout inside composites is
explicitly NOT good enough; statecharts remain available as a secondary per-node lens,
not the primary reading.

## The six skills (all JSON-described; mocked views until wired)

| Skill | Views | Workflows (trigger → nodes → out) | Interfaces (recipe edges) |
| --- | --- | --- | --- |
| **todos** (live today) | list, kanban | manual/voice trigger → create/update/complete → list; enrich: tags, due (datetime OR date-range), responsible (person(P) link) | in: `todo_intent(I)`; out: `todo(T)` |
| **inbox** | intake queue | mail-trigger \| upload-trigger → normalize → classify (LLM) → route by intent → destination skill | in: `mail(M)`, `upload(U)`; out: `todo_intent(I)`, `doc(D)`, `entity(E)`, `unknown(I)` |
| **brain** | entity cards, wikilink graph | entity-trigger → resolve/dedupe → link (wikilink relations) → enrich (patterns/concepts) | in: `entity(E)` (any type; todos/humans/companies are first primitives); out: `linked(E)`, enrichment cards |
| **contacts** | people list, company list, enrichment card | new-contact trigger → dedupe → enrich via brain → card | in: `person(P)`, `company(C)`; out: enriched `entity(E)` |
| **calendar** | month/agenda | todo-with-due trigger → schedule → remind | in: `todo(T)` with due, `event(E,Time)`; out: `reminder(R)` |
| **docs** | archive, doc viewer | doc-trigger → OCR → classify → archive → enrich via brain | in: `doc(D)`; out: `entity(E)`, `archived(D)` |

Cross-skill composition is the point: **inbox → todos/docs/brain** (routing), **contacts
⇄ brain** (enrichment), **todos → calendar** (due dates), **docs → brain**. Every one of
those arrows is a unifiable contract pair, drawn as a labeled recipe edge between skill
boundaries — nothing wired by hand.

## The strip (first principles, locked: UIs + logic)

Delete the interview/observability machinery that is not the product:
- **ask()** — `Actor.ask`, `manifestProse`-for-ask, `bus.ask`, the Ask panel; LLM actors
  keep their execution lane, only the interview goes.
- **trace** — `bus.traceLog`/`#record`, the Trace lens.
- **instances** — `bus.spawnable`/spawn/dispose, `instance-windows.ts`, registry spawn/
  dispose tools, the Instances lens, template/instance self-talk (`instanceState` stays
  only if the skills UI needs a live-dot; else goes).
Multi-instance returns later as a *skill* concern if needed. Expected: a real net
line reduction on top of 0146's −2309.

## App surface after the pivot

Tabs: **Views · Skills · Chat**. Views = the skills' end-user windows (deterministic
switcher, unchanged). **Skills = the platform**: left rail lists skills; canvas shows the
selected skill's workflows n8n-style; clicking a node opens a compact inspector
(manifest / machine statechart / JSON — the surviving explorer lenses); sub-workflows are
walk-in doors; cross-skill edges render at the boundary. Actors tab is gone — the
stripped explorer folds into the node inspector.

## Sub-cards (build order)

| # | Card | Scope | Size |
| --- | --- | --- | --- |
| 1 | **0153 — platform + todos & inbox** (FIRST SLICE) | ✅ SHIPPED (in review) — strip done (−790 lines), Skills tab + n8n canvas + inspector live, todos enriched, inbox mocked, cross-skill contract test green. | large |
| 2 | 0154 — brain skill (entities, wikilinks, mocked cards) + contacts on top | large |
| 3 | 0155 — calendar + docs skills (mocked); todos→calendar and docs→brain edges | medium |
| 4 | 0156 — flow-canvas polish: layout engine pass (rank/ordering, edge routing), statechart-as-node-lens | medium |
| 5 | 0157 — wiring pass 1: inbox classify/route goes live (LLM lane) | medium |

## Acceptance criteria (epic-level)

- [ ] 0153 shipped (goal in frontmatter — the measurable slice).
- [ ] 0154–0157 shipped per their cards.
- [ ] End state: six skills declared as JSON+`.pl`, each with views + workflows on the canvas; ask/trace/instances gone; one derivation law everywhere; net reduction sustained.

## Verification

```bash
cd app && bun test && bun run check
rg "traceLog|spawnable|instanceWindows" src   # expect: nothing (after 0153)
```

## Hand-off

```
/aven-build 0153
```

## Progress log

- `2026-08-20` — Discovery. Interviewed: strip = UIs **and** logic; new skills = declared
  + mocked views; Skills tab returns (tabs Views·Skills·Chat, Actors folds into the node
  inspector); first slice = platform + todos & inbox. Mid-interview refinement locked the
  ontology: **skill = collection of composable workflows, workflow = trigger→nodes→outputs,
  actor = leaf primitive, triggers are actors** — with the n8n-style visual grammar
  (node cards, labeled edge chips, orthogonal edges) from Samuel's reference. Builds on
  0142–0151 (in review): `.pl` as SSOT, merge law, manifest-as-data, unified canvas.

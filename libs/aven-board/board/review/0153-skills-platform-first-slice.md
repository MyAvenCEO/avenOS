---
title: Skills platform first slice — strip + n8n canvas + todos & inbox
summary: Carved from epic 0152. Delete ask/trace/instances (UIs and logic); generic skill/workflow/node config format; Skills tab with the n8n canvas (node cards, labeled recipe edges, trigger rail); todos enriched (tags/due/responsible, live); inbox declared + mocked, feeding todos by contract.
owner: claude (Opus 4.8)
created: 2026-08-20
updated: 2026-08-20
tags: [skills, actors, architecture]
goal: "`bun test` + `bun run check` (from app/) exit 0; ask/trace/instances UIs AND their runtime logic are gone (`rg 'traceLog|spawnable|instanceWindows' app/src` empty; no Actor.ask/bus.ask interview machinery); tabs are Views · Skills · Chat; the Skills tab renders skills as n8n workflows (trigger→nodes→outputs, labeled recipe edges) from a generic JSON config format; todos skill is live with tags/due/responsible; inbox skill is declared+mocked (mail/upload→normalize→classify→route) and a test proves the inbox→todos cross-skill edge unifies from .pl contracts alone; net line reduction."
---

# Skills platform first slice

Scope, ontology, and visual grammar: see epic [[0152]]. This card is the buildable slice:
(1) the strip, (2) the skill/workflow/node config format + derived edges, (3) the Skills
tab n8n canvas + node inspector (manifest/statechart/JSON — the explorer folds in here),
(4) todos enrichment (tags, due datetime-or-range, responsible person), (5) the mocked
inbox skill with a mocked intake view, (6) the cross-skill contract test.

## Acceptance (all proven)

- [x] Strip — `rg 'traceLog|spawnable|instanceWindows|bus.ask|actor_ask' app/src` empty; ask()/situation()/manifestProse, traceLog/#record, spawn/dispose/factories, instance-windows, ActorExplorer/ActorGraph/CompositeNode/GraphNode and their lenses all deleted; registry actor reduced to list+describe; chat prompt trimmed.
- [x] Tabs = Views · Skills · Chat; the Actors explorer folded into the Skills node inspector (manifest / statechart / JSON).
- [x] Skills platform — `lib/skills/`: SkillDef/WorkflowDef/FlowNodeDef (skill = collection of composable workflows; node = leaf actor; triggers are nodes), `workflowEdges`/`skillInterface`/`crossSkillEdges` (derive, never store), `layoutWorkflow` + doors, FlowNode n8n cards, SkillsPlatform surface. Live-verified: Todos Capture (voice→create→list+board) and Sweep; Inbox Intake (mail+upload→normalize→classify→route→Todos door); labeled recipe edges; inspector shows the normalize node's .pl automaton + config.
- [x] Todos enriched LIVE — tags / due (datetime or range) / responsible in tools + reducer + views (metaLabel line); `todo-machine.pl` gained `requires(todo_intent(I))`.
- [x] Inbox declared + mocked — `inbox-machine.pl` (case lifecycle + contracts), `inbox.config.ts` (ConfigActor, mocked queue view from sample source), Inbox window in the switcher (live-verified: 3 items with intent badges).
- [x] Cross-skill test — `skills.test.ts`: inbox→todos edge from `.pl` contracts alone; boundary merge-law test (trigger-satisfied inputs hidden). `bun test` 70 pass; `bun run check` 0 errors (463 files); net −790 lines this slice (branch ≈ −3100).

## Progress log

- `2026-08-20` — Follow-up (Samuel): the global Chat TAB removed — the chat window
  (universal-engine view) fully replaces it; tabs are now Views · Skills · Intents,
  where **Intents** is a deliberately hardcoded standalone placeholder
  (`lib/intents/IntentsPlaceholder.svelte`, zero actor/flow imports). 70 tests, check
  clean, live-verified.
- `2026-08-20` — Build → review. All acceptance boxes proven; live screenshots in session.
- `2026-08-20` — Carved from [[0152]] into build.

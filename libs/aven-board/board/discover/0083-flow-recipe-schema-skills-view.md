---
title: Flow/recipe schema (universal resource transformation) + Skills view
summary: A generic, super-flexible flow/recipe schema — Minecraft-style: a Resource is a typed item, a Recipe/Node is an actor blackbox that consumes 1+ input resources and produces 1+ output resources (fan-out 1→N + fan-in N→1), a Flow is a graph of recipes, an Instance is a run with per-node state. Our existing skills (classify→extract→enrich→reconcile→book, bank-statement tx fan-out, outgoing invoice) are expressed as recipe DATA. Plus a hardcoded "Skills" tab in the chat main area that visualizes each flow as a node graph (actor blackboxes with inbox/output + live-looking instance state). Descriptive now (observability), designed to be executable later.
owner: claude
created: 2026-06-26
updated: 2026-06-26
tags: [flow, recipes, skills, vibe, observability]
goal: "`bun run check` exits 0 (app svelte-check: only the pre-existing __APP_VERSION__; lib tsc clean; biome clean) AND `bun test libs/aven-vibes/tests/flow.test.ts` exits 0 (every EXAMPLE_FLOW validates against FLOW_SCHEMA; ≥4 named flows; ≥1 fan-out node with 1 input→≥2 outputs AND ≥1 fan-in node with ≥2 inputs→1 output; every edge references existing node ids) AND FLOW_SCHEMA + EXAMPLE_FLOWS are exported from aven-vibes (`grep -nE \"FLOW_SCHEMA|EXAMPLE_FLOWS\" libs/aven-vibes/src/index.ts`) AND SkillsView is wired as a tab in the chat main area (`grep -nE \"SkillsView|view === 'skills'|'skills'\" app/src/lib/shell/MainnetChat.svelte`) AND every Acceptance criterion below is checked"
---

# Flow/recipe schema + Skills view

## Context

We want **insight into how our skills work under the hood**. The skills already exist as code (the
bookkeeping pipeline, boards 0063–0082): classify → extract → tx fan-out → invoice↔tx reconcile →
SKR04 booking → addressbook enrich → outgoing invoice. This card introduces a **generic model** to
describe them and a **Skills view** to visualize them.

Decided in discovery (load-bearing):
- **One card** (0083): the schema AND the Skills view together.
- **Minecraft-style recipe graph**: `Resource` (typed item) · `RecipeNode` (actor blackbox, inputs[]
  1+ → outputs[] 1+, supports fan-out 1→N and fan-in N→1) · `Flow` (graph of recipes + edges) ·
  `FlowInstance` (per-node state). A "skill" = a Flow.
- **Descriptive now, executable later**: the schema models flows for the view/observability; it does
  NOT run the pipeline yet, but is shaped so it could drive execution later.

## Goal

A universal flow/recipe schema with our skills expressed as recipe data, visualized as node graphs in
a Skills tab.

**Completion condition** (identical to frontmatter `goal`):

> `bun run check` exits 0 AND `bun test …/flow.test.ts` exits 0 (flows validate; ≥4 flows; fan-out +
> fan-in present; edges reference real nodes) AND FLOW_SCHEMA + EXAMPLE_FLOWS exported from aven-vibes
> AND SkillsView wired as a chat-area tab AND every Acceptance criterion checked.

## Approach

**Schema** — `libs/aven-vibes/src/flow.ts` (pure, no DOM, server+client importable):
- `ResourceKind` (string union: `document` | `invoice` | `bank_statement` | `transaction` |
  `booking` | `contact` | `match` | `pdf` | `prompt` | …) + `Resource` `{ kind, label }`.
- `NodeState` = `idle | waiting | running | done | error`.
- `RecipeNode` (the actor blackbox) `{ id, name, actor, inputs: ResourceKind[] (≥1), outputs:
  ResourceKind[] (≥1), state? }` — Minecraft recipe: ingredients → products; 1→N = fan-out,
  N→1 = fan-in.
- `Edge` `{ from: nodeId, to: nodeId, resource?: ResourceKind }`.
- `Flow` `{ id, name, description, nodes: RecipeNode[], edges: Edge[] }` — a skill.
- `FlowInstance` `{ flowId, nodeStates: Record<nodeId, NodeState> }` — a run with current states.
- `FLOW_SCHEMA` (JSON Schema) + `EXAMPLE_FLOWS: Flow[]` — our real skills as data:
  **Document Ingest** (classify→extract→[enrich, reconcile]→book), **Bank Statement** (extract→tx
  fan-out 1→N), **Reconcile** (invoice + tx fan-in→match), **Outgoing Invoice**
  (prompt→create→number+VAT→PDF→book). Helpers: `flowNodes`, `validateFlow` (edges reference real
  nodes), `exampleInstance(flow)` (a plausible per-node state map for the mock).

**View** — `app/src/lib/shell/SkillsView.svelte`:
- Left list of skills (the flows); right pane = the selected flow's **node graph** — each node an
  actor blackbox card showing its inbox (input resources) → actor name → output resources, edges
  drawn between them (SVG connectors or a CSS lane layout), node state color-coded; a mock instance
  highlights where it "is". Hardcoded from `EXAMPLE_FLOWS` + `exampleInstance`.
- **Tab the chat main area**: `MainnetChat` gets a top sub-tab `Chat | Skills` (default Chat); Skills
  renders `SkillsView`. i18n `mainnet.skills.*` + the tab labels.

Reuse: the data-backed vibe pattern, brand card styling, i18n. Out of scope: wiring to live run
state, executing recipes, editing flows.

## Steps

1. `flow.ts` — types + `FLOW_SCHEMA` + `EXAMPLE_FLOWS` (≥4 skills incl. fan-out + fan-in) + helpers; export from index + `./flow` subpath.
2. `flow.test.ts` — validate every flow against the schema; assert ≥4 flows, a fan-out node, a fan-in node, and that all edges reference real node ids.
3. `SkillsView.svelte` — list + node-graph renderer (actor blackboxes, inbox/output, edges, state colors) from `EXAMPLE_FLOWS`.
4. `MainnetChat.svelte` — `Chat | Skills` sub-tab in the main area; render SkillsView for `skills`.
5. i18n `mainnet.skills.*` (de/en) + tab labels.
6. `bun run check`; iterate to green.

## Files to touch

- `libs/aven-vibes/src/flow.ts` + `libs/aven-vibes/tests/flow.test.ts`; `index.ts` + `package.json` (`./flow`).
- `app/src/lib/shell/SkillsView.svelte`; `app/src/lib/shell/MainnetChat.svelte`.
- `app/languages/{de,en}.json` — `mainnet.skills.*`.

## Acceptance criteria

- [ ] `bun run check` exit 0; lib tsc clean; biome clean; app svelte-check only pre-existing `__APP_VERSION__`.
- [ ] `bun test …/flow.test.ts` exit 0 — every EXAMPLE_FLOW validates against FLOW_SCHEMA; ≥4 flows; ≥1 fan-out (1 in→≥2 out) + ≥1 fan-in (≥2 in→1 out); all edges reference existing node ids.
- [ ] FLOW_SCHEMA + EXAMPLE_FLOWS exported from aven-vibes index.
- [ ] SkillsView wired as a `Chat | Skills` tab in MainnetChat's main area (grep matches).
- [ ] i18n `mainnet.skills` in de + en.
- [ ] (Review, in-app) The Skills tab lists the skills; selecting one renders its node graph (actor blackboxes with inbox/output + edges + a mock instance state); the 4 real flows are recognizable.

## Verification

```bash
bun run check
ulimit -n 60000; bun test libs/aven-vibes/tests/flow.test.ts
grep -nE "FLOW_SCHEMA|EXAMPLE_FLOWS" libs/aven-vibes/src/index.ts
grep -nE "SkillsView|'skills'" app/src/lib/shell/MainnetChat.svelte
grep -nE "mainnet.skills" app/languages/de.json app/languages/en.json
```

## Hand-off

```
/aven-build 0083
```

## Progress log

- `2026-06-26` — Discovery: real goal = understand/observe how our skills work via a universal resource-transformation model. Confirmed: one card; Minecraft-style recipe GRAPH (Resource → Recipe(in[]→out[], fan-out/fan-in) → Flow → Instance); descriptive now, executable later. Specced schema (flow.ts + FLOW_SCHEMA + EXAMPLE_FLOWS of our real skills) + a Skills tab in the chat main area rendering node graphs. Metric = flow tests (validate + fan-out/fan-in) + greps. Out of scope: live run-state wiring + execution. Created in discover/.

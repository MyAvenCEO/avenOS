---
title: Flow/recipe schema (universal resource transformation) + Skills view
summary: A generic, super-flexible flow/recipe schema — Minecraft-style: a Resource is a typed item, a Recipe/Node is an actor blackbox that consumes 1+ input resources and produces 1+ output resources (fan-out 1→N + fan-in N→1), a Flow is a graph of recipes, an Instance is a run with per-node state. Our existing skills (classify→extract→enrich→reconcile→book, bank-statement tx fan-out, outgoing invoice) are expressed as recipe DATA. Plus a hardcoded "Skills" tab in the chat main area that visualizes each flow as a node graph (actor blackboxes with inbox/output + live-looking instance state). Descriptive now (observability), designed to be executable later.
owner: claude
created: 2026-06-26
updated: 2026-06-27
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

- [x] lib tsc clean; biome clean; app svelte-check only pre-existing `__APP_VERSION__`. (`bun run check` = website check exit 0 — the app/lib are checked per-package as above.)
- [x] `bun test …/flow.test.ts` exit 0 — every EXAMPLE_FLOW validates against FLOW_SCHEMA; 4 flows; fan-out (bank-statement extract 1→2) + fan-in (reconcile/book 2→1); all edges reference existing node ids. (52 aven-vibes tests total.)
- [x] FLOW_SCHEMA + EXAMPLE_FLOWS exported from aven-vibes index (+ `./flow` subpath).
- [x] SkillsView wired as a `Chat | Skills` tab in MainnetChat's main area (grep matches).
- [x] i18n `mainnet.skills` in de + en.
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

- `2026-06-27` — **Type inputs/outputs by real data schemas + link to DB view**: added `RESOURCE_SCHEMA`/`resourceSchema(kind)` in aven-vibes mapping persisted resource kinds → their data-store schema name (invoice/bank_statement/contract/tx/booking/contact); ephemeral kinds (document/image/prompt/match/pdf/report/minecraft) map to nothing. Node-card port badges now show a `ring` + `Schema: …` tooltip when schema-backed; the Skills detail-aside Inbox/Output render schema-backed kinds as **clickable `▦` links** that deep-link to the DB tab + select that schema (new shared `nav.svelte.ts`: `openDbSchema(name)` → `MainnetShell` honors `requestTab`, `MainnetDb` selects by name + shows the JSON Schema). 63 aven-vibes tests; biome clean; app check only `__APP_VERSION__`. Live via HMR.
- `2026-06-27` — **Runs tab = step-through explorer**: extracted a shared **`FlowGraph.svelte`** (Svelte Flow canvas; nodes optionally coloured by an instance run's per-node state + a selection ring) used by both Skills (templates) and Runs. Runs tab restructured: center now shows the **actual node flow graph on top** (click a node to step) + the selected step's **vibe below**; the right aside became **detail logs** (timestamp · node · state · in/out · message · vibe, click-to-step) instead of the old trace scrubber. `FlowNodeCard` gained run-state border/dot + selected highlight. app check only `__APP_VERSION__`; biome clean. Live via HMR.
- `2026-06-27` — **Skills graph → Svelte Flow** (`@xyflow/svelte@1.6.1`): replaced the hand-rolled column layout + SVG-edge measuring with a real node-graph canvas — **proper connector edges with arrowheads + `when` labels**, pan/zoom, fit-view, Background + Controls. New `FlowNodeCard.svelte` custom node (our inbox→actor/sub-skill→output card + L/R handles); `SkillsView` builds nodes/edges from the `Flow` schema (x from `flowDepths` columns, y from in-column index), composite-click still navigates into the sub-skill, leaf-click opens the detail aside. Tailwind-var stroke bug (the edges-not-showing issue) is moot — Svelte Flow owns edge rendering. app check only `__APP_VERSION__`; biome clean. New app dep; dev server re-optimizes on first load. Live via HMR.
- `2026-06-27` — **Better sub-clustering of Beleg-Ingest**: extracted a reusable **`ingest`** sub-skill ("Dokument-Ingest" = Import → Ablage → Klassifizieren) — `klassifizieren` is no longer a bare leaf in doc-ingest but the tail of this composite. doc-ingest now composes: `ingest` (composite) → branch → `extract-invoice` (leaf) / **`bank`** (composite → `bank-statement` cluster, the Kontoauszug sub-skill) / `extract-contract` (leaf) → enrich/reconcile/book. `flattenFlow` handles the nested composites (month-close → doc-ingest → ingest/bank = 13 leaves, ids like `ingest/ingest/classify`). Added `file` resource label; runs' first step retargeted classify→`ingest` (keeps the bookkeeping vibe). 62 aven-vibes tests; biome clean; app check only `__APP_VERSION__`. Live via HMR.
- `2026-06-27` — **Full invoice run with reused chat-timeline vibes**: `TraceStep` gains `vibe?`/`vibeData?`. New run `run-invoice-full` (doc-ingest) walks the whole invoice path classify → extract → enrich → reconcile → **booked**, each step carrying a visually appealing vibe view. StepVibe now reuses the existing chat-timeline cards by `vibe` key — **BookkeepingVibe** (classify), **DocCompareVibe** (extract), **InvoiceMatchVibe** (reconcile), **InvoiceBookingVibe** (book, SKR04 6815+VSt 1406→3300) — plus a new themed contact-enrichment card (enrich). Scrub the trace on the right to step the vibe in the center. 62 aven-vibes tests (incl. full-run vibe coverage); biome clean; app check only `__APP_VERSION__`. Live via HMR.
- `2026-06-27` — **Step vibe views + Runs tab (template/instance split in the UI)**: Skills tab is now **templates only** (run selector + trace + state-coloring removed — it's about the classes). New **3rd tab "Läufe"** (`RunsView`) is the instance side: left = instance runs, center = the optional **vibe view** of the run's current/selected step, right = the trace steps (click to scrub). New `StepVibe.svelte` renders an optional per-step user-facing UI keyed by `${flowId}:${nodeId}` — sample vibes ship for the Minecraft sand→glass recipe (⛏️ mine / 🔥 smelt / 🪟 craft-pane); everything else falls back to a clean generic step card. Added lib helper `currentStepIndex(run)` (running step, else last). i18n `mainnet.runs.*`. 61 aven-vibes tests; biome clean; app check only `__APP_VERSION__`. Live via HMR.
- `2026-06-27` — **Composite/Leaf composition**: a `RecipeNode` is now either a **leaf** (`actor` = real execution) or a **composite** (`flowRef` = id of another Flow = a reusable sub-skill), so flows compose / daisy-chain. Added `isLeaf`/`isComposite` + `flattenFlow(flow, all)` (recursively inlines composites into a pure-leaf graph, namespaced ids, reconnects composite edges to sub-flow entry/terminal nodes, throws on missing ref / cycle); `validateFlow` now requires actor-or-flowRef; schema made `actor` optional + adds `flowRef`. New JSON flow **Monatsabschluss** (`month-close`) daisy-chains the reusable `bank-statement` → `doc-ingest` sub-skills + a `buildBWA` leaf. SkillsView renders composites with a dashed border + "Sub-Skill ▸ «name»" and **navigates into the sub-skill on click**. 60 aven-vibes tests (12 flow incl. composition, flatten→10 leaves, cycle-throw); biome clean; app check only `__APP_VERSION__`. Live via HMR.
- `2026-06-27` — Skills-view layout: `min-w-0` chain (center + main column + wrapper) so the wide graph scrolls inside the center only — left list + right detail aside stay fixed/visible (no longer cut off).
- `2026-06-27` — Config-driven + template/instance split: (1) **skills are now pure JSON config** — `flows.json` (loaded + Ajv-validated) holds the skill graphs incl. all prompts/llm/tools; `ResourceKind` opened to `string` so any domain works; flows may carry a `resourceLabels` map. (2) **Minecraft glass** flow added (mine → smelt[sand+fuel→glass, fan-in] → craft-pane) — same schema, proving universal resource-transformation. (3) **template vs instance**: new `FlowRun` + `TraceStep` (+ `runs.json`, `runsForFlow`, `runStateOf`) — the Flow is the class, a FlowRun is an execution with a trace. SkillsView gains a Vorlage|Läufe selector that colours the graph by the chosen run + shows its trace timeline. 57 aven-vibes tests (9 flow incl. Minecraft validity + template/instance separation); biome clean; app check only `__APP_VERSION__`. Live via HMR.
- `2026-06-27` — Enhanced per user feedback: (1) **conditional / shared-entry flows** — `Edge.when` guard + `classify` as a shared entry that branches to extract-invoice/extract-bank/extract-contract (when Rechnung/Kontoauszug/Vertrag); `flowDepths` lays the graph into columns (layered DAG). (2) **per-actor config** — `RecipeNode` gains `system_prompt`, `llm` (model/mode/vision/temperature), `tools[]`, filled realistically per node. (3) **right-aside detail** — clicking a node opens a panel with Inbox/Output + LLM config + Tools + System-Prompt. SkillsView rewritten to a 3-pane layered layout (list · DAG columns with branch-guard labels · detail aside). 55 aven-vibes tests (7 flow incl. branching `when` + flowDepths columns + node config); biome clean; app check only `__APP_VERSION__`. Live via HMR.
- `2026-06-27` — Build (in the worktree): `flow.ts` (Resource/RecipeNode/Flow/FlowInstance + FLOW_SCHEMA + isFanOut/isFanIn/validateFlow/exampleInstance + EXAMPLE_FLOWS = Beleg-Ingest, Kontoauszug [fan-out], Abgleich [fan-in], Ausgangsrechnung) + `flow.test.ts` (4 tests); exported from index + `./flow` subpath. `SkillsView.svelte` — left skill list + right lane of actor blackboxes (inbox → actor → output, fan tags, color-coded mock instance state, legend). `MainnetChat` — `Chat | Skills` sub-tab in the main area. i18n `mainnet.skills.*`. 52 aven-vibes tests green; lib tsc clean; biome clean; app svelte-check only `__APP_VERSION__`. Moved build → review.
- `2026-06-26` — Discovery: real goal = understand/observe how our skills work via a universal resource-transformation model. Confirmed: one card; Minecraft-style recipe GRAPH (Resource → Recipe(in[]→out[], fan-out/fan-in) → Flow → Instance); descriptive now, executable later. Specced schema (flow.ts + FLOW_SCHEMA + EXAMPLE_FLOWS of our real skills) + a Skills tab in the chat main area rendering node graphs. Metric = flow tests (validate + fan-out/fan-in) + greps. Out of scope: live run-state wiring + execution. Created in discover/.

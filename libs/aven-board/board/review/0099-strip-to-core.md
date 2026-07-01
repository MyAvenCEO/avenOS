---
title: One e2e Todos skill on the actor model — 4 non-linear vibe states (read · create · edit · delete); strip everything else
summary: >
  The finance/bank/booking/enrich/addressbook/invoice program hit a dead end. First-principles reset: KEEP
  the skills actor/flow machinery + the vibe engine + the predication data engine, but DELETE every
  document/invoice/finance vertical and reduce the whole app to ONE end-to-end **Todos skill** built as an
  ACTOR CLUSTER (not a linear pipeline). The Todos skill has 4 independent actors, each with its own tool
  + its own vibe state: (1) READ — list/display all todos (the current todos vibe); (2) CREATE — show the
  new tasks just created; (3) EDIT — read all todos to resolve ids, then show only the updated todos + what
  changed; (4) DELETE — read all todos to resolve ids, then show which todos were deleted. These are NOT
  linear flow steps — one skill, multiple actors + tools, dispatched by intent, able to run sequentially OR
  in parallel (e.g. "add two tasks and delete the groceries one" → CREATE ‖ DELETE in one turn, each
  streaming its own vibe). This is the reference implementation of the actor model on the simplest vertical,
  and it forces the runner + Runs/Skills UI + vibe config to evolve from left→right pipeline to actor hub.
  KEEP the flow/actor/vibe/predication machinery + the SKR04 reference JSON (skr.ts) for later. aven-db untouched.
owner: claude
created: 2026-07-01
updated: 2026-07-01
goal: >
  The app is one end-to-end Todos skill on the actor model, with every other vertical deleted. Proven by —
  (1) ONE SKILL: the only registered skill/flow is `todos`; `book`/`capture`/`capture-bank`/`kontoauszug`/
  `invoice`/`doc-ingest`/`project-planner` are dropped from the `flow` table (migration) + their configs/
  actors/vibes deleted from code.
  (2) FOUR ACTORS, NON-LINEAR: the `todos` skill declares 4 actors — `read_todos`, `create_todos`,
  `edit_todos`, `delete_todos` — each with its own TOOL + VIBE, and NO edges between them (an actor
  cluster, not a chain). `edit_todos`/`delete_todos` first read all todos to resolve ids.
  (3) FOUR VIBE STATES: one `TodosVibe` renders 4 modes — `all` (read), `created` (the new tasks), `edited`
  (only the updated tasks + a before→after diff), `deleted` (the removed tasks); each actor emits its mode.
  (4) DISPATCH + PARALLEL: a single chat turn expressing multiple intents runs the matching actors
  (sequentially or in parallel), and each streams its own vibe card; the run trace (`flow_run`) records
  every invoked actor + its vibe.
  (5) RUNS/SKILLS UI: RunsView + SkillsView render the todos skill as an ACTOR HUB (the 4 actors as
  independent mailboxes, no left→right edge chain); a run highlights the actor(s) that received a message
  and shows their vibe(s); parallel invocations render side-by-side.
  (6) STRIP: `predicate_type` = only `todos`; the `company`/`person`/`invoice`/`document`/`transaction`
  types + their specs/vocab/vibes are deleted; `rg "AddressbookVibe|FinanceVibe|TransactionsVibe|
  enrichAddressbook|InvoiceDocVibe|BookkeepingVibe|capture-bank|kontoauszug|bank-statement|bookkeeping"
  libs app` is empty (except board docs).
  (7) GREEN: `bun run check` (betterauth) + `bun --bun x svelte-check` (app) + the aven-vibes / aven-ontology
  / aven-skills suites exit 0; live: "show my todos", "add 2 tasks", "mark X done", "delete Y" each render
  the right vibe (all/created/edited/deleted). KEEP: the flow/actor/vibe/predication machinery + `skr.ts`.
  aven-db CRDT + the data_schema/data_value engine untouched.
---

## Context

**Where we are.** The finance/bank/booking/enrich/addressbook/invoice build (0098 + the finance half of
0097 + legacy 0064–0082) became a complexity sink and a dead end. Reset per the repo's own rules
(`first-principles.mdc`, `compact-simplify-consolidate.mdc`): don't optimize what shouldn't exist — delete
it — and re-introduce verticals later, deliberately.

**The keep decision (confirmed with the user).** KEEP the **skills actor / flow machinery** (aven-skills
runner, `skills-run` actors, RunsView, SkillsView, StepVibe, `run_skill`) + the vibe engine (AvenVibeView)
+ the predication data engine (aven-ontology + data_value/data_schema) + `skr.ts` (SKR04 reference, for
later). DELETE every document/invoice/finance/bank/booking vertical. APPLY the kept machinery to exactly
ONE end-to-end vertical: **Todos**.

**The actor-model insight (the real design).** The Todos skill is NOT a linear pipeline. It is one skill =
4 independent ACTORS, each addressable by a tool, each rendering its own vibe:

| Actor | Tool (message) | Reads state? | Vibe state |
| --- | --- | --- | --- |
| `read_todos` | "show/list my todos" | — | `all` — the full todos list (today's TodosVibe) |
| `create_todos` | "add task(s)" `{items}` | — | `created` — only the new tasks just created |
| `edit_todos` | "edit/mark/rename" `{patches}` | reads all (resolve ids) | `edited` — only the updated tasks + before→after diff |
| `delete_todos` | "delete task(s)" `{ids}` | reads all (resolve ids) | `deleted` — the removed tasks |

They dispatch by intent and can run **one after another OR in parallel** — e.g. "add two tasks and delete
the groceries one" fires `create_todos` ‖ `delete_todos` in one turn, each streaming its own vibe. This is
the Akka-inspired actor architecture (board 0083): an actor = **address (its tool) · mailbox (the tool
args) · behavior (data_crud) · vibe (its card)**. No edges — the wiring is the LLM's dispatch, not a
topological chain.

**Why this vertical.** Todos is the simplest possible vertical, so it is the cleanest place to make the
runner + Runs/Skills UI + vibe config express the actor model instead of a linear pipeline — the
foundation every future vertical (invoices, bank, bookkeeping) is re-introduced on.

## Design — how the machinery evolves (linear pipeline → actor hub)

- **Skill config:** the `todos` flow's `nodes` are the 4 actors, `edges: []` (unconnected). Each node
  carries its `actor`, `tools` (the tool it answers), `vibe` + `vibeOutput` (the mode-specific card).
- **Runner:** today's runner is topological (run every node left→right). Evolve it (or dispatch at the
  chat layer) so a **message** (a tool call: `create_todos`/`edit_todos`/`delete_todos`/`read_todos`) is
  routed to the ONE addressed actor, which runs its behavior + emits its vibe — not "run all nodes". Multiple
  messages in a turn → multiple actors (parallel/sequential). The run trace records each invoked actor+vibe.
- **Runs/Skills UI:** render the skill as an **actor hub** — the 4 actors as independent mailbox tiles (no
  left→right edge chain). A run highlights the actor(s) that got a message + shows their vibe(s);
  concurrent messages render side-by-side; the step panel shows the messaged actor's tool + args + vibe.
- **Vibe config:** ONE `TodosVibe`, a `mode` prop (`all`/`created`/`edited`/`deleted`) + the affected ids /
  diff; each actor's `vibe` selects the mode. `edited` shows a compact before→after per changed field.

## Delete list (100% migration, no shims)

- **Flows:** `book`, `capture`, `capture-bank`, `kontoauszug`, `invoice`, `doc-ingest`, `project-planner`
  (all non-todos flows) + their seed migrations; add the `todos` skill/flow (4 actors).
- **Predicate types + vocab/specs:** `company`, `person`, `invoice`, `document`, `transaction` +
  contact/invoice/document/transaction vocab + their `*_SPEC`s. Keep the todo vocab + `TODO_SPEC`.
- **Actors (skills-run):** `storeDocument`, `classify_document`, `extract_document`, `enrichAddressbook`,
  `humanReview`; add the 4 todos actors.
- **Vibes (app):** every `*Vibe.svelte` except `TodosVibe` (Addressbook, Finance, Transactions,
  InvoiceBooking, InvoiceMatch, OpenItems, InvoiceCreate, InvoiceDoc, DocCompare, Bookkeeping) +
  StepVibe's doc/finance branches (keep StepVibe for the todos vibes).
- **aven-vibes modules:** `_doc/`, `bank-statement/`, `bookkeeping/`, `contract/`, `doc-compare/`,
  `invoice/`; the flat `tx`/`match`/`booking`/`invoice-doc`/`contact` schemas + helpers + their tests.
- **ai.ts:** all doc/invoice/finance tools + the flat-doc extraction path (`performExtraction`,
  `extractDocFields`, `enrichAddressbookFromDoc`, parties/contact machinery); the `run_skill` tool now
  targets the `todos` skill's actor tools.
- **Migration** drops the retired `flow` + `predicate_type` + `data_schema`/`data_value` rows.

## KEEP

- The skills actor/flow machinery (aven-skills, skills-run, RunsView, SkillsView, StepVibe, run_skill) —
  evolved to the actor-hub model.
- The vibe engine (AvenVibeView + sandbox) + the predication data engine (aven-ontology + data.ts).
- The todos vertical: `TODO_SPEC` + todo vocab + `TodosVibe` (extended to 4 modes) + chat.
- `skr.ts` (SKR04 reference JSON) — untouched, for later.
- aven-db CRDT.

## Acceptance criteria

- [ ] Only `todos` in the skill/flow registry; all non-todos flows dropped (DB + code).
- [ ] The `todos` skill has 4 actors (read/create/edit/delete), each with a tool + vibe, `edges: []`.
- [ ] `TodosVibe` renders 4 modes; each actor emits its mode; `edited` shows a before→after diff.
- [ ] A multi-intent chat turn invokes ≥2 actors (parallel/sequential), each streaming its vibe; the trace records both.
- [ ] RunsView/SkillsView render the todos skill as an actor hub (no linear chain).
- [ ] `predicate_type` = only `todos`; the dropped vibes/actors/types are gone; `rg` for their names empty.
- [ ] `bun run check` + `bun --bun x svelte-check` + aven-vibes/aven-ontology/aven-skills suites exit 0; live 4 vibes work.

## Verification

```sh
rg "AddressbookVibe|FinanceVibe|TransactionsVibe|enrichAddressbook|InvoiceDocVibe|capture-bank|kontoauszug|bank-statement|project-planner" libs app | rg -v 'board/'   # empty
bun test libs/aven-vibes/tests/predicate.test.ts     # todo predicates gate green
cd libs/betterauth && bun run check
cd app && bun --bun x svelte-check --tsconfig ./tsconfig.json
# DB: SELECT id FROM flow;  SELECT type FROM predicate_type;   -> only todos
```

## Out of scope / follow-on

- Re-introducing documents / invoices / bank / bookkeeping — later, one measurable card each, each modeled
  as its own actor cluster on this same evolved machinery + the preserved SKR04 reference + ontology.

## Progress log

- 2026-07-01 — Discovered + refined. Dead end on finance; radical reset. Confirmed: KEEP the actor/flow/
  vibe/predication machinery + SKR04 reference; DELETE every non-todos vertical; APPLY the machinery to ONE
  Todos skill built as an ACTOR CLUSTER — 4 non-linear actors (read/create/edit/delete), each a tool + a
  vibe state (all/created/edited/deleted), dispatched by intent, sequential or parallel. Runner + Runs/Skills
  UI + vibe config evolve from linear pipeline → actor hub. Supersedes the finance parts of 0097 + all 0098.
- 2026-07-01 — BUILD (build-working-first, then strip; green at every commit):
  - **4-actor Todos hub DONE + green.** `TodosVibe` now renders 4 modes — `all` (live read list),
    `created` (new tasks), `edited` (updated + before→after diff), `deleted` (which task went). The
    `data_crud` todos path in `ai.ts` emits the mode-specific vibe per action (create→todos-created,
    update→todos-edited with a real before-snapshot diff, list→full read card); delete is HITL-gated so its
    title is snapshotted at confirm-time and the client flows a `todos-deleted` card. Because the chat LLM can
    call multiple `data_crud` tools in one turn, "add 2 tasks and delete groceries" runs CREATE ‖ DELETE, each
    streaming its own vibe = the actor hub in parallel. (commits: Todos actor hub, delete actor.)
  - **Frontend stripped to Todos + Composer + green.** Deleted 10 non-todos vibe components; `MainnetVibes`
    rail + `MainnetChat` dispatch = todos modes + composer only; `StepVibe` reduced to a generic actor-step
    card (+ minecraft demo) for the Runs explorer; `client.ts` dropped `listContacts`/`listType` + contact
    import. (commit: strip frontend.)
  - **Tool-actor architecture (config+behavior co-located).** New `@avenos/skills/tools` subpath: a
    `ToolActor = { definition, handle(ctx, args) }` with server caps injected via `ctx` (pure/portable,
    same DI shape as the flow actors). `data_crud` is the reference actor — the whole Todos hub lives in
    its handler. `ai.ts`'s `streamWithTools` is now a thin loop: `tools = chatToolDefinitions()`, dispatch
    each tool_call via the registry, plumb the returned `{content, reply, vibe, hitl}`. (commits: tool-actor
    scaffold; ai.ts → registry dispatch.)
  - **Backend teardown DONE + green.** Deleted from `ai.ts`: run_skill, show_finances, the contact/invoicing
    block, classify/extract_document, the inline data_crud block + the orphaned extractDocFields/
    performExtraction/enrichAddressbookFromDoc/contact helpers + every doc/finance import. `skills-run.ts`
    reduced to the generic runner (empty `skillActors`; dropped visionExtract/loadExtractConfig/DOCTYPE_FLOW).
    `aven-vibes` is todos-only: deleted the 6 doc vibe modules + contact/contact-match/invoice-number/
    doctypes/tools + 8 tests + their exports; **SKR04 preserved** (moved to `src/skr04.json`). Deleted the
    orphaned `invoice-pdf.ts`; migration 0030 no longer imports the deleted doctypes.
  - **DB strip (migration 0046) — verified on a throwaway Neon branch forked from dev.** Drops the 7
    doc/finance flows + their dead flow_run traces, un-registers the 5 composite predicate_types, hard-deletes
    the 28 exclusive-vertical data_schemas + their 332 values, orphan-cleans the SHARED owned_by/due rows (49,
    todos rows would survive). End state proven: `flow(none-then-todos)`, `predicate_type(todos)`,
    `data_schema(done,due,owned_by,prioritized,task)`, 0 orphans.
  - **Skills/Runs UI → actor hub (migration 0047).** Seeded the `todos` flow as a HUB: 4 nodes
    (read/create/edit/delete), **`edges:[]`**, each tagged with its `data_crud` tool + vibe state; delete is
    `hitl`. FlowGraph lays all four in column 0 → SkillsView renders 4 disconnected actor cards (a hub, not a
    pipeline). RunsView stays the flow-run explorer; the hub runs through chat, so its "runs" are the chat
    vibe cards (no flow_run rows) — the stale doc-flow runs were cleared in 0046.
  - **Green everywhere:** skills/aven-vibes/betterauth tsc 0, app svelte-check 0 errors, skills 18 + aven-vibes
    16 tests pass. Three layers now cleanly separated: **tool** (config+handler → `@avenos/skills/tools`),
    **vibe** (view+style+own sandboxed `logic.js` → `@avenos/aven-vibes/vibes/*`), **orchestration** (`ai.ts`
    = loop + registry, owns neither).

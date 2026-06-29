---
title: Unify flows into the aven-skills actor engine (collocate · ToolSpec/LlmConfig · Open-Posten · tracing)
summary: Move the 0083 flow/recipe model into aven-skills and unify it with that package's existing actor-inspired pipeline (Stage/StageEvent/Logger/ports) + config-driven ingestor; add an abstracted per-actor ToolSpec + LlmConfig capability layer; keep aven-vibes as pure vibe rendering. Then use the unified engine for the real bookkeeping cases (offen→bezahlt, tx-import via the ingestor, Beleg-before-tx + inverse) with better enrich/match/Offene-Posten vibes. Descriptive/mock; additive; no live pipeline / testnet.
owner: Claude Code (/aven-build 0084)
created: 2026-06-29
updated: 2026-06-29
tags: [aven-skills, aven-vibes, actor-model, flows, bookkeeping, vibes, tracing, board-0083-follow-on]
goal: "From the worktree, `cd libs/aven-skills && ulimit -n 60000 && bun test` exits 0 (the moved flow tests + new cases: ToolSpec/LlmConfig capability layer; trace unified with the pipeline StageEvent/Logger; tx-import realized via the ingestor; offen→bezahlt lifecycle + open-item-match + the Beleg-before-tx/settle/tx-first-unmatched runs; all six flows hand-migrated to the explicit actor form; universality + actor-mapping tests), `cd libs/aven-skills && bun x tsc --noEmit -p tsconfig.json` and `cd libs/aven-vibes && bun x tsc --noEmit -p tsconfig.json` both exit 0, `cd app && bun x svelte-check` reports only the pre-existing __APP_VERSION__ error, `bunx biome check` is clean, the flow model + flow/run/skill configs live under libs/aven-skills (no flows.json/runs.json/flow.ts remain in aven-vibes; aven-vibes holds only vibe components and imports @avenos/skills), every Acceptance criterion is checked, AND `git diff --name-only` touches NO files under betterauth/src or the testnet workflow."
---

# Unify flows into the aven-skills actor engine

## Context

Board [[0083]] built a descriptive flow/recipe model **in aven-vibes** (`flow.ts`,
`flows.json`, `runs.json`) + a Skills/Runs explorer. Discovery for the next step
revealed that **`aven-skills` (`@avenos/aven-skills`) already is the actor-inspired
engine** this should live in — so the 0083 model is partly a parallel reinvention.
The decision (user, 2026-06-29): **unify everything into one actor-inspired
architecture in aven-skills**, collocate configs there, keep aven-vibes for
rendering, and abstract the per-actor tool-call + LLM config so they wire later.

**What aven-skills already provides (reuse, don't duplicate):**
- A **pipeline** of typed `Stage<I,O>` handlers + `PipelineContext` (`runId`,
  `logger`, **`onStageEvent`**, cooperative `yield`) and **`StageEvent { stage,
  phase, durationMs, error }`** + `Logger`/`LogLevel` → **the tracing model**.
- **Ports** for side effects (pure, replayable, unit-testable) → the supervision/IO
  boundary.
- A **config-driven ingestor** (`IngestConfig`: source→map→target, dedup-by-key,
  **provenance** `_source`, coercion) with `configs/*.json` — i.e. **tx-import** is
  already this package's job.

**The use case (bookkeeping reality, still open):**
- **Timing.** Pipeline assumes invoice + tx both present. Reality: a **Beleg
  arrives first**, no tx → book **offen** and **wait**; a later tx **settles** it
  (→ bezahlt). No `offen→bezahlt` lifecycle / re-match-on-tx-arrival.
- **Inverse.** A **tx arrives first**, no Beleg → parked, awaiting a receipt.
- **Input path.** No standalone **tx import** flow (now: an aven-skills ingest config).
- **Weak vibes.** `enrich` generic, `match` minimal, no **Offene-Posten** view.

**Decisions locked (user, 2026-06-29):**
1. **Move into aven-skills** — `flow.ts`, `flows.json`, `runs.json` move from
   aven-vibes → aven-skills; aven-vibes keeps ONLY vibe components and imports
   `@avenos/aven-skills`.
2. **Unify** the descriptive model with aven-skills' actor pipeline + tracing
   (nodes↔Stages/actors, trace↔`StageEvent`/`Logger`, tx-import↔the ingestor) —
   one architecture, not two.
3. **ToolSpec + LlmConfig** as an **aven-skills capability layer** (typed, abstracted,
   wire-ready), referenced by flow nodes.
4. **Hand-migrate every flow** to the explicit actor form (edge.kind/message, node
   supervision, flow triggers, ports) — type fields optional (additive), data
   explicit.
5. **Mock/descriptive only** — no `betterauth/src` / `tools.ts` logic, no testnet,
   no vibe-engine security change. **Universal-first** — no domain vocabulary in the
   schema; the domain is data ([[no-hardcoded-vocabulary]]).

**Actor mapping (the unifying contract — maps the descriptive model onto the
aven-skills runtime):**

| Descriptive (config) | aven-skills runtime / actor concept |
| --- | --- |
| `RecipeNode` | an **Actor** = a `Stage<I,O>` handler; `id` = address; `inputs` = mailbox; node state = behavior |
| `ResourceKind` on an edge | typed **Message** |
| `Edge` (kind data/control/error) | message channel (`tell`); `when` = behavior guard |
| Composite (`flowRef`) | child **actor system** / supervision subtree |
| `Flow` | an **ActorSystem** (pipeline graph) |
| `FlowRun` / `TraceStep` | a pipeline run + its **`StageEvent`/`Logger`** stream (event-sourced, replayable) |
| node `tools` / `llm` | the actor's **capabilities**: `ToolSpec[]` (typed I/O) + `LlmConfig` |
| ports (side effects) | aven-skills **`*Port`** injection |
| `waiting` | **stash**; parked | **dead-letters**; fan-out | **router**; settle | **aggregator** |
| resilience | **supervision** (resume/restart/stop/escalate) |

## Goal

One actor-inspired architecture in aven-skills: the flow/skill model + configs live
there, unified with the existing pipeline/ingestor/tracing; per-actor tool-calls +
LLM config are typed capabilities; aven-vibes renders. On that base, the bookkeeping
reality (any-order documents/tx, offen→bezahlt) is modelled with strong vibes.

**Completion condition** (identical to frontmatter `goal`):

> From the worktree, `cd libs/aven-skills && ulimit -n 60000 && bun test` exits 0 (moved flow tests + new cases), `cd libs/aven-skills && bun x tsc --noEmit` and `cd libs/aven-vibes && bun x tsc --noEmit` both exit 0, `cd app && bun x svelte-check` reports only the pre-existing __APP_VERSION__ error, `bunx biome check` is clean, the flow model + configs live under libs/aven-skills (none remain in aven-vibes; aven-vibes imports @avenos/skills), every Acceptance criterion is checked, AND `git diff --name-only` touches NO files under betterauth/src or the testnet workflow.

## Approach — phased, with hard checkpoints

### Phase 0 — Unify & collocate (foundation; no new features)
- **Move** `flow.ts` → `libs/aven-skills/src/flow/` (or `skills/`); `flows.json` +
  `runs.json` → `libs/aven-skills/configs/`. Update `aven-skills` exports.
- **Unify trace**: express `TraceStep` in terms of the existing `StageEvent` /
  `Logger` / `LogLevel` (reuse phase/durationMs/log events; don't invent parallel
  span types — extend these).
- **Capability layer** (`libs/aven-skills/src/capability/`): `ToolSpec { name,
  description, input: JSONSchema, output: JSONSchema }` + a wire-ready `LlmConfig
  { model, provider?, temperature?, maxTokens?, vision?, mode?, toolChoice? }`.
  `RecipeNode.tools` → `ToolSpec[]` (or tool ids + a registry); `RecipeNode.llm` →
  `LlmConfig`. Keep additive/back-compat.
- **aven-vibes** keeps only vibe components (StepVibe, FlowGraph, FlowNodeCard,
  Invoice*/Bookkeeping*/DocCompare/OpenItems…) — re-point their imports to
  `@avenos/aven-skills`. Remove `flow.ts`/`flows.json`/`runs.json` from aven-vibes.
- **app**: update imports `@avenos/aven-vibes flow.* → @avenos/aven-skills.
- Move the flow tests to `libs/aven-skills/test/`. Everything green.
- **HARD CHECKPOINT — stop & review after Phase 0** (the refactor must land clean
  before any feature work; could be split to a follow-on card here if preferred).

### Phase A — Bookkeeping reality
- `open_item` resource kind + `OPEN_ITEM_STATUS = ['offen','teilbezahlt','bezahlt']`.
- **tx-import** = an aven-skills **IngestConfig** (`configs/bank-statement-tx.json`)
  run through the existing ingestor (CSV → transactions + provenance + dedup),
  surfaced as a flow.
- doc-ingest invoice branch → **`book-open`** (offen → open_item); **`open-item-match`**
  flow (incoming tx → `find-open` → `when Treffer` **settle**→bezahlt / `when kein
  Beleg` **park**), `event`-triggered on tx arrival.
- Mock runs: `run-invoice-open`, `run-settle`, `run-tx-import`, `run-tx-unmatched`.
- Vibes: better `enrich` (contact merge), better `InvoiceMatchVibe` (candidates +
  open state), new **`OpenItemsVibe`** (Belege ↔ tx side-by-side, status badges),
  render `offen` in `InvoiceBookingVibe`.
- **Checkpoint — review after Phase A.**

### Phase B — Actor engine v2 (descriptive, additive) + migrate all flows
- Hand-migrate all six flows to explicit ports / edge.kind / supervision / triggers.
- Event-sourced trace via `StageEvent` (nested spans for composites, per-item
  fan-out, lineage via provenance ids), `waiting`/`parked` states, resource
  lifecycle state-machine, stronger `validateFlow` (flow-level cycle, unreachable,
  edge type-compat, composite IO-contract), `ACTOR_MAPPING` + a test guarding it.

Executor runtime stays out of scope; the descriptive shapes are deliberately the
runtime's data model 1:1 (and now literally share aven-skills' types).

## Files to touch

- `libs/aven-skills/src/flow/**` — moved flow model (unified with pipeline types).
- `libs/aven-skills/src/capability/**` — `ToolSpec`, `LlmConfig`.
- `libs/aven-skills/configs/**` — flows + runs configs; `bank-statement-tx.json` ingest config.
- `libs/aven-skills/src/index.ts`, `package.json` (exports) — surface the new API.
- `libs/aven-skills/test/flow.test.ts` — moved + new tests.
- `libs/aven-vibes/**` — remove flow.ts/flows.json/runs.json; vibe components import `@avenos/aven-skills`; update index/exports.
- `app/src/lib/shell/{SkillsView,RunsView,StepVibe,FlowGraph,FlowNodeCard,OpenItemsVibe,InvoiceMatchVibe,InvoiceBookingVibe}.svelte` — import `@avenos/aven-skills`; Phase A/B UI.
- `app/languages/{de,en}.json` — labels.

## Acceptance criteria

**Phase 0 — unify & collocate**
- [x] Flow model + flow/run configs live under `libs/aven-skills`; **none** remain in aven-vibes — proven by `ls libs/aven-skills/configs` + `! test -e libs/aven-vibes/src/flows.json` + grep that aven-vibes vibe components import `@avenos/aven-skills`.
- [x] `ToolSpec` + `LlmConfig` exported from `@avenos/aven-skills`; `RecipeNode` references them — test.
- [x] Trace is unified with `StageEvent`/`Logger` (no parallel span type that duplicates them) — test/grep.
- [x] Moved flow tests pass under `cd libs/aven-skills && bun test`; `aven-skills` + `aven-vibes` tsc both 0; app svelte-check only `__APP_VERSION__`.

**Phase A — bookkeeping**
- [x] `tx-import` realized as an aven-skills IngestConfig run (CSV → transactions + provenance + dedup) — test.
- [x] doc-ingest ends at `book-open` (offen); `open-item-match` settles/parks; `OPEN_ITEM_STATUS` exported; offen→bezahlt proven across `run-invoice-open`→`run-settle` — tests.
- [x] Four mock runs with expected terminal states; `open_item` kind — tests.
- [x] `OpenItemsVibe` exists; `StepVibe` maps `open-items`/`book-open`; `InvoiceBookingVibe` renders `offen` — grep + svelte-check.

**Phase B — engine v2**
- [x] Every flow carries explicit `edge.kind` + node `supervision` + `flow.triggers` (incl. minecraft) — test over all flows.
- [x] Event-sourced trace (nested + per-item fan-out + lineage), `waiting`/`parked`, stronger `validateFlow` (cycle/unreachable/type-incompat), `ACTOR_MAPPING` test.

**Cross-cutting**
- [x] Universal-first: no domain vocabulary as enum/required in the schema; a generic non-bookkeeping flow validates — `universality` test + grep guard.
- [x] `bunx biome check` clean; `git diff --name-only` touches no `betterauth/src/**` or testnet files.

## Verification

```
cd /Users/samuelandert/Documents/Development/avenOS/.claude/worktrees/vigorous-jang-81e3af
ulimit -n 60000
( cd libs/aven-skills && bun test && bun x tsc --noEmit -p tsconfig.json )
( cd libs/aven-vibes && bun x tsc --noEmit -p tsconfig.json )
( cd app && bun x svelte-check --tsconfig ./tsconfig.json )
bunx biome check libs/aven-skills libs/aven-vibes/src app/src/lib/shell
test -e libs/aven-vibes/src/flows.json && echo "NOT MOVED" || echo "moved ok"
git diff --name-only | grep -E 'betterauth/src|testnet' && echo "CONSTRAINT VIOLATED" || echo "constraint ok"
```

To build:

```
/aven-build 0084
```

## Progress log

- `2026-06-29` — Naming consolidation (review feedback): removed the double-»Ingest« confusion. `doc-ingest` flow renamed **»Beleg verbuchen«** (it's the bookkeeping consumer, not another ingest); its composite node relabelled **»Dokument-Ingest«** to match the skill it references. Split kept (Dokument-Ingest = understanding skill; Beleg verbuchen = bookkeeping). IDs unchanged → no ref/test breakage. 31 tests green; app svelte-check clean.

- `2026-06-29` — E2E consolidation pass (audit script over all flows): fixed type/consistency drift from the incremental refactors. (1) `month-close` was stale (its doc-ingest composite still declared `booking`, but doc-ingest now yields `open_item`) → realigned to docs(doc-ingest→open_item) + bank(tx-import→transaction) + settle(open-item-match→booking) → BWA report. (2) `outgoing-invoice` now books a **Forderung as offen** (open_item) on the unified open-item lifecycle, symmetric with incoming. (3) dropped the unused `contact` the `bank` composite declared but `bank-statement` never surfaced. Audit now reports 0 inconsistencies (all flowRefs resolve, all edges type-compatible, all composite outputs ⊆ referenced terminals). 31 aven-skills tests green; tscs 0; app svelte-check clean.

- `2026-06-29` — Consistency (review feedback): in Dokument-Ingest every per-type extractor is now a **reusable sub-skill (composite)** — added `rechnung` (Rechnung extrahieren) + `vertrag` (Vertrag extrahieren) skills alongside the existing `bank-statement` (Kontoauszug); classify branches to all three composites uniformly. Test asserts every branch target isComposite. 31 aven-skills tests green; tscs 0; app svelte-check clean.

- `2026-06-29` — Boundary fix (review feedback): **classify AND extract now live inside the `Dokument-Ingest` skill** (import→store→classify→branch→extract-invoice/bank/extract-contract → emits invoice|transaction|contract). The `doc-ingest` (Beleg-Ingest) flow is now a thin bookkeeping consumer: Dokument-Ingest [composite] → enrich → book-open. Dropped the separate `intake` flow. Runs: `run-doc-understand` (the ingest skill: import→store→classify→extract, with classify+extract vibes) + `run-invoice-open` (bookkeeping: ingest→enrich→book-open). 31 aven-skills tests green, tscs 0, app svelte-check clean.

- `2026-06-29` — Fixed doc-ingest config (review feedback): **classify is now a VISIBLE branch node** (was hidden in the composite). `ingest`→`intake` reusable sub-skill (import→store only); doc-ingest = intake(composite) → classify → branch(Rechnung/Kontoauszug/Vertrag) → extract-invoice→enrich→book-open / bank / extract-contract→enrich. No more dead-end branches; classify→extract contiguous. enrich accepts invoice+contract. Runs/tests updated; 31 aven-skills tests green, tscs 0, app svelte-check clean.

- `2026-06-29` — **BUILT (all phases)**: Phase A (open-item lifecycle: doc-ingest→book-open offen, open-item-match settle/park, tx-import via a real `bank-statement-tx` IngestConfig, runs, OpenItemsVibe + offen booking vibe) + Phase B (additive actor types: Port/Supervision/Trigger/ResourceLifecycle, edge kind/message/ports, span trace fields incl. nested + per-item fan-out + lineage + events; ALL 8 flows hand-migrated to explicit edge.kind+supervision+triggers; stronger validateFlow = cycle/unreachable/type-incompat; ACTOR_MAPPING + OPEN_ITEM_LIFECYCLE). Capability layer (ToolSpec+LlmConfig+TOOL_SPECS) in aven-skills. Green: 31 aven-skills tests, aven-skills+aven-vibes tsc 0, app svelte-check only __APP_VERSION__, biome clean, schema domain-generic, configs collocated in aven-skills, no betterauth/testnet diff. Moved build→review.

- `2026-06-29` — **Phase 0 DONE** (checkpoint): moved `flow.ts`→`libs/aven-skills/src/`, `flows.json`/`runs.json`→`libs/aven-skills/configs/`, flow tests→`libs/aven-skills/test/`. New `capability.ts` (ToolSpec + JsonSchema + extended LlmConfig + TOOL_SPECS registry); flow.ts re-exports them. aven-skills index `export *`s the flow model; trace reuses the existing pipeline `StageEvent`/`Logger`. aven-vibes index drops the flow re-export + `./flow` export; app shell flow-imports repointed to `@avenos/aven-skills`. Green: aven-skills tsc + 24 tests, aven-vibes tsc, app svelte-check (only __APP_VERSION__), biome clean on touched files.

- `2026-06-29` — Re-architected the plan (user): discovered `aven-skills` already IS the actor-inspired pipeline + config ingestor + tracing (`Stage`/`PipelineContext`/`StageEvent`/`Logger`/ports). Decisions: **move** the flow model + configs into aven-skills; **unify** with its pipeline/ingestor/trace (one architecture); add a typed **ToolSpec + LlmConfig** capability layer there; aven-vibes = vibe rendering only. Restructured into Phase 0 (unify/collocate foundation, hard checkpoint) → Phase A (bookkeeping) → Phase B (engine v2). Goal now proves collocation + capability layer + unified trace + no live/testnet changes.
- `2026-06-29` — (prior) hand-migrate every flow; actor-model north star; universal-first; offen+settle lifecycle; mock-only. Folded engine v2 + bookkeeping cases into one card.
- `2026-06-29` — Discovery: analysed 0083 flows end-to-end; identified timing/tx-import/vibe gaps.

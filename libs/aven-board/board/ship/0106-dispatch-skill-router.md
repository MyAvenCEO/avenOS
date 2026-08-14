---
title: Dispatch skill — gemma router + 3-tier progressive tool/context loading
summary: A minimal gemma router picks the destination skill per turn; only that skill's tools enter context (Tier 2) and its heavy context loads only on actual run (Tier 3)
owner: Claude Code (build agent)
created: 2026-07-02
updated: 2026-07-02
tags: [chat, dispatch, perf]
goal: "`bun test libs/betterauth/tests/dispatch.test.ts` exits 0 and `bunx tsc --noEmit -p libs/betterauth/tsconfig.json` exits 0, proving: (1) advertisedTools('todos')==['data_crud'], advertisedTools('ontology')==['ontology','query','mutate','bundle'], advertisedTools('website')==['show_website','edit_website','deploy_website']; (2) the router request payload carries NO tools array and NO todos snapshot / gismu lexicon (Tier-1 is schema-free); (3) an assembled todos-route context CONTAINS the todos snapshot hint while an ontology-route context does NOT (Tier-3 gating); (4) a printed measurement shows a todos turn advertises ≤ 1600 tool-schema chars (baseline 6055). Existing betterauth tests stay green; no files outside skills/tools + libs/betterauth/src/ai.ts + the new test change."
---

# Dispatch skill — gemma router + 3-tier progressive tool/context loading

## Context

The chat loop advertises **all 8 tools every round** — `chatToolDefinitions()` in
[`skills/tools/registry.ts`](../../../../skills/tools/registry.ts) returns the 5
registered tool-actors (`data_crud`, `ontology`, `query`, `mutate`, `bundle`) plus
the 3 inline Composer tools (`show_website`, `edit_website`, `deploy_website`),
~6 KB of schema. On top of that, `schemasPromptHint` (the ~2 KB todos snapshot) is
merged into the system prompt **every turn regardless of intent**. Tinfoil is
stateless, so all of it is re-prefilled on every round — the dominant chat cost
(measured: the DB path for a 2-todo create is only 671 ms; the ~15 s wall time was
LLM round-trips over a bloated prompt). Three inline patches already landed
(skip-confirmation-round, trimmed tool descriptions, last-5 history cap — commits
`8f553533`, `d1220cee`), but they don't fix the structural problem: **every turn
pays for every skill**, and it won't scale as skills are added.

This card is the structural fix: a **dispatch skill** (a minimal gemma router) that
delegates each human request to exactly one destination skill, which then does the
rest. Three tiers of progressive loading:

- **Tier 1 — dispatch/router:** a tiny, *schema-free* gemma call classifies the user
  message → one skill id (`todos` | `ontology` | `website`). No tool schemas, no
  todos snapshot, no gismu lexicon in this prompt.
- **Tier 2 — the tool only:** only the routed skill's tool **definitions** enter
  `chatToolDefinitions` for the main loop (e.g. a todos turn advertises only
  `data_crud`; an ontology turn only the 4 ontology tools).
- **Tier 3 — full actor context on run:** heavy context loads **only the moment the
  actor actually runs**. The gismu lexicon already works this way — it's read lazily
  inside the ontology mint path ([`ontology.ts:38`](../../../../libs/betterauth/src/ontology.ts),
  not in the chat prompt). This card extends the same discipline to the **todos
  snapshot hint**: it is injected only on the `todos` route, not every turn.

Decisions locked in discovery (2026-07-02):
- **First slice = this card**: dispatch + 3 tiers over the *existing* skills
  (todos + ontology + website-as-a-route-bucket). Follow-on cards handle the rest.
- **Routing cadence = gemma routes every turn** — a fresh, tiny routing call before
  each skill loop (simplest + always-correct; kept cheap so the extra round is
  offset by the far smaller main-loop prompt). No prefilter / no stickiness yet.
- Router model = **gemma** (`TINFOIL_MODEL`), the same as the chat.

**Explicitly out of scope** (each a follow-on card, noted in `ideate/`):
- **0107** — migrate Composer/website tools from inline server code into proper
  tool-actors (this card only *routes* to them as a bucket; their internals stay).
- **0108** — move `SKILL_REGISTRY` from hardcoded TS into a DB `skill` table
  (config-as-data), so skills are added without code.
- **0109** — wire the dispatch skill into the Skills + Runs viewer (seed a `dispatch`
  `flow` row; record each route decision as a `flow_run` trace).
- Multi-skill single-turn routing ("add a todo AND start a website") — for now the
  router picks the single dominant skill; a mis-route self-corrects next turn since
  routing is per-turn.

Related: [[0105]] (dynamic vibe rendering — just shipped the inline perf patches),
the "fully dynamic data brain" north star (config-as-data: `data_bundles`,
`data_operations`, vibe registry), and [[0009-brain-as-context-manager]].

## Goal

Each chat turn is routed by a cheap gemma call to exactly one skill, and only that
skill's tools + relevant heavy context enter the model's prompt — cutting per-turn
prompt size sharply and giving a structure that scales as skills are added.

**Completion condition** (identical to frontmatter `goal`):

> `bun test libs/betterauth/tests/dispatch.test.ts` exits 0 and `bunx tsc --noEmit -p libs/betterauth/tsconfig.json` exits 0, proving: (1) advertisedTools('todos')==['data_crud'], advertisedTools('ontology')==['ontology','query','mutate','bundle'], advertisedTools('website')==['show_website','edit_website','deploy_website']; (2) the router request payload carries NO tools array and NO todos snapshot / gismu lexicon (Tier-1 is schema-free); (3) an assembled todos-route context CONTAINS the todos snapshot hint while an ontology-route context does NOT (Tier-3 gating); (4) a printed measurement shows a todos turn advertises ≤ 1600 tool-schema chars (baseline 6055). Existing betterauth tests stay green; no files outside skills/tools + libs/betterauth/src/ai.ts + the new test change.

## Approach

A `SKILL_REGISTRY` (hardcoded TS map for now, a clean seam to the 0108 DB table)
names each skill → its tool ids. Two pure helpers derive the Tier-2 view from it;
one injectable router function is the Tier-1 call; `ai.ts` calls the router once per
turn and threads the chosen `skillId` through both the advertised-tool list and the
hint gating. Keeping the router function **dependency-injected** (it takes a
`callLLM` argument) makes routing logic unit-testable with a mock — the live gemma
classification quality is a HITL/review check, not a unit assertion.

- **`skills/tools/registry.ts`** — add `SKILL_REGISTRY: Record<SkillId, { label, description, tools: string[] }>` with the three buckets; add `advertisedTools(skillId): string[]` (pure) and `chatToolDefinitionsFor(skillId): ToolDefinition[]` (filters the actor defs + Composer defs by the skill's tool ids). Keep `chatToolDefinitions()` as the "all" fallback.
- **`skills/tools/dispatch.ts`** (new) — `buildRouterRequest(userText)` returns a tiny OpenAI-style body: a terse system menu ("Route to exactly one skill id: todos | ontology | website. Reply with only the id.") + the user message, **no `tools`, no hint** (this is what the test asserts is schema-free). `routeSkill(callLLM, userText): Promise<SkillId>` calls it, parses the one-word reply, validates against `SKILL_REGISTRY`, and falls back to `'todos'` on anything unknown.
- **`libs/betterauth/src/ai.ts`** — before the round loop, `const skillId = await routeSkill(gemmaCall, lastUserText)`; use `chatToolDefinitionsFor(skillId)` in the round `fetch` body instead of `chatToolDefinitions()`; gate the hint so `schemasPromptHint` is merged **only when `skillId === 'todos'`**. The router call is `stream:false`, tiny `max_tokens`, so it's sub-second.
- **`libs/betterauth/tests/dispatch.test.ts`** (new) — the measurable proof (see Acceptance).

Trade-off: +1 gemma call per turn. Mitigated by the router being schema-free + a few
output tokens; net prompt bytes drop because the main loop no longer carries 8 tools
+ the always-on hint. Router accuracy is validated live in review, not unit-tested.

## Steps

1. `SKILL_REGISTRY` + `advertisedTools` + `chatToolDefinitionsFor` in `registry.ts`.
2. `dispatch.ts`: `buildRouterRequest` (schema-free) + `routeSkill(callLLM, text)` with validation + `'todos'` fallback.
3. Wire `ai.ts`: route once per turn; advertise `chatToolDefinitionsFor(skillId)`; gate the todos hint to the todos route.
4. `dispatch.test.ts`: exact tool-set assertions, schema-free router-payload assertion, Tier-3 hint-gating assertion, and the printed ≤1600-char todos measurement.
5. `bunx tsc` + full betterauth test suite green; commit; `git mv` this card build → review.

## Files to touch

- `skills/tools/registry.ts` — `SKILL_REGISTRY`, `advertisedTools`, `chatToolDefinitionsFor`.
- `skills/tools/dispatch.ts` (new) — `buildRouterRequest`, `routeSkill`, `SkillId`.
- `libs/betterauth/src/ai.ts` — per-turn route; Tier-2 advertise; Tier-3 hint gating.
- `libs/betterauth/tests/dispatch.test.ts` (new) — the proof.

## Acceptance criteria

Each box checkable from the transcript (a command + its output proves it).

- [x] Tier-2 exact sets — `dispatch.test.ts` asserts `advertisedTools('todos')`, `('ontology')`, `('website')` equal the three exact arrays. Proven by `bun test libs/betterauth/tests/dispatch.test.ts` exit 0 (8 pass).
- [x] Tier-1 schema-free — the test asserts `buildRouterRequest(text)` has no `tools` key and its serialized body contains neither the todos snapshot nor the gismu lexicon.
- [x] Tier-3 hint gating — the test asserts an assembled todos-route context includes the todos snapshot hint and an ontology-route context does not.
- [x] Token win — the test printed `todos-turn advertised tool-schema chars: 1379 (flat-8 baseline: 6055)`; assert ≤ 1600 passed.
- [x] `routeSkill` validates + falls back — mocked `callLLM` returning `"ontology"` → `'ontology'`; garbage / thrown error / empty input → `'todos'`.
- [x] `bunx tsc --noEmit -p libs/betterauth/tsconfig.json` exits 0 (skills tsc too) and the existing betterauth suite stays green (30 pass / 0 fail across 6 files).
- [ ] **(HITL / review)** Live: a todos message routes to `todos` (server logs `[ai] dispatch → todos`, only `data_crud` advertised); an ontology message ("people can own companies") routes to `ontology`; a simple create completes in router + one skill round. — server hot-reloaded green (HTTP 401 auth gate); live route verification is the reviewer's step.

## Verification

```bash
bunx tsc --noEmit -p libs/betterauth/tsconfig.json   # types green
bun test libs/betterauth/tests/dispatch.test.ts        # the measurable proof (exit 0 + printed ≤1600)
bun test libs/betterauth                               # existing suite stays green
git status --short                                     # only the 4 files above changed
```

## Hand-off

```
/aven-build 0106
```

…or hand the condition straight to the built-in goal loop:

```
/goal <paste the Completion condition above>
```

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
Newest entry first.

- `2026-07-02` — Build: implemented the dispatch skill. `SKILL_REGISTRY` + `advertisedTools` + `chatToolDefinitionsFor` (Tier 2) in `registry.ts`; new `dispatch.ts` with `buildRouterRequest`/`parseSkillId`/`routeSkill` (Tier 1, schema-free, DEFAULT_SKILL fallback) + `skillWantsTodosHint`/`assembleSystemContext` (Tier 3 gating); wired `ai.ts` to route each turn (gemma, cheap `stream:false` call, logs `[ai] dispatch → <skill>`), advertise `chatToolDefinitionsFor(skillId)`, and merge the todos snapshot ONLY on the todos route (other routes skip the DB read). New `tests/dispatch.test.ts`: **8 pass**, todos turn = **1379 tool-schema chars** vs 6055 baseline. Full betterauth suite 30 pass / 0 fail; skills+betterauth tsc green; server hot-reloaded clean. All measurable Acceptance boxes checked; only the live-routing HITL row remains for review. `git mv` build → review.
- `2026-07-02` — Discovery: interviewed; locked first-slice = core dispatch + 3 tiers on existing skills, gemma-routes-every-turn, gemma router model. Grounded in the current registry (`chatToolDefinitions` = flat 8; gismu already lazy; hint injected every turn). Made "done" a `bun test` proving the Tier-2 exact sets + Tier-1 schema-free + Tier-3 hint gating + a ≤1600-char todos measurement. Filed website-actor migration / DB skill registry / viewer wiring as follow-on cards 0107–0109. Written into `discover/`.

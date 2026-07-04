---
title: ONE skill config — dynamic flows, generic tracing, container-query vibes
summary: Kill the flow/skill split-brain — Skills explorer + Runs derive from skill/actor rows (graph derived, overridable), tracing generic per (skill, actor), @container-capable vibe hosts with working WebKit grids — proven live on the Inventory skill
owner: unassigned
created: 2026-07-04
updated: 2026-07-04
tags: [chat, dispatch, observability, vibes, config-as-data]
goal: "`bun --env-file=.env.samuel test libs/betterauth/tests/` and `bun test libs/aven-vibes/tests/` exit 0 — including NEW tests proving (a) the Skills read-model lists EVERY skill row (inventory included) with a graph derived from its actor rows (label = skill.label, so the explorer says Planner not Todos), (b) an explicit graph override wins over the derived one, (c) a data_crud call on schema `inventory` and a `locations` call each record a flow_run trace keyed by the ROUTED skill + actor name, and `grep -rn \"startsWith('todos')\\|startsWith('ontology')\" libs/betterauth/src/ai.ts` prints NOTHING (the prefix-sniffing chain is deleted), (d) compiled :host CSS contains `container-type: inline-size` AND an `@container` rule from one shipping style compiles + is emitted (the capability is default again), while grid selectors carry an explicit width — plus `svelte-check` exits 0 and Samuel confirms live in the Tauri app: Inventory (and Planner, correctly named) visible in the Skills explorer with actor vibes previewable, inventory tool calls visible in Runs, goals/locations grids multi-column, and a garbled move name returns the correction message instead of \"Updated\"."
---

# ONE skill config — dynamic flows, generic tracing, container-query vibes

## Context

The "fully dynamic data brain" north star ([[0110]], [[0112]], [[0113]]) requires that a
skill minted as pure DB config is INSTANTLY a first-class citizen: routable, visible,
debuggable. The Inventory battle test (0112) proved the routing/CRUD side — but exposed a
**config split-brain** in observability:

- **Dispatch** reads the `skill` / `actor` tables (the real config, board 0110).
- **The Skills explorer** reads the legacy `flow` table (hand-seeded rows for todos 0047 +
  ontology 0050 only) → Inventory is invisible; the explorer still says "Todos" although
  the skill row was renamed Planner (0112) — the two stores have already drifted.
- **Runs tracing** is a hardcoded if/else chain in `ai.ts` (~line 560) sniffing
  vibe-schema prefixes (`todos*`, `ontology*`, `bundle-created`, `query-/mutation-result`)
  → every other skill's tool calls silently fall through, untraced.

Samuel's direction (interviewed 2026-07-04): flows are NOT legacy — **a flow is part of a
skill's config** (dynamic, DB-owned, never hardcoded; skills will get real multi-actor
orchestration again). Graph home decision: **derived + overridable** — the explorer
derives a hub graph from a skill's actor rows automatically (every skill row instantly
visible, nothing to seed), and an explicit graph attached to the skill overrides the
derived one when orchestration arrives.

Also folded in (same DB-viewer/vibe surface):

- **@container queries as the default capability.** The vibe style-engine's
  `container-type: inline-size` on `:host` was deleted this branch (5c3c4d87) because it
  collapsed WebKit `auto-fill` grids to one column (WKWebView shrink-to-fit). Samuel wants
  container queries KEPT for future reuse — restore the capability so it *coexists* with
  correct grid layout (container-type + explicit :host width, or containment moved to an
  inner full-width wrapper — settle empirically in S0).
- **Live verification debt.** The grid fix + the honest-move-failure fix (5c3c4d87) are
  committed + unit-tested but NOT yet confirmed in the running app; whether `bun --watch`
  hot-reloads workspace tool-actor imports (skills/tools/* imported by the auth server) is
  unverified — settle it with a command-level probe and document the answer.

Absorbs [[0109]] (dispatch observability): with generic (skill, actor) tracing, the
dispatch route decision records the chosen skill per turn through the same mechanism.

## Goal

Any skill that exists as DB config rows is automatically visible in the Skills explorer
(actors + vibe previews, graph derived from its actor rows unless overridden), and every
tool call it handles is traced in Runs — with zero per-skill code, prefix-sniffing, or
hand-seeded flow rows; vibe hosts support `@container` queries by default without
breaking WebKit grid layout.

**Completion condition** (identical to frontmatter `goal`):

> `bun --env-file=.env.samuel test libs/betterauth/tests/` and `bun test
> libs/aven-vibes/tests/` exit 0 — including NEW tests proving (a) the Skills read-model
> lists EVERY skill row (inventory included) with a graph derived from its actor rows
> (label = skill.label, so the explorer says Planner not Todos), (b) an explicit graph
> override wins over the derived one, (c) a data_crud call on schema `inventory` and a
> `locations` call each record a flow_run trace keyed by the ROUTED skill + actor name,
> and `grep -rn "startsWith('todos')\|startsWith('ontology')" libs/betterauth/src/ai.ts`
> prints NOTHING (the prefix-sniffing chain is deleted), (d) compiled :host CSS contains
> `container-type: inline-size` AND an `@container` rule from one shipping style
> compiles + is emitted (the capability is default again), while grid selectors carry an
> explicit width — plus `svelte-check` exits 0 and Samuel confirms live in the Tauri
> app: Inventory (and Planner, correctly named) visible in the Skills explorer with
> actor vibes previewable, inventory tool calls visible in Runs, goals/locations grids
> multi-column, and a garbled move name returns the correction message instead of
> "Updated".

## Approach

**S0 — verify live + settle the two empirical questions (checkpoint with Samuel).**
Prove the already-committed fixes reach the running dev app: touch a tool-actor file and
show (command-level: a marker log line served by the running auth server, or an
`lsof`/mtime probe) whether `bun --watch` reloads workspace imports — if NOT, add the
watch flag/paths so it does, and document the rule. Samuel eyeballs grids + a garbled
move in the app. Settle empirically WHICH container-type arrangement keeps WebKit grids
working (host width pin vs inner wrapper) using a minimal reproduction in the app.

**S1 — the Skills read-model from skill/actor rows (derived + overridable graph).**
One server read-model (e.g. `skillGraphs()` in config.ts): every `skill` row → { id,
label, description, actors: [{name, engine/code binding, mailbox, vibe, position}],
graph } where `graph` is DERIVED (hub layout: actors as nodes, positions from
`actor.position`) unless the skill has an explicit stored graph (nodes/edges — stored on
the flow table keyed by skill id, or a `graph` jsonb on skill; prefer whichever needs no
new table). SkillsView renders from this API — the flow-table skills path + its
hand-seeded rows are retired for skills (the minecraft demo flow may stay as a demo
flow). The Planner label corrects itself because it now comes from `skill.label`.

**S2 — generic (skill, actor) tracing; delete the ai.ts prefix chain.**
The chat tool loop knows the routed skill + the dispatched tool name — record EVERY tool
call as a `flow_run` trace keyed (skillId, actorName, detail, vibe, vibeData) at the ONE
dispatch seam; delete the entire schema-prefix if/else chain (~ai.ts 560-600) and the
special-cased confirm-path records fold into the same helper. The dispatch route decision
itself records a trace naming the chosen skill (absorbs 0109). RunsView keys runs by
skill id (flowId column already holds 'todos'/'ontology' = skill ids — no schema change
expected).

**S3 — @container as default capability, grids still correct.**
Re-introduce `container-type: inline-size` in the style-engine per S0's empirically
chosen arrangement; add ONE real `@container` usage to a shipping style (e.g. the goals
grid tightening its minmax under a narrow container) as the living proof + template for
future vibes; aven-vibes tests assert the compiled CSS carries both the containment and
the working-width arrangement.

**Out of scope:** authoring UI for explicit graphs (the override is data-shape only, set
by migration/GLM later); multi-step orchestration EXECUTION (this card is read-model +
tracing, not a flow runner); porting the minecraft demo.

## Steps

1. S0 probe: `--watch` reload proof + container-type arrangement pick + Samuel's live
   eyeball of the committed fixes. **Checkpoint: stop and confirm findings.**
2. S1 read-model + SkillsView port + retire flow-seeded skills path; tests (a)(b).
3. S2 generic tracing at the dispatch seam + delete prefix chain + dispatch route trace;
   tests (c) + the grep proof.
4. S3 container-type restore + one @container usage + style tests (d).
5. Full suites + svelte-check + Samuel's 4-point live confirmation.

## Files to touch

- `libs/betterauth/src/config.ts` (skill read-model), `server.ts` (route), `ai.ts`
  (delete prefix chain; one generic trace call), `skills-run.ts` (trace helper
  signature), migration (retire/repoint seeded skill flow rows if needed)
- `app/src/lib/shell/SkillsView.svelte`, `RunsView.svelte`, `app/src/lib/data/client.ts`
- `libs/aven-vibes/src/engine/style-engine.ts`, `brand-style.ts`, one vibe style for the
  @container example; `libs/aven-vibes/tests/*`
- `libs/betterauth/tests/*` (read-model + tracing tests), `scripts/dev-app-desktop.ts`
  (only if the --watch probe demands wider watch paths)

## Acceptance criteria

- [x] Skills read-model lists every skill row incl. `inventory`; graph derived from actor rows; explicit override wins — skill-readmodel.test 4/4.
- [ ] Skills explorer shows Planner (not Todos) + Inventory with actor vibe previews — Samuel live-confirms. (server-side proven: composeFlows returns Planner + Inventory)
- [x] Every tool call traced by (routed skill, actor): ONE generic record at the dispatch seam; inventory traces proven by test. (Samuel live-confirms in Runs.)
- [x] `grep -rn "startsWith('todos')\|startsWith('ontology')" libs/betterauth/src/ai.ts` → no output (exit 1).
- [x] Dispatch route decision traced per turn: flowId 'dispatch' / nodeId 'route' → the chosen skill (0109 absorbed).
- [x] Containment on the view root (:host > *:first-child), NEVER on :host; the goals grid ships a live `@container (max-width: 420px)` rule; validator allows strict width @container only — container-queries.test 3/3. (Grids multi-column: Samuel confirms live.)
- [ ] Garbled move name → correction message live (no false "Updated") — server-side proven (5c3c4d87 tests); Samuel confirms in-app.
- [x] `bun --watch` PROVEN to follow workspace imports: touching skills/tools/data-crud.ts restarted the auth server in 3s (start-count 6→7). Dev mode is fully hot on all layers.
- [x] betterauth 90/0 · aven-vibes 19/0 · svelte-check 0 errors.

## Verification

```bash
bun --env-file=.env.samuel test libs/betterauth/tests/
bun test libs/aven-vibes/tests/
grep -rn "startsWith('todos')\|startsWith('ontology')" libs/betterauth/src/ai.ts  # expect: empty
(cd app && bunx svelte-check --tsconfig ./tsconfig.json)                          # expect: 0 errors
```

Plus Samuel's live 4-point confirmation in the Tauri app (explorer, runs, grids, garble).

## Progress log

- `2026-07-04` — BUILT green (S0–S3). S0: --watch probe proves workspace-import hot-reload
  (6→7 server starts in 3s); container arrangement settled = containment on the view root.
  S1: composeFlows() — every skill row → a Flow derived from its actor rows (label from
  skill.label → Planner ✓, Inventory visible ✓); edge-carrying flow rows override; demo
  flows pass through; listFlows/getFlow serve the composed model (client untouched).
  S2: ONE generic recordActorRun at the dispatch seam keyed (routed skill, tool name);
  the ai.ts prefix chain DELETED (grep exit 1); dispatch route decision traced (0109);
  confirm-path delete records generically. S3: engine emits containment on
  :host > *:first-child; validator allows strict-width @container; goals grid ships the
  living example (migration 0086). Suites 90/0 + 19/0; svelte-check clean. Remaining:
  Samuel's 4-point live confirmation → review.

- `2026-07-04` — Discovered with Samuel: flows are PART of skill config (dynamic, never
  hardcoded; orchestration returns later); graph home = derived-from-actors +
  overridable; ONE card incl. container-query restore + live verification (S0 first).
  Split-brain mapped: explorer on `flow`, tracing = ai.ts prefix chain, dispatch on
  `skill`/`actor`. Absorbs [[0109]]. Created directly in discover/.

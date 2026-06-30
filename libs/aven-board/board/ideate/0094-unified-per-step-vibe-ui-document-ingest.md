---
title: Unified per-step vibe UI (one registry across Chat/Runs/Skills) + Document Ingest cards + classify fix
summary: Today a step's "vibe card" is rendered by THREE drifting paths — Chat has its own inline `{#if message.vibe === …}` dispatch (MainnetChat.svelte), Runs uses `StepVibe.svelte` (a different dispatch), and the Skills editor renders only the node config (no card). The same vibe key renders differently or not at all depending on where you are, and neither Chat nor Runs even has an `invoice` case. Collapse them into ONE shared vibe registry (a single `StepVibe`-style component = the per-step UI) that Chat, Runs AND the Skills editor all render — the editor previews each node's card with representative SAMPLE data. Start with Document Ingest's two steps: give `ingest` (storeDocument) and `classify` (classify_document) each their own dedicated card, rendered identically in all three views. Also FIX the classify result — a clear invoice currently mis-types as "Sonstiges" (other). Builds on board 0091/0093 (the per-step vibe mechanism + config-driven extraction). App + flow registry only; aven-db CRDT untouched.
owner: claude
created: 2026-06-30
updated: 2026-06-30
goal: There is ONE shared per-step vibe component (the single registry), and Chat + Runs + the Skills editor all render through it — with Document Ingest's `ingest` and `classify` steps each having their own dedicated card, and the classify result corrected. Proven by — (1) `rg -n "message.vibe ===" app/src/lib/shell/MainnetChat.svelte` returns empty (the duplicate inline dispatch is gone) and MainnetChat + RunsView + SkillsView (or FlowNodeCard) all import the one shared `StepVibe`; (2) the shared component has explicit `ingest` and `classify` branches (distinct from the generic fallback) — `rg -n "vibe === 'ingest'|vibe === 'classify'" app/src/lib/shell/StepVibe.svelte` matches both; (3) the `doc-ingest` flow's two nodes carry `vibe:'ingest'` and `vibe:'classify'` (a command prints them); (4) a `SAMPLE_VIBE_DATA` registry exists and the Skills editor renders a node's card from it (sample-data preview) — `rg -n "SAMPLE_VIBE_DATA|sampleVibe" app/src/lib/shell` matches and SkillsView/FlowNodeCard renders `StepVibe`; (5) classify is fixed — a headless `classify_document` run on a real invoice image returns `kind:'invoice'` (not 'other'); (6) `bun --bun x svelte-check` (app) + `bun run check` (touched libs) exit 0. aven-db untouched.
---

## Context

Surfaced live in the running app while ingesting an invoice: the chat showed the document tagged
"Sonstiges" (other) when it is clearly a Postmark **invoice**, and the per-step vibe cards don't render
consistently. Two distinct problems behind it:

1. **Three drifting vibe-render paths.** A step can name a `vibe` (+ `vibeData`); the runner copies it
   onto the TraceStep (board 0091). But it's rendered by:
   - **Chat** — `MainnetChat.svelte`, an inline `{#if message.vibe === 'todos'}…{:else if 'bookkeeping'}…`
     dispatch (knows todos/composer/bookkeeping/doc-compare/invoice-match/invoice-booking/tx).
   - **Runs** — `RunsView` → `StepVibe.svelte`, a *separate* dispatch (knows contact/open-items/minecraft).
   - **Skills** — `SkillsView` → `FlowNodeCard`, node CONFIG only, no card.
   The two dispatches have *diverged* (each knows vibes the other doesn't) and **neither has an `invoice`
   case**, so the capture extract step (tagged `vibe:'invoice'` in 0093) falls through to a generic card.
2. **Classify mis-types.** A clear invoice → `kind:'other'`. A vision-result bug, independent of rendering
   (likely the image fed to vision — a low-res preview / a non-rasterised PDF — or the classify prompt).

**Decisions (confirmed):** ONE card, Document Ingest end-to-end (unify dispatch + ingest/classify cards +
fix classify); the Skills editor previews each node's vibe card with **sample data**.

See [[flow-engine-actor-model]], [[avenos-brand-design-system]], [[chillax-design-system-fonts]].

## Goal

**One per-step vibe component is the single source of truth for "what a step looks like", and it renders
identically in Chat, Runs and the Skills editor.** The decision this unlocks: a step's card is designed
ONCE and trusted everywhere — so the flow editor is a faithful preview of what a run will show, and
adding a new step's card is one branch in one file, not three.

**Completion condition:** *(identical to `goal:` — the six numbered proofs.)*

## Approach

- **One registry.** Make `StepVibe.svelte` the single vibe component (vibe key → card). Drive it from a
  normalised `{ vibe, data, node, step }` input. Delete the inline `{#if message.vibe === …}` block in
  `MainnetChat.svelte` and render `<StepVibe>` there instead (Chat already has `message.vibe`+`vibeData`).
  Point the Skills editor (FlowNodeCard / a node-detail panel) at the same `<StepVibe>`.
- **Sample-data preview.** A `SAMPLE_VIBE_DATA: Record<vibeKey, unknown>` map (representative placeholder
  per vibe). The Skills editor renders `<StepVibe vibe={node.vibe} data={SAMPLE_VIBE_DATA[node.vibe]} />`
  so you see the real card in the editor with no run.
- **Document Ingest's two cards.**
  - `ingest` (storeDocument) → a "stored" card: filename · sha (short) · size · mime. New vibe key `ingest`;
    tag the doc-ingest store node `vibe:'ingest'`.
  - `classify` (classify_document) → a clean type card: kind badge + title + one-line summary. Give it its
    OWN key `classify` (today it reuses `bookkeeping`, which is a misnomer); tag the classify node.
- **Fix classify.** Diagnose why a real invoice → 'other' (the image the actor sends to vision: confirm
  it's a readable raster of the page, not a PDF blob or a tiny preview; tighten the classify prompt/schema
  if needed). Verify a real invoice image → `kind:'invoice'` via a headless `classify_document` run.

**Out of scope (follow-on):** the `extract`/`enrich` (capture) step cards (the registry makes them a
one-branch add next); editing a vibe card from the Skills UI; the bank-statement step cards.

## Steps (small, checkpointed)

1. **Unify the dispatch** — `StepVibe` becomes the single registry; `MainnetChat` + `SkillsView`/
   `FlowNodeCard` render it; the inline chat `{#if message.vibe}` block is removed. **Checkpoint.**
2. **Sample-data preview** — `SAMPLE_VIBE_DATA` map; the Skills editor renders a node's card from it. **Checkpoint.**
3. **`ingest` + `classify` cards** — two dedicated branches in `StepVibe`; tag the doc-ingest nodes
   `vibe:'ingest'`/`vibe:'classify'`; both render the same in Chat + Runs + Skills. **Checkpoint.**
4. **Fix classify** — a real invoice image → `kind:'invoice'` (headless proof). **Checkpoint.**
5. **Verify** — svelte-check + lib checks exit 0; the six proofs hold.

## Files to touch

- `app/src/lib/shell/StepVibe.svelte` — the single registry (+ `ingest`/`classify` branches).
- `app/src/lib/shell/MainnetChat.svelte` — drop the inline vibe `{#if}`, render `<StepVibe>`.
- `app/src/lib/shell/SkillsView.svelte` / `FlowNodeCard.svelte` — render `<StepVibe>` with sample data.
- `app/src/lib/shell/sample-vibe-data.ts` (new) — `SAMPLE_VIBE_DATA`.
- `libs/betterauth/src/skills-run.ts` — classify image pipeline / prompt fix; the `ingest`/`classify` vibe tags (or a migration on the `doc-ingest` flow).
- `libs/betterauth/migrations/00NN_*` — tag the doc-ingest store/classify nodes with their vibe keys.

## Acceptance criteria

- [ ] `rg -n "message.vibe ===" app/src/lib/shell/MainnetChat.svelte` is empty; MainnetChat renders `<StepVibe>`.
- [ ] `StepVibe.svelte` has explicit `ingest` + `classify` branches; RunsView, MainnetChat and SkillsView/FlowNodeCard all import the one `StepVibe`.
- [ ] A command prints the `doc-ingest` nodes carrying `vibe:'ingest'` (store) + `vibe:'classify'` (classify).
- [ ] `SAMPLE_VIBE_DATA` exists; the Skills editor previews a selected node's vibe card from it.
- [ ] Headless `classify_document` on a real invoice image returns `kind:'invoice'` (not 'other').
- [ ] The SAME card markup renders in Chat, Runs and Skills for `ingest` + `classify` (one component, no duplicate dispatch).
- [ ] `bun --bun x svelte-check` (app) + `bun run check` (touched libs) exit 0; aven-db untouched.

## Verification

```bash
rg -n "message.vibe ===" app/src/lib/shell/MainnetChat.svelte    # → empty
rg -n "vibe === 'ingest'|vibe === 'classify'" app/src/lib/shell/StepVibe.svelte   # → both
rg -n "StepVibe" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/RunsView.svelte app/src/lib/shell/SkillsView.svelte app/src/lib/shell/FlowNodeCard.svelte
rg -n "SAMPLE_VIBE_DATA" app/src/lib/shell
(cd app && bun --bun x svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -3)
(cd libs/betterauth && bun run check)
# Live/headless (auth server, .env.samuel):
#   classify_document(<real invoice image>) → { kind: 'invoice', title, summary }
#   print doc-ingest nodes → store has vibe 'ingest', classify has vibe 'classify'
```

## Hand-off

```
/aven-build 0094
```

## Progress log

Newest entry first.

- `2026-06-30` — **SUPERSEDED by board 0095 (vibe definitions as DB config); folded back to ideate/.**
  The build started (one `StepVibe` edit) then paused + reverted. Rationale: unifying THREE hardcoded
  Svelte dispatch paths is the weaker fix — once vibe view/style/logic live in the DB and render through
  the ONE engine (0095), "same vibe in Chat/Runs/Skills" is structural, not hand-maintained. Carried
  forward as follow-ons: authoring the `ingest`/`classify` cards as engine-vibes (DB vibe bundles under
  0095), and the classify-RESULT fix (invoice→'Sonstiges' — a separate small vision/prompt card).
- `2026-06-30` — Discovery. Found the root cause live: THREE drifting vibe-render paths (Chat inline
  `{#if message.vibe}`, Runs `StepVibe`, Skills config-only) + neither has an `invoice` case, plus a
  classify mis-type (invoice → 'Sonstiges'). User decisions: ONE card (Document Ingest end-to-end —
  unify dispatch + ingest/classify cards + classify fix); Skills editor previews the card with SAMPLE
  data. Goal made measurable via rg-emptiness/branch proofs + a headless classify returning 'invoice'.
  Out of scope: the extract/enrich (capture) cards (a one-branch add once the registry lands). Created in discover/.

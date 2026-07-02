---
title: Dynamic vibe rendering — every chat/Runs card renders from vibe.* registry rows
summary: Retire the per-card Svelte layouts (OntologyVibe, QueryVibe, BundleVibe, and the TodosVibe created/edited/deleted modes) — hand-author each as vibe_view/style/logic rows, render them all through the existing engine (AvenVibeView) via ONE generic host, and delete the Svelte. The last hardcoded presentation layer of the data brain becomes config-as-data.
owner: claude
created: 2026-07-02
updated: 2026-07-02
tags: [data-brain, vibes, presentation, todos]
goal: "`cd app && bun run check` reports 0 ERRORS; `git ls-files 'app/src/lib/shell/OntologyVibe.svelte' 'app/src/lib/shell/QueryVibe.svelte' 'app/src/lib/shell/BundleVibe.svelte'` prints nothing (the per-card Svelte deleted); `grep -rn 'OntologyVibe\\|QueryVibe\\|BundleVibe' app/src` prints nothing (no dangling imports); a migration seeds vibe_view/style/logic rows for all 8 migrated card kinds (a DB count returns the expected rows); and StepVibe + MainnetChat dispatch every migrated vibe through ONE generic AvenVibeView host (grep shows no per-card `<XVibe` component tags left). Live review gate: each card — todos created/edited/deleted, ontology read/created, query-result, mutation-result, bundle-created — renders correctly through the engine in chat AND in Runs."
---

# Dynamic vibe rendering — every card from vibe.* rows

## Context

Carved from [[0104-unified-data-operations]] (Stage E). The data brain is now one
operation registry (0104) and every kind is AI-authorable (predicates 0100,
queries/mutations 0101, bundles 0102) — but the CHAT/RUNS CARDS are still
hardcoded Svelte:

- `TodosVibe.svelte` — the `all` mode already renders through the engine
  (`createTodosShell()` + `loadVibeBundle('todos')` + `AvenVibeView`, board
  0095); its `created`/`edited`/`deleted` modes are hardcoded layouts.
- `OntologyVibe.svelte` (ontology read/created), `QueryVibe.svelte`
  (query-result/mutation-result), `BundleVibe.svelte` (bundle-created) — all
  hardcoded.

The vibe engine already exists and is proven by the todos `all` card:
`AvenVibeView` mounts a **shell** (a `view` ViewDef + `style` StyleDef + `logic`
sandbox-quickjs JS) with the card's data as `source`, and renders it in the
QuickJS sandbox — no per-card Svelte. `vibe_view`/`vibe_style`/`vibe_logic` are
DB rows served by `getVibe`/`loadVibeBundle`. The gap is authoring the remaining
8 card kinds as vibe rows + a single generic host, then deleting the Svelte.

**Decisions (Samuel, 2026-07-02):** (1) **hand-author** the vibe rows now (a
migration seeds them); GLM-authored vibes are the north-star follow-on
[[0106-glm-authored-vibes]]. (2) **all cards in one pass** — retire all 4 Svelte
components together.

The 8 card kinds: `todos-created`, `todos-edited`, `todos-deleted`, `ontology`,
`ontology-created`, `query-result`, `mutation-result`, `bundle-created`.

Related: vibe registry board 0095, [[0104-unified-data-operations]] (the CORS fix
that made the vibe registries loadable), the ViewDef engine in `libs/aven-vibes`.

## Goal

Every chat/Runs card is config-as-data: its look lives in `vibe_*` rows and
renders through the shared engine, with zero per-card Svelte — changeable
without a rebuild, and the seam for GLM-authored vibes later.

**Completion condition** (= frontmatter `goal`):

> `cd app && bun run check` reports 0 ERRORS; the three per-card Svelte files are deleted (git ls-files empty) with no dangling imports (grep empty); a migration seeds vibe_view/style/logic rows for all 8 card kinds; StepVibe + MainnetChat dispatch every migrated vibe through ONE generic AvenVibeView host (no per-card `<XVibe` tags left). Live review gate: each of the 8 cards renders correctly in chat AND Runs.

## Approach

**De-risk first (internal, not a separate card): one PILOT card end-to-end.**
Author `bundle-created` (the simplest) as vibe rows, build the generic host,
render it, delete `BundleVibe.svelte`, and get it green + visually correct. This
surfaces any missing ViewDef primitive before the other 7 stack on it. If the
engine lacks a primitive a card needs (a table for query rows, a diff list for
mutation ops, a place list for predicates), **extend the engine minimally** in
`libs/aven-vibes` — surface it, never fake it back in Svelte.

Then fan out the remaining 7, each: author `vibe_view` (+ a shared `vibe_style`)
+ `vibe_logic` mapping the card's `vibeData` → the view; register in the
migration; route through the host; delete/trim its Svelte; checkpoint green +
visual.

**The generic host** (`app/src/lib/shell/VibeCard.svelte` or similar): props
`{ schema, data }`; `loadVibeBundle(schema)` → build a shell (data as `source`)
→ `<AvenVibeView>`. Replaces the per-schema `{#if}` branches +
`<OntologyVibe/>` `<QueryVibe/>` `<BundleVibe/>` `<TodosVibe mode=…/>` in
`StepVibe.svelte` and `MainnetChat.svelte`. The todos `all` path already using
the engine is the template.

**Migration** seeds the 8 cards' vibe rows (view/style/logic), reusing one shared
style where possible; `getVibe`/`loadVibeBundle` already serve them; the 0104
CORS fix already lets the app fetch them.

Out of scope: GLM-authored vibes ([[0106-glm-authored-vibes]]); restyling beyond
parity with today's cards; the todos `all` card (already engine-rendered);
non-mainnet vibes.

## Steps

1. **Pilot:** `bundle-created` → vibe rows + generic `VibeCard` host + render +
   delete `BundleVibe.svelte`; extend ViewDef primitives if needed. Green + visual.
2. **Fan out actor cards:** `ontology`/`ontology-created` (delete
   `OntologyVibe.svelte`), `query-result`/`mutation-result` (delete
   `QueryVibe.svelte`). Green + visual each.
3. **Todos modes:** `todos-created`/`edited`/`deleted` → vibe rows; retire the
   hardcoded mode branches (keep the `all` engine path). Green + visual.
4. **Route everything** through `VibeCard` in StepVibe + MainnetChat; remove the
   per-card imports/branches; confirm the grep + git-ls-files metrics are empty.
5. Full green pass (`bun run check` 0 errors); live human check of all 8 cards in
   chat + Runs (review gate).

## Files to touch

- `libs/betterauth/migrations/00XX_seed_card_vibes.ts` — seed the 8 cards' vibe rows.
- `app/src/lib/shell/VibeCard.svelte` — NEW generic host (loadVibeBundle → shell → AvenVibeView).
- `app/src/lib/shell/StepVibe.svelte` / `MainnetChat.svelte` — route via VibeCard; drop per-card branches.
- `app/src/lib/shell/OntologyVibe.svelte` · `QueryVibe.svelte` · `BundleVibe.svelte` — DELETE.
- `app/src/lib/shell/TodosVibe.svelte` — retire created/edited/deleted mode layouts (keep `all`).
- `libs/aven-vibes/src/engine/*` — only if a card needs a missing ViewDef primitive.
- `app/src/lib/shell/SkillsView.svelte` — the preview path, if it dispatches these vibes.

## Acceptance criteria

- [ ] `OntologyVibe.svelte`, `QueryVibe.svelte`, `BundleVibe.svelte` deleted; `grep -rn 'OntologyVibe\|QueryVibe\|BundleVibe' app/src` empty.
- [ ] A migration seeds vibe_view/style/logic for all 8 card kinds — proven by a DB count.
- [ ] StepVibe + MainnetChat render every migrated card through the ONE `VibeCard`/AvenVibeView host — no per-card component tags (grep).
- [ ] `cd app && bun run check` reports 0 errors.
- [ ] Any ViewDef primitive added lives in `libs/aven-vibes` (surfaced), never faked in Svelte.
- [ ] Live gate: all 8 cards render correctly in chat AND Runs.

## Verification

```bash
git ls-files app/src/lib/shell/OntologyVibe.svelte app/src/lib/shell/QueryVibe.svelte app/src/lib/shell/BundleVibe.svelte  # empty
grep -rn 'OntologyVibe\|QueryVibe\|BundleVibe' app/src   # empty
cd app && bun run check   # 0 errors
# + a DB count of vibe_view rows for the 8 card names
```

## Hand-off

```
/aven-build 0105
```

## Progress log

- `2026-07-02` — Discovery: grounded in the live vibe engine (AvenVibeView shell
  = view/style/logic + data-as-source; the todos `all` card proves it). Settled
  hand-authored rows (GLM-authored → 0106) + all-cards-in-one-pass (de-risked by
  an internal pilot-first, so a missing ViewDef primitive surfaces early). Made
  "done" provable (files deleted + no dangling refs + vibe rows seeded + one host
  + check 0 errors) with a live gate for visual correctness. Promoted to discover/.

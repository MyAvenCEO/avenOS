---
title: Dynamic vibe rendering — chat/Runs cards render from vibe.* registry rows
summary: Retire the per-card Svelte layouts (TodosVibe created/edited/deleted, QueryVibe, OntologyVibe, BundleVibe) — author each as a vibe_view/style/logic bundle and render everything through the existing engine (AvenVibeView), so a card's look is config-as-data, changeable without a rebuild. The last hardcoded presentation layer of the data brain.
owner: claude
created: 2026-07-02
updated: 2026-07-02
tags: [data-brain, vibes, presentation, todos]
goal: "TBD in discover — provable that each migrated card renders through AvenVibeView from a vibe_* row (its Svelte layout deleted), app `bun run check` 0 errors, and a live review gate per card."
---

# Dynamic vibe rendering — chat/Runs cards from vibe.* rows

## Context

Carved from [[0104-unified-data-operations]] (Stage E). After 0104 the data
brain is one operation registry and todos CRUD runs through derived ops — but
the CHAT/RUNS CARDS are still hardcoded Svelte:

- `TodosVibe.svelte` — the `all` mode already renders through the engine
  (`AvenVibeView` + `loadVibeBundle('todos')`, board 0095), but the
  `created`/`edited`/`deleted` mode cards are hardcoded layouts.
- `QueryVibe.svelte` (query-result / mutation-result), `OntologyVibe.svelte`
  (ontology read/created), `BundleVibe.svelte` (bundle-created) — all hardcoded.

The vibe engine (`vibe_view` ViewDef + `vibe_style` StyleDef + `vibe_logic`
sandbox-quickjs JS, served by `getVibe`/`loadVibeBundle`, rendered by
`AvenVibeView`) already exists and is proven by the todos `all` card. The gap is
authoring the remaining cards as vibe rows + a generic host, then deleting the
Svelte.

**Why it's its own card:** this is presentation, not data — a large, per-card,
HITL-verified effort (author ~7 vibe bundles, possibly extend ViewDef primitives,
retire 4 Svelte components), and it lands card-by-card. The 0104 data unification
stands complete + parity-proven without it.

Related: vibe registry board 0095, [[0104-unified-data-operations]],
[[0100-dynamic-ontology-skill]], [[0101-dynamic-queries-mutations]],
[[0102-dynamic-bundles]].

## Open questions for discover

1. **Order / batching** — one card per vibe, or batch the todos modes together
   then the actor cards? (The card anticipates landing card-by-card.)
2. **ViewDef gaps** — do the query results TABLE, the mutation OPS diff, the
   predicate PLACE list, and the bundle TRAITS/VIEW need primitives the current
   ViewDef lacks? Each gap = extend the engine minimally (surface it, never fake
   it back in Svelte).
3. **Logic boundary** — how much per-card mapping lives in `vibe_logic`
   (sandbox JS) vs is passed as `vibeData`? Keep the sandbox pure/declarative.
4. **Measurable goal** — a per-card check: the card's Svelte file is deleted AND
   the card renders through `AvenVibeView` from a `vibe_*` row (assert the file
   is gone + the vibe row exists + app check 0 errors), plus a live gate.

## Hand-off

```
/aven-discover 0105
```

## Progress log

- `2026-07-02` — Filed from 0104 Stage E. The vibe engine + the todos `all`
  card prove the pattern; remaining = author the other cards as vibe rows and
  retire their Svelte. Needs discover to slice + set the per-card metric.

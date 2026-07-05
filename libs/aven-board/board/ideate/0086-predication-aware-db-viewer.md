---
title: Predication-aware DB viewer (x1–x5)
summary: Make the Mainnet DB viewer render universal x1–x5 predicate schemas legibly — place-role headers from schema title/description, refs as links, and predicate+valid projected (open/done) instead of raw x1/x2 columns and bare UUIDs.
owner: unassigned
created: 2026-06-29
updated: 2026-06-29
tags: [app, ui, schema]
goal:
---

# Predication-aware DB viewer (x1–x5)

## Context

Sibling of [[0085-universal-predication-schema]], which migrates mainnet user-data
to universal predications (`predicate + positional x1–x5 places`, time as a separate
reusable `valid` predicate, self-documenting Ajv `data_schema` with per-place
`title`/`description`/`examples`). aven-db CRDT is out of scope; this is the **app/**
SvelteKit UI only.

The viewer `app/src/lib/shell/MainnetDb.svelte` (board 0053/0055) is already fully
**generic** (schema-driven, no hardcoded doctypes), so it won't break on predicate
schemas — but it renders them **unreadably**:

- Columns are the raw keys `predicate · x1 · x2` (`MainnetDb.svelte:146` prints the
  bare property key as the `<th>`), which are meaningless without their role.
- `x1` shows a raw UUID, not the row it refs.
- A `task` and its `valid` show as two disconnected tables — no joined time, no
  "open/done" state.
- The Schema view (`MainnetDb.svelte:131`) dumps raw JSON, not the place structure.

The fix is mostly *mapping place-key → the `title`/`description` the predicate
compiler already emits*, plus a projection-aware data view.

## Goal

The Mainnet DB viewer renders predications legibly: human role headers (not `x1`),
refs as navigable links (not UUIDs), and a `task` shown with its joined `valid`
state (open/done) — observable in the running app against the migrated mainnet data.

When promoted to discover: sharpen into a transcript-provable completion condition
(e.g. a Svelte component test asserting the `<th>` text comes from `properties.x2.title`
and a ref cell renders an `<a>`; plus `bun run check`/`lint` exit 0).

## Plan

_Filled in at discover. Sketch:_

1. **Header from place meaning** — `columnsFor` + `<th>` use
   `jsonSchema.properties[col].title` (role) as the header and `.description` as a
   `title=`/tooltip; fall back to the raw key. Smallest, highest-impact change.
2. **Refs as links** — a cell whose property has `x-ref` renders a chip/`<a>` that
   selects the referenced row (resolve target by id; `x-ref:"*"` resolves across
   schemas, a typed `x-ref` within one).
3. **Predicate grouping + projected view** — for predicates with a companion
   `valid`, surface the projected shape (e.g. `v_task`: what · valid_from · open)
   rather than two raw tables; toggle raw ↔ projected.
4. **Schema view as place structure** — render `pos · role · kind · ref/type ·
   description` as a table instead of raw JSON.
5. **i18n** — any new labels go through `$lib/i18n` (the viewer already uses `t()`).

## Acceptance criteria

Each checkable from the transcript (a command + its output proves it).

- [ ] Column headers come from `properties[col].title`, not the raw key — proven by a component test.
- [ ] A ref cell renders a link to the referenced row — proven by a component test.
- [ ] `task` rows display open/done from the joined `valid` — proven by a test against fixture data.
- [ ] `bun run check` and `bun run lint` exit 0.

## Files to touch

- `app/src/lib/shell/MainnetDb.svelte` — headers, ref cells, projected view, schema-as-place-structure.
- `app/src/lib/data/client.ts` — any new read helper (e.g. fetch a row by id for ref resolution).
- `app/src/lib/i18n/*` — new labels.

## Progress log

Newest entry first.

- `2026-06-29` — Created in ideate as the UI sibling of 0085 (viewer is generic but renders x1–x5 unreadably; needs place-role headers, ref links, projected task+valid).

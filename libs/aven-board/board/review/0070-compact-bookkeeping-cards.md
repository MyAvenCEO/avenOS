---
title: Compact bookkeeping vibe cards (classify · match · booking)
summary: Shrink the in-chat bookkeeping cards to compact summaries — classify becomes a small standalone card (doc thumbnail + type + title/tags); invoice-match and invoice-booking become compact one-card summaries (invoice excerpt + matched tx / SKR04 Buchungssatz) instead of full side-by-side doc-views.
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [bookkeeping, vibe, ui]
goal: "`bun run check` exits 0 (app svelte-check: 0 new errors) AND each of BookkeepingVibe/InvoiceMatchVibe/InvoiceBookingVibe.svelte renders compact (no AvenVibeView/doc-view side-by-side; `grep -L AvenVibeView` for the three) AND `grep -R \"w-\\[min(84rem\" app/src/lib/shell/MainnetChat.svelte` only matches the doc-compare branch"
---

# Compact bookkeeping cards

## Context

User feedback while testing the pipeline: the in-chat cards were too big. Classification should be
"a small standalone card with the doc attached"; the match→bookkeeping view should be "a small
excerpt of compact metadata matched to the bookkeeping Kontenrahmen match as a compact summary".

## Goal

The three bookkeeping chat cards render as compact summaries (not full-width doc-views).

**Completion condition:** see frontmatter `goal`.

## Approach

Rewrote the three Svelte wrappers to self-render compact cards (plain markup reading their `data`
prop) instead of mounting `AvenVibeView` doc-views:
- `BookkeepingVibe` — small card: doc thumbnail (h-20) + type chip + title + 1-line description + tags. `max-w-md`.
- `InvoiceMatchVibe` — `max-w-2xl` card: invoice excerpt (vendor · Rechnung # · date · total) + matched-tx line (counterparty · date · confidence · amount) or "keine Buchung".
- `InvoiceBookingVibe` — `max-w-2xl` card: invoice excerpt + SKR04 Buchungssatz (Soll/Haben konto + Bezeichnung, Steuerschlüssel, Brutto, Buchungstext).
MainnetChat renders all three in a normal `w-full` container (dropped the wide break-out — kept only
for the full `doc-compare`). The aven-vibes doc-view + per-type mappers stay (used by doc-compare).
SKR stays SKR04 (user: test run).

## Acceptance criteria

- [x] `bun run check` exit 0; app svelte-check only the pre-existing `__APP_VERSION__`; biome-clean.
- [x] The three cards self-render (no AvenVibeView import; compact `max-w-md`/`max-w-2xl`).
- [x] MainnetChat: classify/match/booking use a normal container; the `w-[min(84rem…` break-out remains only on `doc-compare`.
- [ ] (Review, in-app) classify shows a small card w/ thumbnail; match & booking show compact summaries.

## Verification

```bash
bun run check
grep -L AvenVibeView app/src/lib/shell/BookkeepingVibe.svelte app/src/lib/shell/InvoiceMatchVibe.svelte app/src/lib/shell/InvoiceBookingVibe.svelte
grep -c "w-\[min(84rem" app/src/lib/shell/MainnetChat.svelte   # only doc-compare → 1
```

## Progress log

- `2026-06-25` — Built: compacted the three cards to self-rendering Svelte summaries; MainnetChat containers narrowed (break-out kept only for doc-compare). app check clean, biome-clean. Client-only (HMR). SKR04 retained per user. Created in review/.

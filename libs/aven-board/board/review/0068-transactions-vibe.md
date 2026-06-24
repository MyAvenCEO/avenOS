---
title: Transactions vibe — live "show my transactions" list
summary: A data-backed `tx` vibe (like todos) listing all stored transactions from /api/data as a table. Triggered in chat by "show my transactions" → the model runs data_crud(list, 'tx') → the server already emits an aven-vibe:tx card; this adds the client view + nav entry.
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [bookkeeping, transactions, vibe, data]
goal: "`bun run check` exits 0 (app svelte-check: 0 new errors) AND `grep -R \"TransactionsVibe\" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/MainnetVibes.svelte` matches AND `grep -R \"message.vibe === 'tx'\" app/src/lib/shell/MainnetChat.svelte` matches AND `grep -R \"mainnet.transactions\" app/languages/de.json app/languages/en.json` matches"
---

# Transactions vibe — live list

## Context

Follow-on to **[[0065]]** (tx fan-out) and **[[0066]]** (reconciliation). The `tx` schema/table now
holds every extracted transaction; this gives it a view: ask "show my transactions" and get a live
table of all of them.

The server side already exists: `data_crud` emits `aven-vibe:<schema>` for ANY touched schema
(board 0054), so `data_crud(list, 'tx')` already streams an `aven-vibe:tx` card + persists the
marker. So this card is **client-only** — render the `tx` vibe.

## Goal

A `tx` vibe renders all transactions live from /api/data, in chat (on "show my transactions") and as
a Vibes-tab entry; it re-hydrates after reload (data-backed, re-fetched — no payload needed).

**Completion condition** (identical to frontmatter `goal`):

> `bun run check` exits 0 (app svelte-check: 0 new errors) AND `grep -R "TransactionsVibe" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/MainnetVibes.svelte` matches AND `grep -R "message.vibe === 'tx'" app/src/lib/shell/MainnetChat.svelte` matches AND `grep -R "mainnet.transactions" app/languages/de.json app/languages/en.json` matches

## Approach

`TransactionsVibe.svelte` mirrors `TodosVibe`: `ensureSchema('tx', TX_SCHEMA)` (idempotent), then a
TanStack `createQuery` over `listValues('tx')` keyed on the schema id (so the SSE `data` event
refetches). Renders a sorted table (date · counterparty · purpose · amount · balance) with a count +
running total; outgoing amounts in red; empty state prompts uploading a statement. Wired into the
MainnetChat stream (`message.vibe === 'tx'`, wide break-out) + MainnetVibes nav + i18n.

## Files to touch

- `app/src/lib/shell/TransactionsVibe.svelte` — the view (data-backed).
- `app/src/lib/shell/MainnetChat.svelte` — `tx` render branch + import.
- `app/src/lib/shell/MainnetVibes.svelte` — nav entry + render + import.
- `app/languages/{de,en}.json` — `mainnet.transactions.*`.

## Acceptance criteria

- [x] `bun run check` exit 0; app svelte-check only the pre-existing `__APP_VERSION__`; biome-clean.
- [x] Chat + nav wired — `grep "TransactionsVibe"` matches both shells; `message.vibe === 'tx'` branch present.
- [x] i18n — `grep "mainnet.transactions"` matches both catalogs.
- [x] Re-hydrates after reload — data-backed (re-fetches /api/data), no marker payload needed (0067 pattern).
- [ ] (Review, in-app) After extracting a statement, "show my transactions" renders the full table; new statements add rows live.

## Verification

```bash
bun run check
grep -R "TransactionsVibe" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/MainnetVibes.svelte
grep -R "message.vibe === 'tx'" app/src/lib/shell/MainnetChat.svelte
grep -R "mainnet.transactions" app/languages/de.json app/languages/en.json
```

## Hand-off

```
/aven-review 0068
```

## Progress log

Newest entry first.

- `2026-06-25` — Built client-only: `TransactionsVibe.svelte` (TodosVibe-style, reads `tx` via /api/data, table with count+total), wired into MainnetChat (`vibe === 'tx'`) + MainnetVibes nav + i18n. Server already emits `aven-vibe:tx` from data_crud(list,'tx') (0054). app check clean, biome-clean. The model maps "show my transactions" → data_crud list 'tx' via the schema-prompt hint. Created in review/.

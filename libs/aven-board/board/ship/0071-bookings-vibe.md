---
title: Bookings vibe — live "show all Buchungen/bookings" list
summary: A data-backed `booking` vibe (parallel to the transactions list) showing all SKR04 Buchungssätze from /api/data as a table. Triggered in chat by "show me all Buchungen/bookings" → data_crud(list,'booking') → the server already emits an aven-vibe:booking card; this adds the client view + nav entry.
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [bookkeeping, bookings, vibe, data]
goal: "`bun run check` exits 0 (app svelte-check: 0 new errors) AND `grep -R \"BookingsVibe\" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/MainnetVibes.svelte` matches AND `grep -R \"message.vibe === 'booking'\" app/src/lib/shell/MainnetChat.svelte` matches AND `grep -R \"mainnet.bookings\" app/languages/de.json app/languages/en.json` matches"
---

# Bookings vibe — live list

## Context

Sibling of **[[0068]]** (transactions list), over the `booking` table from **[[0069]]**. The booking
step writes `booking` rows; this gives them a view: "show me all Buchungen/bookings" → a live table
of every Buchungssatz. Server side already exists (data_crud emits `aven-vibe:<schema>`, board 0054),
so this is **client-only**.

## Goal

A `booking` vibe lists all bookings live from /api/data, in chat (on "show me all bookings") and as a
Vibes-tab entry; re-hydrates after reload (data-backed, re-fetched).

**Completion condition:** see frontmatter `goal`.

## Approach

`BookingsVibe.svelte` mirrors `TransactionsVibe`: `ensureSchema('booking', BOOKING_SCHEMA)` + a
TanStack query over `listValues('booking')`. Table: Lieferant (vendor + invoice #) · Soll (konto ·
Bezeichnung) · Haben · Steuer · Brutto, with a count + gross total. Wired into MainnetChat
(`message.vibe === 'booking'`) + MainnetVibes nav + i18n (`mainnet.bookings.*`).

## Files to touch

- `app/src/lib/shell/BookingsVibe.svelte` — the view (data-backed).
- `app/src/lib/shell/MainnetChat.svelte` — `booking` render branch + import.
- `app/src/lib/shell/MainnetVibes.svelte` — nav entry + render + import.
- `app/languages/{de,en}.json` — `mainnet.bookings.*`.

## Acceptance criteria

- [x] `bun run check` exit 0; app svelte-check only the pre-existing `__APP_VERSION__`; biome-clean.
- [x] Chat + nav wired — `grep "BookingsVibe"` matches both shells; `message.vibe === 'booking'` branch present.
- [x] i18n — `grep "mainnet.bookings"` matches both catalogs.
- [x] Re-hydrates after reload — data-backed (re-fetches /api/data), no marker payload needed.
- [ ] (Review, in-app) After booking an invoice, "show me all bookings" renders the full Buchungen table.

## Verification

```bash
bun run check
grep -R "BookingsVibe" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/MainnetVibes.svelte
grep -R "message.vibe === 'booking'" app/src/lib/shell/MainnetChat.svelte
grep -R "mainnet.bookings" app/languages/de.json app/languages/en.json
```

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
- `2026-06-25` — Built client-only: `BookingsVibe.svelte` (TodosVibe/TransactionsVibe-style, reads `booking` via /api/data, table with count+gross total), wired into MainnetChat (`vibe === 'booking'`) + MainnetVibes nav + i18n. Server already emits `aven-vibe:booking` (0054). app check clean, biome-clean. Created in review/.

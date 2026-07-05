---
title: Booking "prüf" detail — 50/50 booking ↔ referenced invoice
summary: Make the bookings view a master-detail. The list stays; clicking a booking opens a 50/50 split — the Buchungssatz (split-aware) on the left, the referenced source invoice (looked up by invoice_value_id) on the right — so a booking can be double-checked ("prüf") against its invoice. Reuses the engine doc-views (mapBookingToView + mapDocView).
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [bookkeeping, bookings, vibe, ui]
goal: "`bun run check` exits 0 (app svelte-check: 0 new errors) AND BookingsVibe renders a 50/50 detail with the booking (mapBookingToView) left + the referenced invoice (mapDocView, looked up by invoice_value_id) right (`grep -n \"mapBookingToView\\|mapDocView\\|invoice_value_id\" app/src/lib/shell/BookingsVibe.svelte`) AND split bookings show all Soll lines (via the split-aware mapBookingToView from [[0073]])"
---

# Booking prüf detail

## Context

After [[0071]] (bookings list) + [[0073]] (split bookings), the user wants to verify a booking is
correct by loading a detail view: the booking on the left, the actual referenced invoice on the
right, 50/50 — to "prüf" it. Split bookings must be handled (show every Soll position).

## Goal

Selecting a booking opens a 50/50 prüf view: Buchungssatz (split-aware) ↔ referenced invoice.

**Completion condition:** see frontmatter `goal`.

## Approach

`BookingsVibe` becomes master-detail (client-only):
- The list rows are now clickable (`selectedId`).
- Detail: a 50/50 grid. LEFT = the booking rendered via the engine (`mapBookingToView`, already
  split-aware from [[0073]] — one Soll row per position, Haben, totals, Abgleich). RIGHT = the
  referenced source invoice, found by `booking.invoice_value_id` in the `invoice` schema's values
  (`listSchemas` → invoice schema id → `listValues`, mapped by id), rendered via `mapDocView`. Both
  panes use `AvenVibeView` with a shared `createDocCompareShell`. A "← Alle Buchungen" back button.
- MainnetChat's `booking` branch widened to the break-out container so the 50/50 has room; the LIST
  self-centers at `max-w-2xl`, the detail uses full width.
- i18n: `mainnet.bookings.back` / `noInvoice` / `prüfHint`.

## Acceptance criteria

- [x] `bun run check` exit 0; app svelte-check only the pre-existing `__APP_VERSION__`; biome-clean.
- [x] Detail = 50/50 booking (mapBookingToView) ↔ invoice (mapDocView by invoice_value_id).
- [x] Split bookings render all Soll lines (split-aware mapBookingToView).
- [x] Fallback message when no invoice is linked.
- [ ] (Review, in-app) Click a booking → 50/50 prüf view; the invoice totals cross-check the (split) Buchungssatz.

## Verification

```bash
bun run check
grep -n "mapBookingToView\|mapDocView\|invoice_value_id\|selectedId" app/src/lib/shell/BookingsVibe.svelte
```

## Progress log

- `2026-06-25` — Built client-only: BookingsVibe master-detail (clickable list → 50/50 prüf detail), booking via mapBookingToView (split-aware) left, referenced invoice via mapDocView (by invoice_value_id) right, shared AvenVibeView shell; chat container widened; i18n added. app check clean, biome-clean. Created in review/.

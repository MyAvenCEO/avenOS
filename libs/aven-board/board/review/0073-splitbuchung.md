---
title: Splitbuchungen — multi-line bookings (split tool + prompt + balance + views)
summary: Extend the booking step from a single Buchungssatz to a Splitbuchung — multiple Soll positions per invoice (different VAT rates, cost types, private/business shares, Skonto) that balance against one Haben account. The book_invoice tool returns a `lines[]` array, buildBookingRecord validates each konto + enforces the balance, and the final booking view (InvoiceBookingVibe), bookings list, and BWA all reflect the split.
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [bookkeeping, splitbuchung, booking, vibe]
goal: "`bun run check` exits 0 (app svelte-check: 0 new errors; lib tsc clean) AND aven-vibes booking tests cover a balanced split (booked, is_split, lines.length===2, gross===invoice total) and an unbalanced split (reason contains 'weicht') AND `grep -q \"lines\" libs/aven-vibes/src/vibes/invoice/booking.ts` AND the book_invoice tool requires `lines` (`grep \"required: \\['lines'\" libs/betterauth/src/ai.ts`) AND InvoiceBookingVibe renders one row per Soll line"
---

# Splitbuchungen

## Context

Real invoices mix VAT rates (7%/19%), cost types (Bürobedarf + Reinigung + Bewirtung), private vs
business shares, and Skonto — each needing its own Soll account, all balancing to one Haben (the
"Saldo = 0" rule of doppelte Buchführung). Our booking ([[0069]]) only produced ONE Soll line. The
user asked for correct Splitbuchungen in the tool functionality, the system prompt, AND the final
booking view.

## Goal

The booking step can split one invoice across multiple Soll accounts that balance to the Haben, and
every booking view reflects the split.

**Completion condition:** see frontmatter `goal`.

## Approach

- `booking.ts`: new `BookingLine` (+ `BookingPickLine`); `BookingRecord` gains `lines[]` + `is_split`
  and keeps flat `soll_konto`/`net`/`tax`/`gross`/`tax_key` as totals/mirror-of-lines[0] for
  backward compat. `buildBookingRecord` normalizes the legacy single-line shape, validates EACH
  line's konto against the chart (fills Bezeichnung from the chart), sums totals, and enforces the
  Splitbuchung invariant (Σ line gross ≈ invoice gross = Haben) — an imbalance drops confidence and
  notes it in `reason`. `mapBookingToView` renders one row per Soll line.
- `book_invoice` tool (ai.ts): now takes a `lines[]` array (per-position soll_konto/net/tax/gross/
  tax_key/note) instead of single fields; the system prompt instructs WHEN to split (mixed VAT /
  cost types / private share / Skonto) and that the lines must balance.
- Views: `InvoiceBookingVibe` shows one row per Soll position (with per-line amount + tax_key when
  split) + a Brutto total; `BookingsVibe` shows a "+N Split" badge; `FinanceVibe` (BWA) expands every
  booking into its lines so P&L-by-account is correct for splits.

## Acceptance criteria

- [x] `bun run check` exit 0; lib tsc clean; app svelte-check only the pre-existing `__APP_VERSION__`; biome-clean (1 index-key warning).
- [x] 25/25 aven-vibes tests incl. balanced + unbalanced split cases.
- [x] book_invoice requires `lines`; prompt covers Splitbuchung.
- [x] InvoiceBookingVibe / BookingsVibe / FinanceVibe reflect splits.
- [ ] (Review, in-app) A mixed-VAT invoice books as 2+ Soll lines balancing to the Haben; the card shows each line.

## Verification

```bash
bun run check
grep -n "BookingLine\|is_split\|invoiceGross" libs/aven-vibes/src/vibes/invoice/booking.ts
grep -n "required: \['lines'" libs/betterauth/src/ai.ts
grep -n "each lines" app/src/lib/shell/InvoiceBookingVibe.svelte
```

## Progress log

- `2026-06-25` — Built: split booking model (`lines[]` + `is_split` + per-line chart validation + balance check), `book_invoice` `lines[]` tool + Splitbuchung prompt, and split rendering in InvoiceBookingVibe + BookingsVibe + FinanceVibe. 25/25 tests (added balanced/unbalanced split), lib tsc clean, app check clean. Auth restarted. Created in review/.

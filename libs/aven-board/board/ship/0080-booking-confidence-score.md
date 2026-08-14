---
title: Account-pick confidence score (high / medium / low) shown on bookings
summary: Surface a confidence score for the picked SKR04 account. The model rates how sure it is of the account choice (high / medium / low); the booking caps it to low when the split doesn't balance, none when nothing booked. Shown as a colored badge on the booking card, the bookings list, and the prüf detail.
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [bookkeeping, booking, confidence, ui]
goal: "`bun run check` exits 0 (lib + betterauth tsc clean; biome clean) AND BookingConfidence + BOOKING_SCHEMA include 'low' AND book_invoice confidence enum is ['high','medium','low'] with a description AND the confidence badge renders in InvoiceBookingVibe + BookingsVibe (`grep -n confidence app/src/lib/shell/InvoiceBookingVibe.svelte app/src/lib/shell/BookingsVibe.svelte`) AND 27/27 aven-vibes tests pass"
---

# Booking confidence score

## Context

User asked for a confidence score on the picked account (high / medium / low) so a booking's
reliability is visible at a glance. The field existed (`confidence`) but was only high/medium and
barely surfaced.

## Goal

Each booking carries + displays an account-pick confidence (high / medium / low). See `goal`.

## Approach

- `booking.ts`: `BookingConfidence` + `BOOKING_SCHEMA` gain `low`. `buildBookingRecord` takes the
  LLM's self-rating but caps it to `low` when the split doesn't balance, and `none` when unbooked.
  `mapBookingToView` shows Hoch / Mittel / Niedrig.
- `book_invoice` tool: `confidence` enum → ['high','medium','low'] with a description ("confidence in
  the chosen ACCOUNT(s)"); prompt tells the model to rate it honestly (low for a guess/fallback).
- Views: a colored badge — Sicher (green) / Mittel (amber) / Unsicher (red) — in the
  InvoiceBookingVibe Buchung header and the BookingsVibe list row (and Niedrig/Mittel/Hoch in the
  prüf detail via mapBookingToView).

## Acceptance criteria

- [x] `bun run check` exit 0; lib + betterauth tsc clean; biome clean; auth boots clean (200).
- [x] `low` in BookingConfidence + BOOKING_SCHEMA enum; ensureDocSchema upserts the definition so `low` writes validate.
- [x] book_invoice confidence enum ['high','medium','low'] + described; prompt rates it.
- [x] Badge in InvoiceBookingVibe + BookingsVibe; 3 levels in mapBookingToView.
- [x] 27/27 aven-vibes tests.
- [ ] (Review, in-app) A fallback/guessed account shows "Unsicher"; an obvious one shows "Sicher".

## Verification

```bash
bun run check
grep -n "BookingConfidence\|'low'" libs/aven-vibes/src/vibes/invoice/booking.ts
grep -n "confidence" app/src/lib/shell/InvoiceBookingVibe.svelte app/src/lib/shell/BookingsVibe.svelte
```

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
- `2026-06-25` — Built: low added to confidence (type + schema + buildBookingRecord cap on imbalance); book_invoice enum + prompt; colored confidence badge in booking card + bookings list + prüf detail. 27/27 tests; lib + auth tsc clean; biome clean; auth restarted. Created in review/.

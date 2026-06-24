---
title: Book VAT properly — explicit Abziehbare Vorsteuer postings (our own, no DATEV automation)
summary: VAT was effectively not booked — one expense line + a `tax_key` string label, with no input-VAT (Vorsteuer) on its own account. Now each expense position is booked at NET and the system itself posts the Abziehbare Vorsteuer to the correct SKR04 account (1406 for 19%, 1401 for 7%), derived from net + a per-position tax_treatment; Haben Bank = gross; it always balances. Reverse-charge §13b / intra-EU / steuerfrei correctly get no deduction line.
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [bookkeeping, vat, vorsteuer, booking]
goal: "`bun run check` exits 0 (betterauth tsc clean; lib tsc clean; biome clean) AND aven-vibes tests cover: domestic 19% → an auto-posted 1406 Vorsteuer line (net 100 → VAT 19, gross 119); mixed 19%+7% → 1406 + 1401 lines; reverse_charge → NO Vorsteuer line. The model never picks a VAT account: VORSTEUER_KONTO is chosen in booking.ts (`grep -n VORSTEUER_KONTO libs/aven-vibes/src/vibes/invoice/booking.ts`), and book_invoice takes net + tax_treatment, not a VAT konto."
---

# Book VAT properly (our own Vorsteuer postings)

## Context

User noticed invoice + Umsatzsteuer felt "booked as one and the same". Correct: our booking posted a
single expense line at net/gross + a `tax_key` STRING — the deductible input VAT (Vorsteuer) was never
posted to its own account. User: do NOT use DATEV's automatic Steuerschlüssel — book it correctly
ourselves.

## Goal

A domestic VAT invoice books net→expense + the correct Abziehbare Vorsteuer account, balancing to the
Haben — with the VAT account chosen by us (never the LLM). See frontmatter `goal`.

## Approach

- `book_invoice` tool: each expense `line` carries `soll_konto` (expense, NOT a VAT account) + NET
  amount + a `tax_treatment` enum (`vat_19` / `vat_7` / `reverse_charge` / `intra_eu` / `none`). The
  prompt forbids the model from adding a Vorsteuer line or picking a VAT konto.
- `buildBookingRecord` (booking.ts): expense positions post at NET; per VAT rate it accumulates the
  VAT and appends an **Abziehbare Vorsteuer** Soll line from `VORSTEUER_KONTO` (19%→1406, 7%→1401),
  validated against the chart; Haben Bank = sum of all Soll = net + VAT. reverse_charge / intra_eu /
  none → no deduction line (books at net). Balance check vs the invoice total unchanged.
- Views (mapBookingToView, InvoiceBookingVibe, BookingsVibe prüf) already render all `lines`, so the
  Vorsteuer line shows automatically; BWA skips it (1xxx ≠ P&L).

## Recovery note

While editing the booking prompt, a scripted splice matched the WRONG `const system =` (there are
two) and clobbered `matchInvoiceLLM`'s tail + `bookInvoice`'s head. Both were reconstructed from the
session transcript + known types and verified (betterauth tsc clean, 26/26 tests, app check clean).

## Acceptance criteria

- [x] `bun run check` exit 0; betterauth + lib tsc clean; biome clean; auth boots clean (200).
- [x] 26/26 aven-vibes tests incl. domestic-19% (auto 1406), mixed-19%+7% (1406+1401), reverse-charge (no VAT line).
- [x] Model never picks a VAT konto — VORSTEUER_KONTO is server-side; tool takes net + tax_treatment.
- [ ] (Review, in-app) A domestic 19% invoice books expense(net) + 1406 Vorsteuer + Bank(gross); §13b stays single-line.

## Follow-ups

- §13b / intra-EU self-assessed USt↔Vorsteuer PAIR (nets to zero) needs a second Haben line — a
  generalized multi-Haben Buchungssatz. Deferred (phase 2); today reverse_charge books at net.

## Progress log

- `2026-06-25` — Built: explicit auto-derived Vorsteuer postings (1406/1401) from net + tax_treatment; book_invoice tool + prompt reworked; tests updated (domestic/mixed/reverse-charge). Recovered an accidental splice of matchInvoiceLLM/bookInvoice. All checks green; auth clean. Created in review/.

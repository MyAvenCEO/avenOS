---
title: Book restaurant / Bewirtung receipts (§4 Abs.5 EStG 70/30 split)
summary: A restaurant invoice (Bewirtungsbeleg) came back "Kein passendes Konto gefunden" because Bewirtung is a special Vorgang the booker hadn't been taught. Add deterministic handling — cost_treatment "bewirtung" books the §4 Abs.5 Nr.2 EStG split (70% abziehbar → 6640, 30% nicht abziehbar → 6644) with the FULL Vorsteuer still deductible, balancing to the Haben. Plus a prompt nudge to always pick a best-fit account.
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [bookkeeping, bewirtung, booking, vat]
goal: "`bun run check` exits 0 (lib + betterauth tsc clean; biome clean) AND an aven-vibes test books a Bewirtung receipt as a 70/30 split: lines contain 6640 (70%), 6644 (30%) and 1406 (full Vorsteuer), balancing to the invoice gross AND the book_invoice tool exposes a cost_treatment `bewirtung` (`grep -n cost_treatment libs/betterauth/src/ai.ts libs/aven-vibes/src/vibes/invoice/booking.ts`)"
---

# Bewirtung booking

## Context

A restaurant receipt (Pogner's, with handwritten "Bewirtete Personen") classified + extracted fine
but the booking returned "Kein passendes Konto gefunden" — the model didn't confidently pick an
account. Reason: **Bewirtung is a special Vorgang** (§4 Abs.5 Nr.2 EStG: 70% deductible / 30% not,
full Vorsteuer) we hadn't taught the booker. The chart HAS the accounts (6640 Bewirtungskosten,
6644 Nicht abzugsfähige Bewirtungskosten).

## Goal

A restaurant/Bewirtung receipt books as the correct 70/30 split with full Vorsteuer, balancing.
See frontmatter `goal`.

## Approach

- `booking.ts`: new `cost_treatment` ('standard' | 'bewirtung'). For a `bewirtung` line we book the
  net 70% → 6640 + 30% → 6644 (deterministic, accounts chosen by us), and the Vorsteuer (on the FULL
  net, via the existing 0078 path) → 1406 — so it's fully deductible. Balances to the Haben.
- `book_invoice` tool: line gains `cost_treatment` with `bewirtung` documented (restaurant /
  Bewirtungsbeleg / "Bewirtete Personen" → full net + vat_19 + cost_treatment bewirtung).
- Prompt: explicit BEWIRTUNG rule + an "ALWAYS pick a best-fit account, never return without one"
  robustness nudge (so a clear expense never silently fails to book).

## Acceptance criteria

- [x] `bun run check` exit 0; lib + betterauth tsc clean; biome clean; auth boots clean (200).
- [x] Bewirtung test: 6640 (70%) + 6644 (30%) + 1406 (full Vorsteuer), balances to gross.
- [x] book_invoice exposes cost_treatment `bewirtung`; prompt teaches it.
- [ ] (Review, in-app) Re-book Pogner's restaurant receipt → 6640 + 6644 + 1406 + Bank, balanced.

## Verification

```bash
bun run check
grep -n "cost_treatment\|BEWIRTUNG_" libs/aven-vibes/src/vibes/invoice/booking.ts
grep -n "cost_treatment\|BEWIRTUNG\|Bewirtung" libs/betterauth/src/ai.ts
```

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
- `2026-06-25` — Built: deterministic Bewirtung 70/30 split (6640/6644 + full 1406 Vorsteuer) via cost_treatment; book_invoice tool + prompt taught restaurant/Bewirtung; "always pick an account" nudge. 7/7 booking tests (added Bewirtung). lib + auth tsc clean, biome clean; auth restarted. Created in review/.

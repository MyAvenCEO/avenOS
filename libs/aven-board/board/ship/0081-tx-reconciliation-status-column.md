---
title: Transactions list — reconciliation Status column (Belegt / Verbucht)
summary: Add a Status column to the "show me all transactions" view with multi tags derived from the match + booking records — "Belegt" (a Beleg/invoice is linked to the payment) and "Verbucht" (the matched invoice is posted to a konto); "Offen" when neither. Correct bookkeeping terminology.
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [bookkeeping, transactions, reconciliation, vibe]
goal: "`bun run check` exits 0 (app svelte-check: 0 new errors) AND TransactionsVibe shows a Status column with Belegt/Verbucht/Offen tags derived from match.tx_dedup_key → invoice_value_id → booking.status (`grep -n \"txStatus\\|matchByTx\\|bookedInvoices\" app/src/lib/shell/TransactionsVibe.svelte`) AND i18n keys mainnet.transactions.{status,belegt,verbucht,offen} exist in de + en"
---

# Transactions reconciliation Status column

## Context

The transactions list ([[0068]]) showed raw bank rows. The user wants each transaction's current
reconciliation state visible — multi tags for "doc linked" and "booked" — in correct bookkeeping
terminology.

## Goal

Each transaction row shows its reconciliation tags. See frontmatter `goal`.

## Approach

Client-only. `TransactionsVibe` additionally reads the `match` + `booking` schemas (ids via
`listSchemas`). It derives:
- `matchByTx`: tx `dedup_key` → linked `invoice_value_id` (from `match` rows with status 'matched').
- `bookedInvoices`: set of `invoice_value_id` with a `booking` of status 'booked'.
Per row a Status cell renders tags: **Belegt** (Beleg/invoice linked) when the tx has a match,
**Verbucht** (posted to a konto) when its invoice is booked, **Offen** when neither. i18n:
`mainnet.transactions.{status,belegt,verbucht,offen}` (en: Doc linked / Booked / Open).

## Acceptance criteria

- [x] `bun run check` exit 0; app svelte-check only the pre-existing `__APP_VERSION__`; biome-clean.
- [x] Status column with Belegt/Verbucht/Offen tags, derived from match + booking.
- [x] i18n keys in de + en.
- [x] Data-backed (re-fetches), so tags update live as invoices are matched/booked.
- [ ] (Review, in-app) A statement tx paid by a booked invoice shows Belegt + Verbucht; an unmatched one shows Offen.

## Verification

```bash
bun run check
grep -n "txStatus\|matchByTx\|bookedInvoices\|transactions.status" app/src/lib/shell/TransactionsVibe.svelte
grep -n "\"belegt\"\|\"verbucht\"\|\"offen\"" app/languages/de.json app/languages/en.json
```

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
- `2026-06-25` — Built client-only: Status column with Belegt/Verbucht/Offen tags in TransactionsVibe, derived from match (tx↔invoice) + booking (invoice→konto) records; i18n added. app check clean, biome-clean. Created in review/.
- `2026-06-25` — Follow-up: a Verbucht tx now also shows the booking's account-pick confidence chip (Sicher/Mittel/Unsicher, via bookingConfByInvoice → [[0080]]); and dropped the redundant bank-balance (Saldo) column from the table. app check clean, biome-clean.

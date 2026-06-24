---
title: Invoice ↔ transaction reconciliation (match + invoice-match vibe)
summary: After an invoice is extracted (0064), query the user's stored `tx` table (0065) and match the paying transaction (amount-required, counterparty/sign raise confidence); persist a `match` record and render an invoice-match vibe — extracted invoice left, matched transaction + verdict right.
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [bookkeeping, reconciliation, match, persistence, vibe]
goal: "`bun test libs/aven-vibes/tests/invoice-match.test.ts` exits 0 (amount-required match; counterparty → high / amount-only → medium / no amount → null; match record validates against MATCH_SCHEMA) AND `grep -R \"bestInvoiceMatch\\|MATCH_SCHEMA\" libs/aven-vibes/src/vibes/invoice/match.ts` matches AND `grep -R \"matchInvoiceAgainstTx\\|invoice-match\" libs/betterauth/src/ai.ts` matches AND `grep -R \"invoice-match\" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/MainnetVibes.svelte` matches AND `bun run check` exits 0"
---

# Invoice ↔ transaction reconciliation

## Context

Closes the bookkeeping pipeline loop: **[[0063]]** classify → **[[0064]]** extract+compare →
**[[0065]]** tx fan-out → **0066 (this)** reconcile. After an invoice is extracted, find the bank
transaction that paid it and show them side by side.

**Real goal:** know whether an invoice has been paid — surface the paying transaction next to the
invoice, and persist the link so it's queryable.

### Decisions

- **Match heuristic** — amount is MANDATORY: `|tx.amount| ≈ invoice gross total` (invoice_total →
  total_outstanding → gross), within €0.01. Among amount matches, **counterparty-name overlap**
  (vendor tokens in the tx counterparty/description) + an **outgoing (negative) sign** raise the
  score. Confidence = `high` (amount + counterparty) / `medium` (amount only) / no amount → no match.
- **Query the tx table** — the matcher reconciles against the user's stored `tx` rows (0065), read
  via `executeDataTool list 'tx'`. So a statement must be extracted first for a match to exist.
- **Persist** — a `match` schema/table row per invoice (matched or unmatched), Ajv-validated
  (MATCH_SCHEMA): invoice ref + number/total/vendor, tx dedup_key/amount/date/counterparty,
  confidence, reasons, status.
- **UI** — `invoice-match` vibe: extracted invoice (generic doc-view) LEFT, matched transaction +
  verdict (doc-view) RIGHT. Emitted in the chat turn after the invoice's doc-compare card.

Out of scope: many-to-one / split-payment matching; manual match override UI; a transactions ledger
view; matching bank statements against invoices in the other direction.

## Goal

After an invoice is extracted, its paying transaction is found in the `tx` table, a `match` record
is persisted, and an invoice-match card shows invoice (left) ↔ transaction (right).

**Completion condition** (identical to frontmatter `goal`):

> `bun test libs/aven-vibes/tests/invoice-match.test.ts` exits 0 (amount-required match; counterparty → high / amount-only → medium / no amount → null; match record validates against MATCH_SCHEMA) AND `grep -R "bestInvoiceMatch\|MATCH_SCHEMA" libs/aven-vibes/src/vibes/invoice/match.ts` matches AND `grep -R "matchInvoiceAgainstTx\|invoice-match" libs/betterauth/src/ai.ts` matches AND `grep -R "invoice-match" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/MainnetVibes.svelte` matches AND `bun run check` exits 0

## Approach

`libs/aven-vibes/src/vibes/invoice/match.ts` (pure, `@avenos/aven-vibes/match`): `invoiceTotal`,
`bestInvoiceMatch(invoice, txs)`, `MATCH_SCHEMA`/`MatchRecord`, `buildMatchRecord`, and
`mapMatchToView` (right panel). In `ai.ts`, after an invoice is stored, `matchInvoiceAgainstTx`
lists `tx`, runs `bestInvoiceMatch`, persists a `match` row, and the executor emits an
`invoice-match` vibe `{ invoice, match, currency }`. Client `InvoiceMatchVibe.svelte` renders
`mapInvoiceToView(invoice)` (left) + `mapMatchToView(match)` (right) via the shared doc-view; wired
into MainnetChat stream + MainnetVibes nav.

## Acceptance criteria

- [x] `bun test libs/aven-vibes/tests/invoice-match.test.ts` exits 0 — 4 pass (high/medium/null + MATCH_SCHEMA validation of matched & unmatched). All 4 vibe suites: 19 pass.
- [x] matcher module — `grep -R "bestInvoiceMatch\|MATCH_SCHEMA" libs/aven-vibes/src/vibes/invoice/match.ts` matches.
- [x] server reconcile + vibe — `grep -R "matchInvoiceAgainstTx\|invoice-match" libs/betterauth/src/ai.ts` matches (queries tx, persists match, emits vibe).
- [x] UI wired — `grep -R "invoice-match" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/MainnetVibes.svelte` matches; `InvoiceMatchVibe.svelte` exists.
- [x] `bun run check` exit 0; lib tsc 0; app svelte-check only the pre-existing `__APP_VERSION__`; all 0066 files biome-clean.
- [ ] (Review, in-app) Extract a bank statement (→ tx), then an invoice whose total matches a tx → invoice-match card shows the paying transaction; a `match` data_value row exists.

## Verification

```bash
bun test libs/aven-vibes/tests/invoice-match.test.ts
grep -R "bestInvoiceMatch\|MATCH_SCHEMA" libs/aven-vibes/src/vibes/invoice/match.ts
grep -R "matchInvoiceAgainstTx\|invoice-match" libs/betterauth/src/ai.ts
grep -R "invoice-match" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/MainnetVibes.svelte
bun run check
```

## Hand-off

```
/aven-review 0066
```

## Progress log

Newest entry first.

- `2026-06-25` — Matching upgraded to **dynamic + currency-aware** (the rigid exact-EUR heuristic failed on a USD Cursor invoice vs a EUR Finom statement). (1) `tx` now captures FX fields `original_amount`/`original_currency`/`exchange_rate` (schema + normalizer); (2) `bestInvoiceMatch` matches the booked amount OR the FX `original_amount` when currencies differ; (3) NEW `matchInvoiceLLM` in ai.ts — a focused `pick_match` tool call that reasons over the invoice + tx candidates (cross-currency, FX fees, vendor naming, date) and picks the paying tx; `bestInvoiceMatch` is the fallback. `mapMatchToView` shows the Originalbetrag. New cross-currency test → 20/20 pass; lib tsc 0; biome-clean. Auth server restarted (--watch).
- `2026-06-25` — Built directly (clear follow-on). Pure `match.ts` (amount-required matcher + MATCH_SCHEMA + buildMatchRecord + mapMatchToView), `@avenos/aven-vibes/match`; `matchInvoiceAgainstTx` in ai.ts queries the `tx` table, persists a `match` row, and emits the `invoice-match` vibe after the invoice doc-compare card; `InvoiceMatchVibe.svelte` (invoice left, tx+verdict right) wired into MainnetChat + MainnetVibes (+ i18n). Test 4/4 (19/19 across all suites), lib tsc 0, biome-clean, app check only pre-existing error. Heuristic flagged for tuning (amount-exact + counterparty/sign). Created in review/.

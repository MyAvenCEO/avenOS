---
title: Finance verticals end-to-end on Lojban predications — trigger + extract the bank statement, reconcile, book; retire flat tx/match/booking
summary: >
  The invoice vertical is now 100% on Lojban x1–x5 predications (board 0097). The FINANCE verticals are
  the last legacy holdouts on flat board-0064 JSON schemas — `tx` (bank transactions), `match`
  (invoice↔tx reconciliation), `booking` (SKR04 posting / BWA) — and worse, the bank-statement pipeline
  DOESN'T EVEN RUN: an upload triggers `doc-ingest` (store + classify) and STOPS after Classify (the Runs
  view proves it) because the `run_skill` router only knows `"invoice"`/`"doc-ingest"` and there is no
  classify-kind → flow routing, so the `kontoauszug` flow (which holds the rich `capture-bank` extract) is
  dead config that never fires. This card takes the whole finance chain end-to-end on predications, one
  card (user's call): (1) TRIGGER — a classified bank statement actually runs the bank extract + enrich;
  (2) FULL BANK FIDELITY — every flat `tx` field (currency, running balance, value-vs-booking date, FX:
  original amount/currency, exchange rate, fee %) becomes a faithful predicate/place, not just the
  amount/payee/date/desc that board-0097 v1 stores; (3) RECONCILE — invoice↔transaction match on a
  predicate (mapti); (4) BOOK — the SKR04 posting on predications (cmima + the double-entry); (5) RETIRE
  the flat `tx`/`match`/`booking` schemas + repoint the Transactions / BWA / reconciliation vibes.
  aven-db CRDT untouched. See [[all-dynamic-data-is-predications]].
owner: claude
created: 2026-07-01
updated: 2026-07-01
goal: >
  The bank-statement → reconcile → book chain runs end-to-end on pure Lojban predications, with the flat
  `tx`/`match`/`booking` schemas retired. Proven by —
  (1) TRIGGER: a bank-statement upload runs the FULL bank flow, not just ingest+classify — a live run's
  trace (Runs view / `flow_run`) shows the `capture-bank` extract + enrich steps executing after classify
  (it no longer stops at Classify); the routing is deterministic (classify kind → the bank flow, or the
  `run_skill` router offers + selects the bank skill).
  (2) FULL BANK FIDELITY: an audit script maps EVERY field of the legacy flat `tx` schema
  (`libs/aven-vibes/src/vibes/bank-statement/tx.ts`) to a faithful transaction predicate/place — currency,
  running balance, value_date + booking_date, original_amount + original_currency, exchange_rate,
  fx_surcharge, fee_percent — and prints 0 unmapped fields; every new predicate passes the board-0097
  completeness+correctness gate (all its gismu's places, right kinds).
  (3) RECONCILE: an invoice↔transaction match is a predication (best-fit gismu, e.g. `matched`≡mapti:
  x1 the transaction, x2 the invoice, x3 the property/confidence); creating a match links them and drives
  the tx "belegt" status from predications.
  (4) BOOK: the SKR04 posting is predications (booked≡cmima for the account membership + the double-entry
  Soll/Haben amounts as jdima places); the BWA / FinanceVibe P&L reads bookings from predications.
  (5) RETIRE FLAT: `rg "TX_SCHEMA|MATCH_SCHEMA|BOOKING_SCHEMA|schema: '(tx|match|booking)'" libs app` is
  empty; a migration drops the flat `tx`/`match`/`booking` data_schema rows; the Transactions, BWA, and
  reconciliation vibes read the predication types.
  (6) EXTRACTION FIDELITY (ported from the reference): the invoice + bank extract nodes use the legacy
  OCR reference prompts + doctype schemas + the two-stage (header → doctype) pass, so extraction is
  correct AND complete. REGRESSION — the Cursor invoice (`ocr/…/04_Cursor_Invoice-6199869E-0059.pdf`)
  extracts total **100.11**, number **6199869E 0059**, dates **2026-02-03**, all 6 line items with their
  exact amounts (1186.56 / 654.87 / 24.19 / 600.66 / 6.50 / 0.45), both parties complete (Anysphere Inc.
  + München, emails, EIN/VAT), and the reverse-charge note — no hallucinated/rounded numbers.
  (7) ONE FLOW-SKILL ARCHITECTURE: the bank statement is a first-class, triggerable flow SKILL —
  "Bank Statement Processing" (ingest → extract → enrich → …) exactly like "Invoice Processing" — not
  dead `kontoauszug` config; both share the same skill/flow shape + the shared extract/enrich actors.
  (8) GREEN: `bun run check` (betterauth) + `bun --bun x svelte-check` (app) + the aven-vibes /
  aven-ontology suites exit 0; a live bank-statement run imports transactions, a match sets belegt, and a
  booking shows in the BWA — all from predications. aven-db CRDT + the data_schema/data_value engine untouched.
---

## Context

**Where we are.** Board 0097 put the invoice vertical wholly on Lojban x1–x5 predications (company /
person / invoice / transaction composite types) and the north star is recorded: **all dynamic user data
must be pure predications, zero legacy flat-JSON data_schema types** ([[all-dynamic-data-is-predications]]).
The invoice flow ingests → classifies → extracts → enriches (both parties) → persists, all on predications.

**The finance verticals are the last flat holdouts** — three board-0064 JSON schemas:
- `tx` (`libs/aven-vibes/src/vibes/bank-statement/tx.ts`) — bank transactions.
- `match` — invoice↔transaction reconciliation links.
- `booking` — SKR04 double-entry postings feeding the BWA.

**And the bank pipeline is not even wired to run.** Uploading a Kontoauszug triggers the `doc-ingest`
skill (store + classify) and **stops after Classify** (the Runs view shows the trace halting at the
Classify node with `kind: "doctype-bank_statement"`). Root cause, two links missing:
- the `run_skill` tool description (`libs/aven-vibes/src/tools.ts:112`) only offers the model
  `"invoice"` or `"doc-ingest"` — it is never told the bank skill exists;
- there is no classify-kind → flow routing, so the `kontoauszug` flow (ingest → map-brain → review,
  carrying the rich `capture-bank` extract schema + prompt) is **dead config that never fires**.
Board 0097 added a bank branch to `enrichAddressbook` + a `TransactionsVibe` on predications, but they
can never execute because the extract before them never runs.

**board-0097 v1 is also lossy.** Even when it runs, the `transaction`≡pleji v1 stores only
amount/payee/description/date — it drops currency, running balance, the value-vs-booking date split, and
the whole FX cluster (original amount/currency, exchange rate, surcharge, fee %) the extract schema
captures. Per the invoice_doc directive, a migration must preserve **100 %** of the flat field fidelity.

**Extraction quality is broken, and the fix is a KNOWN-GOOD reference.** A live Cursor invoice extracted
catastrophically wrong: total **1,88 USD** where the PDF says **100,11 $**; number `6199869E*0061` where
it is `6199869E 0059`; dates off by 2 days; the mid-month line **1.28667** where it is **1.186,56 $**;
line-item call counts + amounts wrong; both parties missing city/country/email/phone + the vendor's legal
entity (`Anysphere, Inc.`, US EIN) + the reverse-charge note — all dropped. Two pipeline bugs already
found + patched interim: the extract turn literally said *"Classify this document."* (wrong task), and the
prompt lacked German number-format + "total = final Summe" rules. But the real cure is the **legacy OCR
project** at `/Users/samuelandert/Documents/Development/ocr/` (`config/{prompts,doctypes,actors}`), where
invoice + Kontoauszug extraction "worked perfectly" on the SAME `gemma4-31b` model — because of the
PIPELINE + PROMPT + SCHEMA, not the model: a **two-stage** pass (a `DOCUMENT_HEADER` routing/header
extraction, then a **doctype-specific** `extract_invoice` / `extract_bank_statement` pass), and much
richer, battle-tested prompts (semantic label→field mapping, completeness, VAT tax_breakdown, DRY
titles, banking/SEPA blocks, org imprint, FX-column disambiguation for card statements). avenOS today has
ONE thin single-pass generic `extract_document` — that is why dense figures + full parties are lost.

**Why (the goal behind the task).** Finish the "zero flat schemas" north star for finance so the entire
document→extract→enrich→reconcile→book chain — and the features on top (Transactions list, BWA/P&L,
Offene-Posten reconciliation) — run off ONE predication source of truth, not a flat store that drifts
from the ontology; AND extraction is trustworthy (correct totals/numbers/parties), by porting the proven
reference pipeline. This unlocks a coherent, queryable, correct finance layer and removes the last board-0064 debt.

## Load-bearing decisions (confirmed / to confirm at build)

- **Extraction = port the legacy OCR reference (user's directive).** The reference at
  `/Users/samuelandert/Documents/Development/ocr/config/` is the SSOT for the extract PROMPTS +
  doctype SCHEMAS + the pipeline SHAPE. Adopt: (a) the **two-stage** extraction — a header/routing pass
  (`extract_doc_header`) then a **doctype-specific** extract pass, not one generic single pass; (b) the
  reference `prompts/extract_invoice.json` + `prompts/extract_bank_statement.json` (+ `extract_doc_header`)
  verbatim-in-spirit as the avenOS extract-node system_prompts; (c) the reference `doctypes/invoice.json`
  + `doctypes/bank_statement.json` as the schemas. Regression: the Cursor invoice extracts correctly.
- **Bank flow MIRRORS the invoice flow EXACTLY (user's directive).** "Bank Statement Processing" is
  structurally identical to "Invoice Processing" — same ingest→extract→enrich shape, a doctype-specific
  bank extract actor/prompt/schema paralleling the invoice one, feeding the same enrich→predication path.

- **Scope: ONE card, everything** (user chose this over slicing) — trigger + bank fidelity + reconcile +
  book + retire flat, built in checkpointed steps (it is large; stop-and-look after each numbered step).
- **Fidelity: FULL** (user chose) — every flat `tx` field maps to a faithful predicate/place; gismu
  chosen by reading the `.claude/skills/ontology` lexicon (never forced 1:1, never a value in a ref slot).
- **Routing approach** (confirm at build): deterministic classify-kind → flow (a unified doc-processing
  flow that branches on the `kind`≡tcita output: invoice → `capture`, bank_statement → `capture-bank`)
  is preferred over teaching the LLM router a new skill id (fragile). Needs the flow engine to route on
  a classified value — verify the engine supports it, else fall back to the router + a kind check.
- **Gismu mappings** (research at build via the ontology skill; candidates): match ≡ **mapti** (x1 fits
  x2 in property x3); currency ≡ **rupnu**-family; running balance / FX — TBD from the lexicon; the SKR04
  double-entry keeps booked ≡ **cmima** (account membership) + **jdima** for the Soll/Haben amounts.

## Approach (for the build — not exhaustive)

0. **Port the reference extraction (prompts + schemas + two-stage pipeline).** From
   `/Users/samuelandert/Documents/Development/ocr/config/`: seed the avenOS invoice (`capture`) + bank
   (`capture-bank`) extract nodes with the reference `prompts/extract_invoice.json` +
   `prompts/extract_bank_statement.json` system prompts and the reference `doctypes/invoice.json` +
   `doctypes/bank_statement.json` schemas; add the header/routing pre-pass (`extract_doc_header`) so
   extraction is two-stage per doctype. Regression proof: the Cursor invoice extracts total **100,11**,
   number **6199869E 0059**, dates **2026-02-03**, all 6 line items with exact amounts, both parties
   complete (Anysphere/München + emails), reverse-charge flagged. (Checkpoint 1 already landed the
   trigger + the interim prompt/user-turn fixes; this step replaces those with the reference SSOT.)
1. **Trigger the bank flow.** ✅ (checkpoint 1) — `run_skill` offers `kontoauszug`; `humanReview` no-op
   lets the flow complete; a Run shows `capture-bank` extract+enrich after classify.
2. **Bank-statement predicate fidelity.** Extend the transaction bundle (aven-vibes predicate vocab +
   the TRANSACTION_SPEC) with faithful predicates/places for currency, running balance, value/booking
   dates, and the FX cluster; strengthen the audit to prove 0 unmapped flat-`tx` fields; keep the 0097 gate green.
3. **Enrich → full transactions.** Update the bank branch of `enrichAddressbook` to populate the new places.
4. **Reconcile.** A `matched`≡mapti predicate + the actor that links an invoice to a transaction; the tx
   "belegt" status derives from it.
5. **Book.** The SKR04 posting on predications (cmima + jdima double-entry); BWA reads bookings from predications.
6. **Retire flat.** Migration drops `tx`/`match`/`booking` data_schema rows; repoint Transactions / BWA /
   reconciliation vibes + the `book` flow actors (`matchInvoiceAgainstTx`, `bookInvoice`) to predications.

## Acceptance criteria

- [ ] Extract nodes seeded from the reference (`ocr/config/prompts` + `doctypes`), two-stage per doctype;
      the Cursor invoice extracts correctly (total 100.11, number 0059, all lines + full parties + reverse-charge).
- [ ] A bank-statement upload's live run trace shows extract + enrich after classify (no longer stops at Classify).
- [ ] Audit script: 0 flat-`tx` fields unmapped to a transaction predicate/place; the 0097 gate passes for the new predicates.
- [ ] A match predication links an invoice↔transaction and drives belegt; a booking predication shows in the BWA.
- [ ] `rg "TX_SCHEMA|MATCH_SCHEMA|BOOKING_SCHEMA|schema: '(tx|match|booking)'" libs app` is empty; migration drops the flat schemas.
- [ ] `bun run check` + `bun --bun x svelte-check` + aven-vibes/aven-ontology suites exit 0; live bank run imports transactions + BWA/reconciliation render from predications.

## Verification

```sh
# routing: a bank run executes the bank extract (trace on the samuel Neon branch)
#   SELECT trace FROM flow_run WHERE ... (steps include capture-bank/extract + enrich)
bun -e '…audit tx.ts fields vs the transaction predicate bundle…'   # 0 unmapped
bun test libs/aven-vibes/tests/predicate.test.ts                     # gate green
rg "TX_SCHEMA|MATCH_SCHEMA|BOOKING_SCHEMA|schema: '(tx|match|booking)'" libs app   # empty
cd libs/betterauth && bun run check
cd app && bun --bun x svelte-check --tsconfig ./tsconfig.json
```

## Out of scope

- New doctypes beyond invoice + bank statement (contract extraction stays as-is).
- The invoice vertical (done in 0097) — only reused here for reconciliation.

## Progress log

- 2026-07-01 — **Re-discovered (extraction quality + reference).** A live Cursor invoice extracted badly
  wrong (total 1.88 vs 100.11; wrong number/dates/line amounts; incomplete parties). Found two pipeline
  bugs (extract turn said "Classify this document."; no German-number/total rules) and patched them
  interim. User directed: port the legacy OCR reference (`/Users/samuelandert/Documents/Development/ocr/
  config/{prompts,doctypes,actors}`) — its two-stage (header → doctype) pipeline + battle-tested
  invoice/bank prompts + schemas — as the extraction SSOT, and mirror the bank flow EXACTLY on the
  invoice flow. Added the Cursor invoice as the extraction regression. Moved build → discover to re-spec.
- 2026-07-01 — **Build checkpoint 1 (trigger + extraction).** The bank statement is now a triggerable
  flow skill: the `run_skill` router (`libs/aven-vibes/src/tools.ts`) offers `"kontoauszug"` for
  bank/account/credit-card statements (the model picks it by vision), and a no-op `humanReview` actor
  (`skills-run.ts`) lets the `kontoauszug` flow (ingest → extract → enrich → review) complete cleanly
  since the sync runner has no HITL yet. Migration 0040 prepends a strong PARTY COMPLETENESS directive
  to BOTH the invoice (`capture`) + bank (`capture-bank`) extract prompts so every printed party field
  (full address, email, phone, tax ids, IBAN, imprint) is filled — the schema already had the fields.
  Applied to the samuel branch; betterauth `check` green. **Remaining:** full transaction fidelity
  (currency/balance/FX predicates), reconciliation (mapti), SKR04 booking (cmima), retire flat
  tx/match/booking — checkpoints 2–4.
- 2026-07-01 — Discovered. Confirmed via the Runs view that a bank upload stops after doc-ingest+classify
  (the `kontoauszug` flow never fires — the `run_skill` router only offers invoice/doc-ingest and there is
  no kind→flow routing). Scope = one card / full fidelity (user). Measurable goal = trigger + fidelity +
  reconcile + book + retire flat, all provable from command/trace output. Promote to discover/.

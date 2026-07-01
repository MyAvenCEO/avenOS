---
title: Strip avenOS back to a resilient core — delete finance / bank / booking / enrich / addressbook / planner
summary: >
  The finance program (board 0098) + the addressbook/enrich/booking machinery (0064–0066, 0082, 0097's
  finance half) became a complexity sink and hit a dead end ("Sackgasse") — bank-statement extract + brain
  + processing flows, the bookkeeping (SKR04 double-entry) skill, the BWA/reconcile/transaction/booking
  verticals, the enrich actor + contact card, the addressbook vibe, the project-planner skill. First
  principles (`.cursor/rules/first-principles.mdc` + `compact-simplify-consolidate.mdc`): don't optimize
  what shouldn't exist — DELETE it. Strip the app to its irreducible resilient core and re-introduce
  verticals later, deliberately. KEEP: chat, todos, and invoice extraction as SHOW-ONLY (ingest → classify
  → extract → render the extracted invoice, NO persistence/enrich); the Lojban ontology types
  todos+company+person+invoice+document (defined, just not auto-written); the SKR04 reference JSON (skr.ts)
  for later. 100% migration, no shims, no dead code left behind. aven-db CRDT untouched.
owner: claude
created: 2026-07-01
updated: 2026-07-01
goal: >
  avenOS is stripped to chat + todos + invoice-extract-show-only, with the finance/bank/booking/enrich/
  addressbook/planner surface fully deleted (no back-compat shims, all call sites migrated). Proven by —
  (1) FLOWS: a migration drops `book`, `capture-bank`, `kontoauszug`, `project-planner` from the `flow`
  table, and rewrites `capture` to end at `extract` (the `enrich` node removed); `SELECT id FROM flow`
  returns only `doc-ingest`, `capture`, `invoice` (+ any kept). Their seed migrations no longer run stale
  config.
  (2) PREDICATE TYPES: `transaction` is dropped from `predicate_type`; the transaction vocab
  (transaction/dated/value_dated/balance/booked/matched) + `TRANSACTION_SPEC` are deleted from the code;
  the board-0097 completeness+correctness gate still exits 0 for the remaining predicates.
  (3) VIBES: `AddressbookVibe`, `FinanceVibe`, `TransactionsVibe`, `InvoiceBookingVibe`, `InvoiceMatchVibe`,
  `OpenItemsVibe`, `InvoiceCreateVibe` are deleted; `StepVibe`'s enrich/contact + finance branches are gone;
  no `MainnetChat`/`MainnetVibes` dispatch references them. The invoice flow renders the extracted invoice
  via `InvoiceDocVibe` only.
  (4) ACTORS/SKILLS/TOOLS: `enrichAddressbook` + `humanReview` deleted from `skills-run`; the addressbook +
  outgoing-invoice chat tools (`query_contacts`/`upsert_contact`/`set_my_company`/`create_invoice`) removed
  from `ai.ts`; `rg "enrichAddressbook|AddressbookVibe|FinanceVibe|TransactionsVibe|BWA|matchInvoice|bookInvoice"
  libs app` is empty (except board docs).
  (5) KEEP: `skr.ts` (SKR04 reference) still present; `company`/`person`/`invoice`/`document` predicate
  types still registered (ontology preserved).
  (6) GREEN + RESILIENT: `bun run check` (betterauth) + `bun --bun x svelte-check` (app) + the aven-vibes /
  aven-ontology / aven-skills suites exit 0; a live invoice upload shows the extracted invoice, todos +
  chat work. Net LOC across the deleted surface drops by thousands (report the diffstat). aven-db untouched.
---

## Context

**Where we are.** A long build push (board 0098 + the finance half of 0097 + the legacy 0064–0066/0082
verticals) accreted a huge, fragile machinery: the bank-statement pipeline (extract + "map brain" +
processing flows `capture-bank`/`kontoauszug`), the bookkeeping SKR04 double-entry `book` flow, the
BWA/reconcile/transaction/booking predications + vibes, the `enrichAddressbook` actor + its contact card,
the `AddressbookVibe`, and the `project-planner` skill. Each fix made the next thing worse — a dead end.

**First principles (the repo's own rules).** `first-principles.mdc`: *"strip out as much indirection as
you can… lean into massive simplification while keeping functionality intact."* `compact-simplify-
consolidate.mdc`: *"Don't optimize what shouldn't exist… Should this exist? → NO: DELETE IT… 100% migrate,
no backwards-compatibility layers, no deprecation shims."* Applied here: the finance/bank/booking/enrich/
addressbook/planner surface **shouldn't exist right now** — it outran its value. Delete it cleanly, keep
an irreducible resilient core, and re-introduce verticals later, deliberately, one measurable card each.

**The irreducible core (confirmed with the user).** Chat + Todos + **invoice extraction SHOW-ONLY**:
upload → `doc-ingest` (store + classify) → `capture` (extract) → render the extracted invoice
(`InvoiceDocVibe`). No enrich, no persistence, no addressbook, no finance. The Lojban ontology types
`todos + company + person + invoice + document` stay **defined** (0097's ontology is preserved for
deliberate reuse), just not auto-written. The **SKR04 reference JSON** (`skr.ts`) is kept for later
reintroduction of bookkeeping.

**Why (the goal behind the task).** Restore resilience + a clean base. A small core that always works
beats a broad one that drifts. This unblocks future verticals by giving them a stable, comprehensible
foundation instead of a tangled one.

## Delete list (100% migration, no shims)

- **Flows:** `book`, `capture-bank`, `kontoauszug`, `project-planner`; rewrite `capture` → extract-only
  (drop the `enrich` node). Remove/neutralize their seed migrations.
- **Predicate type + vocab:** `transaction` (predicate_type) + `TRANSACTION_SPEC` + the vocab
  `transaction/dated/value_dated/balance/booked/matched` + the `idkind-currency`/FX discriminators.
- **Actors:** `enrichAddressbook`, `humanReview` (skills-run).
- **Vibes (app):** `AddressbookVibe`, `FinanceVibe`, `TransactionsVibe`, `InvoiceBookingVibe`,
  `InvoiceMatchVibe`, `OpenItemsVibe`, `InvoiceCreateVibe`; `StepVibe` enrich/contact + finance branches.
- **aven-vibes modules:** `bank-statement/`, `bookkeeping/` (+ `contract/` if unused); the flat
  `tx`/`match`/`booking`/`invoice-doc` schemas + `booking`/`match`/`tx` helpers; their tests.
- **ai.ts chat tools:** `query_contacts`, `upsert_contact`, `set_my_company`, `create_invoice` (+ the
  now-dead flat `contact`/`invoice_doc` machinery: `enrichAddressbookFromDoc`, `partiesFromDoc`, etc.).
- **A migration** drops the retired `flow` + `predicate_type` + `data_schema`/`data_value` rows.

## KEEP

- Chat, Todos (`TodosVibe`, the todos flow/predications), `doc-ingest` + `invoice` (capture) flows.
- `InvoiceDocVibe` + `DocCompareVibe` + `BookkeepingVibe` (classify card) + `StepVibe` (ingest/classify/extract).
- Ontology types `todos/company/person/invoice/document` + their vocab/specs (defined, not auto-written).
- `skr.ts` (SKR04 reference JSON) — untouched, for later.
- aven-db CRDT + the data_schema/data_value engine.

## Acceptance criteria

- [ ] `SELECT id FROM flow` = only the kept flows; `capture` has no `enrich` node.
- [ ] `transaction` gone from `predicate_type`; TRANSACTION_SPEC + finance vocab deleted; 0097 gate green.
- [ ] The listed vibes/actors/tools are deleted; `rg` for their names in `libs`/`app` is empty (except board docs).
- [ ] A live invoice upload renders `InvoiceDocVibe` (show-only); todos + chat work.
- [ ] `bun run check` + `bun --bun x svelte-check` + aven-vibes/aven-ontology/aven-skills suites exit 0.
- [ ] Diffstat shows a large net deletion; `skr.ts` + kept ontology types remain.

## Verification

```sh
rg "AddressbookVibe|FinanceVibe|TransactionsVibe|enrichAddressbook|TRANSACTION_SPEC|matchInvoice|bookInvoice|kontoauszug|project-planner" libs app | rg -v 'board/'   # empty
bun test libs/aven-vibes/tests/predicate.test.ts     # gate green
cd libs/betterauth && bun run check
cd app && bun --bun x svelte-check --tsconfig ./tsconfig.json
# DB: SELECT id FROM flow;  SELECT type FROM predicate_type;
```

## Out of scope / follow-on

- Re-introducing bank statements / bookkeeping / reconciliation later — deliberate, one measurable card
  each, on the preserved SKR04 reference + ontology. Not now.
- Killing the flat `contact`/`invoice_doc` schemas is subsumed here (deleted with their tools).

## Progress log

- 2026-07-01 — Discovered. User hit a dead end on the finance/bank/booking build; directed a radical strip
  per the repo's first-principles + compact-simplify rules. Confirmed core = chat + todos + invoice
  show-only; ontology keeps todos+company+person+invoice+document; SKR04 reference kept. Measurable goal =
  flows/types/vibes/actors/tools deleted (rg empty, DB rows dropped), core works, suites green, large net
  LOC deletion. Supersedes the finance parts of 0097 + all of 0098.

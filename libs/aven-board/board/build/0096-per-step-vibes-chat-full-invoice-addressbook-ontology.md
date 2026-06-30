---
title: Per-step vibes complete in chat (one renderer) + full invoice card + classify badge + addressbook on the new ontology
summary: Four issues seen live running invoice processing, all in the rendering/wiring layer. (1) The CHAT only shows the classify card — its inline {#if message.vibe} dispatch has branches for bookkeeping/doc-compare/… but NONE for ingest/invoice/contact, so the ingest/extract/enrich step cards stream but never render. Fix by delegating per-step cards to the SAME shared StepVibe the Runs view uses (the folded board-0094 unification) — one renderer, no drift. (2) The classify card shows "Sonstiges" even though the data is kind:"invoice" — BookkeepingVibe reads a stale `data.docType` field; the actual field is `kind`. (3) The extract step's invoice card is a compact stub — restore the FULL original invoice vibe view (DocCompareVibe, board 0064: the document preview + extracted fields). (4) The addressbook is empty after a run — AddressbookVibe + the query_contacts tool read the OLD `contact` data_schema, but enrichAddressbook now writes the NEW `company`/`person` ontology types (board 0092/0093); rewire the addressbook to read company+person predications so the enriched vendor (+ its Ansprechpartner) actually shows. App + chat tool only; the ontology data + aven-db untouched.
owner: claude
created: 2026-06-30
updated: 2026-06-30
goal: The invoice-processing flow's per-step vibes render correctly + completely, and enriched contacts land in the addressbook on the new ontology. Proven by — (1) chat delegates per-step vibe cards to the SAME shared `StepVibe` as Runs (`rg "StepVibe" app/src/lib/shell/MainnetChat.svelte` matches; the inline per-step card branches `message.vibe === 'bookkeeping'|'doc-compare'|'invoice-match'|'invoice-booking'` are gone — only full-page dashboard vibes remain), so a chat invoice run shows ALL four cards (ingest/classify/extract/enrich); (2) the classify card reads `kind` not the stale `docType` (`rg "data.kind" app/src/lib/shell/BookkeepingVibe.svelte` matches) — a `{kind:'invoice'}` card shows 'Rechnung', not 'Sonstiges'; (3) the extract step renders the FULL invoice view — StepVibe's `invoice` branch uses `DocCompareVibe` (board 0064), not the compact card (`rg "DocCompareVibe" app/src/lib/shell/StepVibe.svelte` matches inside the invoice branch); (4) `query_contacts` + `AddressbookVibe` read the new ontology — they list `company` + `person` (not the old `contact` data_schema), so after an invoice run the enriched company (+ Ansprechpartner) appears: a headless `query_contacts`-equivalent returns the ontology company/person via data_crud, and `AddressbookVibe` queries company+person; (5) `bun --bun x svelte-check` (app) + `bun run check` (betterauth) exit 0. aven-db + data_schema/data_value untouched.
---

## Context

Running invoice processing end-to-end (Ingest → Classify → Extract → Enrich) surfaced four rendering/
wiring gaps — the data is correct, the presentation isn't:

1. **Chat shows only the classify card.** Per-step vibes stream (board 0091: `run_skill` emits an
   `aven_vibe` per step), but `MainnetChat.svelte` renders them via its OWN inline
   `{#if message.vibe === …}` dispatch, which has branches for `bookkeeping`/`doc-compare`/`invoice-match`/
   `invoice-booking`/`tx`/… but **none for `ingest`, `invoice`, `contact`** — so those three cards never
   appear. Two copies of the card logic (chat + `StepVibe`) have drifted.
2. **Classify badge wrong.** The step DATEN is `{ kind: "invoice", title, summary }`, but `BookkeepingVibe`
   reads `data.docType` (which is undefined) → falls to `other` → shows "Sonstiges". A field mismatch.
3. **Extract card too compact.** Board 0094 gave the `invoice` step a small summary card; the original
   full invoice vibe view (`DocCompareVibe`, board 0064 — doc preview + extracted fields) is what's wanted.
4. **Addressbook empty.** `AddressbookVibe` + the chat `query_contacts` tool read the OLD `contact`
   data_schema (board 0082). But `enrichAddressbook` (board 0093) writes the NEW `company`/`person`
   ontology composite types. So "show me the addressbook" → "No contacts yet" while the enriched company
   sits in the new tables. Needs rewiring to the new lojban/ontology architecture.

**Decisions (confirmed):** ONE card, all four; CHAT unifies to the shared `StepVibe` (one renderer).

See [[flow-engine-actor-model]], [[universal-predication-schema-0084]], [[avenos-brand-design-system]].

## Goal

**A step's card is rendered by one component everywhere, the cards show the right data, and the flow's
output (typed contacts) lands where the user looks for it (the addressbook).** The decision this
unlocks: the invoice flow is trustworthy end to end — what runs is what you see, in chat and in Runs,
and the enriched contact is actually in the addressbook.

**Completion condition:** *(identical to `goal:` — the five numbered proofs.)*

## Approach

- **Unify chat → StepVibe.** In `MainnetChat`, route per-step vibe MESSAGES through `<StepVibe vibe=…
  data=… />` (the same component the Runs view uses). Keep the full-page DASHBOARD vibes (todos/composer/
  tx/booking/bwa/addressbook/invoice-create — they self-fetch via `containerName`) behind a small
  `isDashboardVibe()` check, not a literal `message.vibe === 'x'` per-card chain. Delete the per-step card
  branches from chat.
- **Classify badge.** `BookkeepingVibe` reads `data.kind ?? data.docType` (back-compat); a `kind:'invoice'`
  card shows 'Rechnung'. Surface the title/summary the classify step already provides.
- **Full invoice card.** StepVibe's `invoice` branch renders `<DocCompareVibe data={vibeData} />` (the raw
  extraction has header/vendor/totals/statements — DocCompareVibe's expected shape), replacing the compact
  card. Keep the compact bits only if DocCompare needs a fallback.
- **Addressbook on the ontology.** Repoint `query_contacts` (ai.ts) + `AddressbookVibe` to list the new
  `company` + `person` composite types (via the `data_crud`/client `list`), mapping them into the existing
  contact-row shape (name, kind person/company, identifiers, channels). The enriched company (+ its
  Ansprechpartner via `represents`) then appears; a contact's Belege = invoices where `billed_by` = it.

**Out of scope (follow-on):** the addressbook Belege tab's full invoice list (link by `billed_by`) beyond
showing the contact exists; authoring these cards as DB vibe bundles (board 0095's follow-on); the other
dashboard vibes' migration; the bank-statement step cards.

## Steps (small, checkpointed)

1. **Unify chat → StepVibe** — per-step cards via `<StepVibe>`; dashboard vibes behind `isDashboardVibe`;
   remove the inline per-step branches. A chat invoice run shows all four step cards. **Checkpoint.**
2. **Classify badge** — `BookkeepingVibe` reads `kind`; `{kind:'invoice'}` → 'Rechnung'. **Checkpoint.**
3. **Full invoice card** — StepVibe `invoice` → `DocCompareVibe`. **Checkpoint.**
4. **Addressbook → ontology** — `query_contacts` + `AddressbookVibe` list company+person; the enriched
   company shows after a run. **Checkpoint.**
5. **Verify** — svelte-check + checks exit 0; the five proofs hold.

## Files to touch

- `app/src/lib/shell/MainnetChat.svelte` — delegate per-step vibes to `StepVibe`; `isDashboardVibe`.
- `app/src/lib/shell/StepVibe.svelte` — `invoice` branch → `DocCompareVibe`.
- `app/src/lib/shell/BookkeepingVibe.svelte` — read `kind`.
- `app/src/lib/shell/AddressbookVibe.svelte` — read company+person.
- `libs/betterauth/src/ai.ts` — `query_contacts` lists company+person from the ontology.
- `app/src/lib/data/client.ts` — a `listContacts`/company+person client helper if needed.

## Acceptance criteria

- [ ] `rg "StepVibe" app/src/lib/shell/MainnetChat.svelte` matches; the per-step `message.vibe === 'bookkeeping'|'doc-compare'|'invoice-match'|'invoice-booking'` branches are gone from MainnetChat.
- [ ] A chat invoice run shows all four step cards (ingest, classify, extract, enrich) — same components as Runs.
- [ ] `rg "data.kind" app/src/lib/shell/BookkeepingVibe.svelte` matches; a `{kind:'invoice'}` card renders 'Rechnung' (not 'Sonstiges').
- [ ] `rg "DocCompareVibe" app/src/lib/shell/StepVibe.svelte` matches inside the `invoice` branch (the full view, not the compact card).
- [ ] `query_contacts` returns the enriched `company` (+ `person`) from the ontology (headless `data_crud` list), and `AddressbookVibe` lists company+person — so the addressbook shows the contact after a run.
- [ ] `bun --bun x svelte-check` (app) + `bun run check` (betterauth) exit 0; aven-db + data_schema/data_value untouched.

## Verification

```bash
rg -n "StepVibe" app/src/lib/shell/MainnetChat.svelte
rg -n "message.vibe === 'bookkeeping'|'doc-compare'|'invoice-match'|'invoice-booking'" app/src/lib/shell/MainnetChat.svelte   # → gone
rg -n "data.kind" app/src/lib/shell/BookkeepingVibe.svelte
rg -n "DocCompareVibe" app/src/lib/shell/StepVibe.svelte
rg -n "company|person" libs/betterauth/src/ai.ts app/src/lib/shell/AddressbookVibe.svelte | head
(cd app && bun --bun x svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -3)
(cd libs/betterauth && bun run check)
# Live (auth server, .env.samuel): run an invoice in chat → all 4 step cards; "show addressbook" → the
#   enriched company appears; click Extract in Runs → the full invoice view.
```

## Hand-off

```
/aven-build 0096
```

## Progress log

Newest entry first.

- `2026-06-30` — Discovery. Four issues found live running invoice processing: chat renders only the
  classify card (its inline dispatch lacks ingest/invoice/contact branches); the classify card shows
  'Sonstiges' despite kind:'invoice' (BookkeepingVibe reads stale `docType`, not `kind`); the extract
  card is a compact stub (want the full DocCompareVibe, board 0064); and the addressbook is empty
  because AddressbookVibe + query_contacts read the OLD `contact` schema while enrich writes the NEW
  company/person ontology. User decisions: ONE card, all four; CHAT unifies to the shared StepVibe (one
  renderer, kills the drift — the folded board-0094 unification). Goal made measurable via rg
  wiring-proofs + a headless query_contacts returning the ontology company/person. Out of scope: the
  Belege invoice list, DB-vibe authoring of these cards (board 0095 follow-on). Created in discover/.

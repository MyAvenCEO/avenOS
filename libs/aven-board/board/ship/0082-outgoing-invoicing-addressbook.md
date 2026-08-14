---
title: Outgoing invoicing + addressbook — voice/text invoice authoring on a contacts foundation
summary: Create German-compliant OUTGOING invoices purely by text/audio prompt — auto-numbered (R/A/E-{contactId}-{seq}), VAT auto-calculated, versioned per state (Entwurf/Angebot/Rechnung), saved as JSON (synced /api/data) + PDF (HTML→print, private store). Built on a new contacts/addressbook (persons + companies) with deterministic short ids, an addressbook vibe (list + detail + attached-invoices tab), and Stammdaten onboarding (auto-extract the user's own company from the first ingested incoming invoice, HITL-confirmed). Reuses the invoice doctype JSON, the generic _doc view engine, the vibe/HITL infra, and the synced schema+value store.
owner: claude
created: 2026-06-25
updated: 2026-06-26
tags: [bookkeeping, invoicing, addressbook, vibe]
goal: "`bun run check` exits 0 (lib + app + auth typecheck + biome clean) AND `bun test libs/aven-vibes/tests/{file-ref,contact-id,invoice-number,invoice-totals}.test.ts` all exit 0 (content-hash deterministic + dedup path; short-id format+uniqueness; R/A/E-{id}-{seq} fortlaufend-per-(prefix,contact) + unique; VAT auto-calc per rate net→vat→gross) AND mainnet upload persists the source file to the content-addressed sparks/PRIVATE store + stamps file_hash into the JSON (grep the persist call in the mainnet drop/extract path) WHILE the testnet persistSparkFiles flow is unchanged (git diff touches no testnet file path) AND grep finds the new tools (upsert_contact, set_my_company, query_contacts, create_invoice, update_invoice, set_invoice_state, save_invoice_pdf) registered in CHAT_TOOLS + dispatched in libs/betterauth/src/ai.ts AND grep finds AddressbookVibe + InvoiceCreateVibe wired in MainnetChat.svelte + MainnetVibes.svelte AND CONTACT_SCHEMA + INVOICE_DOC_SCHEMA are exported from aven-vibes AND every Acceptance criterion below is checked"
---

# Outgoing invoicing + addressbook

## Context

We have an ingestion pipeline (classify → extract → reconcile → book, boards 0063–0081) for
**incoming** documents. This card adds the **outgoing** side: authoring German-compliant invoices by
voice/text, plus the **contacts/addressbook** foundation everything hangs off (customer ids power the
numbering; the user's own "Stammdaten" company powers seller fields; invoices attach to contacts).

Decided in discovery (load-bearing):
- **One card** (this 0082), structured into checkpointed phases A–F.
- **Contact short id**: random ~8-char base32 (Crockford, no ambiguous chars), minted ONCE per
  contact, collision-checked, stored. No name-derived dedup.
- **Invoice number**: `{PREFIX}-{contactShortId}-{seq}` with **per-customer running sequence** (seq is
  fortlaufend per (prefix, contact)); prefixes **R**=Rechnung, **A**=Angebot, **E**=Entwurf. No year
  separator.
- **PDF**: HTML invoice template → print-to-PDF via the Tauri/WebView print pipeline (reuses the
  brand/doc-view styling).
- **Storage (mainnet)**: source documents AND generated invoice PDFs are written to a
  **content-addressed file store on disk** at `…/.avenOS/<network>/…/sparks/PRIVATE/<sha256>` and
  referenced by **content hash** from the JSON — NOT stored in avenDB, NOT base64-inlined in /api/data.
  Same hash ⇒ same path ⇒ natural dedup. **All mainnet upload/ingest entry points** are updated to
  persist there (today MainnetChat persists nothing — only rasterizes for vision; real gap).
  **Testnet is untouched** — it keeps its existing avenDB `files`-table flow (`persistSparkFiles`).
- Structured JSON (contacts, invoice_doc, tx, booking, …) stays in the synced **/api/data**
  schema+value store, referencing files by their content hash.

UX: purely intent-driven (text or audio note). Missing required fields are **HITL'd back to the human
as free-form text/audio** (same answer channel as the rest of the chat).

## Goal

Create, version, number, VAT-calculate, and PDF a German-compliant outgoing invoice entirely by
prompt, on top of a contacts/addressbook the system populates and the user can browse.

**Completion condition** (identical to frontmatter `goal`):

> `bun run check` exits 0 (lib + app + auth typecheck + biome clean) AND `bun test
> libs/aven-vibes/tests/{contact-id,invoice-number,invoice-totals}.test.ts` all exit 0 AND grep finds
> the new tools (upsert_contact, set_my_company, query_contacts, create_invoice, update_invoice,
> set_invoice_state, save_invoice_pdf) in CHAT_TOOLS + ai.ts AND grep finds AddressbookVibe +
> InvoiceCreateVibe wired in MainnetChat + MainnetVibes AND CONTACT_SCHEMA + INVOICE_DOC_SCHEMA are
> exported from aven-vibes AND every Acceptance criterion below is checked.

## Approach

Reuse: the invoice doctype JSON + generic `_doc` view engine (`libs/aven-vibes/src/vibes/_doc`), the
data-backed vibe pattern (TransactionsVibe/BookingsVibe), the HITL pattern (`aven_hitl` + `/api/ai/
confirm`), the `aven-vibe:<schema>` marker/rehydrate flow, the `ensureDocSchema`/`executeDataTool`
server helpers, and the chat tool-loop in `libs/betterauth/src/ai.ts`.

Mainnet file store (Phase 0): `file-ref.ts` pure helpers (`contentHash`, `filePath`) + a thin Tauri
fs write/read of `<mainnet sparks>/PRIVATE/<hash>`; every mainnet upload path persists the source there
and records `file_hash` in the JSON. PDFs (Phase E) write to the same store. Testnet's `persistSparkFiles`
(avenDB `files` table) is left exactly as-is.

New **pure, tested** modules in aven-vibes (no DOM, server-importable):
- `file-ref.ts` — `contentHash(bytes)` (sha256 hex), `filePath(network, hash, ext)` (deterministic),
  `fileRef(bytes, name)` → `{ hash, filename, mime }`.
- `contact.ts` — `CONTACT_SCHEMA`, `Contact` type, `mintContactId(rand, existingIds)` (8-char base32,
  collision-retry), `contactDisplayName`.
- `invoice-number.ts` — `invoiceNumber(prefix, shortId, seq)`, `nextSeq(existingNumbers, prefix,
  shortId)` (max+1, starts at 1, gapless per series).
- `invoice-doc.ts` — `INVOICE_DOC_SCHEMA`, `InvoiceDoc` type (state ∈ entwurf/angebot/rechnung,
  version, number, contact_short_id, contact_value_id, seller/my-company snapshot, line_items,
  totals, status, pdf_blob_ref, supersedes), `computeInvoiceTotals(lineItems)` (VAT per rate),
  `requiredFieldsMissing(doc)` (§14 UStG checklist → list of missing keys for HITL).
- mappers → DocView for the invoice-create + addressbook detail views.

Server (`ai.ts`) — new tool branches: `upsert_contact`, `set_my_company`, `query_contacts`,
`create_invoice` (mint id if new contact, assign number, compute totals, persist + emit vibe),
`update_invoice` (new version row, re-save), `set_invoice_state`/promote (re-prefix + new number on
final), `save_invoice_pdf` (render HTML → print-to-PDF → store blob → link ref). Stammdaten onboarding
hooks into the existing extract step: on the FIRST ingested invoice, extract the recipient (the user's
own company), upsert a contact, and `aven_hitl` "is this your company?" → `set_my_company`.

UI: `AddressbookVibe` (left contact list, alpha + person/company filter; right detail with tabs:
Stammdaten, and **Belege** = attached incoming + outgoing invoices per contact with PDF preview + JSON
view) and `InvoiceCreateVibe` (live invoice doc-view + state/version chips + PDF preview + the running
number). Wired into MainnetChat (`message.vibe === 'addressbook' | 'invoice-create'`) + MainnetVibes
nav + i18n.

**Out of scope** (note as follow-on ideate cards if wanted): e-invoice XML (ZUGFeRD/XRechnung),
emailing the invoice to the customer, payment/dunning (Mahnwesen), multi-currency outgoing, multi-user
number-range locking.

## Steps (phased — checkpoint after each)

0. **Phase 0 — Mainnet content-addressed file store.** A `file-ref.ts` pure helper
   (`contentHash(bytes)` → sha256; `filePath(network, hash, ext)`) + a Tauri write/read command (or
   `@tauri-apps/plugin-fs`) that stores bytes at `<mainnet sparks>/PRIVATE/<hash>` and reads them
   back. Wire **every mainnet upload/ingest entry point** (the chat drop → extract pipeline, composer
   attach) to persist the source file there and stamp its `file_hash` into the extracted JSON. **Do
   NOT touch the testnet flow.** *Checkpoint:* dropping a doc in mainnet writes a `<hash>` file under
   sparks/PRIVATE and the stored JSON carries its `file_hash`.
1. **Phase A — Contacts + addressbook.** `contact.ts` (schema + `mintContactId` + test) →
   `upsert_contact` + `query_contacts` tools → `AddressbookVibe` (list + detail) wired + i18n.
   *Checkpoint:* "show me contacts" lists contacts; new contacts get unique 8-char ids.
2. **Phase B — Stammdaten.** `set_my_company` tool + `is_self` flag; auto-extract the user's company
   from the first ingested invoice + `aven_hitl` confirm. *Checkpoint:* first ingest asks "is this
   yours?"; confirming marks the contact `is_self`.
3. **Phase C — Invoice create + numbering + VAT.** `invoice-number.ts`, `invoice-doc.ts`
   (`computeInvoiceTotals`, `requiredFieldsMissing`) + tests → `create_invoice` tool (picks/creates
   contact, assigns `E-{id}-{seq}`, computes totals) + compliance HITL for missing fields →
   `InvoiceCreateVibe`. *Checkpoint:* a prompt creates a draft with a correct number + VAT; missing
   §14 fields get HITL'd.
4. **Phase D — State + versioning.** `update_invoice` (new version each edit) + `set_invoice_state`/
   promote (E→A→R re-number). *Checkpoint:* editing bumps the version; promoting re-prefixes + numbers.
5. **Phase E — PDF.** `save_invoice_pdf` (HTML template → print-to-PDF → sealed blob in /api/data +
   ref on the doc). *Checkpoint:* a saved invoice has a viewable PDF stored privately.
6. **Phase F — Attached invoices tab.** Addressbook detail "Belege" tab listing incoming + outgoing
   invoices per contact with PDF preview + JSON view. *Checkpoint:* a contact shows its in/out docs.

## Files to touch

- `libs/aven-vibes/src/file-ref.ts`, `contact.ts`, `invoice-number.ts`, `vibes/invoice/invoice-doc.ts` — new pure modules (+ subpath exports in `package.json` + `index.ts`).
- `libs/aven-vibes/tests/{file-ref,contact-id,invoice-number,invoice-totals}.test.ts` — unit tests.
- Mainnet file store — a Tauri fs write/read of `<mainnet sparks>/PRIVATE/<hash>` (app helper or `tauri-plugin-self` command) + wire `MainnetChat.svelte` / the drop→extract path to persist + stamp `file_hash`. **Do not edit the testnet `persistSparkFiles` path.**
- `libs/aven-vibes/src/tools.ts` — register the new tool defs.
- `libs/betterauth/src/ai.ts` — dispatch the new tools + Stammdaten onboarding hook in the extract step.
- `app/src/lib/shell/{AddressbookVibe,InvoiceCreateVibe}.svelte` — the two vibes.
- `app/src/lib/shell/{MainnetChat,MainnetVibes}.svelte` — wire vibe branches + nav.
- `app/languages/{de,en}.json` — `mainnet.addressbook.*` + `mainnet.invoiceCreate.*`.

## Acceptance criteria

Each provable from the transcript (command + output).

- [x] `bun run check` exit 0; biome clean (no errors) — website check exit 0; lib + auth tsc clean; app svelte-check only the pre-existing `__APP_VERSION__`.
- [x] `bun test …/file-ref.test.ts` exit 0 — `contentHash` deterministic/dedup, differs for different bytes; `filePath` → `sparks/PRIVATE/<hash>`.
- [x] Mainnet upload persists to the file store — `persistMainnetFiles` (content-hash → `sparkWriteBytes` PRIVATE) called from MainnetChat's send path; server stamps `file_hash = fileHashes[0]` into the extracted JSON (grep matches); testnet `persistSparkFiles` flow unchanged.
- [x] `bun test …/contact-id.test.ts` exit 0 — short id `^[0-9A-HJ-NP-Z]{8}$`, mint avoids collisions.
- [x] `bun test …/invoice-number.test.ts` exit 0 — `R/A/E-{id}-{seq}`, `nextSeq` max+1 per (prefix, contact), independent gapless series, unique.
- [x] `bun test …/invoice-totals.test.ts` exit 0 — mixed 19%/7% per-rate net/vat + grand totals.
- [x] Tools registered + dispatched — all seven in tools.ts (7) + ai.ts (15).
- [x] Schemas exported — `CONTACT_SCHEMA` + `INVOICE_DOC_SCHEMA` in index.ts.
- [x] Vibes wired — AddressbookVibe + InvoiceCreateVibe in MainnetChat + MainnetVibes; `'addressbook'` + `'invoice-create'` branches present.
- [x] i18n — `mainnet.addressbook` + `mainnet.invoiceCreate` in de + en.
- [x] Addressbook auto-enriched on EVERY doc extract — `contact-match.ts` (normalize/match/enrich/partiesFromDoc, 5 tests) + server `enrichAddressbookFromDoc` in `performExtraction`: pulls vendor + buyer (or account holder), matches (USt-IdNr → IBAN → name), creates/enriches contacts.
- [x] Stammdaten onboarding (Phase B) — the buyer/account-holder is the self-company candidate; when no `is_self` is set, the extract returns a hint that makes the chat ask "is this your company?" → `set_my_company` (free-text HITL).
- [x] Phase E PDF — `invoice-pdf.ts` (dependency-free single-page PDF) → `saveInvoicePdf` stores it in PRIVATE (content hash) + stamps `pdf_file_hash`; "Als PDF speichern" button in InvoiceCreateVibe.
- [ ] (Review, in-app) "show me contacts" renders list+detail; a prompt creates a draft invoice (correct number + VAT); missing §14 fields are asked (free-text HITL via the create_invoice `missing_required_fields` note); promote E→A→R; "Als PDF speichern" stores a PDF; first ingest asks "is this your company?"; the addressbook auto-fills + Belege tab shows in/out docs. **Note:** the PDF is a minimal text layout (HTML-template fidelity is a follow-up); §14-HITL is prompt-driven (no separate confirm card).

## Verification

```bash
bun run check
ulimit -n 60000; bun test libs/aven-vibes/tests/file-ref.test.ts libs/aven-vibes/tests/contact-id.test.ts libs/aven-vibes/tests/invoice-number.test.ts libs/aven-vibes/tests/invoice-totals.test.ts
grep -nE "upsert_contact|set_my_company|query_contacts|create_invoice|update_invoice|set_invoice_state|save_invoice_pdf" libs/aven-vibes/src/tools.ts libs/betterauth/src/ai.ts
grep -nE "CONTACT_SCHEMA|INVOICE_DOC_SCHEMA" libs/aven-vibes/src/index.ts
grep -nE "AddressbookVibe|InvoiceCreateVibe" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/MainnetVibes.svelte
grep -nE "mainnet.addressbook|mainnet.invoiceCreate" app/languages/de.json app/languages/en.json
```

## Hand-off

```
/aven-build 0082
```

…or the goal loop directly:

```
/goal bun run check exits 0 + the three named tests pass + the tool/vibe/schema greps match + every Acceptance criterion checked
```

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
Newest first.

- `2026-06-25` — Storage corrected: mainnet files (source docs + generated PDFs) go to a
  **content-addressed on-disk store** at `…/.avenOS/<network>/…/sparks/PRIVATE/<sha256>`, referenced by
  hash from the JSON — NOT avenDB, NOT base64 in /api/data. Added **Phase 0** (the file store + wire all
  mainnet upload paths; testnet `persistSparkFiles` flow untouched) + a `file-ref` test to the metric.
- `2026-06-26` — Full build finished: (1) **addressbook auto-enrichment on every extract** — new `contact-match.ts` (5 tests: normalizeName/match/enrich/partiesFromDoc) + server `enrichAddressbookFromDoc` wired into `performExtraction`; each invoice/statement's parties are harvested, matched (USt-IdNr → IBAN → name) and created/enriched. (2) **Phase B Stammdaten** — buyer/account-holder = self candidate; no `is_self` yet → extract returns a hint that makes the chat ask "is this your company?" → `set_my_company`. (3) **Phase E PDF** — `invoice-pdf.ts` builds a real dependency-free PDF, stores it in PRIVATE (content hash) + stamps `pdf_file_hash`; "Als PDF speichern" button. 46 aven-vibes tests green, lib + auth tsc clean, biome no errors, app svelte-check only the pre-existing `__APP_VERSION__`. Residual: PDF layout fidelity (minimal text page today).
- `2026-06-26` — Build: implemented all measurable parts. Pure tested modules (`file-ref`, `contact`, `invoice-number`, `invoice-doc`) — 14/14 tests green; exported from index + 4 subpaths. 7 invoicing tools registered (tools.ts) + dispatched (ai.ts): contacts CRUD + my-company, create/update/state invoices (server mints ids, assigns `E/A/R-{id}-{seq}`, computes VAT), save-PDF signal. Two vibes — AddressbookVibe (list + Stammdaten/Belege detail) + InvoiceCreateVibe (doc render + list) — wired into MainnetChat + MainnetVibes + i18n (de/en). Phase 0 file store: `persistMainnetFiles` (content-hash → `sparkWriteBytes` PRIVATE) wired into the mainnet send path; `file_hash` threaded to the server + stamped into the extracted doctype JSON (file_hash added to invoice/bank-statement/contract schemas); testnet `persistSparkFiles` untouched. lib+auth tsc clean, biome no errors, app svelte-check only the pre-existing `__APP_VERSION__`, `bun run check` exit 0. Residual review-time items: §14-HITL conversation, Phase B `is_self` auto-extract confirm, Phase E client HTML→PDF render+store. Moved build → review.
- `2026-06-25` — Discovery: real goal = run outgoing invoicing by voice/text on a contacts foundation. Confirmed 4 load-bearing decisions (one big card; random 8-char contact id minted once; per-customer running number `{R,A,E}-{id}-{seq}`; HTML→print-to-PDF). Specced into phases A–F with named-test + grep metrics. Out of scope: ZUGFeRD/XRechnung, emailing, Mahnwesen, multi-currency. Created directly in discover/.

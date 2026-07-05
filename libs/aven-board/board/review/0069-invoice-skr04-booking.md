---
title: Book the matched invoice to an SKR04 account (Buchungssatz + booking vibe)
summary: Final pipeline step — after invoice↔tx match, give the LLM the FULL SKR04 chart (konten.json, 1598 accounts) + the extracted invoice (+ matched tx) and have it produce a real Buchungssatz (Soll/Haben account, net/tax/gross, Steuerschlüssel, Buchungstext). Validate the accounts against the chart, persist a `booking` record, and render a view: invoice JSON (left) ↔ the booked Steuer-Buchung (right).
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [bookkeeping, skr04, booking, ai, persistence, vibe]
goal: "`bun test libs/aven-vibes/tests/booking.test.ts` exits 0 (SKR04 chart loads with 1598 accounts; getAccount resolves a known konto + rejects unknown; a sample booking validates against BOOKING_SCHEMA) AND `grep -R \"BOOKING_SCHEMA\\|buildBookingRecord\" libs/aven-vibes/src/vibes/invoice/booking.ts` matches AND `grep -R \"SKR04_ACCOUNTS\\|getAccount\" libs/aven-vibes/src/skr.ts` matches AND `grep -R \"bookInvoice\\|invoice-booking\" libs/betterauth/src/ai.ts` matches AND `grep -R \"invoice-booking\" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/MainnetVibes.svelte` matches AND `bun run check` exits 0"
---

# Book the matched invoice to an SKR04 account

## Context

The terminal step of the bookkeeping pipeline: **[[0063]]** classify → **[[0064]]** extract+compare →
**[[0065]]** tx fan-out → **[[0066]]** reconcile → **0069 (this)** book. Once an invoice is matched to
its paying transaction, decide HOW to book it in the chart of accounts and record the Buchungssatz.

**Real goal:** turn a reconciled invoice into a *bookable accounting entry* — the account(s), tax key,
and amounts an accountant would post — so the data is ready for DATEV/export, not just "matched".

### What exists (verified)

- **Hardcoded chart** — `app/static/skills/bookkeeping/konten.json`: **DATEV SKR04** (2026), **1598**
  accounts, each `{konto (4-digit string), funktion (AM/AV/S/F/KU…), bezeichnung}`. Surfaced today in
  the `avens/avenSKILLS/bookkeeping` view. There's also a `bookkeeping` SKR04 skill (same data).
- **Pipeline plumbing** to reuse: doctype/LLM-tool-call pattern ([0064] `extractDocFields`,
  [0066] `matchInvoiceLLM`), `ensureDocSchema` + `executeDataTool` persistence, the generic doc-view
  + per-type mappers, and the marker-with-payload reload persistence ([0067]).

### Decisions locked with the user

- **SKR04** (the data in the repo; no new dataset).
- **Full chart as context** — the model gets all 1598 accounts (sent compactly as `konto bezeichnung`
  lines to limit tokens). Accept the added latency/cost per booking. Accounts are still validated
  against the chart server-side so an invented konto can't be stored.
- **Full Buchungssatz** — Soll account ↔ Haben (contra, e.g. 1800 Bank) account, net/tax/gross
  amounts, Steuerschlüssel (USt key), Buchungstext.

Out of scope: DATEV/CSV export of the bookings; multi-line/split bookings across several accounts;
editing the booking in the UI; SKR03.

## Goal

After an invoice is reconciled, the model produces a chart-valid Buchungssatz, it's persisted as a
`booking` record, and an `invoice-booking` card shows invoice (left) ↔ Buchungssatz (right).

**Completion condition** (identical to frontmatter `goal`):

> `bun test libs/aven-vibes/tests/booking.test.ts` exits 0 (SKR04 chart loads with 1598 accounts; getAccount resolves a known konto + rejects unknown; a sample booking validates against BOOKING_SCHEMA) AND `grep -R "BOOKING_SCHEMA\|buildBookingRecord" libs/aven-vibes/src/vibes/invoice/booking.ts` matches AND `grep -R "SKR04_ACCOUNTS\|getAccount" libs/aven-vibes/src/skr.ts` matches AND `grep -R "bookInvoice\|invoice-booking" libs/betterauth/src/ai.ts` matches AND `grep -R "invoice-booking" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/MainnetVibes.svelte` matches AND `bun run check` exits 0

## Approach

**SKR data, server-safe.** Copy `konten.json` into the lib as `libs/aven-vibes/src/vibes/invoice/skr04.json`
and add a pure `libs/aven-vibes/src/skr.ts` (`@avenos/aven-vibes/skr`): `SKR04_ACCOUNTS` (typed),
`getAccount(konto)`, `isValidKonto(konto)`, and `skrForPrompt()` (compact `konto  bezeichnung` text for
the LLM). Pure JSON — the betterauth server imports it without the renderer.

**Booking module.** `libs/aven-vibes/src/vibes/invoice/booking.ts` (`@avenos/aven-vibes/booking`):
`BOOKING_SCHEMA` (Ajv) + `BookingRecord`, `buildBookingRecord(invoiceValueId, invoice, picked)`, and
`mapBookingToView(booking)` (right panel: Soll/Haben, net/tax/gross, Steuerschlüssel, Buchungstext +
confidence/reason).

**Server (`ai.ts`).** After the invoice match, `bookInvoice(key, model, userId, invoice, match, id)`
makes a focused `book_invoice` tool call: system prompt (German bookkeeping; book this expense/income
invoice) + the FULL SKR04 chart (`skrForPrompt()`) + the invoice JSON + the matched tx. The tool
returns `{ soll_konto, haben_konto, net_amount, tax_amount, gross_amount, tax_key, buchungstext,
confidence, reason }`. The server **validates** `soll_konto`/`haben_konto` via `isValidKonto` (fills
bezeichnung from the chart), persists a `booking` row (`ensureDocSchema('booking', …)` +
`executeDataTool create`), and emits the `invoice-booking` vibe (marker WITH payload, 0067).

**UI.** `InvoiceBookingVibe.svelte` — invoice doc-view left, booking doc-view right (reusing the
generic doc-view + `mapInvoiceToView` / `mapBookingToView`); wired into MainnetChat stream +
MainnetVibes nav + i18n.

## Steps

1. `skr04.json` (copy) + `skr.ts` (`SKR04_ACCOUNTS`, `getAccount`, `isValidKonto`, `skrForPrompt`) + `./skr` export. Test: 1598 accounts, known konto resolves.
2. `booking.ts` (BOOKING_SCHEMA, BookingRecord, buildBookingRecord, mapBookingToView) + `./booking` export.
3. `ai.ts` `bookInvoice` (full-chart LLM tool call → validate konten → persist `booking` → emit `invoice-booking`), wired after match in the invoice branch.
4. `InvoiceBookingVibe.svelte` + MainnetChat/MainnetVibes wiring + i18n + marker-with-payload.
5. `tests/booking.test.ts`. Green check/lint/test.

## Files to touch

- `libs/aven-vibes/src/vibes/invoice/skr04.json` — SKR04 chart (copied from app/static).
- `libs/aven-vibes/src/skr.ts` + `libs/aven-vibes/package.json` (`./skr`) — chart loader/helpers.
- `libs/aven-vibes/src/vibes/invoice/booking.ts` + `package.json` (`./booking`) — schema + record + view mapper.
- `libs/betterauth/src/ai.ts` — `bookInvoice` LLM call + persist + `invoice-booking` vibe, after the match.
- `app/src/lib/shell/InvoiceBookingVibe.svelte` + `MainnetChat.svelte` + `MainnetVibes.svelte` + `app/languages/{de,en}.json`.
- `libs/aven-vibes/tests/booking.test.ts`.

## Acceptance criteria

- [x] `bun test libs/aven-vibes/tests/booking.test.ts` exits 0 — chart has 1598 accounts; a known konto resolves; `isValidKonto('99999999')` false; valid sample → status "booked" + schema-valid; invalid soll_konto → "unbooked" + schema-valid. (All suites: 23/23.)
- [x] SKR module — `grep "SKR04_ACCOUNTS\|getAccount" skr.ts` matches; `./skr` export present.
- [x] Booking module — `grep "BOOKING_SCHEMA\|buildBookingRecord" booking.ts` matches; `./booking` export.
- [x] Server — `grep "bookInvoice\|invoice-booking" ai.ts` matches; konten validated in buildBookingRecord (invalid → unbooked, no invented konto stored).
- [x] UI — `grep "invoice-booking"` matches MainnetChat + MainnetVibes; `InvoiceBookingVibe.svelte` exists.
- [x] `bun run check` exit 0; lib tsc 0; app svelte-check only the pre-existing `__APP_VERSION__`; all 0069 files biome-clean.
- [ ] (Review, in-app) Reconcile an invoice → an `invoice-booking` card shows the Buchungssatz (valid SKR04 accounts + tax key); a `booking` data_value row exists.

## Verification

```bash
bun test libs/aven-vibes/tests/booking.test.ts
grep -R "SKR04_ACCOUNTS\|getAccount" libs/aven-vibes/src/skr.ts
grep -R "BOOKING_SCHEMA\|buildBookingRecord" libs/aven-vibes/src/vibes/invoice/booking.ts
grep -R "bookInvoice\|invoice-booking" libs/betterauth/src/ai.ts
grep -R "invoice-booking" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/MainnetVibes.svelte
bun run check
```

## Hand-off

```
/aven-build 0069
```

…or hand the condition straight to the goal loop:

```
/goal <paste the Completion condition above>
```

## Progress log

Newest entry first.

- `2026-06-25` — Build: all green (23/23 tests, lib tsc 0, biome-clean, app check only pre-existing). Copied SKR04 chart into the lib (`skr04.json`, 1598 accounts) + `skr.ts` (`SKR04_ACCOUNTS`/`getAccount`/`isValidKonto`/`skrForPrompt`, `@avenos/aven-vibes/skr`); `booking.ts` (BOOKING_SCHEMA + `buildBookingRecord` that VALIDATES konten against the chart + fills Bezeichnungen, never trusting the LLM + `mapBookingToView`, `@avenos/aven-vibes/booking`); `bookInvoice` in ai.ts (focused `book_invoice` tool call with the FULL chart via `skrForPrompt()` + invoice + paying tx → Buchungssatz → validate → persist `booking` → emit `invoice-booking`), wired right after the match in the invoice branch; `InvoiceBookingVibe.svelte` (invoice left, Buchungssatz right) + MainnetChat/MainnetVibes + i18n + marker-with-payload (0067). Also fixed [[0066]] matching this turn (richer invoice context incl. line-items + FX-rate-from-description reasoning). Moved build → review.
- `2026-06-25` — Discovery: verified the hardcoded chart (`app/static/skills/bookkeeping/konten.json` = SKR04, 1598 `{konto,funktion,bezeichnung}`) + the SKR04 skill; confirmed reusable plumbing (LLM tool-call, ensureDocSchema/executeDataTool, doc-view mappers, marker-with-payload). Locked: SKR04, FULL chart as context (compact encoding; server validates konten), full Buchungssatz. Made goal measurable (chart-load + schema-validation test + artifact greps). Created in discover/.

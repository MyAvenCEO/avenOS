---
title: Finance / BWA snapshot vibe + booking gets full invoice JSON + match split view
summary: A realtime BWA / Jahresabschluss-like finance snapshot vibe computed from bookings (P&L by SKR04 account) + transactions (cash flow), openable from the Vibes tab or via chat ("show me my finances/BWA") through a new show_finances tool. Plus the booking step now receives the FULL invoice JSON (not just a summary), and the merged reconciliation card shows invoice ↔ tx as a left/right split.
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [bookkeeping, bwa, finance, vibe, data]
goal: "`bun run check` exits 0 (app svelte-check: 0 new errors) AND `grep -R \"show_finances\" libs/aven-vibes/src/tools.ts libs/betterauth/src/ai.ts` matches AND `grep -R \"FinanceVibe\" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/MainnetVibes.svelte` matches AND `grep -R \"message.vibe === 'bwa'\" app/src/lib/shell/MainnetChat.svelte` matches AND `grep -R \"mainnet.finance\" app/languages/de.json app/languages/en.json` matches AND `grep \"Full invoice JSON\" libs/betterauth/src/ai.ts`"
---

# Finance / BWA snapshot vibe

## Context

After bookings ([[0069]]/[[0071]]) the user wanted a realtime "how are our finances doing"
overview — a BWA / Jahresabschluss-like snapshot — as another openable vibe. Plus two refinements:
the booking LLM should consume the **full** invoice JSON + `booking_summary` (no re-deriving), and
the reconciliation card should show invoice ↔ tx as a **left/right split**.

## Goal

A `bwa` vibe computes Erlöse / Aufwendungen / Ergebnis + cash flow + per-account expense breakdown
live from the user's bookings + tx, openable from the Vibes tab and via chat.

**Completion condition:** see frontmatter `goal`.

## Approach

- `FinanceVibe.svelte` — data-backed (two TanStack queries: `booking` + `tx`). P&L: each booking's
  non-bank side classifies as Erlös (SKR04 4xxx) or Aufwand (6xxx/7xxx); sums net per account →
  Ergebnis = Erlöse − Aufwand. Cash: tx amounts → Einnahmen / Ausgaben / Saldo. KPIs + cash row +
  expense-by-account breakdown.
- Chat trigger: new `show_finances` tool (no args) in `tools.ts` → ai.ts dispatch emits
  `aven-vibe:bwa` (mirrors `show_website`; persists a payload-less marker → re-hydrates client-side).
- Wired into MainnetChat (`message.vibe === 'bwa'`) + MainnetVibes nav + i18n (`mainnet.finance.*`).
- Booking (`bookInvoice`): the prompt now includes the **full invoice JSON** alongside the summary,
  and leans on `booking_summary` to choose the account (so it reuses what extraction already produced
  rather than re-deriving).
- Merged reconciliation card (`InvoiceBookingVibe`): top is now a 2-col split — invoice summary
  (left) ↔ matched transaction (right) — with the SKR04 Buchungssatz below.

## Acceptance criteria

- [x] `bun run check` exit 0; app svelte-check only the pre-existing `__APP_VERSION__`; biome-clean; 23/23 aven-vibes tests; lib tsc clean.
- [x] `show_finances` tool present + dispatched (grep both files).
- [x] FinanceVibe wired in chat + Vibes nav; `message.vibe === 'bwa'` branch present.
- [x] i18n `mainnet.finance.*` in both catalogs.
- [x] Booking prompt includes the full invoice JSON (`grep "Full invoice JSON"`).
- [ ] (Review, in-app) "show me my BWA" renders KPIs + breakdown; reconciliation card is left/right.

## Verification

```bash
bun run check
grep -R "show_finances" libs/aven-vibes/src/tools.ts libs/betterauth/src/ai.ts
grep -R "FinanceVibe" app/src/lib/shell/MainnetChat.svelte app/src/lib/shell/MainnetVibes.svelte
grep -R "message.vibe === 'bwa'" app/src/lib/shell/MainnetChat.svelte
grep "Full invoice JSON" libs/betterauth/src/ai.ts
```

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
- `2026-06-25` — Built: `FinanceVibe.svelte` (BWA snapshot from booking+tx), `show_finances` tool + ai.ts emit (`aven-vibe:bwa`), MainnetChat + MainnetVibes wiring, i18n. Booking now gets full invoice JSON + summary. Reconciliation card → left/right split. All checks green; auth restarted. Created in review/.

## Follow-ups (not in this card)

- Re-extraction: classify + extract are still two separate vision passes. Could merge invoice
  classify+extract into one call (the booking already avoids re-extraction by consuming the stored
  invoice). Flagged for a future card if desired.

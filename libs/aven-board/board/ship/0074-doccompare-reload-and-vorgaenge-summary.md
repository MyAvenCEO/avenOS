---
title: Fix doc-compare/classify preview lost on reload + booking_summary pre-thinks the Vorgänge
summary: Two fixes. (1) Bug — the doc-compare (extract) split-screen and the classify card lost their document preview after reload (the JSON re-hydrated, the file did not), because the persisted vibe marker only stored the extracted JSON, not the preview image; the live client merged its own previewImage which history doesn't have. Now the server persists the first-page preview INTO the marker. (2) booking_summary now pre-analyses the distinct Vorgänge on the invoice (a per-line list when the invoice would split across SKR04 accounts), priming the Splitbuchung.
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [bookkeeping, vibe, reload, splitbuchung]
goal: "`bun run check` exits 0 (app svelte-check: 0 new errors) AND the doc-compare + bookkeeping markers persist a `fileUrl` (`grep -n \"fileUrl: previewAtt\" libs/betterauth/src/ai.ts` matches twice) AND the booking_summary field descriptions instruct a Vorgänge list (`grep -l \"PRE-ANALYSIS\" libs/aven-vibes/src/vibes/bookkeeping/tools.json libs/aven-vibes/src/vibes/invoice/doctype.json`) AND 25/25 aven-vibes tests pass"
---

# Doc-compare reload fix + Vorgänge pre-analysis

## Context

Two issues from testing:
1. **Reload bug:** reopening a chat showed the extract split-screen (and the classify card) with the
   invoice JSON re-hydrated but **"Keine Vorschau verfügbar"** — the file/preview was gone. Cause: the
   live render merges the client's `previewImage` (the just-uploaded page) into the card, but the
   PERSISTED marker only held `{type, extracted}`. History has no client previewImage → empty pane.
2. **Vorgänge pre-thinking:** the user wants the booking summary to already enumerate the distinct
   Vorgänge on an invoice so the Splitbuchung ([[0073]]) has them up front.

## Goal

Doc-compare + classify previews survive reload, and booking_summary lists the invoice's Vorgänge.

**Completion condition:** see frontmatter `goal`.

## Approach

- **Reload fix (ai.ts):** when emitting the `doc-compare` and `bookkeeping` vibes, build a `fileUrl`
  (+`mimeType`) from the first image attachment (`data:<mime>;base64,<b64>`) and include it in the
  persisted marker payload — so re-hydration after reload has the preview, matching what the live
  client merges. (Tradeoff: the first-page JPEG is stored in the chat message; acceptable for the
  test run. Follow-up: move to a data-backed `docfile` reference if history size matters.)
- **Vorgänge (tools.json + doctype.json):** `booking_summary` is now a PRE-ANALYSIS — a one-line
  nature, THEN one bullet per distinct Vorgang when the invoice would split across SKR04 accounts
  (mixed cost types / VAT rates / private-business / Skonto). `BookkeepingVibe` renders it
  multi-line (`whitespace-pre-line`). This feeds the Splitbuchung prompt (which already leans on
  booking_summary).

## Acceptance criteria

- [x] `bun run check` exit 0; app svelte-check only the pre-existing `__APP_VERSION__`; biome-clean; 25/25 tests.
- [x] doc-compare + bookkeeping markers persist `fileUrl` (server builds it from the first image attachment).
- [x] booking_summary descriptions instruct a Vorgänge list; classify card renders multi-line.
- [ ] (Review, in-app) Reload a bookkeeping chat → the extract split-screen + classify card still show the doc preview; a mixed invoice's summary lists its Vorgänge.

## Verification

```bash
bun run check
grep -n "fileUrl: previewAtt" libs/betterauth/src/ai.ts          # doc-compare + bookkeeping
grep -l "PRE-ANALYSIS" libs/aven-vibes/src/vibes/bookkeeping/tools.json libs/aven-vibes/src/vibes/invoice/doctype.json
```

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
- `2026-06-25` — Built: persist first-page preview into the doc-compare + bookkeeping markers (reload now re-hydrates the left pane / thumbnail); booking_summary reworked into a Vorgänge pre-analysis (one bullet per split-worthy Vorgang) + multi-line classify rendering. Checks green; auth restarted. Created in review/.

---
title: Terse replies for card-producing tools (per-tool, not global)
summary: After a show/do action that renders a vibe card (data_crud list, show_finances, show_website), the text reply was re-dumping the data as a full Markdown table. Fix: attach a short "reply in one sentence, the card already shows the data" note to THOSE tool results only — scoped per tool call, not injected into the global system prompt, so plain conversational turns keep their normal style.
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [chat, ai, ux]
goal: "`bun run check` exits 0 (betterauth tsc clean; biome clean) AND the terse note is NOT in the global system message (`! grep -q 'RESPONSE STYLE' libs/betterauth/src/ai.ts` and the schema-hint merge block contains only `hint`) AND CARD_REPLY_NOTE is attached to the show_website + show_finances + data_crud(list) tool results (`grep -c CARD_REPLY_NOTE libs/betterauth/src/ai.ts` ≥ 4)"
---

# Terse card replies — per tool

## Context

"show me all bookings of this month" rendered the Bookings card AND a long Markdown-table re-dump of
the same rows in the text reply. The user wants the reply to be a 1–2 line summary — but **per tool
call**, NOT a blanket global system-prompt rule (a first attempt appended a global RESPONSE_STYLE to
the system message; the user rejected that as too generic).

## Goal

Card-producing tool calls instruct a terse reply; non-card / conversational turns are untouched.

**Completion condition:** see frontmatter `goal`.

## Approach

- Reverted the global system-message injection (the schema-hint merge is hint-only again).
- A `CARD_REPLY_NOTE` string is attached to the RESULT of each tool that renders a card/view:
  `show_website`, `show_finances`, and `data_crud` when `action === 'list'` (the list result keeps
  its data but gains a `note` telling the model to confirm in one sentence and not re-list the rows).
- classify_document / extract_document / book_invoice already carry a short `response` field, so they
  needed no change.

## Acceptance criteria

- [x] `bun run check` exit 0; betterauth tsc clean; biome clean.
- [x] No global RESPONSE_STYLE in the system message; schema-hint merge is hint-only.
- [x] CARD_REPLY_NOTE on show_website + show_finances + data_crud(list) results (4 refs incl. def).
- [ ] (Review, in-app) "show me all bookings" → card + a single-sentence reply (no Markdown table); a normal question still answers in full.

## Verification

```bash
bun run check
grep -n "CARD_REPLY_NOTE" libs/betterauth/src/ai.ts
grep -c "RESPONSE STYLE" libs/betterauth/src/ai.ts   # → 0 (no global rule)
```

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
- `2026-06-25` — First did it globally (RESPONSE_STYLE on the system message); user asked for per-tool instead. Reverted the global merge; introduced `CARD_REPLY_NOTE` attached to the show_website/show_finances/data_crud(list) tool results only. biome + betterauth tsc clean; auth reloaded. Created in review/.

---
title: Auto-chain extraction after classify (extract step never silently skipped)
summary: Sometimes the model classified a document and then stopped without calling extract_document, so the extract step (and the downstream tx/match/book + doc-compare card) never ran. Fix — factor the extraction into a server-side function and auto-run it right after a classify of an extractable type, instead of depending on the model to chain the tool call. Guarded against double extraction.
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [bookkeeping, ai, reliability]
goal: "`bun run check` exits 0 (betterauth tsc clean; biome clean) AND extraction is factored into a reusable `performExtraction` (`grep -c performExtraction libs/betterauth/src/ai.ts` ≥ 3: def + extract_document branch + classify auto-chain) AND a turn-scoped `extractedType` guard prevents a second extraction when the model also calls extract_document after the auto-run"
---

# Auto-chain extraction after classify

## Context

Reported: "sometimes after classification the extract step doesn't get triggered anymore." Cause: the
classify→extract chain was model-driven — `classify_document` emits its reply text, and the model
sometimes treats the turn as finished instead of calling `extract_document`. When it stops, the whole
downstream pipeline (persist → tx fan-out / invoice reconcile + book → doc-compare + booking cards)
silently doesn't run.

## Goal

After classifying an extractable document, the extraction always runs (server-side), regardless of
whether the model calls the tool.

**Completion condition:** see frontmatter `goal`.

## Approach

- Factored the entire extract-branch body into a local `performExtraction(docTypeName, tcId)` closure
  (vision pass → Ajv-validate + persist → bank fan-out / invoice match + book → emit + persist
  doc-compare and invoice-booking cards). It sets a turn-scoped `extractedType`.
- The `extract_document` tool branch now just calls `performExtraction` (or skips if `extractedType`
  already === the type) and pushes the tool result.
- The `classify_document` branch AUTO-CHAINS: for an extractable type (invoice / bank_statement /
  contract) with image attachments and nothing extracted yet, it `await performExtraction(...)`
  directly, then tells the model in the tool result "extraction already ran — do NOT call
  extract_document; reply with one short sentence."
- `extractedType` guards against a double extraction (and duplicate data rows) if the model still
  calls `extract_document` after the auto-run.

## Acceptance criteria

- [x] `bun run check` exit 0; betterauth tsc clean; biome clean; auth boots clean (200).
- [x] `performExtraction` referenced ≥3× (def + tool branch + auto-chain).
- [x] `extractedType` guard prevents re-extraction.
- [ ] (Review, in-app) Drop an invoice; even if the model only classifies, the extract split-screen + booking card still appear.

## Verification

```bash
bun run check
grep -n "performExtraction\|extractedType" libs/betterauth/src/ai.ts
```

## Progress log

- `2026-06-25` — Built: factored `performExtraction`; extract_document branch + classify auto-chain both call it; `extractedType` guards double-runs. betterauth tsc + biome clean; auth boots clean. Created in review/.

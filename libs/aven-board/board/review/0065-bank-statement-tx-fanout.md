---
title: Bank statement → transactions fan-out (idempotent `tx` schema/table)
summary: After a bank_statement is extracted (0064), normalize its transactions[] into a dedicated `tx` schema/table in AvenDB — flat per-transaction rows, validated against a tx JSON Schema, with a deterministic dedup_key so re-extracting the same statement is idempotent (no duplicates).
owner: claude
created: 2026-06-25
updated: 2026-06-25
tags: [bookkeeping, extract, persistence, transactions, dedup]
goal: "`bun test libs/aven-vibes/tests/tx-extract.test.ts` exits 0 (transactions normalize, validate against TX_SCHEMA via Ajv, and dedup is idempotent — second pass adds 0) AND `grep -R \"TX_SCHEMA\\|bankStatementToTransactions\" libs/aven-vibes/src/vibes/bank-statement/tx.ts` matches AND `grep -R \"fanOutTransactions\\|schema: 'tx'\" libs/betterauth/src/ai.ts` matches AND `bun run check` exits 0"
---

# Bank statement → transactions fan-out

## Context

Follow-on to **[[0064]]** (document extract + compare vibe). 0064 stores the whole extracted
`bank_statement` JSON as one `data_value`. This card adds the next pipeline step: break that
statement's `transactions[]` out into a **clean, queryable `tx` table** so transactions are
first-class records (the basis for later reconciliation against invoices).

**Real goal:** a clean per-transaction ledger the user can trust — each posted line is one row,
validated, and **never double-counted** even if the same statement is uploaded twice.

### Decisions

- **Schema:** a flat `tx` JSON Schema (registered in the user's schema table like todos), one row
  per posted transaction. Fields: `dedup_key` (required), dates, signed `amount`, currency,
  description, counterparty, `balance_after`, `account_iban`, `statement_id`, `source_value_id`.
- **Dedup key (load-bearing):** prefer the bank's own `transaction_id` (`tid:<id>`); otherwise a
  deterministic hash of the stable fields — `h:<iban>|<booking|value date>|<amount>|<purpose>`.
  Same statement → same keys, so the fan-out is idempotent.
- **Idempotency:** before insert, list existing `tx` and skip any `dedup_key` already present
  (also dedup within the incoming batch). Re-extracting the same statement adds 0.
- **Where:** server-side in the 0064 `extract_document` executor — runs only when
  `type === 'bank_statement'`, after the statement value is persisted. The fan-out logic is a
  pure, tested module (`@avenos/aven-vibes/tx`); the server just calls it + the data store.

Out of scope: invoice ↔ tx reconciliation/matchmaking; a transactions UI/vibe; multi-account
splitting beyond the statement's own IBAN.

## Goal

After a bank statement is extracted, every transaction is stored as a schema-validated `tx` row,
idempotently.

**Completion condition** (identical to frontmatter `goal`):

> `bun test libs/aven-vibes/tests/tx-extract.test.ts` exits 0 (transactions normalize, validate against TX_SCHEMA via Ajv, and dedup is idempotent — second pass adds 0) AND `grep -R "TX_SCHEMA\|bankStatementToTransactions" libs/aven-vibes/src/vibes/bank-statement/tx.ts` matches AND `grep -R "fanOutTransactions\|schema: 'tx'" libs/betterauth/src/ai.ts` matches AND `bun run check` exits 0

## Approach

`libs/aven-vibes/src/vibes/bank-statement/tx.ts` (pure, no DOM) exports `TX_SCHEMA`, `TxRecord`,
`txDedupKey`, `bankStatementToTransactions(extracted, sourceValueId)`, and the idempotent filter
`newTransactions(txs, existingKeys)`. Exposed at the package subpath `@avenos/aven-vibes/tx` so the
betterauth server can import it without the renderer.

In `ai.ts`, the `extract_document` executor captures the created statement's `data_value` id and,
for `bank_statement`, calls `fanOutTransactions(userId, extracted, sourceId)` → `ensureDocSchema`
the `tx` schema → list existing `tx` keys → `newTransactions` filter → `executeDataTool create`. The
new-tx count rides back in the tool chip (`… · +N tx`) and the tool result.

## Steps

1. `tx.ts` — TX_SCHEMA + normalizer + dedup key + idempotent filter.
2. Package export `./tx`.
3. `ai.ts` — capture statement value id; `fanOutTransactions` helper + call for bank statements.
4. `tests/tx-extract.test.ts` — validate + dedup/idempotency.
5. Verify green.

## Files to touch

- `libs/aven-vibes/src/vibes/bank-statement/tx.ts` — pure tx module (schema + normalize + dedup).
- `libs/aven-vibes/package.json` — `./tx` export.
- `libs/betterauth/src/ai.ts` — `fanOutTransactions` + call in the extract executor.
- `libs/aven-vibes/tests/tx-extract.test.ts` — validation + idempotency test.

## Acceptance criteria

- [x] `bun test libs/aven-vibes/tests/tx-extract.test.ts` exits 0 — `3 pass, 0 fail`: tx validate against TX_SCHEMA, dedup_key deterministic, `newTransactions` idempotent (first pass 2 unique from 3 rows incl. a dup; second pass 0).
- [x] tx module present — `grep -R "TX_SCHEMA\|bankStatementToTransactions" libs/aven-vibes/src/vibes/bank-statement/tx.ts` matches.
- [x] Server fan-out wired — `grep -R "fanOutTransactions\|schema: 'tx'" libs/betterauth/src/ai.ts` matches (runs only for `bank_statement`).
- [x] `bun run check` exits 0 (aven-website). App svelte-check: only the pre-existing `__APP_VERSION__` error; lib `tsc` exit 0; all 0065 files biome-clean.
- [ ] (Review, in-app) Upload a bank statement → tool chip shows `… · +N tx`; a `tx` schema + N `data_value` rows exist; re-uploading the same statement adds 0.

## Verification

```bash
bun test libs/aven-vibes/tests/tx-extract.test.ts
grep -R "TX_SCHEMA\|bankStatementToTransactions" libs/aven-vibes/src/vibes/bank-statement/tx.ts
grep -R "fanOutTransactions\|schema: 'tx'" libs/betterauth/src/ai.ts
bun run check
```

## Hand-off

```
/aven-review 0065
```

## Progress log

Newest entry first.

- `2026-06-25` — Discovery + build in one pass (clear follow-on to 0064). Built pure `tx.ts` (TX_SCHEMA + `bankStatementToTransactions` + `txDedupKey` + idempotent `newTransactions`), exposed at `@avenos/aven-vibes/tx`; wired `fanOutTransactions` into the `extract_document` executor (bank_statement only) with list-existing-keys dedup; new-tx count surfaced in the tool chip. Dedup key = `transaction_id` else `h:<iban>|<date>|<amount>|<purpose>`. Test 3/3 pass (validation + idempotency), lib tsc exit 0, biome-clean, app svelte-check only the pre-existing `__APP_VERSION__`. Created directly in review/.

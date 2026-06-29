---
title: Seed the universal predicate vocabulary (Lojban-structured) for all doctypes
summary: One predicate vocabulary — English names, x1–x5 place structures reused from Lojban gismu where they fit — that COVERS every current mainnet doctype (todos, contact, invoice_doc, booking/SKR04, tx, match, invoice, bank_statement, contract). Compiler emits self-documenting Ajv data_schemas through the existing data_crud path; todos migrated end-to-end as the working proof. aven-db CRDT untouched.
owner: claude
created: 2026-06-29
updated: 2026-06-29
tags: [postgres, schema, architecture]
goal: A predicate vocabulary seed covers every field of all 9 current doctypes (todos, contact, invoice_doc, booking, tx, match, invoice, bank_statement, contract) — proven by a coverage test (exit 0) that fails on any unmapped field; the compiler generates a self-documenting Ajv data_schema per predicate (unit test exit 0); the `pred:*` schemas are registered; todos is migrated on mainnet (3 `task` + 3 `valid`; `SELECT * FROM v_task WHERE open` returns the 3 German titles); a malformed task is rejected by data_crud while a valid one is accepted; legacy doctypes stay intact (additive); and `bun run check` and `bun run lint` exit 0.
---

# Seed the universal predicate vocabulary (Lojban-structured) for all doctypes

## Context

Every user document on mainnet (`mainnet/alberobello`, Neon `billowing-violet-90988280`,
pg 18, **Kysely**) is JSON in one generic store, validated by a hand-authored Ajv
schema (board 0053):

- `data_schema(id, user_id, name, json_schema jsonb, …)` — `name` = doctype, unique `(user_id,name)`.
- `data_value(id, user_id, schema_id→data_schema, data jsonb, created_at, updated_at)` — one row per doc.
- `*_history` tables exist (temporal seed). The CRUD/validation lives in
  `libs/betterauth/src/data.ts` and is **100% schema-driven** (zero hardcoded
  doctypes — grep finds only comments). aven-db (Rust CRDT) is a **separate store and
  is out of scope here** — see [[avendb-crdt-vs-mainnet-postgres]].

**The 9 current doctypes the vocabulary must cover:**

| doctype | source | notes |
| --- | --- | --- |
| `todos` | mainnet data_schema (3 rows) | `{ title, done }` |
| `contact` | `libs/aven-vibes/src/contact.ts` (CONTACT_SCHEMA) | addressbook, person/company, ~20 fields |
| `invoice_doc` | `…/invoice/invoice-doc.ts` (INVOICE_DOC_SCHEMA) | authored outgoing invoice; nested PARTY + LINE arrays |
| `booking` | `…/invoice/booking.ts` (BOOKING_SCHEMA) | SKR04 Buchungssatz; nested LINE array (Splitbuchung) |
| `tx` | `…/bank-statement/tx.ts` (TX_SCHEMA) | bank transactions; FX fields |
| `match` | `…/invoice/match.ts` (MATCH_SCHEMA) | invoice↔tx reconciliation |
| `invoice` (ingested) | `…/invoice/doctype.json` | extracted incoming invoice |
| `bank_statement` | `…/bank-statement/doctype.json` | extracted statement |
| `contract` | `…/contract/doctype.json` | extracted contract |

Plus the LLM tools that read/write these: the generic `data_crud` tool
(`libs/aven-vibes/src/tools.ts`, executor `data.ts:executeDataTool`) and the
per-vibe tools (`todos/tools.json`, `bookkeeping/tools.json`).

**The model (truly universal — north star).** Replace per-doctype schemas with
**predications**: every fact is `predicate + positional places x1…x5`, each place a
**value** (literal) or a **ref** (`data_value.id`, polymorphic — `references:"*"`).
Three principles: (1) **time is a predicate** — a reusable `valid(x1=fact, x2=from,
x3=to)` (+ `asserted` for transaction-time); "done" = set `valid.x3`. (2) **a ref
points at anything**; entities decompose into bundles of small predications sharing a
ref (nested arrays → child predications). (3) **the registry is predications too**
(eventually) — the generated Ajv `data_schema` is a derived cache whose only job is
to reuse the existing `data_crud` validation. The single fixed thing is the
meta-grammar `predicate + x1…x5`.

**Naming rule (locked):** predicate names are **pragmatic English**, but each
predicate's **x1–x5 place structure is reused from the canonical Lojban gismu**
where one applies, recorded as a `gismu:` provenance field. So `pays`≡`pleji`,
`address`≡`judri`, `names`≡`cmene`, `person`≡`prenu`, `company`≡`kagni`,
`exchanges`≡`canja`, `manages`≡`jatna`, `note`≡`notci`, `sourced_from`≡`krasi` —
Lojban's documented argument structure as the standard, English for legibility.
Domain gaps with no gismu (SKR04 Soll/Haben/Konto) get clear coined names + glosses.

This card is the **vocabulary seed + compiler + todos proof** — the bounded
foundation of a larger program. Migrating each other doctype's *data*, rewiring each
*vibe* + the *LLM tools*, the *DB viewer*, LLM predicate-minting, and the
consolidate-&-align skill are follow-on cards (see Program). Related:
[[0053-generic-schema-driven-user-data]], [[0086-predication-aware-db-viewer]],
[[0083-flow-recipe-schema-skills-view]].

## Goal

One predicate vocabulary, English-named with gismu-derived places, that covers every
field of all 9 doctypes; a compiler that turns each definition into a
self-documenting Ajv `data_schema` registered through the existing path; and `todos`
migrated end-to-end on mainnet as the working proof.

**Completion condition** (identical to frontmatter `goal`):

> A predicate vocabulary seed covers every field of all 9 current doctypes (todos,
> contact, invoice_doc, booking, tx, match, invoice, bank_statement, contract) —
> proven by a coverage test (exit 0) that fails on any unmapped field; the compiler
> generates a self-documenting Ajv data_schema per predicate (unit test exit 0); the
> `pred:*` schemas are registered; todos is migrated on mainnet (3 `task` + 3
> `valid`; `SELECT * FROM v_task WHERE open` returns the 3 German titles); a
> malformed task is rejected by data_crud while a valid one is accepted; legacy
> doctypes stay intact (additive); and `bun run check` and `bun run lint` exit 0.

## Approach

**Predicate definition (the seed artifact).** Pragmatic English name + gismu
provenance + place structure; the compiler expands `role`→`title`, `gloss`→
`description`, adds `examples` — self-documenting, so it reads well to the LLM
(`schemasPromptHint`, data.ts:255) and the DB viewer.

```jsonc
{ "predicate": "address", "gismu": "judri",
  "gloss": "x1 (a locator) addresses x2 (entity) within system x3",
  "places": [
    { "pos": "x1", "role": "address", "kind": "value", "type": "string", "minLength": 1, "gloss": "the locator string", "required": true },
    { "pos": "x2", "role": "entity",  "kind": "ref",   "references": "*",  "gloss": "who/what this addresses", "required": true },
    { "pos": "x3", "role": "system",  "kind": "value", "type": "string", "gloss": "postal|email|phone|iban|vat|handelsregister", "required": true } ] }
```

**Coverage = the metric.** A `mapping` table states, per doctype, how each legacy
field maps to a `(predicate, place)`. e.g. `contact.email → address.x1 (x3='email')`,
`contact.iban → address.x1 (x3='iban')`, `tx.amount → pays.x2`, `tx.counterparty →
pays.x3`, `booking.lines[].soll_konto → posting.x2`. A test iterates every property
of every doctype schema and **fails if any field is unmapped** — that is what
"covers everything" means, provably. One predicate often covers many fields
(`address`≡`judri` collapses street/email/phone/iban/vat/register).

**Sketch of the covering vocabulary** (build pins exhaustively): `task`,
`valid`/`asserted` (time), `names`(cmene), `person`(prenu), `company`(kagni),
`address`(judri), `pays`(pleji), `exchanges`(canja), `sourced_from`(krasi),
`manages`(jatna), `note`(notci), `categorized`(klesi), `worth`/`balance`, plus
coined `journal_entry`/`posting`/`taxes` (SKR04), `line_item`, `invoices`,
`matches`, `document` (ingested-doc envelope).

**CRUD is NOT rewritten.** Predications ride the existing `createValue` /
`executeDataTool` path unchanged. "done" = patch the `valid` row's `x3` (existing
merge-validate update already supports it). Use `pattern` regexes, **not** `format`
(the Ajv instance at data.ts:13 has no `ajv-formats`).

**todos proof + projection.** Migrate the 3 todos → `task`(x1=user ref, x2=title) +
`valid`(x1=task, x2=created_at, x3=null), ids preserved, additive. Create `v_task`
(places→named columns + valid joined) as the read face.

**End state = no legacy doctypes.** Additive within this card (legacy schemas + rows
preserved → reversible, metric provable). Dropping the legacy doctypes is the
**/ship cutover** (HITL, irreversible), out of this card's metric.

## Steps

1. **Enumerate** all current doctype schemas (mainnet `data_schema` names + the vibe
   `*_SCHEMA` constants + `doctype.json` files); confirm `ajv-formats` absent.
2. **Compiler + types:** predicate-definition type and `definition → Ajv json_schema`
   compiler (emits title/description/examples + `predicate` const + `x-ref`);
   unit-test it.
3. **Author the vocabulary seed** covering all 9 doctypes (English names, `gismu`
   provenance, glosses), as a single dogfooded seed module.
4. **Mapping + coverage test:** a per-doctype field→(predicate,place) mapping and a
   test that fails on any unmapped property of any doctype schema.
5. **Register** `pred:*` `data_schema` rows from the compiler output.
6. **Migrate todos** (idempotent, additive): 3 `task` + 3 `valid`, ids preserved.
7. **View:** create `v_task`.
8. **Round-trip test** through real `data_crud`: valid `task` accepted, malformed rejected.
9. **Rehearse then apply:** run on a Neon branch off `billowing-violet-90988280`
   first (rollback snapshot), then apply to mainnet.
10. **Verify** with the coverage/compiler/round-trip tests + SQL + `check`/`lint`.

## Files to touch

- `<server data pkg>/.../predicate/compile.ts` (new) — definition → Ajv compiler.
- `<server data pkg>/.../predicate/vocab.ts` (new) — the seed vocabulary (all predicates).
- `<server data pkg>/.../predicate/mapping.ts` (new) — doctype field → (predicate, place).
- `<server data pkg>/.../migrations/NNNN_predication_seed.ts` (new, Kysely) — register pred schemas, migrate 3 todos, create `v_task`.
- `<server data pkg>/.../predicate/*.test.ts` (new) — compiler unit + coverage + data_crud round-trip.
- `libs/betterauth/src/data.ts` — reuse as-is; only add a thin predication facade if needed.
- `libs/aven-board/board/discover/0085-universal-predication-schema.md` — this card.

## Acceptance criteria

Each checkable from the transcript (a command + its output proves it).

- [ ] Compiler unit test passes (definition → valid self-documenting Ajv schema with title/description) — `bun test` exit 0.
- [ ] **Coverage:** every property of all 9 doctype schemas maps to a `(predicate, place)` — coverage test exit 0; deliberately unmapping a field makes it fail.
- [ ] `pred:*` `data_schema` rows registered — `SELECT count(*) FROM data_schema WHERE name LIKE 'pred:%'` ≥ the vocabulary size.
- [ ] todos migrated — `SELECT s.name, count(*) … WHERE s.name IN ('pred:task','pred:valid') GROUP BY s.name` returns 3 / 3, task ids = original todo ids.
- [ ] `SELECT what, open FROM v_task WHERE open` returns exactly the 3 German titles, all open.
- [ ] Round-trip: well-formed `task` accepted, malformed rejected — data_crud test exit 0.
- [ ] Additive: legacy `todos` schema + 3 rows unchanged — count/diff query.
- [ ] `bun run check` and `bun run lint` exit 0.

## Verification

```bash
bun run check
bun run lint
bun test <server data pkg>/.../predicate    # compiler + coverage + data_crud round-trip
# Mainnet (via Neon, output in transcript):
#   SELECT count(*) FROM data_schema WHERE name LIKE 'pred:%';
#   SELECT s.name, count(*) FROM data_value v JOIN data_schema s ON s.id=v.schema_id
#     WHERE s.name IN ('pred:task','pred:valid') GROUP BY s.name;
#   SELECT what, open FROM v_task WHERE open;
```

## Program — follow-on cards (the rest of the e2e migration)

This card seeds the vocabulary + proves it on todos. The remaining slices:

- **Migrate each doctype's data** → predications (tx, booking/SKR04 incl. nested
  lines→child postings, invoice_doc incl. version chain→bitemporal, contact bundle,
  match, ingested invoice/bank_statement/contract).
- **Rewire the vibes** (Todos/Bookings/Transactions/Invoice/Addressbook) to read/write predications.
- **Rewire the LLM tools** (`data_crud`, `todos`/`bookkeeping` tools) to the predicate vocabulary.
- **[[0086-predication-aware-db-viewer]]** — render x1–x5 legibly.
- **LLM predicate-minting** — `infer_predicate(instance)` on write.
- **Discover-&-consolidate skill** — align decentralized evolving vocab across peers.
- **Meta-circular registry** — store predicate definitions themselves as predications.
- **/ship cutover** — drop the legacy doctypes after sign-off (HITL).

## Hand-off

```
/aven-build 0085
```

## Progress log

Newest entry first.

- `2026-06-29` — Re-scoped from "todos pilot" to "seed the vocabulary covering ALL 9 current doctypes" (todos/contact/invoice_doc/booking/tx/match/invoice/bank_statement/contract) + compiler + coverage test, with todos migrated as the working proof; locked naming rule (English names, gismu-derived x1–x5 places via `gismu:` provenance); enumerated doctypes from aven-vibes; data migration of other doctypes + vibe/tool rewiring carved into the Program section as follow-on cards.
- `2026-06-29` — Discovery: verified live mainnet shape via Neon; locked truly-universal model (predicate + x1–x5, time as standalone reusable `valid`/`asserted`, `references:"*"`); refinements (self-documenting schemas mandatory, `pattern` not `format`, base CRUD generic so no rewrite, legacy dropped at /ship cutover). Created in discover/.

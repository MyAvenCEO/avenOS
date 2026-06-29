---
title: Real runs + the invoice vertical — first slice of the skills/ontology migration
summary: Kill the seeded run fixtures (RunsView reads ONLY real flow_run rows via a real endpoint), and migrate the invoice vertical onto the generic runner end-to-end — an extract_invoice actor (real gemma vision) producing a NEW ontology `invoice` composite type (janta/jdima + reused due/krasi/finti provenance), then MIGRATE the existing old `invoice` JSON-blob data into predications and DROP the old schema. Proves the full flow-migration + schema-migration pattern on one vertical; tx/contact/booking/match are follow-on. mainnet Postgres only; aven-db CRDT untouched.
owner: claude
created: 2026-06-29
updated: 2026-06-29
tags: [postgres, skills, runner, ontology, migration, invoice]
goal: First slice of the skills/ontology migration (follow-on to 0089), proven by a live run + tests — (1) NO seeded runs: EXAMPLE_RUNS + configs/runs.json removed (`rg EXAMPLE_RUNS` empty) and RunsView reads ONLY real `flow_run` rows via GET /api/skills/runs (a real persisted run shows in the UI's data); (2) the invoice vertical runs on the GENERIC runner: the capture/invoice flow (from the `flow` table) with an `extract_invoice` actor (real gemma vision) produces a NEW ontology `invoice` composite type — data_crud(invoice,list) returns number/amount/vendor/due plus `krasi` provenance linking the invoice → its source artifact + run; (3) the OLD `invoice` JSON-blob data_schema is MIGRATED (existing rows → invoice predications) and DROPPED — SQL shows no `invoice` blob schema and the data survives as predications; and `bun run check` + the new tests exit 0. aven-db CRDT untouched; tx/contact/booking/match migration = follow-on cards.
---

# Real runs + the invoice vertical

## Context

Board 0089 built the generic flow runner + the ArtifactStore + the `document` ontology type with
generic `krasi`/`finti` provenance, and persists real `flow_run` rows. But the **Runs UI still reads
seeded fixtures** (`EXAMPLE_RUNS` from `aven-skills/configs/runs.json`), and only `doc-ingest` is
migrated — the other flows are descriptive, and the OLD dynamic JSON-blob schemas (`invoice`, `tx`,
`contact`, `booking`, `match`) still hold data alongside the new predication types.

This is the **first slice** of finishing the migration: prove the full pattern on ONE more vertical
(invoice) while killing the run fixtures. The remaining flows + schemas repeat this proven pattern as
follow-on cards. See [[flow-engine-actor-model]], [[universal-predication-schema-0084]] (0088 engine),
[[two-layer-schema-split]], [[ontology-gismu-skill]], [[avendb-crdt-vs-mainnet-postgres]].

## Decisions (locked with the user)

- **First slice = real runs + the invoice vertical** (not the whole migration; the rest are follow-on).
- **Old schema disposition = migrate + drop IN this slice** (for `invoice` only): move existing
  `invoice` blob rows into the new ontology type, then drop the old `invoice` data_schema. The data
  survives as predications — no loss. `tx`/`contact`/`booking`/`match` stay until their own cards.
- **Real runs only** — no fixtures anywhere; RunsView reads the real `flow_run` table.
- **Real gemma vision** for the extract actor (consistent with 0089's classify).

## Gismu (grounded in the ontology lexicon)

- `invoice` ≡ **janta** — x1 (account/bill) for goods/services x2, billed to x3 by x4 → adapted owner-first.
- `amount` ≡ **jdima** — x1 price of x2 … → invoice's amount.
- `vendor` — the biller (a value name for this slice; a `contact` ref is a follow-on once contacts migrate).
- REUSE `due` ≡ detri, `source` ≡ krasi (PROVENANCE → the artifact), `produced` ≡ finti (→ the run).

## Approach

- **Real runs:** add `GET /api/skills/runs` (list the user's `flow_run` rows, newest first) in
  `skills-run.ts`; `RunsView.svelte` reads it via `createQuery` instead of importing `EXAMPLE_RUNS`.
  Remove `EXAMPLE_RUNS`/`getRuns` from `aven-skills/flow.ts` + delete `configs/runs.json`.
- **invoice ontology type:** a 0090 `invoice` composite TypeSpec (aven-ontology) — `invoice`(janta) +
  `amount`(jdima) + `vendor` value, reusing `due`/`source`/`produced` parts; registered in
  `predicate_type` (migration) + its atomic schemas seeded via `ensurePredicateSchemas`.
- **invoice flow on the runner:** an `extract_invoice` actor (real gemma vision, forced tool-call to
  the invoice schema) wired into `docIngestActors`→`skillActors`; the `capture`/`invoice` flow loads
  from the `flow` table and runs on the SAME generic runner; persists via `data_crud(invoice,…)`,
  carrying the source artifact + run for provenance.
- **migrate + drop old invoice:** a migration reads existing `invoice` data_value rows, writes the
  equivalent invoice predications (mapping the blob fields → places), then DROPs the old `invoice`
  data_schema (cascading its now-redundant blob rows). Idempotent.

**Out of scope (follow-on cards):** migrating tx/contact/booking/match flows + schemas; a `contact`
ontology type (so `vendor` can become a ref); RunsView live-streaming a running flow; supervision/HITL.

## Steps (small, checkpointed)

1. **Real runs** — `GET /api/skills/runs` + RunsView reads it; delete `EXAMPLE_RUNS`/`runs.json`. **Checkpoint.**
2. **invoice ontology type** — janta/jdima/vendor + reuse due/source/produced; register in predicate_type; seed schemas. data_crud(invoice,create→list) round-trips with provenance. **Checkpoint.**
3. **extract_invoice actor + invoice flow** — real gemma vision extract; the flow runs on the generic runner; a run persists + shows in the real Runs UI. **Checkpoint.**
4. **Migrate + drop old invoice schema** — old `invoice` rows → predications; DROP the old data_schema; SQL proves it's gone + data survives. **Checkpoint.**
5. **Verify** — live run in real Runs UI + invoice via engine + old schema gone + repo gates.

## Files to touch

- `libs/aven-skills/src/flow.ts` — remove `EXAMPLE_RUNS`/`getRuns`; `libs/aven-skills/configs/runs.json` — delete.
- `libs/betterauth/src/skills-run.ts` — `listRuns` (GET) + the `extract_invoice` actor + invoice persistence.
- `libs/betterauth/src/server.ts` — wire `GET /api/skills/runs`.
- `app/src/lib/data/client.ts` — `listRuns`; `app/src/lib/shell/RunsView.svelte` — read real runs.
- `libs/aven-ontology/src/invoice-spec.ts` (new) + index; `libs/aven-vibes/src/predicate/*` — janta/jdima/vendor vocab.
- `libs/betterauth/migrations/NNNN_predicate_type_invoice.ts` (new) — seed the invoice type.
- `libs/betterauth/migrations/NNNN_migrate_drop_invoice.ts` (new) — migrate old invoice rows → predications, drop old schema.
- `libs/betterauth/src/data.ts` — `ensurePredicateSchemas` seeds invoice predicates.
- `libs/aven-board/board/discover/0090-real-runs-invoice-vertical-migration.md` — this card.

## Acceptance criteria

Each provable from the transcript.

- [ ] `rg "EXAMPLE_RUNS|configs/runs.json" libs app` empty; `runs.json` deleted.
- [ ] `GET /api/skills/runs` returns the user's real `flow_run` rows; RunsView renders them (a real run from 0089 appears, no "Acme Ltd — Invoice 2026-…" fixtures).
- [ ] `invoice` registered in `predicate_type`; `data_crud(invoice, create→list)` returns number/amount/vendor/due.
- [ ] A live invoice run on the generic runner persists a `flow_run` + an `invoice` with `krasi` provenance to the source artifact + `finti` to the run (SQL/engine query).
- [ ] OLD `invoice` data_schema DROPPED — `SELECT … FROM data_schema WHERE name='invoice'` empty; pre-existing invoice data present as predications.
- [ ] `bun run check` + the new tests exit 0; aven-db untouched (no spark/CRDT writes).

## Verification

```bash
rg -n "EXAMPLE_RUNS|configs/runs.json" libs app           # expect: empty
(cd libs/aven-ontology && bun run check && bun test)
(cd libs/betterauth && bun run check)
# Live (running auth server, output in transcript):
#   GET /api/skills/runs                         → the real flow_run rows
#   POST /api/skills/<invoice-flow>/run (a file) → run done; data_crud(invoice,list) + provenance
#   SELECT name FROM data_schema WHERE name='invoice';   → empty (dropped)
#   SELECT count(*) FROM data_value dv JOIN data_schema ds ON ds.id=dv.schema_id WHERE ds.name='invoice'; → 0
```

## Hand-off

```
/aven-build 0090
```

## Progress log

Newest entry first.

- `2026-06-29` — Discovery. Follow-on to 0089. User locked: first slice = real runs + the invoice
  vertical; old `invoice` schema = MIGRATE + DROP in this slice (data survives as predications);
  real gemma vision extract. Grounded gismu: invoice≡janta, amount≡jdima, reuse due/krasi/finti.
  5 checkpointed steps. Out of scope: tx/contact/booking/match (follow-on cards), contact ontology
  type, live run streaming, supervision/HITL. Created in discover/.

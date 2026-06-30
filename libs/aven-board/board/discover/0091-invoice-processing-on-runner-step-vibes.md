---
title: Invoice Processing end-to-end on the generic runner — ontology actors + per-step vibe cards in chat
summary: Run the EXISTING "Invoice Processing" composite (doc-ingest → Map Brain → Bookkeeping → review) through the generic runner, with ALL actors reimplemented on the x1–x5 ontology (extract→invoice, enrich→contact, match→mapti, book→booking; review auto-approves), and STREAM each step's vibe card into the chat (classification, doc-compare, invoice-booking) via a runner onStep→aven_vibe mechanism. Consolidate onto this one flow (delete the redundant invoice-ingest) and migrate+drop the old tx/contact/booking blob schemas. mainnet Postgres only; aven-db CRDT untouched.
owner: claude
created: 2026-06-29
updated: 2026-06-29
tags: [postgres, skills, runner, ontology, vibes, invoice, bookkeeping, migration]
goal: Running the EXISTING "Invoice Processing" flow (id `invoice`, loaded from the `flow` table) through the generic runner ingests one invoice END-TO-END on the ontology, streaming a vibe card PER step into the chat — proven by a live run + tests: (1) the flow FLATTENS and every step runs via runner actors reimplemented on the ontology (storeDocument, classify_document, extract→invoice type, enrich→`contact`(prenu) type, match→`mapti` link, book→`booking` type, review AUTO-APPROVES) — a live run persists a `flow_run` with the full trace AND `invoice`/`contact`/`booking`/`match` predications carrying krasi/finti provenance (data_crud + SQL); (2) the chat STREAMS an `aven_vibe` card per step (classification, doc-compare, invoice-booking) via a runner `onStep`→emit mechanism (a chat turn shows the cards, not just text); (3) the redundant `invoice-ingest` flow is REMOVED and `run_skill` drives "Invoice Processing"; (4) the old blob schemas `tx`/`contact`/`booking` are migrated→predications and DROPPED (like 0090 did `invoice`); and `bun run check` + the new tests exit 0. aven-db CRDT untouched; HITL review = follow-on (auto-post for now).
---

# Invoice Processing on the runner + per-step vibe cards

## Context

Board 0090 proved the pattern on a minimal `invoice-ingest` (doc-ingest + extract). But the REAL flow is
the existing **Invoice Processing** (`invoice`) composite — which already reuses doc-ingest and adds the
brain + bookkeeping. It flattens to:

```
storeDocument → classify_document → extract_document → enrichAddressbook → matchInvoiceAgainstTx → bookInvoice → humanReview
```

The runner has the first three actors; the rest exist only as **legacy logic in ai.ts** (the deprecated
in-chat doc path, board 0064/0065) that ALSO streamed per-step vibe cards (`doc-compare`,
`invoice-booking`). Two gaps to close: (a) those steps aren't runner actors on the ontology yet, and
(b) `run_skill` doesn't stream the per-step vibe views the user expects in chat (classification card was
lost). `TraceStep` already has `vibe`/`vibeData` slots; the runner just needs to emit per-step events.

See board 0089/0090, [[flow-engine-actor-model]], [[universal-predication-schema-0084]] (0088 engine),
[[ontology-gismu-skill]], [[two-layer-schema-split]], [[avendb-crdt-vs-mainnet-postgres]].

## Decisions (locked with the user)

- **Scope = the FULL Invoice Processing flow** (ingest→classify→extract→enrich→match→book→review), not a
  new minimal flow. **Consolidate**: delete `invoice-ingest`; `run_skill` drives `invoice`.
- **Actors REIMPLEMENTED on the ontology** — fresh actors that read/write the new x1–x5 types
  (invoice/contact/booking/match predications), NOT the old blob logic.
- **review AUTO-POSTS** for now — the HITL approve gate (runner pause/resume) is a follow-on.
- **Per-step vibe cards stream into chat** — the legacy UX (classification → doc-compare → invoice-booking),
  on the new architecture.

## Gismu (grounded; build refines via the ontology skill)

- `contact` ≡ **prenu** (x1 is a person) — owner + name (+ email/tax_id parts).
- `transaction` (tx) ≡ **canja** (x1 trades commodity x2 …) — a bank movement.
- `match` ≡ **mapti** (x1 matches x2) — links an `invoice` ↔ a `tx`.
- `booking` ≡ **pleji**/**jdini** — the SKR04 posting (invoice → account → amount). REUSE `source`/`produced`.

## Approach

- **Per-step vibe streaming:** add `onStep?(step: TraceStep)` to the runner's `RunFlowOpts`; the runner
  calls it after each node, setting `step.vibe` (from the node's `vibe` config) + `step.vibeData` (the
  node's primary output). `run_skill`'s chat dispatch passes an `onStep` that does `emit({ aven_vibe: {
  schema: step.vibe, data: step.vibeData } })` + persists the `VIBE_MARKER`. Set `vibe` on the `invoice`
  flow's nodes (classify→`bookkeeping`, extract→`doc-compare`, book→`invoice-booking`).
- **Ontology types:** register `contact`/`transaction`/`booking`/`match` composite types (predicate_type)
  with gismu places + reused `source`/`produced` provenance, seeded + `ensurePredicateSchemas`.
- **Ontology actors** (betterauth `skills-run.ts`): `extract`→`invoice` (+doc-compare vibe), `enrich`→
  `contact` (prenu) + link to the invoice, `match`→`mapti` (reconcile invoice vs the user's `transaction`
  predications), `book`→`booking` (pick SKR04 account) + invoice-booking vibe, `humanReview`→auto-approve.
- **Consolidate + migrate:** `run_skill` default for invoices = `invoice`; delete `invoice-ingest` (flow +
  migration). Migrate+drop the old `tx`/`contact`/`booking` blob schemas into predications (like 0090's
  invoice park→convert→drop).

**Out of scope (follow-on):** the HITL review pause/resume in the runner; `capture-bank`/`kontoauszug`
(bank statement) vertical; a visual flow editor.

## Steps (small, checkpointed)

1. **Per-step vibe streaming** — runner `onStep` + node `vibe` config; `run_skill` emits `aven_vibe` per
   step; a live run shows a card per step in chat. **Checkpoint.**
2. **contact/transaction/booking/match ontology types** — registered (predicate_type) + seeded; data_crud
   round-trips with provenance. **Checkpoint.**
3. **Ontology actors** — extract/enrich/match/book/review reimplemented on the new types, each with its
   vibe; unit-ish + a live partial run. **Checkpoint.**
4. **Run "Invoice Processing" end-to-end** — flatten + run all steps; persists the full trace + all
   predications; `run_skill` drives `invoice`; delete `invoice-ingest`. **Checkpoint.**
5. **Migrate + drop old tx/contact/booking blobs** → predications; SQL proves the blobs are gone. **Checkpoint.**
6. **Verify** — live full run + per-step vibe cards + ontology predications + repo gates.

## Files to touch

- `libs/aven-skills/src/runner/runner.ts` — `onStep` hook + `vibe`/`vibeData` on each TraceStep.
- `libs/aven-skills/configs/flows.json` — `vibe` on the `invoice` flow nodes; delete `invoice-ingest`.
- `libs/aven-ontology/src/{contact,transaction,booking,match}-spec.ts` (new) + index.
- `libs/aven-vibes/src/predicate/*` — prenu/canja/mapti/booking vocab.
- `libs/betterauth/src/skills-run.ts` — the ontology actors (extract/enrich/match/book/review) + `run_skill` onStep wiring.
- `libs/betterauth/src/ai.ts` — `run_skill` dispatch passes `onStep` → `aven_vibe` per step.
- `libs/betterauth/migrations/*` — seed the new types; migrate+drop tx/contact/booking; drop invoice-ingest flow.
- `libs/aven-board/board/discover/0091-invoice-processing-on-runner-step-vibes.md` — this card.

## Acceptance criteria

Each provable from the transcript.

- [ ] Runner `onStep` fires per node with `vibe`/`vibeData`; unit test exit 0.
- [ ] `contact`/`transaction`/`booking`/`match` registered in `predicate_type`; `data_crud(<type>,create→list)` round-trips with provenance.
- [ ] A live `run_skill` on "Invoice Processing" runs ALL steps (trace has store→classify→extract→enrich→match→book→review) and persists `invoice`+`contact`+`booking`+`match` predications with krasi/finti.
- [ ] The chat turn STREAMS a vibe card per step (classification, doc-compare, invoice-booking) — `aven_vibe` events in the SSE.
- [ ] `invoice-ingest` removed (`rg` empty); `run_skill` drives `invoice`.
- [ ] Old `tx`/`contact`/`booking` blob schemas DROPPED (SQL); data present as predications.
- [ ] `bun run check` + new tests exit 0; aven-db untouched.

## Verification

```bash
(cd libs/aven-skills && bun run check && bun test)     # runner onStep + specs
(cd libs/aven-ontology && bun run check && bun test)
(cd libs/betterauth && bun run check)
rg -n "invoice-ingest" libs                            # expect: empty (consolidated)
# Live (running auth server, output in transcript):
#   POST /api/ai/chat (attach invoice, "book this invoice") → aven_vibe per step + a flow_run
#   data_crud(invoice|contact|booking|match, list)  → the predications + provenance
#   SELECT name FROM data_schema WHERE name IN ('tx','contact','booking') AND json_schema->'properties'->'predicate' IS NULL;  → empty
```

## Hand-off

```
/aven-build 0091
```

## Progress log

Newest entry first.

- `2026-06-29` — Discovery. Follow-on to 0090 after review feedback (use the existing Invoice Processing,
  not a new flow; stream per-step vibe cards in chat). User locked: FULL flow on the runner, actors
  REIMPLEMENTED on the ontology, review auto-posts (HITL follow-on). Grounded the flatten chain
  (storeDocument→classify→extract→enrich→match→book→review) + the legacy vibe cards (doc-compare,
  invoice-booking) + that TraceStep already has vibe/vibeData. Also absorbs the tx/contact/booking
  ontology migration. 6 checkpointed steps. Out of scope: HITL pause/resume, bank-statement vertical,
  flow editor. Created in discover/.

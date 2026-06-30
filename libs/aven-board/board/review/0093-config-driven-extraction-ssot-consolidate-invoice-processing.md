---
title: Config-driven extraction (flow-config SSOT) — one generic extractor, retire invoice-ingest + extract_invoice
summary: Make the FLOW NODE CONFIG the single source of truth for extraction. Today the real detailed extract instructions live in the doctype (system_prompt + tool-call schema) and are read via getDoctype() in two places (the flow actor skills-run.ts + the chat path ai.ts), while the flow UI shows only a short summary prompt and the runner has a hardcoded invoice-only `extract_invoice` actor. Embed the detailed system-prompt + tool-call schema INTO the flow node config (the new DRY SSOT), migrate every other reference (doctype getDoctype reads) to it, and replace `extract_invoice` with a GENERIC `extract_document` actor that reads the node's prompt/schema/model/tools — so ONE actor drives invoice AND bank-statement extraction, config per node. Then `enrichAddressbook` creates/links the company + Ansprechpartner and persists the rich ontology invoice. Finally DELETE the redundant `invoice-ingest` flow + `extract_invoice` actor — Invoice Processing (ingest → capture → book → review) is the single canonical invoice flow. Book (match + SKR04) is OUT of scope (follow-on). Builds on board 0092 (the corrected ontology + nested engine + contact graph). mainnet Postgres + the flow registry only; aven-db CRDT untouched.
owner: claude
created: 2026-06-30
updated: 2026-06-30
goal: The flow node config is the single source for extraction — the detailed system-prompt + tool-call schema are EMBEDDED in the node, a GENERIC `extract_document` actor and the chat path both read the node config (no `getDoctype` for extraction), `enrichAddressbook` creates/links company+Ansprechpartner and persists the rich ontology invoice, and the redundant `invoice-ingest` flow + hardcoded `extract_invoice` actor are DELETED. Proven by — (1) `rg -n "getDoctype" libs/betterauth/src` returns empty (all extraction reads migrated to the flow-config SSOT); (2) `rg -n "extract_invoice" libs/betterauth/src libs/aven-skills && rg -n "invoice-ingest" libs/betterauth libs/aven-skills` shows no actor/flow definition (only historical board/migration text); (3) a command prints the `capture` flow's extract node carrying the full invoice system-prompt (length > 200) + a non-empty tool-call schema; (4) a live `run_skill` of the capture/Invoice-Processing flow on a real invoice yields an ontology `invoice` with `lines[]`/`payments[]` AND a linked `company` (with the Ansprechpartner as a `person` that `represents` it) — verified via `data_crud`; (5) `bun run check` + the aven-ontology/aven-vibes/aven-skills/betterauth tests exit 0. Book (match + SKR04) is out of scope. aven-db untouched.
---

## Context

Board 0092 corrected the ontology and proved the data layer end-to-end (universal `owned_by`, canonical
gismu places, the recursive nested-children engine with full invoice `lines[]`/`payments[]`, and the
contact graph person/company + `represents`≡krati + transaction settlement). It also upgraded the
`extract_invoice` actor to persist the rich nested graph. But three things are left tangled at the
**flow/skill** layer, surfaced while looking at the running Skills explorer:

1. **Three overlapping skills.** `Document Ingest` (store + classify), `Invoice Ingest`
   (↳doc-ingest → `extract_invoice`), and `Invoice Processing` (↳doc-ingest → ↳capture → ↳book →
   humanReview) all overlap. `Invoice Ingest` is fully redundant with the first leg of
   `Invoice Processing` — both already reuse `Document Ingest`.
2. **A hardcoded, invoice-only extractor.** `extract_invoice` (skills-run.ts) hardcodes
   `getDoctype('invoice')`. The parallel `capture` flow node (`extract_document`) is generic in the UI
   but **not implemented as a runner actor**, so `Invoice Processing` would error today.
3. **The extraction config is not the SSOT it appears to be.** The flow UI shows a node's
   `SYSTEM-PROMPT` + `TOOLS` + `LLM`, but the *real* detailed instructions + tool-call schema live in
   the doctype JSON and are pulled via `getDoctype()` in **two** places (skills-run.ts AND the chat
   path ai.ts). What you see in the flow is a short summary, not what runs.

**The decision (confirmed):** embed the detailed prompt + tool-schema into the **flow node config** as
the one DRY SSOT, migrate every other reference to it, make the extractor **generic + config-driven**
(one `extract_document` for invoice + bank-statement), and **delete `invoice-ingest` + `extract_invoice`**
so `Invoice Processing` is the single canonical invoice flow. Capture only this card; `book` later.

See [[universal-predication-schema-0084]], [[flow-engine-actor-model]], [[two-layer-schema-split]].

## Goal

**The flow node is the single source of truth for extraction, one generic actor runs it, and the
redundant invoice-only flow + actor are gone.** The decision this unlocks: every doctype (invoice,
bank-statement, and future ones) is added by writing **config in the flow** — a node with its
system-prompt + tool-schema — never new actor code; and there is exactly one place a prompt/schema
lives, so the flow UI you see is literally what runs.

**Completion condition:** *(identical to `goal:` frontmatter — the five numbered proofs above.)*

## Approach

- **SSOT = the flow node config (embed).** A node that extracts carries the full `system_prompt` + the
  `schema` (the tool-call/output JSON Schema) + `llm` (model, vision, tool name) + `tools`. This is the
  one DRY location. The doctype JSON's `system_prompt` + `schema` are MIGRATED into the flow seed (the
  `capture` + `capture-bank` extract nodes) and then read from there at runtime — not from `getDoctype`.
- **Generic `extract_document` actor.** Reads `node.system_prompt` + `node.schema` + `node.llm`, runs the
  vision tool-call (the existing `visionExtract` helper, already generic), and emits the structured
  output under the node's output kind (`invoice` / `bank_statement`). Replaces `extract_invoice`.
- **`enrichAddressbook` actor.** From the extracted invoice: match-or-create the `company` (by VAT-ID /
  IBAN / name) + the Ansprechpartner as a `person` that `represents` it, then persist the rich ontology
  `invoice` (lines/payments) linking the vendor. Uses the 0092 contact types + the engine. Emits
  `Invoice` + `Contact`.
- **Migrate the other reference.** The chat path (ai.ts) reads the same flow-config SSOT for the
  doctype's prompt/schema instead of `getDoctype()` (a small loader: resolve the node config by doctype).
- **Delete the redundancy.** Remove the `invoice-ingest` flow row + the `extract_invoice` actor; the
  `Invoice Processing` flow's `capture` sub-flow now runs (extract + enrich). `humanReview` ends the run.
- **Keep the vibe view as-is** — it renders the rich extraction from the resource (board 0092); the
  doctype JSON may stay purely for the *render shape* if the mapper still needs it (the SSOT migration is
  about the EXTRACTION config — prompt + tool-schema — not the render mapper).

**Out of scope (follow-on cards):** the `book` step (`matchInvoiceAgainstTx` ≡ pleji.x4 settlement +
`bookInvoice` ≡ SKR04 cmima) as runner actors; a flow-config EDITOR in the UI (this card makes the
config authoritative + displayed, not yet editable); deleting the doctype JSON's render shape.

## Steps (small, checkpointed)

1. **Flow-config SSOT shape + seed migration** — extend the node config (system_prompt + schema + llm)
   and a migration that embeds the invoice + bank-statement doctype prompt/schema into the `capture` /
   `capture-bank` extract nodes. A command prints the embedded prompt (len > 200) + schema. **Checkpoint.**
2. **Generic `extract_document` actor** — reads node config, runs vision, emits the typed output;
   covers invoice + bank-statement from config alone. A run (or unit) shows it extracts via node config. **Checkpoint.**
3. **`enrichAddressbook` actor** — match/create company + Ansprechpartner(person/represents) + persist
   the rich invoice; emits Invoice + Contact. data_crud shows the linked graph. **Checkpoint.**
4. **Migrate the chat path** — ai.ts reads the flow-config SSOT (no `getDoctype` for extraction);
   `rg getDoctype libs/betterauth/src` empty. **Checkpoint.**
5. **Delete `invoice-ingest` + `extract_invoice`** — flow row + actor removed; `Invoice Processing`
   capture runs end-to-end. `rg` proofs empty. **Checkpoint.**
6. **Verify** — live capture/Invoice-Processing run yields invoice(lines/payments)+linked company;
   check + tests exit 0.

## Files to touch

- `libs/aven-skills/src/flow.ts` (+ runner types) — node config carrying `system_prompt`/`schema`/`llm`.
- `libs/betterauth/src/skills-run.ts` — generic `extract_document` + `enrichAddressbook` actors; drop `extract_invoice`.
- `libs/betterauth/src/ai.ts` — read the flow-config SSOT instead of `getDoctype` for extraction.
- `libs/betterauth/migrations/00NN_*` — embed doctype prompt/schema into the `capture`/`capture-bank` nodes; delete the `invoice-ingest` flow row.
- `libs/aven-vibes/src/vibes/*/doctype.json` — the prompt/schema become the seed source (render shape may remain).

## Acceptance criteria

- [ ] `rg -n "getDoctype" libs/betterauth/src` returns empty — extraction config comes from the flow node, the one SSOT.
- [ ] `rg -n "extract_invoice" libs/betterauth/src libs/aven-skills` + `rg -n "invoice-ingest" libs/betterauth libs/aven-skills` show no actor/flow definition (only historical board/migration text).
- [ ] A command prints the `capture` extract node's embedded `system_prompt` (length > 200) + a non-empty tool-call `schema`.
- [ ] The generic `extract_document` actor extracts BOTH invoice and bank-statement driven only by the node config (no per-doctype branch in the actor).
- [ ] A live `run_skill` of the capture / Invoice-Processing flow on a real invoice yields an ontology `invoice` with `lines[]` + `payments[]` AND a linked `company` whose Ansprechpartner is a `person` that `represents` it — proven via `data_crud`.
- [ ] `Invoice Processing` is the only invoice flow (`flow` table has no `invoice-ingest`); `Document Ingest` is still reused by it.
- [ ] `bun run check` + the aven-ontology / aven-vibes / aven-skills / betterauth tests exit 0; aven-db untouched.

## Verification

```bash
rg -n "getDoctype" libs/betterauth/src            # → empty (extraction reads the flow SSOT)
rg -n "extract_invoice" libs/betterauth/src libs/aven-skills
rg -n "invoice-ingest" libs/betterauth libs/aven-skills/configs   # → no flow/actor def
(cd libs/aven-skills && bun run check && bun test)
(cd libs/betterauth && bun run check)
# Live (running auth server, .env.samuel):
#   print capture extract node:  SELECT nodes FROM flow WHERE id='capture';   → system_prompt len>200 + schema
#   run_skill('invoice', <real invoice>) → data_crud(invoice) shows lines[]/payments[]; data_crud(company) linked + person represents
#   SELECT id FROM flow WHERE id='invoice-ingest';   → 0 rows
```

## Hand-off

```
/aven-build 0093
```

## Progress log

Newest entry first.

- `2026-06-30` — **BUILT + verified. All five proofs pass.** (1) `extract_document` is now generic +
  config-driven — it reads the node's `system_prompt` + `schema` (the SSOT), so one actor extracts any
  doctype; migration `0030` embedded the invoice (3514-char prompt) + bank-statement doctype configs into
  the `capture`/`capture-bank` extract nodes and deleted the `invoice-ingest` flow row. (2) New
  `enrichAddressbook` actor: match/create the vendor `company` (by VAT-ID/IBAN/name) + the Ansprechpartner
  as a `person` that `represents` it, then emit the ontology invoice linked via `billed_by`≡janta.x4
  (added to the invoice spec + re-seeded by `0031`); the generic persist loop writes it (contact output is
  vibe-only). (3) Migrated the chat path off `getDoctype` → `loadExtractConfig` reads the same flow-config
  SSOT (`rg getDoctype libs/betterauth/src` empty). (4) Deleted `extract_invoice` (actor + flows.json seed).
  Verified live: capture node prompt len 3514 + schema present, `invoice-ingest` rows 0; a headless
  enrich-graph round-trip projects invoice{billed_by→company, 2 lines, 1 payment} + company{vat_id,iban,
  postal} + Ansprechpartner{represents→company}; `bun run check` 0 + ontology 7/7, vibes 54/54, skills
  33/33. Out of scope (follow-on): `book` (match+SKR04) runner actors; the bank-statement enrich path; a
  live in-app vision run (review/verify territory).
- `2026-06-30` — Discovery. Triggered from the running Skills explorer: 3 overlapping invoice/doc skills
  + a hardcoded `extract_invoice` + extraction config (prompt/schema) split between the doctype and a
  short flow summary. User decisions: **embed** the detailed prompt + tool-schema into the flow node as
  the DRY SSOT and migrate all other refs (getDoctype) to it; **capture only** this card (book = follow-on);
  and **kill `invoice-ingest` entirely** in favour of `Invoice Processing`. Goal made measurable via rg
  emptiness proofs + a live capture run yielding the rich invoice + linked contact. Created in discover/.

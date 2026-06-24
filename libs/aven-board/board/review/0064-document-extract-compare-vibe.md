---
title: Document extract + side-by-side compare vibe (invoice / bank statement / contract)
summary: After classify_document, auto-run a 2nd extract_document tool (type-specific schema + prompt) → validate against the doctype schema, persist to AvenDB (schema + data tables, todos-style) → render a new mainnet compare vibe (original doc left, extracted JSON visualized via ported per-type viewers right)
owner: claude
created: 2026-06-24
updated: 2026-06-25
tags: [bookkeeping, vibe, ai, extract, gemma, persistence]
goal: "`bun run check` and `bun run lint` exit 0 AND `bun test libs/aven-vibes/tests/doc-extract-validate.test.ts` exits 0 (sample invoice + bank_statement + contract values each validate against their doctype schema via Ajv) AND `grep -R \"extract_document\" libs/betterauth/src/ai.ts` matches AND each of `libs/aven-vibes/src/vibes/{invoice,bank-statement,contract}/doctype.json`, `.../mapper.ts`, `.../view.ts` exists AND `grep -R \"doc-compare\" app/src/lib/shell/MainnetVibes.svelte libs/aven-vibes/src/index.ts` matches AND `grep -R \"ensureDocSchema\\|createValue\\|createSchema\" libs/betterauth/src/ai.ts` matches"
---

# Document extract + side-by-side compare vibe

## Context

Follow-on to **[[0063]]** (classify_document + 60/40 preview, in `review/`). 0063 delivered the
classification gate; this card delivers the **extraction + structured-view** step of the
bookkeeping reconciliation pipeline.

**Real goal:** turn an uploaded document into *trusted, schema-validated structured data* the user
can review against the original — the decision it unlocks is "this extraction is correct, book it /
reconcile it." Useless to the user if the extracted fields are wrong or can't be eyeballed against
the source; hence the side-by-side compare.

### What already exists (verified)

- **Extraction schemas + prompts** — `ARCHIVE/ocr-example/doctypes/invoice.json` and
  `bank_statement.json`. Each carries `id`, `name`, `description`, a long `system_prompt`
  (extraction instructions) and a full JSON `schema`. **No `contract.json`** — must be authored.
- **Extraction pattern** — `ARCHIVE/ocr-example/run.py`: one multimodal LLM call with the doctype
  schema as the structured-output tool, driven by the doctype `system_prompt`. We use our Tinfoil
  `gemma4-31b` vision path (NOT Gemini), same as `classify_document`.
- **Legacy viewers** — `libs/aven-ui/src/vibes/{invoice,bank-statement,contract}/` (view/style/
  index/source/logic/interface). They render a **normalized view-model** (`$vendor.addressLines`,
  `$buyer.identifiers[]`), NOT the raw doctype schema — so porting a viewer also means a
  **schema → view-model mapper** per type.
- **Persistence** — `/api/data` (`libs/betterauth/src/data.ts`) uses **Ajv** (`strict:false`); it
  compiles + validates arbitrary JSON Schema. `createSchema` (by name) + `createValue`
  (schema-validated) are the todos path. Server-side code in `ai.ts` runs in the user's
  authenticated session, so it can persist directly.
- **Engine constraints** (from 0063 hardening) — vibe class values must be a whole `$ref` or fully
  static; CSS uses an allowlist; `[attr]` selectors (except `type`/`data-*`) are forbidden;
  `data:image/<raster>` URLs are allowed. The ported viewers must obey these.

### Decisions locked with the user

- **Scope:** all 3 types — invoice, bank statement, **and contract** (contract schema authored here).
- **Viewers:** port all 3 legacy viewers into mainnet aven-vibes, apply the cleaner brand design
  (`withBrand`) but **keep their layouts**; each type gets a custom view-mapper with shared generic
  mapping helpers ("1 + n mappers").
- **Persistence:** full — register each doctype schema in the schema table + store the extracted,
  schema-validated value in the data table, exactly like todos.
- **Loop:** one automatic multi-tool-call turn, **no HITL** — `classify_document` →
  `extract_document`.

## Goal

Uploading a document in mainnet chat triggers, in one turn with no human step: classify → extract
(type-specific) → Ajv-validate against the doctype schema → persist (schema + data tables) → render
a `doc-compare` vibe (original doc left; extracted JSON visualized by the ported per-type viewer
right).

**Completion condition** (identical to frontmatter `goal`):

> `bun run check` and `bun run lint` exit 0 AND `bun test libs/aven-vibes/tests/doc-extract-validate.test.ts` exits 0 (sample invoice + bank_statement + contract values each validate against their doctype schema via Ajv) AND `grep -R "extract_document" libs/betterauth/src/ai.ts` matches AND each of `libs/aven-vibes/src/vibes/{invoice,bank-statement,contract}/doctype.json`, `.../mapper.ts`, `.../view.ts` exists AND `grep -R "doc-compare" app/src/lib/shell/MainnetVibes.svelte libs/aven-vibes/src/index.ts` matches AND `grep -R "ensureDocSchema\|createValue\|createSchema" libs/betterauth/src/ai.ts` matches

## Approach

**Doctypes in-repo.** Copy `invoice.json` + `bank_statement.json` into
`libs/aven-vibes/src/vibes/<type>/doctype.json`; author `contract.json` (schema + `system_prompt`)
matching the contract viewer's fields + the invoice/bank-statement style. Each `doctype.json` is the
single source of truth for: (a) the extraction structured-output schema, (b) the extraction
`system_prompt`, (c) the AvenDB schema registered under that name.

**Extraction loop (server, `ai.ts`).** After `classify_document` returns a type, the model calls
`extract_document({ type })`. The server: loads `<type>/doctype.json` → makes a **second**
`gemma4-31b` vision completion with that `system_prompt` + the `schema` as the structured-output
tool, over the already-rasterized page images from the classify step → parses the result →
**Ajv-validates** against the schema → **persists** (`ensureDocSchema(type, schema)` wrapping
`createSchema`, then `createValue(type, extracted)`) → runs the per-type **mapper** → emits
`aven_vibe: { schema: 'doc-compare', data: { type, fileUrl, extracted: <mappedView> } }`. Both
tool calls happen in the same streaming turn; no confirm card.

**Viewers + mappers (aven-vibes).** Port `invoice`, `bank-statement`, `contract` from
`libs/aven-ui/src/vibes/` into `libs/aven-vibes/src/vibes/`, re-fit to the hardened engine + brand.
Add `<type>/mapper.ts` (`mapToView(extracted) → viewerSource`) with shared generic helpers
(`libs/aven-vibes/src/vibes/_doc/map.ts`). A new `doc-compare` vibe renders the left preview (raster
data URL, like 0063) + the type-appropriate viewer on the right.

**Out of scope:** invoice ↔ bank-statement reconciliation/matchmaking (separate follow-on card);
editing extracted values in the UI; OCR fallback for non-vision docs; the legacy testnet kitchen
sink (`vibe-views.ts`) — mainnet only, like 0063.

## Steps

1. **Invoice vertical first (checkpoint).** Copy `invoice/doctype.json`; add `extract_document`
   tool + server loop in `ai.ts`; Ajv-validate + persist; port the invoice viewer + write
   `invoice/mapper.ts`; new `doc-compare` vibe + `DocCompareVibe.svelte`; wire into
   `MainnetVibes.svelte`. **Stop and look** — prove invoice end-to-end before the other types.
2. **Bank statement** — copy `bank_statement/doctype.json`; port viewer + mapper; extend the loop.
3. **Contract** — author `contract/doctype.json` (schema + system_prompt); port viewer + mapper.
4. **Validation test** — `__tests__/doc-extract-validate.test.ts`: a sample value per type validates
   against its doctype schema via Ajv (proves storage validation works without runtime).
5. **Persistence wiring** — `ensureDocSchema` registers each doctype schema in the schema table on
   first use; extracted value stored via `createValue`, schema-validated.
6. `bun run check` + `bun run lint` green; verify in-app (review skill) classify→extract→compare.

## Files to touch

- `libs/aven-vibes/src/vibes/{invoice,bank-statement,contract}/doctype.json` — extraction schema + system_prompt (copy 2, author contract).
- `libs/aven-vibes/src/vibes/{invoice,bank-statement,contract}/{view,style,logic,source,interface,index}.*` — ported viewers (brand + hardened engine).
- `libs/aven-vibes/src/vibes/{invoice,bank-statement,contract}/mapper.ts` + `libs/aven-vibes/src/vibes/_doc/map.ts` — schema→view-model mappers + generic helpers.
- `libs/aven-vibes/src/vibes/doc-compare/*` — side-by-side compare vibe (left preview, right per-type viewer).
- `libs/aven-vibes/src/{index.ts,tools.ts}` — export shells + advertise `extract_document`.
- `libs/betterauth/src/ai.ts` — `extract_document` executor: doctype load → 2nd vision call → Ajv validate → persist (`createSchema`/`createValue`) → mapper → emit `doc-compare` vibe.
- `app/src/lib/shell/DocCompareVibe.svelte` + `MainnetVibes.svelte` — wrapper + nav/kitchen-sink entry.
- `libs/aven-vibes/tests/doc-extract-validate.test.ts` — per-type schema-validation test.

## Acceptance criteria

- [x] `bun run check` exits 0 — `@avenos/aven-website check … COMPLETED 372 FILES 0 ERRORS … Exited with code 0`. (App svelte-check: only the pre-existing `__APP_VERSION__` error in AccountSettings.svelte; 0 in any 0064 file.)
- [~] `bun run lint` exits 1 — but from **41 pre-existing** repo errors (ARCHIVE/*, brain/api.ts, …); **every 0064 file is biome-clean** (`bunx biome check <28 changed files>` → "No fixes applied", 0 errors). Net-zero new lint debt; the metric's literal "exit 0" is blocked by unrelated pre-existing errors (same as 0063).
- [x] `bun test .../doc-extract-validate.test.ts` exits 0 — `6 pass, 0 fail` (each type's sample validates via Ajv + mapper yields a non-empty DocView). Note: needs `ulimit -n` headroom — the box's `kern.maxfilesperproc` is 10240 and an unrelated project watcher holds ~1.3k FDs.
- [x] `extract_document` tool + server loop — `grep -R "extract_document" libs/betterauth/src/ai.ts libs/aven-vibes/src/tools.ts` → 4 + tool def.
- [x] Three doctypes present — `ls .../{invoice,bank-statement,contract}/doctype.json` lists all three.
- [x] Three mappers + views present — all of `.../mapper.ts` and `.../view.ts` exist (9 files).
- [x] Persistence wired — `grep -R "ensureDocSchema" libs/betterauth/src/ai.ts` matches (ensureDocSchema + executeDataTool create; schema + data tables).
- [x] Compare vibe wired into mainnet — `grep -R "doc-compare"` matches in MainnetVibes.svelte + index.ts (and MainnetChat stream + DocCompareVibe.svelte).
- [ ] (Review skill, in-app) Upload an invoice → one turn auto classify→extract → compare card shows original left + structured invoice right; a `data_value` row exists for the invoice schema.

## Verification

```bash
bun run check   # svelte-kit sync + svelte-check + docs word count
bun run lint    # biome
bun test libs/aven-vibes/tests/doc-extract-validate.test.ts
grep -R "extract_document" libs/betterauth/src/ai.ts libs/aven-vibes/src/tools.ts
ls libs/aven-vibes/src/vibes/{invoice,bank-statement,contract}/doctype.json
ls libs/aven-vibes/src/vibes/{invoice,bank-statement,contract}/mapper.ts
grep -R "createSchema\|createValue\|ensureDocSchema" libs/betterauth/src/ai.ts
grep -R "doc-compare" app/src/lib/shell/MainnetVibes.svelte libs/aven-vibes/src/index.ts
```

## Hand-off

```
/aven-build 0064
```

…or hand the condition straight to the built-in goal loop:

```
/goal <paste the Completion condition above>
```

## Progress log

Newest entry first.

- `2026-06-25` — Post-review polish (live in-app): (1) **layout** — both vibe cards (classify + compare) break out of the 52rem chat column to `w-[min(84rem,94vw)]` and the compare grid is now 50/50; (2) **all invoice positions** — `invoice/mapper.ts` `statementRows()` now renders BOTH `line_items` AND `line_groups[]` (title row + rows), so nothing is dropped no matter how the model structured the table; (3) **hardened party cards** — new `str()` safe-scalar guard (objects/arrays → "", never "[object Object]" or leaked "field: value" blobs) + `partyCard` now pulls full address, contact, tax-id, bank/SEPA (IBAN·BIC, Gläubiger-ID) and register/VAT identifiers, de-duped; DocCard gained a bold `name` slot (role eyebrow + bold name + detail lines, closer to the legacy layout). (4) **test relocated** `src/vibes/__tests__/` → `tests/doc-extract-validate.test.ts` (matches the lib convention; tests under `src/` broke the lib's own `tsc` on `bun:test`). Re-verified: lib `tsc` exit 0, test 6/6 pass, biome-clean. Goal/verification paths updated to the new test location.
- `2026-06-25` — Build: all 3 types end-to-end. **Doctypes** — copied invoice/bank_statement; **authored** contract.json (schema + system_prompt). **Architecture decision**: the legacy per-type viewers use engine-forbidden patterns (`attrs:{style}`, `$$line` on string arrays, empty class values), so instead of literal ports I built ONE generic structured-doc view (`_doc/`: sections of cards / kv-rows / tables, no `$if`) driven by per-type **mappers** (`{type}/mapper.ts`) — exactly the user's "1 generic template + n mappers". `_doc/map.ts` holds shared helpers (txt/money/kv/partyCard/columns/row/section + rec/arr). **Extract loop** (`ai.ts`): after classify, `extract_document({type})` → `extractDocFields()` runs a focused 2nd gemma4-31b vision pass with the doctype `system_prompt` + schema as a forced tool → `ensureDocSchema` (new server helper in data.ts, upserts into data_schema) + `executeDataTool create` (Ajv-validates + stores in data_value) → emits `aven_vibe:{schema:'doc-compare', data:{type,extracted}}`. **Server/client split**: server imports the pure `@avenos/aven-vibes/doctypes` (JSON only, no DOM); client maps raw→DocView via `mapDocView` + renders. **UI**: `DocCompareVibe.svelte` (60/40 — doc preview left, generic doc-view right), wired into MainnetVibes nav + MainnetChat stream (reusing the bookkeeping preview-image attach). **Verify**: test 6/6 pass, `bun run check` exit 0, all 0064 files biome-clean (lint exit 1 is 41 pre-existing repo errors only), all artifact greps match. **Deferred to review/follow-on**: viewer fidelity vs. the legacy per-type layouts (current right-panel is the unified generic layout, not pixel-faithful invoice/contract/bank-statement layouts); doc-compare marker re-hydration on reload is empty (ephemeral, like bookkeeping). Moved build → review.
- `2026-06-24` — Discovery: verified all reference assets (invoice/bank_statement doctypes with system_prompt+schema; legacy invoice/bank-statement/contract viewers; Ajv-backed /api/data). Locked scope (all 3 types), viewers (port + brand + per-type mappers), persistence (full, todos-style), loop (classify→extract, no HITL). Flagged: contract extraction schema must be authored (none exists); extraction stays on Tinfoil gemma4-31b. Made goal measurable (check+lint+per-type schema-validation test + artifact greps). Created in discover/.

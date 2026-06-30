---
title: Canonical ontology re-audit — every wired predicate is the best-fitting gismu AND carries all x1–x5 the seed defines
summary: A deep, one-by-one re-audit of EVERY Lojban predicate we currently wire (todo + document + invoice + line + payment + person + company + transaction) against the canonical gismu lexicon (`.claude/skills/ontology/gismu.json`, 1341 entries — the SSOT). Two systemic faults — (A) INCOMPLETENESS — 31 of 34 wired predicates declare only the places they happen to use, dropping the rest of their gismu's defined places; we want ALL x1–x5 the seed defines, the unused ones nullable/optional. (B) PREDICATE PROLIFERATION — we mint a separate predicate per channel/identifier (`email`/`phone`/`iban`/`postal` each ≡ judri; `vat_id`/`tax_number` each ≡ cmene) to dodge stuffing a short category label into a ref slot, instead of one predicate that carries the category IN its proper x-position. Plus two known mismatches the current gate already excludes — `classified`≡klesi (a value crammed where the seed wants structure) and the transitional `vendor`. Fix all together: consolidate the channels into ONE `address`≡judri (x3=system, a ref to a seeded addressing-system entity) and the identifiers into ONE `identifier`≡tcita (x1=kind, a ref to a seeded id-kind entity; x3=the id value); make the doc type `kind`≡tcita; backfill every predicate to full place-completeness; then STRENGTHEN the fidelity gate to enforce completeness (all seed places present) AND correctness (position+kind) for EVERY predicate with NO exclusions; re-sync existing data_value rows to the consolidated shapes. Layer-A config + Layer-B data only; aven-db CRDT untouched.
owner: claude
created: 2026-06-30
updated: 2026-06-30
goal: >
  Every wired predicate maps to its best-fitting canonical gismu AND carries the gismu's COMPLETE
  place set (x1–x5 as the seed defines them), with channels + identifiers consolidated. Proven by —
  (1) COMPLETENESS+CORRECTNESS GATE: the fidelity test in `libs/aven-vibes/tests/predicate.test.ts`
  iterates EVERY wired predicate with NO `.filter(...)` exclusions and asserts, against
  `.claude/skills/ontology/gismu.json`, both (a) every declared place == a real gismu place at the
  same position with the same kind (ref|value), and (b) every gismu place is declared (same count,
  same positions) — so a predicate that omits any of its gismu's places FAILS; `bun test
  libs/aven-vibes/tests/predicate.test.ts` exits 0.
  (2) ADDRESS CONSOLIDATION: there is ONE `address`≡judri (x1=address value, x2=entity ref,
  x3=system ref) and the predicates `email`,`phone`,`iban`,`postal` no longer exist
  (`rg "predicate: '(email|phone|iban|postal)'" libs/aven-vibes/src` is empty); x3 references a
  seeded addressing-system entity (one per channel).
  (3) IDENTIFIER CONSOLIDATION: there is ONE `identifier`≡tcita (x1=kind ref, x2=tagged entity ref,
  x3=id value) and the predicates `vat_id`,`tax_number` no longer exist, and the invoice headline
  `number` is folded into `identifier`; x1 references a seeded id-kind entity (vat_id / tax_number /
  invoice_number / …).
  (4) NAME + DOC-KIND: `name`≡cmene carries x1 value + x2 ref + x3 namer (nullable ref); the document
  type is `kind`≡tcita (x1=doctype ref, x2=document ref, x3=info value) and `classified`≡klesi no
  longer exists (`rg "klesi" libs/aven-vibes/src` is empty).
  (5) DATA RE-SYNC: a migration rewrites existing data_value rows for the dropped predicates into the
  consolidated shapes; SQL on the samuel branch shows `address` rows (with an x3 system ref) and
  `identifier` rows (with an x1 kind ref) and ZERO rows whose predicate is a dropped name
  (`email`/`phone`/`iban`/`postal`/`vat_id`/`tax_number`/`classified`).
  (6) GREEN: `bun run check` (betterauth) + `bun --bun x svelte-check` (app) + the aven-vibes /
  aven-ontology test suites exit 0; extract + enrich + addressbook still render a live invoice run.
  aven-db CRDT + the data_schema/data_value plumbing are untouched.
---

## Context

The ontology is the foundation everything else predicates on, so it must be *exactly* right in Lojban —
not "close enough." A one-by-one re-audit of every predicate we currently wire, read against the
canonical lexicon `.claude/skills/ontology/gismu.json` (1341 gismu; each place carries role + definition
+ kind `ref|value` + example — the SSOT), turned up two systemic faults plus two known mismatches.

### Fault A — incompleteness (31 of 34 predicates drop places the seed defines)

We declare only the places a predicate happens to use and silently drop the rest of its gismu's place
structure. The principle we want instead: **a predicate carries ALL of its gismu's x1–x5, even places
our domain doesn't fill** — those become optional (`required: false`) / nullable, but they're present,
named, and documented, so the schema is a faithful, complete picture of the gismu. The audit (script
below) found only 4 predicates complete (`prioritized`/vajni, `source`/krasi, `booked`/cmima,
`represents` is close) and 31 missing one or more places. Examples:

| predicate | gismu | declares | seed defines | missing |
|---|---|---|---|---|
| `task` | zukte | x1,x2 | x1 r, x2 v, x3 v | x3 goal |
| `owned_by` | ponse | x1,x2 | x1 r, x2 r, x3 v | x3 standard |
| `done` | mulno | x1 | x1 r, x2 v, x3 v | x2 property, x3 standard |
| `due` | detri | x1,x2 | x1 v, x2 r, x3 r, x4 v | x3 location, x4 calendar |
| `document` | vreji | x2 | x1 r, x2 v, x3 r, x4 v | x1 record, x3 subject, x4 medium |
| `summary` | skicu | x2,x4 | x1 r, x2 r, x3 r, x4 v | x1 describer, x3 audience |
| `invoice` | janta | x3 | x1 r, x2 r, x3 r, x4 r | x1 account, x2 goods, x4 biller |
| `total` | jdima | x1,x2 | x1 v, x2 r, x3 r, x4 r | x3 purchaser, x4 vendor |
| `payment` | pleji | x2,x4 | x1 r, x2 v, x3 r, x4 v | x1 payer, x3 payee |
| `transaction` | pleji | x2,x3,x4 | x1 r, x2 v, x3 r, x4 v | x1 payer |

(…and 21 more — the full table is reproduced by the audit script in **Done means**.)

### Fault B — predicate proliferation instead of typing-by-x-position

`libs/aven-vibes/src/predicate/contact-vocab.ts` mints a separate predicate per channel and per
identifier — `email`/`phone`/`iban`/`postal` all ≡ **judri**, `vat_id`/`tax_number` both ≡ **cmene** —
explicitly (its header comment) to avoid "stuffing a short categorical label into a ref slot." That
keeps each predicate's *places* faithful but is the wrong shape: the channel/identifier **type belongs
in an x-position**, not in the predicate name. The user: *"having for phone and postal the same judri
feels weird, shouldn't it be just one judri schema with an address typed by x position?"*

Reading the seed shows exactly which position, and it resolves the ref-slot tension cleanly — **by
making the category a first-class referenced entity**, which is the faithful Lojban move:

- **judri** = `x1 address (value) · x2 located (ref) · x3 system (ref)` — "x1 is an address of x2 in
  system x3". So ONE `address`≡judri: the address string in **x1 (value)**, the entity in **x2 (ref)**,
  and the channel **type in x3 (ref) → a seeded addressing-system entity** (`addrsys-email`,
  `addrsys-phone`, `addrsys-iban`, `addrsys-postal`). No short label in a ref slot — x3 references a
  real, stable system row whose id satisfies the id-pattern.
- **tcita** = `x1 label (ref) · x2 labeled (ref) · x3 information (value)` — "x1 is a label/tag of x2
  showing information x3". So ONE `identifier`≡tcita: the **kind in x1 (ref) → a seeded id-kind entity**
  (`idkind-vat_id`, `idkind-tax_number`, `idkind-invoice_number`, …), the tagged entity in **x2 (ref)**,
  and the actual id string in **x3 (value)**. (Note: this corrects the earlier sketch of "x3 = kind" —
  the seed puts the *label/kind* at x1 as a ref and the shown *information* at x3 as a value; we follow
  the seed.)
- **cmene** = `x1 name (value) · x2 named (ref) · x3 namer (ref)`. Names stay `name`≡cmene; add the
  x3 namer (nullable ref).

### Known mismatches the current gate already excludes (fold in here)

`predicate.test.ts` currently `.filter(...)`s two predicates out of the fidelity gate:

- **`classified`≡klesi** stuffs the doc type (a value) into klesi, whose places are
  `x1 category (ref) · x2 superset (ref) · x3 property (value)` — a structural mismatch. Decision:
  drop it; the document type becomes **`kind`≡tcita** = `x1 doctype (ref) → a seeded doctype entity
  (doctype-invoice / doctype-other) · x2 document (ref) · x3 info (value, e.g. a human label /
  confidence note, nullable)`. (Same gismu as `identifier`; distinct predicate, distinct x3 semantics.)
- **`vendor`** is a transitional headline field; the biller is canonically the invoice's
  **janta.x4 (biller)** as a contact ref. Completing `invoice`≡janta (x1–x4) subsumes it.

### Decisions (confirmed with the user)

- One card, everything together (completeness + both consolidations + the two mismatch fixes + gate +
  data re-sync).
- **identifier ≡ tcita**, **name ≡ cmene** (names are not identifiers).
- The document type is a **tcita label** too (`kind`≡tcita), replacing `classified`≡klesi.
- Always include ALL x1–x5 the seed defines, even when our domain leaves a place empty (nullable /
  `required: false`).
- Never force a 1:1 gismu mapping and never stuff a short category string into a ref slot — make the
  category a referenced entity instead.

## Approach (for the build — not exhaustive)

1. **Completeness pass** — for every predicate in `vocab.ts` / `doc-vocab.ts` / `invoice-vocab.ts` /
   `contact-vocab.ts`, add the missing places from the seed with their canonical role/kind, marking
   domain-unused ones `required: false`. The audit script is the worklist.
2. **Address consolidation** — replace `email`/`phone`/`iban`/`postal` with one `address`≡judri
   (x1 value, x2 ref, x3 system ref). Seed the four `addrsys-*` system entities. Update the
   company/person TypeSpecs (`libs/aven-ontology`) to a repeated `address` children part keyed by
   system, and `enrichAddressbook` (`libs/betterauth/src/skills-run.ts`) to emit `address` predications.
3. **Identifier consolidation** — replace `vat_id`/`tax_number` (+ fold invoice headline `number`) with
   one `identifier`≡tcita (x1 kind ref, x2 ref, x3 value). Seed the `idkind-*` entities. Update specs +
   enrich + extract mapping.
4. **Doc kind** — replace `classified`≡klesi with `kind`≡tcita; seed `doctype-*`; update the classify
   step + `BookkeepingVibe` badge (reads the kind via the doctype ref label).
5. **Invoice/janta completeness** — fill x1 account / x2 goods / x4 biller; retire `vendor`.
6. **Strengthen the gate** — `predicate.test.ts`: drop both `.filter(...)` exclusions; add the
   completeness assertion (every seed place declared) alongside the existing correctness assertion;
   add explicit assertions that the dropped predicate names are gone and `address`/`identifier`/`kind`
   exist with the right gismu + places.
7. **Data re-sync** — a betterauth migration rewrites existing `data_value` rows: each old
   `email`/`phone`/`iban`/`postal` → an `address` row with the matching `addrsys-*` x3; each
   `vat_id`/`tax_number` → an `identifier` row with the matching `idkind-*` x1; `classified` → `kind`.
   Seed the system/kind/doctype reference entities first. (The two existing companies carry garbage
   `vat_id` from a pre-0096 extraction — the build may drop+re-extract rather than migrate them.)
8. **Vibe read-paths** — update `client.ts` `listContacts` / `mapContactToView` / the addressbook +
   invoice vibes to read `address`(x3 system) / `identifier`(x1 kind) instead of the per-type predicates.

## Done means

- The audit script — `bun -e` over the predicate bundles vs the seed — prints **0 predicates with
  missing places** and **0 kind-mismatches**, across ALL bundles (todo + document + invoice + line +
  payment + person + company + transaction), with NO predicate excluded.
- `rg "predicate: '(email|phone|iban|postal|vat_id|tax_number)'" libs/aven-vibes/src` and
  `rg "klesi" libs/aven-vibes/src` are both empty; `address`, `identifier`, `kind` exist with the
  gismu + complete places above.
- `bun test libs/aven-vibes/tests/predicate.test.ts` (the strengthened gate) exits 0.
- The data-resync migration applied on the samuel Neon branch; SQL shows `address` rows with an x3
  `addrsys-*` ref and `identifier` rows with an x1 `idkind-*` ref, and zero rows under any dropped
  predicate name.
- `bun run check` (betterauth) + `bun --bun x svelte-check` (app) + the aven-vibes / aven-ontology
  suites exit 0; a live invoice run still renders extract + enrich + addressbook.
- aven-db CRDT and the data_schema/data_value engine are untouched.

## Out of scope

- The SkillsView vibe-preview pane (top flow / bottom sample-data vibe, like RunsView) — a separate
  small card.
- Any new domain verticals; this is purely making the EXISTING wired predicates canonically faithful.

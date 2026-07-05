---
name: ontology
description: Reference vocabulary for building and aligning ontologies — the canonical Lojban gismu (root words) with their x1–x5 place structures and English keywords, hardcoded as JSON for lookup. Use when defining a predicate's place structure, choosing/standardizing argument roles (which place is x1/x2/x3…), mapping a domain field to a positional place, or aligning vocabulary across schemas. Pairs with the universal predication architecture (board 0084): predicate NAMES are pragmatic English, but their x1–x5 place structures REUSE the matching gismu here. Triggers on "gismu", "place structure", "ontology", "predicate vocabulary", "what are the places of", "lojban".
---

# ontology — Lojban gismu place-structure dictionary

A hardcoded, regenerable dictionary of Lojban **gismu** (root words). Each gismu
defines a relation with a fixed **place structure** (`x1 … x5`) — a documented,
language-neutral argument ordering refined over decades. We use it as the *standard*
source of place structures for our universal predication model.

## Why this exists

In the avenOS predication architecture (see board `0084-universal-predication-schema`),
every fact is `predicate + positional places x1…x5`. To avoid inventing argument
orders ad-hoc, we **reuse the canonical gismu place structure** for each predicate —
keeping a pragmatic English *name* but recording the gismu as provenance:

```jsonc
{ "predicate": "pays",  "gismu": "pleji",
  "gloss": "x1 (payer) pays x2 (payment) to x3 (payee) for goods/service x4" }
{ "predicate": "address", "gismu": "judri",
  "gloss": "x1 (locator) addresses x2 (entity) in system x3" }
```

This gives Lojban's rigor + standardization with English legibility, and gives the
future *discover-&-consolidate* skill a fixed reference to align divergent vocab to.

## Files

- `gismu.json` — **the lookup DB** (1341 gismu, fully enriched). Shape:
  `{ source, note, count, enriched, gismu: { <word>: ENTRY } }` where each ENTRY is:
  ```jsonc
  { "gismu": "judri", "name": "address", "source": "lojban"|"coined",
    "description": "<gloss, normalized x1…x5>", "keywords": [...], "arity": 3,
    "places": {
      "x1": { "role": "address", "definition": "…", "example": "…", "kind": "value", "type": "string" },
      "x2": { "role": "located", "definition": "…", "example": "…", "kind": "ref", "references": "*" },
      "x3": { … } } }
  ```
  Each place is its own object: `role` + `definition` + `example` + `kind` (`value`|`ref`);
  value places carry `type`, ref places carry `references` (`"*"` = polymorphic).
- `gismu.tsv` — raw source (one `gismu \t definition \t keywords` per line); input to the base build.
- `gismu.base.json` — auto-parsed base (structure + stubbed places), regenerable from the TSV.
- `parts/*.json` — per-letter LLM-enriched place objects (the enrichment source of record).
- `scripts/build-gismu.mjs` — TSV → `gismu.base.json` (stubs; never overwrites the enriched DB).
- `scripts/merge-parts.mjs` — `gismu.base.json` ⊕ `parts/*.json` → `gismu.json` (+ coverage report).
  Rebuild: `bun scripts/build-gismu.mjs && bun scripts/merge-parts.mjs`.

## How to use

1. **Find a relation for a concept** — search by keyword:
   ```sh
   grep -i 'transfer\|send\|account\|address\|pay' .claude/skills/ontology/gismu.tsv
   ```
   or read `gismu.json` and match against `keywords` / `definition`.
2. **Reuse its place structure** — take the gismu's `x1…xN` ordering as your
   predicate's places. Give the predicate a clear English `predicate` name and set
   `gismu: "<word>"` for provenance.
3. **If no gismu fits** (e.g. SKR04 Soll/Haben/Konto), coin a clear name + gloss and
   leave `gismu: null`. Don't force a bad match.

## Handy gismu for our domains (finance / identity / time)

- `pleji` pay · `vecnu` sell · `dunda` give · `canja` trade/exchange · `benji` transfer/send
- `janta` account/bill/invoice · `jdini` money · `jdima` price/cost · `vamji` value/worth
- `dejni` owe · `cteki` tax · `ponse` possess/own · `zivle` invest · `jerna` earn
- `cmene` name · `judri` address (postal/email/iban/…) · `fonxa` telephone
- `prenu` person · `remna` human · `kagni` company · `jatna` leader/manager · `gunka` work
- `detri` date · `tcika` time-of-day · `temci` interval/duration · `cabna` now/current · `purci` past · `balvi` future
- `vreji` record · `datni` data · `notci` message · `liste` list · `klesi` class/category · `cmima` member

## Notes

- ~1300 gismu; the dictionary is reference data, not executable logic.
- Regenerate after editing the TSV: `bun .claude/skills/ontology/scripts/build-gismu.mjs`.
- Future ontology skills (domain vocab packs, cross-schema alignment) can read this same JSON.

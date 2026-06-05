# @avenos/aven-skills

Generic, config-driven **data ingestor**. A `source → map → target` import is
described entirely by a pure-JSON `IngestConfig` and run through a deterministic serial
pipeline — no bespoke code per source. Onboard a new source by writing one config.

## The pipeline (actor-inspired serial flow)

Each stage is a small typed message handler; a runner threads one stage's output into
the next and logs every step (see `docs/actors/developers/01-actor-system-capabilities.md`).
Side effects are injected as **ports**, so the engine is pure and unit-testable.

```
RawSource (bytes + filename)
  │
  ├─ 1. ingest    hash content + persist via UploaderPort   → SourceDoc { fileId, contentSha256 }
  ├─ 2. parse     decode CSV, extract columns + rows + refs  → ParsedSource
  ├─ 3. transform pure JSON field mapping → n+ targets       → { [target]: rows }  (+ provenance)
  ├─ 4. dedup     merge into the in-memory keyed store       → stats { added, skipped }
  └─ 5. assemble  nest children into parents                 → { orders: [ { …, lines: [...] } ] }
```

## Guarantees

- **Idempotent.** The store dedups by each target's `key`. Re-ingesting the same file is
  a no-op (`duplicateFile: true`); a superset only adds genuinely new rows. Throw the same
  data in as many times as you like.
- **Provenance.** Every target row carries `_source = { ingestId, fileId, contentSha256,
  sourceRef }` pointing back to the source doc and the originating row.
- **Generic.** `n+` targets, composite keys, type coercion (`int|number|datetime|bool`),
  German decimals/dates, parent→child nesting — all driven by the JSON config.

## Usage

```ts
import { createIngestor, textSource } from '@avenos/aven-skills'
import config from '@avenos/aven-skills/configs/victorio-pos-orders.json'

const ingestor = createIngestor(config, { ports: { uploader } }) // uploader → Groove files
const report = await ingestor.ingest(textSource('export.csv', csvText))
report.output.orders // → Order[] with nested lines[], ready to render
```

## Config shape

See `src/ingestor/config.ts` for the full typed contract and
`configs/victorio-pos-orders.json` for a worked example (a flat German POS payments
export grouped into nested orders). Key pieces:

- `source`: `delimiter`, `headerRow`, `nullValues`, and `rowRef` (the unique per-row id).
- `targets[]`: each has a `name`, a `key` (dedup columns), `fields` (output field → rule),
  and an optional `parent` relation (`{ target, match, as }`) to nest into another target.
- field rule: `from` / `const`, `type`, `decimal`/`thousands`, `format` (datetime tokens
  `YYYY MM DD HH mm ss`), `nullable`, `default`.

## Test

```sh
bun test ./test
```

---
title: Bookkeeping vibe — classify document + 60/40 preview UI
summary: Attach an image/PDF/doc → Gemma 4 31B classifies it (invoice/bank statement/contract/other) + extracts title, description, tags → 60/40 split vibe UI (doc preview left, metadata right)
owner: claude
created: 2026-06-23
updated: 2026-06-23
tags: [bookkeeping, vibe, ai, classify, gemma]
goal: "`bun run check` and `bun run lint` exit 0 AND `grep 'classify_document' libs/aven-vibes/src/vibes/bookkeeping/tools.json` prints a match AND `grep 'bookkeeping' libs/aven-vibes/src/index.ts` prints a match AND `grep 'bookkeeping' app/src/lib/shell/MainnetVibes.svelte` prints a match AND `grep 'classify_document' libs/betterauth/src/ai.ts` prints a match"
---

# Bookkeeping vibe — classify document + 60/40 preview UI

## Context

Step 1 of a three-card reconciliation pipeline:
- **0063 (this card):** classify doc type + extract basic metadata → ephemeral 60/40 vibe
- **0064 (follow-on):** extract full schema per type (invoice fields vs bank statement fields)
- **0065 (follow-on):** match-make extracted invoice entities against bank statement entries

The real goal is automated invoice ↔ bank-statement reconciliation. This card delivers only
the classification gate: the vibe lets the user confirm the type and metadata before deeper
extraction is triggered.

### Architecture

Mainnet-only — same pattern as todos and composer. One production vibe in `libs/aven-vibes/src/vibes/bookkeeping/`, wired into `MainnetVibes.svelte` alongside todos and composer. No legacy testnet kitchen sink, no `aven-ui` entry, no `vibe-views.ts` changes.

7-file vibe structure (same as todos):
`{index,tools,view,style,source,interface,logic}.{ts,json,js}`

### Trigger: chat tool call (same as todos/website)

The user attaches a file in the normal mainnet chat → sends message → Gemma 4 31B calls
`classify_document({file_id, response})` during the streaming tool loop → server fetches the
AvenDB file row, sends it to Gemma 4 31B as a **second** vision call with a structured-output
system prompt → returns `{type, title, description, tags}` as the tool result → Gemma emits
`​aven-vibe:bookkeeping <JSON>` → client renders the inline vibe card. Same flow as
`data_crud` for todos or `edit_website` for the composer.

### App wiring (mainnet nav + kitchen sink)

- **`MainnetVibes.svelte`** — add `{ id: 'bookkeeping', label: ... }` to the `VIBES` array
  and render a new `BookkeepingVibe.svelte` wrapper (mirrors `TodosVibe.svelte`)
- **`BookkeepingVibe.svelte`** — new Svelte component in `app/src/lib/shell/`
- **`vibe-views.ts`** — add `doc-classifier` entry to `vibeViewList` and `VibeViewId` union;
  register the kitchen-sink shell from `@avenos/aven-ui/vibes/doc-classifier`

Classification result is **ephemeral** — not written back to AvenDB. The file is already stored
as an AvenDB row (files schema) from the message attachment upload.

## Goal

A `classify_document` tool is callable from the AI chat, executes server-side via Gemma 4 31B
vision, and the `bookkeeping` vibe shell renders a 60/40 split card (doc preview | metadata).

**Completion condition:**

> `bun run check` and `bun run lint` exit 0 AND `grep 'classify_document' libs/aven-vibes/src/vibes/bookkeeping/tools.json` prints a match AND `grep 'bookkeeping' libs/aven-vibes/src/index.ts` prints a match AND `grep 'bookkeeping' app/src/lib/shell/MainnetVibes.svelte` prints a match AND `grep 'classify_document' libs/betterauth/src/ai.ts` prints a match

## Approach

### The classify_document tool

Defined in `libs/aven-vibes/src/vibes/bookkeeping/tools.json`. Added to `CHAT_TOOLS` in
`libs/aven-vibes/src/tools.ts`. Parameters:

```json
{
  "file_id": "string — AvenDB row id of the uploaded document",
  "response": "string — short human-facing reply"
}
```

The tool returns (to the model):
```json
{
  "type": "invoice | bank_statement | contract | other",
  "title": "string",
  "description": "string",
  "tags": ["string"]
}
```

### Server-side tool execution (betterauth ai.ts)

In `streamWithTools`, add a `classify_document` branch alongside the existing `data_crud` /
`edit_website` branches:

1. Look up the AvenDB file row by `file_id` (fetch from DB as the signed-in user's file)
2. Build a multimodal Tinfoil request: `content: [{type:"image_url", image_url:{url:"data:<mime>;base64,<content>"}}]`
3. Call Gemma 4 31B with a structured classification system prompt, `response_format: {type:"json_object"}`
4. Parse and return `{type, title, description, tags}` as the tool result
5. After the tool result is injected, the model's next reply MUST be `​aven-vibe:bookkeeping <JSON>` — add this as an instruction to the `classify_document` tool description

### Vibe shell (libs/aven-vibes/src/vibes/bookkeeping/)

| File | What it does |
|---|---|
| `tools.json` | `classify_document` OpenAI tool schema |
| `source.json` | Initial state: `{ type: null, title: '', description: '', tags: [], fileId: null }` |
| `interface.json` | Event schema: `SET_CLASSIFICATION`, `RESET` |
| `view.ts` | ViewDef: two-column grid, 60% left (file preview slot), 40% right (type chip + title + description + tags) |
| `style.ts` | CSS — grid layout, type-chip colours per doc type, brand tokens |
| `logic.js` | State machine: `SET_CLASSIFICATION` merges result into state; `RESET` clears |
| `index.ts` | `BookkeepingShell` export, mirrors todos pattern |

### 60/40 view layout (view.ts)

```
bk-layout (display:grid, grid-template-columns:60fr 40fr, gap)
  bk-preview (left col) — <img> or <iframe> driven by $fileUrl + $mimeType
  bk-meta (right col)
    bk-type-chip           — $type (colour-coded: invoice=blue, bank_statement=green, contract=amber, other=grey)
    bk-title               — $title
    bk-description         — $description
    bk-tags (flex-wrap)    — $each $tags → bk-tag
```

The preview slot uses the file's AvenDB data URL (passed to the vibe via the VIBE_MARKER JSON
payload as `fileUrl`). PDF: `<iframe src=$fileUrl>`, image: `<img src=$fileUrl>`.

### Register in aven-vibes index

`libs/aven-vibes/src/index.ts` — add exports for the bookkeeping shell alongside todos.

### CHAT_TOOLS wiring

`libs/aven-vibes/src/tools.ts` — import `bookkeepingTools` from the vibe and spread into
`CHAT_TOOLS` alongside `DATA_TOOLS` and `COMPOSER_TOOLS`.

## Steps

1. **Vibe scaffold** — create `libs/aven-vibes/src/vibes/bookkeeping/` (7 files: tools.json with classify_document, view.ts 60/40 split, style.ts, source.json, interface.json, logic.js, index.ts)
2. **Register** — exports in `libs/aven-vibes/src/index.ts`; `bookkeepingTools` into `CHAT_TOOLS` in `tools.ts`
3. **App nav wiring** — `BookkeepingVibe.svelte` + entry in `MainnetVibes.svelte` VIBES array
4. **Server tool executor** — `classify_document` branch in `streamWithTools` in `ai.ts`: fetch AvenDB file row, multimodal Gemma 4 vision call, structured JSON return
5. **Verify** — `bun run check`, `bun run lint`, all grep proofs

## Files to touch

- `libs/aven-vibes/src/vibes/bookkeeping/` — **new directory**, 7 files (production vibe with classify_document tool)
- `libs/aven-vibes/src/index.ts` — add bookkeeping exports
- `libs/aven-vibes/src/tools.ts` — add `bookkeepingTools` to `CHAT_TOOLS`
- `libs/betterauth/src/ai.ts` — add `classify_document` tool executor in `streamWithTools`
- `app/src/lib/shell/MainnetVibes.svelte` — add `{ id: 'bookkeeping', label: ... }` to `VIBES` array + render branch
- `app/src/lib/shell/BookkeepingVibe.svelte` — **new file**, Svelte wrapper (mirrors `TodosVibe.svelte`)

## Acceptance criteria

- [ ] Vibe tool defined — proven by `grep 'classify_document' libs/aven-vibes/src/vibes/bookkeeping/tools.json` prints a match
- [ ] Vibe exported from aven-vibes — proven by `grep 'bookkeeping' libs/aven-vibes/src/index.ts` prints a match
- [ ] Tool in CHAT_TOOLS — proven by `grep 'classify_document' libs/aven-vibes/src/tools.ts` prints a match
- [ ] Server executor wired — proven by `grep 'classify_document' libs/betterauth/src/ai.ts` prints a match
- [ ] Mainnet nav entry — proven by `grep 'bookkeeping' app/src/lib/shell/MainnetVibes.svelte` prints a match
- [ ] BookkeepingVibe.svelte exists — proven by `ls app/src/lib/shell/BookkeepingVibe.svelte` exits 0
- [ ] `bun run check` exits 0
- [ ] `bun run lint` exits 0

## Out of scope (follow-on cards)

- **0064** — full schema extraction: invoice fields (vendor, amount, date, line items, VAT) OR bank statement fields (account, IBAN, entries) driven by the 0063 type result
- **0065** — match-making: link extracted invoice entities to bank statement entries
- Storing classification results in AvenDB (ephemeral for now)
- Editing metadata from the vibe UI (read-only for now)
- Multi-file batch classification

## Verification

```bash
bun run check   # svelte-kit sync + svelte-check + tsc — must exit 0
bun run lint    # biome — must exit 0
grep 'classify_document' libs/aven-vibes/src/vibes/bookkeeping/tools.json
grep 'bookkeeping' libs/aven-vibes/src/index.ts
grep 'classify_document' libs/aven-vibes/src/tools.ts
grep 'classify_document' libs/betterauth/src/ai.ts
grep 'bookkeeping' app/src/lib/shell/MainnetVibes.svelte
ls app/src/lib/shell/BookkeepingVibe.svelte
```

## Hand-off

```
/aven-build 0063
```

or straight to the goal loop:

```
/goal `bun run check` and `bun run lint` exit 0 in the repo root AND `grep -r 'bookkeeping' libs/aven-vibes/src/index.ts` prints a match AND `grep -r 'classify_document' libs/aven-vibes/src/vibes/bookkeeping/tools.json` prints a match
```

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
- `2026-06-23` — Discovery: uncovered the real goal (invoice ↔ bank-statement reconciliation, step 1 of 3), made it measurable, sliced agile-small. Moved ideate → discover.

---
title: aven-brain — architecture & execution plan (v5.4)
summary: The SSOT for aven-brain — three primitives (memory · entity · link with note/claim/bond classes) over typed artifact tables, CRDT-synced sealed rows with an engine unseal-on-scan seam, per-table ingestion adapters, brain-assembled LLM context (forever talk), per-message ContextTrace in a wide right aside, and a fully dynamic DB viewer. Phased roadmap E0–E7; TEE parked.
owner: agent
created: 2026-06-06
updated: 2026-06-10
tags: [aven-brain, memory, architecture, context, talk, db-viewer]
goal: "Per §8: E0 — an existing vault and a fresh vault both boot after the manifest change (migration lens applies, no wipe in logs); E1 — `cargo test -p aven-brain` exits 0 on the 3-table schema incl. registry tests; E4–E6 — a talk message produces a context_traces row rendered in the right aside and `bun run check` exits 0."
---

# aven-brain — Architecture & Execution Plan (v5.4)

> **The one plan.** Architecture + execution roadmap for making aven-brain the per-identity
> context manager of avenOS: one forever talk stream, brain-assembled LLM context, transparent
> per-message recall, ingest-everything (messages, replies, files), and a fully dynamic DB viewer.
>
> Status: v5.4 · 2026-06-10 · Supersedes v5.2 (git `1e2b20b`). v5.3 leaned on engine
> timestamp/digest built-ins; v5.4 deletes shadow/typed entities (links point straight at
> artifact rows) and adopts the fresh-DB policy (no vault migration care pre-launch). **The data model is three
> primitives — memory · entity · link — over typed artifact tables**, after re-auditing the deep
> structure of every reference. (v5.2 folds "provenance" into "artifact": the former is just the
> latter's reference + key attributes denormalized onto the memory row.) As-built record: `board/done/0010` (engine, pipeline, KG,
> dreaming v1, EmbeddingGemma — done + tested; its 5-table schema migrates to the 3-table model
> in E1). Sources: as-built `libs/aven-brain` · MemPalace · gBrain · Mnemosyne v3.5.0 · source
> audits of `libs/aven-db` and `app/`.
> **TEE extractor: parked** (Appendix B). Plain-language glossary: Appendix A.

---

## 0. First principles (the laws)

1. **One storage plane.** Every primitive is a CRDT row in the identity's synced store, under
   one merge/sync/security model. The plane *is* the architecture.
2. **Three tables, forever: `memories` · `entities` · `links`.** A new capability is a new link
   kind, an entity kind, a column, or a dreaming pass — never a fourth table. Every reference
   reduces to this shape (Mnemosyne's annotations/triples/edges, MemPalace's
   triples/tunnels/hallways, gBrain's typed edges, Zep/Letta's episode/node/edge): **content
   nodes, named nodes, typed edges.** The table count is the complexity budget.
3. **Forgetting = re-weighting, never deletion.** `superseded_by`, `valid_to`, confidence,
   decay, age-weights. History survives; ranking changes.
4. **Derived state is rebuildable, never blocks a write, never syncs.** Indexes, summaries,
   extracted links, compiled-truth cards: recomputable from converged rows, applied as
   fault-tolerant post-passes, strictly local.
   **Sealed-data corollary:** rows sync *sealed* (DEK/AEAD; relays blind); plaintext exists only
   **transiently in RAM on-device** where the key lives — exactly when the engine scans or
   indexes. Disk and wire only ever carry ciphertext.
5. **Cheap-first ladders; the bottom rung is deterministic and zero-model.** Extraction:
   `[[wikilink]]`/regex → (optional models later). Vectors: exact scan → quantized → ANN only on
   proven need. Deterministic = same input → same rows on every device = clean CRDT merges.
6. **Every link kind belongs to exactly one semantic class — note, claim, or bond — and the
   class decides its merge behavior.** *note* = append-only, never invalidated. *claim* =
   temporal single-truth (validity window, Bayesian confidence, supersede-never-delete).
   *bond* = weighted, grows on co-access, decays over time. Mnemosyne destroyed data once by
   applying claim semantics to note data (their E6); the kind→class registry is that lesson,
   enforced structurally.
7. **Fuse ranks, not scores; abstain below the floor.** RRF (k=60), shipped and 3-way convergent.
   Adaptive relevance floors (0.15/0.3/0.5 by query length) make "no answer" the default.
8. **Compute at write, multiply at read.** Edges, hashes, IDs, classification happen once at
   ingest; read paths only filter, rank, and multiply constants.

---

## 1. Vocabulary

Three layers: **artifacts** (sealed originals: `files`/`messages` rows — outside the brain) →
**memories** (verbatim evidence) → **entities + links** (the brain's understanding).

| Term | Role |
|---|---|
| **artifact** | any app-owned table row (`messages`, `files`, `todos`, future `vendors`, …): the sealed, synced ground truth the brain derives from — and never writes. Every memory carries its artifact's reference + key attributes **denormalized as indexed columns** — `source` (the row), `stream` (surface), `author_role` (= the row's role), `seq`/`line_start/end` (position), `content_date` — "the artifact columns", which double as the cheap join-free recall filter |
| **memory** | *evidence*: verbatim recallable text + embedding + artifact columns + veracity. A chat turn, a document chunk — always citable back to its artifact. Dreaming's summaries are also memories (lineage via `summarizes` links, veracity `inferred`). |
| **entity** | *pure interpretation*: a name extracted from evidence that has **no backing row** — a topic, a project, a world-person ("Alice" from a chat). Things that *do* have a row (a document = its `files` row, you = your `safes` row (your SAFE), a vendor = its `vendors` row) are **linked directly — no shadow entity** |
| **link** | the one edge primitive: `from —kind→ to` (+ validity/confidence/weight per class). **Endpoints are any rows** — memories, entities, or artifact rows directly (every aven-db object carries its table in metadata, so refs resolve without discriminators). Mentions, facts, bonds, summaries — all links. |
| **mention** | link kind, class *note*: memory → entity ("this evidence talks about X") |
| **fact** | link kinds (free predicates), class *claim*: entity → entity, validity window + confidence + `source_memory` (the evidence behind the claim) |
| **bond** | link kind, class *bond*: entity ↔ entity association with dynamics (Hebbian growth / Ebbinghaus decay) |
| **dreaming** | the single scheduled consolidator (§6) |
| **L0–L3** | context layers: self-card · running summary · entity cards/facts · hybrid search |
| **ContextBundle / ContextTrace** | the assembled budgeted prompt · the stored receipt of one assembly |

---

## 2. Data model — three tables

### 2.1 Schema — synced, sealed, owner-scoped

Brain tables are **normal manifest tables** in the shared identity store, exactly like
`messages`/`files`: a plaintext `owner` uuid for routing/ACC, every content column sealed before
storage, synced via the capability-gated FrontierDag. Embeddings sync too — a `Vector{768}` is
packed f32 bytes, sealed like any other column. **Embed once on any device, sync everywhere;
index locally** (§3).

```
memories  owner Uuid · content Text · embedding Vector{768}
          stream Text · author_role Enum[user,agent,system]            ← artifact columns
          source Text (artifact row ref) · seq Int · line_start/end Int
          content_date Timestamp · content_hash Bytea · source_version BigInt
          normalize_version Int
          veracity Enum[stated,inferred,imported,tool,unknown] · superseded_by →memories

entities  owner Uuid · name Text · kind Text (person/topic/project/thing)
          properties Json
          — pure interpretation only; rows that exist as artifacts are linked directly (§2.3)

links     owner Uuid · from Uuid · to Uuid · kind Text · class Enum[note,claim,bond]
          valid_from Timestamp? · valid_to Timestamp? · confidence Double?     ← claim
          strength Double? · stability Double? · access_count Int? · last_access?  ← bond
          source_memory →memories?
```

Indexes: `memories(owner, stream, author_role)`, `memories(source)`, `memories(content_hash)`;
`entities(owner, name, kind)`; `links(owner, from, kind)`, `links(owner, to, kind)`.
`superseded_by` stays a column on memories (the hot path filters `IS NULL` cheaply); summary
lineage is a *note* link `summary —summarizes→ source_memory`.

**Engine built-ins we lean on — don't redo on top (verified in `libs/aven-db`):**

| Built-in | Where | What it gives us |
|---|---|---|
| **`BatchId` = UUIDv7** | `row_histories/types.rs:30` | every write batch embeds a ms timestamp and is `Ord` — LWW winner resolution is already time-ordered |
| **`RowProvenance { created_by, created_at, updated_by, updated_at }`** | `metadata.rs:127` | per-row creation/update time + author principal, maintained by the engine on every insert/update |
| **row digest (`Digest32`)** | `row_histories/codecs.rs::compute_row_digest` | the per-version digest OwnerBinding/EditSignature bind to — authorship is already cryptographic |

Consequences: **no `created_at`/`updated_at` columns on brain tables** — E1 surfaces the
engine's `RowProvenance` as queryable virtual columns (`_created_at`, `_updated_at`); age-weights
and the working window read those. Two are *not* replaceable and stay: `content_hash` (a
plaintext-content-only dedup key for "does this exact text exist" lookups — the engine's row
digest covers the whole sealed row and changes on any column update, so it can't serve content
dedup) and `content_date` (domain time: when the content *happened*, not when it was written).
`author_role` stays as a cheap typed filter, but is verifiable against the engine's
`created_by`/EditSignature.

### 2.2 The link kind registry (law 6, enforced)

Each kind is registered once with its class; the brain refuses unregistered kinds at write:

| Class | Merge behavior | Kinds (initial) |
|---|---|---|
| **note** | append-only; never invalidated; idempotent re-insert | `mentions`, `summarizes`, `refers_to` |
| **claim** | new assertion for same (from, kind) closes the old row's `valid_to`; conflicts keep both, Bayesian confidence decides, loser marked superseded; never deleted | free predicates: `works_at`, `lives_in`, … |
| **bond** | one row per (from, to); potentiate on co-access (+0.05 strength, +0.1 stability if gap ≥1h), decay in dreaming; `access_count` → Counter-merge | `assoc` |

App code never writes "a link" — it writes `mention(memory, entity)`, `fact(s, p, o, from)`,
`bond(a, b)`; the registry applies the class semantics.

### 2.3 Links point at rows, not shadows

If a thing already exists as an artifact row, **the graph references that row directly** — no
shadow "typed entity" duplicating its identity:

- a dropped file's chunks `mention` **the `files` row itself**; the document's compiled-truth
  card + timeline is a **derived view keyed by that row id**
- L0 is the compiled-truth card keyed by **your `safes` row** (your SAFE, `did:safe:<uuid>`)
- a claim can connect artifact rows directly: `files-row —issued_by→ vendors-row`

Ref resolution is built in: every aven-db object carries its table in metadata
(`MetadataKey::Table`), so the DB viewer and cards resolve any link endpoint without
discriminator columns.

The `entities` table holds **pure interpretation only** — extracted names with no backing row
(`person`/`topic`/`project`/`thing` from wikilinks/regex). **Promotion rule:** when an
interpretation turns out to *be* a real row (extracted "Alice" matches a SAFE),
dreaming merges it — re-points its links to the artifact row (or aliases via a `refers_to` note
link when history shouldn't be rewritten). Future "schema types" = new artifact tables + link
kinds: **pure data, zero brain migrations.**

### 2.4 Artifacts — every app table plays the same way

Generalization: **every app table is an artifact table.** `messages` and `files` are not special
— `todos`, `identities`, and any future schema type (`vendors`, `invoices`, `contacts`, …) relate
to the brain through the same two hooks:

```
ARTIFACTS  (app-owned, sealed, synced — the typed schema layer)
  messages · files · todos · identities · vendors · …any future table
      │ 1. ingest:     its text → memories (source = row ref)            [evidence]
      │ 2. graph:      links point straight at the artifact row (no shadow node)
      ▼
BRAIN  memories · entities · links   (derived understanding — never the truth)
```

1. **Ingestion adapter (per table, registered)** — declares *what text this artifact contributes
   and when*. The contract (a per-table descendant of MemPalace's RFC-002 source-adapter):
   `on_create / on_update / on_delete → memory drafts (+ artifact columns) · entity upsert ·
   deterministic claims`. Examples:
   - `messages` → body on create (built into the talk flow, §4.1–4.2)
   - `files` → extracted text, chunked, on create (§4.3); type-aware extraction per mime
     (markdown/text now, PDF next; an *invoice* PDF can later add deterministic claims like
     `invoice —issued_by→ vendor`, `—due_on→ date` — adapter logic, zero schema change)
   - `todos` → small **event memories** ("todo created: *Ship invoice flow*", "completed: …")
     on create/update — state changes become recallable history, while the todo row stays the
     live truth
   Adapters are deterministic first (regex/structure), model-assisted only later and off the
   write path; an artifact with no adapter simply contributes nothing (opt-in per table).
2. **Graph presence** — automatic: links point straight at the artifact row (§2.3), which then
   accumulates mentions, claims, bonds, and a compiled-truth card + timeline keyed by its id.
   No node to create.

**The direction of truth is strictly one-way.** Artifacts are app-owned ground truth; the brain
only reads and derives — it never writes a todo or edits a file (tool calls write artifacts; the
brain ingests the result). And the DB viewer becomes a two-layer browser for free: artifact
tables ↔ brain tables, every `source`/link-endpoint cell clickable in both directions
(vendor row → its entity card → every conversation mentioning it → the exact message rows).

### 2.5 One app table: `context_traces`

The historical record of what was actually sent to the LLM per human message — sealed, synced,
owner-scoped: `{ owner, message_id, reply_id?, trace (sealed ContextTrace JSON), created_at_ms }`.
Kept out of the message row (whose `body` carries the tool-call envelope).

**Reuse of the engine's audit trails (verified):** the engine audits *writes* — per-row batch
histories (signed, UUIDv7-stamped, state reconstructable as-of any moment), batch durability/sync
fates — but a context assembly is a *read + decision event*, which no write-trail records; hence
this one table. It stays a lean **decision log**, because the engine already keeps the state log:
- the trace records ids + via/rank/score + budget drops + an **assembly watermark** (the batch
  frontier at assembly time) — combined with row histories, any trace is **replayable**: re-run
  the deterministic `assemble_context` as-of the watermark and get the same candidates; the CRDT
  history *is* the snapshot
- snippets are stored only as a render convenience; superseded/edited memories resolve their
  as-of state from row history, not from trace bloat
- the trace row's own audit is free: signed (EditSignature), owner-bound, UUIDv7 batch-stamped,
  sync-auditable via BatchFate

### 2.6 Manifest changes (E0)

- `libs/aven-schema/schema.manifest.json` gains `memories`/`entities`/`links` +
  `context_traces`; the manifest type system gains **`vector`** (with `dim`)
  (`schema_manifest.rs::column_type_from_manifest` has no vector mapping today).
- **Fresh-DB policy (decided):** pre-launch we don't carry existing vaults — no new migration
  snapshot/registry entry is needed for this change (dev vaults reset). The existing registry
  test (`registry_snapshots_lens_cleanly_to_current`) stays green since adding tables is
  add-only. The snapshot/registry discipline resumes once real users exist.

### 2.7 What we deliberately do NOT add

No separate mentions/facts/relations tables (link kinds) · no standalone "provenance" concept
(it's the artifact columns) · no working/episodic split (artifact columns + `summarizes` links
do it) · no `created_at`/`updated_at` columns (engine `RowProvenance` + UUIDv7 `BatchId` supply
`_created_at`/`_updated_at`, §2.1) · no `tier` column (age-weights are pure `f(_created_at)`) ·
no content-hash duplication of the engine row digest (different jobs, §2.1) · no canonical table (L0 = the
card keyed by your `safes` row) · no shadow/typed entities (links point straight at
artifact rows; `entities` is pure interpretation only) · no scratchpad/banks (identities are the
isolation) · no
free-form labels (typed artifact columns only) · no eager artifact-entity derivation (lazy,
§2.3) · no 13-type taxonomy (small decay classes from typed columns).

---

## 3. The engine seam — unseal-on-scan (the one prerequisite)

`nearest` (exact cosine) and `text_search` (BM25 `k1=1.5,b=0.75`) are built ✅ and scan **stored
values** — which, in the app store, are ciphertext (sealing happens app-side, above aven-db).
The seam: a **column-unseal transform** supplied by the DEK-holding layer, invoked wherever the
executor reads `embedding`/`content` for ranking or for building local derived indexes.
Plaintext lives only in RAM during the scan; results (row ids + ranks) carry no plaintext.

- Filter-before-rank is already free (executor order `filter → rank → limit`): typed predicates
  (`owner`/`stream`/`author_role`/link kind) are indexed and narrow candidates before any
  unsealing happens.
- **Scale ladder:** unsealed exact scan (now) → int8/bit quantized side-columns (32× smaller,
  Hamming popcount — Mnemosyne holds 35 ms @ 10M rows on exactly this; the quantized cache is
  derived state, never synced) → HNSW only if a real workload misses budget.
- **Embedder consistency:** all devices of an identity must embed with the same model. Stamp the
  embedder id in a brain meta row; on change, a dreaming maintenance pass re-embeds
  (lens-driven). Default ships StubEmbedder (BM25-dominant, honest in the trace);
  EmbeddingGemma-300m ONNX behind the `models` feature (E7).

---

## 4. Write path — ingest everything

Sealed artifacts are the source of truth; the brain derives evidence and understanding from
them through **per-table ingestion adapters** (§2.4). Ingest **never blocks the talk loop**
(fire-and-forget, logged, idempotent). The flows below are the first three adapters:

1. **User turn** → `messages` row (sealed, synced) → `brain_ingest(content, stream='talk',
   author_role='user', source=row_id, content_date=created_at_ms)`.
2. **Agent reply** → after `resolveAgentTurn`, ingest the human-facing prose (not the tool-call
   envelope) with `author_role='agent'`, `veracity: inferred` (recallable, down-weighted;
   dreaming may promote it).
3. **Files — drop anything into the talk stream**: original stays verbatim + sealed in `files`
   (via `persistSparkFiles`) → **extract text** (markdown/text directly; PDF next) → **chunk
   ≈800 chars / 80 overlap** → embed → one memory per chunk (`source` = file row id, `seq`,
   `line_start/end`, `stream='talk'`, `author_role='user'`) → every chunk `mentions` **the
   `files` row directly** — the document gets a compiled-truth card + timeline keyed by that
   row id, no shadow node. Bytea originals are never searched — chunks are; citations resolve
   back to file + line range via `source`.
4. **Deterministic understanding on write** ✅ (rewired to links in E1): `[[wikilinks]]` + regex
   pass (entity patterns + fuzzy-merge ≥0.8 + stop-words; SPO patterns `is/has/uses/works at`
   conf 0.6–0.7, ≤5/memory, ≤4096-char input; temporal markers) → entities + `mentions` notes +
   claim links + `assoc` bonds.
5. **Idempotent + convergent**: `content_hash` dedup before embedding; deterministic extraction
   ⇒ two devices ingesting the same content converge (row dedup by hash, entity dedup by
   dreaming's merge, note links idempotent by definition).

---

## 5. Read path — `assemble_context`

One call before every LLM roundtrip (library method, testable without Tauri):

```
assemble_context(query, opts { working_n=8, recall_k=6, entity_cards=2,
                               budget_chars≈8000, filter: { stream: 'talk' } })
  L0  self-card (always)                  ← compiled-truth card keyed by your safes row (SAFE)
  L1  running gist (always)
  WW  working window: last N stream turns (chronological, always included)
  L3  search_traced(query): nearest + text_search → RRF k=60, hits carry via/rank/score,
      excluding ids already in the window
  L2  entity cards for entities named in the query (cards = compiled truth + claim/bond
      timeline + top mentions)
  →   budget: pin L0+L1 → window newest-first → recall by rank → cards; stop at budget_chars,
      count dropped → ContextBundle { prompt } + ContextTrace { … }
```

- **Budget reality:** llama.cpp runs LFM2.5-1.2B with `n_ctx = 4096`, `MAX_NEW_TOKENS = 512`
  (`libs/aven-ai/src/llama.rs:276`, `app/src-tauri/src/llm.rs:555`). ~8,000 chars (≈2k tokens)
  is the conservative default; `usedChars` surfaces in every trace.
- **Score modifiers (after RRF):** veracity multiplier (stated 1.0 / inferred 0.7 / imported
  0.6 / tool 0.5 / unknown 0.8) · age weight (×1.0 <30d, ×0.5 <180d, ×0.25 ≥180d) · Weibull
  per-class recency (§9) · **abstention floor** (lexical overlap ≥0.15/0.3/0.5 by query tokens —
  return empty over noise) · dedup (a summary and the memories it `summarizes` never co-rank;
  `superseded_by` rows hidden).

**ContextTrace** (serde camelCase, stored sealed in `context_traces`, rendered by the UI):

```ts
type ContextTrace = {
  query: string
  l0Self: string
  l1Gist: string[]
  working:  { id: string; snippet: string; authorRole: 'user' | 'agent' | 'system' }[]
  recalled: { id: string; snippet: string; source?: string; rank: number;
              via: 'vector' | 'bm25' | 'both'; score: number }[]
  entities: { name: string; kind: string; bonds: [string, number][] }[]
  budget: { usedChars: number; maxChars: number; droppedRecalled: number; droppedWorking: number }
  embedder: 'stub' | 'gemma'
  assembledAtMs: number
}
```

---

## 6. Dreaming — the one consolidator

Scheduled background pass; everything derived, rebuildable, off the write path:

| Pass | Status | What it does |
|---|---|---|
| Decay | ✅ (rewire to bond links in E1) | bonds: `strength·exp(−days/stability)`, floor 0.05 |
| Entity-merge | ✅ (rewire in E1) | CRDT-safe merge of duplicate entities by normalized name; re-points their links. **Promotion:** an interpretation entity matching a real artifact row merges into it (links re-pointed, or `refers_to` alias) |
| Consolidate | ☐ | old stream turns → summary memory with **deterministic ID = f(identity, window)** (concurrent dreams converge under LWW) + `summarizes` note links |
| Verify claims | ☐ | Bayesian confidence on repeat evidence `conf += (1−conf)·w_veracity·0.3`; contradictions: keep both claim links, mark loser superseded; recompute compiled-truth per entity |
| Promote | ☐ | load-bearing `author_role='agent'` (`inferred`) memories get verified/promoted |
| L1 rewrite | ☐ | deep rewrite of the running summary (incremental per-turn + batch here) |

---

## 7. Product experience

### 7.1 Forever talk — the brain is the context manager

There are no sessions (storage already is one identity-scoped stream). Today's prompt is
literally `todoPreamble + userPrompt` (`identity-agent.svelte.ts::replyWithAgent`). New flow:

```
submit(message, files)
  → messages.create(user row)            (sealed, synced — artifact)
  → brain_ingest(user turn)              (fire-and-forget)
  → files → persistSparkFiles → brain file pipeline (§4.3)
replyWithAgent(prompt, userRowId)
  → assembled = brain_assemble_context(identity, prompt)      (catch → undefined)
  → streamReply((assembled?.prompt ?? '') + todoPreamble + prompt, …)
  → resolveAgentTurn → persist reply body (unchanged)
  → brain_ingest(reply prose, author_role='agent')
  → context_traces.create({ owner, message_id: userRowId, reply_id, trace })
```

Todo preamble stays (live todo row ids the brain can't know). **Graceful degradation is law:**
any brain failure logs and falls back to today's prompt — the talk loop never blocks on the brain.

### 7.2 The right context aside — transparent recall

A real third grid column (not the left-nav `asideExtra` footer slot):

- `SlideAsideLayout.svelte`: optional `rightAside` snippet → `<aside>` after `<main>` at `xl`,
  right-side `MobileAsideDrawer` below `xl`.
- Identity layout, talk route only:
  `xl:grid-cols-[12rem_minmax(0,1fr)_minmax(22rem,30rem)]` — the "much wider" aside.
- New `TalkContextAside.svelte` + selection store (`talk-context.svelte.ts`, shared via Svelte
  context): **clicking a human message** (or an agent reply, via `reply_id`) selects its trace
  from `context_traces`; default = newest. Renders: query header → budget bar (used/max,
  dropped badge) → L0/L1 collapsibles → working window → recalled hits with **via badges**
  (vector / bm25 / both) + rank/score → entity chips (→ entity card). Empty state explains
  traces record from the next message on.

### 7.3 Drag & drop — stay where you are

Current bug: the global `onDrop` (`app/src/routes/+layout.svelte:220–231`) always stashes files
and `goto('/')` — yanking you to the intents screen. Fix: when the route is
`/identities/[identityId]/…`, **do not navigate**; hand the files to that identity's composer/
agent (same `submit` attachments path → `files` + brain pipeline). Drop and composer-attach
become the same ingest path. Elsewhere, the existing behavior stays.

### 7.4 DB viewer — fully dynamic, human-readable

`app/src/routes/identities/[identityId]/db/+page.svelte`:

1. **Dynamic table list** — derive from `jazzStatus().tables` (runtime schema); delete the
   hardcoded `IDENTITY_SCOPED_TABLES`. Every current and future table — including `memories`,
   `entities`, `links`, `context_traces` — appears automatically. Per-row owner filtering stays.
2. **Type-aware cells** — shared helper (`app/src/lib/db/format-cell.ts`) detecting engine
   serializations: `{type:'Vector'}` → `Vector(768) [0.12, −0.45, …]` (+tooltip);
   `{type:'Bytea'}` → `0x1a2b3c… (n B)` hex; Timestamps → ISO + relative; ref cells
   (`from`/`to`/`source`/`source_memory`/`owner`/`message_id`) → clickable, resolved to their
   table via the engine's object metadata (`MetadataKey::Table`), jumping there with an id filter. Links rows render their kind +
   class badge (note/claim/bond).
3. **Brain search tab** — query + optional artifact-column filter (stream / author_role) →
   `brain_search` → hits with via/rank/score badges, click-through to the `memories` row; entity
   list → entity-card panel; status strip (embedder, row counts) + **Dream** and **Backfill**
   buttons.

---

## 8. Execution roadmap

Each phase independently shippable, with files + verification:

| # | Phase | Files (key) | Verify |
|---|---|---|---|
| **E0** | **Manifest**: `vector` type mapping + `memories`/`entities`/`links` (+owner) + `context_traces`. Fresh-DB policy: no migration snapshot needed (§2.6) | `libs/aven-schema/schema.manifest.json`, `app/src-tauri/src/schema_manifest.rs` | schema tests pass (`current_manifest_has_stable_hash`, registry lens test); fresh vault boots; tables listed by `jazzStatus()` |
| **E1** | **Engine seam + 3-table rework**: unseal-on-scan transform for `nearest`/`text_search`; aven-brain migrates its 5-table schema to memory/entity/link + the kind→class registry (mention/fact/bond APIs unchanged in name, free-label param removed, scope = `Filter { stream, author_role, source }` over the artifact columns); `open(identity)` over the shared store; **surface `_created_at`/`_updated_at`** (engine `RowProvenance`/UUIDv7 `BatchId`) as queryable columns; `remember_with`, `search_traced` (hits carry via/rank origin), `assemble_context`; rewire KG/dreaming/cards to links | `libs/aven-db` executor/scan path, `libs/aven-brain/src/{schema,brain}.rs` | `cargo test -p aven-brain` (13 tests migrated + registry tests: claim-close, note-idempotence, bond-potentiate); sealed fixture: search correct, no plaintext at rest |
| **E2** | **App runtime**: brain module + Tauri commands `brain_status/ingest/search/entities/entity_card/assemble_context/backfill/dream` (asr/llm/tts pattern) + TS wrapper | new `app/src-tauri/src/brain.rs`, `app/src-tauri/src/lib.rs` (manage/handler/exit-drain), new `app/src/lib/brain/api.ts` | devtools: ingest → search round-trip on a real identity |
| **E3** | **Ingestion**: the adapter registry (§2.4) + first adapters — messages (talk hooks for user/agent turns), files (markdown/text chunking; PDF next; chunks mention the files row directly); todos adapter (event memories) next; backfill of pre-brain history; **drag-drop fix** | `identity-agent.svelte.ts`, `intent-files.ts`, `app/src/routes/+layout.svelte` | drop a .md on talk → stays on screen, chunks in `memories` with `source` = file row id + mention links to that row; backfill idempotent (2nd run dedups all) |
| **E4** | **Context manager**: `assemble_context` wiring + `context_traces` writes + fallback path | `identity-agent.svelte.ts` | reply still streams with brain off (fallback); trace row per human message; prompt contains L0/L1/WW/recall blocks under budget |
| **E5** | **Right aside**: layout third column + drawer, `TalkContextAside`, message-click selection | `SlideAsideLayout.svelte`, `AsidePageLayout.svelte`, identity `+layout.svelte`, `IdentityTalkPanel.svelte`, new `TalkContextAside.svelte`, `talk-context.svelte.ts` | xl: aside shows newest trace; clicking older message swaps it; <xl drawer; other routes untouched; `bun run check` |
| **E6** | **DB viewer**: dynamic tables, `format-cell.ts`, ref navigation, link class badges, brain search tab | `db/+page.svelte`, new `app/src/lib/db/format-cell.ts` | brain tables render readable; Vector/Bytea/Timestamp formatted; ref click navigates; search shows via badges |
| **E7** | **Models & depth**: EmbeddingGemma feature (download UX, embedder stamp, re-embed pass), dreaming v2 passes, quantized side-columns, Counter-merge for `access_count`, honest eval harness (LongMemEval/LoCoMo, held-out only) | `app/src-tauri` feature wiring, `libs/aven-brain` | semantic (lexically-disjoint) recall works with Gemma; stub fallback clean; eval numbers reported held-out |

---

## 9. Constants (copy verbatim — settled, don't re-derive)

| From | Constants |
|---|---|
| MemPalace | candidates `k·3`; BM25 `k1=1.5, b=0.75`; dedup cosine `<0.15`; **chunk ≈800 / overlap 80**; bond dynamics `floor 0.05, max 5.0, potentiation +0.05, stability +0.1, spaced ≥1h`, decay `strength·exp(−days/stability)`; L0–L3 budgets |
| gBrain / built | **RRF k=60** `Σ 1/(60+rank)`; deterministic edges on write; compiled-truth + timeline per entity |
| Mnemosyne | veracity `1.0/0.7/0.6/0.5/0.8`; Bayesian `conf += (1−conf)·w·0.3`; abstention floors `0.15/0.3/0.5`; age weights `×0.5@30d, ×0.25@180d`; Weibull `profile k=.3 η=8760h · preference k=.4 η=4380h · fact k=.8 η=720h · event k=1.2 η=168h · request k=1.5 η=72h`; sign-bit quantization + Hamming; deterministic claim ID `sha256(len-prefixed NFC S|P|O)`; consolidation TTL 24h |

---

## 10. Reference ledger

| Source | Married in | Refused |
|---|---|---|
| MemPalace | retrieval recipes, layered context, dynamics (bonds), neighbor expansion, citations | two planes; three fragmented edge stores; file-path hierarchy; AAAK |
| gBrain | compiled-truth + timeline, dream cycle, deterministic edges, RRF | per-shape hand schemas (the generic link kills this); single-operator |
| Mnemosyne | the generic typed-link shape (their `annotations`), lifecycle, veracity+Bayesian, abstention, quantization, ladders, the E6 class-separation law | god-module; env sprawl; tier column; canonical/scratchpad/banks tables; bolt-on sync |
| Zep/Letta (SOTA graph memories) | independent convergence on episode/node/edge = memory/entity/link | — |
| avenOS | the plane: CRDT + ownership + capabilities + E2E sealing + sync | — |

---

## Appendix A — plain-language glossary

- **Brain** — each identity has one private memory store it fully owns; nobody else can read it.
- **Artifact** — the real things your apps store: messages, files, todos, vendors. The ground
  truth. The brain reads them and learns from them, but never changes them. Every memory carries
  its artifact's fingerprint as fast typed fields — which row it derives from (`source`), which
  surface (`stream`), who authored it (`author_role`) — the "which drawer" filters.
- **Ingestion adapter** — each artifact type's little recipe for what the brain should remember
  about it: a message contributes its text, a file its pages, a todo its "created/completed"
  moments. New artifact type → new recipe, nothing else changes.
- **Memory** — one piece of *evidence*, word-for-word: a chat message, a chunk of a document.
  Always traceable to its artifact.
- **Entity** — a name the brain *believes* refers to something, when no real row exists for it:
  a person from a story, a topic, a project. Pure interpretation, never the truth itself. Things
  that *do* exist as rows — a file, a todo, you — never get a duplicate entity: the graph points
  at the real row directly, and if an extracted name later turns out to be a real row, dreaming
  merges them.
- **Link** — the one connector: *something — kind → something*. Three flavors with different
  rules: **notes** ("this memory talks about Alice" — only ever added), **claims** ("Alice
  works at Acme, since 2020" — dated, confidence-weighted, replaced but never erased), and
  **bonds** ("Alice and Acme belong together" — stronger with use, fading without, like a
  muscle).
- **Embedding** — a fingerprint of *meaning*: text turned into numbers so "I love pizza" and
  "pizza is my favorite" land close together. Computed on your device, synced sealed.
- **Content hash** — a fingerprint of the *exact text*, so saving the same thing twice just
  refreshes it.
- **Hybrid search** — two searchers at once: one matches meaning, one matches exact words.
- **RRF** — how their answers combine: ignore scores, reward whatever ranks high on either list.
- **Veracity** — trust by *who said it*: you (1.0) > the AI guessed (0.7) > imported (0.6) > a
  tool (0.5).
- **Confidence** — trust by *how often confirmed*: repeats nudge it up, never to certainty.
- **Abstention** — if nothing matches well, the brain says *nothing* instead of guessing.
- **Decay / age weights** — old memories fade in ranking, never get erased; different kinds fade
  at different speeds.
- **L0–L3 / wake** — what gets loaded for the AI: who you are (always), your story summary
  (always), cards about entities in play, deep search.
- **ContextBundle** — the actual text package sent to the AI for one request.
- **ContextTrace** — the receipt: which memories were used, why each matched, what was dropped.
  Click any of your messages to see its receipt in the right panel.
- **Dreaming** — nightly cleanup: weaken unused bonds, merge duplicate entities, roll old turns
  into summaries, double-check repeated claims, flag contradictions (keep both, mark the loser).
- **Compiled-truth card** — each entity's freshly rewritten "current state" atop its full dated
  history. Your identity is your own card.
- **Sealed** — every row is locked with keys only your devices hold; servers store boxes they
  can't open. Plaintext exists only in your device's RAM while searching.
- **CRDT sync** — the math that lets your devices edit offline and merge later without a
  referee; every device ends up holding all your (sealed) data locally.
- **Local index** — the speed structure each device builds for itself; never uploaded, always
  rebuildable.
- **Quantization** — shrinking meaning-fingerprints 32× so search stays instant at millions of
  memories.

## Appendix B — parked: TEE extractor

The attested-TEE fact extractor (GLM-5.3 on Phala RedPill; trait seam `extractor.rs` built, no
impl) is **parked** — see `board/done/0010-aven-brain-execution-plan.md` §6b for the full design
(attest-or-refuse, attestation digests on extracted claims, phases P1–P4). Nothing in E0–E7 depends on it; the
deterministic pass is load-bearing without it. Revisit after E7.

## Progress log

Newest entry first.

- `2026-06-10` — **Merged main again** (SAFE rename landed): `identities` table → **`safes`**
  (+ `safe_did`, types `human | aven | spark`), new `safe_controllers` (SAFE-in-SAFE
  delegation), `peer_did`→`signer_did`. Canonical terms per
  `docs/architecture/safe-identity-execution-plan.md`: **Signer** (`did:key`, device key) vs
  **SAFE** (`did:safe:<uuid>`, the identity container) — one brain per SAFE. Plan + manifest
  comments aligned (`safes` row refs). Cleaned the last stale registry snapshot
  (`before-message-role` — the table rename made it a draft lens; finishes main's
  clean-baseline `5f52766`). Post-merge: E0 harness PASSED (new hash `aa2568d9…`),
  aven-brain 13/13. Routes still `/identities/…` (frontend rename pending on main).
- `2026-06-10` — **Merged latest main** (`1160ccc`, no conflicts) and re-verified the plan
  against it: all cited file refs intact (`todoPreamble` identity-agent:125, drag-drop
  `goto('/')` +layout:220–229, `n_ctx` 4096, `seal_column_plain` → `jazz/jazz_engine.rs`,
  `groove_runtime` → `jazz/mod.rs` post-split, `IDENTITY_SCOPED_TABLES` db page:25). Main
  independently adopted the **clean-baseline snapshot policy** (`5f52766`) — the stale
  draft-lens snapshot is gone; the E0 harness now passes the full registry check
  (`before-message-role` lenses cleanly; hash `f350ca95…` unchanged). aven-brain still 13/13.
  Renumbered this item **0011 → 0018** (main's security items took 0009–0017). New on main,
  no plan impact: jazz/mod.rs split (A1), avens/ routes, relay auto-grant on identity create,
  peers label/name columns sealed.
- `2026-06-10` — **E0 shipped** (`fdaaffb`): `vector` type mapping in `schema_manifest.rs` +
  the 4 tables (`memories`/`entities`/`links`/`context_traces`) in `schema.manifest.json`.
  Verified against the real engine via a standalone groove harness (the app crate can't build in
  the Linux container — GTK system libs): manifest → `Schema` with `Vector{768}` builds ✓,
  `SchemaHash` computes ✓, registry snapshot hashes match ✓, **pre-E0 → E0 lens is non-draft**
  (truly add-only) ✓. Pre-existing on main (not E0): the oldest registry snapshot
  (`before-peers-spark-id`) drafts against current — moot under the fresh-DB policy.
  Next: E1 (engine unseal-on-scan seam + aven-brain 3-table rework).
- `2026-06-10` — Moved into the board as `plan/0011`, renumbered to `plan/0018` after the main merge took 0009–0017 (was `docs/aven-brain-architecture.md`).
  v5.2: provenance folded into artifact. v5.1: artifacts generalization + per-table ingestion
  adapters. v5: data model consolidated to memory · entity · link (note/claim/bond registry).
  v4: forever-talk context manager, ContextTrace + right aside, dynamic DB viewer, synced sealed
  brain tables + engine unseal seam, TEE parked.
- `2026-06-10` — v2–v3: Mnemosyne v3.5.0 full source audit merged with the MemPalace/gBrain
  as-built plan (`done/0010`); first-principles synthesis.
- `2026-06-06` — Originated as `docs/aven-brain-execution-plan.md` (MemPalace deep-dive).

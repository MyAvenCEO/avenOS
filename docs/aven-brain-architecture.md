# aven-brain — Architecture & Execution Plan (v4)

> **The one plan.** Architecture + execution roadmap for making aven-brain the per-identity
> context manager of avenOS: one forever talk stream, brain-assembled LLM context, transparent
> per-message recall, ingest-everything (messages, replies, files), and a fully dynamic DB viewer.
>
> Status: v4 · 2026-06-10 · Supersedes v3 (git `3289d4f`) and the design sections of board
> `idea/0009-brain-as-context-manager.md`. As-built reference: `board/done/0010` (engine, schema,
> pipeline, KG, context assembly, dreaming v1, EmbeddingGemma — done + tested, 13 tests).
> Sources: as-built `libs/aven-brain` · MemPalace · gBrain · Mnemosyne v3.5.0 · source audits of
> `libs/aven-db` and `app/` (talk, layout, DB viewer, schema manifest).
> **TEE extractor: parked** (Appendix B). Plain-language glossary: Appendix A.

---

## 0. First principles (the laws)

1. **One storage plane.** Every primitive — memories, entities, mentions, facts, relations,
   context traces — is a CRDT row in the identity's synced store, under one merge/sync/security
   model. The plane *is* the architecture.
2. **Five brain tables, forever.** New capability = a column, a read-path function, or a dreaming
   pass — never a sixth table.
3. **Forgetting = re-weighting, never deletion.** `superseded_by`, `valid_to`, confidence,
   decay, age-weights. History survives; ranking changes.
4. **Derived state is rebuildable, never blocks a write, never syncs.** Indexes, summaries,
   extracted edges, compiled-truth cards: recomputable from converged rows, applied as
   fault-tolerant post-passes, strictly local.
   **Sealed-data corollary:** rows sync *sealed* (DEK/AEAD; relays blind); plaintext exists only
   **transiently in RAM on-device** where the key lives — exactly when the engine scans or
   indexes. Disk and wire only ever carry ciphertext.
5. **Cheap-first ladders; the bottom rung is deterministic and zero-model.** Extraction:
   `[[wikilink]]`/regex → (optional models later). Vectors: exact scan → quantized → ANN only on
   proven need. Deterministic = same input → same rows on every device = clean CRDT merges.
6. **Two fact semantics, two tables, never mixed.** `mentions` = append-only aboutness;
   `facts` = single-current-truth temporal claims (Mnemosyne's E6 data-loss lesson, designed in).
7. **Fuse ranks, not scores; abstain below the floor.** RRF (k=60), shipped and 3-way convergent.
   Adaptive relevance floors (0.15/0.3/0.5 by query length) make "no answer" the default.
8. **Compute at write, multiply at read.** Edges, hashes, IDs, classification happen once at
   ingest; read paths only filter, rank, and multiply constants.

---

## 1. Vocabulary

| Term | Role |
|---|---|
| **brain** | the memory subsystem of one identity (rows scoped by `owner`) |
| **memory** | atomic unit: verbatim content + embedding + typed scope + veracity + provenance |
| **scope** | typed, indexed columns — `stream` (surface), `author_role` (user/agent/system), `source` (origin row ref); the cheap deterministic filters |
| **entity** | named node (person/project/topic); the semantic graph primitive |
| **mention** | memory→entity edge (aboutness); append-only |
| **fact** | typed temporal claim between entities; validity window + confidence + veracity |
| **relation** | weighted entity↔entity association with dynamics (Hebbian growth / Ebbinghaus decay) |
| **dreaming** | the single scheduled consolidator (§6) |
| **L0–L3** | context layers: self-card · running summary · entity cards/facts · hybrid search |
| **ContextBundle** | the assembled, budgeted prompt text the LLM actually receives |
| **ContextTrace** | the stored receipt of one assembly: query, layers, hits (via/rank/score), budget |

---

## 2. Data model

### 2.1 The five brain tables — synced, sealed, owner-scoped

Brain tables are **normal manifest tables** in the shared identity store, exactly like
`messages`/`files`: a plaintext `owner` uuid column for routing/ACC, every content column sealed
before storage (`jazz_engine.rs::seal_column_plain`), synced via the capability-gated FrontierDag.
Embeddings sync too — a `Vector{768}` is packed f32 bytes, sealed like any other column. **Embed
once on any device, sync everywhere; index locally** (§3).

| Table | Columns (built ✅ in `libs/aven-brain/src/schema.rs`) | Δ additions |
|---|---|---|
| `memories` | `content Text`, `embedding Vector{768}`, `source`, `seq`, `line_start/line_end`, `content_date Timestamp`, `content_hash Bytea`, `source_version BigInt`, `normalize_version`, `created_at` | `owner Uuid` (routing) · `stream Text` · `author_role Enum[user,agent,system]` · `veracity Enum[stated,inferred,imported,tool,unknown]` · `superseded_by →memories` · `summary_of Array<→memories>` |
| `entities` | `name`, `kind`, `properties Json` | `owner` |
| `mentions` | `memory →memories`, `entity →entities` | `owner` |
| `facts` | `subject →entities`, `predicate`, `object →entities`, `valid_from`, `valid_to`, `confidence Double`, `source_memory` | `owner` · `veracity Enum` |
| `relations` | `a →entities`, `b →entities`, `strength`, `stability`, `access_count`, `last_access` | `owner` · `access_count` → Counter-merge (engine hook pending) |

### 2.2 One app table: `context_traces`

The historical record of what was actually sent to the LLM per human message — sealed, synced,
owner-scoped, so any device can inspect any turn's context:

```
context_traces { owner Uuid (plaintext, routing), message_id Text (sealed),
                 reply_id Text (sealed, nullable), trace Text (sealed ContextTrace JSON),
                 created_at_ms (sealed, exposeTs bigint) }
```

Stored as a table (not inside the message row) because message `body` already carries the
tool-call envelope `parseToolCallBody` parses, and multi-KB traces would bloat every `messages`
snapshot broadcast.

### 2.3 Manifest & migration obligations (E0 — highest blast radius)

- `libs/aven-schema/schema.manifest.json` gains the 5 brain tables + `context_traces`; the
  manifest type system gains **`vector`** (`schema_manifest.rs::column_type_from_manifest` has no
  vector mapping today).
- Changing the manifest changes the Groove `SchemaHash`. **In the same commit**: snapshot the old
  manifest to `libs/aven-schema/migrations/snapshots/`, register it in `migrations/registry.json`,
  and embed it in `schema_manifest.rs::install_runtime_schema_files` — otherwise existing vaults
  fail connect with "unknown schema hash". Add-only tables ⇒ non-draft auto-lens, data survives.

### 2.4 What we deliberately do NOT add

No working/episodic table split (typed scope columns + `summary_of` do it) · no `tier` column
(age-weights are pure `f(created_at)`) · no canonical table (L0 = the **self entity's**
compiled-truth card) · no scratchpad/banks (identities are the isolation) · no 13-type taxonomy
(small decay classes derived from the typed columns by the deterministic pass).

---

## 3. The engine seam — unseal-on-scan (the one prerequisite)

`nearest` (exact cosine) and `text_search` (BM25 `k1=1.5,b=0.75`) are built ✅ and scan **stored
values** — which, in the app store, are ciphertext (sealing happens app-side, above aven-db).
The seam: a **column-unseal transform** supplied by the DEK-holding layer, invoked wherever the
executor reads `embedding`/`content` values for ranking or for building local derived indexes.
Plaintext lives only in RAM during the scan; results (row ids + ranks) carry no plaintext.

- Filter-before-rank is already free (executor order `filter → rank → limit`): typed predicates
  (`owner`/`stream`/`author_role`/entity) are indexed and narrow candidates before any unsealing
  happens.
- **Scale ladder:** unsealed exact scan (now) → int8/bit quantized side-columns (32× smaller,
  Hamming popcount — Mnemosyne holds 35 ms @ 10M rows on exactly this; the local quantized cache
  is derived state, never synced) → HNSW only if a real workload misses budget.
- **Embedder consistency risk:** all devices of an identity must embed with the same model.
  Stamp the embedder id (e.g. `gemma-768` / `stub-768`) in a brain meta row; on change, a
  dreaming maintenance pass re-embeds (lens-driven). Default ships StubEmbedder (BM25-dominant,
  honest in the trace); EmbeddingGemma-300m ONNX behind the `models` feature (E7).

---

## 4. Write path — ingest everything

Sealed originals are the source of truth; the brain derives from them. Ingest **never blocks the
talk loop** (fire-and-forget, logged, idempotent).

1. **User turn** → `messages` row (sealed, synced) → `brain_ingest(content, stream='talk',
   author_role='user', source=row_id, content_date=created_at_ms)`.
2. **Agent reply** → after `resolveAgentTurn`, ingest the human-facing prose (not the tool-call
   envelope) with `author_role='agent'`, `veracity: inferred` (recallable, down-weighted;
   dreaming may promote it).
3. **Files — drop anything into the talk stream**: original stays verbatim + sealed in `files`
   (base64 `content`, via `persistSparkFiles`) → brain pipeline: **extract text** (markdown/text
   directly; PDF extraction next) → **chunk ≈800 chars / 80 overlap** → embed → one `memories`
   row per chunk with provenance (`source` = file row id, `seq`, `line_start/end`,
   `stream='talk'`, `author_role='user'`). Bytea originals are never searched directly — chunks
   are; citations link back to the file + line range via `source`.
4. **Deterministic graph on write** ✅: `[[wikilinks]]` + regex pass (entity patterns +
   fuzzy-merge ≥0.8 + stop-words; SPO patterns `is/has/uses/works at` conf 0.6–0.7, ≤5/memory,
   ≤4096-char input; temporal markers) → entities + mentions + relations.
5. **Idempotent + convergent**: `content_hash` dedup before embedding; deterministic extraction
   ⇒ two devices ingesting the same content converge (row dedup by hash, entity dedup by
   dreaming's merge pass).

---

## 5. Read path — `assemble_context`

One call before every LLM roundtrip (library method in `brain.rs`, testable without Tauri):

```
assemble_context(query, opts { working_n=8, recall_k=6, entity_cards=2,
                               budget_chars≈8000, scope: { stream: 'talk' } })
  L0  self-card (always)                      ← compiled-truth card of the "self" entity
  L1  running gist (always)
  WW  working window: last N session turns (chronological, always included)
  L3  search_traced(query): nearest + text_search → RRF k=60, hits carry via/rank/score,
      excluding ids already in the window
  L2  entity cards for entities named in the query
  →   budget: pin L0+L1 → window newest-first → recall by rank → cards; stop at budget_chars,
      count dropped → ContextBundle { prompt } + ContextTrace { … }
```

- **Budget reality:** llama.cpp runs LFM2.5-1.2B with `n_ctx = 4096`, `MAX_NEW_TOKENS = 512`
  (`libs/aven-ai/src/llama.rs:276`, `app/src-tauri/src/llm.rs:555`). ~8,000 chars (≈2k tokens) is
  the conservative default; `usedChars` surfaces in every trace so regressions are visible.
- **Score modifiers (Δ, after RRF):** veracity multiplier (stated 1.0 / inferred 0.7 / imported
  0.6 / tool 0.5 / unknown 0.8) · age weight (×1.0 <30d, ×0.5 <180d, ×0.25 ≥180d) · Weibull
  per-class recency (§9) · **abstention floor** (lexical overlap ≥0.15/0.3/0.5 by query tokens —
  return empty over noise) · cross-tier dedup (a summary and its `summary_of` sources never
  co-rank; `superseded_by` rows hidden).

**ContextTrace** (serde camelCase, stored sealed in `context_traces`, rendered by the UI):

```ts
type ContextTrace = {
  query: string
  l0Self: string
  l1Gist: string[]
  working:  { id: string; snippet: string; authorRole: 'user' | 'agent' | 'system' }[]
  recalled: { id: string; snippet: string; source?: string; rank: number;
              via: 'vector' | 'bm25' | 'both'; score: number }[]
  entities: { name: string; kind: string; relations: [string, number][] }[]
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
| Decay | ✅ | relations: `strength·exp(−days/stability)`, floor 0.05 |
| Entity-merge | ✅ | CRDT-safe merge of duplicate entities by normalized name |
| Consolidate | ☐ | old session turns → summary memory with **deterministic ID = f(identity, window)** (devices dreaming concurrently converge under LWW) + `summary_of` provenance |
| Verify facts | ☐ | Bayesian confidence on repeat mentions `conf += (1−conf)·w_veracity·0.3`; contradictions: keep both, mark loser `superseded_by`; recompute compiled-truth per entity |
| Promote | ☐ | load-bearing `author_role='agent'` (`inferred`) memories get verified/promoted |
| L1 rewrite | ☐ | deep rewrite of the running summary (incremental per-turn + batch here) |

---

## 7. Product experience

### 7.1 Forever talk — the brain is the context manager

There are no sessions (storage already is one identity-scoped stream). Today's prompt is
literally `todoPreamble + userPrompt` (`identity-agent.svelte.ts::replyWithAgent`). New flow:

```
submit(message, files)
  → messages.create(user row)            (sealed, synced — source of truth)
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
   hardcoded `IDENTITY_SCOPED_TABLES`. Every current and future table — including the five brain
   tables and `context_traces` — appears automatically. Per-row owner filtering stays.
2. **Type-aware cells** — shared helper (`app/src/lib/db/format-cell.ts`) detecting engine
   serializations: `{type:'Vector'}` → `Vector(768) [0.12, −0.45, …]` (+tooltip);
   `{type:'Bytea'}` → `0x1a2b3c… (n B)` hex; Timestamps → ISO + relative; FK/uuid cells
   (`memory`, `entity`, `a/b`, `subject/object`, `owner`, `message_id`) → clickable, jumping to
   the target table with an id filter.
3. **Brain search tab** — query + optional typed scope (stream / author_role) → `brain_search` → hits with via/rank/score
   badges, click-through to the `memories` row; entity list → entity-card panel; status strip
   (embedder, row counts) + **Dream** and **Backfill** buttons.

---

## 8. Execution roadmap

Each phase independently shippable, with files + verification:

| # | Phase | Files (key) | Verify |
|---|---|---|---|
| **E0** | **Manifest + migration**: `vector` type, 5 brain tables (+owner), `context_traces`; snapshot + registry + embedded snapshot **in the same commit** | `libs/aven-schema/schema.manifest.json`, `migrations/registry.json` + snapshot, `app/src-tauri/src/schema_manifest.rs` | existing vault boots (lens applies, no wipe); fresh vault boots; tables listed by `jazzStatus()` |
| **E1** | **Engine seam**: unseal-on-scan transform for `nearest`/`text_search`; aven-brain `open(identity)` over the shared store (owner scoping in queries); **migrate `remember`/`search_scoped`/`recall` to typed scope** — signatures take `Scope { stream, author_role, source }`, the as-built free-label parameter and the `memories` array column are removed; `remember_with` (source/content_date), `search_traced` (via/rank provenance), `assemble_context` | `libs/aven-db` executor/scan path, `libs/aven-brain/src/brain.rs`, `schema.rs` | `cargo test -p aven-brain`; sealed fixture: search returns correct rows, no plaintext at rest |
| **E2** | **App runtime**: brain module + Tauri commands `brain_status/ingest/search/entities/entity_card/assemble_context/backfill/dream` (asr/llm/tts pattern) + TS wrapper | new `app/src-tauri/src/brain.rs`, `app/src-tauri/src/lib.rs` (manage/handler/exit-drain), new `app/src/lib/brain/api.ts` | devtools: ingest → search round-trip on a real identity |
| **E3** | **Ingestion**: talk hooks (user/agent turns), file pipeline (markdown/text chunking; PDF next), backfill of pre-brain history, **drag-drop fix** | `identity-agent.svelte.ts`, `intent-files.ts`, `app/src/routes/+layout.svelte` | drop a .md on talk → stays on screen, chunks appear in `memories` with `source` = file row id; backfill idempotent (2nd run dedups all) |
| **E4** | **Context manager**: `assemble_context` wiring + `context_traces` writes + fallback path | `identity-agent.svelte.ts` | reply still streams with brain off (fallback); trace row per human message; prompt contains L0/L1/WW/recall blocks under budget |
| **E5** | **Right aside**: layout third column + drawer, `TalkContextAside`, message-click selection | `SlideAsideLayout.svelte`, `AsidePageLayout.svelte`, identity `+layout.svelte`, `IdentityTalkPanel.svelte`, new `TalkContextAside.svelte`, `talk-context.svelte.ts` | xl: aside shows newest trace; clicking older message swaps it; <xl drawer; other routes untouched; `bun run check` |
| **E6** | **DB viewer**: dynamic tables, `format-cell.ts`, FK navigation, brain search tab | `db/+page.svelte`, new `app/src/lib/db/format-cell.ts` | brain tables render readable; Vector/Bytea/Timestamp formatted; FK click navigates; search shows via badges |
| **E7** | **Models & depth**: EmbeddingGemma feature (download UX, embedder stamp, re-embed pass), lifecycle Δ columns live in scoring, dreaming v2 passes, quantized side-columns, honest eval harness (LongMemEval/LoCoMo, held-out only) | `app/src-tauri` feature wiring, `libs/aven-brain` | semantic (lexically-disjoint) recall works with Gemma; stub fallback clean; eval numbers reported held-out |

---

## 9. Constants (copy verbatim — settled, don't re-derive)

| From | Constants |
|---|---|
| MemPalace | candidates `k·3`; BM25 `k1=1.5, b=0.75`; dedup cosine `<0.15`; **chunk ≈800 / overlap 80**; dynamics `floor 0.05, max 5.0, potentiation +0.05, stability +0.1, spaced ≥1h`, decay `strength·exp(−days/stability)`; L0–L3 budgets |
| gBrain / built | **RRF k=60** `Σ 1/(60+rank)`; deterministic edges on write; compiled-truth + timeline per entity |
| Mnemosyne | veracity `1.0/0.7/0.6/0.5/0.8`; Bayesian `conf += (1−conf)·w·0.3`; abstention floors `0.15/0.3/0.5`; age weights `×0.5@30d, ×0.25@180d`; Weibull `profile k=.3 η=8760h · preference k=.4 η=4380h · fact k=.8 η=720h · event k=1.2 η=168h · request k=1.5 η=72h`; sign-bit quantization + Hamming; deterministic fact ID `sha256(len-prefixed NFC S|P|O)` |

---

## 10. Reference ledger

| Source | Married in | Refused |
|---|---|---|
| MemPalace | retrieval recipes, layered context, dynamics, neighbor expansion, citations | two planes; file-path hierarchy; AAAK |
| gBrain | compiled-truth + timeline, dream cycle, deterministic edges, RRF | per-shape hand schemas; single-operator |
| Mnemosyne | lifecycle, veracity+Bayesian, abstention, quantization, ladders, mentions/facts split | god-module; env sprawl; extra tables; bolt-on sync |
| avenOS | the plane: CRDT + ownership + capabilities + E2E sealing + sync | — |

---

## Appendix A — plain-language glossary

- **Brain** — each identity has one private memory store it fully owns; nobody else can read it.
- **Memory** — one saved thing, word-for-word: a chat message, a chunk of a document, a note.
- **Scope** — typed fields on every memory saying where it came from (`stream`), who authored it
  (`author_role`), and which row it derives from (`source`) — the fast "which drawer" filters.
- **Entity** — a thing the memories talk about: a person, project, place. A character in your story.
- **Mention** — a thread from a memory to an entity ("this memory talks about Alice"). Threads
  are only ever added, never erased.
- **Fact** — a precise dated claim between two entities ("Alice *works at* Acme, 2020–2023").
  Facts can expire but are never deleted.
- **Relation** — a friendship-strength wire between two entities; stronger with use, weaker when
  ignored — like a muscle.
- **Embedding** — a fingerprint of *meaning*: text turned into numbers so "I love pizza" and
  "pizza is my favorite" land close together. Computed on your device.
- **Content hash** — a fingerprint of the *exact text*, so saving the same thing twice just
  refreshes it instead of duplicating.
- **Hybrid search** — two searchers at once: one matches meaning, one matches exact words.
- **RRF** — how their answers combine: ignore scores, reward whatever ranks high on either list.
- **Veracity** — trust by *who said it*: you (1.0) > the AI guessed (0.7) > imported (0.6) > a
  tool (0.5).
- **Confidence** — trust by *how often confirmed*: repeats nudge it up, never to certainty.
- **Abstention** — if nothing matches well, the brain says *nothing* instead of guessing.
- **Decay / age weights** — old memories fade in ranking, never get erased; different kinds fade
  at different speeds (who-you-are: years; "remind me Tuesday": days).
- **L0–L3 / wake** — what gets loaded for the AI: who you are (always), your story summary
  (always), cards about entities in play, deep search. Wake = the always-on part.
- **ContextBundle** — the actual text package sent to the AI for one request.
- **ContextTrace** — the receipt: which memories were used, why each matched, what was dropped.
  Click any of your messages to see its receipt in the right panel.
- **Dreaming** — nightly cleanup: weaken unused wires, merge duplicate entities, roll old turns
  into summaries, double-check repeated facts, flag contradictions (keep both, mark the loser).
- **Compiled-truth card** — each entity's freshly rewritten "current state" atop its full dated
  history — a player's stat card above the complete game log. Your identity is your own card.
- **Sealed** — every row is locked with keys only your devices hold; servers store boxes they
  can't open. Plaintext exists only in your device's RAM while searching.
- **CRDT sync** — the math that lets your devices edit offline and merge later without a referee;
  every device ends up holding all your (sealed) data locally.
- **Local index** — the speed structure each device builds for itself from its local data; never
  uploaded, always rebuildable.
- **Quantization** — shrinking meaning-fingerprints 32× so search stays instant at millions of
  memories.

## Appendix B — parked: TEE extractor

The attested-TEE fact extractor (GLM-5.3 on Phala RedPill; trait seam `extractor.rs` built, no
impl) is **parked** — see `board/done/0010-aven-brain-execution-plan.md` §6b for the full design
(attest-or-refuse, provenance digests, phases P1–P4). Nothing in E0–E7 depends on it; the
deterministic graph is load-bearing without it. Revisit after E7.

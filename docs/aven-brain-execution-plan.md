# aven-brain — Execution Plan

> A **local-first, user-owned, CRDT-synced AI memory brain** — one **brain** per avenOS
> **identity**, built natively on **aven-db**. Verbatim memories + a living entity graph,
> hybrid vector+BM25 retrieval, end-to-end encrypted and capability-gated.
>
> Status: the engine foundation and the first `remember → search` pipeline are **built and
> tested**. This plan is the single source of truth for the design, what's done, and what's next.
> Date: 2026-06-06.

---

## 0. Vision

Every avenOS identity carries a **brain**: a private, encrypted, multi-device memory it fully
owns. The brain stores **memories** (verbatim), connects them through an **entity graph**
(mentions, facts, relations), and answers questions by **hybrid retrieval** (semantic + lexical)
assembled into agent context. Nothing is stored in the clear; nothing requires a server.

We distilled the strongest open reference (MemPalace) into a graph-native, CRDT form — keeping its
retrieval *strengths*, dropping its file-shaped metaphor and its one documented misfeature (AAAK).

---

## 1. Architecture & vocabulary

```
identity ── has ──▶ brain
                     ├─ memory*      verbatim content + embedding + tags + provenance
                     │     └─ mention ▶ entity        (what this memory is about)
                     ├─ entity*      person / project / topic / thing (semantic node)
                     │     ├─ fact      typed, temporal assertion  (entity—predicate→entity)
                     │     └─ relation  weighted association, dynamics (entity↔entity)
                     └─ context: L0 identity · L1 summary · L2 recall · L3 search   (wake)
```

| Term | Role |
|---|---|
| **brain** | the memory store of one identity |
| **memory** | atomic unit: verbatim content + embedding + tags + provenance |
| **entity** | named node; the semantic graph primitive |
| **mention** | memory→entity edge ("about X"); enriches retrieval (not the basic scope) |
| **tag** | free-form label; the **primary, cheap, deterministic scope** (no extraction, no join) |
| **fact** | *typed, temporal* assertion between entities (`valid_from`/`valid_to`) |
| **relation** | *weighted, associative* entity↔entity edge carrying **dynamics** |
| **dynamics** | relation strength/stability + Hebbian growth / Ebbinghaus decay |
| **context layers** | L0 identity · L1 summary · L2 recall · L3 search; `wake` = L0+L1 |

**The three edge layers are distinct** (same entities, different questions):
- **mention** = *aboutness* — "find memories that talk about X" (cheap, from NER).
- **fact** = *claim* — "Alice **works_at** Acme, 2020–2023" (typed + dated; supports `as_of`/invalidation).
- **relation** = *association strength* — "Alice↔Acme, strength 3.1" (weighted, decays; ranking/serendipity).

---

## 2. Data model (aven-db schema)

Five tables; edges named by what they are. (`libs/aven-brain/src/schema.rs`)

| Table | Key columns | Notes |
|---|---|---|
| `memories` | `content Text`, `embedding Vector{d}`, `tags Array<Text>`, `source`, `seq`, `line_start`, `line_end`, `content_date`, `content_hash Bytea`, `source_version`, `normalize_version`, `created_at` | `embedding`→`nearest`, `content`→`text_search`; provenance preserves neighbor expansion, citations, idempotent + incremental ingest |
| `entities` | `name`, `kind`, `properties Json` | indexed on (name, kind) |
| `mentions` | `memory→memories`, `entity→entities` | aboutness / scope-enrichment |
| `facts` | `subject→entities`, `predicate`, `object→entities`, `valid_from`, `valid_to`, `confidence`, `source_memory` | temporal KG |
| `relations` | `a→entities`, `b→entities`, `strength`, `stability`, `access_count`, `last_access` | dynamics (`access_count` → Counter-merge in Phase 3) |

One brain = one identity's tables. Native types used throughout: first-class `Vector` (not a blob
hack), `Bytea` for `content_hash`, `Array` for tags, `Timestamp` for times.

---

## 3. The engine foundation (aven-db) — ✅ DONE

aven-brain required two new core capabilities in aven-db; both are built, tested, committed:

- **`ColumnType::Vector { dim }`** + `Value::Vector(Vec<f32>)` — first-class embedding type,
  length-prefixed packed f32, round-tripping through every codec (`feat dcc2162`).
- **`nearest`** — exact-cosine top-k vector search (`QueryBuilder::nearest(col, vec, k)`), via a
  `SortTarget::VectorDistance` Sort→LimitOffset pair, zero executor changes (`feat 4579152`).
- **`text_search`** — BM25 top-k (`k1=1.5, b=0.75`, Lucene-smoothed IDF) over a `Text` column,
  corpus-scored + re-sorted (`feat 7ca0387`).
- **Filtered ranking is free**: the executor order is `filter → rank → limit`, so tag/entity
  filters narrow candidates *before* `nearest`/`text_search` — no ANN-exhaustion problem in exact mode.

Deferred (scale/maintenance, not needed for correctness): usearch/HNSW index, surfaced
`_distance`/`_score` column, lens-driven reindex.

---

## 4. The memory pipeline

**Built (`feat 199f080`):** `Brain` handle + `Embedder` trait + `remember`/`search`, end-to-end
through the real engine.

- **`remember(content)`** → embed (via `Embedder`) → write a `memories` row (content + `Vector`
  embedding + provenance).
- **`search(query, k)`** → embed query → run **both** retrievers (`nearest` cosine + `text_search`
  BM25, over-fetched) → **fuse with Reciprocal Rank Fusion (RRF)** → top-k.
  - RRF for v1 because it needs only rank positions (no surfaced scores). Weighted
    `0.6·vec + 0.4·bm25` (MemPalace-tuned) lands once a `_score` column is surfaced.

**Retrieval recipe (ported from MemPalace, to layer on):** hybrid fusion; neighbor expansion
(`source`+`seq`); temporal-proximity boost (`content_date`); closet-style compact index cards
(derived per entity); all tunable in the brain layer.

**Ingest hygiene (provenance already in schema):** idempotent re-ingest via `content_hash`;
incremental skip via `source_version`; silent rebuild via `normalize_version`; dedup (cosine
threshold ~0.15, à la MemPalace).

---

## 5. Security & ownership (inherited from aven-db, non-optional)

Every memory/entity/fact/relation is a CRDT row that is:
- **owned** — signed `OwnerBinding` in the immutable row header (`aven-caps/ownership.rs`),
- **authored** — `EditSignature` over the batch digest,
- **gated** — `authorize_signed_edit` = signature check **+** biscuit `caps::authorize`, verified by
  every peer on apply (no client/server split),
- **sealed** — per-identity DEK + AEAD; relays are blind store-and-forward,
- **synced** — capability-gated FrontierDag reconciliation; sharing = biscuit grants.

**Consequence:** embeddings must be computed where the DEK lives (on-device) — the crypto model
forbids handing plaintext memory to a third-party embedder. This makes "embeddings local" a
*requirement*, not a preference.

---

## 6. Model stack (privacy-first, behind traits)

Pluggable via traits (`Embedder` built; `Reranker`/`Extractor` to come). Principle: **embed +
retrieve + rerank on-device; only minimal decrypted context goes to a no-train/ZDR remote LLM.**

| Role | On-device default (≤8GB) | Optional upgrade |
|---|---|---|
| Embedding | **EmbeddingGemma-300m** (q4, ~0.2GB, 768-d Matryoshka) | voyage-4 (opted-out) |
| Rerank | skip / **Qwen3-Reranker-0.6B** on demand | Voyage rerank-2.5 |
| Extraction (entities/facts) | **Granite 4.0 Micro 3B** (q4, native JSON) | Claude Haiku 4.5 (batch) |
| Synthesis | — (retrieval-only) | household node (Gemma 4 31B) → Claude Opus 4.8 (ZDR) |

Deployment tiers: **T1 edge** (phone/8GB) · **T2 household node** (own GPU box, syncs via
identities) · **T3 managed API** (opt-in, minimal context).

---

## 7. Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| **Engine** | `Vector` + `nearest` + `text_search` in aven-db | ✅ done, tested |
| **Schema** | `memories/entities/mentions/facts/relations` | ✅ done, tested |
| **Pipeline v1** | `Brain` + `Embedder` + `remember`/`search` (RRF) | ✅ done, tested |
| **Store round-out** | idempotent `remember` (content_hash dedup), `tags` on write, **scoped `search`** (tag filter) | ✅ done, tested |
| **Knowledge graph** | **deterministic** `[[wikilink]]` → entities + mentions + relations w/ dynamics (zero-LLM, on write) ✅; typed `facts` via off-write-path LLM `Extractor` ☐ | ◑ graph done; facts pending |
| **Context assembly** | `wake` (L0+L1); `recall` (L2 scoped); **entity cards = compiled-truth summary + append-only timeline** (gBrain) | ☐ next |
| **Real models** | EmbeddingGemma behind `Embedder`; LLM `Extractor` (off write path) | ☐ |
| **Brain interface** | **Rust-native IPC bridge** (search/remember/kg/wake) — no MCP; an in-process/IPC API agents call directly | ☐ |
| **Dreaming** | background consolidation pass: dynamics decay, dedup, **CRDT entity-merge**, contradiction detection, recompute compiled-truth | ☐ |
| **Scale & sync** | usearch HNSW + `_score` surfacing + weighted fusion; Counter-merge dynamics; sparks/identity sharing + multi-device | ☐ |
| **Honest eval** | LongMemEval/LoCoMo harness against aven-brain (held-out numbers only) | ☐ |

---

## 8. Lessons from reference implementations

### MemPalace (distilled)
**Kept** (renamed/unified): spatial scope → tags + entities; drawer → memory; triple → fact;
hallway+tunnel → relation; dynamics; layered context; neighbor expansion; surgical citations;
temporal boost; idempotent/incremental ingest; hybrid `0.6·vec+0.4·bm25`, BM25 `k1=1.5/b=0.75`.
**Dropped**: AAAK compression (their own benchmark: 96.6%→84.2% regression); rigid file-path
wing/room hierarchy (subsumed by entities+tags, which add multi-membership).
**Honest bar**: their real numbers are 98.4% R@5 (LongMemEval held-out), 60.3%→88.9% LoCoMo —
we benchmark on held-out only.

### gBrain (Garry Tan) — `github.com/garrytan/gbrain` (MIT, Apr 2026)
A self-built personal "memex": **git-markdown files as source of truth + Postgres/pgvector
(PGLite locally) as a rebuildable index**, a self-wiring entity graph, hybrid retrieval, and an
MCP surface. Real and substantive (discount the YC-halo virality and its self-published synthetic
benchmark of P@5 49.1 / R@5 97.9 — small, not BEAM-comparable).

**Validates what we already built (independent convergence):**
- **RRF hybrid fusion** — gBrain uses the *exact* `Σ 1/(60+rank)` we shipped (vector + BM25 → RRF).
- **Index = disposable derived cache** (truth lives elsewhere) — matches our "derived index, never synced."
- Graph as a retrieval **boost**, not the core; **pluggable local embeddings** (Ollama/llama.cpp);
  **MCP scoped read/write/admin**; **typed predicates** (`works_at`/`founded`/`attended`/…).

**New ideas to adopt:**
1. **"Compiled-truth + append-only timeline" per entity.** Each entity = a recomputed current-state
   summary atop an immutable dated log. Ideal for CRDT: the timeline is an append-only (conflict-free)
   set; "compiled truth" is a periodically-recomputed materialized view. → Sharpens our **entity
   index cards** (L1/L2): *card = compiled-truth summary + timeline of the entity's facts/mentions.*
2. **Deterministic, zero-LLM edge extraction on write** (wikilinks/explicit refs → typed edges).
   Free, offline, and — crucially — **reproducible across devices** (same input → same edges =
   clean CRDT merges). → **Make deterministic mention/edge extraction the primary write path; keep
   the LLM `Extractor` optional and *off* the write path** (run it in the dream cycle).
3. **The "dream cycle" — a nightly background consolidator** (dedup/merge entities, fix citations,
   score salience, detect contradictions, recompute compiled-truth). → We adopt this as our
   **dreaming** phase: the natural home for **dynamics decay**, **CRDT entity-merge** (two offline
   devices both create "Alice"), **contradiction detection**, and **summary recompute**.
4. **Compiled-truth + contradiction detection answers our "conflicting facts" question** — keep both
   facts, let the dream cycle flag contradictions and recompute the entity's compiled truth, rather
   than hard LWW.

**Avoid:**
- **Schema burden** — gBrain makes the operator hand-author a skill per new fact-shape (its biggest
  wart). Keep loose structure (free predicates + tags); any schema synthesis stays off the write path.
- **Single-operator assumption** — gBrain explicitly punts on multi-tenant/sync; that is exactly our
  CRDT differentiator — design merge + isolation from day one.
- Don't over-trust self-published synthetic benchmarks; evaluate engineering on its merits.

---

## 9. Status (commits & tests)

aven-db: `Vector` (dcc2162), `nearest` (4579152), `text_search` (7ca0387); suite restored
266-errors→green (0aa32b9, d03d058), `Vector` lib tests + nearest/text_search tests pass.
aven-brain: scaffold+schema (1b92f72), strengths restored (d195345), vocabulary finalized
(bbb188b, 39cc31f, 525f27c, de8c8aa), pipeline (199f080), store round-out — idempotent
remember + tags + scoped search (dfb3701), deterministic knowledge graph
(3be5cec). **aven-brain: 10 tests pass.**

---

## 10. Open decisions & risks

1. **Conflicting facts** across devices (same subject/predicate, different object): lean
   **gBrain-style** — keep both, let **dreaming** detect the contradiction and recompute the
   entity's compiled-truth, rather than hard LWW. Confirm with the KG phase.
2. **Embedding-dim lock-in**: changing the model ⇒ re-embed + reindex (lens-driven).
3. **Counter-merge for `relations.access_count`**: needs a `TableSchemaBuilder` merge-strategy hook
   (currently LWW) so co-access sums across devices.
4. **RRF vs weighted fusion**: RRF now (rank-only); weighted `0.6/0.4` once `_score` is surfaced.
5. **Honest benchmarking**: held-out numbers only; never tune on the test set.
6. **Frontier-only sync**: the legacy client/worker sync layer is slated for removal (tracked task)
   in favor of pure FrontierDag.

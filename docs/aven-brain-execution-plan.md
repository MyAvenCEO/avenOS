# aven-brain — Full-Stack Execution Plan

> A local-first, CRDT-synced, user-owned **AI memory brain** built by first extending **aven-db**
> into a vector + full-text + relational + graph engine, then porting MemPalace's proven
> architectural patterns on top of it.
>
> Status: draft v1 · Date: 2026-06-06 · Source: deep-dive of `github.com/MemPalace/mempalace`
> (190 py files) + source audit of `libs/aven-db`.

---

## 0. Thesis & strategy

MemPalace is the strongest open-source reference, but it runs on **two storage planes**:
a *pluggable* vector store (the "drawers") and a set of **hard-wired SQLite/JSON side-stores**
(temporal knowledge graph, tunnels, hallways, dynamics). Only the vector plane is swappable;
the graph plane — exactly where CRDT semantics matter most — is locked to local SQLite with
*"no subscriptions"* (their words).

**aven-brain unifies both planes on aven-db.** We do not fork MemPalace and write one backend
adapter (that would CRDT-ize only the drawers). Instead we:

1. **Extend aven-db** with two new derived secondary-index kinds: **vector (ANN)** and
   **full-text (BM25)**. aven-db already stores vectors (`Bytea`) and already has a centralized,
   well-factored secondary-index subsystem — so this is additive, not a rewrite.
2. **Build aven-brain** as a thin schema + retrieval-policy layer on the extended engine, porting
   MemPalace's patterns (spatial model, hybrid retrieval, temporal validity, spaced-repetition
   dynamics, layered context) as aven-db tables and queries.
3. **Keep embeddings/retrieval/reranking on-device**; reserve remote LLMs for synthesis only.

Payoff: every memory primitive (drawers, triples, connections) becomes CRDT-synced,
capability-gated (identities + biscuit caps), cryptographically owned, and multi-device — something MemPalace cannot do at all — and the
vector/text search benefits the whole avenOS platform, not just the brain.

---

## 1. What we learned from MemPalace

### 1.1 Patterns to ADOPT

| Pattern | Where (MemPalace) | What to copy |
|---|---|---|
| **Spatial model** | wings (people/projects) → rooms (topics) → drawers (verbatim chunks) | Scope retrieval by metadata, never flat-sweep. |
| **Hybrid retrieval** | `searcher.py:_hybrid_rank` | `score = 0.6·vec_sim + 0.4·bm25_norm`; BM25 Okapi `k1=1.5, b=0.75`; **absolute** (not relative-to-max) normalization so incremental candidates don't reshuffle ranks. |
| **Closet rank boosts** | `searcher.py` | `[0.40, 0.25, 0.15, 0.08, 0.04]`, distance cap `1.5`. |
| **Neighbor expansion** | `_expand_with_neighbors` | Pull ±1 sibling chunks around a hit for context. |
| **Temporal validity** | `knowledge_graph.py` | `valid_from`/`valid_to` (NULL = open); `as_of` filter; invalidation = append `valid_to`, **never delete**. |
| **Spaced-repetition dynamics** | `dynamics.py` | Hebbian potentiation + Ebbinghaus decay. Constants: `STRENGTH_FLOOR=0.05`, `MAX_STRENGTH=5.0`, `DEFAULT_STABILITY=1.0`, `POTENTIATION_INCREMENT=0.05`, `SPACED_INTERVAL_HOURS=1.0`, `STABILITY_INCREMENT=0.1`; decay `strength·exp(-days/stability)`. |
| **Layered context** | `layers.py` | L0 identity (~100 tok) + L1 essential story (~500–800 tok, hard cap 3200 chars) always loaded; L2 on-demand recall; L3 deep search. `wake_up()` = L0+L1. |
| **Deterministic IDs + idempotent upsert** | `ids.py`, miner | ID = f(wing, room, source, chunk_index); re-mine overwrites, never duplicates. |
| **Dynamics preservation on recompute** | hallways/tunnels | Re-derive structure but copy forward strength/stability/access_count by canonical key. |
| **Provider abstraction** | `llm_client.py` | `LLMProvider.classify(system, user, json_mode, think)`; providers `ollama` / `openai-compat` / `anthropic`; stdlib-only; `is_external_service` privacy heuristic (localhost/RFC1918/Tailscale/IPv6-ULA detection). |
| **Embedding injection seam** | `embedding_wrapper.py` | Backends declaring `requires_explicit_embeddings` get wrapped; embeddings computed once per batch at the seam. |
| **Source-adapter contract** | RFC 002, `sources/base.py` | Entry-point registry; `ingest()` yields metadata then records; **declared transformations** (machine-verifiable "byte_preserving"); privacy classes (`public`→`secrets_possible`). |
| **Config precedence** | `config.py` | env > config.json > defaults. |
| **Fault-tolerant deriveds** | miner post-passes | Tunnel/hallway computation never fails a write. |

### 1.2 Patterns to AVOID / improve

- **Two non-synced planes** → unify on aven-db (CRDT) so the graph syncs too.
- **JSON-file tunnels/hallways** → aven-db tables with `Counter`-merge columns.
- **Single-device SQLite KG** → CRDT triples table; concurrent multi-device fact edits merge.
- **Benchmark "teaching to the test"** → their own docs admit the 99.4%→100% LongMemEval step
  was three targeted fixes for three known-failing questions. Set our bar on **held-out** numbers.

### 1.3 The honest benchmark reality (set our eval bar here)

| Benchmark | Honest number | Inflated number (avoid citing) |
|---|---|---|
| **LongMemEval** | **98.4% R@5** on 450 held-out (never tuned) | "100% with Haiku rerank" (tuned on 3 failures) |
| **LoCoMo** | **60.3% R@10** raw, **88.9%** hybrid-v5 (top-10) | "100%" (top-50 > session count → retrieval bypassed) |
| **MemBench** | 80.3% R@5 overall; "noisy" only **43.4%** | — |

Embedding in their benches: `all-MiniLM-L6-v2` (384-d) default, `embeddinggemma-300m` (multilingual)
recommended. Rerank: `claude-haiku-4-5` (~$0.001/q) / `claude-sonnet-4-6`.

---

## 2. FOUNDATION FIRST — extend aven-db with vector + full-text indexes

> **Key discovery:** aven-db already has a *centralized, clean* secondary-index subsystem.
> Index maintenance flows through a single hook (`apply_row_mutation`) fed by the converged
> winning rows (`visible_entries`). Adding ANN/FTS = two new index kinds on an existing seam —
> **no architectural blockers found.**

### 2.1 The existing seam (verbatim entry points)

- **Schema:** `libs/aven-db/src/query_manager/types/schema.rs`
  - `ColumnType` enum (`Integer, BigInt, Boolean, Text, Enum, Timestamp, Double, Uuid, BatchId, Bytea, Json, Array, Row`).
  - `TableSchema { columns, indexed_columns: Option<Vec<ColumnName>>, policies }`;
    `is_indexed_column()` already gates which columns get a secondary index.
  - `ColumnMergeStrategy::Counter` (the only non-LWW merge today).
- **Query:** `libs/aven-db/src/query_manager/query.rs`
  - `Query { table, branches, joins, disjuncts, order_by, limit, offset, include_deleted, select_columns, array_subqueries, recursive, relation_ir, … }`.
  - `Condition { Eq, Ne, Lt, Le, Gt, Ge, Between, Contains, IsNull, IsNotNull }`.
  - `QueryBuilder` DSL (`.filter_eq`, `.order_by`, `.limit`, `.build`).
- **Storage:** `libs/aven-db/src/storage/storage_trait.rs`
  - `index_insert / index_remove / apply_index_mutations / index_lookup / index_range / index_scan_all`.
  - `IndexMutation::{Insert,Remove}{table,column,branch,value,row_id}` (`storage/mod.rs`).
  - **`apply_row_mutation(table, history_rows, visible_entries, index_mutations)`** ← the choke-point.
  - Indexes live in raw tables via `key_codec::index_raw_table(...)` / `index_entry_key(...)`.
- **Visible-row hook:** `libs/aven-db/src/row_histories/resolution.rs` →
  `VisibleRowEntry::rebuild_with_descriptor()` finalizes the merged winning row (honors
  soft-delete + durability tier). **This is where derived index updates are generated.**
- **Runtime:** `libs/aven-db/src/runtime_tokio.rs` → `batched_tick()` (1 ms debounce) applies writes.
- **Executor:** `libs/aven-db/src/query_manager/graph/execute.rs` → `index_scan_nodes` registry +
  `mark_dirty_for_column()` invalidation. New `knn_scan`/`fts_scan` node types hook here.
- **Client:** `libs/aven-db/src/avenos_client.rs` → `query/create/update/delete/subscribe`
  (no signature change; `query` already takes a `Query`).

### 2.2 Changes to make

**(a) Schema** — add a vector column type and typed index kinds:
```rust
// schema.rs
pub enum ColumnType { /* …existing… */ Vector { dim: usize } }

pub enum IndexKind {
    BTree,                                               // current default
    Hnsw  { metric: VectorMetric, m: usize, ef_construction: usize },
    FullText { analyzer: Analyzer },
}
// Add to TableSchema (additive; keep `indexed_columns` for back-compat):
pub vector_indexes:   Vec<IndexSpec>,   // IndexSpec { column, kind: Hnsw{..} }
pub fulltext_indexes: Vec<IndexSpec>,   // IndexSpec { column, kind: FullText{..} }
```
Vectors don't merge — they replace under LWW (no `Counter`). Lens migration that changes a
vector's `dim` or the embedding model triggers an index rebuild (see 2.4).

**(b) Query model** — KNN/BM25 are *ranking + top-k*, not boolean filters, so they are query-level
fields, not `Condition` variants:
```rust
// query.rs — add to Query:
pub nearest:     Option<VectorSearchSpec>,  // { column, vector: Vec<f32>, k, ef_search }
pub text_search: Option<TextSearchSpec>,    // { column, query: String }
// builder: .nearest(col, vec, k)  .text_search(col, q)
```
Flow inside the executor: `nearest`/`text_search` produce **candidates + scores** → existing
`disjuncts` (where) filter them → `order_by`/`limit` finalize. Scores surface as a synthetic
`_score` / `_distance` column so the brain can fuse them.

**(c) Index maintenance** — in `apply_row_mutation`, after `visible_entries` are computed, emit
derived ANN/FTS upserts/removes alongside the existing `index_mutations`. Because it reads the
**converged winning row**, soft-deletes and durability tiers are handled for free.

**(d) Index engines (Rust crates):**
- ANN → **usearch** (serializable, supports filtered search; bindings mature) or `hnsw_rs`.
  Persist segments in a derived raw table, or keep in-RAM and rebuild from `index_scan_all` on open.
- FTS → **tantivy** (real BM25, tokenizers, phrase queries) *or* a native inverted-index in raw
  tables porting MemPalace's BM25 (`k1=1.5, b=0.75`). Tantivy is the faster path to quality.

**(e) The CRDT invariant (non-negotiable):** the ANN/FTS index is **local derived state, never
synced**. Rows sync via CRDT batches/FrontierDag exactly as today; each replica builds its own
index from its converged rows. No new sync surface, no index-merge research problem.

### 2.3 Filtered-KNN — decide up front
`nearest` + a restrictive `where` (e.g. `wing = X`) can exhaust `k`. Strategy: over-fetch
(`k·3`) then post-filter, or use usearch's filter predicate. Log when over-fetch still
under-fills (no silent truncation).

### 2.4 Index rebuild on lens migration
Tie ANN/FTS rebuild to `SchemaHash` changes and to embedding-model changes. (MemPalace re-embeds
via `repair.py` on model switch; we drive it through aven-db's lens system + a derived-index
version stamp.)

### 2.5 In-engine sequencing
- **A.** Vectors as `Bytea` + **exact cosine in the executor** (no ANN index). Proves the query
  shape + correctness baseline. Mirrors MemPalace `sqlite_exact`. Good to ~50–100k rows/identity.
- **B.** Promote to usearch HNSW derived index (scale).
- **C.** Add tantivy/inverted FTS.
- Embedding generation stays **outside** the engine: aven-db stores & searches vectors; the brain
  computes embeddings.

---

## 3. aven-brain data model (on the extended aven-db)

One **memory palace = one identity** — a capability-scoped, cryptographically-owned, encrypted,
syncable collection (the concept formerly called a *spark*; renamed in the latest main —
`spark_acc.rs → identity_acc.rs`, `/[sparkId] → /[identityId]`). Per-row biscuit caps + a signed
owner-binding give per-memory privacy *and* provenance (see §11).

| Table | Key columns | Index kinds | Merge notes |
|---|---|---|---|
| `drawers` | `document Text`, `embedding Vector{d}`, `wing Text`, `room Text`, `source Text`, `chunk_index Int`, `content_date Timestamp`, `normalize_version Int`, `entities Text`, `filed_at Timestamp` | Hnsw(embedding), FullText(document), BTree(wing,room,source) | LWW |
| `entities` | `name Text`, `type Text`, `properties Json` | BTree(name,type) | LWW |
| `triples` | `subject Uuid→entities`, `predicate Text`, `object Uuid→entities`, `valid_from Timestamp`, `valid_to Timestamp`, `confidence Double`, `source_drawer Uuid`, `extracted_at Timestamp` | BTree(subject,object,predicate), BTree(valid_from,valid_to) | LWW (invalidate = set `valid_to`); decide multi-value for conflicting assertions |
| `connections` | `kind Enum[tunnel,hallway]`, `a_key Text`, `b_key Text`, `strength Double`, `stability Double`, `access_count Int`, `last_access Timestamp` | BTree(a_key,b_key,kind) | **`access_count` = Counter merge** (co-access sums across devices) |
| `identity` | `text Text` (L0) | — | LWW |

`as_of` temporal queries = `Between`/`Le`/`Ge` on `valid_from`/`valid_to`. Graph traversal =
aven-db `RecursiveSpec`. Hybrid recall = `nearest` + `text_search` on `drawers`.

---

## 4. The memory pipeline (ported onto aven-brain)

**Write path:** source adapter (port RFC-002 contract + declared transforms) → normalize
(noise-strip, `normalize_version`) → chunk (≈800 chars, 80–100 overlap) → **embed locally** →
dedup (cosine distance `< 0.15`, greedy longest-first) → entity/triple extraction (LLM, cheap
tier) → write `drawers` + `triples`; update `connections` (potentiate). Deterministic IDs +
idempotent upsert.

**Read path:** embed query (local) → engine `nearest` (k·3 over-fetch) + `text_search` → fuse
`0.6·vec + 0.4·bm25` + temporal-proximity boost + closet rank-boosts → neighbor expansion →
*optional* rerank → assemble layered context (L0+L1 on wake, L2 recall, L3 search) → *optional*
remote synthesis on minimal retrieved context.

**Dynamics:** scheduled decay tick over `connections` (`strength·exp(-days/stability)`, floor
0.05); potentiate on co-access (Counter `access_count`, +0.05 strength, +0.1 stability if gap ≥1h).

**Agent surface:** MCP server mirroring MemPalace's tool set (`search`, `add_drawer`,
`check_duplicate`, `kg_query/add/invalidate/timeline`, `traverse`, `wake_up`, …).

---

## 5. The LLM / embedding / rerank stack — which remote models to plug

**Principle:** *embeddings + retrieval + reranking on-device; only minimal retrieved context goes
to a no-train / zero-retention remote LLM for synthesis.* That confines third-party exposure to a
small, controllable slice instead of the whole memory store.

> Note (corrected from earlier assumptions): the field moved to **Voyage 4** (Jan 2026),
> **Cohere Rerank 4**, **Claude Haiku 4.5 / Opus 4.8**. Prices = list per 1M tokens unless noted.

### 5.1 Embedding — **default LOCAL**
| Role | Model | Dim | Why |
|---|---|---|---|
| **Default (quality)** | **Qwen3-Embedding** (0.6B edge / 4B–8B quality) | configurable 256–2048 | Top open-weight, #1 MTEB-multilingual at release; never leaves device |
| Hybrid lexical+semantic | **BGE-M3** | 1024 | dense+sparse+ColBERT in one |
| Edge / tiny | nomic-embed-text 1.5 (768) / MiniLM (384) | — | runs anywhere |
| Optional hosted upgrade | **voyage-4** ($0.06) / **voyage-4-large** ($0.12) | 1024 (256–2048 Matryoshka) | **voyage-4-nano is open-weight & shares voyage-4's embedding space** → embed locally now, optionally call hosted later **without re-indexing** |

⚠️ **Voyage trains on your data by default** — must opt out (zero-day retention). Prefer local
embedding for raw memory; only consider hosted Voyage if opted-out.

### 5.2 Reranking
| Choice | Model | Note |
|---|---|---|
| **Local/open-weight (preferred)** | **jina-reranker-v3** | 0.6B listwise, 131K ctx, SOTA multilingual; on-device |
| Remote, cheap, token-priced | **Voyage rerank-2.5** ($0.05/1M; lite $0.02) | ~600 ms; predictable for short query+candidate payloads |
| Long-document | **Cohere Rerank 4** (32K ctx) | pricing unverified (v3.5 was $2/1k searches) |

### 5.3 Generation / extraction — **two-tier Claude** (best privacy posture)
| Tier | Model | Price in/out | Role |
|---|---|---|---|
| **Cheap, high-volume** | **Claude Haiku 4.5** | $1 / $5 | Memory mining: entity/triple extraction, summaries over the whole corpus. Use **Batch API (~50% off)** for overnight consolidation. |
| **Flagship, low-volume** | **Claude Opus 4.8** | $5 / $25 | Final synthesis + hard query understanding on minimal retrieved context. |
| Cheaper alternatives | Gemini 2.5 Flash-Lite ($0.10/$0.40), GPT-5 mini ($0.25/$2.00) | — | extraction if cost dominates |

**Why Claude for the remote slice:** Anthropic commercial API **does not train on inputs/outputs
by default** and offers **Zero Data Retention** — the strongest default among hosted LLMs for a
user-owned memory app. (OpenAI: 30-day default retention, ZDR only via enterprise. Google: paid
tier no-train; confirm tier terms.)

### 5.4 Provider abstraction (copy MemPalace)
Implement `LLMProvider` with `ollama` / `openai-compat` / `anthropic`, stdlib-only HTTP, a single
`classify(system, user, json_mode, think)` interface, and the `is_external_service` privacy
heuristic. Default endpoint local (Ollama); remote is **BYOK, opt-in, never silent**.

### 5.5 Default config (shipping posture)
| Slot | Default | Optional remote upgrade |
|---|---|---|
| Embedding | Qwen3-Embedding (local) | voyage-4 (opted-out) |
| Rerank | jina-reranker-v3 (local) or none | Voyage rerank-2.5 |
| Extraction | local Ollama model | Claude Haiku 4.5 (batch) |
| Synthesis | — (retrieval-only by default) | Claude Opus 4.8 (ZDR) |

---

## 6. Phased roadmap

| Phase | Deliverable | Exit criteria | Primary risk |
|---|---|---|---|
| **0 — Spike** | aven-db `Vector` column + **exact-cosine** query (Bytea); brain skeleton; local embedding; write/read `drawers`. Run LongMemEval + LoCoMo harness against aven-brain. | Honest baseline number reproduced; query shape validated. | Embedding model choice / dim lock-in. |
| **1 — Engine indexes** | usearch HNSW derived index + tantivy FTS in aven-db (the §2 patch); hybrid fusion in brain. | `nearest`+`text_search` return scored candidates; filtered-KNN correct; index survives restart. | Filtered-KNN exhaustion; index rebuild on lens migration. |
| **2 — Temporal KG** | `entities`/`triples` on aven-db; `as_of` filter; recursive traversal; invalidation. | KG queries match MemPalace semantics; multi-device fact merge works. | LWW vs multi-value for conflicting assertions. |
| **3 — Dynamics + context** | `connections` with Counter merge; potentiate/decay tick; L0–L3 layered context; MCP surface. | Co-access counts sum across two replicas; wake_up ≤ ~900 tok. | Decay scheduling under CRDT. |
| **4 — Identities + remote tiers** | identity sync + per-row biscuit caps + owner-binding/edit-sig verified on apply; remote embedding/rerank/synthesis tiers; honest eval harness. | Shared memory across avens; held-out eval ≥ MemPalace held-out. | Privacy gating of remote calls. |

---

## 7. Risks & open decisions

1. **Filtered-KNN semantics** — over-fetch+filter vs index-side predicate; log under-fills.
2. **Conflicting fact assertions** — two devices assert different `object` for same
   `subject/predicate`: LWW (lose one) vs multi-value (keep both, confidence-weighted)? Decide in Phase 2.
3. **Embedding-dim lock-in** — changing model ⇒ re-embed + reindex; drive via lens + derived-index
   version stamp (MemPalace solves the re-embed half in `repair.py`; we add the reindex half).
4. **HNSW memory footprint** per identity — budget RAM; consider on-disk usearch.
5. **Honest benchmarking** — report held-out numbers only; never tune on the test set.
6. **Privacy gating** — remote calls must be opt-in per role; embeddings default local.

---

## 8. Appendix — exact aven-db patch entry points

```
schema:            libs/aven-db/src/query_manager/types/schema.rs   (ColumnType ~L77; TableSchema ~L379)
query model:       libs/aven-db/src/query_manager/query.rs           (Query ~L565; Condition ~L137; builder ~L766)
storage indexes:   libs/aven-db/src/storage/storage_trait.rs         (index_* ~L1489; apply_row_mutation ~L983)
IndexMutation:     libs/aven-db/src/storage/mod.rs
visible-row hook:  libs/aven-db/src/row_histories/resolution.rs      (rebuild_with_descriptor; called storage_trait ~L1331)
runtime tick:      libs/aven-db/src/runtime_tokio.rs                  (batched_tick)
executor:          libs/aven-db/src/query_manager/graph/execute.rs   (index_scan_nodes; mark_dirty_for_column ~L47)
client API:        libs/aven-db/src/avenos_client.rs                  (query/create/update/delete/subscribe)
```

---

## 9. Architecture decision — build vs. mimic MemPalace

**Decision: neither fork nor slavish mimic. aven-brain is a fresh native package on aven-db that
adopts MemPalace's *patterns and recipes*, not its code or its two-plane storage structure.**

| Option | Verdict |
|---|---|
| **A. Fork MemPalace, write an aven-db backend** | ❌ Reject. Language mismatch (Python/Chroma/SQLite vs Rust/aven-db) and it CRDT-izes only the drawers — the graph stays in non-synced SQLite, the exact problem we're solving. |
| **B. Mimic the architecture 1:1** | ❌ Reject. A literal mimic re-imports structural choices (separate stores, file-based tunnels, single-device assumptions) that fight a CRDT engine. |
| **C. Native re-architecture, pattern-compatible** | ✅ **Adopt.** Take the concepts + proven recipes, implement natively on aven-db, collapse the two planes into one CRDT-synced store. |

**Copy verbatim (settled, language-agnostic — don't re-derive):** hybrid fusion `0.6·vec + 0.4·bm25`;
BM25 `k1=1.5, b=0.75`; dynamics math + constants (`STRENGTH_FLOOR=0.05`, `MAX_STRENGTH=5.0`,
`POTENTIATION_INCREMENT=0.05`, `SPACED_INTERVAL_HOURS=1.0`, `STABILITY_INCREMENT=0.1`,
`strength·exp(-days/stability)`); temporal validity semantics; dedup `< 0.15`; chunk ≈800/overlap 80;
L0–L3 token budgets; closet boosts `[0.40,0.25,0.15,0.08,0.04]`.

**Reinvent natively (must be CRDT/aven-db):** one unified store (not two planes); tunnels/hallways as
aven-db tables (not JSON); KG as CRDT `triples` (not single-device SQLite); sync + sharing via
**identities** — capability-scoped, signed, encrypted collections (MemPalace has none); index
maintenance via aven-db derived indexes (not Chroma/FTS5).

**Skip:** MemPalace's backend abstraction (aven-db *is* the backend), ChromaDB, the Python LLM client
(reimplement the provider abstraction in Rust/TS).

**Package shape:** `aven-brain` = schema defs + write pipeline + retrieval policy + dynamics +
context assembly + model adapters, depending on the extended aven-db. Not a fork.

---

## 10. On-device model decisions (≤ 8GB RAM) + deployment tiers

Realistic budget on an 8GB device ≈ 3.5–4.5GB for models (rest is OS + app). All picks verified
mid-2026 against primary sources.

### 10.1 Per-role picks

| Role | **Decision** | Footprint | Why |
|---|---|---|---|
| **Embedding** | **EmbeddingGemma-300m** (q4) | **~0.2GB** | 768-dim Matryoshka → 128/256 (huge vector savings), 2K ctx, 100+ langs, best-in-class MTEB for size. Fallback: bge-small-en-v1.5 (~70MB, English). Upgrade for long-doc/instruction retrieval: Qwen3-Embedding-0.6B (32K ctx). |
| **Reranker** | **Skip by default on 8GB**; if needed **Qwen3-Reranker-0.6B** (q4, load on demand) | ~0.5GB | 768-dim retrieve is enough for a personal store; reserve RAM for the LLM. |
| **Extraction LLM** | **Granite 4.0 Micro 3B** (q4_K_M) | **~2.0GB** | Native JSON output + OpenAI-schema tool calls, 128K ctx, Apache-2.0, hybrid Mamba-2 (~70% less memory). Quality alt: **Qwen3-4B-Instruct-2507** (~2.5GB) with grammar-constrained JSON. Phone-class: Gemma 4 E2B (~1GB). |

**Resident combo:** EmbeddingGemma + Granite 4.0 Micro + KV cache + runtime ≈ **2.8–3.1GB** → fits 8GB ✅.
Adding the reranker resident ≈ 3.3–3.6GB (tight) → prefer on-demand load/unload. Always enforce JSON
via grammar/schema constraint (`llama.cpp --json` / Ollama `format`) — at q4 this matters more than model choice.

### 10.2 Three deployment tiers (fits avenOS's local-first + identities model)

| Tier | Hardware | Models | Data exposure |
|---|---|---|---|
| **T1 — Edge** | phone / 8GB laptop | EmbeddingGemma + Granite Micro (local extraction + retrieval) | None — fully on-device |
| **T2 — Household node** | user's own 16–32GB GPU box, another **aven peer** syncing via identities | **Gemma 4 31B** / GLM-4.5-Air / Qwen3-32B for synthesis | Stays in the household network — the privacy-preserving way to get big-model quality |
| **T3 — Managed API (opt-in)** | cloud | **GLM-4.6** (open-weight, $0.43/$1.74) default; **DeepSeek V3.2** cheapest; **Kimi K2 Thinking / GLM-5** top reasoning; Claude Opus 4.8 (ZDR) for max privacy posture | Minimal retrieved context only; per-role opt-in |

Gemma 4 31B is the bridge: too big for an 8GB device, but ideal on a **self-hosted T2 node** so heavy
synthesis stays inside the user's own network instead of a third party. Reranking: prefer local
Qwen3-Reranker; if remote, GLM-4.7 Flash ($0.06/$0.40) or DeepSeek V3.2.

> Supersedes the generic picks in §5 with concrete, RAM-validated choices.

---

## 11. Security model — enforced by aven-db, inherited by aven-brain (non-optional)

aven-brain stores nothing in the clear and trusts no peer. It inherits avenOS's cryptographic
ownership + capability model **verbatim** — every memory row is owned, signed, encrypted, and
capability-gated. This is a hard requirement, not a feature flag. (Ref:
`libs/aven-board/board/CryptoOwnershipExecutionPlan.md` — "Ownership & Identities", invariants locked.)

| Layer | Mechanism (actual merged code) | What aven-brain must do |
|---|---|---|
| **Identity** | did:key ed25519 device keys (`libs/aven-db/src/did_key.rs`) | Every drawer/triple/connection lives under an identity (the palace). |
| **Ownership** | **`OwnerBinding`** — signed "value belongs to identity", in the row's **immutable authenticated header**, covered by the row digest; *no mutable owner column* (`libs/aven-caps/src/ownership.rs`) | Stamp `_owner_binding` on every memory row at create. |
| **Authorship** | **`EditSignature`** over the batch content digest; travels in `_edit_sig` meta | Sign every write; unsigned edits aren't authentic. |
| **Apply gate** | **`authorize_signed_edit`** = verify signatures (authenticity) **+** biscuit `caps::authorize` (authorization), run by **every peer on apply** — interactive or always-on, *no client/server split* (`libs/aven-db/src/capability.rs`) | Never bypass; issue normal writes and let the engine enforce. |
| **Authorization** | Biscuit capability tokens (`libs/aven-caps/src/caps.rs`): `read/write/delete/replicate` + owner rights; offline-verifiable | Per-memory / per-room sharing = biscuit grants, not app logic. |
| **Confidentiality (E2E)** | Per-identity DEK envelopes + AEAD cell sealing (`app/src-tauri/src/crypto.rs`); relays are **blind store-and-forward** (hold no key) | Memory text **and embeddings** are sealed; a relay/peer without the DEK can't read them. |
| **Sync gating** | `may_sync(subject, op, resource) → Allow / DenyPermanent / Pending` resolver (`app/src-tauri/src/biscuit_resolver.rs`); revoke **re-wraps the rotated DEK to all keyshare-holders** | A row only flows to a peer holding a chaining cap; revocation is cryptographic (forward-secret). |

**Hard consequence for the model stack (ties back to §10):** because content is sealed
per-identity, **embeddings must be computed where the DEK lives** — the local (T1) or household
(T2) node, *never* a blind relay or an untrusted embedder. The crypto model itself forbids handing
plaintext memory to a third-party embedding API. That is the deepest reason embeddings default to
**local**, and why a remote LLM (T3) only ever receives the minimal decrypted context the
key-holder explicitly chooses to send.

**Net:** identities + biscuit caps + ed25519 owner-binding & edit-signatures verified by every peer
on apply + per-identity DEK/AEAD sealing + capability-gated sync = end-to-end, distributed,
cryptographically secure, **user-owned** memory. ✔

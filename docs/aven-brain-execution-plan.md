# aven-brain — Full-Stack Execution Plan

> A local-first, CRDT-synced, user-owned **AI memory brain** built by first extending **aven-db**
> into a vector + full-text + relational + graph engine, then porting the proven patterns of two
> references on top of it: **MemPalace** (spatial retrieval, hybrid search, KG, dynamics) and
> **Mnemosyne** (memory lifecycle, veracity, abstention, quantization, radical simplicity).
>
> Status: draft v2 · Date: 2026-06-10 · Sources: deep-dive of `github.com/MemPalace/mempalace`
> (190 py files) + **full source audit of `github.com/AxDSan/mnemosyne` v3.5.0** (single-SQLite
> memory engine; see §1.4 and §12) + source audit of `libs/aven-db`.

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

### 1.4 Second source audit — Mnemosyne (`AxDSan/mnemosyne` v3.5.0, June 2026)

Mnemosyne is the **simplicity counterweight** to MemPalace: the entire brain — working memory,
episodic memory, FTS5, sqlite-vec ANN, temporal triples, annotations, canonical identity slots,
consolidation log — lives in **one SQLite file**, stdlib-first, every LLM strictly optional with
a regex fallback under it. It independently validates our core bet (one storage plane) *and*
supplies the subsystems MemPalace doesn't have: a **memory lifecycle**, **veracity provenance**,
**abstention**, and **vector quantization**.

#### 1.4.1 Patterns to ADOPT

| Pattern | Where (Mnemosyne) | What to copy |
|---|---|---|
| **Bilevel memory + sleep()** | `beam.py` working_memory → episodic_memory | Hot tier (24h TTL, ≤10k rows, auto-injected context) consolidated by a `sleep()` tick: select unconsolidated rows older than TTL/2, **atomically claim** (`UPDATE … SET consolidated_at=now WHERE consolidated_at IS NULL` — crash/concurrency-safe), summarize (LLM ladder, lossless-compression fallback), insert summary with `summary_of` provenance. **Originals are never deleted** — the "additive memory contract". |
| **Tiered degradation (ageing, not deletion)** | `_degrade_episodic()` | Tier 1→2 at 30 d (importance ×0.5), 2→3 at 180 d (×0.25, optional content truncation to 300 chars). 9.4× storage compression while everything stays recallable. |
| **Extraction ladder — regex first, LLM optional** | MEMORIA, `entities.py`, `episodic_graph.py`, `temporal_parser.py`, `typed_memory.py` | Always-on zero-LLM pass: entities via 6 regex patterns + Levenshtein fuzzy-merge (≥0.8) + stop-word filters; SPO facts via 4 patterns (`X is/has/uses/works at Y`, conf 0.7/0.6/0.6/0.7, ≤5 facts/row, 4096-char regex input cap); temporal parsing pure regex + date math; 13 memory types via 68 patterns. LLM extraction is an **upgrade, never a dependency** (temperature 0.0 ⇒ re-ingest idempotent; fallback chain host → remote → local GGUF → skip gracefully). |
| **Veracity provenance** | `veracity_consolidation.py` | Every row tagged `stated 1.0 / inferred 0.7 / imported 0.6 / tool 0.5 / unknown 0.8`; applied as a score **multiplier at recall**. Bayesian consolidation per repeated mention: `conf += (1−conf)·w·0.3`, cap 1.0. Conflicting facts: higher confidence wins, loser marked `superseded_by` — **never deleted**. Deterministic fact IDs `cf_ + sha256(len-prefixed NFC subject|predicate|object)[:24]`. |
| **Triples vs annotations split (the E6 lesson)** | `triples.py` vs `annotations.py`, migration `e6_triplestore_split.py` | Two fact semantics, two tables: **single-current-truth temporal** triples (`add()` auto-invalidates same subject+predicate by closing `valid_until`) vs **append-only multi-valued** annotations (mentions, sources, occurred_on). They mixed them once — auto-invalidation silently destroyed multi-valued facts — and had to ship a split migration. Never mix the two semantics. |
| **Abstention gates** | `_minimum_recall_relevance` | Minimum lexical-overlap floor adaptive to query length: **0.15 (1–2 tokens) / 0.3 (3) / 0.5 (4+)**; below floor return nothing. Result: 100% BEAM abstention accuracy — the system never hallucinates an answer from irrelevant memories. |
| **RRF fusion once signals > 2** | `polyphonic_recall.py` | 4 independent "voices" (vector / graph / fact / temporal) fused by **reciprocal-rank fusion, k=60**: `score = Σ 1/(60+rank_i)`. Position-based ⇒ no cross-signal score calibration needed. Diversity re-rank afterwards; per-voice ablation flags. |
| **Weibull per-type decay** | `weibull.py`, `typed_memory.py` | Classify `memory_type` **once at ingest** (cheap regex), score forever: survival `exp(−(t/η)^k)` — profile k=0.3 η=8760h · preference k=0.4 η=4380h · fact k=0.8 η=720h · event k=1.2 η=168h · request k=1.5 η=72h. Identity decays in years, requests in days. |
| **Vector quantization before ANN** | `binary_vectors.py`, sqlite-vec `int8`/`bit` | Sign-bit binarization: 384-d float32 (1536 B) → **48 B (32×)**, Hamming distance via popcount table; int8 middle tier (4×). Their 10M-row benchmark: **35 ms latency, 7.2 MB storage, flat recall curve** — quantized exact scan, no HNSW at all. |
| **Deferred-commit bulk ingest** | `remember_batch` + `_deferred_commits` | One transaction per import batch instead of per-row commits: 250k-row import drops from hours to seconds. Maps 1:1 onto aven-db batches. |
| **Canonical identity slots** | `canonical.py` (v3.5) | Owner-scoped `(owner, category, name) → body` with **exactly one open row per slot** (partial unique index on `valid_until IS NULL`); re-stating an unchanged body is a no-op; version monotonic; history preserved. Strictly better than a single mutable L0 blob. |
| **Cross-tier dedup** | recall assembly | A consolidation summary and its source rows must never both appear in one result set. |
| **Semantic query cache** | `query_cache.py` | 5 tiers: exact hash → embedding cos ≥0.88 → cos ≥0.78 ∧ Jaccard ≥0.15 → synonym overlap ≥70% → miss. Invalidated on every write (aven-db `subscribe` gives us this invalidation for free). |
| **Scratchpad** | `scratchpad` table | Ephemeral agent workspace — never embedded, never consolidated, never searched. Cheap and load-bearing for agent UX. |
| **Multi-agent identity columns** | `author_id`, `author_type(human/agent/system)`, `channel_id` | Per-row authorship + cross-session grouping. We get a stronger version free from `OwnerBinding`/`EditSignature` (§11), but keep `author_type`/`channel_id` as queryable columns. |

#### 1.4.2 What Mnemosyne CHANGES in this plan

1. **Adds the missing lifecycle.** MemPalace gave us spatial retrieval + dynamics but no hot
   tier, no consolidation, no ageing. We adopt working→episodic + `sleep()` + tier degradation
   (§3 lifecycle columns, §4 consolidation).
2. **Resolves open decision §7.2** (conflicting fact assertions): multi-value + Bayesian
   confidence + `superseded_by`, never LWW-drop, never delete.
3. **Reorders extraction**: the regex ladder runs always and first; LLM extraction is an opt-in
   enrichment, not a write-path dependency (§4).
4. **Demotes HNSW**: int8/bit-quantized exact scan is the new Phase 1; HNSW only if the
   quantized scan misses the latency budget (§2.5, §6).
5. **Adds abstention as a core requirement**, not a nicety (§4 read path).
6. **Upgrades L0 identity** from one text blob to canonical slots (§3).

#### 1.4.3 Patterns to AVOID

- **The 7,400-line god-module** — `beam.py` holds schema, scoring, consolidation, quantization
  and caching in one file. We keep module-per-concern.
- **Env-var sprawl** — 60+ `MNEMOSYNE_*` vars as the only config surface. Typed config with
  documented defaults instead.
- **Bolt-on sync** — `DeltaSync` is allowlist-based row copying with destination-controlled
  columns; a patch, not a convergence model. aven-db CRDT supersedes it entirely.
- **No ownership/crypto** — bearer-token MCP auth is the whole security story. §11 supersedes.
- **Back-compat dual-writes** — a legacy `memories` table is dual-written for old readers.
  aven-db lenses/migrations avoid accreting parallel stores.
- **Benchmark caveats** — BEAM *retrieval* recall@10 is a flat **20%** (honestly reported, but
  weak); the headline LongMemEval 98.9% used 100 instances; BEAM judge models differ across
  systems so cross-system scores aren't comparable. Keep our §1.3 held-out discipline.

#### 1.4.4 Convergent evidence — where both references independently agree

One storage plane · hybrid lexical+vector beats either alone · embeddings local by default ·
**never delete** (invalidate / supersede / decay) · static inspectable fusion weights over learned
rankers · deterministic IDs ⇒ idempotent ingest · derived structure never fails a write ·
honest held-out benchmarking. These convergences are load-bearing: treat them as settled.

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

### 2.5 In-engine sequencing (cheap-first ladder — revised per §1.4)
- **A.** Vectors as `Bytea` + **exact cosine in the executor** (no ANN index). Proves the query
  shape + correctness baseline. Mirrors MemPalace `sqlite_exact`. Good to ~50–100k rows/identity.
- **B.** **Quantized exact scan** — int8 (4×) and sign-bit binary (32×, Hamming via popcount)
  side-columns derived from the float vector. Mnemosyne holds **35 ms at 10M rows** on exactly
  this; at personal-brain scale this may be the *terminal* state, not a stopgap. Quantized scan →
  top-k·4 candidates → exact-cosine re-score on the float vectors.
- **C.** usearch HNSW derived index — **only if** the quantized scan misses the latency budget
  for a real workload. Don't build it speculatively.
- **D.** Add tantivy/inverted FTS (can land in parallel with B).
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
| `drawers` | `document Text`, `embedding Vector{d}`, `wing Text`, `room Text`, `source Text`, `chunk_index Int`, `content_date Timestamp`, `normalize_version Int`, `filed_at Timestamp` — **lifecycle:** `importance Double`, `veracity Enum[stated,inferred,imported,tool,unknown]`, `memory_type Enum`, `tier Int (1/2/3)`, `consolidated_at Timestamp`, `superseded_by Uuid`, `summary_of Array<Uuid>`, `author_type Enum[human,agent,system]`, `channel_id Text` | Hnsw/quantized(embedding), FullText(document), BTree(wing,room,source), BTree(consolidated_at) | LWW. Lifecycle stamps re-weight, **never delete**. A summary drawer carries `summary_of` provenance (cross-tier dedup key). |
| `entities` | `name Text`, `type Text`, `properties Json` | BTree(name,type) | LWW |
| `triples` | `subject Uuid→entities`, `predicate Text`, `object Uuid→entities`, `valid_from Timestamp`, `valid_to Timestamp`, `confidence Double`, `veracity Enum`, `mention_count Int`, `superseded_by Uuid`, `source_drawer Uuid`, `extracted_at Timestamp` | BTree(subject,object,predicate), BTree(valid_from,valid_to) | **Single-current-truth temporal semantics** (new assertion closes `valid_to` of the old). Conflicts: **multi-value + Bayesian confidence** `conf += (1−conf)·w_veracity·0.3`; loser gets `superseded_by`, nothing deleted (§7.2 resolved). `mention_count` = **Counter merge** — repeat mentions sum across devices. Deterministic fact ID = hash(NFC, len-prefixed S\|P\|O). |
| `annotations` | `drawer_id Uuid→drawers`, `kind Text (mentions/fact/occurred_on/has_source/…)`, `value Text`, `source Text`, `confidence Double` | BTree(drawer_id,kind), BTree(kind,value) | **Append-only, multi-valued — never auto-invalidated.** Kept separate from `triples` by design (Mnemosyne's E6 lesson: mixing the two semantics silently destroys multi-valued facts). |
| `connections` | `kind Enum[tunnel,hallway]`, `a_key Text`, `b_key Text`, `strength Double`, `stability Double`, `access_count Int`, `last_access Timestamp` | BTree(a_key,b_key,kind) | **`access_count` = Counter merge** (co-access sums across devices) |
| `canonical` | `category Text`, `name Text`, `body Text`, `version Int`, `valid_from Timestamp`, `valid_to Timestamp`, `confidence Double` | BTree(category,name) | Replaces the single `identity` blob. **Exactly one open row per (category,name) slot** (open = `valid_to IS NULL`); restating an unchanged body is a no-op; version monotonic; history preserved. L0 context = rendered set of open canonical slots. |
| `scratchpad` | `content Text`, `session Text`, `created_at Timestamp` | BTree(session) | **Local durability tier — never synced, never embedded, never consolidated, never searched.** Agent working notes only. |

**Lifecycle model (one table, not two).** Mnemosyne splits `working_memory` / `episodic_memory`
into separate tables; on aven-db we keep **one `drawers` table with lifecycle columns** — simpler,
and recall scopes by predicate instead of table choice. "Working memory" = rows with
`consolidated_at IS NULL` younger than the TTL (hot, auto-injectable). `sleep()` writes a summary
drawer (`summary_of = [source ids]`) and stamps sources `consolidated_at`. The ageing tick stamps
`tier` 2/3 at 30/180 d; tier weights (×1.0/0.5/0.25) apply **at scoring time** — degradation is a
re-weighting, content truncation is an optional storage-reclaim knob, never silent.

`as_of` temporal queries = `Between`/`Le`/`Ge` on `valid_from`/`valid_to`. Graph traversal =
aven-db `RecursiveSpec`. Hybrid recall = `nearest` + `text_search` on `drawers`.

---

## 4. The memory pipeline (ported onto aven-brain)

**Write path:** source adapter (port RFC-002 contract + declared transforms) → normalize
(noise-strip, `normalize_version`) → chunk (≈800 chars, 80–100 overlap) → **embed locally** →
dedup (exact-content fast path with timestamp refresh, then cosine distance `< 0.15`, greedy
longest-first) → **extraction ladder** → write `drawers` (+ derived `annotations`/`triples`);
update `connections` (potentiate). Deterministic IDs + idempotent upsert; bulk imports as one
aven-db batch (deferred-commit pattern). Extraction **never blocks or fails a write** — it is a
fault-tolerant post-pass.

**Extraction ladder (cheap-first; each rung optional except the first):**
1. **Regex, always on, zero cost** (port Mnemosyne MEMORIA): entities (6 patterns + Levenshtein
   fuzzy-merge ≥0.8 + stop-word filter, ≤4096-char regex input), SPO facts (`is/has/uses/works at`,
   conf 0.6–0.7, ≤5/drawer), temporal tags (pure regex + date math), `memory_type` classification
   (pattern-based, once at ingest). Results → `annotations` (append-only) + `triples`.
2. **Local LLM, opt-in** (Granite Micro / Ollama, §10): richer triple + summary extraction at
   temperature 0 (idempotent re-ingest), grammar-constrained JSON.
3. **Remote LLM, opt-in + BYOK** (Claude Haiku batch, §5): overnight consolidation mining only.

**Consolidation (`sleep()` tick, new):** select drawers with `consolidated_at IS NULL` older than
TTL/2 (default TTL 24 h, batch ≤5000) → summarize via the same ladder (rung 1 fallback = no
summary, just tier stamping) → write summary drawer with `summary_of` + **deterministic summary ID
= f(identity, wing, time-window)** → stamp sources `consolidated_at`. Determinism makes
consolidation **idempotent across devices**: two replicas that both run sleep converge on the same
summary row under LWW instead of duplicating (replaces Mnemosyne's single-node atomic claim).
Ageing tick stamps `tier` 2/3 at 30/180 d.

**Read path:** semantic query cache (exact hash → cos ≥0.88 → cos ≥0.78 ∧ Jaccard ≥0.15;
invalidated via aven-db `subscribe`) → embed query (local) → engine `nearest` (k·3 over-fetch) +
`text_search` → fuse `0.6·vec + 0.4·bm25` + closet rank-boosts → **score modifiers:** veracity
multiplier (stated 1.0 / inferred 0.7 / imported 0.6 / tool 0.5 / unknown 0.8) · tier weight
(×1.0/0.5/0.25) · **Weibull per-type recency** `exp(−(t/η)^k)` (constants §9) · temporal-proximity
boost → **abstention floor** (lexical overlap ≥ 0.15/0.3/0.5 by query token count — return empty
over returning noise) → **cross-tier dedup** (a summary and its `summary_of` sources never co-rank)
→ neighbor expansion → *optional* rerank → assemble layered context (L0 = canonical slots + L1 on
wake, L2 recall, L3 search) → *optional* remote synthesis on minimal retrieved context.
**Fusion evolution:** weighted `0.6/0.4` while we have 2 signals; when graph + temporal voices
land (Phase 3), switch to **RRF k=60** — position-based fusion needs no cross-signal calibration.

**Dynamics:** scheduled decay tick over `connections` (`strength·exp(-days/stability)`, floor
0.05); potentiate on co-access (Counter `access_count`, +0.05 strength, +0.1 stability if gap ≥1h).
Drawer-level recency uses Weibull per `memory_type` (classified once at ingest, scored forever).

**Agent surface:** MCP server mirroring MemPalace's tool set (`search`, `add_drawer`,
`check_duplicate`, `kg_query/add/invalidate/timeline`, `traverse`, `wake_up`, …) **plus the
Mnemosyne tools that earn their keep:** `sleep`, `get(id)` (deterministic read), `invalidate`
(supersede with replacement), `remember_canonical`/`recall_canonical`,
`scratchpad_write/read/clear`, `stats`, `diagnose` (PII-safe health check), `export`/`import`.

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
| **0 — Spike** | aven-db `Vector` column + **exact-cosine** query (Bytea); brain skeleton; local embedding; write/read `drawers`; **regex extraction ladder rung 1 + abstention floors** (both zero-dependency). Run LongMemEval + LoCoMo harness against aven-brain. | Honest baseline number reproduced; query shape validated; nonsense queries return empty. | Embedding model choice / dim lock-in. |
| **1 — Engine indexes** | **int8/bit-quantized exact scan** + tantivy FTS in aven-db (the §2 patch); hybrid fusion in brain; usearch HNSW *only if* quantized scan misses latency budget. | `nearest`+`text_search` return scored candidates; filtered-KNN correct; index survives restart. | Filtered-KNN exhaustion; index rebuild on lens migration. |
| **2 — Temporal KG** | `entities`/`triples`/`annotations` on aven-db; `as_of` filter; recursive traversal; invalidation; **Bayesian veracity consolidation**. | KG queries match MemPalace semantics; multi-device fact merge works; conflicting assertions keep both rows with `superseded_by`. | Triples/annotations semantic split discipline. |
| **3 — Lifecycle + dynamics + context** | **`sleep()` consolidation with deterministic summary IDs; tier ageing**; `connections` with Counter merge; potentiate/decay tick; Weibull per-type scoring; **RRF fusion** once >2 voices; L0 canonical slots + L1–L3 layered context; MCP surface. | Co-access counts sum across two replicas; two replicas running sleep converge on one summary; wake_up ≤ ~900 tok. | Sleep/decay scheduling under CRDT. |
| **4 — Identities + remote tiers** | identity sync + per-row biscuit caps + owner-binding/edit-sig verified on apply; remote embedding/rerank/synthesis tiers; honest eval harness. | Shared memory across avens; held-out eval ≥ MemPalace held-out. | Privacy gating of remote calls. |

---

## 7. Risks & open decisions

1. **Filtered-KNN semantics** — over-fetch+filter vs index-side predicate; log under-fills.
2. **Conflicting fact assertions — ✅ RESOLVED (Mnemosyne recipe, §1.4):** multi-value. Keep both
   rows; Bayesian confidence `conf += (1−conf)·w_veracity·0.3`; the higher-confidence row marks
   the other `superseded_by`; nothing deleted; `mention_count` Counter-merges across devices. LWW
   applies per-row only, never per-fact.
3. **Embedding-dim lock-in** — changing model ⇒ re-embed + reindex; drive via lens + derived-index
   version stamp (MemPalace solves the re-embed half in `repair.py`; we add the reindex half).
   Quantized side-columns (int8/bit) re-derive from the float vector for free.
4. **HNSW memory footprint** per identity — **largely defused**: bit/int8-quantized exact scan
   (48 B per 384-d vector; Mnemosyne: 35 ms @ 10M rows) is the default; HNSW only on proven need.
5. **Honest benchmarking** — report held-out numbers only; never tune on the test set; judge-model
   scores aren't comparable across systems (BEAM lesson).
6. **Privacy gating** — remote calls must be opt-in per role; embeddings default local.
7. **Multi-device `sleep()` races** — mitigated by deterministic summary IDs (idempotent
   convergence under LWW); verify the no-duplicate-summary property in the Phase 3 exit test.
8. **Tier-3 content truncation under E2E encryption** — truncation is a normal LWW rewrite of the
   sealed cell; keep it an explicit user-facing storage-reclaim knob, never automatic data loss.

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

**Copy verbatim from Mnemosyne (same status):** veracity weights `stated 1.0 / inferred 0.7 /
imported 0.6 / tool 0.5 / unknown 0.8`; Bayesian update `conf += (1−conf)·w·0.3`; abstention
floors `0.15 / 0.3 / 0.5` by query token count; RRF `k=60`; Weibull `exp(−(t/η)^k)` with
`profile k=0.3 η=8760h · preference k=0.4 η=4380h · fact k=0.8 η=720h · event k=1.2 η=168h ·
request k=1.5 η=72h`; tier thresholds `30 d / 180 d` with weights `×0.5 / ×0.25`; working-memory
TTL `24 h`, sleep batch `5000`; query-cache thresholds `cos ≥0.88`, `cos ≥0.78 ∧ Jaccard ≥0.15`;
sign-bit binarization + Hamming popcount; deterministic fact ID `sha256(len-prefixed NFC S|P|O)`.

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

---

## 12. First-principles synthesis — the simplest maintainable brain that scales

Two independent, benchmark-proven systems (MemPalace: 190 files, two storage planes, Python/Chroma;
Mnemosyne: one SQLite file, stdlib-first) converge on the same physics. Where they agree, the
design is settled; where they differ, Mnemosyne's simpler answer wins unless CRDT semantics demand
otherwise. The laws:

1. **One storage plane.** Every memory primitive — chunks, facts, annotations, connections,
   canonical slots — lives in the same engine under the same merge/sync/security semantics.
   For us that plane is aven-db; the plane *is* the architecture.
2. **Memory is append-only state with lifecycle stamps.** Forgetting = re-weighting
   (`tier`, decay, `superseded_by`, `valid_to`) — never deletion. Both systems converged on this
   independently; it is also exactly what a CRDT wants.
3. **Everything derived is rebuildable and never blocks a write.** Indexes (ANN/FTS), summaries,
   extractions, caches: all are local derived state, recomputable from converged rows, applied as
   fault-tolerant post-passes. Corollary: derived state is **never synced** (§2.2e).
4. **Cheap-first ladders, every rung optional except the first.** Extraction: regex → local LLM →
   remote. Vectors: exact → quantized → ANN. Recall: cache → search → rerank → synthesis. The
   bottom rung is always zero-dependency and deterministic, so the brain *works* — air-gapped, on
   a phone, with no model present — and every upgrade is an enrichment, not a requirement.
5. **Two fact semantics, two tables.** Single-current-truth temporal state (`triples`) and
   append-only multi-valued observations (`annotations`) must never share a table. Mnemosyne paid
   for mixing them with a data-destroying bug and a migration; we get the split for free by
   starting with it.
6. **Fuse ranks, not scores, beyond two signals.** Weighted score fusion (0.6/0.4) is fine for
   vec+bm25; the moment graph/temporal/fact voices join, RRF (k=60) removes the cross-signal
   calibration problem entirely.
7. **Abstain by default.** A memory system that returns nothing is right more often than one that
   returns its best guess. Adaptive relevance floors are ~10 lines of code and bought Mnemosyne a
   perfect abstention score.
8. **Confidence = provenance × repetition.** Who said it (veracity weight) and how often
   (Bayesian mention updates) — not model vibes. Conflicts resolve by confidence and leave both
   rows standing.
9. **Classify once at ingest, score forever.** Memory type, chunk IDs, fact IDs, temporal tags
   are content-intrinsic — compute them at write time with cheap deterministic code; read paths
   only ever multiply constants.
10. **Determinism is the distributed-systems strategy.** Deterministic IDs (chunk = f(wing, room,
    source, index); fact = hash(S|P|O); summary = f(identity, window)) make ingest idempotent and
    multi-device convergence automatic — re-mining, re-importing, or two replicas doing the same
    work all collapse to the same rows under LWW.

**The minimal core (what "simplest that scales" actually means here):** Phase 0–1 is one table
(`drawers` + lifecycle columns), quantized exact scan + FTS, the regex extraction rung, and
abstention floors — a complete, useful, zero-LLM brain. Everything else in this plan (temporal KG,
dynamics, consolidation, voices, rerank, remote tiers) is an **independently removable layer** on
that core: each can be disabled without breaking the layer below. That separability — not any
single component — is the maintainability guarantee, and aven-db's CRDT + capability substrate is
what turns Mnemosyne-grade simplicity into a multi-device, user-owned system neither reference
can be.

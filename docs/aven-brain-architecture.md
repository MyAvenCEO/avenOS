# aven-brain — Unified Architecture (v3)

> **The one plan.** Merges the avenBRAIN session's built-and-tested implementation
> (`libs/aven-brain`, archived plan `libs/aven-board/board/done/0010`) with the Mnemosyne-enriched
> execution plan (v2, git `5806356`) into a single, first-principles architecture — compacted
> toward Mnemosyne's radical simplicity while keeping the best of every reference.
>
> Status: v3 · 2026-06-10 · Sources: **as-built aven-brain** (5 tables, RRF, deterministic KG,
> dreaming, EmbeddingGemma — done + tested) · **MemPalace** (retrieval recipes) · **gBrain**
> (compiled-truth, dream cycle, deterministic edges) · **Mnemosyne** v3.5.0 (lifecycle, veracity,
> abstention, quantization) · `libs/aven-db` source audit.
> Forward integration/UX work item: `board/idea/0009-brain-as-context-manager.md`.

---

## 0. First principles (the laws)

Three independent, benchmark-proven systems and our own build converge on the same physics.
Where all agree, it is settled. Where they differ, the simplest answer wins unless CRDT
semantics demand otherwise.

1. **One storage plane.** Every primitive — memories, entities, mentions, facts, relations —
   is a CRDT row in the identity's aven-db store, under one merge/sync/security model.
   The plane *is* the architecture. (All four systems converge here.)
2. **Five tables, forever.** New capability = a column, a read-path function, or a dreaming
   pass — never a sixth table. The schema is the complexity budget.
3. **Forgetting = re-weighting, never deletion.** `superseded_by`, `valid_to`, confidence,
   decay, age-weights. History survives; ranking changes. (MemPalace, gBrain and Mnemosyne all
   arrived here independently — and it is exactly what a CRDT wants.)
4. **Derived state is rebuildable, never blocks a write, never syncs.** Indexes, summaries,
   extracted edges, compiled-truth cards, caches: all recomputable from converged rows, all
   applied as fault-tolerant post-passes, all local.
5. **Cheap-first ladders; the bottom rung is deterministic and zero-model.** Extraction:
   `[[wikilink]]`/regex → attested-TEE LLM. Vectors: exact → quantized → ANN-if-proven-needed.
   Recall: filter → rank → assemble. The brain *works* air-gapped on a phone; every model is an
   upgrade, never a dependency. Bonus: deterministic = same input → same rows on every device =
   clean CRDT merges.
6. **Two fact semantics, two tables, never mixed.** `mentions` is append-only aboutness
   (multi-valued, never invalidated); `facts` is single-current-truth temporal claims
   (`valid_from`/`valid_to`). Mnemosyne mixed them once, silently destroyed data, and shipped a
   split migration (their E6). Our schema starts split.
7. **Fuse ranks, not scores; abstain below the floor.** RRF (k=60) needs no cross-signal
   calibration — shipped here, used by gBrain, proven by Mnemosyne's 4-voice engine. Adaptive
   relevance floors (0.15/0.3/0.5 by query length) make "no answer" the default over noise —
   worth a perfect abstention score for ~10 lines of code.
8. **Compute at write, multiply at read.** Classification, edges, hashes, IDs are
   content-intrinsic — extracted once, deterministically, at ingest. Read paths only filter,
   rank, and multiply constants. Sub-millisecond recall falls out.

---

## 1. Architecture & vocabulary (as built)

```
identity ── has ──▶ brain                                (one per identity, DEK-sealed)
                     ├─ memory*      verbatim + embedding + tags + veracity + provenance
                     │     └─ mention ▶ entity           (aboutness — append-only)
                     ├─ entity*      person / project / topic / thing
                     │     ├─ fact      typed temporal claim   (entity—predicate→entity)
                     │     └─ relation  weighted association + dynamics (entity↔entity)
                     ├─ context: L0 self-card · L1 summary · L2 graph · L3 search
                     └─ dreaming: the one background consolidator (§5)
```

| Term | Role |
|---|---|
| **memory** | atomic unit: verbatim content + embedding + tags + veracity + provenance |
| **tag** | free label; the primary, cheap, deterministic scope (`session:S`, `role:user`, `doc:D`, …) |
| **entity** | named node; the semantic graph primitive |
| **mention** | memory→entity edge (aboutness); append-only |
| **fact** | typed temporal claim between entities; validity window + confidence + veracity |
| **relation** | weighted entity↔entity association carrying dynamics (Hebbian/Ebbinghaus) |
| **dreaming** | the single scheduled consolidator: decay, merge, consolidate, verify (§5) |
| **context layers** | L0 self-card · L1 running summary · L2 entity cards/facts · L3 hybrid search |

---

## 2. Data model — five tables (`libs/aven-brain/src/schema.rs`)

Built columns are live and tested; **Δ = additive columns from the Mnemosyne merge** (small,
nullable, no migration pain).

| Table | Built columns | Δ additions |
|---|---|---|
| `memories` | `content Text`, `embedding Vector{768}`, `tags Array<Text>`, `source`, `seq`, `line_start/line_end`, `content_date`, `content_hash Bytea`, `source_version`, `normalize_version`, `created_at` | `veracity Enum[stated,inferred,imported,tool,unknown]` · `superseded_by →memories` · `summary_of Array<→memories>` |
| `entities` | `name`, `kind`, `properties Json` | — |
| `mentions` | `memory →memories`, `entity →entities` | — (append-only by law 6) |
| `facts` | `subject →entities`, `predicate`, `object →entities`, `valid_from`, `valid_to`, `confidence`, `source_memory` | `veracity Enum` (+ later: `mention_count` Counter once the merge-strategy hook lands) |
| `relations` | `a →entities`, `b →entities`, `strength`, `stability`, `access_count`, `last_access` | `access_count` → Counter-merge (open task) |

**What we deliberately did NOT add** (the compaction — each absorbed by something simpler):

- **No working/episodic table split** (Mnemosyne has two tables). Working memory = recent
  memories tagged `session:S` with `summary_of`-free status; one table, scoped by predicate.
- **No `tier` column.** Age-weights (×1.0 / ×0.5 / ×0.25 at 30/180 d) are pure functions of
  `created_at`, computed at scoring time. A column would be a cache of a subtraction.
- **No canonical table.** Mnemosyne's identity slots ≡ gBrain's compiled-truth card applied to
  the **self entity**: L0 = `entity_card("me")` — current-state summary atop the immutable
  fact/mention timeline. One pattern serves both.
- **No scratchpad table, no memory banks.** Identities are the isolation boundary; ephemeral
  agent notes don't belong in a CRDT store.
- **No 13-type taxonomy.** A small decay class (profile/preference/fact/event/chat) derived
  from existing tags + the deterministic pass is enough to drive Weibull (§4).

---

## 3. Write path — ingest everything, extract deterministically

(0009's ingest-everything model + the built pipeline + Mnemosyne's hygiene.)

1. **Ingest** every user turn, attachment chunk, and AI response → `remember(content, tags)`.
   Idempotent via `content_hash`; incremental via `source_version`; bulk = one aven-db batch.
   AI responses ingest with `veracity: inferred` (recallable, down-weighted — 0009 decision 1).
2. **Extraction ladder** (law 5), never blocking the write:
   - **Rung 0 — deterministic, always, on write** ✅ built: `[[wikilink]]` → entities +
     mentions + relations w/ dynamics. *Extend with Mnemosyne's regex pass:* entity patterns +
     fuzzy-merge ≥0.8 + stop-words, SPO patterns (`is/has/uses/works at`, conf 0.6–0.7, ≤5/memory,
     ≤4096-char input), temporal tags, decay-class.
   - **Rung 1 — attested TEE, batched, in dreaming** ☐ seam built: GLM-5.3 on Phala RedPill
     (attest-or-refuse, facts carry the attestation digest — see 0010 §6b). Strictly additive
     typed facts; no fallback, off by default.
3. **Dedup**: `content_hash` exact-match fast path ✅; cosine `< 0.15` near-dup in dreaming.

---

## 4. Read path — filter → rank → modify → floor → assemble

Built: scoped hybrid search (`tags`/entity filter **before** ranking → `nearest` cosine +
`text_search` BM25, over-fetched → **RRF k=60**). The Δ modifiers slot in after fusion, all pure
functions:

```
candidates = RRF( nearest(q,k·3), text_search(q,k·3) )          ✅ built
score     *= veracity_weight   stated 1.0 · inferred 0.7 · imported 0.6 · tool 0.5 · unknown 0.8
score     *= age_weight        ×1.0 <30d · ×0.5 <180d · ×0.25 ≥180d      (pure f(created_at))
score     *= weibull(class)    exp(−(t/η)^k)  — profile k=.3 η=8760h … event k=1.2 η=168h
floor:     lexical overlap ≥ 0.15 (1–2 tok) / 0.3 (3) / 0.5 (4+)  → else return EMPTY
dedup:     a summary and its summary_of sources never co-rank; superseded_by rows hidden
expand:    ±1 neighbors via source+seq               (MemPalace, schema-ready)
assemble:  pin L0+L1 → working window (last N session turns) → fill by rank to budget
           → ContextBundle + RecallTrace             (0009: the brain IS the context manager)
```

**RRF is terminal.** Weighted `0.6·vec+0.4·bm25` is dropped from the roadmap: rank fusion is the
3-way convergent answer and needs no `_score` surfacing. (Surfacing scores remains a *UX* nicety
for RecallTrace badges only.) A semantic query cache (Mnemosyne's tiers, invalidated by aven-db
`subscribe`) is a later optional layer — not core.

---

## 5. Dreaming — the one consolidator

One scheduled background pass (gBrain's dream cycle = Mnemosyne's `sleep()` = MemPalace's
dynamics tick — they are the same organ). Everything here is derived, rebuildable, off the write
path:

| Pass | Status | What it does |
|---|---|---|
| **Decay** | ✅ built | relations: `strength·exp(−days/stability)`, floor 0.05 |
| **Entity-merge** | ✅ built | CRDT-safe merge of duplicate entities by normalized name |
| **Consolidate** | Δ | summarize old session memories (>TTL, `summary_of`-stamped) into summary memories with **deterministic IDs = f(identity, session, window)** — two devices dreaming concurrently converge on the same row under LWW, no claim protocol needed |
| **Verify facts** | Δ | Bayesian confidence on repeat mentions `conf += (1−conf)·w_veracity·0.3`; contradiction flagging (keep both, mark `superseded_by` on the loser) + compiled-truth recompute per entity (gBrain) — resolves the conflicting-facts question without LWW data loss |
| **Promote** | Δ | AI-authored (`inferred`) memories that proved load-bearing get verified/promoted (0009 decision 1) |
| **L1 rewrite** | Δ | deep rewrite of the running summary (incremental per-turn + batch here — 0009 decision 2) |
| **TEE extraction** | ☐ | rung-1 typed facts, batched deltas, attest-or-refuse (0010 §6b) |

---

## 6. Engine & models

**aven-db (built ✅):** first-class `Vector{dim}` + `nearest` (exact cosine top-k) +
`text_search` (BM25 `k1=1.5, b=0.75`) with filter-before-rank — no ANN-exhaustion problem.

**Scale ladder (law 5, revised by Mnemosyne's evidence):** exact f32 scan ✅ → **int8/bit
quantized side-columns** (sign-bit = 32× smaller, Hamming popcount; Mnemosyne holds 35 ms @ 10M
rows on exactly this) → HNSW **only if** a real workload misses budget. Don't build it
speculatively.

**Models (all behind traits, all optional):** `Embedder` ✅ EmbeddingGemma-300m ONNX (768-d
Matryoshka, ~0.2 GB, ort load-dynamic) — embeddings are computed where the DEK lives, *required*
local by the crypto model. `Extractor` ☐ GLM-5.3 RedPill TEE (attest-or-refuse). Generation:
llama.cpp LFM2.5 local; remote synthesis only ever sees the assembled minimal ContextBundle.
Tiers: T1 edge · T2 household node · T3 attested/ZDR remote (opt-in, biscuit-gated).

**Security (inherited, non-optional):** every row owner-bound (`OwnerBinding`), edit-signed,
biscuit-gated on apply by every peer, DEK/AEAD-sealed, capability-gated FrontierDag sync.
Sharing a memory = a biscuit grant, not app logic.

---

## 7. Constants (copy verbatim — settled, don't re-derive)

| From | Constants |
|---|---|
| MemPalace | hybrid candidates `k·3`; BM25 `k1=1.5, b=0.75`; dedup cosine `<0.15`; chunk ≈800/overlap 80; dynamics `STRENGTH_FLOOR=0.05, MAX_STRENGTH=5.0, POTENTIATION=+0.05, STABILITY=+0.1, SPACED_INTERVAL=1h`, decay `strength·exp(−days/stability)`; L0–L3 token budgets (~100/~600/on-demand); temporal-validity semantics |
| gBrain / built | **RRF k=60** `Σ 1/(60+rank)`; deterministic edge extraction on write; compiled-truth + append-only timeline per entity |
| Mnemosyne | veracity weights `1.0/0.7/0.6/0.5/0.8`; Bayesian `conf += (1−conf)·w·0.3`; abstention floors `0.15/0.3/0.5`; age weights `×0.5@30d, ×0.25@180d`; Weibull `profile k=.3 η=8760h · preference k=.4 η=4380h · fact k=.8 η=720h · event k=1.2 η=168h · request k=1.5 η=72h`; sign-bit quantization + Hamming; deterministic fact ID `sha256(len-prefixed NFC S|P|O)`; consolidation TTL 24h |

---

## 8. Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| Engine + schema + pipeline v1 + KG + context + dreaming v1 + embedder | (see 0010 §7) | ✅ done, tested (13 tests) |
| **Lifecycle Δ** | `veracity`/`superseded_by`/`summary_of` columns; veracity+age+Weibull modifiers; abstention floors; cross-tier dedup; regex extraction extension | ☐ next |
| **Context manager** | 0009 phases A–E: `open(identity)`, ingest hooks, `assemble_context()` + RecallTrace, recall UI, L1 maintenance | ☐ next |
| **Dreaming v2** | consolidation (deterministic summary IDs), Bayesian fact verify + contradiction flag + compiled-truth recompute, promote pass | ☐ |
| **TEE extractor** | 0010 §6b P1–P4 (transport → attestation gate → dreaming integration → hardening) | ☐ |
| **Scale & sync** | int8/bit quantization; Counter-merge for `access_count`/`mention_count`; multi-device dreaming convergence test; HNSW only on proven need | ☐ |
| **Honest eval** | LongMemEval/LoCoMo held-out harness; never tune on the test set; judge scores aren't cross-system comparable | ☐ |

---

## 9. Reference ledger — what each world contributed, what we refused

| Source | Married in | Refused |
|---|---|---|
| **MemPalace** | retrieval recipes & constants, layered context, dynamics, neighbor expansion, citations, idempotent ingest | two storage planes; file-shaped wing/room hierarchy; AAAK; tuned-on-test benchmark claims |
| **gBrain** | compiled-truth + timeline (→ entity cards *and* L0 self-card), dream cycle, deterministic zero-LLM edges on write, RRF | hand-authored schema per fact-shape; single-operator assumption; synthetic self-benchmarks |
| **Mnemosyne** | lifecycle (consolidate/age/supersede), veracity + Bayesian confidence, abstention, quantization-before-ANN, ladder discipline, mentions/facts split law | god-module; env-var config sprawl; two memory tables; tier column; canonical/scratchpad/banks tables; bolt-on DeltaSync; MCP-bearer-token security |
| **aven-db/avenOS** | the plane: CRDT + ownership + capabilities + E2E sealing + sync — the one thing none of the references has | — |

The result is smaller than any of its sources: five tables, two query primitives, one
consolidator, one ladder — and every layer above the deterministic core is independently
removable. That separability is the maintainability guarantee.

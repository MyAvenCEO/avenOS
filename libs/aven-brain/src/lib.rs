//! # aven-brain — a local-first, user-owned AI memory brain
//!
//! aven-brain is the memory subsystem of an avenOS **identity**, built natively on
//! **aven-db** (CRDT, capability-gated, vector + BM25 retrieval). It adopts the proven
//! retrieval *recipes* of MemPalace while replacing its file-shaped spatial metaphor with
//! an entity-graph-native model that fits avenOS.
//!
//! ## Vocabulary
//!
//! - **brain** — the memory store of one identity (`identity.brain`). An identity *has* a
//!   brain; there is no separate "palace" noun.
//! - **memory** — one atomic unit: verbatim content + its embedding + free tags, plus
//!   provenance that preserves MemPalace's strengths — `source`+`seq` (neighbor
//!   expansion), `line_start`/`line_end` (surgical citations), `content_date` (temporal
//!   boost / `as_of`), `content_hash`/`source_version` (idempotent + incremental ingest).
//!   MemPalace's *drawer*. Stored in [`schema::MEMORIES`].
//! - **tag** — a free-form label on a memory: the **primary, cheap, deterministic scope**
//!   (subsumes MemPalace's `wing`/`room`/`hall`). Assignable from source/heuristics with
//!   no extraction; filtered directly on the memory row (no join).
//! - **entity** — a named node (person, project, topic, thing): the **semantic graph**
//!   primitive — traversal, facts, "memories about X". Stored in [`schema::ENTITIES`].
//! - **mention** — a memory→entity edge ("this memory references entity X"). Powers
//!   semantic "about X" retrieval and graph traversal; populated by extraction —
//!   *enriching*, not required for basic scoping (that's `tag`). Many-to-many. Stored in
//!   [`schema::MEMORY_ENTITIES`].
//! - **fact** — a *typed, temporal* subject→predicate→object assertion between entities,
//!   with a validity window (`valid_from`/`valid_to`); MemPalace's *triple*. Stored in
//!   [`schema::FACTS`].
//! - **relation** — a *weighted, associative* entity↔entity edge carrying **dynamics**
//!   (strength/stability/decay). Distinct from a `fact`: a fact is a typed assertion, a
//!   relation is "how strongly these two are associated." Unifies MemPalace's
//!   `hallway` (intra) and `tunnel` (cross). Stored in [`schema::RELATIONS`].
//! - **dynamics** — how strongly a relation is held (its `strength`/`stability` and
//!   decay): grows on co-access (Hebbian), decays over time (Ebbinghaus). MemPalace's term,
//!   kept.
//!
//! ## Context assembly (MemPalace's L0–L3 layers)
//!
//! - **L0 — identity**: who the agent is (always loaded).
//! - **L1 — summary**: the essential gist (always loaded).
//! - **L2 — recall**: entity/tag-scoped fetch (on demand).
//! - **L3 — search**: the hybrid `nearest` + `text_search` query (deep).
//!
//! `wake` assembles L0 + L1. The compact, scannable *index* role of MemPalace's `closet`
//! is preserved as a **derived** layer: each entity can surface a compact card (summary +
//! its top memories + key facts) for two-tier retrieval (scan cards → open memories) — an
//! index, not a rigid scope level.
//!
//! ## Retrieval
//!
//! Filter memories by entity/tag → hybrid rank (`QueryBuilder::nearest` cosine +
//! `text_search` BM25) → fuse (`0.6·vec + 0.4·bm25`, MemPalace-tuned) → assemble context.
//! The metadata filter runs *before* ranking, so entity-scoped retrieval stays cheap.
//!
//! ## Ownership & sync
//!
//! Every memory/entity/fact/relation is a CRDT row in the identity's store:
//! owner-bound, edit-signed, per-identity DEK-sealed, and capability-gated on sync.
//! Embeddings are computed where the key lives (on-device); nothing is stored in the clear.

pub mod brain;
pub mod embedder;
pub mod schema;

pub use brain::{Brain, BrainError, Memory};
pub use embedder::{Embedder, StubEmbedder};
pub use schema::{brain_schema, EMBED_DIM};

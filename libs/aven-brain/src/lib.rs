//! # aven-brain — a local-first, user-owned AI memory brain
//!
//! aven-brain is the memory subsystem of one avenOS **SAFE** (identity), built natively
//! on **aven-db** (CRDT, capability-gated, vector + BM25 retrieval), on **three tables**:
//! `memories` · `entities` · `links`. See the architecture & execution plan
//! (`libs/aven-board/board/plan/0018-aven-brain-architecture.md`) — this crate is its
//! E1 layer.
//!
//! ## Vocabulary (plan §1)
//!
//! - **artifact** — any app-owned table row (`messages`, `files`, `todos`, …): the
//!   sealed, synced ground truth the brain derives from — and never writes. Every memory
//!   carries its artifact's reference + key attributes denormalized as indexed columns
//!   ("the artifact columns": `source`, `stream`, `author_role`, `seq`/`line_*`,
//!   `content_date`), which double as the cheap join-free recall [`Filter`].
//! - **memory** — *evidence*: verbatim recallable text + embedding + artifact columns +
//!   veracity. Stored in [`schema::MEMORIES`]. No `created_at`: row ids are UUIDv7.
//! - **entity** — *pure interpretation*: a name extracted from evidence with **no
//!   backing artifact row** (topic/project/world-person). Things that *do* have a row
//!   are linked directly — no shadow entities. Stored in [`schema::ENTITIES`].
//! - **link** — the one edge primitive `from —kind→ to`; endpoints are any row ids.
//!   Every kind belongs to exactly one class ([`LinkClass`], law 6): **note**
//!   (append-only: `mentions`, `summarizes`, `refers_to`), **claim** (temporal
//!   single-truth free predicates, e.g. `works_at`), **bond** (`assoc`, weighted
//!   dynamics: Hebbian growth / Ebbinghaus decay). Stored in [`schema::LINKS`].
//!
//! ## Read path
//!
//! Typed [`Filter`] (owner/stream/author_role/source — indexed, before ranking) →
//! hybrid rank (`nearest` cosine + `text_search` BM25) → **RRF k=60** → modifiers
//! (veracity weight × age weight from the UUIDv7 row id) → **abstention floor** (return
//! nothing over noise) → [`Brain::assemble_context`] builds the budgeted ContextBundle +
//! [`ContextTrace`] receipt.
//!
//! ## Ownership & sync
//!
//! One brain per SAFE: every row carries `owner` and every query is owner-scoped.
//! Rows are CRDT rows in the shared store: owner-bound, edit-signed, sealed at rest,
//! capability-gated on sync. Embeddings are computed where the key lives (on-device).

pub mod brain;
pub mod embedder;
pub mod extractor;
pub mod schema;
pub mod sealer;

pub use brain::{
    Brain, BrainError, ContextBundle, ContextOptions, ContextTrace, DebugExport, DebugRound,
    DreamEntity, DreamReport, DreamStep, Entity, EntityCard, Fact, Filter, LinkClass, LogEntry,
    Memory, Relation, RememberOptions, ScoredMemory, Via,
};
pub use embedder::{Embedder, StubEmbedder};
pub use extractor::{
    ExtractedEntity, ExtractedFact, Extraction, ExtractionInput, Extractor, MockExtractor,
    NoExtractor, SelfSummary,
};
pub use schema::{brain_schema, EMBED_DIM};
pub use sealer::{KeySealer, Sealer};

/// Real on-device EmbeddingGemma embedder (ONNX via aven-ai). Behind the `models` feature.
#[cfg(feature = "models")]
pub mod gemma;
#[cfg(feature = "models")]
pub use gemma::GemmaEmbedder;

//! # aven-brain — a local-first, user-owned AI memory brain
//!
//! aven-brain is the memory subsystem of an avenOS **identity**, built natively on
//! **aven-db** (CRDT, capability-gated, vector + BM25 retrieval). It adopts the proven
//! retrieval *recipes* of MemPalace while replacing its file-shaped spatial metaphor with
//! a concept-graph-native model that fits avenOS.
//!
//! ## Vocabulary
//!
//! - **brain** — the memory store of one identity (`identity.brain`). There is no separate
//!   "palace" noun; an identity *has* a brain.
//! - **engram** — one atomic memory: verbatim content + its embedding + free tags, plus
//!   provenance that preserves MemPalace's strengths — `source`+`seq` (neighbor
//!   expansion), `line_start`/`line_end` (surgical citations), `content_date` (temporal
//!   boost / `as_of`), and `content_hash`/`source_version` (idempotent + incremental
//!   ingest). MemPalace's *drawer*. Stored in [`schema::ENGRAMS`].
//! - **concept** — a named node (person, project, topic, thing). Concepts are the scoping
//!   *and* graph primitive — they subsume MemPalace's `wing`/`room` hierarchy *and* its
//!   `entity` layer. Stored in [`schema::CONCEPTS`].
//! - **mention** — an engram→concept edge ("this memory is about concept X"); the scope
//!   mechanism, replacing the rigid wing/room tree. Stored in [`schema::ENGRAM_CONCEPTS`].
//! - **tag** — a free-form label on an engram for ad-hoc grouping (MemPalace's `hall`).
//! - **fact** — a temporal subject→predicate→object assertion between concepts, with a
//!   validity window (`valid_from`/`valid_to`); MemPalace's *triple*. Stored in
//!   [`schema::FACTS`].
//! - **link** — a weighted concept↔concept association carrying **salience**
//!   (strength/stability/decay). Unifies MemPalace's `hallway` (intra) and `tunnel`
//!   (cross) into one edge. Stored in [`schema::LINKS`].
//! - **salience** — how strongly a link is held: grows on co-access (Hebbian), decays over
//!   time (Ebbinghaus). MemPalace's `dynamics`.
//! - **wake / gist / recall / search** — the context-assembly layers (MemPalace's L0–L3):
//!   `wake` assembles `self` + `gist`; `recall` is concept/tag-scoped fetch; `search` is the
//!   hybrid `nearest` + `text_search` query.
//!
//! ## Retrieval
//!
//! Filter engrams by concept/tag → hybrid rank (`QueryBuilder::nearest` cosine +
//! `text_search` BM25) → fuse (`0.6·vec + 0.4·bm25`, MemPalace-tuned) → assemble context.
//! The metadata filter runs *before* ranking, so concept-scoped retrieval stays cheap.
//!
//! ## Ownership & sync
//!
//! Every engram/concept/fact/link is a CRDT row in the identity's store: owner-bound,
//! edit-signed, per-identity DEK-sealed, and capability-gated on sync. Embeddings are
//! computed where the key lives (on-device); nothing is stored in the clear.

pub mod schema;

pub use schema::{brain_schema, EMBED_DIM};

//! Typed-fact extraction — the model-assisted layer of *dreaming*.
//!
//! Runs **off the write path** (batch, in dreaming). The deterministic `[[wikilink]]`
//! graph (entities / mentions / relations) is built on write with **no model**; the
//! `Extractor` only *adds* typed, temporal facts (subject→predicate→object) on top, so it
//! is purely additive — retrieval works fully without it.
//!
//! # Status: TODO — prepared seam only
//!
//! This module defines the trait + types. There is **no implementation and no fallback**
//! yet. If no `Extractor` is configured, [`crate::Brain::dream`] runs only its
//! deterministic passes (decay, exact-name entity merge, relation dedup).
//!
//! The planned default is **GLM-5.3 hosted in a Phala Cloud RedPill TEE**, attestation-
//! verified before any memory leaves the device (see the execution plan's
//! "Extractor — GLM-5.3 on Phala RedPill TEE" board plan). Any remote adapter MUST send
//! plaintext only to an attested TEE / ZDR endpoint — there is deliberately no silent
//! non-attested fallback.

use aven_db::ObjectId;

/// One memory handed to the extractor.
#[derive(Clone, Debug)]
pub struct ExtractionInput {
    /// The memory the facts are attributed to (provenance).
    pub memory_id: ObjectId,
    /// Verbatim memory content to extract from.
    pub content: String,
}

/// A typed, temporal assertion extracted from a memory: `subject —predicate→ object`,
/// optionally valid over a window, with a confidence and its source memory. Maps to a
/// `facts` row (see [`crate::schema::FACTS`]).
#[derive(Clone, Debug)]
pub struct ExtractedFact {
    /// Subject entity name (normalized + matched to an entity on write-back).
    pub subject: String,
    /// Predicate / relation type (e.g. `works_at`, `lives_in`, `prefers`).
    pub predicate: String,
    /// Object entity name or literal value.
    pub object: String,
    /// Validity window start (micros since epoch), if the fact is time-bounded.
    pub valid_from: Option<i64>,
    /// Validity window end (micros since epoch), if the fact has expired/changed.
    pub valid_to: Option<i64>,
    /// Extractor confidence in [0, 1].
    pub confidence: f32,
    /// The memory this fact was extracted from.
    pub source_memory: ObjectId,
}

/// Extracts typed facts from a batch of memories during *dreaming*.
///
/// Batched + off the write path: implementations optimize for **quality over latency**
/// (big/remote models, multi-pass, re-prompting are all fine here).
///
/// **Security invariant:** an implementation that sends memory content off-device MUST do
/// so only to an **attested TEE** (preferred) or a ZDR endpoint, and MUST verify the
/// attestation before transmitting. No silent fallback to a non-attested endpoint.
#[allow(async_fn_in_trait)]
pub trait Extractor: Send + Sync {
    /// Extract facts from `batch`. Returns all facts found across the inputs.
    async fn extract(&self, batch: &[ExtractionInput]) -> Result<Vec<ExtractedFact>, String>;
}

// TODO(extractor): implement `RedPillExtractor` (GLM-5.3 on Phala Cloud RedPill TEE) behind
// a feature — attestation-verified OpenAI-compatible transport. No fallback for now.

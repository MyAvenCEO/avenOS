//! Typed-fact extraction — the model-assisted layer of *dreaming*.
//!
//! Runs **off the write path** (batch, in dreaming). The deterministic `[[wikilink]]`
//! graph (entities / mentions / relations) is built on write with **no model**; the
//! `Extractor` only *adds* typed, temporal facts (subject→predicate→object) on top, so it
//! is purely additive — retrieval works fully without it.
//!
//! # Status: implemented (board 0024)
//!
//! [`crate::Brain`] carries an `Extractor` (default [`NoExtractor`] — deterministic
//! dreaming only). The dream pass batches newly-written, not-yet-extracted memories,
//! calls the configured extractor, and writes each [`ExtractedFact`] back to the graph
//! as a claim link (subject entity —predicate→ object entity), idempotently (an
//! `extracted` note marker per mined memory). The app injects a Tinfoil-enclave glm-5-1
//! adapter behind its `tinfoil` feature.
//!
//! **Security invariant:** any remote adapter MUST send plaintext only to an **attested
//! TEE** / ZDR endpoint, attestation-verified before transmitting — there is
//! deliberately no silent non-attested fallback. The Tinfoil SDK attests on connect.

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
/// claim link row (see [`crate::schema::LINKS`]).
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

/// One extraction round's result: the facts plus the LLM tokens it cost — surfaced
/// per `extract` step in the dreaming panel (the deterministic phases stay at 0).
#[derive(Clone, Debug, Default)]
pub struct Extraction {
    pub facts: Vec<ExtractedFact>,
    pub tokens: i64,
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
    /// Whether this extractor actually mines facts. `false` ⇒ the dream pass skips the
    /// extract phase's batching/marking entirely (and says so in its log line).
    fn enabled(&self) -> bool {
        true
    }
    /// Extract facts from `batch`. Returns all facts found across the inputs plus the
    /// token cost of producing them.
    async fn extract(&self, batch: &[ExtractionInput]) -> Result<Extraction, String>;
}

/// The "no extractor configured" default — [`crate::Brain::dream`] runs only its
/// deterministic passes (decay, exact-name entity merge, relation dedup).
pub struct NoExtractor;

impl Extractor for NoExtractor {
    fn enabled(&self) -> bool {
        false
    }

    async fn extract(&self, _batch: &[ExtractionInput]) -> Result<Extraction, String> {
        Ok(Extraction::default())
    }
}

/// Deterministic test double: emits the configured `(subject, predicate, object)`
/// triples for EVERY input memory (source_memory = that input, confidence 0.9, no
/// validity window) and bills a fixed 42 tokens per call — so tests can prove the
/// dream→graph write-back and the per-step token surfacing without a model.
pub struct MockExtractor {
    triples: Vec<(String, String, String)>,
}

impl MockExtractor {
    pub fn new<S: Into<String>>(triples: Vec<(S, S, S)>) -> Self {
        Self {
            triples: triples
                .into_iter()
                .map(|(s, p, o)| (s.into(), p.into(), o.into()))
                .collect(),
        }
    }
}

impl Extractor for MockExtractor {
    async fn extract(&self, batch: &[ExtractionInput]) -> Result<Extraction, String> {
        let facts = batch
            .iter()
            .flat_map(|input| {
                self.triples.iter().map(|(s, p, o)| ExtractedFact {
                    subject: s.clone(),
                    predicate: p.clone(),
                    object: o.clone(),
                    valid_from: None,
                    valid_to: None,
                    confidence: 0.9,
                    source_memory: input.memory_id,
                })
            })
            .collect();
        Ok(Extraction { facts, tokens: 42 })
    }
}

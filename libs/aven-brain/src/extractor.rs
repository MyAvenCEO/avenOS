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

/// An existing OPEN claim handed to the extractor as reconciliation context (board 0034). The
/// extractor sees what's already known so, when a new statement UPDATES a known relation, it can
/// **reuse that relation's exact predicate** — then normal `(subject, predicate)` supersession closes
/// the stale claim. This keeps contradiction-resolution FULLY GENERIC: the "is this the same
/// relation?" judgement lives in the model (any language, any relation), never a hardcoded table.
#[derive(Clone, Debug)]
pub struct KnownClaim {
    pub subject: String,
    pub predicate: String,
    pub object: String,
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

/// A typed entity the extractor recognized: a name plus its kind (`person`, `team`,
/// `place`, `org`, `event`, `referee`, …). Written back to upgrade the entity row's
/// `kind` from the deterministic default (`unknown`), so L2 cards read "Lozano (player)"
/// instead of "Lozano (unknown)". Free-form kind — the model picks the domain label.
#[derive(Clone, Debug)]
pub struct ExtractedEntity {
    /// Entity name (matched to an entity row on write-back, same as fact subjects).
    pub name: String,
    /// Domain kind label (lowercase, e.g. `person`, `team`, `referee`, `match`).
    pub kind: String,
}

/// One extraction round's result: the typed entities + facts plus the LLM tokens it cost
/// — surfaced per `extract` step in the dreaming panel (the deterministic phases stay at 0).
#[derive(Clone, Debug, Default)]
pub struct Extraction {
    /// Typed entities to upgrade `kind` on (board 0024 — richer L2 cards).
    pub entities: Vec<ExtractedEntity>,
    pub facts: Vec<ExtractedFact>,
    pub tokens: i64,
}

/// A synthesized L0-self profile of the brain owner, distilled from their first-person
/// statements (board: auto self). `text` REPLACES the current self profile; `tokens` is the
/// LLM cost. An empty `text` (or `None` from [`Extractor::summarize_self`]) means "nothing
/// durable to record — leave L0 self unchanged".
#[derive(Clone, Debug, Default)]
pub struct SelfSummary {
    pub text: String,
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
    /// Extract facts from `batch`. `known` carries the owner's existing OPEN claims as
    /// reconciliation context (board 0034): when a new statement updates a known relation, REUSE
    /// that claim's exact predicate so supersession closes the stale one — no hardcoded synonyms.
    /// Returns all facts found across the inputs plus the token cost of producing them.
    async fn extract(
        &self,
        batch: &[ExtractionInput],
        known: &[KnownClaim],
    ) -> Result<Extraction, String>;

    /// Synthesize/refresh the brain owner's L0 **self** profile (who they are: name, age,
    /// role, location, goals, durable preferences) from their recent first-person memories
    /// (`owner_memories`), merging with the `current` profile. Returns `None` when there is
    /// nothing durable to record. Default: `None` — the deterministic path leaves L0 self
    /// manual; only an LLM extractor populates it automatically.
    async fn summarize_self(
        &self,
        _owner_memories: &[String],
        _current: &str,
    ) -> Result<Option<SelfSummary>, String> {
        Ok(None)
    }
}

/// The "no extractor configured" default — [`crate::Brain::dream`] runs only its
/// deterministic passes (decay, exact-name entity merge, relation dedup).
pub struct NoExtractor;

impl Extractor for NoExtractor {
    fn enabled(&self) -> bool {
        false
    }

    async fn extract(
        &self,
        _batch: &[ExtractionInput],
        _known: &[KnownClaim],
    ) -> Result<Extraction, String> {
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
    async fn extract(
        &self,
        batch: &[ExtractionInput],
        _known: &[KnownClaim],
    ) -> Result<Extraction, String> {
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
        Ok(Extraction { entities: Vec::new(), facts, tokens: 42 })
    }
}

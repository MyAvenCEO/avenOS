//! The [`Brain`] handle over an aven-db [`AvenDbClient`] for **one SAFE** (owner-scoped),
//! on the three-table model: `memories` · `entities` · `links`.
//!
//! - `remember` stores evidence (verbatim content + embedding + artifact columns) and,
//!   from `[[wikilink]]` references, deterministically upserts **entities**, records
//!   **mention** links (note class) and potentiates **assoc** links (bond class) for
//!   every co-mentioned pair. No LLM touches the write path, so the graph is
//!   reproducible across devices (clean CRDT merges). Idempotent by `content_hash`.
//! - **Sealed at rest (board 0021):** every non-routing cell is sealed through the
//!   [`crate::sealer::Sealer`] seam before write and opened on read — plaintext exists
//!   only transiently in RAM. Only `owner` and the keyed-MAC `content_hash` are
//!   plaintext routing; `IS NULL` filters still run DB-side (null-ness is metadata).
//!   Retrieval and the graph walks therefore scan owner-scoped rows and filter
//!   brain-side after opening (the engine cannot see into sealed cells).
//! - `search` runs both retrievers brain-side (cosine over opened embeddings + lexical
//!   over opened content), fuses with **RRF (k=60)**, then applies the read modifiers:
//!   veracity weight × age weight, and the **abstention floor** (return nothing over
//!   noise). [`Brain::search_traced`] surfaces per-hit `via`/rank/score for RecallTrace.
//! - `add_fact` writes **claim** links (temporal single-truth: a new assertion for the
//!   same (subject, predicate) closes the old row's `valid_to`; nothing is deleted).
//! - The link **kind→class registry** (law 6) is enforced at write: note kinds are
//!   append-only/idempotent, claim kinds are free predicates, `assoc` is the bond kind.
//! - No `created_at` columns: row ids are UUIDv7 — creation time is decoded from the id.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use aven_db::{AppContext, AppId, AvenDbClient, NullSyncTransport, ObjectId, QueryBuilder, Value};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::Serialize;

use crate::embedder::Embedder;
use crate::extractor::{ExtractionInput, Extractor, NoExtractor};
use crate::schema::{brain_schema, ENTITIES, LINKS, MEMORIES};
use crate::sealer::{KeySealer, Sealer};

/// Errors from brain operations.
#[derive(Debug)]
pub enum BrainError {
    Open(String),
    Write(String),
    Read(String),
    /// A link kind violated the kind→class registry (law 6).
    Registry(String),
}

impl std::fmt::Display for BrainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BrainError::Open(m) => write!(f, "brain open error: {m}"),
            BrainError::Write(m) => write!(f, "brain write error: {m}"),
            BrainError::Read(m) => write!(f, "brain read error: {m}"),
            BrainError::Registry(m) => write!(f, "brain link-registry error: {m}"),
        }
    }
}

impl std::error::Error for BrainError {}

// ── Link kind registry (law 6): every kind belongs to exactly one class ─────

/// The three link semantic classes — the class decides merge behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkClass {
    /// Append-only, never invalidated, idempotent re-insert.
    Note,
    /// Temporal single-truth: new assertion closes the old `valid_to`; never deleted.
    Claim,
    /// Weighted association: potentiates on co-access, decays in dreaming.
    Bond,
}

impl LinkClass {
    fn as_str(self) -> &'static str {
        match self {
            LinkClass::Note => "note",
            LinkClass::Claim => "claim",
            LinkClass::Bond => "bond",
        }
    }
}

/// Reserved note kinds (append-only).
const NOTE_KINDS: [&str; 4] = ["mentions", "summarizes", "refers_to", "extracted"];
/// The bond kind.
const BOND_KIND: &str = "assoc";
/// Note kind marking a memory as fact-mined (a self-link `memory —extracted→ memory`) —
/// the dream pass's extracted-cursor: never re-extract, no schema change (law 2).
const EXTRACTED_KIND: &str = "extracted";
/// Memories handed to the extractor per dream step (bounded so a step always yields).
const EXTRACT_BATCH_MAX: usize = 6;

/// Hard cap on how many entities one memory contributes to the graph. Bounds the per-entity
/// fuzzy-scan AND the O(n²) bonding loop in `write_graph`, so a pasted wall of text can't saturate
/// the serial avenDB runtime (24 entities ⇒ ≤ 276 bonds; plenty for real notes).
const MAX_GRAPH_ENTITIES: usize = 24;
/// Hard cap on SPO facts extracted from one memory (same runaway-write protection).
const MAX_GRAPH_FACTS: usize = 16;

/// Target characters per stored memory chunk. A long paste (match report, article, transcript) is
/// split into chunks ~this size so recall can surface the SPECIFIC relevant passage (e.g. one
/// red-card event) instead of one giant blob the context budget would truncate.
const MEMORY_CHUNK_MAX_CHARS: usize = 480;

/// Resolve a kind to its class. Claim predicates are free-form but must not collide
/// with the reserved note/bond kinds.
fn class_for_claim_predicate(kind: &str) -> Result<(), BrainError> {
    if NOTE_KINDS.contains(&kind) || kind == BOND_KIND {
        return Err(BrainError::Registry(format!(
            "`{kind}` is a reserved note/bond kind — not usable as a claim predicate"
        )));
    }
    if kind.trim().is_empty() {
        return Err(BrainError::Registry("empty claim predicate".to_string()));
    }
    Ok(())
}

// ── Public data types ────────────────────────────────────────────────────────

/// A retrieved memory (evidence).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    #[serde(serialize_with = "ser_object_id")]
    pub id: ObjectId,
    pub content: String,
    pub stream: String,
    pub author_role: String,
    pub source: Option<String>,
    pub veracity: Option<String>,
    /// Salience 0..1 chosen at write (0.5 = neutral default).
    pub importance: f32,
}

/// How a search hit was found. `Graph` = the entity/fact voice (board 0025): an entity
/// named in the query voted for this memory through its links. `Both` = multiple voices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Via {
    Vector,
    Bm25,
    Graph,
    Both,
}

/// A search hit with retrieval provenance (rank/score/via) for RecallTrace.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoredMemory {
    #[serde(flatten)]
    pub memory: Memory,
    /// 1-based final rank.
    pub rank: usize,
    /// RRF score after veracity/age modifiers.
    pub score: f32,
    pub via: Via,
}

/// Typed recall filter over the artifact columns (no free labels — plan v4.1).
#[derive(Debug, Clone, Default)]
pub struct Filter {
    pub stream: Option<String>,
    pub author_role: Option<String>,
    pub source: Option<String>,
}

impl Filter {
    pub fn stream(s: impl Into<String>) -> Self {
        Self {
            stream: Some(s.into()),
            ..Default::default()
        }
    }

    /// Brain-side match over an OPENED memory — sealed columns can't be filtered by
    /// the engine, so the typed filter applies after the cells are opened.
    fn matches(&self, m: &Memory) -> bool {
        if let Some(s) = &self.stream {
            if &m.stream != s {
                return false;
            }
        }
        if let Some(r) = &self.author_role {
            if &m.author_role != r {
                return false;
            }
        }
        if let Some(src) = &self.source {
            if m.source.as_deref() != Some(src.as_str()) {
                return false;
            }
        }
        true
    }
}

/// Write options for [`Brain::remember_with`] — the artifact columns.
#[derive(Debug, Clone)]
pub struct RememberOptions {
    pub stream: String,
    pub author_role: String,
    pub source: Option<String>,
    pub seq: Option<i64>,
    pub line_start: Option<i64>,
    pub line_end: Option<i64>,
    /// Domain time (when the content happened), ms since epoch.
    pub content_date_ms: Option<i64>,
    /// stated | inferred | imported | tool | unknown (None scores as unknown).
    pub veracity: Option<String>,
    /// Salience 0..1 chosen at write — mnemosyne's importance, a bounded rank
    /// modifier next to veracity/age (board 0025). 0.5 = neutral.
    pub importance: f32,
}

impl Default for RememberOptions {
    fn default() -> Self {
        Self {
            stream: "note".to_string(),
            author_role: "user".to_string(),
            source: None,
            seq: None,
            line_start: None,
            line_end: None,
            content_date_ms: None,
            veracity: None,
            importance: 0.5,
        }
    }
}

/// A named graph node (pure interpretation — no backing artifact row).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    #[serde(serialize_with = "ser_object_id")]
    pub id: ObjectId,
    pub name: String,
    pub kind: String,
}

/// Bond dynamics between two entities.
#[derive(Debug, Clone, Serialize)]
pub struct Relation {
    pub strength: f64,
    pub stability: f64,
    pub access_count: i64,
}

/// A temporal claim (entity —predicate→ entity).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fact {
    pub predicate: String,
    pub object_name: String,
    pub valid_from_ms: Option<i64>,
    /// `None` = currently true.
    pub valid_to_ms: Option<i64>,
    pub confidence: f64,
}

/// A compact "card" for an entity: compiled-truth (kind + strongest bonds + current
/// claims) plus the timeline of memories that mention it (gBrain's pattern).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityCard {
    pub name: String,
    pub kind: String,
    /// Related entities by descending bond strength.
    pub bonds: Vec<(String, f64)>,
    /// Currently-valid claims.
    pub facts: Vec<Fact>,
    /// Memories mentioning this entity (the timeline).
    pub recent_memories: Vec<Memory>,
}

impl EntityCard {
    /// Render the card as a compact text block.
    pub fn render(&self) -> String {
        let mut out = format!("# {} ({})\n", self.name, self.kind);
        if !self.bonds.is_empty() {
            let rels: Vec<String> = self
                .bonds
                .iter()
                .map(|(n, s)| format!("{n} ({s:.2})"))
                .collect();
            out.push_str("related: ");
            out.push_str(&rels.join(", "));
            out.push('\n');
        }
        for f in &self.facts {
            out.push_str(&format!("- {} {} {}\n", self.name, f.predicate, f.object_name));
        }
        out.push_str("timeline:\n");
        for m in &self.recent_memories {
            out.push_str("- ");
            out.push_str(&truncate(&m.content, 200));
            out.push('\n');
        }
        out
    }
}

/// What a `dream` consolidation pass did.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DreamReport {
    pub bonds_decayed: usize,
    pub entities_merged: usize,
    /// Typed facts mined by the configured [`Extractor`] and written to the graph.
    pub facts_extracted: usize,
    /// Duplicate open claims collapsed (cross-device sync healer).
    pub claims_deduped: usize,
    /// Contradicting open claims closed (highest confidence stays open).
    pub claims_contradicted: usize,
    /// Old talk turns rolled into summary memories this pass.
    pub memories_consolidated: usize,
    pub summaries_written: usize,
}

/// One step of a STEPPED dream (see [`Brain::dream_step`]) — a single bounded phase, returned for
/// the live dreaming panel and so the runtime can yield between phases.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DreamStep {
    /// Machine phase id: `enrich | extract | merge | decay | verify | consolidate | done`.
    pub phase: String,
    /// Human log line for the dreaming panel.
    pub label: String,
    /// Items this step affected.
    pub count: i64,
    /// LLM tokens spent this step — real cost for the `extract` phase (the configured
    /// [`Extractor`]'s usage), 0 for the deterministic phases.
    pub tokens: i64,
    /// Cursor to pass to the NEXT call. Meaningless once `done`.
    pub next_cursor: i64,
    pub done: bool,
}

impl DreamStep {
    fn ok(phase: &str, label: String, count: i64, next_cursor: i64) -> Self {
        Self {
            phase: phase.into(),
            label,
            count,
            tokens: 0,
            next_cursor,
            done: false,
        }
    }
}

// ── Context assembly types ───────────────────────────────────────────────────

/// Options for [`Brain::assemble_context`].
#[derive(Debug, Clone)]
pub struct ContextOptions {
    /// Last N turns of the filtered stream, always included (chronological).
    pub working_n: usize,
    /// Hybrid-search hits beyond the working window.
    pub recall_k: usize,
    /// Entity cards for entities named in the query.
    pub entity_cards: usize,
    /// L1 gist lines.
    pub gist_n: usize,
    /// Character budget for the assembled prompt (≈ chars/4 tokens).
    pub budget_chars: usize,
    /// Working-window filter (e.g. `Filter::stream("talk")`).
    pub filter: Filter,
}

impl Default for ContextOptions {
    fn default() -> Self {
        // Sized for ONE continuous conversation with no app-side thread concept (board
        // 0023): the working window + recall budget carry conversational continuity, so
        // they are generous — a second ingested document must not crowd the first out.
        Self {
            working_n: 12,
            recall_k: 10,
            entity_cards: 2,
            gist_n: 5,
            budget_chars: 16_000,
            filter: Filter::default(),
        }
    }
}

/// The stored receipt of one context assembly (rendered by the recall UI).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextTrace {
    pub query: String,
    pub l0_self: String,
    pub l1_gist: Vec<String>,
    pub working: Vec<TraceWorking>,
    pub recalled: Vec<TraceRecalled>,
    pub entities: Vec<TraceEntity>,
    pub budget: TraceBudget,
    pub embedder: String,
    pub assembled_at_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceWorking {
    pub id: String,
    pub snippet: String,
    pub author_role: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceRecalled {
    pub id: String,
    pub snippet: String,
    pub source: Option<String>,
    pub rank: usize,
    pub via: Via,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceEntity {
    pub name: String,
    pub kind: String,
    pub bonds: Vec<(String, f64)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceBudget {
    pub used_chars: usize,
    pub max_chars: usize,
    pub dropped_recalled: usize,
    pub dropped_working: usize,
}

/// The assembled, budgeted prompt + its receipt.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBundle {
    pub prompt: String,
    pub trace: ContextTrace,
}

// ── Constants (copy-verbatim, plan §9) ───────────────────────────────────────
const POTENTIATION_INCREMENT: f64 = 0.05;
const MAX_STRENGTH: f64 = 5.0;
const STABILITY_INCREMENT: f64 = 0.1;
/// Lower bound on bond strength — associations fade toward this, never to zero.
const STRENGTH_FLOOR: f64 = 0.05;
/// Min gap to count a potentiation as "spaced" (1 hour, ms).
const SPACED_INTERVAL_MS: i64 = 3_600_000;
const MS_PER_DAY: i64 = 86_400_000;
/// RRF constant (3-way convergent: gBrain · Mnemosyne · as-built).
const RRF_K: f32 = 60.0;
/// MMR re-rank balance: λ weighs relevance, (1−λ) penalizes redundancy with the hits
/// already selected AND with the query itself — a stored echo of the user's own
/// question (every talk turn is a memory) carries no new information and must not
/// crowd content out of the top-k.
const MMR_LAMBDA: f32 = 0.7;
/// Veracity score multipliers (Mnemosyne).
fn veracity_weight(v: Option<&str>) -> f32 {
    match v {
        Some("stated") => 1.0,
        Some("inferred") => 0.7,
        Some("imported") => 0.6,
        Some("tool") => 0.5,
        _ => 0.8, // unknown
    }
}
/// Importance (salience) weight: a BOUNDED ±20% modifier next to veracity/age
/// (mnemosyne weighs importance ~20% of rank). 0.5 (the default) is neutral ×1.0.
fn importance_weight(importance: f32) -> f32 {
    0.8 + 0.4 * importance.clamp(0.0, 1.0)
}
/// Age weights ×1.0 <30d · ×0.5 <180d · ×0.25 ≥180d — pure f(row-id time).
fn age_weight(age_ms: i64) -> f32 {
    if age_ms < 30 * MS_PER_DAY {
        1.0
    } else if age_ms < 180 * MS_PER_DAY {
        0.5
    } else {
        0.25
    }
}
/// Abstention floor: minimum lexical overlap by query token count (Mnemosyne).
/// Long natural-language questions (and window-enriched inner queries) share a smaller
/// FRACTION of their tokens with any one passage, so the floor relaxes with length —
/// otherwise a chunked document can never clear it for a full-sentence question.
fn abstention_floor(query_tokens: usize) -> f32 {
    match query_tokens {
        0..=2 => 0.15,
        3 => 0.5,
        4..=5 => 0.3,
        6..=15 => 0.2,
        _ => 0.1,
    }
}

/// One opened link row — every sealed cell decrypted, numbers parsed. The graph
/// walks filter over these brain-side (the engine cannot see into sealed cells).
struct LinkRow {
    id: ObjectId,
    from: String,
    to: String,
    kind: String,
    class: String,
    valid_from: Option<i64>,
    valid_to: Option<i64>,
    confidence: f64,
    strength: f64,
    stability: f64,
    access_count: i64,
    last_access: i64,
    /// Claim provenance: the memory the fact was extracted from (the fact voice
    /// recalls through it — board 0025).
    source_memory: Option<String>,
}

/// The memory brain of one SAFE (owner-scoped over the shared store).
///
/// `X` is the dreaming fact [`Extractor`] — [`NoExtractor`] by default (deterministic
/// dreaming only); inject a real one with [`Brain::with_extractor`]. A generic (not a
/// `dyn`) because the trait uses `async fn` — same reason the app's embedder is an enum.
pub struct Brain<E: Embedder, X: Extractor = NoExtractor> {
    client: Arc<AvenDbClient>,
    embedder: E,
    sealer: Arc<dyn Sealer>,
    owner: ObjectId,
    extractor: X,
}

impl<E: Embedder> Brain<E> {
    /// Open an ephemeral, in-memory brain for `owner` (tests / dev) with a
    /// random-key sealer. Nothing persists; nothing else can open its cells.
    pub async fn open_in_memory(app: &str, owner: ObjectId, embedder: E) -> Result<Self, BrainError> {
        let data_dir = std::env::temp_dir().join(format!("aven-brain-{app}"));
        let _ = std::fs::create_dir_all(&data_dir);
        let context = AppContext {
            app_id: AppId::from_name(app),
            client_id: None,
            schema: brain_schema(embedder.dim()),
            data_dir,
            live_schemas: Vec::new(),
        };
        let client = AvenDbClient::connect_headless_in_memory(context, Arc::new(NullSyncTransport))
            .await
            .map_err(|e| BrainError::Open(format!("{e:?}")))?;
        let sealer = Arc::new(KeySealer::random(*owner.uuid()));
        Ok(Self::over(Arc::new(client), owner, embedder, sealer))
    }

    /// Wrap an existing client (the app's shared store) as `owner`'s brain. The
    /// sealer is the app's DEK-backed implementation — same AAD coordinates as the
    /// device seal path, so hydrate/viewer open brain cells like any other.
    pub fn over(
        client: Arc<AvenDbClient>,
        owner: ObjectId,
        embedder: E,
        sealer: Arc<dyn Sealer>,
    ) -> Self {
        Self {
            client,
            embedder,
            sealer,
            owner,
            extractor: NoExtractor,
        }
    }
}

impl<E: Embedder, X: Extractor> Brain<E, X> {
    /// Attach a dreaming fact extractor (board 0024) — the dream pass will mine typed
    /// facts from newly-written memories through it, off the write path.
    pub fn with_extractor<X2: Extractor>(self, extractor: X2) -> Brain<E, X2> {
        Brain {
            client: self.client,
            embedder: self.embedder,
            sealer: self.sealer,
            owner: self.owner,
            extractor,
        }
    }

    /// The embedder's short name (for traces).
    pub fn embedder_name(&self) -> &'static str {
        self.embedder.name()
    }

    // ── Write path ───────────────────────────────────────────────────────────

    /// Store a memory with default artifact columns. **Idempotent** by content hash.
    pub async fn remember(&self, content: &str) -> Result<ObjectId, BrainError> {
        self.remember_with(content, &RememberOptions::default()).await
    }

    /// Store a memory (verbatim content + embedding + artifact columns) and build its entity/
    /// relation graph inline. **Idempotent** by content hash. For BULK ingest (a long paste split
    /// into many chunks) use [`remember_chunked`](Self::remember_chunked), which defers the graph
    /// to the dream pass so the serial avenDB runtime never freezes.
    pub async fn remember_with(
        &self,
        content: &str,
        opts: &RememberOptions,
    ) -> Result<ObjectId, BrainError> {
        let id = self.remember_raw(content, opts).await?;
        self.write_graph(id, content).await?;
        Ok(id)
    }

    /// Store a memory (content + embedding + artifact columns) WITHOUT building the graph — the
    /// fast core shared by `remember_with` (which adds the graph) and `remember_chunked` (which
    /// leaves the graph to the dream pass). Idempotent by content hash.
    async fn remember_raw(
        &self,
        content: &str,
        opts: &RememberOptions,
    ) -> Result<ObjectId, BrainError> {
        let mac = self.sealer.dedup_mac(content);
        if let Some(existing) = self.find_by_content_hash(&mac).await? {
            return Ok(existing);
        }

        let embedding = self.embedder.embed(content).await;
        let oid = ObjectId::new();
        let row = *oid.uuid();
        let fields = HashMap::from([
            ("owner".to_string(), Value::Uuid(self.owner)),
            ("content".to_string(), self.sv(MEMORIES, "content", row, content)?),
            (
                "embedding".to_string(),
                self.sv(MEMORIES, "embedding", row, &encode_embedding(&embedding))?,
            ),
            ("stream".to_string(), self.sv(MEMORIES, "stream", row, &opts.stream)?),
            (
                "author_role".to_string(),
                self.sv(MEMORIES, "author_role", row, &opts.author_role)?,
            ),
            (
                "source".to_string(),
                self.sv_opt(MEMORIES, "source", row, opts.source.as_deref())?,
            ),
            (
                "seq".to_string(),
                self.sv_opt(MEMORIES, "seq", row, opts.seq.map(|n| n.to_string()).as_deref())?,
            ),
            (
                "line_start".to_string(),
                self.sv_opt(
                    MEMORIES,
                    "line_start",
                    row,
                    opts.line_start.map(|n| n.to_string()).as_deref(),
                )?,
            ),
            (
                "line_end".to_string(),
                self.sv_opt(
                    MEMORIES,
                    "line_end",
                    row,
                    opts.line_end.map(|n| n.to_string()).as_deref(),
                )?,
            ),
            (
                "content_date".to_string(),
                self.sv_opt(
                    MEMORIES,
                    "content_date",
                    row,
                    opts.content_date_ms.map(|ms| ms.to_string()).as_deref(),
                )?,
            ),
            ("content_hash".to_string(), Value::Bytea(mac)),
            (
                "normalize_version".to_string(),
                self.sv(MEMORIES, "normalize_version", row, "1")?,
            ),
            (
                "veracity".to_string(),
                self.sv_opt(MEMORIES, "veracity", row, opts.veracity.as_deref())?,
            ),
            (
                "importance".to_string(),
                self.sv(
                    MEMORIES,
                    "importance",
                    row,
                    &opts.importance.clamp(0.0, 1.0).to_string(),
                )?,
            ),
        ]);
        let memory_id = self
            .client
            .create_checked_with_id_and_metadata(MEMORIES, oid, fields, HashMap::new())
            .await
            .map_err(|e| BrainError::Write(format!("{e:?}")))?;

        // No graph here — the caller decides (inline for `remember_with`, deferred to the dream
        // pass for `remember_chunked`).
        Ok(memory_id)
    }

    /// Store a long paste as MANY chunk-memories (each carrying `seq` + its line range) so recall
    /// returns the specific relevant passage instead of one blob the context budget would truncate.
    /// Short content stores as a single memory. Returns the stored ids in order; the FIRST is the
    /// primary (surfaced to the roundtrip aside). Each chunk dedups independently.
    pub async fn remember_chunked(
        &self,
        content: &str,
        opts: &RememberOptions,
    ) -> Result<Vec<ObjectId>, BrainError> {
        let chunks = chunk_content(content, MEMORY_CHUNK_MAX_CHARS);
        let mut ids = Vec::with_capacity(chunks.len());
        for (i, ch) in chunks.iter().enumerate() {
            let mut o = opts.clone();
            o.seq = Some(i as i64);
            o.line_start = Some(ch.line_start);
            o.line_end = Some(ch.line_end);
            // remember_RAW: no inline graph — the dream pass enriches these (capped), so a 30-chunk
            // paste can't freeze the serial avenDB runtime with 30× fuzzy-scan write_graph calls.
            ids.push(self.remember_raw(&ch.text, &o).await?);
        }
        Ok(ids)
    }

    // ── Read path ────────────────────────────────────────────────────────────

    /// Hybrid retrieval: top-`k` memories (RRF + modifiers + abstention floor).
    pub async fn search(&self, query: &str, k: usize) -> Result<Vec<Memory>, BrainError> {
        Ok(self
            .search_traced(query, k, &Filter::default())
            .await?
            .into_iter()
            .map(|s| s.memory)
            .collect())
    }

    /// Like [`search`](Self::search), restricted by the typed [`Filter`].
    pub async fn search_filtered(
        &self,
        query: &str,
        k: usize,
        filter: &Filter,
    ) -> Result<Vec<Memory>, BrainError> {
        Ok(self
            .search_traced(query, k, filter)
            .await?
            .into_iter()
            .map(|s| s.memory)
            .collect())
    }

    /// Hybrid retrieval with per-hit provenance (via / rank / score) for RecallTrace.
    ///
    /// Sealed-at-rest: both retrievers run brain-side — owner-scoped scan, open each
    /// candidate in RAM, rank by cosine (vector) and lexical overlap (text), then the
    /// usual RRF fuse + modifiers + abstention floor. Same O(n) as the index-less
    /// engine scan this replaced; an in-memory index is the follow-up optimization.
    pub async fn search_traced(
        &self,
        query: &str,
        k: usize,
        filter: &Filter,
    ) -> Result<Vec<ScoredMemory>, BrainError> {
        let over = (k * 4).max(8);
        let qvec = self.embedder.embed(query).await;
        let qtokens = content_tokens(query);

        // One owner-scoped fetch; open + filter brain-side.
        let rows = self.memory_rows().await?;
        let mut candidates: Vec<(ObjectId, Memory, Option<Vec<f32>>)> = Vec::new();
        for (id, vals) in &rows {
            let m = self.open_memory(*id, vals);
            if !filter.matches(&m) {
                continue;
            }
            let emb = self
                .open_at(MEMORIES, "embedding", id, vals, 2)
                .and_then(|s| decode_embedding(&s));
            candidates.push((*id, m, emb));
        }

        // Vector list: cosine over opened embeddings (descending, positives only).
        let mut vector_list: Vec<(ObjectId, f32)> = candidates
            .iter()
            .filter_map(|(id, _, emb)| {
                let c = cosine(&qvec, emb.as_deref()?);
                (c > 0.0).then_some((*id, c))
            })
            .collect();
        vector_list.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        vector_list.truncate(over);

        // Text list: lexical overlap over opened content (descending, positives only).
        let mut text_list: Vec<(ObjectId, f32)> = candidates
            .iter()
            .filter_map(|(id, m, _)| {
                let s = lexical_overlap(&qtokens, &m.content);
                (s > 0.0).then_some((*id, s))
            })
            .collect();
        text_list.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        text_list.truncate(over);

        // Graph+fact voice (board 0025): entities NAMED in the query vote for the
        // memories that mention them (mention links) and for their claims' source
        // memories — so a typo'd/paraphrased memory the lexical+vector voices miss
        // (e.g. "Sarha" for "Sarah", merged at write time) still surfaces through
        // its graph links. Scores = votes per memory; fused via the same RRF.
        let mut graph_votes: HashMap<ObjectId, f32> = HashMap::new();
        let by_id: HashMap<ObjectId, ()> = candidates.iter().map(|(id, _, _)| (*id, ())).collect();
        {
            let matched: Vec<String> = {
                let mut ids = Vec::new();
                for name in self.entities_in_query(query).await? {
                    if let Some(eid) = self.entity_id_by_name(&name).await? {
                        ids.push(id_str(&eid));
                    }
                }
                ids
            };
            if !matched.is_empty() {
                for l in self.links().await? {
                    let memory_id = if l.kind == "mentions" && matched.contains(&l.to) {
                        // mention voice: memory —mentions→ matched entity
                        Some(l.from.clone())
                    } else if l.class == LinkClass::Claim.as_str()
                        && l.valid_to.is_none()
                        && (matched.contains(&l.from) || matched.contains(&l.to))
                    {
                        // fact voice: an open claim about the entity → its source memory
                        l.source_memory.clone()
                    } else {
                        None
                    };
                    let Some(id) = memory_id.and_then(|s| uuid::Uuid::parse_str(&s).ok()) else {
                        continue;
                    };
                    let oid = ObjectId::from_uuid(id);
                    if by_id.contains_key(&oid) {
                        *graph_votes.entry(oid).or_insert(0.0) += 1.0;
                    }
                }
            }
        }
        let mut graph_list: Vec<(ObjectId, f32)> = graph_votes.into_iter().collect();
        graph_list.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        graph_list.truncate(over);
        let graph_ids: std::collections::HashSet<ObjectId> =
            graph_list.iter().map(|(id, _)| *id).collect();

        // RRF fuse with via tracking.
        let mut score: HashMap<ObjectId, f32> = HashMap::new();
        let mut via: HashMap<ObjectId, Via> = HashMap::new();
        let mut mem: HashMap<ObjectId, Memory> = HashMap::new();
        for (id, m, _) in &candidates {
            mem.insert(*id, m.clone());
        }
        for (list, list_via) in [
            (&vector_list, Via::Vector),
            (&text_list, Via::Bm25),
            (&graph_list, Via::Graph),
        ] {
            for (rank, (id, _)) in list.iter().enumerate() {
                *score.entry(*id).or_insert(0.0) += 1.0 / (RRF_K + rank as f32 + 1.0);
                via.entry(*id)
                    .and_modify(|v| {
                        if *v != list_via {
                            *v = Via::Both;
                        }
                    })
                    .or_insert(list_via);
            }
        }

        // Read modifiers: veracity × age (from the UUIDv7 row id) × importance.
        let now = now_ms();
        for (id, s) in score.iter_mut() {
            let m = &mem[id];
            let age = now.saturating_sub(created_ms(id));
            *s *= veracity_weight(m.veracity.as_deref())
                * age_weight(age)
                * importance_weight(m.importance);
        }

        // Abstention floor: drop hits below the minimum lexical overlap with the query.
        // Graph-voice hits are exempt — they carry structural evidence (an explicit
        // mention/claim link), which is exactly what the lexical floor cannot see.
        let floor = abstention_floor(qtokens.len());
        let mut ranked: Vec<(ObjectId, f32)> = score
            .into_iter()
            .filter(|(id, _)| {
                if qtokens.is_empty() || graph_ids.contains(id) {
                    return true;
                }
                lexical_overlap(&qtokens, &mem[id].content) >= floor
            })
            .collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        // MMR re-rank: greedy diversity pass over the survivors so the top-k isn't
        // dominated by one cluster — pick by λ·relevance − (1−λ)·redundancy, where
        // redundancy is the max stemmed-Jaccard against the picks so far. The pick set
        // is SEEDED with the query itself, so a stored echo of the user's own question
        // (talk turns are memories too) is maximally redundant and sinks below content.
        let max_score = ranked.first().map(|(_, s)| *s).unwrap_or(0.0).max(f32::EPSILON);
        let sets: HashMap<ObjectId, std::collections::HashSet<String>> = ranked
            .iter()
            .map(|(id, _)| (*id, stem_set(&mem[id].content)))
            .collect();
        let qset = stem_set(query);
        let mut pool = ranked;
        let mut picked_sets: Vec<&std::collections::HashSet<String>> = vec![&qset];
        let mut ranked: Vec<(ObjectId, f32)> = Vec::with_capacity(k);
        while ranked.len() < k && !pool.is_empty() {
            let best = pool
                .iter()
                .enumerate()
                .map(|(i, (id, s))| {
                    let redundancy = picked_sets
                        .iter()
                        .map(|p| jaccard(&sets[id], p))
                        .fold(0.0f32, f32::max);
                    (i, MMR_LAMBDA * (s / max_score) - (1.0 - MMR_LAMBDA) * redundancy)
                })
                .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
                .map(|(i, _)| i)
                .unwrap_or(0);
            let pick = pool.remove(best);
            picked_sets.push(&sets[&pick.0]);
            ranked.push(pick);
        }

        Ok(ranked
            .into_iter()
            .enumerate()
            .filter_map(|(i, (id, s))| {
                let memory = mem.remove(&id)?;
                Some(ScoredMemory {
                    memory,
                    rank: i + 1,
                    score: s,
                    via: via.get(&id).copied().unwrap_or(Via::Vector),
                })
            })
            .collect())
    }

    /// The `n` most-recent memories matching `filter` (no query text). Newest first —
    /// ordering comes from the UUIDv7 row ids, no timestamp column needed.
    pub async fn recall(&self, filter: &Filter, n: usize) -> Result<Vec<Memory>, BrainError> {
        let rows = self.memory_rows().await?;
        let mut mems: Vec<Memory> = rows
            .iter()
            .map(|(id, v)| self.open_memory(*id, v))
            .filter(|m| filter.matches(m))
            .collect();
        mems.sort_by(|a, b| b.id.uuid().cmp(a.id.uuid()));
        mems.truncate(n);
        Ok(mems)
    }

    /// Memories that mention the named entity (entity-scoped recall).
    pub async fn memories_about(&self, name: &str) -> Result<Vec<Memory>, BrainError> {
        let Some(eid) = self.entity_id_by_name(name).await? else {
            return Ok(Vec::new());
        };
        let eid_s = id_str(&eid);
        let memory_ids: std::collections::HashSet<String> = self
            .links()
            .await?
            .into_iter()
            .filter(|l| l.to == eid_s && l.kind == "mentions")
            .map(|l| l.from)
            .collect();
        if memory_ids.is_empty() {
            return Ok(Vec::new());
        }
        // Small-scale fetch: scan this owner's memories and keep the mentioned ones.
        let rows = self.memory_rows().await?;
        Ok(rows
            .into_iter()
            .filter(|(id, _)| memory_ids.contains(&id_str(id)))
            .map(|(id, v)| self.open_memory(id, &v))
            .collect())
    }

    // ── Curation (the agentic memory tool surface, board 0025) ──────────────

    /// Drop a memory from recall — soft: `superseded_by` is stamped with the row's own
    /// id (a tombstone; nothing is deleted, law 3). Every read path filters
    /// `superseded_by IS NULL`, so the memory leaves search, recall, and the window.
    pub async fn forget(&self, id: ObjectId) -> Result<(), BrainError> {
        let sealed = self.sv(MEMORIES, "superseded_by", *id.uuid(), &id_str(&id))?;
        self.client
            .update(id, vec![("superseded_by".to_string(), sealed)])
            .await
            .map_err(|e| BrainError::Write(format!("{e:?}")))?;
        Ok(())
    }

    /// Collaboratively strengthen a memory: step its veracity one tier toward `stated`
    /// (mnemosyne's compounding validation, minimal form). The ladder strictly raises
    /// the read-path weight: tool → imported → inferred → stated; unknown → stated.
    /// Returns the new veracity.
    pub async fn attest(&self, id: ObjectId) -> Result<String, BrainError> {
        let rows = self.memory_rows().await?;
        let current = rows
            .iter()
            .find(|(rid, _)| *rid == id)
            .map(|(rid, vals)| self.open_memory(*rid, vals).veracity)
            .ok_or_else(|| BrainError::Read(format!("attest: no memory {}", id_str(&id))))?;
        let next = match current.as_deref() {
            Some("tool") => "imported",
            Some("imported") => "inferred",
            Some("inferred") | Some("stated") => "stated",
            // unknown (0.8) sits above inferred (0.7) — stepping it anywhere but
            // `stated` would LOWER its weight.
            _ => "stated",
        };
        let sealed = self.sv(MEMORIES, "veracity", *id.uuid(), next)?;
        self.client
            .update(id, vec![("veracity".to_string(), sealed)])
            .await
            .map_err(|e| BrainError::Write(format!("{e:?}")))?;
        Ok(next.to_string())
    }

    /// Explicit, deliberate link between two memories ("these belong together") — a
    /// `refers_to` note link (append-only, idempotent). The model's `memory_link` tool.
    pub async fn link(&self, from: ObjectId, to: ObjectId) -> Result<(), BrainError> {
        self.add_note_link(from, to, "refers_to").await
    }

    /// Memories explicitly linked to `id` via `refers_to`, either direction — the
    /// traversal the `link` primitive promises.
    pub async fn linked(&self, id: ObjectId) -> Result<Vec<Memory>, BrainError> {
        let id_s = id_str(&id);
        let other: std::collections::HashSet<String> = self
            .links()
            .await?
            .into_iter()
            .filter(|l| l.kind == "refers_to")
            .filter_map(|l| {
                if l.from == id_s {
                    Some(l.to)
                } else if l.to == id_s {
                    Some(l.from)
                } else {
                    None
                }
            })
            .collect();
        if other.is_empty() {
            return Ok(Vec::new());
        }
        Ok(self
            .memory_rows()
            .await?
            .into_iter()
            .filter(|(rid, _)| other.contains(&id_str(rid)))
            .map(|(rid, v)| self.open_memory(rid, &v))
            .collect())
    }

    // ── Knowledge graph ──────────────────────────────────────────────────────

    /// All entities in this brain.
    pub async fn entities(&self) -> Result<Vec<Entity>, BrainError> {
        let rows = self
            .client
            .query(
                QueryBuilder::new(ENTITIES)
                    .filter_eq("owner", Value::Uuid(self.owner))
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        Ok(rows
            .iter()
            .map(|(id, v)| Entity {
                id: *id,
                name: self.open_at(ENTITIES, "name", id, v, 1).unwrap_or_default(),
                kind: self.open_at(ENTITIES, "kind", id, v, 2).unwrap_or_default(),
            })
            .collect())
    }

    /// The bond (dynamics) between two named entities, if any.
    pub async fn relation(
        &self,
        a_name: &str,
        b_name: &str,
    ) -> Result<Option<Relation>, BrainError> {
        let (Some(a), Some(b)) = (
            self.entity_id_by_name(a_name).await?,
            self.entity_id_by_name(b_name).await?,
        ) else {
            return Ok(None);
        };
        let (a, b) = canonical_pair(a, b);
        let (a_s, b_s) = (id_str(&a), id_str(&b));
        Ok(self
            .links()
            .await?
            .into_iter()
            .find(|l| l.from == a_s && l.to == b_s && l.kind == BOND_KIND)
            .map(|l| Relation {
                strength: l.strength,
                stability: l.stability,
                access_count: l.access_count,
            }))
    }

    /// Record a temporal **claim**: `subject —predicate→ object` (entities upserted by
    /// name). Claim semantics: an open claim for the same (subject, predicate) gets its
    /// `valid_to` closed — superseded, never deleted. Returns the new claim's link id.
    pub async fn add_fact(
        &self,
        subject: &str,
        predicate: &str,
        object: &str,
        source_memory: Option<ObjectId>,
    ) -> Result<ObjectId, BrainError> {
        self.add_fact_with_confidence(subject, predicate, object, source_memory, 1.0)
            .await
    }

    /// [`Self::add_fact`] with an explicit confidence (auto-extracted claims are humble).
    pub async fn add_fact_with_confidence(
        &self,
        subject: &str,
        predicate: &str,
        object: &str,
        source_memory: Option<ObjectId>,
        confidence: f64,
    ) -> Result<ObjectId, BrainError> {
        class_for_claim_predicate(predicate)?;
        let subj = self.upsert_entity(subject).await?;
        let obj = self.upsert_entity(object).await?;
        let now = now_ms();
        let subj_s = id_str(&subj);
        let obj_s = id_str(&obj);

        let open_claims: Vec<LinkRow> = self
            .links()
            .await?
            .into_iter()
            .filter(|l| l.from == subj_s && l.kind == predicate && l.valid_to.is_none())
            .collect();

        // Repeat evidence for the SAME object: Bayesian confidence bump on the open
        // row — `conf += (1−conf)·w·0.3` (w = the new assertion's confidence) — and
        // no new row. Re-stating a fact strengthens it instead of resetting it.
        if let Some(same) = open_claims.iter().find(|l| l.to == obj_s) {
            let bumped = (same.confidence + (1.0 - same.confidence) * confidence * 0.3).min(1.0);
            let sealed = self.sv(LINKS, "confidence", *same.id.uuid(), &bumped.to_string())?;
            self.client
                .update(same.id, vec![("confidence".to_string(), sealed)])
                .await
                .map_err(|e| BrainError::Write(format!("{e:?}")))?;
            return Ok(same.id);
        }

        // Different object: close the old assertion(s) — superseded, never deleted.
        let open: Vec<ObjectId> = open_claims.into_iter().map(|l| l.id).collect();
        for id in open {
            let sealed_to = self.sv(LINKS, "valid_to", *id.uuid(), &now.to_string())?;
            self.client
                .update(id, vec![("valid_to".to_string(), sealed_to)])
                .await
                .map_err(|e| BrainError::Write(format!("{e:?}")))?;
        }

        let oid = ObjectId::new();
        let row = *oid.uuid();
        self.client
            .create_checked_with_id_and_metadata(
                LINKS,
                oid,
                HashMap::from([
                    ("owner".to_string(), Value::Uuid(self.owner)),
                    ("from".to_string(), self.sv(LINKS, "from", row, &subj_s)?),
                    ("to".to_string(), self.sv(LINKS, "to", row, &id_str(&obj))?),
                    ("kind".to_string(), self.sv(LINKS, "kind", row, predicate)?),
                    (
                        "class".to_string(),
                        self.sv(LINKS, "class", row, LinkClass::Claim.as_str())?,
                    ),
                    (
                        "valid_from".to_string(),
                        self.sv(LINKS, "valid_from", row, &now.to_string())?,
                    ),
                    (
                        "confidence".to_string(),
                        self.sv(LINKS, "confidence", row, &confidence.to_string())?,
                    ),
                    (
                        "source_memory".to_string(),
                        self.sv_opt(
                            LINKS,
                            "source_memory",
                            row,
                            source_memory.map(|m| id_str(&m)).as_deref(),
                        )?,
                    ),
                ]),
                HashMap::new(),
            )
            .await
            .map_err(|e| BrainError::Write(format!("{e:?}")))
    }

    /// All claims with `subject` as the subject (current and historical).
    pub async fn facts(&self, subject: &str) -> Result<Vec<Fact>, BrainError> {
        let Some(subj) = self.entity_id_by_name(subject).await? else {
            return Ok(Vec::new());
        };
        let subj_s = id_str(&subj);
        let names: std::collections::HashMap<String, String> = self
            .entities()
            .await?
            .into_iter()
            .map(|e| (id_str(&e.id), e.name))
            .collect();
        Ok(self
            .links()
            .await?
            .into_iter()
            .filter(|l| l.from == subj_s && l.class == LinkClass::Claim.as_str())
            .map(|l| Fact {
                predicate: l.kind,
                object_name: names.get(&l.to).cloned().unwrap_or_default(),
                valid_from_ms: l.valid_from,
                valid_to_ms: l.valid_to,
                confidence: l.confidence,
            })
            .collect())
    }

    // ── Context assembly ─────────────────────────────────────────────────────

    /// Set the brain's L0 self text — stored as a single memory in the reserved
    /// `self` stream, replacing any previous one.
    pub async fn set_self(&self, text: &str) -> Result<(), BrainError> {
        for m in self.recall(&Filter::stream("self"), usize::MAX).await? {
            self.client
                .delete(m.id)
                .await
                .map_err(|e| BrainError::Write(format!("{e:?}")))?;
        }
        self.remember_with(
            text,
            &RememberOptions {
                stream: "self".to_string(),
                veracity: Some("stated".to_string()),
                ..Default::default()
            },
        )
        .await?;
        Ok(())
    }

    /// Assemble the wake-up context: L0 self + L1 gist (the `gist_n` most-recent
    /// non-self memories, compactly rendered). The block an agent loads on start.
    pub async fn wake(&self, gist_n: usize) -> Result<String, BrainError> {
        let self_text = self.l0_self().await?;
        let recent = self.recall(&Filter::default(), gist_n + 16).await?;
        let mut out = String::from("# Self\n");
        out.push_str(&self_text);
        out.push_str("\n\n# Recent memories\n");
        for m in recent.iter().filter(|m| m.stream != "self").take(gist_n) {
            out.push_str("- ");
            out.push_str(&truncate(&m.content, 200));
            out.push('\n');
        }
        Ok(out)
    }

    /// A compact card for an entity: compiled-truth (kind + strongest bonds + current
    /// claims) + the timeline of memories mentioning it.
    pub async fn entity_card(&self, name: &str) -> Result<Option<EntityCard>, BrainError> {
        let Some(eid) = self.entity_id_by_name(name).await? else {
            return Ok(None);
        };
        let kind = self
            .entities()
            .await?
            .into_iter()
            .find(|e| e.id == eid)
            .map(|e| e.kind)
            .unwrap_or_default();

        // Bonds involving this entity (either side): (other_id_str, strength).
        let eid_s = id_str(&eid);
        let mut weighted: Vec<(String, f64)> = Vec::new();
        for l in self.links().await? {
            if l.kind != BOND_KIND {
                continue;
            }
            if l.from == eid_s {
                weighted.push((l.to, l.strength));
            } else if l.to == eid_s {
                weighted.push((l.from, l.strength));
            }
        }
        let names: std::collections::HashMap<String, String> = self
            .entities()
            .await?
            .into_iter()
            .map(|e| (id_str(&e.id), e.name))
            .collect();
        let mut bonds: Vec<(String, f64)> = weighted
            .into_iter()
            .filter_map(|(id, s)| names.get(&id).map(|n| (n.clone(), s)))
            .collect();
        bonds.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        let facts = self
            .facts(name)
            .await?
            .into_iter()
            .filter(|f| f.valid_to_ms.is_none())
            .collect();
        let recent_memories = self.memories_about(name).await?;
        Ok(Some(EntityCard {
            name: name.to_string(),
            kind,
            bonds,
            facts,
            recent_memories,
        }))
    }

    /// Build the budgeted LLM context for one turn — the brain as context manager.
    /// Deterministic, zero-LLM: pins L0+L1, includes the working window, fills with
    /// traced recall and entity cards to the char budget, and returns the receipt.
    pub async fn assemble_context(
        &self,
        query: &str,
        opts: &ContextOptions,
    ) -> Result<ContextBundle, BrainError> {
        let l0 = self.l0_self().await?;
        let gist: Vec<String> = self
            .recall(&Filter::default(), opts.gist_n + 16)
            .await?
            .into_iter()
            .filter(|m| m.stream != "self")
            .take(opts.gist_n)
            .map(|m| truncate(&m.content, 160))
            .collect();

        // Working window: last N turns of the filtered stream, chronological.
        let mut working = self.recall(&opts.filter, opts.working_n).await?;
        working.reverse();
        let working_ids: std::collections::HashSet<String> =
            working.iter().map(|m| id_str(&m.id)).collect();

        // Inner recall query: the brain carries conversational continuity ITSELF (no
        // app-side thread concept) — a thin follow-up ("check your memory", "schau
        // nochmal") has no recallable tokens of its own, so it is enriched with the last
        // exchange from the working window. The trace records the enriched query: the
        // receipt shows exactly what recall ran.
        const ENRICH_QUERY_MIN_TOKENS: usize = 4;
        let mut recall_query = query.to_string();
        if content_tokens(query).len() < ENRICH_QUERY_MIN_TOKENS {
            for m in working.iter().rev().take(3) {
                recall_query.push('\n');
                recall_query.push_str(&truncate(&m.content, 240));
            }
        }

        // L3: traced hybrid recall across everything, excluding the window.
        let recalled: Vec<ScoredMemory> = self
            .search_traced(&recall_query, opts.recall_k * 2, &Filter::default())
            .await?
            .into_iter()
            .filter(|s| !working_ids.contains(&id_str(&s.memory.id)) && s.memory.stream != "self")
            .take(opts.recall_k)
            .collect();

        // L2: entity cards for entities named in the (enriched) query.
        let mut cards: Vec<EntityCard> = Vec::new();
        for name in self.entities_in_query(&recall_query).await? {
            if cards.len() >= opts.entity_cards {
                break;
            }
            if let Some(card) = self.entity_card(&name).await? {
                cards.push(card);
            }
        }

        // Budgeted assembly: pin L0+L1 → working newest-first → recall by rank → cards.
        let mut prompt = String::new();
        prompt.push_str("# Self\n");
        prompt.push_str(&l0);
        prompt.push_str("\n\n# Story so far\n");
        for g in &gist {
            prompt.push_str("- ");
            prompt.push_str(g);
            prompt.push('\n');
        }
        let mut used = prompt.chars().count();
        let mut dropped_working = 0usize;
        let mut dropped_recalled = 0usize;

        let mut working_block = String::from("\n# Conversation\n");
        let mut kept_working: Vec<&Memory> = Vec::new();
        // Keep newest first under budget, then restore chronological order.
        for m in working.iter().rev() {
            let line = format!("{}: {}\n", m.author_role, truncate(&m.content, 400));
            if used + working_block.chars().count() + line.chars().count() > opts.budget_chars {
                dropped_working += 1;
                continue;
            }
            working_block.push_str(&line);
            kept_working.push(m);
        }
        // (lines were appended newest-first; rebuild chronologically)
        if !kept_working.is_empty() {
            working_block = String::from("\n# Conversation\n");
            for m in kept_working.iter().rev() {
                working_block.push_str(&format!(
                    "{}: {}\n",
                    m.author_role,
                    truncate(&m.content, 400)
                ));
            }
        }
        prompt.push_str(&working_block);
        used = prompt.chars().count();

        let mut recall_block = String::from("\n# Relevant memories\n");
        let mut kept_recalled: Vec<&ScoredMemory> = Vec::new();
        for s in &recalled {
            let line = format!("- {}\n", truncate(&s.memory.content, 300));
            if used + recall_block.chars().count() + line.chars().count() > opts.budget_chars {
                dropped_recalled += 1;
                continue;
            }
            recall_block.push_str(&line);
            kept_recalled.push(s);
        }
        if !kept_recalled.is_empty() {
            prompt.push_str(&recall_block);
            used = prompt.chars().count();
        }

        let mut trace_entities = Vec::new();
        for card in &cards {
            let rendered = card.render();
            if used + rendered.chars().count() <= opts.budget_chars {
                prompt.push_str("\n");
                prompt.push_str(&rendered);
                used = prompt.chars().count();
                trace_entities.push(TraceEntity {
                    name: card.name.clone(),
                    kind: card.kind.clone(),
                    bonds: card.bonds.clone(),
                });
            }
        }

        let trace = ContextTrace {
            query: recall_query,
            l0_self: l0,
            l1_gist: gist,
            working: kept_working
                .iter()
                .map(|m| TraceWorking {
                    id: id_str(&m.id),
                    snippet: truncate(&m.content, 120),
                    author_role: m.author_role.clone(),
                })
                .collect(),
            recalled: kept_recalled
                .iter()
                .map(|s| TraceRecalled {
                    id: id_str(&s.memory.id),
                    snippet: truncate(&s.memory.content, 120),
                    source: s.memory.source.clone(),
                    rank: s.rank,
                    via: s.via,
                    score: s.score,
                })
                .collect(),
            entities: trace_entities,
            budget: TraceBudget {
                used_chars: used,
                max_chars: opts.budget_chars,
                dropped_recalled,
                dropped_working,
            },
            embedder: self.embedder.name().to_string(),
            assembled_at_ms: now_ms(),
        };

        Ok(ContextBundle { prompt, trace })
    }

    // ── Dreaming (background consolidation) ──────────────────────────────────

    /// Run a consolidation pass at the current time.
    pub async fn dream(&self) -> Result<DreamReport, BrainError> {
        self.dream_at(now_ms()).await
    }

    /// Consolidation as of `now` (ms): merge duplicate entities (by normalized name),
    /// then apply Ebbinghaus decay to bond strength.
    pub async fn dream_at(&self, now: i64) -> Result<DreamReport, BrainError> {
        // Build the entity/relation graph for recently-stored memories that don't have one yet —
        // moved here OFF the synchronous ingest path. First so the fresh entities feed the
        // merge/dedup steps below.
        let _enriched = self.enrich_recent_graphs().await?;
        // Extract: mine typed facts from not-yet-extracted memories through the configured
        // extractor (board 0024) — batched to exhaustion here; the stepped dream does one
        // bounded batch per step.
        let mut facts_extracted = 0usize;
        for _ in 0..16 {
            match self.extract_batch(EXTRACT_BATCH_MAX).await? {
                Some((_, n_facts, _)) => facts_extracted += n_facts,
                None => break,
            }
        }
        let entities_merged = self.merge_duplicate_entities().await?;
        let bonds_decayed = self.decay_bonds(now).await?;
        let (claims_deduped, claims_contradicted) = self.verify_claims(now).await?;
        let (summaries_written, memories_consolidated) = self.consolidate(now).await?;
        Ok(DreamReport {
            bonds_decayed,
            entities_merged,
            facts_extracted,
            claims_deduped,
            claims_contradicted,
            memories_consolidated,
            summaries_written,
        })
    }

    /// Run ONE dream phase by `cursor` (start at 0; re-call with `next_cursor` until `done`).
    /// Each call is bounded and a single avenDB-runtime turn, so the runtime YIELDS to other
    /// requests (status polls, reads) between phases instead of being held for the whole pass —
    /// and every step returns a log line for the live dreaming panel.
    pub async fn dream_step(&self, cursor: i64, now: i64) -> Result<DreamStep, BrainError> {
        // Phase A (cursor 0..ENRICH_CAP): graph ONE new memory per step — so the log streams an
        // entry immediately and each heavy `write_graph` is its own runtime turn. Then the
        // extract phase (cursor 50, one bounded batch per step), then phases C–F.
        const ENRICH_CAP: i64 = 8;
        const EXTRACT: i64 = 50;
        const MERGE: i64 = 100;
        if cursor < ENRICH_CAP {
            return Ok(match self.enrich_one().await? {
                Some(snip) => {
                    let next = cursor + 1;
                    DreamStep::ok(
                        "enrich",
                        format!("Graphed “{snip}”"),
                        1,
                        if next < ENRICH_CAP { next } else { EXTRACT },
                    )
                }
                // Nothing left to graph this pass → on to fact extraction.
                None if cursor == 0 => {
                    DreamStep::ok("enrich", "No new memories to graph".into(), 0, EXTRACT)
                }
                None => DreamStep::ok("enrich", "Graphed all new memories".into(), 0, EXTRACT),
            });
        }
        Ok(match cursor {
            // Extract: ONE bounded batch through the configured extractor per step (real
            // tokens surface in the panel); re-enters until every memory is mined.
            EXTRACT => {
                if !self.extractor.enabled() {
                    DreamStep::ok(
                        "extract",
                        "No extractor configured — deterministic dreaming only".into(),
                        0,
                        MERGE,
                    )
                } else {
                    match self.extract_batch(EXTRACT_BATCH_MAX).await? {
                        Some((n_memories, n_facts, tokens)) => DreamStep {
                            phase: "extract".into(),
                            label: format!("Mined {n_facts} facts from {n_memories} memories"),
                            count: n_facts as i64,
                            tokens,
                            // A full batch may leave more to mine — re-enter this phase.
                            next_cursor: if n_memories == EXTRACT_BATCH_MAX { EXTRACT } else { MERGE },
                            done: false,
                        },
                        None => DreamStep::ok("extract", "All memories fact-mined".into(), 0, MERGE),
                    }
                }
            }
            MERGE => {
                let n = self.merge_duplicate_entities().await? as i64;
                DreamStep::ok("merge", format!("Merged {n} duplicate entities"), n, MERGE + 1)
            }
            101 => {
                let n = self.decay_bonds(now).await? as i64;
                DreamStep::ok("decay", format!("Decayed {n} bonds"), n, 102)
            }
            102 => {
                let (dedup, contra) = self.verify_claims(now).await?;
                DreamStep::ok(
                    "verify",
                    format!("Healed claims · {dedup} deduped, {contra} contradictions resolved"),
                    (dedup + contra) as i64,
                    103,
                )
            }
            103 => {
                let (summaries, mems) = self.consolidate(now).await?;
                DreamStep::ok(
                    "consolidate",
                    format!("Consolidated {mems} old turns into {summaries} summaries"),
                    (summaries + mems) as i64,
                    104,
                )
            }
            _ => DreamStep {
                phase: "done".into(),
                label: "Dreaming complete".into(),
                count: 0,
                tokens: 0,
                next_cursor: cursor,
                done: true,
            },
        })
    }

    /// Graph the next recent memory that has no graph yet (no `note` link from it — the
    /// `extracted` fact-mining marker doesn't count). Returns a short snippet of what it
    /// graphed, or `None` when there's nothing left. One `write_graph` per call so the
    /// stepped dream logs + yields per memory.
    async fn enrich_one(&self) -> Result<Option<String>, BrainError> {
        let built: std::collections::HashSet<String> = self
            .links()
            .await?
            .into_iter()
            .filter(|l| l.class == LinkClass::Note.as_str() && l.kind != EXTRACTED_KIND)
            .map(|l| l.from)
            .collect();
        for m in self.recall(&Filter::default(), 64).await? {
            if !built.contains(&id_str(&m.id)) {
                self.write_graph(m.id, &m.content).await?;
                let snip: String = m.content.chars().take(56).collect();
                return Ok(Some(snip));
            }
        }
        Ok(None)
    }

    /// Hand ONE batch of newly-written, not-yet-extracted memories to the configured
    /// [`Extractor`] and write the returned facts back to the graph as claim links
    /// (subject entity —predicate→ object entity, confidence + provenance). Each mined
    /// memory gets an idempotence marker (`memory —extracted→ memory`, note class) so it
    /// is never re-extracted; identical (subject, predicate, object) facts dedupe via
    /// the claim semantics (re-assertion = Bayesian confidence bump, no new row).
    /// Returns `(memories mined, facts written, tokens spent)`, or `None` when
    /// everything is already extracted. Extractor errors fail the step WITHOUT marking,
    /// so the batch retries next dream.
    async fn extract_batch(
        &self,
        cap: usize,
    ) -> Result<Option<(usize, usize, i64)>, BrainError> {
        if !self.extractor.enabled() {
            return Ok(None);
        }
        let extracted: std::collections::HashSet<String> = self
            .links()
            .await?
            .into_iter()
            .filter(|l| l.kind == EXTRACTED_KIND)
            .map(|l| l.from)
            .collect();
        let mut batch: Vec<ExtractionInput> = Vec::with_capacity(cap);
        for m in self.recall(&Filter::default(), 64).await? {
            if batch.len() >= cap {
                break;
            }
            // Self/summary streams are brain-authored — nothing new to mine there.
            if m.stream == "self" || m.stream == "summary" || extracted.contains(&id_str(&m.id)) {
                continue;
            }
            batch.push(ExtractionInput {
                memory_id: m.id,
                content: m.content,
            });
        }
        if batch.is_empty() {
            return Ok(None);
        }

        let out = self
            .extractor
            .extract(&batch)
            .await
            .map_err(|e| BrainError::Write(format!("extractor: {e}")))?;

        let mut written = 0usize;
        let mut seen: std::collections::HashSet<(String, String, String)> =
            std::collections::HashSet::new();
        for f in &out.facts {
            // In-batch dedupe; cross-batch dupes collapse via claim semantics anyway.
            if !seen.insert((f.subject.clone(), f.predicate.clone(), f.object.clone())) {
                continue;
            }
            self.add_fact_with_confidence(
                &f.subject,
                &f.predicate,
                &f.object,
                Some(f.source_memory),
                f.confidence as f64,
            )
            .await?;
            written += 1;
        }
        for input in &batch {
            self.add_note_link(input.memory_id, input.memory_id, EXTRACTED_KIND)
                .await?;
        }
        Ok(Some((batch.len(), written, out.tokens)))
    }

    /// Claim healer (cross-device): collapse duplicate OPEN claims per
    /// (subject, predicate, object) — keep the earliest, bump its confidence per
    /// duplicate, close the rest — then resolve contradictions per (subject,
    /// predicate): the highest-confidence claim stays open, others close.
    /// Nothing is ever deleted (law 3).
    async fn verify_claims(&self, now: i64) -> Result<(usize, usize), BrainError> {
        use std::collections::HashMap as Map;
        let open: Vec<LinkRow> = self
            .links()
            .await?
            .into_iter()
            .filter(|l| l.class == LinkClass::Claim.as_str() && l.valid_to.is_none())
            .collect();

        let mut deduped = 0usize;
        let mut contradicted = 0usize;
        let mut by_subject_pred: Map<(String, String), Vec<LinkRow>> = Map::new();
        for l in open {
            by_subject_pred.entry((l.from.clone(), l.kind.clone())).or_default().push(l);
        }

        for (_, mut group) in by_subject_pred {
            if group.len() < 2 {
                continue;
            }
            group.sort_by(|a, b| a.id.uuid().cmp(b.id.uuid())); // oldest first (UUIDv7)

            // Phase 1: same-object duplicates → keep oldest, bump, close the rest.
            let mut survivors: Vec<LinkRow> = Vec::new();
            for l in group {
                if let Some(keep) = survivors.iter_mut().find(|s| s.to == l.to) {
                    keep.confidence =
                        (keep.confidence + (1.0 - keep.confidence) * l.confidence * 0.3).min(1.0);
                    let sealed_conf =
                        self.sv(LINKS, "confidence", *keep.id.uuid(), &keep.confidence.to_string())?;
                    self.client
                        .update(keep.id, vec![("confidence".to_string(), sealed_conf)])
                        .await
                        .map_err(|e| BrainError::Write(format!("{e:?}")))?;
                    let sealed_to = self.sv(LINKS, "valid_to", *l.id.uuid(), &now.to_string())?;
                    self.client
                        .update(l.id, vec![("valid_to".to_string(), sealed_to)])
                        .await
                        .map_err(|e| BrainError::Write(format!("{e:?}")))?;
                    deduped += 1;
                } else {
                    survivors.push(l);
                }
            }

            // Phase 2: contradiction — different objects still open: highest
            // confidence wins (tie → oldest), the rest close.
            if survivors.len() > 1 {
                let winner = survivors
                    .iter()
                    .enumerate()
                    .max_by(|(ia, a), (ib, b)| {
                        a.confidence
                            .partial_cmp(&b.confidence)
                            .unwrap_or(std::cmp::Ordering::Equal)
                            .then(ib.cmp(ia)) // tie → earlier (lower index) wins
                    })
                    .map(|(i, _)| i)
                    .unwrap_or(0);
                for (i, l) in survivors.iter().enumerate() {
                    if i == winner {
                        continue;
                    }
                    let sealed_to = self.sv(LINKS, "valid_to", *l.id.uuid(), &now.to_string())?;
                    self.client
                        .update(l.id, vec![("valid_to".to_string(), sealed_to)])
                        .await
                        .map_err(|e| BrainError::Write(format!("{e:?}")))?;
                    contradicted += 1;
                }
            }
        }
        Ok((deduped, contradicted))
    }

    /// Consolidation: roll talk turns older than 24h into per-day summary memories
    /// (stream `summary`, deterministic digest content ⇒ content-hash idempotent ⇒
    /// concurrent dreams on two devices converge), linked `summarizes → member`.
    /// Originals stay recallable; search dedups summary-vs-member (read path).
    async fn consolidate(&self, now: i64) -> Result<(usize, usize), BrainError> {
        use std::collections::{HashMap as Map, HashSet};
        const CONSOLIDATE_AFTER_MS: i64 = 24 * 3_600_000;
        const MIN_WINDOW: usize = 3;

        let summarized: HashSet<String> = self
            .links()
            .await?
            .into_iter()
            .filter(|l| l.kind == "summarizes")
            .map(|l| l.to)
            .collect();

        let rows = self.memory_rows().await?;
        let mut by_day: Map<i64, Vec<(i64, ObjectId, String)>> = Map::new();
        for (id, vals) in &rows {
            let m = self.open_memory(*id, vals);
            if m.stream != "talk" || summarized.contains(&id_str(id)) {
                continue;
            }
            let at = created_ms(id);
            if now.saturating_sub(at) < CONSOLIDATE_AFTER_MS {
                continue;
            }
            by_day.entry(at / MS_PER_DAY).or_default().push((at, *id, m.content));
        }

        let mut summaries = 0usize;
        let mut consolidated = 0usize;
        for (day, mut members) in by_day {
            if members.len() < MIN_WINDOW {
                continue;
            }
            members.sort_by_key(|(at, id, _)| (*at, *id.uuid()));
            let mut digest = format!("Day summary ({}):\n", day);
            for (_, _, content) in &members {
                digest.push_str("• ");
                digest.push_str(&truncate(content, 120));
                digest.push('\n');
            }
            let summary_id = self
                .remember_with(
                    &digest,
                    &RememberOptions {
                        stream: "summary".to_string(),
                        author_role: "system".to_string(),
                        veracity: Some("inferred".to_string()),
                        ..Default::default()
                    },
                )
                .await?;
            for (_, member, _) in &members {
                self.add_note_link(summary_id, *member, "summarizes").await?;
                consolidated += 1;
            }
            summaries += 1;
        }
        Ok((summaries, consolidated))
    }

    /// Re-embed every memory with the CURRENT embedder (maintenance: stub→gemma
    /// migration or model upgrades). Idempotent; returns the number re-embedded.
    pub async fn re_embed_all(&self) -> Result<usize, BrainError> {
        let rows = self.memory_rows().await?;
        let mut n = 0usize;
        for (id, vals) in &rows {
            let Some(content) = self.open_at(MEMORIES, "content", id, vals, 1) else {
                continue;
            };
            let emb = self.embedder.embed(&content).await;
            let sealed =
                self.sv(MEMORIES, "embedding", *id.uuid(), &encode_embedding(&emb))?;
            self.client
                .update(*id, vec![("embedding".to_string(), sealed)])
                .await
                .map_err(|e| BrainError::Write(format!("{e:?}")))?;
            n += 1;
        }
        Ok(n)
    }

    /// Ebbinghaus decay over bond links: `strength · exp(-days/stability)`, floored.
    async fn decay_bonds(&self, now: i64) -> Result<usize, BrainError> {
        let bonds: Vec<LinkRow> = self
            .links()
            .await?
            .into_iter()
            .filter(|l| l.kind == BOND_KIND)
            .collect();
        let mut decayed = 0;
        for l in bonds {
            let stability = l.stability.max(1e-4);
            let days = now.saturating_sub(l.last_access) as f64 / MS_PER_DAY as f64;
            if days <= 0.0 {
                continue;
            }
            let new_strength = (l.strength * (-days / stability).exp()).max(STRENGTH_FLOOR);
            if (new_strength - l.strength).abs() > 1e-9 {
                let sealed = self.sv(LINKS, "strength", *l.id.uuid(), &new_strength.to_string())?;
                self.client
                    .update(l.id, vec![("strength".to_string(), sealed)])
                    .await
                    .map_err(|e| BrainError::Write(format!("{e:?}")))?;
                decayed += 1;
            }
        }
        Ok(decayed)
    }

    /// Merge entities sharing a normalized name into one, repointing their links —
    /// the CRDT-dedup story (two devices both create "Alice").
    async fn merge_duplicate_entities(&self) -> Result<usize, BrainError> {
        use std::collections::HashMap;
        let mut groups: HashMap<String, Vec<Entity>> = HashMap::new();
        for e in self.entities().await? {
            groups.entry(normalize_name(&e.name)).or_default().push(e);
        }
        let mut merged = 0;
        for (_, group) in groups {
            if group.len() < 2 {
                continue;
            }
            let canon = group[0].id;
            for dup in &group[1..] {
                self.merge_entity(dup.id, canon).await?;
                merged += 1;
            }
        }
        if merged > 0 {
            self.dedup_bonds().await?;
        }
        Ok(merged)
    }

    /// Repoint `dup`'s links onto `canon` (bonds keep canonical endpoint order), then
    /// delete `dup`.
    async fn merge_entity(&self, dup: ObjectId, canon: ObjectId) -> Result<(), BrainError> {
        let dup_s = id_str(&dup);
        let canon_s = id_str(&canon);
        let touching: Vec<LinkRow> = self
            .links()
            .await?
            .into_iter()
            .filter(|l| l.from == dup_s || l.to == dup_s)
            .collect();
        for l in touching {
            let row = *l.id.uuid();
            let other = if l.from == dup_s { &l.to } else { &l.from };
            if l.kind == BOND_KIND && other == &canon_s {
                // would become a self-bond — drop it.
                self.client
                    .delete(l.id)
                    .await
                    .map_err(|e| BrainError::Write(format!("{e:?}")))?;
                continue;
            }
            if l.kind == BOND_KIND {
                // Keep canonical endpoint ordering for bonds.
                let (na, nb) = canonical_pair_str(&canon_s, other);
                self.client
                    .update(
                        l.id,
                        vec![
                            ("from".to_string(), self.sv(LINKS, "from", row, &na)?),
                            ("to".to_string(), self.sv(LINKS, "to", row, &nb)?),
                        ],
                    )
                    .await
                    .map_err(|e| BrainError::Write(format!("{e:?}")))?;
            } else {
                let col = if l.from == dup_s { "from" } else { "to" };
                self.client
                    .update(l.id, vec![(col.to_string(), self.sv(LINKS, col, row, &canon_s)?)])
                    .await
                    .map_err(|e| BrainError::Write(format!("{e:?}")))?;
            }
        }
        self.client
            .delete(dup)
            .await
            .map_err(|e| BrainError::Write(format!("{e:?}")))?;
        Ok(())
    }

    /// Collapse duplicate bonds per endpoint pair (max strength, summed access_count).
    async fn dedup_bonds(&self) -> Result<(), BrainError> {
        use std::collections::HashMap;
        let bonds: Vec<LinkRow> = self
            .links()
            .await?
            .into_iter()
            .filter(|l| l.kind == BOND_KIND)
            .collect();
        let mut by_pair: HashMap<(String, String), (ObjectId, f64, i64, bool)> = HashMap::new();
        let mut to_delete: Vec<ObjectId> = Vec::new();
        for l in &bonds {
            if l.from == l.to {
                to_delete.push(l.id);
                continue;
            }
            let key = canonical_pair_str(&l.from, &l.to);
            match by_pair.get_mut(&key) {
                None => {
                    by_pair.insert(key, (l.id, l.strength, l.access_count, false));
                }
                Some(entry) => {
                    entry.1 = entry.1.max(l.strength);
                    entry.2 += l.access_count;
                    entry.3 = true;
                    to_delete.push(l.id);
                }
            }
        }
        for (_, (keep, strength, count, dirty)) in by_pair {
            if dirty {
                let row = *keep.uuid();
                self.client
                    .update(
                        keep,
                        vec![
                            ("strength".to_string(), self.sv(LINKS, "strength", row, &strength.to_string())?),
                            (
                                "access_count".to_string(),
                                self.sv(LINKS, "access_count", row, &count.to_string())?,
                            ),
                        ],
                    )
                    .await
                    .map_err(|e| BrainError::Write(format!("{e:?}")))?;
            }
        }
        for id in to_delete {
            self.client
                .delete(id)
                .await
                .map_err(|e| BrainError::Write(format!("{e:?}")))?;
        }
        Ok(())
    }

    // ── Internals ────────────────────────────────────────────────────────────

    /// Seal one cell bound to `(table, column, row)` → a sealed Text value.
    fn sv(&self, table: &str, column: &str, row: uuid::Uuid, plaintext: &str) -> Result<Value, BrainError> {
        Ok(Value::Text(
            self.sealer
                .seal(table, column, row, plaintext)
                .map_err(BrainError::Write)?,
        ))
    }

    /// Seal an optional cell — `None` stays `Null` (null-ness is metadata).
    fn sv_opt(
        &self,
        table: &str,
        column: &str,
        row: uuid::Uuid,
        plaintext: Option<&str>,
    ) -> Result<Value, BrainError> {
        match plaintext {
            Some(s) => self.sv(table, column, row, s),
            None => Ok(Value::Null),
        }
    }

    /// Open one sealed cell of a fetched row (None for Null or unopenable).
    fn open_at(&self, table: &str, column: &str, id: &ObjectId, v: &[Value], i: usize) -> Option<String> {
        match v.get(i) {
            Some(Value::Text(s)) => self.sealer.open(table, column, *id.uuid(), s).ok(),
            _ => None,
        }
    }

    /// All raw memory rows of this owner with `superseded_by IS NULL` (DB-side —
    /// null-ness is metadata even on sealed columns).
    async fn memory_rows(&self) -> Result<Vec<(ObjectId, Vec<Value>)>, BrainError> {
        self.client
            .query(
                QueryBuilder::new(MEMORIES)
                    .filter_eq("owner", Value::Uuid(self.owner))
                    .filter_is_null("superseded_by")
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))
    }

    /// Open a fetched memory row into the public [`Memory`] (cells decrypt in RAM).
    /// Memory column order: owner, content, embedding, stream, author_role, source,
    /// seq, line_start, line_end, content_date, content_hash, source_version,
    /// normalize_version, veracity, superseded_by, importance.
    fn open_memory(&self, id: ObjectId, vals: &[Value]) -> Memory {
        Memory {
            id,
            content: self.open_at(MEMORIES, "content", &id, vals, 1).unwrap_or_default(),
            stream: self.open_at(MEMORIES, "stream", &id, vals, 3).unwrap_or_default(),
            author_role: self
                .open_at(MEMORIES, "author_role", &id, vals, 4)
                .unwrap_or_default(),
            source: self.open_at(MEMORIES, "source", &id, vals, 5),
            veracity: self.open_at(MEMORIES, "veracity", &id, vals, 13),
            // Pre-importance rows (and lens-migrated nulls) score neutral.
            importance: self
                .open_at(MEMORIES, "importance", &id, vals, 15)
                .and_then(|s| s.parse().ok())
                .unwrap_or(0.5),
        }
    }

    /// All link rows of this owner, opened (the graph walks filter over these).
    /// Link column order: owner, from, to, kind, class, valid_from, valid_to,
    /// confidence, strength, stability, access_count, last_access, source_memory.
    async fn links(&self) -> Result<Vec<LinkRow>, BrainError> {
        let rows = self
            .client
            .query(
                QueryBuilder::new(LINKS)
                    .filter_eq("owner", Value::Uuid(self.owner))
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        Ok(rows
            .iter()
            .map(|(id, v)| LinkRow {
                id: *id,
                from: self.open_at(LINKS, "from", id, v, 1).unwrap_or_default(),
                to: self.open_at(LINKS, "to", id, v, 2).unwrap_or_default(),
                kind: self.open_at(LINKS, "kind", id, v, 3).unwrap_or_default(),
                class: self.open_at(LINKS, "class", id, v, 4).unwrap_or_default(),
                valid_from: self
                    .open_at(LINKS, "valid_from", id, v, 5)
                    .and_then(|s| s.parse().ok()),
                valid_to: self
                    .open_at(LINKS, "valid_to", id, v, 6)
                    .and_then(|s| s.parse().ok()),
                confidence: self
                    .open_at(LINKS, "confidence", id, v, 7)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0.0),
                strength: self
                    .open_at(LINKS, "strength", id, v, 8)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0.0),
                stability: self
                    .open_at(LINKS, "stability", id, v, 9)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0.0),
                access_count: self
                    .open_at(LINKS, "access_count", id, v, 10)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0),
                last_access: self
                    .open_at(LINKS, "last_access", id, v, 11)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0),
                source_memory: self.open_at(LINKS, "source_memory", id, v, 12),
            })
            .collect())
    }

    /// The L0 self text (reserved `self` stream).
    async fn l0_self(&self) -> Result<String, BrainError> {
        Ok(self
            .recall(&Filter::stream("self"), 1)
            .await?
            .into_iter()
            .next()
            .map(|m| m.content)
            .unwrap_or_else(|| "(self not set)".to_string()))
    }

    /// Entity names that appear in the query (wikilinks ∪ case-insensitive name match).
    async fn entities_in_query(&self, query: &str) -> Result<Vec<String>, BrainError> {
        let mut names = extract_wikilinks(query);
        let lower = query.to_lowercase();
        for e in self.entities().await? {
            if names.iter().any(|n| normalize_name(n) == normalize_name(&e.name)) {
                continue;
            }
            if lower.contains(&normalize_name(&e.name)) {
                names.push(e.name);
            }
        }
        Ok(names)
    }

    /// Build the graph for a new memory: upsert entities for each wikilink, record an
    /// (idempotent) mention link per entity, and potentiate a bond per co-mentioned pair.
    /// Build the entity/relation graph for the most-recent memories that don't have one yet
    /// (no `note` link from them). Capped per dream pass so it never blocks the avenDB runtime for
    /// long; newest-first so a just-pasted document enriches over the next few turns. Idempotent.
    async fn enrich_recent_graphs(&self) -> Result<usize, BrainError> {
        const MAX_ENRICH_PER_DREAM: usize = 6;
        let built: std::collections::HashSet<String> = self
            .links()
            .await?
            .into_iter()
            .filter(|l| l.class == LinkClass::Note.as_str() && l.kind != EXTRACTED_KIND)
            .map(|l| l.from)
            .collect();
        let mut n = 0;
        for m in self.recall(&Filter::default(), 128).await? {
            if n >= MAX_ENRICH_PER_DREAM {
                break;
            }
            if built.contains(&id_str(&m.id)) {
                continue;
            }
            self.write_graph(m.id, &m.content).await?;
            n += 1;
        }
        Ok(n)
    }

    async fn write_graph(&self, memory_id: ObjectId, content: &str) -> Result<(), BrainError> {
        let mut names = extract_wikilinks(content);
        for auto in extract_auto_entities(content) {
            // A pasted wall of text (e.g. a match report) can mention hundreds of names; without
            // a cap each one triggers a fuzzy entity scan and the O(n²) bonding loop below
            // explodes into tens of thousands of writes, freezing the serial avenDB runtime.
            if names.len() >= MAX_GRAPH_ENTITIES {
                break;
            }
            if !names.iter().any(|n| normalize_name(n) == normalize_name(&auto)) {
                names.push(auto);
            }
        }
        names.truncate(MAX_GRAPH_ENTITIES); // wikilinks alone could already exceed the cap
        let mut entity_ids = Vec::with_capacity(names.len());
        for name in &names {
            let id = self.upsert_entity_fuzzy(name).await?;
            self.ensure_mention(memory_id, id).await?;
            entity_ids.push(id);
        }
        for i in 0..entity_ids.len() {
            for j in (i + 1)..entity_ids.len() {
                self.potentiate_bond(entity_ids[i], entity_ids[j]).await?;
            }
        }
        // SPO claims from the closed predicate templates (high precision, low recall). Capped for
        // the same runaway-write protection as the entity graph above.
        for (subj, pred, obj) in extract_spo(content).into_iter().take(MAX_GRAPH_FACTS) {
            self.add_fact_with_confidence(&subj, &pred, &obj, Some(memory_id), 0.6)
                .await?;
        }
        Ok(())
    }

    /// Find an entity whose normalized name matches exactly OR fuzzily (Levenshtein
    /// similarity ≥ 0.8 — typo coverage: "Sarha" merges into "Sarah"); else create it.
    async fn upsert_entity_fuzzy(&self, name: &str) -> Result<ObjectId, BrainError> {
        if let Some(id) = self.entity_id_by_name(name).await? {
            return Ok(id);
        }
        let norm = normalize_name(name);
        for e in self.entities().await? {
            if levenshtein_sim(&norm, &normalize_name(&e.name)) >= 0.8 {
                return Ok(e.id);
            }
        }
        self.create_entity(name).await
    }

    /// Idempotent **note** link: `memory —mentions→ entity` (re-insert is a no-op).
    async fn ensure_mention(&self, memory: ObjectId, entity: ObjectId) -> Result<(), BrainError> {
        self.add_note_link(memory, entity, "mentions").await
    }

    /// Idempotent **note** link of any registered note kind (append-only, law 6).
    async fn add_note_link(
        &self,
        from: ObjectId,
        to: ObjectId,
        kind: &str,
    ) -> Result<(), BrainError> {
        debug_assert!(NOTE_KINDS.contains(&kind), "unregistered note kind {kind}");
        let (from_s, to_s) = (id_str(&from), id_str(&to));
        let exists = self
            .links()
            .await?
            .iter()
            .any(|l| l.from == from_s && l.to == to_s && l.kind == kind);
        if exists {
            return Ok(());
        }
        let oid = ObjectId::new();
        let row = *oid.uuid();
        self.client
            .create_checked_with_id_and_metadata(
                LINKS,
                oid,
                HashMap::from([
                    ("owner".to_string(), Value::Uuid(self.owner)),
                    ("from".to_string(), self.sv(LINKS, "from", row, &from_s)?),
                    ("to".to_string(), self.sv(LINKS, "to", row, &to_s)?),
                    ("kind".to_string(), self.sv(LINKS, "kind", row, kind)?),
                    (
                        "class".to_string(),
                        self.sv(LINKS, "class", row, LinkClass::Note.as_str())?,
                    ),
                ]),
                HashMap::new(),
            )
            .await
            .map_err(|e| BrainError::Write(format!("{e:?}")))?;
        Ok(())
    }

    /// Find an entity by exact name, or create it (kind "unknown"). Returns its id.
    async fn upsert_entity(&self, name: &str) -> Result<ObjectId, BrainError> {
        if let Some(id) = self.entity_id_by_name(name).await? {
            return Ok(id);
        }
        self.create_entity(name).await
    }

    async fn create_entity(&self, name: &str) -> Result<ObjectId, BrainError> {
        let oid = ObjectId::new();
        let row = *oid.uuid();
        self.client
            .create_checked_with_id_and_metadata(
                ENTITIES,
                oid,
                HashMap::from([
                    ("owner".to_string(), Value::Uuid(self.owner)),
                    ("name".to_string(), self.sv(ENTITIES, "name", row, name)?),
                    ("kind".to_string(), self.sv(ENTITIES, "kind", row, "unknown")?),
                ]),
                HashMap::new(),
            )
            .await
            .map_err(|e| BrainError::Write(format!("{e:?}")))
    }

    /// Exact-name entity lookup — opened brain-side (sealed cells defeat `filter_eq`).
    async fn entity_id_by_name(&self, name: &str) -> Result<Option<ObjectId>, BrainError> {
        Ok(self
            .entities()
            .await?
            .into_iter()
            .find(|e| e.name == name)
            .map(|e| e.id))
    }

    /// Create or reinforce the **bond** between two entities (Hebbian potentiation).
    async fn potentiate_bond(&self, a: ObjectId, b: ObjectId) -> Result<(), BrainError> {
        let (a, b) = canonical_pair(a, b);
        let now = now_ms();
        let (a_s, b_s) = (id_str(&a), id_str(&b));
        let existing = self
            .links()
            .await?
            .into_iter()
            .find(|l| l.from == a_s && l.to == b_s && l.kind == BOND_KIND);

        if let Some(l) = existing {
            let row = *l.id.uuid();
            let strength = (l.strength + POTENTIATION_INCREMENT).min(MAX_STRENGTH);
            let spaced = now.saturating_sub(l.last_access) >= SPACED_INTERVAL_MS;
            let stability = l.stability + if spaced { STABILITY_INCREMENT } else { 0.0 };
            self.client
                .update(
                    l.id,
                    vec![
                        ("strength".to_string(), self.sv(LINKS, "strength", row, &strength.to_string())?),
                        (
                            "stability".to_string(),
                            self.sv(LINKS, "stability", row, &stability.to_string())?,
                        ),
                        (
                            "access_count".to_string(),
                            self.sv(LINKS, "access_count", row, &(l.access_count + 1).to_string())?,
                        ),
                        (
                            "last_access".to_string(),
                            self.sv(LINKS, "last_access", row, &now.to_string())?,
                        ),
                    ],
                )
                .await
                .map_err(|e| BrainError::Write(format!("{e:?}")))?;
        } else {
            let oid = ObjectId::new();
            let row = *oid.uuid();
            self.client
                .create_checked_with_id_and_metadata(
                    LINKS,
                    oid,
                    HashMap::from([
                        ("owner".to_string(), Value::Uuid(self.owner)),
                        ("from".to_string(), self.sv(LINKS, "from", row, &a_s)?),
                        ("to".to_string(), self.sv(LINKS, "to", row, &b_s)?),
                        ("kind".to_string(), self.sv(LINKS, "kind", row, BOND_KIND)?),
                        (
                            "class".to_string(),
                            self.sv(LINKS, "class", row, LinkClass::Bond.as_str())?,
                        ),
                        ("strength".to_string(), self.sv(LINKS, "strength", row, "1")?),
                        ("stability".to_string(), self.sv(LINKS, "stability", row, "1")?),
                        ("access_count".to_string(), self.sv(LINKS, "access_count", row, "1")?),
                        (
                            "last_access".to_string(),
                            self.sv(LINKS, "last_access", row, &now.to_string())?,
                        ),
                    ]),
                    HashMap::new(),
                )
                .await
                .map_err(|e| BrainError::Write(format!("{e:?}")))?;
        }
        Ok(())
    }

    /// Look up an existing memory by its keyed dedup MAC (idempotency). The MAC column
    /// is plaintext routing, so this equality stays a DB-level filter.
    async fn find_by_content_hash(&self, mac: &[u8]) -> Result<Option<ObjectId>, BrainError> {
        let rows = self
            .client
            .query(
                QueryBuilder::new(MEMORIES)
                    .filter_eq("owner", Value::Uuid(self.owner))
                    .filter_eq("content_hash", Value::Bytea(mac.to_vec()))
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        Ok(rows.first().map(|(id, _)| *id))
    }
}

// ── Free helpers ─────────────────────────────────────────────────────────────

/// Extract `[[wikilink]]` entity names from content (case-insensitive dedup).
fn extract_wikilinks(content: &str) -> Vec<String> {
    use std::collections::HashSet;
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut rest = content;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        let name = after[..end].trim();
        if !name.is_empty() && seen.insert(name.to_lowercase()) {
            out.push(name.to_string());
        }
        rest = &after[end + 2..];
    }
    out
}

/// Auto-extract entity names: maximal runs of Capitalized words (each ≥2 chars),
/// skipping a single-word run at a sentence start (ambiguous capitalization) or one
/// that is a capitalized stop-word ("I", "The", …). High precision, low recall —
/// misses are fine: retrieval doesn't depend on the graph, and dreaming catches more.
fn extract_auto_entities(content: &str) -> Vec<String> {
    const CAP_STOPWORDS: [&str; 22] = [
        "i", "the", "a", "an", "we", "he", "she", "they", "it", "but", "and", "so", "btw",
        "ok", "okay", "yes", "no", "my", "our", "your", "this", "that",
    ];
    let mut out: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut run: Vec<String> = Vec::new();
    let mut run_started_sentence = false;
    let mut sentence_start = true;

    fn flush(
        run: &mut Vec<String>,
        run_started_sentence: bool,
        out: &mut Vec<String>,
        seen: &mut std::collections::HashSet<String>,
        stop: &[&str],
    ) {
        if run.is_empty() {
            return;
        }
        let single = run.len() == 1;
        let name = run.join(" ");
        run.clear();
        let norm = name.to_lowercase();
        if single && (run_started_sentence || stop.contains(&norm.as_str())) {
            return;
        }
        if name.chars().count() >= 2 && seen.insert(norm) {
            out.push(name);
        }
    }

    for raw in content.split_whitespace() {
        let ends_sentence = raw.ends_with(['.', '!', '?']);
        // Wikilink markup is the explicit channel — its extractor owns those tokens.
        if raw.contains('[') || raw.contains(']') {
            flush(&mut run, run_started_sentence, &mut out, &mut seen, &CAP_STOPWORDS);
            sentence_start = ends_sentence;
            continue;
        }
        let trimmed = raw.trim_start_matches(|c: char| !c.is_alphanumeric());
        let word: String = trimmed.chars().take_while(|c| c.is_alphanumeric()).collect();
        let word = word.as_str();
        if word.is_empty() {
            flush(&mut run, run_started_sentence, &mut out, &mut seen, &CAP_STOPWORDS);
            sentence_start = sentence_start || ends_sentence;
            continue;
        }
        let capitalized =
            word.chars().next().is_some_and(|c| c.is_uppercase()) && word.chars().count() >= 2;
        if capitalized {
            if run.is_empty() {
                run_started_sentence = sentence_start;
            }
            run.push(word.to_string());
        } else {
            flush(&mut run, run_started_sentence, &mut out, &mut seen, &CAP_STOPWORDS);
        }
        sentence_start = ends_sentence;
    }
    flush(&mut run, run_started_sentence, &mut out, &mut seen, &CAP_STOPWORDS);
    out
}

/// Closed SPO templates (Mnemosyne MEMORIA port): `X works at Y` → `works_at`,
/// `X lives in Y` → `lives_in`. Subject and object must be capitalized (precision).
fn extract_spo(content: &str) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    let lower = content.to_lowercase();
    for (template, pred) in [(" works at ", "works_at"), (" lives in ", "lives_in")] {
        let mut search = 0usize;
        while let Some(found) = lower[search..].find(template) {
            let pos = search + found;
            let before = &content[..pos];
            let after = &content[pos + template.len()..];
            let subj = before
                .split_whitespace()
                .last()
                .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_string())
                .unwrap_or_default();
            let obj = after
                .split_whitespace()
                .take_while(|w| w.chars().next().is_some_and(|c| c.is_uppercase()))
                .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()))
                .collect::<Vec<_>>()
                .join(" ");
            if subj.chars().next().is_some_and(|c| c.is_uppercase()) && !obj.is_empty() {
                out.push((subj, pred.to_string(), obj));
            }
            search = pos + template.len();
        }
    }
    out
}

/// Levenshtein similarity in [0,1] (1 = identical).
fn levenshtein_sim(a: &str, b: &str) -> f64 {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let (n, m) = (a.len(), b.len());
    if n == 0 || m == 0 {
        return if n == m { 1.0 } else { 0.0 };
    }
    let mut prev2: Vec<usize> = vec![0; m + 1];
    let mut prev: Vec<usize> = (0..=m).collect();
    let mut cur = vec![0usize; m + 1];
    for i in 1..=n {
        cur[0] = i;
        for j in 1..=m {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut d = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
            // Damerau: adjacent transposition counts as one edit ("sarha" → "sarah").
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                d = d.min(prev2[j - 2] + 1);
            }
            cur[j] = d;
        }
        prev2.copy_from_slice(&prev);
        std::mem::swap(&mut prev, &mut cur);
    }
    1.0 - prev[m] as f64 / n.max(m) as f64
}

/// Order an entity-id pair canonically so a bond has one row regardless of direction.
fn canonical_pair(a: ObjectId, b: ObjectId) -> (ObjectId, ObjectId) {
    if a.uuid() <= b.uuid() {
        (a, b)
    } else {
        (b, a)
    }
}
fn canonical_pair_str(a: &str, b: &str) -> (String, String) {
    if a <= b {
        (a.to_string(), b.to_string())
    } else {
        (b.to_string(), a.to_string())
    }
}

/// Row id as the canonical string used in link endpoints / trace ids.
fn id_str(id: &ObjectId) -> String {
    id.uuid().to_string()
}

/// Creation time (ms) decoded from a UUIDv7 row id (first 48 bits).
fn created_ms(id: &ObjectId) -> i64 {
    let b = id.uuid().as_bytes();
    (((b[0] as u64) << 40)
        | ((b[1] as u64) << 32)
        | ((b[2] as u64) << 24)
        | ((b[3] as u64) << 16)
        | ((b[4] as u64) << 8)
        | (b[5] as u64)) as i64
}

const STOPWORDS: [&str; 16] = [
    "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "is", "was", "for", "with",
    "we", "it",
];

/// One chunk of a longer paste: a 1-based inclusive line range + its text.
#[derive(Debug, Clone)]
pub struct Chunk {
    pub line_start: i64,
    pub line_end: i64,
    pub text: String,
}

/// Split `content` into retrieval-sized chunks at paragraph (blank-line) boundaries, packing
/// consecutive paragraphs up to ~`max_chars`. Content already within `max_chars` yields ONE chunk.
/// Boundary rule: flush a half-full chunk at a blank line, or just before a line would overflow —
/// so naturally-delimited items (a match's minute-events) land one-or-two per chunk.
pub fn chunk_content(content: &str, max_chars: usize) -> Vec<Chunk> {
    let lines: Vec<&str> = content.lines().collect();
    if content.trim().chars().count() <= max_chars {
        return vec![Chunk {
            line_start: 1,
            line_end: lines.len().max(1) as i64,
            text: content.trim().to_string(),
        }];
    }
    let mut chunks: Vec<Chunk> = Vec::new();
    let mut buf = String::new();
    let mut start = 1usize; // 1-based start line of the current chunk
    let mut last = 1usize; // last non-blank line appended
    for (idx, line) in lines.iter().enumerate() {
        let ln = idx + 1;
        let is_blank = line.trim().is_empty();
        let buf_chars = buf.chars().count();
        let overflow = buf_chars + line.chars().count() + 1 > max_chars;
        if !buf.is_empty() && ((is_blank && buf_chars >= max_chars / 2) || overflow) {
            chunks.push(Chunk {
                line_start: start as i64,
                line_end: last as i64,
                text: buf.trim().to_string(),
            });
            buf.clear();
        }
        if buf.is_empty() {
            if is_blank {
                continue; // never start a chunk on a blank line
            }
            start = ln;
        } else {
            buf.push('\n');
        }
        buf.push_str(line);
        if !is_blank {
            last = ln;
        }
    }
    if !buf.trim().is_empty() {
        chunks.push(Chunk {
            line_start: start as i64,
            line_end: last as i64,
            text: buf.trim().to_string(),
        });
    }
    chunks
}

/// Lowercased non-stopword tokens (≥3 chars) for the abstention floor.
fn content_tokens(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 3 && !STOPWORDS.contains(t))
        .map(|t| t.to_string())
        .collect()
}

/// Light German stem: strip a few common inflectional suffixes so "karten"~"karte"~"kart",
/// "tore"~"tor", "spielen"~"spiel" collapse to a shared stem and match. Crude + deterministic;
/// the real semantic bridge (paraphrase, synonyms like "netzt"≈"Tor") is the embedder.
fn stem(token: &str) -> &str {
    for suf in ["en", "er", "es", "e", "n", "s"] {
        if token.len() > suf.len() + 2 && token.ends_with(suf) {
            return &token[..token.len() - suf.len()];
        }
    }
    token
}

/// Stemmed token set of a text — the unit the MMR redundancy measure compares.
fn stem_set(text: &str) -> std::collections::HashSet<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 3)
        .map(|t| stem(t).to_string())
        .collect()
}

/// Jaccard similarity of two stemmed token sets (0 when either is empty).
fn jaccard(a: &std::collections::HashSet<String>, b: &std::collections::HashSet<String>) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(b).count();
    let union = a.len() + b.len() - inter;
    if union == 0 {
        0.0
    } else {
        inter as f32 / union as f32
    }
}

/// Fraction of query tokens present in the content — matched by STEM (bridges German plural/
/// inflection) with a raw-substring fallback.
fn lexical_overlap(query_tokens: &[String], content: &str) -> f32 {
    if query_tokens.is_empty() {
        return 1.0;
    }
    let content_lower = content.to_lowercase();
    let content_stems: std::collections::HashSet<&str> = content_lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 3)
        .map(stem)
        .collect();
    let hits = query_tokens
        .iter()
        .filter(|t| content_stems.contains(stem(t)) || content_lower.contains(t.as_str()))
        .count();
    hits as f32 / query_tokens.len() as f32
}

/// Cosine similarity (0 when either vector is degenerate).
fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let (mut dot, mut na, mut nb) = (0.0f32, 0.0f32, 0.0f32);
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na <= 0.0 || nb <= 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

/// Packed-f32 (LE) → base64: the plaintext that goes INSIDE the sealed embedding cell.
fn encode_embedding(v: &[f32]) -> String {
    let mut bytes = Vec::with_capacity(v.len() * 4);
    for x in v {
        bytes.extend_from_slice(&x.to_le_bytes());
    }
    B64.encode(bytes)
}

/// Inverse of [`encode_embedding`].
fn decode_embedding(s: &str) -> Option<Vec<f32>> {
    let bytes = B64.decode(s).ok()?;
    if bytes.len() % 4 != 0 {
        return None;
    }
    Some(
        bytes
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect(),
    )
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn ser_object_id<S: serde::Serializer>(id: &ObjectId, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&id.uuid().to_string())
}

/// Truncate to at most `max` chars, appending an ellipsis when cut.
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let head: String = s.chars().take(max).collect();
        format!("{head}…")
    }
}

/// Canonical form for entity-name dedup (trim + lowercase).
fn normalize_name(name: &str) -> String {
    name.trim().to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::embedder::StubEmbedder;
    use crate::EMBED_DIM;

    fn owner() -> ObjectId {
        ObjectId::new()
    }

    async fn test_brain(app: &str) -> Brain<StubEmbedder> {
        Brain::open_in_memory(app, owner(), StubEmbedder::new(EMBED_DIM))
            .await
            .expect("open brain")
    }

    // ───────────────────────── recall eval (the scoreboard) ─────────────────────────
    //
    // A golden retrieval eval drawn from a REAL failing conversation (user pasted a 10KB WM-2026
    // match report, then asked "who got red cards?" / "how many yellows?" — the brain abstained
    // and the LLM answered wrong). Each probe lists the facts (substrings) that MUST surface in the
    // recalled memories for the LLM to answer correctly. We ingest the same report two ways — one
    // blob (`remember`) vs chunked (`remember_chunked`) — and score fact-coverage@k, proving
    // chunking is the win. Run `cargo test -p aven-brain recall_eval -- --nocapture` for the table.

    const EVAL_REPORT: &str = include_str!("eval_fixtures/wm2026_mex_rsa.txt");
    /// Doc B: the unrelated coaching-website text the failing transcript ingested
    /// between questions about the match report — it must not crowd doc A out.
    const EVAL_DOC_B: &str = include_str!("eval_fixtures/coaching_site.txt");

    /// (query, facts that must appear in the recalled passages).
    const EVAL_PROBES: &[(&str, &[&str])] = &[
        ("wer hat eine rote karte bekommen", &["Sithole", "Zwane", "Montes"]),
        ("wie viele gelbe karten gab es und wer", &["Mokoena", "Gutierrez", "Sibisi"]),
        ("in welcher minute war die erste rote karte", &["49"]),
        ("wer hat die tore geschossen", &["Quinones", "Jimenez"]),
    ];

    /// The multi-turn probe sequence about doc A (won · scorers+minutes · cards) — the
    /// conversation from the failing transcript, every turn stored like the app stores
    /// it. The cross-lingual EN-question/DE-doc case is deliberately absent: bridging
    /// "south africa"→"Südafrika" is the semantic embedder's job (Gemma), not the
    /// deterministic gate's (see board card 0023).
    const MULTI_TURN_PROBES: &[(&str, &[&str])] = &[
        ("wer hat das spiel mexiko gegen südafrika gewonnen", &["2:0"]),
        ("wer hat die tore geschossen und wann", &["Quinones", "Jimenez"]),
        ("in welcher minute war die erste rote karte", &["49"]),
        ("wer hat eine rote karte bekommen", &["Sithole", "Zwane", "Montes"]),
        ("wie viele gelbe karten gab es und wer", &["Mokoena", "Gutierrez", "Sibisi"]),
    ];

    /// Fraction of a probe's facts found across the top-`k` recalled memories —
    /// recalled the way `assemble_context` recalls: the working window (the live
    /// conversation, already in the prompt) is excluded, so the measure is what RECALL
    /// contributes beyond the visible exchange. Set `EVAL_DEBUG=1` to dump the top-k.
    async fn probe_coverage(brain: &Brain<StubEmbedder>, query: &str, facts: &[&str], k: usize) -> f32 {
        let working: std::collections::HashSet<String> = brain
            .recall(&Filter::stream("talk"), ContextOptions::default().working_n)
            .await
            .expect("window")
            .iter()
            .map(|m| id_str(&m.id))
            .collect();
        let hits: Vec<Memory> = brain
            .search_traced(query, k * 2, &Filter::default())
            .await
            .expect("search")
            .into_iter()
            .filter(|s| !working.contains(&id_str(&s.memory.id)) && s.memory.stream != "self")
            .take(k)
            .map(|s| s.memory)
            .collect();
        if std::env::var("EVAL_DEBUG").is_ok() {
            eprintln!("  «{query}»");
            for (i, m) in hits.iter().enumerate() {
                let head: String = m.content.chars().take(90).collect();
                eprintln!("    {}. [{}] {head}", i + 1, m.stream);
            }
        }
        let blob = hits
            .iter()
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let found = facts.iter().filter(|f| blob.contains(**f)).count();
        found as f32 / facts.len() as f32
    }

    async fn eval_coverage(label: &str, brain: &Brain<StubEmbedder>) -> f32 {
        let mut total = 0.0;
        for (query, facts) in EVAL_PROBES {
            let cov = probe_coverage(brain, query, facts, 8).await;
            eprintln!("  [{label}] {:>3.0}%  «{query}»", cov * 100.0);
            total += cov;
        }
        total / EVAL_PROBES.len() as f32
    }

    // Scoreboard, not a fast unit test (~70s: ~30 chunk ingests + scans). Run explicitly:
    //   cargo test -p aven-brain recall_eval -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "recall eval scoreboard — run explicitly with --ignored --nocapture"]
    async fn recall_eval_chunking_beats_one_blob() {
        // Blob: the whole report as ONE memory (today's talk-ingest behaviour).
        let blob = test_brain("eval-blob").await;
        blob.remember(EVAL_REPORT).await.expect("remember blob");

        // Chunked: the report split into passage-sized memories.
        let chunked = test_brain("eval-chunked").await;
        let ids = chunked
            .remember_chunked(EVAL_REPORT, &RememberOptions::default())
            .await
            .expect("remember chunked");

        eprintln!("\n── recall eval (fact-coverage@8) ──");
        eprintln!("  chunks stored: {}", ids.len());
        let blob_cov = eval_coverage("blob   ", &blob).await;
        let chunk_cov = eval_coverage("chunked", &chunked).await;
        eprintln!(
            "  mean: blob {:.0}%  ·  chunked {:.0}%\n",
            blob_cov * 100.0,
            chunk_cov * 100.0
        );

        // Blob scores 100% trivially (one memory holds the whole report) but that DOESN'T scale —
        // in the app `assemble_context` budget-truncates the blob, so the LLM loses the scattered
        // facts. The real bar is chunked recall quality (the scoreboard we tune). With stub-embed
        // stemming we clear 0.75; downloading EmbeddingGemma (semantic) should push it higher.
        assert!(ids.len() > 1, "a 10KB report must split into several chunks");
        assert!(
            chunk_cov >= 0.75,
            "chunked fact-coverage regressed to {:.0}% — tune chunking/stemming/abstention/RRF",
            chunk_cov * 100.0
        );
    }

    /// The multi-turn case (board 0023): recall must survive a ≥6-turn conversation
    /// about doc A — every question AND reply stored as talk memories, like the app
    /// does — INCLUDING an unrelated doc B ingested in between. Asserts mean
    /// fact-coverage@8 ≥ 0.85 over the post-doc-B probe sequence AND no drop vs the
    /// pre-doc-B baseline.
    //   cargo test -p aven-brain recall_eval -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "multi-turn recall eval scoreboard — run explicitly with --ignored --nocapture"]
    async fn recall_eval_multi_turn_survives_second_doc() {
        let brain = test_brain("eval-multi-turn").await;
        // Pasted by the user (the transcript pasted both docs into Talk) → stated.
        let doc = RememberOptions {
            stream: "doc".to_string(),
            veracity: Some("stated".to_string()),
            ..Default::default()
        };
        let talk = |role: &str| RememberOptions {
            stream: "talk".to_string(),
            author_role: role.to_string(),
            veracity: Some(if role == "user" { "stated" } else { "inferred" }.to_string()),
            ..Default::default()
        };
        brain.remember_chunked(EVAL_REPORT, &doc).await.expect("ingest doc A");

        // One probe pass = the conversational ping-pong: store the question, search,
        // store a generic assistant reply (NO fact substrings — replies must not
        // inflate coverage), like the app ingests both sides of every exchange.
        async fn probe_pass(
            brain: &Brain<StubEmbedder>,
            label: &str,
            talk: &dyn Fn(&str) -> RememberOptions,
        ) -> f32 {
            let mut total = 0.0;
            for (query, facts) in MULTI_TURN_PROBES {
                brain.remember_with(query, &talk("user")).await.expect("store question");
                let cov = probe_coverage(brain, query, facts, 8).await;
                eprintln!("  [{label}] {:>3.0}%  «{query}»", cov * 100.0);
                total += cov;
                brain
                    .remember_with(
                        &format!("Dazu steht etwas im Spielbericht — ich schaue nach ({query})."),
                        &talk("agent"),
                    )
                    .await
                    .expect("store reply");
            }
            total / MULTI_TURN_PROBES.len() as f32
        }

        eprintln!("\n── multi-turn recall eval (fact-coverage@8) ──");
        let before_b = probe_pass(&brain, "before-B", &talk).await;

        // The unrelated second document lands mid-conversation.
        let b_ids = brain.remember_chunked(EVAL_DOC_B, &doc).await.expect("ingest doc B");

        let after_b = probe_pass(&brain, "after-B ", &talk).await;
        eprintln!(
            "  doc-B chunks: {} · mean: before doc B {:.0}%  ·  after doc B {:.0}%\n",
            b_ids.len(),
            before_b * 100.0,
            after_b * 100.0
        );

        assert!(b_ids.len() > 1, "doc B must split into several chunks");
        assert!(
            after_b >= 0.85,
            "post-doc-B fact-coverage@8 is {:.0}% (< 85%) — multi-turn recall regressed",
            after_b * 100.0
        );
        assert!(
            after_b + 1e-6 >= before_b,
            "second-doc ingest degraded recall: {:.0}% → {:.0}%",
            before_b * 100.0,
            after_b * 100.0
        );
    }

    #[tokio::test]
    async fn remember_then_search_returns_the_relevant_memory() {
        let brain = test_brain("test-remember-search").await;

        brain.remember("the cat sat on the mat").await.unwrap();
        brain
            .remember("rust is a systems programming language")
            .await
            .unwrap();
        let beach = brain
            .remember("we went to the beach and swam in the ocean")
            .await
            .unwrap();

        let hits = brain.search("ocean beach holiday", 1).await.unwrap();
        assert_eq!(hits.len(), 1, "expected one hit, got {hits:?}");
        assert_eq!(hits[0].id, beach);
        assert!(hits[0].content.contains("beach"));
    }

    #[tokio::test]
    async fn remember_is_idempotent_on_identical_content() {
        let brain = test_brain("test-idempotent").await;
        let first = brain.remember("the same exact memory").await.unwrap();
        let second = brain.remember("the same exact memory").await.unwrap();
        assert_eq!(first, second);
        let hits = brain.search("the same exact memory", 10).await.unwrap();
        assert_eq!(hits.len(), 1, "identical content must dedup, got {hits:?}");
    }

    #[tokio::test]
    async fn filtered_search_scopes_by_stream() {
        let brain = test_brain("test-filtered").await;
        let work = brain
            .remember_with(
                "quarterly revenue planning meeting",
                &RememberOptions {
                    stream: "work".to_string(),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        brain
            .remember_with(
                "planning the family holiday trip",
                &RememberOptions {
                    stream: "personal".to_string(),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let hits = brain
            .search_filtered("planning", 5, &Filter::stream("work"))
            .await
            .unwrap();
        assert_eq!(hits.len(), 1, "stream filter should yield only work, got {hits:?}");
        assert_eq!(hits[0].id, work);
        assert_eq!(hits[0].stream, "work");
    }

    #[tokio::test]
    async fn search_traced_carries_via_rank_and_score() {
        let brain = test_brain("test-traced").await;
        brain.remember("the beach was sunny and warm").await.unwrap();
        brain.remember("compilers transform source code").await.unwrap();

        let hits = brain
            .search_traced("sunny beach", 5, &Filter::default())
            .await
            .unwrap();
        assert!(!hits.is_empty());
        assert_eq!(hits[0].rank, 1);
        assert!(hits[0].score > 0.0);
        // The matching memory should be found by BOTH retrievers (stub embeds + lexical).
        assert_eq!(hits[0].via, Via::Both, "via: {:?}", hits[0].via);
    }

    #[tokio::test]
    async fn abstention_floor_returns_empty_over_noise() {
        let brain = test_brain("test-abstain").await;
        brain.remember("grocery list: oat milk and bread").await.unwrap();
        brain.remember("meeting notes from standup").await.unwrap();

        // No lexical overlap at all with any stored memory.
        let hits = brain
            .search("purple bicycle quantum zeppelin", 5)
            .await
            .unwrap();
        assert!(hits.is_empty(), "nonsense queries must return nothing, got {hits:?}");
    }

    #[tokio::test]
    async fn wikilinks_build_entities_mentions_and_bonds() {
        let brain = test_brain("test-kg").await;

        brain
            .remember("[[Alice]] met [[Bob]] at [[Acme]] today")
            .await
            .unwrap();

        // three deduped entities
        let entities = brain.entities().await.unwrap();
        assert_eq!(entities.len(), 3, "expected 3 entities, got {entities:?}");

        // each co-mentioned pair has a bond seeded at strength 1.0
        let r = brain.relation("Alice", "Bob").await.unwrap().expect("Alice↔Bob bond");
        assert!((r.strength - 1.0).abs() < 1e-6, "seed strength 1.0, got {}", r.strength);
        assert_eq!(r.access_count, 1);
        assert!(brain.relation("Alice", "Acme").await.unwrap().is_some());
        assert!(brain.relation("Bob", "Acme").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn co_mention_potentiates_bond_and_dedups_entities() {
        let brain = test_brain("test-potentiate").await;

        brain.remember("[[Alice]] and [[Bob]] kicked off the project").await.unwrap();
        brain.remember("[[Alice]] reviewed [[Bob]]'s pull request").await.unwrap();

        assert_eq!(brain.entities().await.unwrap().len(), 2);

        let r = brain.relation("Alice", "Bob").await.unwrap().expect("bond");
        assert_eq!(r.access_count, 2, "two co-mentions");
        assert!(
            r.strength > 1.0,
            "co-mention should potentiate strength above the seed, got {}",
            r.strength
        );
    }

    #[tokio::test]
    async fn auto_extraction_needs_no_wikilinks() {
        let brain = test_brain("test-auto-extract").await;
        brain
            .remember("btw I met Sarah yesterday, Sarah works at Lumen Labs now")
            .await
            .unwrap();

        let entities = brain.entities().await.unwrap();
        let names: Vec<&str> = entities.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"Sarah"), "auto entities: {names:?}");
        assert!(names.contains(&"Lumen Labs"), "multi-word run: {names:?}");
        assert!(!names.contains(&"I"), "capitalized stopword excluded: {names:?}");

        // SPO template produced a humble claim with evidence.
        let facts = brain.facts("Sarah").await.unwrap();
        let f = facts.iter().find(|f| f.predicate == "works_at").expect("works_at claim");
        assert_eq!(f.object_name, "Lumen Labs");
        assert!((f.confidence - 0.6).abs() < 1e-9, "auto claims are humble");
    }

    #[tokio::test]
    async fn typo_variants_fuzzy_merge_into_one_entity() {
        let brain = test_brain("test-fuzzy").await;
        brain.remember("met Sarah at the market").await.unwrap();
        brain.remember("talked to Sarha again about the plan").await.unwrap();

        let entities = brain.entities().await.unwrap();
        let sarahs: Vec<&str> = entities
            .iter()
            .map(|e| e.name.as_str())
            .filter(|n| levenshtein_sim(&n.to_lowercase(), "sarah") >= 0.8)
            .collect();
        assert_eq!(sarahs.len(), 1, "typo must merge, got {entities:?}");
        assert_eq!(brain.memories_about(sarahs[0]).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn sentence_start_single_caps_are_not_entities() {
        let brain = test_brain("test-sentence-start").await;
        brain.remember("Tomorrow we ship. Maybe later we rest").await.unwrap();
        let entities = brain.entities().await.unwrap();
        assert!(entities.is_empty(), "no entities expected, got {entities:?}");
    }

    #[tokio::test]
    async fn note_links_are_idempotent() {
        let brain = test_brain("test-note-idem").await;
        let mid = brain.remember("[[Alice]] waved").await.unwrap();
        let eid = brain.entities().await.unwrap()[0].id;

        // Re-inserting the same mention is a no-op.
        brain.ensure_mention(mid, eid).await.unwrap();
        brain.ensure_mention(mid, eid).await.unwrap();
        let mems = brain.memories_about("Alice").await.unwrap();
        assert_eq!(mems.len(), 1, "duplicate mentions must collapse, got {mems:?}");
    }

    #[tokio::test]
    async fn claims_close_on_reassertion_and_never_delete() {
        let brain = test_brain("test-claims").await;
        brain
            .add_fact("Alice", "works_at", "Acme", None)
            .await
            .unwrap();
        brain
            .add_fact("Alice", "works_at", "Globex", None)
            .await
            .unwrap();

        let facts = brain.facts("Alice").await.unwrap();
        assert_eq!(facts.len(), 2, "both claims survive: {facts:?}");
        let acme = facts.iter().find(|f| f.object_name == "Acme").unwrap();
        let globex = facts.iter().find(|f| f.object_name == "Globex").unwrap();
        assert!(acme.valid_to_ms.is_some(), "old claim must be closed");
        assert!(globex.valid_to_ms.is_none(), "new claim must be open");
    }

    #[tokio::test]
    async fn claim_predicates_must_not_collide_with_reserved_kinds() {
        let brain = test_brain("test-registry").await;
        let err = brain.add_fact("Alice", "mentions", "Bob", None).await;
        assert!(
            matches!(err, Err(BrainError::Registry(_))),
            "reserved kind must be refused, got {err:?}"
        );
    }

    #[tokio::test]
    async fn wake_includes_self_and_recent_memories() {
        let brain = test_brain("test-wake").await;
        brain.set_self("I am Atlas, Alice's assistant.").await.unwrap();
        brain.remember("bought oat milk at the store").await.unwrap();
        brain.remember("finished the quarterly report").await.unwrap();

        let ctx = brain.wake(5).await.unwrap();
        assert!(ctx.contains("Atlas"), "wake should include the self block:\n{ctx}");
        assert!(
            ctx.contains("oat milk") && ctx.contains("quarterly report"),
            "wake should include recent memories:\n{ctx}"
        );
        assert_eq!(
            ctx.matches("Atlas").count(),
            1,
            "self must appear once (in the Self block), not duplicated in the gist:\n{ctx}"
        );
    }

    #[tokio::test]
    async fn entity_card_shows_bonds_and_timeline() {
        let brain = test_brain("test-card").await;
        brain.remember("[[Alice]] and [[Bob]] launched [[Acme]]").await.unwrap();
        brain.remember("[[Alice]] emailed [[Bob]] about the roadmap").await.unwrap();

        let card = brain.entity_card("Alice").await.unwrap().expect("Alice card");
        assert_eq!(card.name, "Alice");

        let names: Vec<&str> = card.bonds.iter().map(|(n, _)| n.as_str()).collect();
        assert!(names.contains(&"Bob") && names.contains(&"Acme"), "bonds: {names:?}");

        assert_eq!(card.bonds.first().map(|(n, _)| n.as_str()), Some("Bob"));
        let bob = card.bonds.iter().find(|(n, _)| n == "Bob").unwrap().1;
        let acme = card.bonds.iter().find(|(n, _)| n == "Acme").unwrap().1;
        assert!(bob >= acme, "Bob ({bob}) should be at least as strong as Acme ({acme})");

        assert_eq!(card.recent_memories.len(), 2, "timeline: {:?}", card.recent_memories);
        assert!(card.render().contains("Bob"));
    }

    /// Board 0025 (THE GATE): the four tool-backing primitives behind the agentic
    /// memory surface — importance ranks, forget removes, attest strengthens, an
    /// explicit link traverses.
    #[tokio::test]
    async fn memory_tools_importance_forget_attest_link() {
        let brain = test_brain("test-memory-tools").await;

        // (a) Higher importance ranks a memory above a lower one for the same query.
        let minor = brain
            .remember_with(
                "team meeting notes version one",
                &RememberOptions {
                    importance: 0.1,
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let major = brain
            .remember_with(
                "team meeting notes version two",
                &RememberOptions {
                    importance: 0.9,
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let hits = brain.search("team meeting notes", 2).await.unwrap();
        eprintln!(
            "(a) importance ordering: [{}]",
            hits.iter()
                .map(|m| format!("{} (importance {})", m.content, m.importance))
                .collect::<Vec<_>>()
                .join(" · ")
        );
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].id, major, "importance 0.9 must outrank 0.1: {hits:?}");
        assert_eq!(hits[1].id, minor);

        // (b) forget drops a memory from search AND recall — soft, nothing deleted.
        let secret = brain
            .remember("the secret picnic spot is by the old mill")
            .await
            .unwrap();
        assert_eq!(brain.search("secret picnic spot", 3).await.unwrap().len(), 1);
        brain.forget(secret).await.unwrap();
        let after = brain.search("secret picnic spot", 3).await.unwrap();
        eprintln!("(b) forget: {} hits after forgetting (was 1)", after.len());
        assert!(after.is_empty(), "forgotten memory must leave recall: {after:?}");
        assert!(
            !brain
                .recall(&Filter::default(), usize::MAX)
                .await
                .unwrap()
                .iter()
                .any(|m| m.id == secret),
            "forgotten memory must leave plain recall too"
        );

        // (c) attest steps veracity toward `stated` — the weight strictly rises.
        let humble = brain
            .remember_with(
                "the printer is on the third floor",
                &RememberOptions {
                    veracity: Some("tool".to_string()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let mut prev = veracity_weight(Some("tool"));
        let mut tiers = vec!["tool".to_string()];
        for _ in 0..3 {
            let next = brain.attest(humble).await.unwrap();
            let w = veracity_weight(Some(&next));
            assert!(w > prev, "attest must raise the veracity weight ({tiers:?} → {next})");
            prev = w;
            tiers.push(next);
        }
        eprintln!("(c) attest ladder: {} (weight {:.1} → {:.1})", tiers.join(" → "), 0.5, prev);
        assert_eq!(tiers.last().map(String::as_str), Some("stated"));
        assert_eq!(brain.attest(humble).await.unwrap(), "stated", "stated is the ceiling");

        // (d) an explicit link is traversable, both directions.
        let a = brain.remember("booked the cabin for the offsite").await.unwrap();
        let b = brain.remember("the offsite agenda lives in the shared doc").await.unwrap();
        brain.link(a, b).await.unwrap();
        let from_a = brain.linked(a).await.unwrap();
        let from_b = brain.linked(b).await.unwrap();
        eprintln!(
            "(d) link traversal: a→[{}] · b→[{}]",
            from_a.iter().map(|m| m.content.as_str()).collect::<Vec<_>>().join(", "),
            from_b.iter().map(|m| m.content.as_str()).collect::<Vec<_>>().join(", ")
        );
        assert!(from_a.iter().any(|m| m.id == b), "a → b traversable");
        assert!(from_b.iter().any(|m| m.id == a), "b → a traversable (either direction)");
        // Idempotent re-link (note class).
        brain.link(a, b).await.unwrap();
        assert_eq!(brain.linked(a).await.unwrap().len(), 1);
    }

    /// Board 0025: the graph+fact recall voice — a query naming an entity surfaces a
    /// linked memory the lexical/vector voices miss (the write-time fuzzy merge knows
    /// "Sarha" IS Sarah; only the graph can see that).
    #[tokio::test]
    async fn memory_tools_graph_voice_surfaces_linked_memory() {
        let brain = test_brain("test-graph-voice").await;
        brain.remember("met Sarah at the market").await.unwrap();
        // The typo'd memory: fuzzy entity upsert merges "Sarha" into the Sarah entity
        // at write time — its CONTENT never contains "sarah".
        let typod = brain.remember("talked to Sarha again about the plan").await.unwrap();

        let hits = brain.search("what is the plan with Sarah", 5).await.unwrap();
        eprintln!(
            "graph voice hits: [{}]",
            hits.iter().map(|m| m.content.as_str()).collect::<Vec<_>>().join(" · ")
        );
        assert!(
            hits.iter().any(|m| m.id == typod),
            "the graph voice must surface the typo'd memory the lexical floor drops: {hits:?}"
        );
    }

    /// Board 0024 (THE GATE): a dream pass with a configured extractor writes the
    /// returned `ExtractedFact`s to the graph as queryable claim rows — and never
    /// re-extracts a memory.
    #[tokio::test]
    async fn extractor_mock_dream_writes_queryable_facts() {
        use crate::extractor::MockExtractor;
        let brain = test_brain("test-extractor").await.with_extractor(MockExtractor::new(vec![
            ("Yaya Sithole", "received", "red card"),
            ("Julian Quinones", "scored", "goal at 9'"),
        ]));
        let memory = brain
            .remember("Tooooor! MEXIKO - Südafrika 1:0. Julian Quinones übernimmt und schießt ins Tor.")
            .await
            .unwrap();

        let report = brain.dream().await.unwrap();
        assert_eq!(report.facts_extracted, 2, "both mock facts written: {report:?}");

        // The facts landed queryable: subject entity → predicate → object.
        eprintln!("facts read back from the graph after the mock-extractor dream:");
        for subject in ["Yaya Sithole", "Julian Quinones"] {
            for f in brain.facts(subject).await.unwrap() {
                eprintln!("  {subject} —{}→ {} (confidence {})", f.predicate, f.object_name, f.confidence);
            }
        }
        let sithole = brain.facts("Yaya Sithole").await.unwrap();
        let red = sithole.iter().find(|f| f.predicate == "received").expect("received claim");
        assert_eq!(red.object_name, "red card");
        assert!(red.valid_to_ms.is_none(), "freshly mined claim is open");
        // f32→f64 widening: 0.9f32 lands at ~0.89999998.
        assert!((red.confidence - 0.9).abs() < 1e-6, "extractor confidence carried");
        let quinones = brain.facts("Julian Quinones").await.unwrap();
        let goal = quinones.iter().find(|f| f.predicate == "scored").expect("scored claim");
        assert_eq!(goal.object_name, "goal at 9'");

        // Provenance: the claim cites the memory it was mined from.
        let links = brain.links().await.unwrap();
        assert!(
            links.iter().any(|l| l.kind == "received" && l.class == "claim"),
            "claim link row exists"
        );
        assert!(
            links.iter().any(|l| l.kind == EXTRACTED_KIND && l.from == id_str(&memory)),
            "mined memory carries the extracted marker"
        );

        // Idempotence: a second dream finds nothing new to extract and changes nothing.
        let again = brain.dream().await.unwrap();
        assert_eq!(again.facts_extracted, 0, "already-extracted memories must not re-extract");
        assert_eq!(brain.facts("Yaya Sithole").await.unwrap().len(), sithole.len());
    }

    /// Board 0024: the stepped dream emits the `extract` phase with REAL tokens (the
    /// panel's per-step cost), and every phase of the pass appears in the step log —
    /// the Dreaming tab is a complete receipt.
    #[tokio::test]
    async fn extractor_stepped_dream_emits_extract_phase_with_tokens() {
        use crate::extractor::MockExtractor;
        let brain = test_brain("test-extractor-step")
            .await
            .with_extractor(MockExtractor::new(vec![("Sarah", "works_at", "Lumen Labs")]));
        brain.remember("met Sarah at the Lumen Labs office").await.unwrap();

        let mut phases: Vec<String> = Vec::new();
        let mut extract_tokens = 0i64;
        let mut cursor = 0i64;
        for _ in 0..64 {
            let step = brain.dream_step(cursor, now_ms()).await.unwrap();
            if step.phase == "extract" {
                extract_tokens += step.tokens;
            }
            phases.push(step.phase.clone());
            if step.done {
                break;
            }
            cursor = step.next_cursor;
        }
        for phase in ["enrich", "extract", "merge", "decay", "verify", "consolidate", "done"] {
            assert!(phases.contains(&phase.to_string()), "phase `{phase}` logged: {phases:?}");
        }
        assert!(extract_tokens > 0, "the extract step surfaces real tokens: {phases:?}");
    }

    #[tokio::test]
    async fn dream_decays_bonds_and_merges_duplicate_entities() {
        let brain = test_brain("test-dream").await;
        brain.remember("[[Alice]] and [[Bob]] shipped the release").await.unwrap();
        brain.remember("[[alice]] thanked [[Bob]] afterwards").await.unwrap();

        // Fuzzy upsert merges the case variant AT WRITE TIME now (rung 0 typo coverage);
        // dreaming's merge pass remains the healer for sync-created duplicates.
        assert_eq!(brain.entities().await.unwrap().len(), 2);

        let future = now_ms() + 10 * MS_PER_DAY;
        let report = brain.dream_at(future).await.unwrap();
        assert!(report.bonds_decayed >= 1, "the bond should decay");

        let entities = brain.entities().await.unwrap();
        assert_eq!(entities.len(), 2, "merged to Alice + Bob, got {entities:?}");

        let survivor = entities
            .into_iter()
            .find(|e| normalize_name(&e.name) == "alice")
            .expect("survivor");
        let r = brain
            .relation(&survivor.name, "Bob")
            .await
            .unwrap()
            .expect("survivor↔Bob bond");
        assert!(r.strength < 1.0, "10 days decay should drop below the seed, got {}", r.strength);
        assert!(
            r.strength >= STRENGTH_FLOOR - 1e-9,
            "decay is floored at {STRENGTH_FLOOR}, got {}",
            r.strength
        );
    }

    #[tokio::test]
    async fn owners_are_isolated_in_one_store() {
        let store_owner = owner();
        let brain_a = Brain::open_in_memory("test-owners", store_owner, StubEmbedder::new(EMBED_DIM))
            .await
            .unwrap();
        brain_a.remember("alpha's secret plan").await.unwrap();

        // A second brain over the SAME app dir name would be a separate in-memory store,
        // so simulate the shared store by re-wrapping the same client via search with a
        // different owner: easiest honest check — a different owner sees nothing.
        let other_owner = owner();
        let other = Brain::over(
            Arc::clone(&brain_a.client),
            other_owner,
            StubEmbedder::new(EMBED_DIM),
            Arc::new(KeySealer::random(*other_owner.uuid())),
        );
        let hits = other.search("alpha's secret plan", 5).await.unwrap();
        assert!(hits.is_empty(), "other owner must not see alpha's memories, got {hits:?}");
        assert!(other.entities().await.unwrap().is_empty());

        let own_hits = brain_a.search("alpha's secret plan", 5).await.unwrap();
        assert_eq!(own_hits.len(), 1);
    }

    #[tokio::test]
    async fn assemble_context_pins_l0_l1_and_respects_budget() {
        let brain = test_brain("test-assemble").await;
        brain.set_self("I am Atlas, the household aven.").await.unwrap();
        for i in 0..6 {
            brain
                .remember_with(
                    &format!("talk turn number {i} about the garden project"),
                    &RememberOptions {
                        stream: "talk".to_string(),
                        author_role: if i % 2 == 0 { "user" } else { "agent" }.to_string(),
                        ..Default::default()
                    },
                )
                .await
                .unwrap();
        }
        brain
            .remember("the garden gnome collection survey results")
            .await
            .unwrap();

        let bundle = brain
            .assemble_context(
                "what about the garden",
                &ContextOptions {
                    working_n: 4,
                    recall_k: 3,
                    filter: Filter::stream("talk"),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        assert!(bundle.prompt.contains("Atlas"), "L0 pinned:\n{}", bundle.prompt);
        assert!(bundle.prompt.contains("# Conversation"));
        assert_eq!(bundle.trace.working.len(), 4, "working window honored");
        assert!(bundle.trace.budget.used_chars <= bundle.trace.budget.max_chars);
        assert_eq!(bundle.trace.embedder, "stub");

        // A tiny budget drops content and reports it.
        let tiny = brain
            .assemble_context(
                "what about the garden",
                &ContextOptions {
                    working_n: 4,
                    recall_k: 3,
                    budget_chars: 220,
                    filter: Filter::stream("talk"),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert!(
            tiny.trace.budget.dropped_working + tiny.trace.budget.dropped_recalled > 0,
            "tiny budget must drop something: {:?}",
            tiny.trace.budget
        );
    }

    /// Board 0023: the trace is a 100%-faithful receipt — every block of the assembled
    /// prompt is accounted for in the `ContextTrace`, and the drop counters account for
    /// everything excluded, so the aside can render exactly what the LLM saw.
    #[tokio::test]
    async fn trace_parity_every_prompt_block_is_receipted() {
        let brain = test_brain("test-trace-parity").await;
        brain.set_self("I am Atlas, the household aven.").await.unwrap();
        brain.remember("[[Gnomes]] live in the [[Garden]]").await.unwrap();
        brain
            .remember("the garden gnome census counted 42 gnomes this spring")
            .await
            .unwrap();
        const TURNS: usize = 5;
        for i in 0..TURNS {
            brain
                .remember_with(
                    &format!("talk turn {i} about the garden gnome census"),
                    &RememberOptions {
                        stream: "talk".to_string(),
                        author_role: if i % 2 == 0 { "user" } else { "agent" }.to_string(),
                        ..Default::default()
                    },
                )
                .await
                .unwrap();
        }

        let opts = ContextOptions {
            filter: Filter::stream("talk"),
            ..Default::default()
        };
        let query = "how many gnomes did the garden census count";
        let bundle = brain.assemble_context(query, &opts).await.unwrap();
        let (prompt, t) = (&bundle.prompt, &bundle.trace);
        let sans_ellipsis = |s: &str| s.strip_suffix('…').unwrap_or(s).to_string();

        // Trace → prompt: every receipted item appears in the prompt verbatim.
        assert!(prompt.starts_with("# Self\n"), "prompt:\n{prompt}");
        assert!(prompt.contains(&t.l0_self), "L0 in prompt");
        for g in &t.l1_gist {
            assert!(prompt.contains(&format!("- {g}")), "gist line `{g}` in prompt");
        }
        for w in &t.working {
            assert!(
                prompt.contains(&format!("{}: {}", w.author_role, sans_ellipsis(&w.snippet))),
                "working `{}` in prompt",
                w.snippet
            );
        }
        for r in &t.recalled {
            assert!(
                prompt.contains(&format!("- {}", sans_ellipsis(&r.snippet))),
                "recalled `{}` in prompt",
                r.snippet
            );
        }
        for e in &t.entities {
            assert!(prompt.contains(&format!("# {} (", e.name)), "entity card `{}`", e.name);
        }

        // Prompt → trace: every section/line of the prompt is receipted — counts match.
        let lines_under = |header: &str| -> Vec<&str> {
            let Some(start) = prompt.find(header) else { return Vec::new() };
            prompt[start + header.len()..]
                .lines()
                .take_while(|l| !l.starts_with("# ") && !l.starts_with("\n# "))
                .filter(|l| !l.trim().is_empty())
                .collect()
        };
        assert_eq!(lines_under("# Story so far\n").len(), t.l1_gist.len(), "gist parity");
        assert_eq!(lines_under("# Conversation\n").len(), t.working.len(), "working parity");
        assert_eq!(
            lines_under("# Relevant memories\n").len(),
            t.recalled.len(),
            "recall parity"
        );
        // Every section header is one of the receipted blocks (no unreceipted section).
        for header in prompt.lines().filter(|l| l.starts_with("# ")) {
            let known = ["# Self", "# Story so far", "# Conversation", "# Relevant memories"]
                .contains(&header)
                || t.entities.iter().any(|e| header.starts_with(&format!("# {} (", e.name)));
            assert!(known, "unreceipted prompt section: {header}");
        }
        assert_eq!(t.budget.used_chars, prompt.chars().count(), "budget used == prompt length");

        // Drop accounting: the window fetched all TURNS talk rows — kept + dropped
        // must cover them, and the recall counter must cover the recall fetch.
        let working_ids: std::collections::HashSet<String> =
            t.working.iter().map(|w| w.id.clone()).collect();
        let fetched_recall = brain
            .search_traced(query, opts.recall_k * 2, &Filter::default())
            .await
            .unwrap()
            .into_iter()
            .filter(|s| !working_ids.contains(&id_str(&s.memory.id)) && s.memory.stream != "self")
            .take(opts.recall_k)
            .count();
        assert_eq!(t.working.len() + t.budget.dropped_working, TURNS, "working drops");
        assert_eq!(t.recalled.len() + t.budget.dropped_recalled, fetched_recall, "recall drops");

        // Under a tiny budget the same parity holds: exclusions land in the counters.
        let tiny = brain
            .assemble_context(
                query,
                &ContextOptions {
                    budget_chars: 500,
                    filter: Filter::stream("talk"),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            tiny.trace.working.len() + tiny.trace.budget.dropped_working,
            TURNS,
            "tiny-budget working drops: {:?}",
            tiny.trace.budget
        );
        assert_eq!(tiny.trace.budget.used_chars, tiny.prompt.chars().count());
    }

    /// Board 0023: a thin follow-up ("schau nochmal") carries no recallable tokens of
    /// its own — the brain enriches the inner query from the working window, so
    /// continuity lives in the brain, not in an app-side thread.
    #[tokio::test]
    async fn assemble_context_enriches_thin_query_from_working_window() {
        let brain = test_brain("test-enrich-query").await;
        brain
            .remember("the beach trip photos are saved in the shared album")
            .await
            .unwrap();
        let talk = |role: &str| RememberOptions {
            stream: "talk".to_string(),
            author_role: role.to_string(),
            ..Default::default()
        };
        brain
            .remember_with("did we save the beach trip photos somewhere", &talk("user"))
            .await
            .unwrap();
        brain.remember_with("let me look that up", &talk("agent")).await.unwrap();

        let bundle = brain
            .assemble_context(
                "schau nochmal nach",
                &ContextOptions {
                    filter: Filter::stream("talk"),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        // The receipt shows the enriched inner query…
        assert!(
            bundle.trace.query.contains("beach"),
            "inner query should be window-enriched, got: {}",
            bundle.trace.query
        );
        // …and recall surfaces the memory the bare follow-up would have missed.
        assert!(
            bundle.trace.recalled.iter().any(|r| r.snippet.contains("album")),
            "enriched recall should surface the album memory: {:?}",
            bundle.trace.recalled
        );
    }

    /// MMR re-rank: a stored verbatim echo of the user's own question (talk turns are
    /// memories) must not outrank the content that answers it.
    #[tokio::test]
    async fn mmr_demotes_stored_query_echo_below_content() {
        let brain = test_brain("test-mmr-echo").await;
        let query = "wer hat die rote karte bekommen";
        brain
            .remember_with(
                query,
                &RememberOptions {
                    stream: "talk".to_string(),
                    veracity: Some("stated".to_string()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let content = brain
            .remember_with(
                "In Minute 49 hat Sithole die rote Karte bekommen nach einer Notbremse",
                &RememberOptions {
                    veracity: Some("stated".to_string()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        let hits = brain.search(query, 2).await.unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(
            hits[0].id, content,
            "the echo of the question must not outrank the content: {hits:?}"
        );
    }

    #[tokio::test]
    async fn context_trace_serializes_to_camel_case_json() {
        let brain = test_brain("test-trace-json").await;
        brain.remember("hello world from the trace test").await.unwrap();
        let bundle = brain
            .assemble_context("hello world trace", &ContextOptions::default())
            .await
            .unwrap();
        let json = serde_json::to_string(&bundle.trace).unwrap();
        assert!(json.contains("\"l0Self\""), "camelCase keys: {json}");
        assert!(json.contains("\"assembledAtMs\""));
        assert!(json.contains("\"usedChars\""));
    }

    // ── Board 0021: sealed-at-rest proofs ────────────────────────────────────

    /// THE privacy law test: write through a sealed brain, then re-read the RAW
    /// stored rows (no sealer, no unseal hook) across all three tables — none of
    /// the plaintext (content words, entity names, link kinds, graph endpoints)
    /// may appear anywhere, and no cell may hold a plaintext Vector.
    #[tokio::test]
    async fn no_plaintext_at_rest() {
        let brain = test_brain("test-sealed-at-rest").await;
        let mid = brain
            .remember("the zebra migration spreadsheet [[Kornelia]] works at Glimmerwerk")
            .await
            .unwrap();

        let mut all_cells: Vec<(String, Value)> = Vec::new();
        for table in [MEMORIES, ENTITIES, LINKS] {
            let rows = brain
                .client
                .query(QueryBuilder::new(table).build(), None)
                .await
                .unwrap();
            assert!(!rows.is_empty(), "{table} must have rows");
            for (_, vals) in rows {
                for v in vals {
                    all_cells.push((table.to_string(), v));
                }
            }
        }

        // Plaintext that must NOT be on disk: content words, entity names, link
        // kinds/classes, and graph endpoints (the memory row id appears in links).
        let secrets = [
            "zebra",
            "migration",
            "spreadsheet",
            "Kornelia",
            "Glimmerwerk",
            "mentions",
            "assoc",
            "works_at",
            "note",
            "bond",
            "claim",
            &id_str(&mid),
        ];
        for (table, cell) in &all_cells {
            assert!(
                !matches!(cell, Value::Vector(_)),
                "{table}: no plaintext Vector may hit storage, got {cell:?}"
            );
            if let Value::Text(s) = cell {
                for secret in secrets {
                    assert!(
                        !s.contains(secret),
                        "{table}: plaintext `{secret}` leaked to storage in {s:?}"
                    );
                }
            }
        }

        // And yet the brain itself reads everything back fine (unseal in RAM).
        let hits = brain.search("zebra migration", 1).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].content.contains("zebra"));
        let names: Vec<String> = brain
            .entities()
            .await
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert!(names.iter().any(|n| n == "Kornelia"), "entities: {names:?}");
    }

    /// The dedup key is a KEYED MAC: idempotent within one brain, and two brains
    /// (different keys) produce different MACs for identical content — disk and
    /// relay learn nothing about content equality across SAFEs.
    #[tokio::test]
    async fn hmac_dedup_idempotent() {
        let brain = test_brain("test-hmac-dedup").await;
        let a = brain.remember("hmac dedup probe content").await.unwrap();
        let b = brain.remember("hmac dedup probe content").await.unwrap();
        assert_eq!(a, b, "identical content must dedup to one row");

        let mac_of = |brain: &Brain<StubEmbedder>| brain.sealer.dedup_mac("hmac dedup probe content");
        let mac_a = mac_of(&brain);
        assert_eq!(mac_a.len(), 32, "32-byte PRF output");

        let other = test_brain("test-hmac-dedup-other").await;
        let mac_b = mac_of(&other);
        assert_ne!(
            mac_a, mac_b,
            "different keys must produce different MACs for the same content"
        );
    }
}

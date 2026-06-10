//! The [`Brain`] handle over an aven-db [`AvenDbClient`] for **one SAFE** (owner-scoped),
//! on the three-table model: `memories` · `entities` · `links`.
//!
//! - `remember` stores evidence (verbatim content + embedding + artifact columns) and,
//!   from `[[wikilink]]` references, deterministically upserts **entities**, records
//!   **mention** links (note class) and potentiates **assoc** links (bond class) for
//!   every co-mentioned pair. No LLM touches the write path, so the graph is
//!   reproducible across devices (clean CRDT merges). Idempotent by `content_hash`.
//! - `search` runs both engine retrievers (`nearest` cosine + `text_search` BM25),
//!   fuses with **RRF (k=60)**, then applies the read modifiers: veracity weight ×
//!   age weight, and the **abstention floor** (return nothing over noise).
//!   [`Brain::search_traced`] surfaces per-hit `via`/rank/score for RecallTrace.
//! - `add_fact` writes **claim** links (temporal single-truth: a new assertion for the
//!   same (subject, predicate) closes the old row's `valid_to`; nothing is deleted).
//! - The link **kind→class registry** (law 6) is enforced at write: note kinds are
//!   append-only/idempotent, claim kinds are free predicates, `assoc` is the bond kind.
//! - No `created_at` columns: row ids are UUIDv7 — creation time is decoded from the id.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use aven_db::{AppContext, AppId, AvenDbClient, NullSyncTransport, ObjectId, QueryBuilder, Value};
use serde::Serialize;

use crate::embedder::Embedder;
use crate::schema::{brain_schema, ENTITIES, LINKS, MEMORIES};

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
const NOTE_KINDS: [&str; 3] = ["mentions", "summarizes", "refers_to"];
/// The bond kind.
const BOND_KIND: &str = "assoc";

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
}

/// How a search hit was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Via {
    Vector,
    Bm25,
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
        Self {
            working_n: 8,
            recall_k: 6,
            entity_cards: 2,
            gist_n: 5,
            budget_chars: 8_000,
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
fn abstention_floor(query_tokens: usize) -> f32 {
    match query_tokens {
        0..=2 => 0.15,
        3 => 0.5,
        _ => 0.3,
    }
}

/// The memory brain of one SAFE (owner-scoped over the shared store).
pub struct Brain<E: Embedder> {
    client: Arc<AvenDbClient>,
    embedder: E,
    owner: ObjectId,
}

impl<E: Embedder> Brain<E> {
    /// Open an ephemeral, in-memory brain for `owner` (tests / dev). Nothing persists.
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
        Ok(Self::over(Arc::new(client), owner, embedder))
    }

    /// Wrap an existing client (the app's shared store) as `owner`'s brain.
    pub fn over(client: Arc<AvenDbClient>, owner: ObjectId, embedder: E) -> Self {
        Self {
            client,
            embedder,
            owner,
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

    /// Store a memory (verbatim content + embedding + artifact columns) and build the
    /// graph from its `[[wikilink]]` references. **Idempotent**: identical content
    /// returns the existing memory id without re-writing.
    pub async fn remember_with(
        &self,
        content: &str,
        opts: &RememberOptions,
    ) -> Result<ObjectId, BrainError> {
        let hash = content_hash(content);
        if let Some(existing) = self.find_by_content_hash(&hash).await? {
            return Ok(existing);
        }

        let embedding = self.embedder.embed(content).await;
        // Column order per `schema.rs`: owner, content, embedding, stream, author_role,
        // source, seq, line_start, line_end, content_date, content_hash, source_version,
        // normalize_version, veracity, superseded_by.
        let values = vec![
            Value::Uuid(self.owner),
            Value::Text(content.to_string()),
            Value::Vector(embedding),
            Value::Text(opts.stream.clone()),
            Value::Text(opts.author_role.clone()),
            opt_text(opts.source.clone()),
            opt_int(opts.seq),
            opt_int(opts.line_start),
            opt_int(opts.line_end),
            opt_text(opts.content_date_ms.map(|ms| ms.to_string())),
            Value::Bytea(hash.to_vec()),
            Value::Null,
            Value::Integer(1),
            opt_text(opts.veracity.clone()),
            Value::Null, // superseded_by
        ];
        let memory_id = self
            .client
            .create(MEMORIES, values)
            .await
            .map_err(|e| BrainError::Write(format!("{e:?}")))?;

        // Deterministic graph build from wikilinks (zero LLM).
        self.write_graph(memory_id, content).await?;

        Ok(memory_id)
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
    pub async fn search_traced(
        &self,
        query: &str,
        k: usize,
        filter: &Filter,
    ) -> Result<Vec<ScoredMemory>, BrainError> {
        let over = (k * 4).max(8);
        let qvec = self.embedder.embed(query).await;

        let vector_rows = self
            .client
            .query(
                self.memory_query(filter)
                    .nearest("embedding", qvec, over)
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;

        let text_rows = self
            .client
            .query(
                self.memory_query(filter)
                    .text_search("content", query, over)
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;

        // RRF fuse with via tracking.
        use std::collections::HashMap;
        let mut score: HashMap<ObjectId, f32> = HashMap::new();
        let mut via: HashMap<ObjectId, Via> = HashMap::new();
        let mut mem: HashMap<ObjectId, Memory> = HashMap::new();
        for (list, list_via) in [(&vector_rows, Via::Vector), (&text_rows, Via::Bm25)] {
            for (rank, (id, vals)) in list.iter().enumerate() {
                *score.entry(*id).or_insert(0.0) += 1.0 / (RRF_K + rank as f32 + 1.0);
                via.entry(*id)
                    .and_modify(|v| {
                        if *v != list_via {
                            *v = Via::Both;
                        }
                    })
                    .or_insert(list_via);
                mem.entry(*id).or_insert_with(|| memory_from_row(*id, vals));
            }
        }

        // Read modifiers: veracity weight × age weight (age from the UUIDv7 row id).
        let now = now_ms();
        for (id, s) in score.iter_mut() {
            let m = &mem[id];
            let age = now.saturating_sub(created_ms(id));
            *s *= veracity_weight(m.veracity.as_deref()) * age_weight(age);
        }

        // Abstention floor: drop hits below the minimum lexical overlap with the query.
        let qtokens = content_tokens(query);
        let floor = abstention_floor(qtokens.len());
        let mut ranked: Vec<(ObjectId, f32)> = score
            .into_iter()
            .filter(|(id, _)| {
                if qtokens.is_empty() {
                    return true;
                }
                lexical_overlap(&qtokens, &mem[id].content) >= floor
            })
            .collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        ranked.truncate(k);

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
        let rows = self
            .client
            .query(self.memory_query(filter).build(), None)
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        let mut mems: Vec<Memory> = rows.iter().map(|(id, v)| memory_from_row(*id, v)).collect();
        mems.sort_by(|a, b| b.id.uuid().cmp(a.id.uuid()));
        mems.truncate(n);
        Ok(mems)
    }

    /// Memories that mention the named entity (entity-scoped recall).
    pub async fn memories_about(&self, name: &str) -> Result<Vec<Memory>, BrainError> {
        let Some(eid) = self.entity_id_by_name(name).await? else {
            return Ok(Vec::new());
        };
        let mention_rows = self
            .client
            .query(
                self.link_query()
                    .filter_eq("to", Value::Text(id_str(&eid)))
                    .filter_eq("kind", Value::Text("mentions".to_string()))
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        let memory_ids: std::collections::HashSet<String> = mention_rows
            .iter()
            .map(|(_, v)| text_at(v, 1)) // `from`
            .collect();
        if memory_ids.is_empty() {
            return Ok(Vec::new());
        }
        // Small-scale fetch: scan this owner's memories and keep the mentioned ones.
        let all = self
            .client
            .query(self.memory_query(&Filter::default()).build(), None)
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        Ok(all
            .into_iter()
            .filter(|(id, _)| memory_ids.contains(&id_str(id)))
            .map(|(id, v)| memory_from_row(id, &v))
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
                name: text_at(v, 1),
                kind: text_at(v, 2),
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
        let rows = self
            .client
            .query(
                self.link_query()
                    .filter_eq("from", Value::Text(id_str(&a)))
                    .filter_eq("to", Value::Text(id_str(&b)))
                    .filter_eq("kind", Value::Text(BOND_KIND.to_string()))
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        Ok(rows.first().map(|(_, v)| Relation {
            strength: f64_at(v, 8),
            stability: f64_at(v, 9),
            access_count: i64_at(v, 10),
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
        class_for_claim_predicate(predicate)?;
        let subj = self.upsert_entity(subject).await?;
        let obj = self.upsert_entity(object).await?;
        let now = now_ms();

        // Close any open claim for the same (subject, predicate).
        let open = self
            .client
            .query(
                self.link_query()
                    .filter_eq("from", Value::Text(id_str(&subj)))
                    .filter_eq("kind", Value::Text(predicate.to_string()))
                    .filter_is_null("valid_to")
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        for (id, _) in open {
            self.client
                .update(id, vec![("valid_to".to_string(), Value::Text(now.to_string()))])
                .await
                .map_err(|e| BrainError::Write(format!("{e:?}")))?;
        }

        // Column order per `schema.rs`: owner, from, to, kind, class, valid_from,
        // valid_to, confidence, strength, stability, access_count, last_access,
        // source_memory.
        self.client
            .create(
                LINKS,
                vec![
                    Value::Uuid(self.owner),
                    Value::Text(id_str(&subj)),
                    Value::Text(id_str(&obj)),
                    Value::Text(predicate.to_string()),
                    Value::Text(LinkClass::Claim.as_str().to_string()),
                    Value::Text(now.to_string()),
                    Value::Null, // valid_to (open = currently true)
                    Value::Double(1.0),
                    Value::Null,
                    Value::Null,
                    Value::Null,
                    Value::Null,
                    opt_text(source_memory.map(|m| id_str(&m))),
                ],
            )
            .await
            .map_err(|e| BrainError::Write(format!("{e:?}")))
    }

    /// All claims with `subject` as the subject (current and historical).
    pub async fn facts(&self, subject: &str) -> Result<Vec<Fact>, BrainError> {
        let Some(subj) = self.entity_id_by_name(subject).await? else {
            return Ok(Vec::new());
        };
        let rows = self
            .client
            .query(
                self.link_query()
                    .filter_eq("from", Value::Text(id_str(&subj)))
                    .filter_eq("class", Value::Text(LinkClass::Claim.as_str().to_string()))
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        let names: std::collections::HashMap<String, String> = self
            .entities()
            .await?
            .into_iter()
            .map(|e| (id_str(&e.id), e.name))
            .collect();
        Ok(rows
            .iter()
            .map(|(_, v)| Fact {
                predicate: text_at(v, 3),
                object_name: names.get(&text_at(v, 2)).cloned().unwrap_or_default(),
                valid_from_ms: text_at_opt(v, 5).and_then(|s| s.parse().ok()),
                valid_to_ms: text_at_opt(v, 6).and_then(|s| s.parse().ok()),
                confidence: f64_at(v, 7),
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
        let mut weighted: Vec<(String, f64)> = Vec::new();
        for (self_col, other_col) in [("from", 2usize), ("to", 1usize)] {
            let rows = self
                .client
                .query(
                    self.link_query()
                        .filter_eq(self_col, Value::Text(id_str(&eid)))
                        .filter_eq("kind", Value::Text(BOND_KIND.to_string()))
                        .build(),
                    None,
                )
                .await
                .map_err(|e| BrainError::Read(format!("{e:?}")))?;
            for (_, v) in rows {
                weighted.push((text_at(&v, other_col), f64_at(&v, 8)));
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

        // L3: traced hybrid recall across everything, excluding the window.
        let recalled: Vec<ScoredMemory> = self
            .search_traced(query, opts.recall_k * 2, &Filter::default())
            .await?
            .into_iter()
            .filter(|s| !working_ids.contains(&id_str(&s.memory.id)) && s.memory.stream != "self")
            .take(opts.recall_k)
            .collect();

        // L2: entity cards for entities named in the query.
        let mut cards: Vec<EntityCard> = Vec::new();
        for name in self.entities_in_query(query).await? {
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
            query: query.to_string(),
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
        let entities_merged = self.merge_duplicate_entities().await?;
        let bonds_decayed = self.decay_bonds(now).await?;
        Ok(DreamReport {
            bonds_decayed,
            entities_merged,
        })
    }

    /// Ebbinghaus decay over bond links: `strength · exp(-days/stability)`, floored.
    async fn decay_bonds(&self, now: i64) -> Result<usize, BrainError> {
        let rows = self
            .client
            .query(
                self.link_query()
                    .filter_eq("kind", Value::Text(BOND_KIND.to_string()))
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        let mut decayed = 0;
        for (id, v) in rows {
            let strength = f64_at(&v, 8);
            let stability = f64_at(&v, 9).max(1e-4);
            let last = i64_at(&v, 11);
            let days = now.saturating_sub(last) as f64 / MS_PER_DAY as f64;
            if days <= 0.0 {
                continue;
            }
            let new_strength = (strength * (-days / stability).exp()).max(STRENGTH_FLOOR);
            if (new_strength - strength).abs() > 1e-9 {
                self.client
                    .update(id, vec![("strength".to_string(), Value::Double(new_strength))])
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
        for (col, other_col_idx) in [("from", 2usize), ("to", 1usize)] {
            let rows = self
                .client
                .query(
                    self.link_query()
                        .filter_eq(col, Value::Text(dup_s.clone()))
                        .build(),
                    None,
                )
                .await
                .map_err(|e| BrainError::Read(format!("{e:?}")))?;
            for (lid, v) in rows {
                let kind = text_at(&v, 3);
                let other = text_at(&v, other_col_idx);
                if kind == BOND_KIND && other == canon_s {
                    // would become a self-bond — drop it.
                    self.client
                        .delete(lid)
                        .await
                        .map_err(|e| BrainError::Write(format!("{e:?}")))?;
                    continue;
                }
                if kind == BOND_KIND {
                    // Keep canonical endpoint ordering for bonds.
                    let (na, nb) = canonical_pair_str(&canon_s, &other);
                    self.client
                        .update(
                            lid,
                            vec![
                                ("from".to_string(), Value::Text(na)),
                                ("to".to_string(), Value::Text(nb)),
                            ],
                        )
                        .await
                        .map_err(|e| BrainError::Write(format!("{e:?}")))?;
                } else {
                    self.client
                        .update(lid, vec![(col.to_string(), Value::Text(canon_s.clone()))])
                        .await
                        .map_err(|e| BrainError::Write(format!("{e:?}")))?;
                }
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
        let rows = self
            .client
            .query(
                self.link_query()
                    .filter_eq("kind", Value::Text(BOND_KIND.to_string()))
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        let mut by_pair: HashMap<(String, String), (ObjectId, f64, i64, bool)> = HashMap::new();
        let mut to_delete: Vec<ObjectId> = Vec::new();
        for (id, v) in &rows {
            let a = text_at(v, 1);
            let b = text_at(v, 2);
            if a == b {
                to_delete.push(*id);
                continue;
            }
            let key = canonical_pair_str(&a, &b);
            let strength = f64_at(v, 8);
            let count = i64_at(v, 10);
            match by_pair.get_mut(&key) {
                None => {
                    by_pair.insert(key, (*id, strength, count, false));
                }
                Some(entry) => {
                    entry.1 = entry.1.max(strength);
                    entry.2 += count;
                    entry.3 = true;
                    to_delete.push(*id);
                }
            }
        }
        for (_, (keep, strength, count, dirty)) in by_pair {
            if dirty {
                self.client
                    .update(
                        keep,
                        vec![
                            ("strength".to_string(), Value::Double(strength)),
                            ("access_count".to_string(), Value::BigInt(count)),
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

    /// Base memories query: owner-scoped, superseded rows hidden, typed filter applied.
    fn memory_query(&self, filter: &Filter) -> QueryBuilder {
        let mut qb = QueryBuilder::new(MEMORIES)
            .filter_eq("owner", Value::Uuid(self.owner))
            .filter_is_null("superseded_by");
        if let Some(s) = &filter.stream {
            qb = qb.filter_eq("stream", Value::Text(s.clone()));
        }
        if let Some(r) = &filter.author_role {
            qb = qb.filter_eq("author_role", Value::Text(r.clone()));
        }
        if let Some(src) = &filter.source {
            qb = qb.filter_eq("source", Value::Text(src.clone()));
        }
        qb
    }

    /// Base links query: owner-scoped.
    fn link_query(&self) -> QueryBuilder {
        QueryBuilder::new(LINKS).filter_eq("owner", Value::Uuid(self.owner))
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
    async fn write_graph(&self, memory_id: ObjectId, content: &str) -> Result<(), BrainError> {
        let names = extract_wikilinks(content);
        let mut entity_ids = Vec::with_capacity(names.len());
        for name in &names {
            let id = self.upsert_entity(name).await?;
            self.ensure_mention(memory_id, id).await?;
            entity_ids.push(id);
        }
        for i in 0..entity_ids.len() {
            for j in (i + 1)..entity_ids.len() {
                self.potentiate_bond(entity_ids[i], entity_ids[j]).await?;
            }
        }
        Ok(())
    }

    /// Idempotent **note** link: `memory —mentions→ entity` (re-insert is a no-op).
    async fn ensure_mention(&self, memory: ObjectId, entity: ObjectId) -> Result<(), BrainError> {
        let existing = self
            .client
            .query(
                self.link_query()
                    .filter_eq("from", Value::Text(id_str(&memory)))
                    .filter_eq("to", Value::Text(id_str(&entity)))
                    .filter_eq("kind", Value::Text("mentions".to_string()))
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        if !existing.is_empty() {
            return Ok(());
        }
        self.client
            .create(
                LINKS,
                vec![
                    Value::Uuid(self.owner),
                    Value::Text(id_str(&memory)),
                    Value::Text(id_str(&entity)),
                    Value::Text("mentions".to_string()),
                    Value::Text(LinkClass::Note.as_str().to_string()),
                    Value::Null,
                    Value::Null,
                    Value::Null,
                    Value::Null,
                    Value::Null,
                    Value::Null,
                    Value::Null,
                    Value::Null,
                ],
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
        self.client
            .create(
                ENTITIES,
                vec![
                    Value::Uuid(self.owner),
                    Value::Text(name.to_string()),
                    Value::Text("unknown".to_string()),
                    Value::Null, // properties
                ],
            )
            .await
            .map_err(|e| BrainError::Write(format!("{e:?}")))
    }

    async fn entity_id_by_name(&self, name: &str) -> Result<Option<ObjectId>, BrainError> {
        let rows = self
            .client
            .query(
                QueryBuilder::new(ENTITIES)
                    .filter_eq("owner", Value::Uuid(self.owner))
                    .filter_eq("name", Value::Text(name.to_string()))
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        Ok(rows.first().map(|(id, _)| *id))
    }

    /// Create or reinforce the **bond** between two entities (Hebbian potentiation).
    async fn potentiate_bond(&self, a: ObjectId, b: ObjectId) -> Result<(), BrainError> {
        let (a, b) = canonical_pair(a, b);
        let now = now_ms();
        let rows = self
            .client
            .query(
                self.link_query()
                    .filter_eq("from", Value::Text(id_str(&a)))
                    .filter_eq("to", Value::Text(id_str(&b)))
                    .filter_eq("kind", Value::Text(BOND_KIND.to_string()))
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;

        if let Some((id, v)) = rows.first() {
            let strength = (f64_at(v, 8) + POTENTIATION_INCREMENT).min(MAX_STRENGTH);
            let spaced = now.saturating_sub(i64_at(v, 11)) >= SPACED_INTERVAL_MS;
            let stability = f64_at(v, 9) + if spaced { STABILITY_INCREMENT } else { 0.0 };
            self.client
                .update(
                    *id,
                    vec![
                        ("strength".to_string(), Value::Double(strength)),
                        ("stability".to_string(), Value::Double(stability)),
                        ("access_count".to_string(), Value::BigInt(i64_at(v, 10) + 1)),
                        ("last_access".to_string(), Value::BigInt(now)),
                    ],
                )
                .await
                .map_err(|e| BrainError::Write(format!("{e:?}")))?;
        } else {
            self.client
                .create(
                    LINKS,
                    vec![
                        Value::Uuid(self.owner),
                        Value::Text(id_str(&a)),
                        Value::Text(id_str(&b)),
                        Value::Text(BOND_KIND.to_string()),
                        Value::Text(LinkClass::Bond.as_str().to_string()),
                        Value::Null,
                        Value::Null,
                        Value::Null,
                        Value::Double(1.0), // strength (seed)
                        Value::Double(1.0), // stability
                        Value::BigInt(1),   // access_count
                        Value::BigInt(now), // last_access
                        Value::Null,
                    ],
                )
                .await
                .map_err(|e| BrainError::Write(format!("{e:?}")))?;
        }
        Ok(())
    }

    /// Look up an existing memory by content hash (idempotency / dedup).
    async fn find_by_content_hash(&self, hash: &[u8]) -> Result<Option<ObjectId>, BrainError> {
        let rows = self
            .client
            .query(
                QueryBuilder::new(MEMORIES)
                    .filter_eq("owner", Value::Uuid(self.owner))
                    .filter_eq("content_hash", Value::Bytea(hash.to_vec()))
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

/// Memory column order: owner, content, embedding, stream, author_role, source, seq,
/// line_start, line_end, content_date, content_hash, source_version, normalize_version,
/// veracity, superseded_by.
fn memory_from_row(id: ObjectId, vals: &[Value]) -> Memory {
    Memory {
        id,
        content: text_at(vals, 1),
        stream: text_at(vals, 3),
        author_role: text_at(vals, 4),
        source: text_at_opt(vals, 5),
        veracity: text_at_opt(vals, 13),
    }
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

/// Lowercased non-stopword tokens (≥3 chars) for the abstention floor.
fn content_tokens(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 3 && !STOPWORDS.contains(t))
        .map(|t| t.to_string())
        .collect()
}

/// Fraction of query tokens present in the content.
fn lexical_overlap(query_tokens: &[String], content: &str) -> f32 {
    if query_tokens.is_empty() {
        return 1.0;
    }
    let content_lower = content.to_lowercase();
    let hits = query_tokens
        .iter()
        .filter(|t| content_lower.contains(t.as_str()))
        .count();
    hits as f32 / query_tokens.len() as f32
}

fn text_at(v: &[Value], i: usize) -> String {
    match v.get(i) {
        Some(Value::Text(s)) => s.clone(),
        _ => String::new(),
    }
}
fn text_at_opt(v: &[Value], i: usize) -> Option<String> {
    match v.get(i) {
        Some(Value::Text(s)) => Some(s.clone()),
        _ => None,
    }
}
fn f64_at(v: &[Value], i: usize) -> f64 {
    match v.get(i) {
        Some(Value::Double(f)) => *f,
        _ => 0.0,
    }
}
fn i64_at(v: &[Value], i: usize) -> i64 {
    match v.get(i) {
        Some(Value::BigInt(n)) => *n,
        _ => 0,
    }
}
fn opt_text(s: Option<String>) -> Value {
    match s {
        Some(s) => Value::Text(s),
        None => Value::Null,
    }
}
fn opt_int(n: Option<i64>) -> Value {
    match n {
        Some(n) => Value::Integer(n as i32),
        None => Value::Null,
    }
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

/// Stable, deterministic content hash (FNV-1a 64-bit) — identical across devices.
fn content_hash(content: &str) -> [u8; 8] {
    let mut h: u64 = 0xcbf29ce484222325;
    for byte in content.bytes() {
        h ^= byte as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h.to_le_bytes()
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
        // The matching memory should be found by BOTH retrievers (stub embeds + BM25).
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

    #[tokio::test]
    async fn dream_decays_bonds_and_merges_duplicate_entities() {
        let brain = test_brain("test-dream").await;
        brain.remember("[[Alice]] and [[Bob]] shipped the release").await.unwrap();
        brain.remember("[[alice]] thanked [[Bob]] afterwards").await.unwrap();

        assert_eq!(brain.entities().await.unwrap().len(), 3);

        let future = now_ms() + 10 * MS_PER_DAY;
        let report = brain.dream_at(future).await.unwrap();
        assert!(report.entities_merged >= 1, "alice should merge into Alice");
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
        let other = Brain::over(
            Arc::clone(&brain_a.client),
            owner(),
            StubEmbedder::new(EMBED_DIM),
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
}

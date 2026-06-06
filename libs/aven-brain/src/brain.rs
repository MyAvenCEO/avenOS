//! The [`Brain`] handle: `remember` (write) and `search` (hybrid retrieve) over an
//! aven-db [`JazzClient`] for one identity, plus a **deterministic, zero-LLM knowledge
//! graph** built on the write path.
//!
//! - `remember` stores a memory and, from `[[wikilink]]` references in its content,
//!   deterministically upserts **entities**, records **mentions** (memory→entity), and
//!   potentiates **relations** (entity↔entity, with **dynamics**) for every co-mentioned
//!   pair. No LLM touches the write path, so the graph is reproducible across devices
//!   (clean CRDT merges). Richer typed `facts` are left to an off-write-path extractor.
//! - `search` runs both engine retrievers (`nearest` cosine + `text_search` BM25) and
//!   fuses with **Reciprocal Rank Fusion (RRF)**. `search_scoped` filters by tags first.
//! - `remember` is **idempotent** (dedup by `content_hash`).

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use groove::{AppContext, AppId, JazzClient, NullSyncTransport, ObjectId, QueryBuilder, Value};

use crate::embedder::Embedder;
use crate::schema::{brain_schema, ENTITIES, MEMORIES, MENTIONS, RELATIONS};

/// Errors from brain operations.
#[derive(Debug)]
pub enum BrainError {
    Open(String),
    Write(String),
    Read(String),
}

impl std::fmt::Display for BrainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BrainError::Open(m) => write!(f, "brain open error: {m}"),
            BrainError::Write(m) => write!(f, "brain write error: {m}"),
            BrainError::Read(m) => write!(f, "brain read error: {m}"),
        }
    }
}

impl std::error::Error for BrainError {}

/// A retrieved memory.
#[derive(Debug, Clone)]
pub struct Memory {
    pub id: ObjectId,
    pub content: String,
    pub tags: Vec<String>,
}

/// A named graph node.
#[derive(Debug, Clone)]
pub struct Entity {
    pub id: ObjectId,
    pub name: String,
    pub kind: String,
}

/// A weighted association between two entities (dynamics).
#[derive(Debug, Clone)]
pub struct Relation {
    pub strength: f64,
    pub stability: f64,
    pub access_count: i64,
}

// ── Dynamics constants (MemPalace-tuned) ────────────────────────────────────
const POTENTIATION_INCREMENT: f64 = 0.05;
const MAX_STRENGTH: f64 = 5.0;
const STABILITY_INCREMENT: f64 = 0.1;
/// Min gap to count a potentiation as "spaced" (1 hour, in microseconds).
const SPACED_INTERVAL_MICROS: u64 = 3_600_000_000;
/// RRF constant (standard default).
const RRF_K: f32 = 60.0;

/// The memory brain of one identity.
pub struct Brain<E: Embedder> {
    client: JazzClient,
    embedder: E,
}

impl<E: Embedder> Brain<E> {
    /// Open an ephemeral, in-memory brain (tests / dev). Nothing is persisted.
    pub async fn open_in_memory(app: &str, embedder: E) -> Result<Self, BrainError> {
        let data_dir = std::env::temp_dir().join(format!("aven-brain-{app}"));
        let _ = std::fs::create_dir_all(&data_dir);
        let context = AppContext {
            app_id: AppId::from_name(app),
            client_id: None,
            schema: brain_schema(embedder.dim()),
            data_dir,
            live_schemas: Vec::new(),
        };
        let client = JazzClient::connect_headless_in_memory(context, Arc::new(NullSyncTransport))
            .await
            .map_err(|e| BrainError::Open(format!("{e:?}")))?;
        Ok(Self { client, embedder })
    }

    /// Store a memory (verbatim content + embedding + optional tags) and build the graph
    /// from its `[[wikilink]]` references. **Idempotent**: identical content returns the
    /// existing memory id without re-writing.
    pub async fn remember(&self, content: &str, tags: &[&str]) -> Result<ObjectId, BrainError> {
        let hash = content_hash(content);
        if let Some(existing) = self.find_by_content_hash(&hash).await? {
            return Ok(existing);
        }

        let embedding = self.embedder.embed(content);
        let tags_value = if tags.is_empty() {
            Value::Null
        } else {
            Value::Array(tags.iter().map(|t| Value::Text(t.to_string())).collect())
        };
        // Column order per `schema.rs`: content, embedding, tags, source, seq, line_start,
        // line_end, content_date, content_hash, source_version, normalize_version, created_at.
        let values = vec![
            Value::Text(content.to_string()),
            Value::Vector(embedding),
            tags_value,
            Value::Null,
            Value::Null,
            Value::Null,
            Value::Null,
            Value::Null,
            Value::Bytea(hash.to_vec()),
            Value::Null,
            Value::Integer(1),
            Value::Timestamp(now_micros()),
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

    /// Hybrid retrieval: top-`k` memories by RRF over `nearest` + `text_search`.
    pub async fn search(&self, query: &str, k: usize) -> Result<Vec<Memory>, BrainError> {
        self.search_scoped(query, k, &[]).await
    }

    /// Like [`search`](Self::search), restricted to memories carrying **all** of `tags`.
    pub async fn search_scoped(
        &self,
        query: &str,
        k: usize,
        tags: &[&str],
    ) -> Result<Vec<Memory>, BrainError> {
        let over = (k * 4).max(8);
        let qvec = self.embedder.embed(query);

        let mut vector_qb = QueryBuilder::new(MEMORIES);
        for t in tags {
            vector_qb = vector_qb.filter_contains("tags", Value::Text(t.to_string()));
        }
        let vector_rows = self
            .client
            .query(vector_qb.nearest("embedding", qvec, over).build(), None)
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;

        let mut text_qb = QueryBuilder::new(MEMORIES);
        for t in tags {
            text_qb = text_qb.filter_contains("tags", Value::Text(t.to_string()));
        }
        let text_rows = self
            .client
            .query(text_qb.text_search("content", query, over).build(), None)
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;

        Ok(rrf_fuse(&vector_rows, &text_rows, k))
    }

    // ── Knowledge graph ─────────────────────────────────────────────────────

    /// All entities in the brain.
    pub async fn entities(&self) -> Result<Vec<Entity>, BrainError> {
        let rows = self
            .client
            .query(QueryBuilder::new(ENTITIES).build(), None)
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        Ok(rows
            .iter()
            .map(|(id, v)| Entity {
                id: *id,
                name: text_at(v, 0),
                kind: text_at(v, 1),
            })
            .collect())
    }

    /// The relation (dynamics) between two named entities, if any.
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
                QueryBuilder::new(RELATIONS)
                    .filter_eq("a", Value::Uuid(a))
                    .filter_eq("b", Value::Uuid(b))
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        Ok(rows.first().map(|(_, v)| Relation {
            strength: f64_at(v, 2),
            stability: f64_at(v, 3),
            access_count: i64_at(v, 4),
        }))
    }

    /// Build the graph for a new memory: upsert entities for each wikilink, record a
    /// mention per entity, and potentiate a relation for each co-mentioned pair.
    async fn write_graph(&self, memory_id: ObjectId, content: &str) -> Result<(), BrainError> {
        let names = extract_wikilinks(content);
        let mut entity_ids = Vec::with_capacity(names.len());
        for name in &names {
            let id = self.upsert_entity(name).await?;
            // mention: (memory, entity)
            self.client
                .create(MENTIONS, vec![Value::Uuid(memory_id), Value::Uuid(id)])
                .await
                .map_err(|e| BrainError::Write(format!("{e:?}")))?;
            entity_ids.push(id);
        }
        // relations for each unordered pair of co-mentioned entities
        for i in 0..entity_ids.len() {
            for j in (i + 1)..entity_ids.len() {
                self.potentiate_relation(entity_ids[i], entity_ids[j]).await?;
            }
        }
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
                    .filter_eq("name", Value::Text(name.to_string()))
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        Ok(rows.first().map(|(id, _)| *id))
    }

    /// Create or reinforce the relation between two entities (Hebbian potentiation).
    async fn potentiate_relation(&self, a: ObjectId, b: ObjectId) -> Result<(), BrainError> {
        let (a, b) = canonical_pair(a, b);
        let now = now_micros();
        let rows = self
            .client
            .query(
                QueryBuilder::new(RELATIONS)
                    .filter_eq("a", Value::Uuid(a))
                    .filter_eq("b", Value::Uuid(b))
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;

        if let Some((id, v)) = rows.first() {
            let strength = (f64_at(v, 2) + POTENTIATION_INCREMENT).min(MAX_STRENGTH);
            let spaced = now.saturating_sub(u64_at(v, 5)) >= SPACED_INTERVAL_MICROS;
            let stability = f64_at(v, 3) + if spaced { STABILITY_INCREMENT } else { 0.0 };
            self.client
                .update(
                    *id,
                    vec![
                        ("strength".to_string(), Value::Double(strength)),
                        ("stability".to_string(), Value::Double(stability)),
                        ("access_count".to_string(), Value::BigInt(i64_at(v, 4) + 1)),
                        ("last_access".to_string(), Value::Timestamp(now)),
                    ],
                )
                .await
                .map_err(|e| BrainError::Write(format!("{e:?}")))?;
        } else {
            self.client
                .create(
                    RELATIONS,
                    vec![
                        Value::Uuid(a),
                        Value::Uuid(b),
                        Value::Double(1.0), // strength
                        Value::Double(1.0), // stability
                        Value::BigInt(1),   // access_count
                        Value::Timestamp(now),
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
                    .filter_eq("content_hash", Value::Bytea(hash.to_vec()))
                    .build(),
                None,
            )
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;
        Ok(rows.first().map(|(id, _)| *id))
    }
}

/// Reciprocal Rank Fusion of two ranked result lists, keyed by memory id.
fn rrf_fuse(
    vector_rows: &[(ObjectId, Vec<Value>)],
    text_rows: &[(ObjectId, Vec<Value>)],
    k: usize,
) -> Vec<Memory> {
    use std::collections::HashMap;
    let mut score: HashMap<ObjectId, f32> = HashMap::new();
    let mut mem: HashMap<ObjectId, Memory> = HashMap::new();

    for list in [vector_rows, text_rows] {
        for (rank, (id, vals)) in list.iter().enumerate() {
            *score.entry(*id).or_insert(0.0) += 1.0 / (RRF_K + rank as f32 + 1.0);
            mem.entry(*id).or_insert_with(|| memory_from_row(*id, vals));
        }
    }

    let mut ranked: Vec<(ObjectId, f32)> = score.into_iter().collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    ranked.truncate(k);
    ranked
        .into_iter()
        .filter_map(|(id, _)| mem.remove(&id))
        .collect()
}

/// Extract `[[wikilink]]` entity names from content (case-insensitive dedup, first casing kept).
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

fn memory_from_row(id: ObjectId, vals: &[Value]) -> Memory {
    let content = match vals.first() {
        Some(Value::Text(s)) => s.clone(),
        _ => String::new(),
    };
    let tags = match vals.get(2) {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|v| match v {
                Value::Text(s) => Some(s.clone()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };
    Memory { id, content, tags }
}

/// Order an entity-id pair canonically so a relation has one row regardless of direction.
fn canonical_pair(a: ObjectId, b: ObjectId) -> (ObjectId, ObjectId) {
    if a.uuid() <= b.uuid() {
        (a, b)
    } else {
        (b, a)
    }
}

fn text_at(v: &[Value], i: usize) -> String {
    match v.get(i) {
        Some(Value::Text(s)) => s.clone(),
        _ => String::new(),
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
fn u64_at(v: &[Value], i: usize) -> u64 {
    match v.get(i) {
        Some(Value::Timestamp(t)) => *t,
        _ => 0,
    }
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

fn now_micros() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_micros() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::embedder::StubEmbedder;
    use crate::EMBED_DIM;

    #[tokio::test]
    async fn remember_then_search_returns_the_relevant_memory() {
        let brain = Brain::open_in_memory("test-remember-search", StubEmbedder::new(EMBED_DIM))
            .await
            .expect("open brain");

        brain.remember("the cat sat on the mat", &[]).await.unwrap();
        brain
            .remember("rust is a systems programming language", &[])
            .await
            .unwrap();
        let beach = brain
            .remember("we went to the beach and swam in the ocean", &[])
            .await
            .unwrap();

        let hits = brain.search("ocean beach holiday", 1).await.unwrap();
        assert_eq!(hits.len(), 1, "expected one hit, got {hits:?}");
        assert_eq!(hits[0].id, beach);
        assert!(hits[0].content.contains("beach"));
    }

    #[tokio::test]
    async fn remember_is_idempotent_on_identical_content() {
        let brain = Brain::open_in_memory("test-idempotent", StubEmbedder::new(EMBED_DIM))
            .await
            .unwrap();
        let first = brain.remember("the same exact memory", &[]).await.unwrap();
        let second = brain.remember("the same exact memory", &[]).await.unwrap();
        assert_eq!(first, second);
        let hits = brain.search("the same exact memory", 10).await.unwrap();
        assert_eq!(hits.len(), 1, "identical content must dedup, got {hits:?}");
    }

    #[tokio::test]
    async fn scoped_search_filters_by_tag() {
        let brain = Brain::open_in_memory("test-scoped", StubEmbedder::new(EMBED_DIM))
            .await
            .unwrap();
        let work = brain
            .remember("quarterly revenue planning meeting", &["work"])
            .await
            .unwrap();
        brain
            .remember("planning the family holiday trip", &["personal"])
            .await
            .unwrap();
        let hits = brain.search_scoped("planning", 5, &["work"]).await.unwrap();
        assert_eq!(hits.len(), 1, "tag scope should yield only work, got {hits:?}");
        assert_eq!(hits[0].id, work);
        assert!(hits[0].tags.iter().any(|t| t == "work"));
    }

    #[tokio::test]
    async fn wikilinks_build_entities_mentions_and_relations() {
        let brain = Brain::open_in_memory("test-kg", StubEmbedder::new(EMBED_DIM))
            .await
            .unwrap();

        brain
            .remember("[[Alice]] met [[Bob]] at [[Acme]] today", &[])
            .await
            .unwrap();

        // three deduped entities
        let entities = brain.entities().await.unwrap();
        assert_eq!(entities.len(), 3, "expected 3 entities, got {entities:?}");

        // each co-mentioned pair has a relation seeded at strength 1.0
        let r = brain.relation("Alice", "Bob").await.unwrap().expect("Alice↔Bob relation");
        assert!((r.strength - 1.0).abs() < 1e-6, "seed strength 1.0, got {}", r.strength);
        assert_eq!(r.access_count, 1);
        assert!(brain.relation("Alice", "Acme").await.unwrap().is_some());
        assert!(brain.relation("Bob", "Acme").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn co_mention_potentiates_relation_and_dedups_entities() {
        let brain = Brain::open_in_memory("test-potentiate", StubEmbedder::new(EMBED_DIM))
            .await
            .unwrap();

        brain.remember("[[Alice]] and [[Bob]] kicked off the project", &[]).await.unwrap();
        brain.remember("[[Alice]] reviewed [[Bob]]'s pull request", &[]).await.unwrap();

        // entities are deduped across memories (still just Alice + Bob)
        assert_eq!(brain.entities().await.unwrap().len(), 2);

        // the relation was reinforced: strength bumped, access_count == 2
        let r = brain.relation("Alice", "Bob").await.unwrap().expect("relation");
        assert_eq!(r.access_count, 2, "two co-mentions");
        assert!(
            r.strength > 1.0,
            "co-mention should potentiate strength above the seed, got {}",
            r.strength
        );
    }
}

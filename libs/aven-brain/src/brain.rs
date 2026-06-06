//! The [`Brain`] handle: `remember` (write) and `search` (hybrid retrieve) over an
//! aven-db [`JazzClient`] for one identity.
//!
//! `search` runs the two engine retrievers — `nearest` (vector cosine) and `text_search`
//! (BM25) — and fuses their ranked results with **Reciprocal Rank Fusion (RRF)**. RRF
//! needs only the rank positions (not raw scores), so it works today without engine-side
//! score surfacing; weighted fusion (`0.6·vec + 0.4·bm25`) can replace it once a
//! `_distance`/`_score` column is surfaced.
//!
//! `remember` is **idempotent**: identical content re-ingested returns the existing memory
//! (dedup by `content_hash`) instead of creating a duplicate. `search` can be **scoped** by
//! tags — the filter runs before ranking, so it stays cheap.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use groove::{AppContext, AppId, JazzClient, NullSyncTransport, ObjectId, QueryBuilder, Value};

use crate::embedder::Embedder;
use crate::schema::{brain_schema, MEMORIES};

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

/// The memory brain of one identity.
pub struct Brain<E: Embedder> {
    client: JazzClient,
    embedder: E,
}

/// RRF constant (standard default). Dampens the contribution of lower ranks.
const RRF_K: f32 = 60.0;

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

    /// Store a memory (verbatim content + embedding + optional tags). **Idempotent**:
    /// identical content returns the existing memory id instead of duplicating.
    pub async fn remember(&self, content: &str, tags: &[&str]) -> Result<ObjectId, BrainError> {
        let hash = content_hash(content);

        // Idempotent dedup: if this exact content is already stored, return it.
        if let Some(existing) = self.find_by_content_hash(&hash).await? {
            return Ok(existing);
        }

        let embedding = self.embedder.embed(content);
        let tags_value = if tags.is_empty() {
            Value::Null
        } else {
            Value::Array(tags.iter().map(|t| Value::Text(t.to_string())).collect())
        };
        // Positional values MUST match the `memories` column order in `schema.rs`:
        // content, embedding, tags, source, seq, line_start, line_end, content_date,
        // content_hash, source_version, normalize_version, created_at.
        let values = vec![
            Value::Text(content.to_string()),
            Value::Vector(embedding),
            tags_value,
            Value::Null,                     // source
            Value::Null,                     // seq
            Value::Null,                     // line_start
            Value::Null,                     // line_end
            Value::Null,                     // content_date
            Value::Bytea(hash.to_vec()),     // content_hash
            Value::Null,                     // source_version
            Value::Integer(1),               // normalize_version
            Value::Timestamp(now_micros()),  // created_at
        ];
        self.client
            .create(MEMORIES, values)
            .await
            .map_err(|e| BrainError::Write(format!("{e:?}")))
    }

    /// Hybrid retrieval: top-`k` memories by RRF over `nearest` (vector) + `text_search` (BM25).
    pub async fn search(&self, query: &str, k: usize) -> Result<Vec<Memory>, BrainError> {
        self.search_scoped(query, k, &[]).await
    }

    /// Like [`search`](Self::search), but restricted to memories carrying **all** of `tags`.
    /// The tag filter runs before ranking (cheap scope), then hybrid rank + RRF.
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
        let vector_q = vector_qb.nearest("embedding", qvec, over).build();
        let vector_rows = self
            .client
            .query(vector_q, None)
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;

        let mut text_qb = QueryBuilder::new(MEMORIES);
        for t in tags {
            text_qb = text_qb.filter_contains("tags", Value::Text(t.to_string()));
        }
        let text_q = text_qb.text_search("content", query, over).build();
        let text_rows = self
            .client
            .query(text_q, None)
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;

        Ok(rrf_fuse(&vector_rows, &text_rows, k))
    }

    /// Look up an existing memory by its content hash (idempotency / dedup).
    async fn find_by_content_hash(&self, hash: &[u8]) -> Result<Option<ObjectId>, BrainError> {
        let q = QueryBuilder::new(MEMORIES)
            .filter_eq("content_hash", Value::Bytea(hash.to_vec()))
            .build();
        let rows = self
            .client
            .query(q, None)
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

/// Build a `Memory` from a `memories` row (column order per `schema.rs`).
fn memory_from_row(id: ObjectId, vals: &[Value]) -> Memory {
    let content = match vals.first() {
        Some(Value::Text(s)) => s.clone(), // column 0
        _ => String::new(),
    };
    let tags = match vals.get(2) {
        // column 2
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

/// Stable, deterministic content hash (FNV-1a 64-bit). Deterministic across devices so
/// identical content dedups consistently under CRDT merge.
fn content_hash(content: &str) -> [u8; 8] {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in content.bytes() {
        h ^= b as u64;
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
        assert_eq!(
            hits[0].id, beach,
            "most relevant memory should be the beach/ocean one; got {:?}",
            hits[0].content
        );
        assert!(hits[0].content.contains("beach"));
    }

    #[tokio::test]
    async fn remember_is_idempotent_on_identical_content() {
        let brain = Brain::open_in_memory("test-idempotent", StubEmbedder::new(EMBED_DIM))
            .await
            .unwrap();

        let first = brain.remember("the same exact memory", &[]).await.unwrap();
        let second = brain.remember("the same exact memory", &[]).await.unwrap();
        assert_eq!(first, second, "re-remembering identical content must return the same id");

        // And it must not have created a duplicate row.
        let hits = brain.search("the same exact memory", 10).await.unwrap();
        assert_eq!(hits.len(), 1, "identical content must dedup to one memory, got {hits:?}");
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

        // Scope to "work": only the work memory is eligible, even though both mention "planning".
        let hits = brain.search_scoped("planning", 5, &["work"]).await.unwrap();

        assert_eq!(hits.len(), 1, "tag scope should yield only the work memory, got {hits:?}");
        assert_eq!(hits[0].id, work);
        assert!(hits[0].tags.iter().any(|t| t == "work"));
    }
}

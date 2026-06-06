//! The [`Brain`] handle: `remember` (write) and `search` (hybrid retrieve) over an
//! aven-db [`JazzClient`] for one identity.
//!
//! `search` runs the two engine retrievers — `nearest` (vector cosine) and `text_search`
//! (BM25) — and fuses their ranked results with **Reciprocal Rank Fusion (RRF)**. RRF
//! needs only the rank positions (not raw scores), so it works today without engine-side
//! score surfacing; weighted fusion (`0.6·vec + 0.4·bm25`) can replace it once a
//! `_distance`/`_score` column is surfaced.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use groove::{
    AppContext, AppId, JazzClient, NullSyncTransport, ObjectId, QueryBuilder, Value,
};

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
        let client =
            JazzClient::connect_headless_in_memory(context, Arc::new(NullSyncTransport))
                .await
                .map_err(|e| BrainError::Open(format!("{e:?}")))?;
        Ok(Self { client, embedder })
    }

    /// Store a memory (verbatim content + its embedding). Returns the memory id.
    pub async fn remember(&self, content: &str) -> Result<ObjectId, BrainError> {
        let embedding = self.embedder.embed(content);
        // Positional values MUST match the `memories` column order in `schema.rs`:
        // content, embedding, tags, source, seq, line_start, line_end, content_date,
        // content_hash, source_version, normalize_version, created_at.
        let values = vec![
            Value::Text(content.to_string()),
            Value::Vector(embedding),
            Value::Null,                   // tags
            Value::Null,                   // source
            Value::Null,                   // seq
            Value::Null,                   // line_start
            Value::Null,                   // line_end
            Value::Null,                   // content_date
            Value::Null,                   // content_hash
            Value::Null,                   // source_version
            Value::Integer(1),             // normalize_version
            Value::Timestamp(now_micros()), // created_at
        ];
        self.client
            .create(MEMORIES, values)
            .await
            .map_err(|e| BrainError::Write(format!("{e:?}")))
    }

    /// Hybrid retrieval: top-`k` memories by RRF over `nearest` (vector) + `text_search`
    /// (BM25). Each retriever over-fetches so the fusion has room to reorder.
    pub async fn search(&self, query: &str, k: usize) -> Result<Vec<Memory>, BrainError> {
        let over = (k * 4).max(8);
        let qvec = self.embedder.embed(query);

        let vector_q = QueryBuilder::new(MEMORIES)
            .nearest("embedding", qvec, over)
            .build();
        let vector_rows = self
            .client
            .query(vector_q, None)
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;

        let text_q = QueryBuilder::new(MEMORIES)
            .text_search("content", query, over)
            .build();
        let text_rows = self
            .client
            .query(text_q, None)
            .await
            .map_err(|e| BrainError::Read(format!("{e:?}")))?;

        Ok(rrf_fuse(&vector_rows, &text_rows, k))
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
    let mut content: HashMap<ObjectId, String> = HashMap::new();

    for list in [vector_rows, text_rows] {
        for (rank, (id, vals)) in list.iter().enumerate() {
            *score.entry(*id).or_insert(0.0) += 1.0 / (RRF_K + rank as f32 + 1.0);
            content.entry(*id).or_insert_with(|| match vals.first() {
                Some(Value::Text(s)) => s.clone(), // `content` is column 0
                _ => String::new(),
            });
        }
    }

    let mut ranked: Vec<(ObjectId, f32)> = score.into_iter().collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    ranked.truncate(k);
    ranked
        .into_iter()
        .map(|(id, _)| Memory {
            id,
            content: content.remove(&id).unwrap_or_default(),
        })
        .collect()
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
        assert_eq!(
            hits[0].id, beach,
            "most relevant memory should be the beach/ocean one; got {:?}",
            hits[0].content
        );
        assert!(hits[0].content.contains("beach"));
    }
}

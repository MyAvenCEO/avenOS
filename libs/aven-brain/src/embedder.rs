//! Embedding abstraction.
//!
//! The brain computes embeddings through an [`Embedder`]; the real on-device model
//! (EmbeddingGemma) drops in behind this trait later. Tests/dev use [`StubEmbedder`],
//! a deterministic hashed bag-of-words embedder — no model dependency, yet cosine
//! similarity tracks shared-token overlap so retrieval is meaningful.

/// Produces a fixed-dimension embedding for a piece of text.
///
/// Embeddings are computed where the decryption key lives (on-device); see the crate
/// docs' ownership note. Implementations must be deterministic for a given input so
/// idempotent re-ingest produces stable vectors.
pub trait Embedder: Send + Sync {
    /// Embedding dimensionality (must match the brain's schema `embedding` column).
    fn dim(&self) -> usize;
    /// Embed `text` into a `dim()`-length vector.
    fn embed(&self, text: &str) -> Vec<f32>;
}

/// Deterministic hashed bag-of-words embedder for tests/dev (no model runtime).
///
/// Each lowercase token (len ≥ 2) is FNV-hashed into a bucket and counted; the vector
/// is L2-normalized. Texts sharing tokens land in shared buckets, so cosine distance
/// approximates lexical overlap — enough to exercise `nearest` end-to-end.
pub struct StubEmbedder {
    dim: usize,
}

impl StubEmbedder {
    pub fn new(dim: usize) -> Self {
        Self { dim: dim.max(1) }
    }
}

impl Embedder for StubEmbedder {
    fn dim(&self) -> usize {
        self.dim
    }

    fn embed(&self, text: &str) -> Vec<f32> {
        let mut v = vec![0.0f32; self.dim];
        for tok in text
            .split(|c: char| !c.is_alphanumeric())
            .filter(|t| t.chars().count() >= 2)
        {
            // FNV-1a over the lowercased token.
            let mut h: u64 = 0xcbf29ce484222325;
            for b in tok.to_lowercase().bytes() {
                h ^= b as u64;
                h = h.wrapping_mul(0x100000001b3);
            }
            let idx = (h as usize) % self.dim;
            v[idx] += 1.0;
        }
        let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for x in &mut v {
                *x /= norm;
            }
        }
        v
    }
}

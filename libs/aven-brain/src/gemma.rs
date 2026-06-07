//! Real on-device embedder: **EmbeddingGemma-300m (ONNX)** via `aven-ai`, adapting its
//! synchronous encoder to the async [`Embedder`] trait by running inference on a blocking
//! worker thread (`spawn_blocking`) so it never stalls the async runtime.
//!
//! Behind the `models` feature (pulls `aven-ai` + `ort` + `tokio`). The default build uses
//! [`crate::StubEmbedder`] and stays dependency-light.

use std::path::Path;
use std::sync::Arc;

use crate::embedder::Embedder;

/// EmbeddingGemma-300m embedder. Holds the loaded ONNX session (shared `Arc`) and the
/// embedding dimensionality.
pub struct GemmaEmbedder {
    inner: Arc<aven_ai::embed::Embedder>,
    dim: usize,
}

impl GemmaEmbedder {
    /// Initialize the onnxruntime runtime from `ort_dylib` and load EmbeddingGemma-300m
    /// from `models_root`. Blocking (mmaps the graph) — call from a blocking context or a
    /// dedicated thread. The model files must already be present (download is the caller's
    /// job, reusing `aven-ai`'s download path).
    pub fn load(models_root: &Path, ort_dylib: &Path) -> Result<Self, String> {
        aven_ai::embed::init_runtime(ort_dylib)?;
        let inner = aven_ai::embed::Embedder::load(&aven_ai::embed::EMBEDDINGGEMMA_300M, models_root)?;
        let dim = inner.dim();
        Ok(Self {
            inner: Arc::new(inner),
            dim,
        })
    }
}

impl Embedder for GemmaEmbedder {
    fn dim(&self) -> usize {
        self.dim
    }

    async fn embed(&self, text: &str) -> Vec<f32> {
        let inner = Arc::clone(&self.inner);
        let owned = text.to_string();
        let dim = self.dim;
        match tokio::task::spawn_blocking(move || inner.embed(&owned)).await {
            Ok(Ok(vector)) => vector,
            Ok(Err(e)) => {
                // Degrade rather than crash: a zero vector sorts last under cosine, and
                // text_search still covers the memory. (Making `embed` fallible is a
                // future refinement.)
                log::warn!(target: "avenos::brain", "embedding failed: {e}");
                vec![0.0; dim]
            }
            Err(e) => {
                log::warn!(target: "avenos::brain", "embedding task panicked: {e}");
                vec![0.0; dim]
            }
        }
    }
}

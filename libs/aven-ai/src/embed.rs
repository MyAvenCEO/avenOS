//! On-device text embeddings via **EmbeddingGemma-300m (ONNX)** on onnxruntime (`ort`,
//! load-dynamic) — the encoder counterpart to the [`crate::llm`] / [`crate::llama`]
//! generation paths. Mirrors their patterns: a load-dynamic runtime (init once via
//! [`crate::llm::init_runtime`] / the app's dylib path), a HF `tokenizers` tokenizer, and a
//! model spec that reuses the shared [`crate::download`] mechanics.
//!
//! `embed` is blocking (a single encoder forward pass); wrap the [`Embedder`] in an `Arc`
//! and call it from a worker thread (`spawn_blocking`).

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use tokenizers::Tokenizer;

/// A downloadable ONNX embedding model: files fetched individually from a HF repo.
pub struct EmbedModelSpec {
    /// Directory under the models root the files download into.
    pub dir: &'static str,
    /// HF repo (for [`crate::download`]).
    pub repo: &'static str,
    /// ONNX graph path, relative to the model dir.
    pub onnx: &'static str,
    /// Tokenizer JSON, relative to the model dir.
    pub tokenizer: &'static str,
    /// All files to fetch on first run.
    pub files: &'static [&'static str],
    /// Output embedding dimensionality (after any Matryoshka truncation).
    pub dim: usize,
}

/// Initialize the onnxruntime runtime from a bundled `libonnxruntime` (load-dynamic),
/// once per process. Safe to call alongside [`crate::llm::init_runtime`] — both register
/// the same global env; the first commit wins and the rest are harmless no-ops.
pub fn init_runtime(dylib_path: &Path) -> Result<(), String> {
    static INIT: OnceLock<Result<(), String>> = OnceLock::new();
    INIT.get_or_init(|| {
        ort::init_from(dylib_path)
            .map_err(|e| format!("onnxruntime load {}: {e}", dylib_path.display()))?
            .with_name("avenos-embed")
            .commit();
        Ok(())
    })
    .clone()
}

impl EmbedModelSpec {
    pub fn model_dir(&self, root: &Path) -> PathBuf {
        root.join(self.dir)
    }
    pub fn files_present(&self, root: &Path) -> bool {
        let dir = self.model_dir(root);
        self.files.iter().all(|f| dir.join(f).exists())
    }
}

/// Default embedder: EmbeddingGemma-300m ONNX (onnx-community export), 768-dim
/// (Matryoshka-truncatable — set `dim` lower to truncate).
pub const EMBEDDINGGEMMA_300M: EmbedModelSpec = EmbedModelSpec {
    dir: "embeddinggemma-300m-onnx",
    repo: "onnx-community/embeddinggemma-300m-ONNX",
    // Full-precision fp32: a 480 KB graph + a 1.23 GB external-data sidecar. Recall quality is the
    // foundation everything else stands on, so we ship the best embeddings (not a quantized
    // variant). The `.onnx` references its `.onnx_data` by relative name, so BOTH must download
    // into the same dir; omitting the sidecar (the old bug) left the model unloadable and the
    // brain stuck on the stub embedder.
    onnx: "onnx/model.onnx",
    tokenizer: "tokenizer.json",
    files: &[
        "onnx/model.onnx",
        "onnx/model.onnx_data",
        "tokenizer.json",
        "config.json",
    ],
    dim: 768,
};

/// EmbeddingGemma's task prefixes for asymmetric retrieval. Prefix documents at ingest
/// and queries at search so they share the trained instruction space.
pub const DOCUMENT_PREFIX: &str = "title: none | text: ";
pub const QUERY_PREFIX: &str = "task: search result | query: ";

/// A loaded EmbeddingGemma encoder. `Send + Sync` (session behind a `Mutex`).
pub struct Embedder {
    session: Mutex<Session>,
    tokenizer: Tokenizer,
    input_names: Vec<String>,
    dim: usize,
}

impl Embedder {
    /// Load the ONNX session + tokenizer from the model files under `root`. Blocking
    /// (mmaps the graph); load on a dedicated thread. The onnxruntime runtime must
    /// already be initialized (see [`crate::llm::init_runtime`]).
    pub fn load(spec: &EmbedModelSpec, root: &Path) -> Result<Self, String> {
        let dir = spec.model_dir(root);
        let tokenizer = Tokenizer::from_file(dir.join(spec.tokenizer))
            .map_err(|e| format!("load tokenizer: {e}"))?;
        let threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        let session = Session::builder()
            .map_err(|e| format!("session builder: {e}"))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| format!("opt level: {e}"))?
            .with_intra_threads(threads)
            .map_err(|e| format!("threads: {e}"))?
            .commit_from_file(dir.join(spec.onnx))
            .map_err(|e| format!("load model {}: {e}", spec.onnx))?;
        let input_names = session.inputs().iter().map(|i| i.name().to_string()).collect();
        Ok(Self {
            session: Mutex::new(session),
            tokenizer,
            input_names,
            dim: spec.dim,
        })
    }

    pub fn dim(&self) -> usize {
        self.dim
    }

    /// Embed `text` into a `dim`-length L2-normalized vector. Pass the task-prefixed text
    /// ([`DOCUMENT_PREFIX`] / [`QUERY_PREFIX`]) for asymmetric retrieval.
    pub fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        let enc = self
            .tokenizer
            .encode(text, true)
            .map_err(|e| format!("tokenize: {e}"))?;
        let ids: Vec<i64> = enc.get_ids().iter().map(|&t| t as i64).collect();
        let mask: Vec<i64> = enc.get_attention_mask().iter().map(|&m| m as i64).collect();
        let seq = ids.len() as i64;
        if seq == 0 {
            return Ok(vec![0.0; self.dim]);
        }

        let mut inputs: Vec<(String, ort::session::SessionInputValue)> = vec![(
            "input_ids".to_string(),
            Tensor::from_array((vec![1i64, seq], ids))
                .map_err(|e| format!("input_ids: {e}"))?
                .into(),
        )];
        if self.input_names.iter().any(|n| n == "attention_mask") {
            inputs.push((
                "attention_mask".to_string(),
                Tensor::from_array((vec![1i64, seq], mask.clone()))
                    .map_err(|e| format!("attention_mask: {e}"))?
                    .into(),
            ));
        }
        if self.input_names.iter().any(|n| n == "token_type_ids") {
            inputs.push((
                "token_type_ids".to_string(),
                Tensor::from_array((vec![1i64, seq], vec![0i64; seq as usize]))
                    .map_err(|e| format!("token_type_ids: {e}"))?
                    .into(),
            ));
        }

        // Run + pool inside the lock (the `outputs` borrow the session); an owned
        // vector escapes. Prefer a pooled 2D output ([1, D]); else mean-pool 3D.
        let mut pooled = {
            let mut session = self.session.lock().map_err(|_| "session lock poisoned")?;
            let outputs = session.run(inputs).map_err(|e| format!("run: {e}"))?;
            pooled_2d(&outputs)
                .or_else(|| mean_pool_3d(&outputs, &mask))
                .ok_or("no usable embedding output (expected 2D pooled or 3D last_hidden_state)")?
        };
        l2_normalize(&mut pooled);
        if pooled.len() > self.dim {
            pooled.truncate(self.dim); // Matryoshka truncation
            l2_normalize(&mut pooled);
        }
        Ok(pooled)
    }
}

/// First 2D `[1, D]` output (already-pooled sentence embedding), if present.
fn pooled_2d(outputs: &ort::session::SessionOutputs) -> Option<Vec<f32>> {
    for name in ["sentence_embedding", "pooler_output", "embedding"] {
        if let Some(v) = outputs.get(name) {
            if let Ok((shape, data)) = v.try_extract_tensor::<f32>() {
                let shape: Vec<i64> = shape.iter().copied().collect();
                if shape.len() == 2 {
                    return Some(data.to_vec());
                }
            }
        }
    }
    None
}

/// Mean-pool a 3D `[1, S, H]` hidden state over tokens, weighted by the attention mask.
fn mean_pool_3d(outputs: &ort::session::SessionOutputs, mask: &[i64]) -> Option<Vec<f32>> {
    for name in ["last_hidden_state", "token_embeddings"] {
        let Some(v) = outputs.get(name) else { continue };
        let Ok((shape, data)) = v.try_extract_tensor::<f32>() else {
            continue;
        };
        let shape: Vec<i64> = shape.iter().copied().collect();
        if shape.len() != 3 {
            continue;
        }
        let (s, h) = (shape[1] as usize, shape[2] as usize);
        let mut acc = vec![0.0f32; h];
        let mut denom = 0.0f32;
        for t in 0..s {
            let w = if t < mask.len() { mask[t] as f32 } else { 1.0 };
            if w == 0.0 {
                continue;
            }
            denom += w;
            let base = t * h;
            for (j, a) in acc.iter_mut().enumerate() {
                *a += w * data[base + j];
            }
        }
        if denom > 0.0 {
            for a in &mut acc {
                *a /= denom;
            }
        }
        return Some(acc);
    }
    None
}

fn l2_normalize(v: &mut [f32]) {
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if n > 0.0 {
        for x in v {
            *x /= n;
        }
    }
}

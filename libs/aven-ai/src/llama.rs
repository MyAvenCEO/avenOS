//! On-device LLM via **llama.cpp** (GGUF), with **Metal** on Apple Silicon. Built static
//! from source (the library lives *in* the executable) — so there is NO runtime dylib to
//! bundle or codesign, and the App-Store strip/sign saga the ONNX path required is gone.
//! Same `.gguf` runs on macOS and iOS. This is the spike entry point.

use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::time::Instant;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;

pub use crate::download::DownloadError;

/// A downloadable llama.cpp GGUF model: a single file fetched from a HF repo into
/// `<root>/<dir>/<file>`. Mirrors [`crate::llm::LlmModelSpec`] but for one GGUF — llama.cpp
/// embeds the tokenizer + chat template, so there are no sidecar files.
#[derive(Clone, Copy, Debug)]
pub struct LlamaModelSpec {
	/// Directory under the models root the GGUF downloads into.
	pub dir: &'static str,
	/// Base URL the `file` is resolved against (a HF `.../resolve/main/`).
	pub base_url: &'static str,
	/// The GGUF filename (also its remote subpath under `base_url`).
	pub file: &'static str,
}

/// LFM2.5-8B-A1B, Q4_K_M GGUF (LiquidAI official). Run on Metal via llama.cpp.
pub const LFM2_5_8B_A1B: LlamaModelSpec = LlamaModelSpec {
	dir: "lfm2.5-8b-a1b-gguf",
	base_url: "https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF/resolve/main/",
	file: "LFM2.5-8B-A1B-Q4_K_M.gguf",
};

impl LlamaModelSpec {
	pub fn model_path(&self, root: &Path) -> PathBuf {
		root.join(self.dir).join(self.file)
	}
	pub fn is_present(&self, root: &Path) -> bool {
		self.model_path(root).is_file()
	}
}

/// Download the GGUF into `<root>/<dir>/` via the SAME resumable + progress downloader the
/// ONNX and STT model paths use — so the model-download UI behaves identically (resumable
/// across restarts, smooth bar). Blocking; run on a thread. `cancelled()` is polled per
/// chunk; `on_progress(received, total)` drives the UI bar.
pub fn download(
	spec: &LlamaModelSpec,
	root: &Path,
	cancelled: impl Fn() -> bool,
	on_progress: impl FnMut(u64, u64),
) -> Result<(), DownloadError> {
	let dir = root.join(spec.dir);
	crate::download::download_files(&dir, spec.base_url, &[(spec.file, spec.file)], cancelled, on_progress)?;
	if !spec.is_present(root) {
		return Err(DownloadError::Failed("GGUF missing after download".into()));
	}
	Ok(())
}

/// Outcome of a generation run — the decoded text plus the decode throughput.
pub struct GenStats {
	pub text: String,
	pub tokens: usize,
	pub tokens_per_sec: f64,
}

/// Process-global llama.cpp backend (ggml init runs exactly once; the `metal` feature selects
/// the GPU backend at build time). Init failure means no compute backend at all (Metal/GPU
/// stack unavailable) — catastrophic and unrecoverable, hence the panic.
fn backend() -> &'static LlamaBackend {
	static BACKEND: std::sync::OnceLock<LlamaBackend> = std::sync::OnceLock::new();
	BACKEND.get_or_init(|| LlamaBackend::init().expect("llama.cpp backend init failed"))
}

/// A GGUF model kept resident in memory, so generations don't re-read 4.7 GB each turn. All
/// layers are offloaded to the GPU (Metal). Load once, cache it, reuse across turns; every
/// `generate` spins up a fresh context.
pub struct LlamaEngine {
	model: LlamaModel,
}

impl LlamaEngine {
	/// Load a GGUF with every layer on the GPU (Metal). Expensive — call once and cache.
	pub fn load(model_path: &Path) -> Result<Self, String> {
		let params = LlamaModelParams::default().with_n_gpu_layers(1_000_000);
		let model = LlamaModel::load_from_file(backend(), model_path, &params)
			.map_err(|e| format!("load model: {e}"))?;
		Ok(Self { model })
	}

	/// Greedily decode up to `max_tokens` continuations of `prompt`, calling `on_token` with
	/// each decoded piece (live streaming) and stopping early when `cancelled()` flips.
	/// Returns the full text + tok/s.
	pub fn generate(
		&self,
		prompt: &str,
		max_tokens: usize,
		mut on_token: impl FnMut(&str),
		cancelled: impl Fn() -> bool,
	) -> Result<GenStats, String> {
		let ctx_params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(4096));
		let mut ctx = self
			.model
			.new_context(backend(), ctx_params)
			.map_err(|e| format!("new context: {e}"))?;

		let tokens = self
			.model
			.str_to_token(prompt, AddBos::Always)
			.map_err(|e| format!("tokenize: {e}"))?;
		let n_prompt = tokens.len();

		let mut batch = LlamaBatch::new(512, 1);
		let last = tokens.len().saturating_sub(1);
		for (i, &tok) in tokens.iter().enumerate() {
			batch.add(tok, i as i32, &[0], i == last).map_err(|e| format!("batch add: {e}"))?;
		}
		ctx.decode(&mut batch).map_err(|e| format!("decode prompt: {e}"))?;

		let mut sampler = LlamaSampler::greedy();
		let mut text = String::new();
		let mut n_cur = n_prompt as i32;
		let mut produced = 0usize;
		let t0 = Instant::now();

		for _ in 0..max_tokens {
			if cancelled() {
				break;
			}
			let token = sampler.sample(&ctx, batch.n_tokens() - 1);
			sampler.accept(token);
			if self.model.is_eog_token(token) {
				break;
			}
			// Non-deprecated detok: explicit buffer (64 is ample for a single token's bytes),
			// `special = false` (render plain text), no left-strip.
			let bytes = self
				.model
				.token_to_piece_bytes(token, 64, false, None)
				.map_err(|e| format!("detok: {e}"))?;
			let piece = String::from_utf8_lossy(&bytes);
			on_token(piece.as_ref());
			text.push_str(&piece);
			produced += 1;

			batch.clear();
			batch.add(token, n_cur, &[0], true).map_err(|e| format!("batch add gen: {e}"))?;
			n_cur += 1;
			ctx.decode(&mut batch).map_err(|e| format!("decode gen: {e}"))?;
		}

		let secs = t0.elapsed().as_secs_f64();
		let tokens_per_sec = if secs > 0.0 { produced as f64 / secs } else { 0.0 };
		Ok(GenStats { text, tokens: produced, tokens_per_sec })
	}
}

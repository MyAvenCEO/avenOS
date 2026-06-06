//! On-device LLM via **llama.cpp** (GGUF), with **Metal** on Apple Silicon. Built static
//! from source (the library lives *in* the executable) — so there is NO runtime dylib to
//! bundle or codesign, and the App-Store strip/sign saga the ONNX path required is gone.
//! Same `.gguf` runs on macOS and iOS. This is the spike entry point.

use std::num::NonZeroU32;
use std::path::Path;
use std::time::Instant;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel, Special};
use llama_cpp_2::sampling::LlamaSampler;

/// Outcome of a generation run — the decoded text plus the decode throughput.
pub struct GenStats {
	pub text: String,
	pub tokens: usize,
	pub tokens_per_sec: f64,
}

/// Load a GGUF model (all layers offloaded to the GPU → Metal) and greedily decode up to
/// `max_tokens` continuations of `prompt`. Returns the text + tok/s.
pub fn generate(model_path: &Path, prompt: &str, max_tokens: usize) -> Result<GenStats, String> {
	let backend = LlamaBackend::init().map_err(|e| format!("backend init: {e}"))?;

	// Offload EVERY layer to the GPU (Metal on Apple). This is the lever vs ONNX-on-CPU.
	let model_params = LlamaModelParams::default().with_n_gpu_layers(1_000_000);
	let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
		.map_err(|e| format!("load model: {e}"))?;

	let ctx_params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(4096));
	let mut ctx = model
		.new_context(&backend, ctx_params)
		.map_err(|e| format!("new context: {e}"))?;

	let tokens = model
		.str_to_token(prompt, AddBos::Always)
		.map_err(|e| format!("tokenize: {e}"))?;
	let n_prompt = tokens.len();

	let mut batch = LlamaBatch::new(512, 1);
	let last = tokens.len().saturating_sub(1);
	for (i, &tok) in tokens.iter().enumerate() {
		batch
			.add(tok, i as i32, &[0], i == last)
			.map_err(|e| format!("batch add: {e}"))?;
	}
	ctx.decode(&mut batch).map_err(|e| format!("decode prompt: {e}"))?;

	let mut sampler = LlamaSampler::greedy();
	let mut text = String::new();
	let mut n_cur = n_prompt as i32;
	let mut produced = 0usize;
	let t0 = Instant::now();

	for _ in 0..max_tokens {
		let token = sampler.sample(&ctx, batch.n_tokens() - 1);
		sampler.accept(token);
		if model.is_eog_token(token) {
			break;
		}
		let bytes = model
			.token_to_bytes(token, Special::Plaintext)
			.map_err(|e| format!("detok: {e}"))?;
		text.push_str(&String::from_utf8_lossy(&bytes));
		produced += 1;

		batch.clear();
		batch
			.add(token, n_cur, &[0], true)
			.map_err(|e| format!("batch add gen: {e}"))?;
		n_cur += 1;
		ctx.decode(&mut batch).map_err(|e| format!("decode gen: {e}"))?;
	}

	let secs = t0.elapsed().as_secs_f64();
	let tokens_per_sec = if secs > 0.0 { produced as f64 / secs } else { 0.0 };
	Ok(GenStats { text, tokens: produced, tokens_per_sec })
}

//! On-device text generation via onnxruntime (`ort`) — LFM2.5-8B-A1B ONNX.
//!
//! Tauri-free, mirroring [`crate::stt`]: the caller passes a models-root dir, a
//! `cancelled` predicate and a progress sink for the download, and a token sink
//! for streaming generation. `Generator` wraps a `Send + Sync` session so the
//! caller can cache it in an `Arc` and run `generate` on a blocking thread.
//!
//! ## Why `ort` and not sherpa-onnx
//! sherpa-onnx exposes only speech recognizers. This module uses the
//! general-purpose `ort` onnxruntime bindings in **`load-dynamic`** mode: the
//! onnxruntime library is loaded at runtime from a path the caller provides
//! ([`init_runtime`]) — a dylib that ships *inside* the app bundle (signed,
//! App-Store/TestFlight-safe). That also means we never statically link a second
//! onnxruntime alongside the one `sherpa-onnx-sys` embeds, so there is no
//! duplicate-symbol clash.
//!
//! ## Model shape (`lfm2_moe`, hybrid)
//! LFM2 interleaves `conv` and `full_attention` blocks, so the ONNX graph has
//! **two** cache families threaded between steps: `past_key_values.*` (attention)
//! and `past_conv.*` (conv). We don't hard-code layer counts or exact names — at
//! [`Generator::load`] we enumerate the session's inputs/outputs and pair each
//! `past_*` input with its `present*` output by name, logging the discovered
//! wiring so it can be verified/hardened on the first real device run.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use half::f16;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use tokenizers::Tokenizer;

use crate::onnx::{self, pair_caches, CacheData, CacheSpec};

// Re-export the shared onnxruntime primitives so the Tauri adapter keeps using
// `aven_ai::llm::{init_runtime, DownloadError}` unchanged.
pub use crate::onnx::{init_runtime, DownloadError};

/// A downloadable ONNX LLM: a set of files fetched individually from a HF repo
/// (the `.onnx` graph + its external-weight `.onnx_data` sidecars + tokenizer/
/// config JSON), all landing flat under `<root>/<dir>/`.
#[derive(Clone, Copy, Debug)]
pub struct LlmModelSpec {
	/// Directory under the models root the files download into.
	pub dir: &'static str,
	/// Base URL the `files` are resolved against (e.g. a HF `.../resolve/main/`).
	pub base_url: &'static str,
	/// `(remote_subpath, local_filename)` pairs. The local filename is flat so the
	/// `.onnx` graph finds its `.onnx_data` sidecars as siblings.
	pub files: &'static [(&'static str, &'static str)],
	/// The graph file (local filename) to load the session from.
	pub onnx: &'static str,
	/// The HF `tokenizer.json` (local filename).
	pub tokenizer: &'static str,
}

impl LlmModelSpec {
	pub fn model_dir(&self, root: &Path) -> PathBuf {
		root.join(self.dir)
	}

	/// True when every required file is present on disk.
	pub fn files_present(&self, root: &Path) -> bool {
		onnx::files_present(root, self.dir, self.files)
	}
}

/// Download each file in `spec` into `<root>/<spec.dir>/`. Thin wrapper over the
/// shared [`crate::onnx::download_files`]. Blocking — run on a dedicated thread.
pub fn download_files(
	spec: &LlmModelSpec,
	root: &Path,
	cancelled: impl Fn() -> bool,
	on_progress: impl FnMut(u64, u64),
) -> Result<(), DownloadError> {
	onnx::download_files(root, spec.dir, spec.base_url, spec.files, cancelled, on_progress)
}

/// A loaded ONNX text generator. `Send + Sync` (the session lives behind a
/// `Mutex`), so wrap in an `Arc` and call `generate` from a blocking thread.
pub struct Generator {
	session: Mutex<Session>,
	tokenizer: Tokenizer,
	caches: Vec<CacheSpec>,
	eos_ids: Vec<u32>,
}

/// Knobs for a generation run. Greedy by default (deterministic first cut).
#[derive(Clone, Copy, Debug)]
pub struct GenerateOptions {
	pub max_new_tokens: usize,
}

impl Default for GenerateOptions {
	fn default() -> Self {
		Self { max_new_tokens: 512 }
	}
}

impl Generator {
	/// Load the session + tokenizer from the model files under `root`. Blocking
	/// (mmaps multi-GB weights); run on a dedicated thread. [`init_runtime`] must
	/// have been called first.
	pub fn load(spec: &LlmModelSpec, root: &Path) -> Result<Self, String> {
		let dir = spec.model_dir(root);
		let onnx = dir.join(spec.onnx);
		let tok_path = dir.join(spec.tokenizer);

		let tokenizer =
			Tokenizer::from_file(&tok_path).map_err(|e| format!("load tokenizer: {e}"))?;

		// CPU execution provider for op-coverage correctness on the hybrid MoE graph.
		// (CoreML/Metal EP is a later optimization; not all lfm2_moe ops are covered
		// by those EPs yet, and onnxruntime silently falls back per-op anyway.)
		let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
		let session = Session::builder()
			.map_err(|e| format!("session builder: {e}"))?
			.with_optimization_level(GraphOptimizationLevel::Level3)
			.map_err(|e| format!("opt level: {e}"))?
			.with_intra_threads(threads)
			.map_err(|e| format!("threads: {e}"))?
			.commit_from_file(&onnx)
			.map_err(|e| format!("load model {}: {e}", onnx.display()))?;

		let caches = pair_caches(&session);
		log::info!(
			target: "avenos::llm",
			"loaded {} ({} cache tensors): inputs=[{}] outputs=[{}]",
			spec.dir,
			caches.len(),
			session.inputs().iter().map(|o| o.name()).collect::<Vec<_>>().join(", "),
			session.outputs().iter().map(|o| o.name()).collect::<Vec<_>>().join(", "),
		);

		// EOS / stop tokens: the config's `eos_token_id` (124900 = `<|im_end|>`).
		// Resolve `<|im_end|>` through the tokenizer too in case ids shift.
		let mut eos_ids = vec![124900u32];
		if let Some(id) = tokenizer.token_to_id("<|im_end|>") {
			if !eos_ids.contains(&id) {
				eos_ids.push(id);
			}
		}

		Ok(Self {
			session: Mutex::new(session),
			tokenizer,
			caches,
			eos_ids,
		})
	}

	/// Build the LFM2 chat-formatted prompt and stream-generate a reply. `on_token`
	/// is called with each decoded text piece as it is produced; the full reply is
	/// also returned. `cancelled()` is polled each step. Blocking — run on a
	/// dedicated thread.
	pub fn generate(
		&self,
		prompt: &str,
		opts: GenerateOptions,
		mut on_token: impl FnMut(&str),
		cancelled: impl Fn() -> bool,
	) -> Result<String, String> {
		let templated = lfm2_chat_prompt(prompt);
		let encoding = self
			.tokenizer
			.encode(templated, false)
			.map_err(|e| format!("tokenize: {e}"))?;
		let mut tokens: Vec<i64> = encoding.get_ids().iter().map(|&t| t as i64).collect();
		if tokens.is_empty() {
			return Ok(String::new());
		}

		let mut session = self.session.lock().map_err(|_| "session lock poisoned")?;

		// The graph's declared input names — feed ONLY what the model actually accepts. LFM2
		// (and other exports) may omit `position_ids` and/or `attention_mask`; passing an
		// undeclared input fails with "Invalid input name". Resilient to any export.
		let model_input_names: std::collections::HashSet<String> =
			session.inputs().iter().map(|i| i.name().to_string()).collect();

		// Owned caches keyed by INPUT name; start empty (past length 0).
		let mut cache_vals: BTreeMap<String, (Vec<i64>, CacheData)> = self
			.caches
			.iter()
			.map(|c| (c.input_name.clone(), (c.empty_shape.clone(), CacheData::empty(c.ty))))
			.collect();

		let mut produced = String::new();
		let mut prev_decoded = String::new();
		let mut produced_ids: Vec<u32> = Vec::new();
		let mut past_len: i64 = 0;
		let mut step_tokens = tokens.clone(); // first step feeds the whole prompt

		for _ in 0..opts.max_new_tokens {
			if cancelled() {
				break;
			}
			let cur = step_tokens.len() as i64;
			let total = past_len + cur;

			// Static inputs for this step — ONLY those the graph declares (see above).
			let input_ids = Tensor::from_array((vec![1i64, cur], step_tokens.clone()))
				.map_err(|e| format!("input_ids: {e}"))?;
			let mut inputs: Vec<(String, ort::session::SessionInputValue)> =
				vec![("input_ids".to_string(), input_ids.into())];
			if model_input_names.contains("attention_mask") {
				let attention_mask =
					Tensor::from_array((vec![1i64, total], vec![1i64; total as usize]))
						.map_err(|e| format!("attention_mask: {e}"))?;
				inputs.push(("attention_mask".to_string(), attention_mask.into()));
			}
			if model_input_names.contains("position_ids") {
				let position_ids =
					Tensor::from_array((vec![1i64, cur], (past_len..total).collect::<Vec<i64>>()))
						.map_err(|e| format!("position_ids: {e}"))?;
				inputs.push(("position_ids".to_string(), position_ids.into()));
			}
			for (name, (shape, data)) in &cache_vals {
				inputs.push((name.clone(), data.to_value(shape)?));
			}

			let outputs = session.run(inputs).map_err(|e| format!("run: {e}"))?;

			// Argmax over the last position's logits → next token.
			let next = argmax_last_token(&outputs).map_err(|e| format!("logits: {e}"))?;

			// Roll present_* outputs into the past_* caches for the next step.
			let mut next_caches: BTreeMap<String, (Vec<i64>, CacheData)> = BTreeMap::new();
			for c in &self.caches {
				let (shape, data) = CacheData::extract(&outputs, &c.output_name)
					.map_err(|e| format!("cache {}: {e}", c.output_name))?;
				next_caches.insert(c.input_name.clone(), (shape, data));
			}
			drop(outputs);
			cache_vals = next_caches;

			past_len = total;
			if self.eos_ids.contains(&next) {
				break;
			}
			produced_ids.push(next);

			// Incremental detokenization: decode the whole produced sequence and emit
			// only the newly-appended suffix (handles multi-token graphemes cleanly).
			let decoded = self
				.tokenizer
				.decode(&produced_ids, true)
				.map_err(|e| format!("decode: {e}"))?;
			if decoded.len() > prev_decoded.len() {
				let piece = decoded[prev_decoded.len()..].to_string();
				produced.push_str(&piece);
				on_token(&piece);
				prev_decoded = decoded;
			}

			step_tokens = vec![next as i64];
			tokens.push(next as i64);
		}

		Ok(produced)
	}
}

/// Wrap the user's message in the LFM2 ChatML template. BOS `<|startoftext|>`,
/// turns delimited by `<|im_start|>{role}\n … <|im_end|>`, ending with an open
/// assistant turn for the model to complete. (The special-token strings are in the
/// tokenizer's added vocab, so they encode to single ids.)
fn lfm2_chat_prompt(user: &str) -> String {
	format!(
		"<|startoftext|><|im_start|>system\nYou are Aven, a concise and helpful on-device assistant.<|im_end|>\n<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n"
	)
}

/// Argmax over the vocab axis of the final position of `logits` (`[1, seq, vocab]`).
/// Handles f16 and f32 logit tensors.
fn argmax_last_token(outputs: &ort::session::SessionOutputs) -> Result<u32, String> {
	let logits = &outputs["logits"];
	if let Ok((shape, data)) = logits.try_extract_tensor::<f16>() {
		let vocab = *shape.last().ok_or("empty logits shape")? as usize;
		let start = data.len().saturating_sub(vocab);
		return Ok(argmax_f32(data[start..].iter().map(|h| h.to_f32())));
	}
	let (shape, data) = logits
		.try_extract_tensor::<f32>()
		.map_err(|e| format!("extract logits: {e}"))?;
	let vocab = *shape.last().ok_or("empty logits shape")? as usize;
	let start = data.len().saturating_sub(vocab);
	Ok(argmax_f32(data[start..].iter().copied()))
}

fn argmax_f32(iter: impl Iterator<Item = f32>) -> u32 {
	let mut best = 0u32;
	let mut best_v = f32::NEG_INFINITY;
	for (i, v) in iter.enumerate() {
		if v > best_v {
			best_v = v;
			best = i as u32;
		}
	}
	best
}

#[cfg(test)]
mod tests {
	use super::*;

	/// Validates the riskiest integration point without the 4.7 GB model: that
	/// `ort` (load-dynamic, api-24) can load the bundled onnxruntime dylib and that
	/// the dylib actually supports `GetApi(24)` (a version mismatch panics here).
	/// Skips when `AVENOS_ORT_DYLIB` isn't set, so CI without the dylib stays green.
	#[test]
	fn ort_dylib_loads_and_api_matches() {
		let Ok(path) = std::env::var("AVENOS_ORT_DYLIB") else {
			eprintln!("skipping: AVENOS_ORT_DYLIB not set");
			return;
		};
		init_runtime(Path::new(&path)).expect("init onnxruntime from dylib");
		// Touching the session builder forces the first real onnxruntime API call
		// (GetApi(ORT_API_VERSION)); it would panic if the dylib were too old.
		ort::session::Session::builder().expect("create session builder");
	}
}

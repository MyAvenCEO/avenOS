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
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use half::f16;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::{Tensor, TensorElementType, ValueType};
use tokenizers::Tokenizer;

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
		let d = self.model_dir(root);
		self.files.iter().all(|(_, name)| d.join(name).is_file())
	}
}

/// Outcome of a model download (mirrors [`crate::stt::DownloadError`]).
#[derive(Debug)]
pub enum DownloadError {
	Cancelled,
	Failed(String),
}

impl std::fmt::Display for DownloadError {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			DownloadError::Cancelled => write!(f, "download cancelled"),
			DownloadError::Failed(e) => write!(f, "{e}"),
		}
	}
}

impl std::error::Error for DownloadError {}

const EMIT_STEP: u64 = 8 * 1024 * 1024;

/// Download each file in `spec` into `<root>/<spec.dir>/`. Blocking — run on a
/// dedicated thread. `cancelled()` is polled every chunk; `on_progress(received,
/// total)` reports cumulative bytes across all files.
///
/// **Resilient**: each file streams to `<local>.part` and is renamed only when
/// complete, so finished files are never re-fetched. A partial `.part` resumes
/// via an HTTP `Range` request (the body continues where it left off); if the
/// server ignores the range (`200`) that one file restarts cleanly, and a `416`
/// means the `.part` is already complete (finalize it). Cancelling keeps the
/// `.part` so the next attempt continues — a 4.7 GB pull survives app restarts.
pub fn download_files(
	spec: &LlmModelSpec,
	root: &Path,
	cancelled: impl Fn() -> bool,
	mut on_progress: impl FnMut(u64, u64),
) -> Result<(), DownloadError> {
	let fail = |e: String| DownloadError::Failed(e);
	let dir = spec.model_dir(root);
	fs::create_dir_all(&dir).map_err(|e| fail(format!("create model dir: {e}")))?;

	// Pass 1 — compute the FULL grand total (and bytes already on disk) up front so
	// the progress bar has a stable denominator. Without this, `total` grew as each
	// file's Content-Length arrived, so the bar filled to one sidecar (~2 GB) then
	// jumped as the next started. Finished files (renamed) count toward both; a
	// partial `.part` counts toward `received`; the rest comes from a cheap HEAD
	// (which follows the HF redirect and returns the final Content-Length).
	let mut received: u64 = 0;
	let mut total: u64 = 0;
	for &(remote, local) in spec.files.iter() {
		if let Ok(meta) = dir.join(local).metadata() {
			received += meta.len();
			total += meta.len();
			continue;
		}
		let have = dir
			.join(format!("{local}.part"))
			.metadata()
			.map(|m| m.len())
			.unwrap_or(0);
		received += have;
		total += head_content_length(&format!("{}{}", spec.base_url, remote)).max(have);
	}
	on_progress(received, total);

	// Pass 2 — fetch each missing file, resuming a partial `.part` where possible.
	// `total` is already final; only newly-read bytes are added to `received`.
	for &(remote, local) in spec.files.iter() {
		let dest = dir.join(local);
		if dest.is_file() {
			continue; // already on disk + counted in pass 1
		}
		if cancelled() {
			return Err(DownloadError::Cancelled);
		}

		let tmp = dir.join(format!("{local}.part"));
		// Resume point: bytes of this file already on disk from a prior attempt.
		let resume_from = tmp.metadata().map(|m| m.len()).unwrap_or(0);

		let url = format!("{}{}", spec.base_url, remote);
		let mut req = ureq::get(&url);
		if resume_from > 0 {
			req = req.set("Range", &format!("bytes={resume_from}-"));
		}
		let resp = match req.call() {
			Ok(r) => r,
			// 416: the byte range is past EOF → the .part is already complete but
			// wasn't renamed (crash between flush and rename). Finalize it; its bytes
			// were already counted in pass 1.
			Err(ureq::Error::Status(416, _)) if resume_from > 0 => {
				fs::rename(&tmp, &dest).map_err(|e| fail(format!("finalize {local}: {e}")))?;
				continue;
			}
			Err(e) => return Err(fail(format!("download {local}: {e}"))),
		};

		// 206 Partial Content → the body continues from `resume_from`; append to the
		// .part. Anything else (200, or the server/redirect dropped our Range) → start
		// this one file over from scratch: drop the `resume_from` bytes we counted in
		// pass 1 so we don't double-count as they're re-received. Either way: no corruption.
		let resuming = resp.status() == 206 && resume_from > 0;
		let mut file = if resuming {
			std::fs::OpenOptions::new()
				.append(true)
				.open(&tmp)
				.map_err(|e| fail(format!("open {}: {e}", tmp.display())))?
		} else {
			if resume_from > 0 {
				received = received.saturating_sub(resume_from);
				on_progress(received, total);
			}
			File::create(&tmp).map_err(|e| fail(format!("create {}: {e}", tmp.display())))?
		};

		let mut reader = resp.into_reader();
		let mut buf = vec![0u8; 1024 * 1024];
		let mut last_emit = received;
		loop {
			if cancelled() {
				// Keep the .part so the next attempt resumes from here (don't delete).
				file.flush().ok();
				return Err(DownloadError::Cancelled);
			}
			let n = reader.read(&mut buf).map_err(|e| fail(format!("read {local}: {e}")))?;
			if n == 0 {
				break;
			}
			file.write_all(&buf[..n]).map_err(|e| fail(format!("write {local}: {e}")))?;
			received += n as u64;
			if received - last_emit >= EMIT_STEP {
				last_emit = received;
				on_progress(received, total);
			}
		}
		file.flush().ok();
		drop(file);
		fs::rename(&tmp, &dest).map_err(|e| fail(format!("finalize {local}: {e}")))?;
		on_progress(received, total);
	}

	if !spec.files_present(root) {
		return Err(fail("model files missing after download".into()));
	}
	Ok(())
}

/// HEAD a URL and return its `Content-Length` (ureq follows the redirect to the
/// CDN, so this is the final file's size). `0` when unavailable — the caller then
/// falls back to whatever bytes are already on disk.
fn head_content_length(url: &str) -> u64 {
	ureq::head(url)
		.call()
		.ok()
		.and_then(|r| r.header("Content-Length").and_then(|s| s.parse::<u64>().ok()))
		.unwrap_or(0)
}

/// Initialize the onnxruntime backend from a specific dylib path. Must be called
/// once, before the first [`Generator::load`]. Idempotent: subsequent calls (or a
/// call after the env is already committed) are a no-op `Ok`.
///
/// `dylib_path` is the onnxruntime shared library bundled in the app (e.g.
/// `…/Frameworks/onnxruntime.framework/onnxruntime` on Apple, `libonnxruntime.dylib`
/// on a dev Mac). Passing it here (rather than relying on the `ORT_DYLIB_PATH`
/// env var) keeps the path resolution in Rust where the app knows its bundle layout.
pub fn init_runtime(dylib_path: &Path) -> Result<(), String> {
	static INIT: OnceLock<Result<(), String>> = OnceLock::new();
	INIT.get_or_init(|| {
		// `init_from` loads the dylib (the fallible part); `commit` just registers
		// the env options globally and returns whether it took effect (false if a
		// prior commit already won the race — harmless here).
		ort::init_from(dylib_path)
			.map_err(|e| format!("onnxruntime load {}: {e}", dylib_path.display()))?
			.with_name("avenos-llm")
			.commit();
		Ok(())
	})
	.clone()
}

/// How a single cache tensor is shaped and typed, captured from the session's
/// input metadata at load so we can synthesize an empty (past-length 0) tensor and
/// know which element type to round-trip.
#[derive(Clone, Debug)]
struct CacheSpec {
	/// The model input name (e.g. `past_key_values.2.key`, `past_conv.0`).
	input_name: String,
	/// The matching output name that produces its next-step value.
	output_name: String,
	/// Static dims with the dynamic sequence/cache-length axis pinned to 0 for the
	/// initial empty cache. Other dynamic axes (rare) are also pinned to 0.
	empty_shape: Vec<i64>,
	/// Element type (almost always f16 for the q4f16 export).
	ty: TensorElementType,
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

			// Static inputs for this step.
			let input_ids = Tensor::from_array((vec![1i64, cur], step_tokens.clone()))
				.map_err(|e| format!("input_ids: {e}"))?;
			let attention_mask = Tensor::from_array((vec![1i64, total], vec![1i64; total as usize]))
				.map_err(|e| format!("attention_mask: {e}"))?;
			let position_ids = Tensor::from_array((
				vec![1i64, cur],
				(past_len..total).collect::<Vec<i64>>(),
			))
			.map_err(|e| format!("position_ids: {e}"))?;

			let mut inputs: Vec<(String, ort::session::SessionInputValue)> = vec![
				("input_ids".to_string(), input_ids.into()),
				("attention_mask".to_string(), attention_mask.into()),
				("position_ids".to_string(), position_ids.into()),
			];
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

/// Pair every `past_*` session input with the `present*` output that feeds it next
/// step, and capture the static (cache-length-0) shape + element type. Heuristic
/// name matching (logged at load); the dominant optimum/transformers.js convention
/// is `past_key_values.{i}.{key,value}` ↔ `present.{i}.{key,value}` and
/// `past_conv.{i}` ↔ `present_conv.{i}`.
fn pair_caches(session: &Session) -> Vec<CacheSpec> {
	let output_names: Vec<String> = session.outputs().iter().map(|o| o.name().to_string()).collect();

	let mut out = Vec::new();
	for input in session.inputs() {
		let name = input.name();
		if !name.starts_with("past") {
			continue;
		}
		let ValueType::Tensor { ty, shape, .. } = input.dtype() else {
			continue;
		};
		// Empty cache for step 0. A statically-known axis keeps its size. A dynamic axis
		// (-1) is either the BATCH axis (axis 0 → 1: we always run exactly one sequence) or
		// a length/cache axis (→ 0: empty at step 0). The old code pinned EVERY dynamic axis
		// to 0, so the batch axis became 0 → a 0-row tensor, which ORT rejects with
		// "all dimensions must be >= 1 when creating a tensor from raw data" (the cache-f16
		// error). Keeping batch = 1 fixes it while leaving the length axis empty.
		let empty_shape: Vec<i64> = shape
			.iter()
			.enumerate()
			.map(|(axis, &d)| {
				if d >= 0 {
					d
				} else if axis == 0 {
					1
				} else {
					0
				}
			})
			.collect();

		let candidate = name
			.replacen("past_key_values", "present", 1)
			.replacen("past_conv", "present_conv", 1)
			.replacen("past", "present", 1);
		let output_name = output_names
			.iter()
			.find(|o| **o == candidate)
			.or_else(|| {
				// Fallback: match by trailing dotted suffix (".{i}.key", ".{i}").
				let suffix = name.splitn(2, '.').nth(1);
				suffix.and_then(|s| output_names.iter().find(|o| o.ends_with(s)))
			})
			.cloned()
			.unwrap_or_else(|| candidate.clone());

		out.push(CacheSpec {
			input_name: name.to_string(),
			output_name,
			empty_shape,
			ty: *ty,
		});
	}
	out
}

/// Owned cache data in whichever element type the graph uses (f16 for q4f16, with
/// an f32 fallback for safety on other exports).
enum CacheData {
	F16(Vec<f16>),
	F32(Vec<f32>),
}

impl CacheData {
	fn empty(ty: TensorElementType) -> Self {
		match ty {
			TensorElementType::Float32 => CacheData::F32(Vec::new()),
			_ => CacheData::F16(Vec::new()),
		}
	}

	fn to_value(&self, shape: &[i64]) -> Result<ort::session::SessionInputValue<'static>, String> {
		match self {
			CacheData::F16(v) => Tensor::from_array((shape.to_vec(), v.clone()))
				.map(Into::into)
				.map_err(|e| format!("cache f16: {e}")),
			CacheData::F32(v) => Tensor::from_array((shape.to_vec(), v.clone()))
				.map(Into::into)
				.map_err(|e| format!("cache f32: {e}")),
		}
	}

	fn extract(
		outputs: &ort::session::SessionOutputs,
		name: &str,
	) -> Result<(Vec<i64>, CacheData), String> {
		let value = &outputs[name];
		if let Ok((shape, data)) = value.try_extract_tensor::<f16>() {
			return Ok((shape.iter().copied().collect(), CacheData::F16(data.to_vec())));
		}
		let (shape, data) = value
			.try_extract_tensor::<f32>()
			.map_err(|e| format!("extract {name}: {e}"))?;
		Ok((shape.iter().copied().collect(), CacheData::F32(data.to_vec())))
	}
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

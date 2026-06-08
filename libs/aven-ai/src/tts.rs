//! On-device text-to-speech via onnxruntime (`ort`) — MOSS-TTS-Nano.
//!
//! Tauri-free, mirroring [`crate::llm`]: the caller passes a models-root dir, a
//! `cancelled` predicate + progress sink for the download, and a PCM sink for the
//! streamed audio. `Synthesizer` wraps `Send + Sync` sessions so the caller can
//! cache it in an `Arc` and run `synthesize` on a blocking thread. It reuses the
//! shared [`crate::onnx`] primitives (bundled-dylib `init_runtime`, resilient
//! multi-file download, f16/f32 cache round-trip) and the same `load-dynamic`,
//! App-Store-safe onnxruntime path as the LLM.
//!
//! ## Pipeline (fixed built-in voice)
//! `text → tokenize → [prefill] → per-frame loop { [local_fixed_sampled_frame] →
//! 16 RVQ codes; [decode_step] advances the global transformer } → [codec decode]
//! → PCM`. This is a faithful port of the official Android ONNX-Runtime reference
//! engine (`examples/android_onnx_runtime/.../MossOnnxDemoEngine.kt`): four ONNX
//! graphs + a `browser_poc_manifest.json` that carries the token config, the text
//! prompt-template token ids, and the built-in voices' `prompt_audio_codes` (the
//! baked-in reference-speaker prefix — no codec *encoder* needed at runtime).
//!
//! Each token row is `nVq + 1` wide: column 0 is the text/slot token, columns
//! `1..=nVq` are the per-codebook audio tokens (padded with `audio_pad_token_id`).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use serde::Deserialize;
use tokenizers::Tokenizer;

use crate::onnx::CacheData;

// Re-export shared primitives so the Tauri adapter mirrors the llm one:
// `aven_ai::tts::{init_runtime, DownloadError}`. Downloads reuse the shared,
// engine-agnostic `crate::download` module (also used by `llm`/`llama`); the ort
// dylib init comes from `crate::onnx`.
pub use crate::download::DownloadError;
pub use crate::onnx::init_runtime;

/// A downloadable ONNX TTS model, fetched from **two** HF repos into one flat dir:
/// the backbone (`files`: 3 `.onnx` graphs + their `.data` weight sidecars + the
/// `browser_poc_manifest.json`) and the codec (`codec_files`: the decoder graph +
/// its `.data` sidecar). The `tokenizer.json` is NOT downloaded — upstream ships
/// only a sentencepiece `tokenizer.model`, so a verified fast `tokenizer.json` is
/// bundled with the app and the caller places it in this dir before [`Synthesizer::load`].
#[derive(Clone, Copy, Debug)]
pub struct TtsModelSpec {
	/// Directory under the models root the files download into (also the delete id).
	pub dir: &'static str,
	/// Base URL the backbone `files` are resolved against (a HF `.../resolve/main/`).
	pub base_url: &'static str,
	/// Backbone `(remote_subpath, local_filename)` pairs (3 graphs + `.data` sidecars
	/// + manifest), flat so each `.onnx` finds its sidecars as siblings.
	pub files: &'static [(&'static str, &'static str)],
	/// Base URL for the codec (audio-tokenizer) repo — a *separate* HF repo.
	pub codec_base_url: &'static str,
	/// Codec `(remote, local)` pairs (decoder graph + its `.data` sidecar), landing in
	/// the same flat dir as the backbone files.
	pub codec_files: &'static [(&'static str, &'static str)],
	/// Local filename of the prefill graph (text rows → global hidden + KV cache).
	pub prefill: &'static str,
	/// Local filename of the autoregressive global decode-step graph.
	pub decode_step: &'static str,
	/// Local filename of the fused local frame sampler (→ 16 RVQ codes + stop flag).
	pub local_frame: &'static str,
	/// Local filename of the codec decoder (RVQ frames → waveform).
	pub codec_decode: &'static str,
	/// Local filename of the `browser_poc_manifest.json` (token config + voices).
	pub manifest: &'static str,
	/// Local filename of the bundled `tokenizer.json` (placed in `dir` by the caller).
	pub tokenizer: &'static str,
}

impl TtsModelSpec {
	pub fn model_dir(&self, root: &Path) -> PathBuf {
		root.join(self.dir)
	}

	/// True when every downloaded file (both backbone + codec groups) is present on
	/// disk. The bundled `tokenizer.json` is checked separately by the caller.
	pub fn files_present(&self, root: &Path) -> bool {
		let d = self.model_dir(root);
		self.files
			.iter()
			.chain(self.codec_files.iter())
			.all(|(_, name)| d.join(name).is_file())
	}
}

/// Download both file groups in `spec` into `<root>/<spec.dir>/` (backbone repo then
/// codec repo). Thin wrapper over the shared [`crate::download::download_files`].
/// Blocking — run on a dedicated thread. Progress is reported per group (the bar
/// fills for the backbone, then again for the smaller codec).
pub fn download_files(
	spec: &TtsModelSpec,
	root: &Path,
	cancelled: impl Fn() -> bool,
	mut on_progress: impl FnMut(u64, u64),
) -> Result<(), DownloadError> {
	let dir = spec.model_dir(root);
	crate::download::download_files(&dir, spec.base_url, spec.files, &cancelled, &mut on_progress)?;
	crate::download::download_files(
		&dir,
		spec.codec_base_url,
		spec.codec_files,
		&cancelled,
		&mut on_progress,
	)
}

// ---- Manifest (`browser_poc_manifest.json`) -------------------------------------

/// Token-id / codebook config (the manifest's `tts_config` object).
#[derive(Clone, Debug, Deserialize)]
struct TtsConfig {
	n_vq: usize,
	audio_pad_token_id: i32,
	audio_start_token_id: i32,
	audio_end_token_id: i32,
	#[serde(default = "default_user_slot")]
	audio_user_slot_token_id: i32,
	audio_assistant_slot_token_id: i32,
	/// Per-codebook vocab sizes; the first entry sizes the repetition mask.
	audio_codebook_sizes: Vec<usize>,
}

fn default_user_slot() -> i32 {
	8
}

/// The structural text token ids that wrap the user text + voice prefix (the
/// manifest's `prompt_templates` object). These are pre-tokenized in the export.
#[derive(Clone, Debug, Deserialize)]
struct PromptTemplates {
	user_prompt_prefix_token_ids: Vec<i32>,
	user_prompt_after_reference_token_ids: Vec<i32>,
	assistant_prompt_prefix_token_ids: Vec<i32>,
}

#[derive(Clone, Debug, Deserialize)]
struct GenerationDefaults {
	#[serde(default = "default_max_frames")]
	max_new_frames: usize,
}

fn default_max_frames() -> usize {
	375
}

/// A built-in voice: its name + the reference-speaker RVQ frames (one inner vec of
/// `nVq` codes per frame) that seed the audio prefix — our "fixed voice".
#[derive(Clone, Debug, Deserialize)]
struct BuiltinVoice {
	#[serde(default)]
	voice: String,
	#[serde(default)]
	prompt_audio_codes: Vec<Vec<i32>>,
}

#[derive(Clone, Debug, Deserialize)]
struct Manifest {
	tts_config: TtsConfig,
	prompt_templates: PromptTemplates,
	#[serde(default)]
	generation_defaults: Option<GenerationDefaults>,
	#[serde(default)]
	builtin_voices: Vec<BuiltinVoice>,
	/// Output sample rate (Hz). Not always present in the top-level manifest; the
	/// codec sub-manifest carries it. Defaults to MOSS-TTS-Nano's native 48 kHz.
	#[serde(default = "default_sample_rate")]
	sample_rate: u32,
}

fn default_sample_rate() -> u32 {
	48_000
}

/// Knobs for a synthesis run.
#[derive(Clone, Debug)]
pub struct SynthOptions {
	/// Hard cap on generated frames (also bounded by the manifest default).
	pub max_frames: usize,
	/// Deterministic seed for the in-graph sampler's uniform draws.
	pub seed: u64,
	/// Built-in voice name; falls back to the first voice with prefix codes.
	pub voice: Option<String>,
}

impl Default for SynthOptions {
	fn default() -> Self {
		Self { max_frames: 375, seed: 1234, voice: None }
	}
}

/// A loaded MOSS-TTS-Nano synthesizer. `Send + Sync` (each session lives behind a
/// `Mutex`), so wrap in an `Arc` and call `synthesize` from a blocking thread.
pub struct Synthesizer {
	prefill: Mutex<Session>,
	decode: Mutex<Session>,
	local_frame: Mutex<Session>,
	codec: Mutex<Session>,
	tokenizer: Tokenizer,
	cfg: TtsConfig,
	prompts: PromptTemplates,
	/// Built-in voices' reference RVQ frames (the baked-in fixed voice prefix).
	voices: Vec<BuiltinVoice>,
	max_new_frames: usize,
	sample_rate: u32,
	/// Decode-step `past_*` input names (KV cache), in graph order.
	past_input_names: Vec<String>,
	/// Decode-step `present_*` output names (== prefill present names), in order.
	present_output_names: Vec<String>,
}

impl Synthesizer {
	/// Load the four sessions + tokenizer + manifest from the model files under
	/// `root`. Blocking; run on a dedicated thread. [`init_runtime`] must have been
	/// called first.
	pub fn load(spec: &TtsModelSpec, root: &Path) -> Result<Self, String> {
		let dir = spec.model_dir(root);

		let tokenizer = Tokenizer::from_file(dir.join(spec.tokenizer))
			.map_err(|e| format!("load tokenizer: {e}"))?;

		let manifest_bytes = std::fs::read(dir.join(spec.manifest))
			.map_err(|e| format!("read manifest: {e}"))?;
		let manifest: Manifest = serde_json::from_slice(&manifest_bytes)
			.map_err(|e| format!("parse manifest: {e}"))?;

		// NOTE: CPU execution provider. The CoreML EP (GPU/ANE) segfaults when registered
		// through ort's `load-dynamic` against the runtime-loaded onnxruntime dylib — an
		// ABI mismatch in `commit_from_file`. GPU offload for MOSS would need a statically
		// linked onnxruntime built with CoreML, not the bundled dylib.
		let build = |file: &str| -> Result<Session, String> {
			let path = dir.join(file);
			// 2 intra-op threads (not all cores). MOSS runs hundreds of tiny single-token
			// ops per clip; 8 threads = mostly dispatch/sync overhead. Benchmarked on M1:
			// 8 threads → RTF 1.55x (slower than real-time); 2 threads → RTF 0.94x (faster
			// than real-time, so streamed playback stays smooth). inter_op=1 like the
			// reference runtime. `AVENOS_TTS_THREADS` overrides for tuning.
			let threads = std::env::var("AVENOS_TTS_THREADS")
				.ok()
				.and_then(|s| s.parse::<usize>().ok())
				.filter(|&n| n > 0)
				.unwrap_or(2);
			Session::builder()
				.map_err(|e| format!("session builder: {e}"))?
				.with_optimization_level(GraphOptimizationLevel::Level3)
				.map_err(|e| format!("opt level: {e}"))?
				.with_intra_threads(threads)
				.map_err(|e| format!("threads: {e}"))?
				.with_inter_threads(1)
				.map_err(|e| format!("inter threads: {e}"))?
				.commit_from_file(&path)
				.map_err(|e| format!("load model {}: {e}", path.display()))
		};

		let prefill = build(spec.prefill)?;
		let decode = build(spec.decode_step)?;
		let local_frame = build(spec.local_frame)?;
		let codec = build(spec.codec_decode)?;

		// KV-cache wiring, positional (mirrors the reference engine's
		// decodeInputNames.drop(2) ↔ decodeOutputNames.drop(1)). The prefill graph's
		// present outputs share these same names, so the initial caches extract by the
		// same list.
		let past_input_names: Vec<String> = decode
			.inputs()
			.iter()
			.map(|i| i.name().to_string())
			.filter(|n| n.starts_with("past") && n != "past_valid_lengths")
			.collect();
		let present_output_names: Vec<String> = decode
			.outputs()
			.iter()
			.map(|o| o.name().to_string())
			.filter(|n| n != "global_hidden")
			.collect();

		log::info!(
			target: "avenos::tts",
			"loaded {} (n_vq={}, {} kv tensors, sr={}): voices=[{}]",
			spec.dir,
			manifest.tts_config.n_vq,
			past_input_names.len(),
			manifest.sample_rate,
			manifest.builtin_voices.iter().map(|v| v.voice.as_str()).collect::<Vec<_>>().join(", "),
		);

		let max_new_frames = manifest
			.generation_defaults
			.as_ref()
			.map(|g| g.max_new_frames)
			.unwrap_or_else(default_max_frames);

		Ok(Self {
			prefill: Mutex::new(prefill),
			decode: Mutex::new(decode),
			local_frame: Mutex::new(local_frame),
			codec: Mutex::new(codec),
			tokenizer,
			cfg: manifest.tts_config,
			prompts: manifest.prompt_templates,
			voices: manifest.builtin_voices,
			max_new_frames,
			sample_rate: manifest.sample_rate,
			past_input_names,
			present_output_names,
		})
	}

	/// Output sample rate (Hz) of the PCM passed to `on_pcm`.
	pub fn sample_rate(&self) -> u32 {
		self.sample_rate
	}

	/// Synthesize `text` into mono f32 PCM, streaming it through `on_pcm` in ~0.5 s
	/// tails as frames are generated (so playback can start before the whole clip is
	/// done). `cancelled()` is polled each frame. Blocking — run on a dedicated thread.
	pub fn synthesize(
		&self,
		text: &str,
		opts: SynthOptions,
		mut on_pcm: impl FnMut(&[f32]),
		cancelled: impl Fn() -> bool,
	) -> Result<(), String> {
		let n_vq = self.cfg.n_vq;
		let codebook = *self.cfg.audio_codebook_sizes.first().unwrap_or(&1024);
		let row_width = n_vq + 1;

		// 1) Tokenize the user text (structural tokens come from the manifest).
		let encoding =
			self.tokenizer.encode(text, false).map_err(|e| format!("tokenize: {e}"))?;
		let text_ids: Vec<i32> = encoding.get_ids().iter().map(|&t| t as i32).collect();
		if text_ids.is_empty() {
			return Ok(());
		}

		// 2) Assemble the prompt rows (width n_vq+1): user prefix (text col) + voice
		// prefix (audio cols) + suffix wrapping the user text (text col).
		let voice = self.select_voice(opts.voice.as_deref())?;
		let mut rows: Vec<i32> = Vec::new(); // flat, row-major
		let push_text = |tok: i32, rows: &mut Vec<i32>| {
			rows.push(tok);
			rows.extend(std::iter::repeat(self.cfg.audio_pad_token_id).take(n_vq));
		};
		let push_audio = |frame: &[i32], rows: &mut Vec<i32>| {
			rows.push(self.cfg.audio_user_slot_token_id);
			for c in 0..n_vq {
				rows.push(frame.get(c).copied().unwrap_or(self.cfg.audio_pad_token_id));
			}
		};

		for &t in &self.prompts.user_prompt_prefix_token_ids {
			push_text(t, &mut rows);
		}
		push_text(self.cfg.audio_start_token_id, &mut rows);
		for frame in &voice.prompt_audio_codes {
			push_audio(frame, &mut rows);
		}
		push_text(self.cfg.audio_end_token_id, &mut rows);
		for &t in &self.prompts.user_prompt_after_reference_token_ids {
			push_text(t, &mut rows);
		}
		for &t in &text_ids {
			push_text(t, &mut rows);
		}
		for &t in &self.prompts.assistant_prompt_prefix_token_ids {
			push_text(t, &mut rows);
		}
		push_text(self.cfg.audio_start_token_id, &mut rows);

		let seq_len = rows.len() / row_width;

		// 3) Prefill → global hidden + initial KV caches.
		let mut prefill = self.prefill.lock().map_err(|_| "prefill lock poisoned")?;
		let input_ids = Tensor::from_array((vec![1i64, seq_len as i64, row_width as i64], rows))
			.map_err(|e| format!("input_ids: {e}"))?;
		let attention_mask =
			Tensor::from_array((vec![1i64, seq_len as i64], vec![1i32; seq_len]))
				.map_err(|e| format!("attention_mask: {e}"))?;
		let outputs = prefill
			.run(ort::inputs![
				"input_ids" => input_ids,
				"attention_mask" => attention_mask,
			])
			.map_err(|e| format!("prefill run: {e}"))?;
		let mut global_hidden = extract_last_hidden(&outputs)?;
		let mut caches: Vec<(Vec<i64>, CacheData)> = self
			.present_output_names
			.iter()
			.map(|name| CacheData::extract(&outputs, name))
			.collect::<Result<_, _>>()?;
		drop(outputs);
		drop(prefill);
		let mut past_valid: i32 = seq_len as i32;

		// 4) Per-frame autoregressive loop.
		let mut rng = SplitMix64::new(opts.seed);
		let mut seen: Vec<Vec<bool>> = vec![vec![false; codebook]; n_vq]; // per-codebook seen-set
		let mut audio_frames: Vec<Vec<i32>> = Vec::new();
		let cap = opts.max_frames.min(self.max_new_frames);
		// Streaming: every STREAM_EVERY frames, codec-decode what we have so far and
		// emit only the newly-decoded tail, so playback starts ~1 s in instead of after
		// the whole clip. Re-decoding the growing prefix is cheap vs the frame loop and
		// keeps the already-played samples identical (the RVQ decoder is causal).
		const STREAM_EVERY: usize = 25; // ~0.5 s of frames
		let mut emitted = 0usize;

		let mut local = self.local_frame.lock().map_err(|_| "local lock poisoned")?;
		let mut decode = self.decode.lock().map_err(|_| "decode lock poisoned")?;

		for _ in 0..cap {
			if cancelled() {
				break;
			}

			// 4a) Fused local sampler → 16 RVQ codes (+ stop flag).
			let mut seen_mask = vec![0i32; n_vq * codebook];
			for (ch, set) in seen.iter().enumerate() {
				for (tok, &was) in set.iter().enumerate() {
					if was {
						seen_mask[ch * codebook + tok] = 1;
					}
				}
			}
			let assistant_u = vec![rng.uniform()];
			let audio_u: Vec<f32> = (0..n_vq).map(|_| rng.uniform()).collect();

			let gh = Tensor::from_array((vec![1i64, global_hidden.len() as i64], global_hidden.clone()))
				.map_err(|e| format!("global_hidden: {e}"))?;
			let mask = Tensor::from_array((vec![1i64, n_vq as i64, codebook as i64], seen_mask))
				.map_err(|e| format!("seen_mask: {e}"))?;
			let au = Tensor::from_array((vec![1i64], assistant_u))
				.map_err(|e| format!("assistant_u: {e}"))?;
			let xu = Tensor::from_array((vec![1i64, n_vq as i64], audio_u))
				.map_err(|e| format!("audio_u: {e}"))?;
			let lout = local
				.run(ort::inputs![
					"global_hidden" => gh,
					"repetition_seen_mask" => mask,
					"assistant_random_u" => au,
					"audio_random_u" => xu,
				])
				.map_err(|e| format!("local run: {e}"))?;

			let (_, cont) = lout["should_continue"]
				.try_extract_tensor::<i32>()
				.map_err(|e| format!("should_continue: {e}"))?;
			let should_continue = cont.first().copied().unwrap_or(0) > 0;
			let (_, frame_slice) = lout["frame_token_ids"]
				.try_extract_tensor::<i32>()
				.map_err(|e| format!("frame_token_ids: {e}"))?;
			let frame: Vec<i32> = frame_slice.to_vec();
			drop(lout);
			if !should_continue {
				break;
			}

			// Record the frame + update per-codebook seen sets.
			for (ch, &tok) in frame.iter().enumerate().take(n_vq) {
				if (0..codebook as i32).contains(&tok) {
					seen[ch][tok as usize] = true;
				}
			}
			audio_frames.push(frame.clone());

			// Stream: decode-so-far and emit the newly-rendered tail (the codec sessions
			// are independent of the local/decode locks held here, so this is safe).
			if audio_frames.len() % STREAM_EVERY == 0 {
				let pcm = self.decode_audio(&audio_frames)?;
				if pcm.len() > emitted {
					on_pcm(&pcm[emitted..]);
					emitted = pcm.len();
				}
			}

			// 4b) Advance the global transformer one frame (audio row → decode_step).
			let mut audio_row = vec![self.cfg.audio_pad_token_id; row_width];
			audio_row[0] = self.cfg.audio_assistant_slot_token_id;
			for c in 0..n_vq {
				audio_row[c + 1] = frame.get(c).copied().unwrap_or(self.cfg.audio_pad_token_id);
			}
			let step_ids = Tensor::from_array((vec![1i64, 1i64, row_width as i64], audio_row))
				.map_err(|e| format!("step input_ids: {e}"))?;
			let pvl = Tensor::from_array((vec![1i64], vec![past_valid]))
				.map_err(|e| format!("past_valid_lengths: {e}"))?;

			let mut feeds: Vec<(String, ort::session::SessionInputValue)> = vec![
				("input_ids".to_string(), step_ids.into()),
				("past_valid_lengths".to_string(), pvl.into()),
			];
			for (i, name) in self.past_input_names.iter().enumerate() {
				let (shape, data) = &caches[i];
				feeds.push((name.clone(), data.to_value(shape)?));
			}
			let dout = decode.run(feeds).map_err(|e| format!("decode run: {e}"))?;
			global_hidden = extract_last_hidden(&dout)?;
			let next: Vec<(Vec<i64>, CacheData)> = self
				.present_output_names
				.iter()
				.map(|name| CacheData::extract(&dout, name))
				.collect::<Result<_, _>>()?;
			drop(dout);
			caches = next;
			past_valid += 1;
		}
		drop(local);
		drop(decode);

		if audio_frames.is_empty() {
			return Ok(());
		}

		// 5) Final codec-decode → emit only the tail not already streamed above.
		let pcm = self.decode_audio(&audio_frames)?;
		if pcm.len() > emitted {
			on_pcm(&pcm[emitted..]);
		}
		Ok(())
	}

	/// Pick the requested built-in voice (or the first with prefix codes).
	fn select_voice(&self, name: Option<&str>) -> Result<&BuiltinVoice, String> {
		if let Some(want) = name {
			if let Some(v) =
				self.voices.iter().find(|v| v.voice == want && !v.prompt_audio_codes.is_empty())
			{
				return Ok(v);
			}
		}
		self.voices
			.iter()
			.find(|v| !v.prompt_audio_codes.is_empty())
			.ok_or_else(|| "no built-in voice with prompt_audio_codes in manifest".into())
	}

	/// Run the codec decoder over all frames → mono f32 PCM (channels averaged).
	fn decode_audio(&self, frames: &[Vec<i32>]) -> Result<Vec<f32>, String> {
		let n_vq = self.cfg.n_vq;
		let num_frames = frames.len();
		let mut flat = Vec::with_capacity(num_frames * n_vq);
		for frame in frames {
			for c in 0..n_vq {
				flat.push(frame.get(c).copied().unwrap_or(0));
			}
		}
		let codes = Tensor::from_array((vec![1i64, num_frames as i64, n_vq as i64], flat))
			.map_err(|e| format!("audio_codes: {e}"))?;
		let lengths = Tensor::from_array((vec![1i64], vec![num_frames as i32]))
			.map_err(|e| format!("audio_code_lengths: {e}"))?;

		let mut codec = self.codec.lock().map_err(|_| "codec lock poisoned")?;
		let outputs = codec
			.run(ort::inputs![
				"audio_codes" => codes,
				"audio_code_lengths" => lengths,
			])
			.map_err(|e| format!("codec run: {e}"))?;

		// `audio`: [1, channels, samples] f32. Average channels → mono.
		let (shape, data) = outputs["audio"]
			.try_extract_tensor::<f32>()
			.map_err(|e| format!("audio extract: {e}"))?;
		let dims: Vec<usize> = shape.iter().map(|&d| d as usize).collect();
		let (channels, samples) = match dims.as_slice() {
			[_b, ch, s] => (*ch, *s),
			[_b, s] => (1, *s),
			[s] => (1, *s),
			_ => return Err(format!("unexpected audio shape {dims:?}")),
		};
		let reported = outputs
			.get("audio_lengths")
			.and_then(|v| v.try_extract_tensor::<i32>().ok())
			.and_then(|(_, d)| d.first().copied())
			.map(|n| n as usize)
			.unwrap_or(samples)
			.min(samples);

		let mut pcm = vec![0f32; reported];
		for (s, out) in pcm.iter_mut().enumerate() {
			let mut sum = 0f32;
			for ch in 0..channels {
				sum += data[ch * samples + s];
			}
			*out = sum / channels as f32;
		}
		Ok(pcm)
	}
}

/// Extract `global_hidden` and keep only the last position's `hidden` values as a
/// flat `[hidden]` vec (the graph may emit `[1, seq, hidden]` for prefill or
/// `[1, 1, hidden]` for a decode step).
fn extract_last_hidden(outputs: &ort::session::SessionOutputs) -> Result<Vec<f32>, String> {
	let (shape, data) = outputs["global_hidden"]
		.try_extract_tensor::<f32>()
		.map_err(|e| format!("global_hidden extract: {e}"))?;
	let hidden = *shape.last().ok_or("empty global_hidden shape")? as usize;
	let start = data.len().saturating_sub(hidden);
	Ok(data[start..].to_vec())
}

/// Tiny deterministic PRNG (SplitMix64) → uniform f32 in (1e-6, 1-1e-6). The
/// in-graph sampler consumes these as its inverse-CDF draws; any uniform works,
/// and seeding keeps a run reproducible.
struct SplitMix64 {
	state: u64,
}

impl SplitMix64 {
	fn new(seed: u64) -> Self {
		Self { state: seed }
	}

	fn next_u64(&mut self) -> u64 {
		self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
		let mut z = self.state;
		z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
		z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
		z ^ (z >> 31)
	}

	fn uniform(&mut self) -> f32 {
		// 24 random bits → [0,1); clamp away from the exact endpoints.
		let bits = (self.next_u64() >> 40) as f32 / (1u64 << 24) as f32;
		bits.clamp(1e-6, 1.0 - 1e-6)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The sampler's uniform draws must stay strictly inside (0, 1) and be
	/// reproducible for a given seed (so a synth run is deterministic).
	#[test]
	fn splitmix_uniform_in_open_unit_and_reproducible() {
		let mut a = SplitMix64::new(1234);
		let mut b = SplitMix64::new(1234);
		for _ in 0..10_000 {
			let x = a.uniform();
			assert!(x > 0.0 && x < 1.0, "uniform out of (0,1): {x}");
			assert_eq!(x, b.uniform(), "same seed must reproduce the same stream");
		}
		// Different seeds should diverge.
		assert_ne!(SplitMix64::new(1).uniform(), SplitMix64::new(2).uniform());
	}
}

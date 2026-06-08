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
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaModel};
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

/// LFM2.5-1.2B-Instruct, Q6_K GGUF (LiquidAI official). Run FULLY on Metal via
/// llama.cpp. Chosen over the 8B-A1B MoE so the whole model (~0.9 GB) fits in the
/// 8 GB Mac's Metal working set with headroom — the 8B-A1B (Q4_K_M, 4.8 GB) OOM'd
/// the Metal command buffer on decode (all 32 experts must stay resident).
pub const LFM2_5_1_2B: LlamaModelSpec = LlamaModelSpec {
	dir: "lfm2.5-1.2b-instruct-gguf",
	base_url: "https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/",
	file: "LFM2.5-1.2B-Instruct-Q6_K.gguf",
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

/// Silence llama.cpp/ggml's INFO chatter (the multi-page model-loader + ggml-metal
/// dump on every load). Installs a C log callback that drops everything below WARN,
/// so real warnings/errors still surface. Runs once, before backend init.
fn quiet_llama_logs() {
	use std::os::raw::{c_char, c_void};
	// ggml_log_level is a c_uint; NONE=0, DEBUG=1, INFO=2, WARN=3, ERROR=4, CONT=5.
	unsafe extern "C" fn cb(
		level: llama_cpp_sys_2::ggml_log_level,
		text: *const c_char,
		_user: *mut c_void,
	) {
		if level >= 3 && !text.is_null() {
			let s = unsafe { std::ffi::CStr::from_ptr(text) }.to_string_lossy();
			eprint!("{s}");
		}
	}
	unsafe {
		llama_cpp_sys_2::llama_log_set(Some(cb), std::ptr::null_mut());
		llama_cpp_sys_2::ggml_log_set(Some(cb), std::ptr::null_mut());
	}
}

/// Process-global llama.cpp backend (ggml init runs exactly once; the `metal` feature selects
/// the GPU backend at build time). Init failure means no compute backend at all (Metal/GPU
/// stack unavailable) — catastrophic and unrecoverable, hence the panic.
fn backend() -> &'static LlamaBackend {
	static BACKEND: std::sync::OnceLock<LlamaBackend> = std::sync::OnceLock::new();
	BACKEND.get_or_init(|| {
		quiet_llama_logs();
		LlamaBackend::init().expect("llama.cpp backend init failed")
	})
}

/// Default system prompt: reply in German, short and clean (the 1.2B instruct model
/// rambles without steering).
pub const SYSTEM_PROMPT: &str =
	"Du bist Aven, ein hilfreicher On-Device-Assistent. Antworte immer auf Deutsch, in \
	 sauberen, kompakten, kurzen Antworten — ein bis zwei Sätze, außer es wird ausdrücklich \
	 mehr Detail verlangt. Keine Füllwörter, keine Einleitung.";

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

	/// Render `user` through the GGUF's embedded chat template with [`SYSTEM_PROMPT`]
	/// (assistant turn left open). Falls back to ChatML if the model has no template.
	fn chat_prompt(&self, user: &str) -> String {
		let build = || -> Result<String, String> {
			let tmpl = self.model.chat_template(None).map_err(|e| format!("chat_template: {e}"))?;
			let chat = [
				LlamaChatMessage::new("system".into(), SYSTEM_PROMPT.into())
					.map_err(|e| format!("{e}"))?,
				LlamaChatMessage::new("user".into(), user.into()).map_err(|e| format!("{e}"))?,
			];
			self.model.apply_chat_template(&tmpl, &chat, true).map_err(|e| format!("{e}"))
		};
		build().unwrap_or_else(|_| {
			format!(
				"<|im_start|>system\n{SYSTEM_PROMPT}<|im_end|>\n\
				 <|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n"
			)
		})
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

		// Wrap the user text in the model's chat template + a concise system prompt so
		// LFM2.5-Instruct replies in chat mode (short, clean answers) instead of doing
		// raw text completion. `str_to_token` parses the template's special tokens.
		let templated = self.chat_prompt(prompt);
		let tokens = self
			.model
			.str_to_token(&templated, AddBos::Always)
			.map_err(|e| format!("tokenize: {e}"))?;
		let n_prompt = tokens.len();

		let mut batch = LlamaBatch::new(512, 1);
		let last = tokens.len().saturating_sub(1);
		for (i, &tok) in tokens.iter().enumerate() {
			batch.add(tok, i as i32, &[0], i == last).map_err(|e| format!("batch add: {e}"))?;
		}
		ctx.decode(&mut batch).map_err(|e| format!("decode prompt: {e}"))?;

		// Not greedy: greedy on a 1.2B model loops into a single-token wall (the "粲粲…"
		// garbage). Repetition penalty + top-p + a little temperature keeps it coherent.
		let mut sampler = LlamaSampler::chain_simple([
			LlamaSampler::penalties(64, 1.15, 0.0, 0.0),
			LlamaSampler::top_k(40),
			LlamaSampler::top_p(0.95, 1),
			LlamaSampler::temp(0.7),
			LlamaSampler::dist(0x5EED_5EED),
		]);
		let mut text = String::new();
		// Detok byte buffer: byte-fallback tokens split a multibyte char (ä/ö/ü/emoji)
		// across tokens, so decode each token alone would emit U+FFFD (the "��").
		let mut byte_buf: Vec<u8> = Vec::new();
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
			// Non-deprecated detok: explicit buffer, `special = false` (render plain text).
			let bytes = self
				.model
				.token_to_piece_bytes(token, 64, false, None)
				.map_err(|e| format!("detok: {e}"))?;
			byte_buf.extend_from_slice(&bytes);
			// Emit only the complete-UTF-8 prefix; keep any partial multibyte tail buffered.
			let valid = match std::str::from_utf8(&byte_buf) {
				Ok(_) => byte_buf.len(),
				Err(e) => e.valid_up_to(),
			};
			if valid > 0 {
				let piece = String::from_utf8_lossy(&byte_buf[..valid]).into_owned();
				on_token(&piece);
				text.push_str(&piece);
				byte_buf.drain(..valid);
			}
			produced += 1;

			batch.clear();
			batch.add(token, n_cur, &[0], true).map_err(|e| format!("batch add gen: {e}"))?;
			n_cur += 1;
			ctx.decode(&mut batch).map_err(|e| format!("decode gen: {e}"))?;
		}

		// Flush any trailing partial-multibyte bytes (lossy — replaces a dangling tail).
		if !byte_buf.is_empty() {
			let piece = String::from_utf8_lossy(&byte_buf).into_owned();
			on_token(&piece);
			text.push_str(&piece);
		}

		let secs = t0.elapsed().as_secs_f64();
		let tokens_per_sec = if secs > 0.0 { produced as f64 / secs } else { 0.0 };
		Ok(GenStats { text, tokens: produced, tokens_per_sec })
	}
}

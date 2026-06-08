//! On-device text-to-speech — thin Tauri adapter over the `aven-ai` crate
//! (MOSS-TTS-Nano ONNX via onnxruntime/`ort`). Sibling of [`crate::llm`].
//!
//! The inference + model-download mechanics live in `aven-ai` (Tauri-free, behind
//! its `tts` feature). This file owns the app-side glue: the `#[tauri::command]`
//! surface, the `tts:model-download` progress events, the status/epoch/cancel
//! state machine, on-disk model listing/deletion, and — the TTS-specific part —
//! **streaming**: `tts_synthesize` emits `tts:audio-chunk` events carrying f32 PCM
//! so the webview can play audio via Web Audio (the reverse of the STT capture
//! path), then a final `done` marker.
//!
//! Default builds without `local-tts` ship only the command surface
//! (`tts_status` → `unavailable`); the real engine is behind the feature (which
//! enables `aven-ai/tts`). The onnxruntime dylib is loaded at runtime from a
//! bundled path — never statically linked, never downloaded as code
//! (App-Store/TestFlight-safe); only the model *weights* download at first run.

use serde::Serialize;
use tauri::AppHandle;

/// Progress/readiness event (download + load). Mirrors `llm:model-download`.
#[cfg_attr(not(feature = "local-tts"), allow(dead_code))]
pub const DOWNLOAD_EVENT: &str = "tts:model-download";
/// Streamed PCM event emitted during `tts_synthesize`.
#[cfg_attr(not(feature = "local-tts"), allow(dead_code))]
pub const CHUNK_EVENT: &str = "tts:audio-chunk";

const MODEL_LABEL: &str = "MOSS-TTS-Nano";
const MODEL_QUANT: &str = "ONNX · fp32 (onnxruntime)";
/// Directory under `.avenOS/models/` the model downloads to (also the delete id).
const MODEL_DIR: &str = "moss-tts-nano-onnx";

/// Status reply + `tts:model-download` payload shape.
/// `status` ∈ `idle | downloading | loading | ready | error | unavailable`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TtsStatus {
	pub status: String,
	pub model: String,
	pub quant: String,
	pub received_bytes: u64,
	pub total_bytes: u64,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
}

impl TtsStatus {
	#[cfg_attr(feature = "local-tts", allow(dead_code))]
	pub fn unavailable() -> Self {
		Self {
			status: "unavailable".into(),
			model: MODEL_LABEL.into(),
			quant: MODEL_QUANT.into(),
			received_bytes: 0,
			total_bytes: 0,
			error: None,
		}
	}
}

/// One `tts:audio-chunk` streaming event. `replyId` ties chunks to the UI row that
/// requested synthesis; `done` marks end-of-stream (with `pcm` empty).
/// Constructed only by the feature-gated `imp` synthesizer (STT-only builds never emit it).
#[cfg_attr(not(feature = "local-tts"), allow(dead_code))]
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TtsChunk {
	pub reply_id: String,
	pub pcm: Vec<f32>,
	pub sample_rate: u32,
	pub done: bool,
}

/// On-device TTS runs on the PRIMARY instance only (same rationale as ASR/LLM — a
/// secondary dev instance shares the models cache and must not download/load).
fn instance_enabled() -> bool {
	match std::env::var("AVENOS_DEV_INSTANCE") {
		Ok(v) => {
			let v = v.trim();
			v.is_empty() || v.eq_ignore_ascii_case("a")
		}
		Err(_) => true,
	}
}

#[tauri::command(rename_all = "camelCase")]
pub async fn tts_status(app: AppHandle) -> Result<TtsStatus, String> {
	if !instance_enabled() {
		return Ok(TtsStatus::unavailable());
	}
	Ok(imp::status(&app).await)
}

/// The single on-device voice. Bella is a multilingual female speaker timbre — it
/// speaks whatever language the input `text` is in (English, German, …). Not
/// user-selectable; change here to swap it.
const VOICE: &str = "Bella";

/// Synthesize `text` into speech (Bella), streaming PCM to the webview via
/// `tts:audio-chunk` events tagged with `reply_id`. Resolves once the full clip
/// has been emitted.
#[tauri::command(rename_all = "camelCase")]
pub async fn tts_synthesize(app: AppHandle, text: String, reply_id: String) -> Result<(), String> {
	if !instance_enabled() {
		return Err("on-device synthesis runs on the primary instance only".into());
	}
	imp::synthesize(&app, text, reply_id, VOICE.to_string()).await
}

pub fn spawn_model_download(app: &AppHandle) {
	if !instance_enabled() {
		log::info!(target: "avenos::tts", "secondary instance — skipping TTS model download/load");
		return;
	}
	imp::spawn_download(app);
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
	pub id: String,
	pub size_bytes: u64,
	pub is_active: bool,
}

/// List the MOSS-TTS-Nano model directory on disk (pure filesystem — any build).
#[tauri::command(rename_all = "camelCase")]
pub async fn tts_local_models(app: AppHandle) -> Result<Vec<LocalModel>, String> {
	let dir = tauri_plugin_self::paths::models_dir(&app)?;
	let mut out = Vec::new();
	let model_dir = dir.join(MODEL_DIR);
	if model_dir.exists() {
		out.push(LocalModel {
			id: MODEL_DIR.into(),
			size_bytes: dir_size(&model_dir),
			is_active: true,
		});
	}
	Ok(out)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn tts_cancel_download(app: AppHandle) -> Result<(), String> {
	imp::cancel(&app);
	Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn tts_start_download(app: AppHandle) -> Result<(), String> {
	spawn_model_download(&app);
	Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn tts_delete_model(app: AppHandle, id: String) -> Result<(), String> {
	let dir = tauri_plugin_self::paths::models_dir(&app)?;
	if id != MODEL_DIR {
		return Err("invalid model id".into());
	}
	imp::unload(&app);
	let target = dir.join(MODEL_DIR);
	if target.exists() {
		std::fs::remove_dir_all(&target).map_err(|e| format!("delete {id}: {e}"))?;
	}
	Ok(())
}

fn dir_size(path: &std::path::Path) -> u64 {
	let mut total = 0;
	if let Ok(entries) = std::fs::read_dir(path) {
		for entry in entries.flatten() {
			match entry.metadata() {
				Ok(meta) if meta.is_dir() => total += dir_size(&entry.path()),
				Ok(meta) => total += meta.len(),
				Err(_) => {}
			}
		}
	}
	total
}

// ───────────────────────── default build (feature off) ─────────────────────────
#[cfg(not(feature = "local-tts"))]
mod imp {
	use super::{AppHandle, TtsStatus};

	pub async fn status(_app: &AppHandle) -> TtsStatus {
		TtsStatus::unavailable()
	}

	pub async fn synthesize(_app: &AppHandle, _text: String, _reply_id: String, _voice: String) -> Result<(), String> {
		Err("on-device synthesis is not available in this build (enable the `local-tts` feature)".into())
	}

	pub fn spawn_download(_app: &AppHandle) {}
	pub fn cancel(_app: &AppHandle) {}
	pub fn unload(_app: &AppHandle) {}
}

// ───────────────────────── on-device build (`local-tts`) ────────────────────────
#[cfg(feature = "local-tts")]
mod imp {
	use std::path::PathBuf;
	use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
	use std::sync::{Arc, Mutex, OnceLock};

	use aven_ai::tts::{self, DownloadError, SynthOptions, Synthesizer, TtsModelSpec};
	use tauri::{AppHandle, Emitter, Manager};

	use super::{TtsChunk, TtsStatus, CHUNK_EVENT, DOWNLOAD_EVENT, MODEL_DIR, MODEL_LABEL, MODEL_QUANT};

	// MOSS-TTS-Nano ships prebuilt ONNX across TWO public HF repos. The backbone
	// (3 graphs we use + their `.data` weight sidecars + the manifest) and the codec
	// (decoder graph + its `.data` sidecar) download into one flat dir.
	const BASE_URL: &str = "https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX/resolve/main/";
	const FILES: &[(&str, &str)] = &[
		("moss_tts_prefill.onnx", "moss_tts_prefill.onnx"),
		("moss_tts_decode_step.onnx", "moss_tts_decode_step.onnx"),
		("moss_tts_local_fixed_sampled_frame.onnx", "moss_tts_local_fixed_sampled_frame.onnx"),
		("moss_tts_global_shared.data", "moss_tts_global_shared.data"),
		("moss_tts_local_shared.data", "moss_tts_local_shared.data"),
		("browser_poc_manifest.json", "browser_poc_manifest.json"),
	];
	const CODEC_BASE_URL: &str =
		"https://huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX/resolve/main/";
	const CODEC_FILES: &[(&str, &str)] = &[
		("moss_audio_tokenizer_decode_full.onnx", "moss_audio_tokenizer_decode_full.onnx"),
		("moss_audio_tokenizer_decode_shared.data", "moss_audio_tokenizer_decode_shared.data"),
	];
	/// Bundled, verified fast tokenizer (upstream ships only a sentencepiece
	/// `tokenizer.model`). Copied into the model dir before load. See
	/// `scripts/moss-tts-nano-tokenizer.py`.
	const TOKENIZER: &str = "tokenizer.json";

	fn spec() -> TtsModelSpec {
		TtsModelSpec {
			dir: MODEL_DIR,
			base_url: BASE_URL,
			files: FILES,
			codec_base_url: CODEC_BASE_URL,
			codec_files: CODEC_FILES,
			prefill: "moss_tts_prefill.onnx",
			decode_step: "moss_tts_decode_step.onnx",
			local_frame: "moss_tts_local_fixed_sampled_frame.onnx",
			codec_decode: "moss_audio_tokenizer_decode_full.onnx",
			manifest: "browser_poc_manifest.json",
			tokenizer: TOKENIZER,
		}
	}

	const CANCELLED: &str = "download cancelled";

	#[derive(Default)]
	struct State {
		status: Mutex<String>,
		error: Mutex<Option<String>>,
		received: AtomicU64,
		total: AtomicU64,
		download_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
		cancelled: AtomicBool,
		epoch: AtomicU64,
	}

	fn state() -> &'static State {
		static STATE: OnceLock<State> = OnceLock::new();
		STATE.get_or_init(|| {
			let s = State::default();
			*s.status.lock().unwrap() = "idle".into();
			s
		})
	}

	fn model_slot() -> &'static tokio::sync::Mutex<Option<Arc<Synthesizer>>> {
		static MODEL: OnceLock<tokio::sync::Mutex<Option<Arc<Synthesizer>>>> = OnceLock::new();
		MODEL.get_or_init(|| tokio::sync::Mutex::new(None))
	}

	fn build_lock() -> &'static tokio::sync::Mutex<()> {
		static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
		LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
	}

	fn snapshot() -> TtsStatus {
		let s = state();
		TtsStatus {
			status: s.status.lock().unwrap().clone(),
			model: MODEL_LABEL.into(),
			quant: MODEL_QUANT.into(),
			received_bytes: s.received.load(Ordering::Relaxed),
			total_bytes: s.total.load(Ordering::Relaxed),
			error: s.error.lock().unwrap().clone(),
		}
	}

	fn emit(app: &AppHandle) {
		let _ = app.emit(DOWNLOAD_EVENT, snapshot());
	}

	fn set_status(app: &AppHandle, status: &str, error: Option<String>) {
		let s = state();
		*s.status.lock().unwrap() = status.into();
		*s.error.lock().unwrap() = error;
		emit(app);
	}

	pub async fn status(_app: &AppHandle) -> TtsStatus {
		snapshot()
	}

	/// Resolve the bundled onnxruntime dylib `ort` should load. Same resolution as
	/// the LLM adapter (env override → app resources → dev-provisioned models copy);
	/// the dylib is shared, so whichever engine loads first wins (init is idempotent).
	fn resolve_dylib(app: &AppHandle) -> Result<PathBuf, String> {
		if let Ok(p) = std::env::var("AVENOS_ORT_DYLIB") {
			let p = PathBuf::from(p);
			if p.is_file() {
				return Ok(p);
			}
		}
		let name = if cfg!(target_os = "windows") {
			"onnxruntime.dll"
		} else {
			"libonnxruntime.dylib"
		};
		if let Ok(res) = app.path().resource_dir() {
			let p = res.join("onnxruntime").join(name);
			if p.is_file() {
				return Ok(p);
			}
		}
		let models = tauri_plugin_self::paths::models_dir(app)?;
		let p = models.join("onnxruntime").join(name);
		if p.is_file() {
			return Ok(p);
		}
		Err(format!(
			"onnxruntime dylib not found (looked in app resources and {}); set AVENOS_ORT_DYLIB or bundle it",
			p.display()
		))
	}

	/// Resolve the bundled `tokenizer.json` (a verified fast tokenizer; upstream
	/// ships only a sentencepiece `tokenizer.model`). Resolution mirrors the dylib:
	/// env override → app resources → dev-provisioned models copy.
	fn resolve_tokenizer(app: &AppHandle) -> Result<PathBuf, String> {
		if let Ok(p) = std::env::var("AVENOS_TTS_TOKENIZER") {
			let p = PathBuf::from(p);
			if p.is_file() {
				return Ok(p);
			}
		}
		if let Ok(res) = app.path().resource_dir() {
			let p = res.join("resources").join("moss-tts-nano").join(TOKENIZER);
			if p.is_file() {
				return Ok(p);
			}
		}
		let models = tauri_plugin_self::paths::models_dir(app)?;
		let p = models.join("moss-tts-nano").join(TOKENIZER);
		if p.is_file() {
			return Ok(p);
		}
		Err(format!(
			"bundled tokenizer.json not found (looked in app resources and {}); set AVENOS_TTS_TOKENIZER",
			p.display()
		))
	}

	async fn build_model(app: &AppHandle) -> Result<Synthesizer, String> {
		let root = tauri_plugin_self::paths::models_dir(app)?;
		state().cancelled.store(false, Ordering::Relaxed);

		if !spec().files_present(&root) {
			set_status(app, "downloading", None);
			let app2 = app.clone();
			let root2 = root.clone();
			let res = tokio::task::spawn_blocking(move || {
				tts::download_files(
					&spec(),
					&root2,
					|| state().cancelled.load(Ordering::Relaxed),
					|received, total| {
						state().received.store(received, Ordering::Relaxed);
						state().total.store(total, Ordering::Relaxed);
						emit(&app2);
					},
				)
			})
			.await
			.map_err(|e| format!("download task: {e}"))?;
			match res {
				Ok(()) => {}
				Err(DownloadError::Cancelled) => return Err(CANCELLED.into()),
				Err(DownloadError::Failed(e)) => return Err(e),
			}
		}

		set_status(app, "loading", None);

		// Place the bundled tokenizer.json into the model dir so the engine loads it
		// alongside the downloaded onnx/manifest (idempotent; copies if missing/stale).
		let tok_src = resolve_tokenizer(app)?;
		let tok_dst = spec().model_dir(&root).join(TOKENIZER);
		let needs_copy = std::fs::metadata(&tok_dst)
			.ok()
			.zip(std::fs::metadata(&tok_src).ok())
			.map(|(d, s)| d.len() != s.len())
			.unwrap_or(true);
		if needs_copy {
			std::fs::create_dir_all(spec().model_dir(&root))
				.and_then(|_| std::fs::copy(&tok_src, &tok_dst).map(|_| ()))
				.map_err(|e| format!("stage tokenizer: {e}"))?;
		}

		let dylib = resolve_dylib(app)?;
		tts::init_runtime(&dylib)?;
		let root3 = root.clone();
		tokio::task::spawn_blocking(move || Synthesizer::load(&spec(), &root3))
			.await
			.map_err(|e| format!("load task: {e}"))?
	}

	async fn ensure_model(app: &AppHandle) -> Result<Arc<Synthesizer>, String> {
		if let Some(m) = model_slot().lock().await.clone() {
			return Ok(m);
		}
		let _build = build_lock().lock().await;
		if let Some(m) = model_slot().lock().await.clone() {
			return Ok(m);
		}

		let my_epoch = state().epoch.load(Ordering::SeqCst);
		match build_model(app).await {
			Ok(s) => {
				if state().epoch.load(Ordering::SeqCst) != my_epoch {
					set_status(app, "idle", None);
					return Err(CANCELLED.into());
				}
				let arc = Arc::new(s);
				*model_slot().lock().await = Some(arc.clone());
				set_status(app, "ready", None);
				Ok(arc)
			}
			Err(e) => {
				if e == CANCELLED || state().epoch.load(Ordering::SeqCst) != my_epoch {
					set_status(app, "idle", None);
					Err(CANCELLED.into())
				} else {
					set_status(app, "error", Some(e.clone()));
					Err(e)
				}
			}
		}
	}

	pub fn spawn_download(app: &AppHandle) {
		{
			let st = state().status.lock().unwrap();
			if *st == "downloading" || *st == "loading" {
				return;
			}
		}
		let app = app.clone();
		let handle = tauri::async_runtime::spawn(async move {
			if let Err(e) = ensure_model(&app).await {
				log::warn!(target: "avenos::tts", "TTS model preload failed: {e}");
			}
		});
		*state().download_task.lock().unwrap() = Some(handle);
	}

	fn reset(app: &AppHandle, drop_loaded: bool) {
		let s = state();
		s.epoch.fetch_add(1, Ordering::SeqCst);
		s.cancelled.store(true, Ordering::Relaxed);
		if let Some(h) = s.download_task.lock().unwrap().take() {
			h.abort();
		}
		if drop_loaded {
			if let Ok(mut slot) = model_slot().try_lock() {
				*slot = None;
			}
		}
		s.received.store(0, Ordering::Relaxed);
		s.total.store(0, Ordering::Relaxed);
		*s.error.lock().unwrap() = None;
		{
			let mut st = s.status.lock().unwrap();
			if drop_loaded || *st != "ready" {
				*st = "idle".into();
			}
		}
		emit(app);
	}

	pub fn cancel(app: &AppHandle) {
		reset(app, false);
	}

	pub fn unload(app: &AppHandle) {
		reset(app, true);
	}

	pub async fn synthesize(app: &AppHandle, text: String, reply_id: String, voice: String) -> Result<(), String> {
		let model = ensure_model(app).await?;
		let sample_rate = model.sample_rate();
		let app2 = app.clone();
		let reply = reply_id.clone();
		let res = tokio::task::spawn_blocking(move || {
			model.synthesize(
				&text,
				SynthOptions { voice: Some(voice), ..SynthOptions::default() },
				|pcm| {
					// Emit each engine tail (~2 s, well under a MB of JSON) as ONE event.
					// The webview buffers all tails and plays the whole clip as a single
					// gap-free AudioBuffer, so finer slicing here just floods the IPC and
					// janks the UI for no playback benefit.
					let _ = app2.emit(
						CHUNK_EVENT,
						TtsChunk {
							reply_id: reply.clone(),
							pcm: pcm.to_vec(),
							sample_rate,
							done: false,
						},
					);
				},
				|| false,
			)
		})
		.await;

		// ALWAYS emit the end-of-stream marker first — even if the synth task panicked
		// or errored — so the webview's listener resolves and the Speak button recovers
		// for the next playback (otherwise one bad run bricks the UI).
		let _ = app.emit(
			CHUNK_EVENT,
			TtsChunk { reply_id, pcm: Vec::new(), sample_rate, done: true },
		);
		match res {
			Ok(inner) => inner,
			Err(e) => Err(format!("synthesize task: {e}")),
		}
	}
}

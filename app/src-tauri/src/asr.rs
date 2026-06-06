//! On-device voice-note transcription — thin Tauri adapter over the `aven-ai`
//! crate (NVIDIA Parakeet-TDT-0.6b-v3 via sherpa-onnx).
//!
//! The inference + model download/extract mechanics live in `aven-ai` (Tauri-free,
//! behind its `stt` feature, which pulls the prebuilt sherpa-onnx + onnxruntime —
//! no CMake). This file owns the app-side glue: the `#[tauri::command]` surface,
//! the `asr:model-download` progress events, the status/epoch/cancel state
//! machine, and on-disk model listing/deletion (pure filesystem, so it works in
//! any build).
//!
//! Default builds (`--no-default-features`) ship only the command surface —
//! `asr_status` reports `unavailable` and `transcribe_audio` errors — keeping CI /
//! quick `cargo check` light. The real engine lives behind the `local-voice`
//! feature (which enables `aven-ai/stt`).
//!
//! The webview captures microphone PCM (16 kHz mono) and calls `transcribe_audio`;
//! the model runs entirely on-device (no network at inference, no API key) and
//! returns the transcript, which the talk UI streams into the message thread.

use serde::Serialize;
use tauri::AppHandle;

/// Tauri event the webview listens to for download progress / readiness.
/// Only emitted by the `local-voice` build; default builds never emit it.
#[cfg_attr(not(feature = "local-voice"), allow(dead_code))]
pub const DOWNLOAD_EVENT: &str = "asr:model-download";

/// Presentation metadata for the active model. Kept feature-independent so the
/// status command + Models page work in any build. The download URL + file names
/// live in the `local-voice` `imp` module (they need the engine to be useful).
const MODEL_LABEL: &str = "Parakeet TDT 0.6b v3";
const MODEL_QUANT: &str = "ONNX · int8 (sherpa-onnx)";
/// Directory under `.avenOS/models/` the model extracts to (also the delete id).
const MODEL_DIR: &str = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";

/// Reply for the `asr_status` command and the shape of `asr:model-download`
/// event payloads. `status` ∈ `idle | downloading | loading | ready | error | unavailable`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AsrStatus {
	pub status: String,
	pub model: String,
	pub quant: String,
	pub received_bytes: u64,
	pub total_bytes: u64,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
}

impl AsrStatus {
	/// Only used by the stub (feature-off) build; `local-voice` builds never call it.
	#[cfg_attr(feature = "local-voice", allow(dead_code))]
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

/// The on-device voice feature runs on the PRIMARY instance only. The dev harness
/// launches a second instance tagged `AVENOS_DEV_INSTANCE=B` (etc.) that shares
/// the same `.avenOS/models` cache — it must not download or load the model.
/// Enabled when the var is unset/empty (production) or "A" (primary dev instance).
fn instance_enabled() -> bool {
	match std::env::var("AVENOS_DEV_INSTANCE") {
		Ok(v) => {
			let v = v.trim();
			v.is_empty() || v.eq_ignore_ascii_case("a")
		}
		Err(_) => true,
	}
}

/// Current readiness/progress (used by `asr_status` and progress events).
#[tauri::command(rename_all = "camelCase")]
pub async fn asr_status(app: AppHandle) -> Result<AsrStatus, String> {
	if !instance_enabled() {
		return Ok(AsrStatus::unavailable());
	}
	Ok(imp::status(&app).await)
}

/// A transcribed voice note: the verbatim transcript plus a derived short title.
/// (Parakeet is pure STT, so `summary` is empty; a model-generated title/summary
/// is a future Gemma-path concern.)
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VoiceNote {
	pub transcript: String,
	pub title: String,
	pub summary: String,
}

/// Transcribe captured PCM on-device into `{ transcript, title, summary }`.
/// `pcm` is mono f32 samples at `sample_rate` (the webview encodes to 16 kHz).
#[tauri::command(rename_all = "camelCase")]
pub async fn transcribe_audio(
	app: AppHandle,
	pcm: Vec<f32>,
	sample_rate: u32,
) -> Result<VoiceNote, String> {
	if !instance_enabled() {
		return Err("on-device voice transcription runs on the primary instance only".into());
	}
	imp::transcribe(&app, pcm, sample_rate).await
}

/// Kick the first-run model download in the background (no-op without
/// `local-voice`, or on a secondary dev instance).
pub fn spawn_model_download(app: &AppHandle) {
	if !instance_enabled() {
		log::info!(target: "avenos::asr", "secondary instance — skipping voice-model download/load");
		return;
	}
	imp::spawn_download(app);
}

/// One model directory found in the on-device models cache.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
	pub id: String,
	pub size_bytes: u64,
	pub is_active: bool,
}

/// List models present on disk under `.avenOS/models/`: the active model plus any
/// legacy Hugging Face cache leftovers under `hub/` (e.g. a previous Voxtral
/// download) so the user can reclaim that disk. Pure filesystem — works in any build.
#[tauri::command(rename_all = "camelCase")]
pub async fn asr_local_models(app: AppHandle) -> Result<Vec<LocalModel>, String> {
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

	if let Ok(entries) = std::fs::read_dir(dir.join("hub")) {
		for entry in entries.flatten() {
			let name = entry.file_name().to_string_lossy().to_string();
			let Some(rest) = name.strip_prefix("models--") else {
				continue;
			};
			out.push(LocalModel {
				id: rest.replace("--", "/"),
				size_bytes: dir_size(&entry.path()),
				is_active: false,
			});
		}
	}
	out.sort_by(|a, b| a.id.cmp(&b.id));
	Ok(out)
}

/// Stop the in-flight model download and reset progress to idle. No-op in the
/// stub build.
#[tauri::command(rename_all = "camelCase")]
pub async fn asr_cancel_download(app: AppHandle) -> Result<(), String> {
	imp::cancel(&app);
	Ok(())
}

/// (Re)start the model download/load in the background.
#[tauri::command(rename_all = "camelCase")]
pub async fn asr_start_download(app: AppHandle) -> Result<(), String> {
	spawn_model_download(&app);
	Ok(())
}

/// Delete a model directory from the on-device cache. Deleting the active model
/// also evicts the loaded instance so a later download truly rebuilds.
#[tauri::command(rename_all = "camelCase")]
pub async fn asr_delete_model(app: AppHandle, id: String) -> Result<(), String> {
	let dir = tauri_plugin_self::paths::models_dir(&app)?;

	if id == MODEL_DIR {
		imp::unload(&app);
		let target = dir.join(MODEL_DIR);
		if target.exists() {
			std::fs::remove_dir_all(&target).map_err(|e| format!("delete {id}: {e}"))?;
		}
		return Ok(());
	}

	// Otherwise it's a legacy HF cache entry under `hub/models--*`.
	if id.contains("..") || id.starts_with('/') {
		return Err("invalid model id".into());
	}
	let hub = dir.join("hub");
	let folder = format!("models--{}", id.replace('/', "--"));
	let target = hub.join(&folder);
	// Safety: only ever a single `models--*` directory directly under `hub/`.
	if target.parent() != Some(hub.as_path()) {
		return Err("invalid model id".into());
	}
	if target.exists() {
		std::fs::remove_dir_all(&target).map_err(|e| format!("delete {id}: {e}"))?;
	}
	Ok(())
}

/// Recursively sum file sizes under `path`.
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
#[cfg(not(feature = "local-voice"))]
mod imp {
	use super::{AppHandle, AsrStatus, VoiceNote};

	pub async fn status(_app: &AppHandle) -> AsrStatus {
		AsrStatus::unavailable()
	}

	pub async fn transcribe(_app: &AppHandle, _pcm: Vec<f32>, _sr: u32) -> Result<VoiceNote, String> {
		Err("on-device transcription is not available in this build (enable the `local-voice` feature)".into())
	}

	pub fn spawn_download(_app: &AppHandle) {}

	pub fn cancel(_app: &AppHandle) {}

	pub fn unload(_app: &AppHandle) {}
}

// ───────────────────────── on-device build (`local-voice`) ──────────────────────
#[cfg(feature = "local-voice")]
mod imp {
	use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
	use std::sync::{Arc, Mutex, OnceLock};

	use aven_ai::stt::{self, DownloadError, ModelSpec, Transcriber};
	use tauri::{AppHandle, Emitter};

	use super::{AsrStatus, VoiceNote, DOWNLOAD_EVENT, MODEL_DIR, MODEL_LABEL, MODEL_QUANT};

	// Where the model comes from (the URL + file names the engine needs).
	const MODEL_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2";
	const ENCODER: &str = "encoder.int8.onnx";
	const DECODER: &str = "decoder.int8.onnx";
	const JOINER: &str = "joiner.int8.onnx";
	const TOKENS: &str = "tokens.txt";

	fn spec() -> ModelSpec {
		ModelSpec {
			dir: MODEL_DIR,
			url: MODEL_URL,
			encoder: ENCODER,
			decoder: DECODER,
			joiner: JOINER,
			tokens: TOKENS,
		}
	}

	/// Error sentinel for a user-cancelled download (mapped to `idle`, not `error`).
	const CANCELLED: &str = "download cancelled";

	/// Shared readiness state, mirrored to the webview via `asr:model-download`.
	#[derive(Default)]
	struct State {
		status: Mutex<String>,
		error: Mutex<Option<String>>,
		received: AtomicU64,
		total: AtomicU64,
		download_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
		/// Set when the user cancels, so the blocking download loop bails out.
		cancelled: AtomicBool,
		/// Bumped on every cancel/delete. A build captures the epoch at its start
		/// and refuses to publish (status `ready` / cache the model) if it changed
		/// underneath it — so a cancel/delete during the slow `loading` phase can't
		/// be clobbered by a stale build flipping the status back to `ready`.
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

	/// The loaded transcriber, resettable so deleting the model (or cancelling a
	/// load) drops it and a later `Download` rebuilds. `Transcriber` is
	/// `Send + Sync`, so it's safe to share across the async runtime.
	fn model_slot() -> &'static tokio::sync::Mutex<Option<Arc<Transcriber>>> {
		static MODEL: OnceLock<tokio::sync::Mutex<Option<Arc<Transcriber>>>> = OnceLock::new();
		MODEL.get_or_init(|| tokio::sync::Mutex::new(None))
	}

	/// Serializes builds so two concurrent `ensure_model` callers don't both
	/// download + load.
	fn build_lock() -> &'static tokio::sync::Mutex<()> {
		static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
		LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
	}

	fn snapshot() -> AsrStatus {
		let s = state();
		AsrStatus {
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

	pub async fn status(_app: &AppHandle) -> AsrStatus {
		snapshot()
	}

	/// Download (if needed) + load. Split out of `ensure_model` so the epoch/slot
	/// bookkeeping stays readable.
	async fn build_model(app: &AppHandle) -> Result<Transcriber, String> {
		let root = tauri_plugin_self::paths::models_dir(app)?;
		state().cancelled.store(false, Ordering::Relaxed);

		if !spec().files_present(&root) {
			set_status(app, "downloading", None);
			let app2 = app.clone();
			let root2 = root.clone();
			let res = tokio::task::spawn_blocking(move || {
				stt::download_and_extract(
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
		let root3 = root.clone();
		tokio::task::spawn_blocking(move || Transcriber::load(&spec(), &root3))
			.await
			.map_err(|e| format!("load task: {e}"))?
	}

	/// Ensure the transcriber is loaded; cache it in `model_slot()`. Builds are
	/// serialized and a cancel/delete during the slow phase is honoured via the
	/// epoch guard.
	async fn ensure_model(app: &AppHandle) -> Result<Arc<Transcriber>, String> {
		if let Some(m) = model_slot().lock().await.clone() {
			return Ok(m);
		}
		let _build = build_lock().lock().await;
		if let Some(m) = model_slot().lock().await.clone() {
			return Ok(m);
		}

		let my_epoch = state().epoch.load(Ordering::SeqCst);
		match build_model(app).await {
			Ok(t) => {
				if state().epoch.load(Ordering::SeqCst) != my_epoch {
					set_status(app, "idle", None);
					return Err(CANCELLED.into());
				}
				let arc = Arc::new(t);
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
				log::warn!(target: "avenos::asr", "voice model preload failed: {e}");
			}
		});
		*state().download_task.lock().unwrap() = Some(handle);
	}

	/// Abort any in-flight download/load and reset progress. `drop_loaded` also
	/// evicts an already-loaded transcriber. Bumping the epoch invalidates a build
	/// still running so it can't later flip the status back to `ready`.
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

	/// Stop the in-flight download/load, keeping any already-loaded transcriber.
	pub fn cancel(app: &AppHandle) {
		reset(app, false);
	}

	/// Evict the loaded transcriber and reset to idle (used when the active
	/// model's files are deleted).
	pub fn unload(app: &AppHandle) {
		reset(app, true);
	}

	pub async fn transcribe(
		app: &AppHandle,
		pcm: Vec<f32>,
		sample_rate: u32,
	) -> Result<VoiceNote, String> {
		let model = ensure_model(app).await?;
		let text = tokio::task::spawn_blocking(move || model.transcribe(&pcm, sample_rate))
			.await
			.map_err(|e| format!("transcribe task: {e}"))?;

		let transcript = text.trim().to_string();
		let title = make_title(&transcript);
		Ok(VoiceNote {
			transcript,
			title,
			summary: String::new(),
		})
	}

	/// Derive a short headline from the transcript (first ~6 words).
	fn make_title(transcript: &str) -> String {
		let words: Vec<&str> = transcript.split_whitespace().take(6).collect();
		if words.is_empty() {
			"Voice note".into()
		} else {
			words.join(" ")
		}
	}
}

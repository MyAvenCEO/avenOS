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

/// Tauri event carrying live partial transcripts as each segment decodes, so the
/// composer can stream text while a long recording is being transcribed. Only
/// emitted by the `local-voice` build.
#[cfg_attr(not(feature = "local-voice"), allow(dead_code))]
pub const PROGRESS_EVENT: &str = "asr:transcribe-progress";

/// Payload of `asr:transcribe-progress`: the cumulative transcript so far plus the
/// 1-based segment `done` of `total`. The composer shows `text` as a live preview;
/// it is NOT posted to the chat until the human submits.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(feature = "local-voice"), allow(dead_code))]
pub struct TranscribeProgress {
	pub text: String,
	pub done: u64,
	pub total: u64,
}

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

/// Begin a **live** transcription session for a new recording: loads the model +
/// VAD if needed and starts the segment-decoding worker. The webview then streams
/// mic PCM via `asr_stream_feed` and ends with `asr_stream_finish`.
#[tauri::command(rename_all = "camelCase")]
pub async fn asr_stream_start(app: AppHandle) -> Result<(), String> {
	if !instance_enabled() {
		return Err("on-device voice transcription runs on the primary instance only".into());
	}
	imp::stream_start(&app).await
}

/// Feed one chunk of mic PCM (mono f32 @ 16 kHz) into the live session. Cheap and
/// fire-and-forget: a Parakeet decode only runs when the VAD closes a segment, and
/// `asr:transcribe-progress` carries the cumulative partial as it does.
#[tauri::command(rename_all = "camelCase")]
pub async fn asr_stream_feed(app: AppHandle, pcm: Vec<f32>, sample_rate: u32) -> Result<(), String> {
	if !instance_enabled() {
		return Ok(());
	}
	imp::stream_feed(&app, pcm, sample_rate).await
}

/// End the live session: flush the VAD's trailing speech, decode it, and return the
/// final `{ transcript, title, summary }`. The caller submits this to the chat.
#[tauri::command(rename_all = "camelCase")]
pub async fn asr_stream_finish(app: AppHandle) -> Result<VoiceNote, String> {
	if !instance_enabled() {
		return Err("on-device voice transcription runs on the primary instance only".into());
	}
	imp::stream_finish(&app).await
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

	pub async fn stream_start(_app: &AppHandle) -> Result<(), String> {
		Err("on-device transcription is not available in this build (enable the `local-voice` feature)".into())
	}

	pub async fn stream_feed(_app: &AppHandle, _pcm: Vec<f32>, _sr: u32) -> Result<(), String> {
		Ok(())
	}

	pub async fn stream_finish(_app: &AppHandle) -> Result<VoiceNote, String> {
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

	use std::time::{Duration, Instant};

	use aven_ai::stt::{self, DownloadError, ModelSpec, StreamTranscriber, Transcriber, Vad, VadSpec};
	use tauri::{AppHandle, Emitter};

	use super::{
		AsrStatus, TranscribeProgress, VoiceNote, DOWNLOAD_EVENT, MODEL_DIR, MODEL_LABEL,
		MODEL_QUANT, PROGRESS_EVENT,
	};

	// Where the model comes from (the URL + file names the engine needs).
	const MODEL_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2";
	const ENCODER: &str = "encoder.int8.onnx";
	const DECODER: &str = "decoder.int8.onnx";
	const JOINER: &str = "joiner.int8.onnx";
	const TOKENS: &str = "tokens.txt";

	// Silero VAD v5 — the latest Silero the pinned sherpa-onnx (1.13) can load (v6
	// changed the model IO and isn't supported here). A ~2 MB bare `.onnx` cached
	// next to the Parakeet model; used to split long recordings into bounded,
	// silence-trimmed speech segments so no single decode runs unbounded.
	const VAD_URL: &str =
		"https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx";
	const VAD_FILE: &str = "silero_vad.onnx";
	/// Hard cap on a single decode window, and the VAD's `max_speech_duration`.
	const MAX_WINDOW_SECS: f32 = 30.0;
	/// Overlap between fallback windows / re-split of long speech runs, so a word on
	/// a cut still lands whole in one window.
	const OVERLAP_SECS: f32 = 0.5;
	/// The webview encodes mic audio to 16 kHz mono; the VAD is built to match.
	const VAD_SAMPLE_RATE: u32 = 16_000;

	fn vad_spec() -> VadSpec {
		VadSpec { file: VAD_FILE, url: VAD_URL }
	}

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
		/// Set to abort an in-flight segmented transcription (e.g. the model is
		/// deleted mid-decode); reset to false at the start of each transcribe.
		transcribe_cancelled: AtomicBool,
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

	/// The loaded Silero VAD, resettable alongside the recognizer.
	fn vad_slot() -> &'static tokio::sync::Mutex<Option<Arc<Vad>>> {
		static VAD: OnceLock<tokio::sync::Mutex<Option<Arc<Vad>>>> = OnceLock::new();
		VAD.get_or_init(|| tokio::sync::Mutex::new(None))
	}

	/// Ensure the Silero VAD is downloaded + loaded; cache it in `vad_slot()`.
	/// Best-effort: any failure returns `None` so transcription falls back to
	/// fixed-window segmentation (still bounded — never the old unbounded decode).
	async fn ensure_vad(app: &AppHandle) -> Option<Arc<Vad>> {
		if let Some(v) = vad_slot().lock().await.clone() {
			return Some(v);
		}
		let root = tauri_plugin_self::paths::models_dir(app).ok()?;
		if !vad_spec().present(&root) {
			let root2 = root.clone();
			let res = tokio::task::spawn_blocking(move || {
				stt::download_file(vad_spec().url, &vad_spec().path(&root2), || false, |_, _| {})
			})
			.await
			.ok()?;
			if let Err(e) = res {
				log::warn!(target: "avenos::asr", "Silero VAD download failed: {e}");
				return None;
			}
		}
		let root3 = root.clone();
		let loaded = tokio::task::spawn_blocking(move || {
			Vad::load(&vad_spec(), &root3, VAD_SAMPLE_RATE, MAX_WINDOW_SECS)
		})
		.await
		.ok()?;
		match loaded {
			Ok(v) => {
				let arc = Arc::new(v);
				*vad_slot().lock().await = Some(arc.clone());
				Some(arc)
			}
			Err(e) => {
				log::warn!(target: "avenos::asr", "Silero VAD load failed: {e}");
				None
			}
		}
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

	/// A message to the live-transcription worker thread.
	enum StreamMsg {
		Pcm(Vec<f32>),
		Finish,
	}

	/// A running live-transcription session: an ordered channel to the worker plus
	/// the worker's final-transcript receiver. One channel keeps feeds in order
	/// (decoding off the IPC threads, never reordered).
	struct StreamSession {
		tx: std::sync::mpsc::Sender<StreamMsg>,
		result_rx: std::sync::Mutex<std::sync::mpsc::Receiver<String>>,
	}

	fn stream_slot() -> &'static std::sync::Mutex<Option<StreamSession>> {
		static SLOT: OnceLock<std::sync::Mutex<Option<StreamSession>>> = OnceLock::new();
		SLOT.get_or_init(|| std::sync::Mutex::new(None))
	}

	/// Start a live session: ensure the model + VAD, spawn a worker that owns the
	/// `StreamTranscriber`, and stash its channels. Any prior session is dropped.
	pub async fn stream_start(app: &AppHandle) -> Result<(), String> {
		let model = ensure_model(app).await?;
		// A streaming session needs its OWN detector — VAD state is per-stream and
		// can't be shared with the cached offline `ensure_vad` instance. Best-effort:
		// without it the worker buffers and decodes (bounded) on finish.
		let vad = load_fresh_vad(app).await;

		state().transcribe_cancelled.store(false, Ordering::Relaxed);

		let (tx, rx) = std::sync::mpsc::channel::<StreamMsg>();
		let (res_tx, res_rx) = std::sync::mpsc::channel::<String>();
		let app2 = app.clone();
		std::thread::spawn(move || {
			let mut st = StreamTranscriber::new(
				model,
				vad,
				VAD_SAMPLE_RATE,
				MAX_WINDOW_SECS,
				OVERLAP_SECS,
			);
			while let Ok(msg) = rx.recv() {
				if state().transcribe_cancelled.load(Ordering::Relaxed) {
					break;
				}
				match msg {
					StreamMsg::Pcm(pcm) => {
						if let Some(text) = st.accept(&pcm) {
							let _ = app2.emit(
								PROGRESS_EVENT,
								TranscribeProgress {
									text,
									done: st.segment_count() as u64,
									total: 0,
								},
							);
						}
					}
					StreamMsg::Finish => break,
				}
			}
			let _ = res_tx.send(st.finish());
		});

		*stream_slot().lock().unwrap() =
			Some(StreamSession { tx, result_rx: std::sync::Mutex::new(res_rx) });
		Ok(())
	}

	/// Load a fresh (un-cached) Silero VAD for a streaming session, downloading it
	/// first if needed. `None` on any failure → the worker falls back to
	/// buffer-then-decode (still bounded; never the old unbounded decode).
	async fn load_fresh_vad(app: &AppHandle) -> Option<Vad> {
		let root = tauri_plugin_self::paths::models_dir(app).ok()?;
		if !vad_spec().present(&root) {
			let root2 = root.clone();
			let res = tokio::task::spawn_blocking(move || {
				stt::download_file(vad_spec().url, &vad_spec().path(&root2), || false, |_, _| {})
			})
			.await
			.ok()?;
			if res.is_err() {
				return None;
			}
		}
		let root3 = root.clone();
		tokio::task::spawn_blocking(move || {
			Vad::load(&vad_spec(), &root3, VAD_SAMPLE_RATE, MAX_WINDOW_SECS).ok()
		})
		.await
		.ok()
		.flatten()
	}

	/// Feed a chunk into the live worker (ordered, non-blocking). The webview sends
	/// 16 kHz mono PCM; the worker is built for that rate.
	pub async fn stream_feed(_app: &AppHandle, pcm: Vec<f32>, _sample_rate: u32) -> Result<(), String> {
		if let Some(s) = stream_slot().lock().unwrap().as_ref() {
			let _ = s.tx.send(StreamMsg::Pcm(pcm));
		}
		Ok(())
	}

	/// Signal end-of-stream and wait for the worker's final transcript.
	pub async fn stream_finish(_app: &AppHandle) -> Result<VoiceNote, String> {
		let session = stream_slot().lock().unwrap().take();
		let Some(session) = session else {
			return Err("no active transcription session".into());
		};
		let _ = session.tx.send(StreamMsg::Finish);
		let text = tokio::task::spawn_blocking(move || {
			session
				.result_rx
				.lock()
				.unwrap()
				.recv()
				.map_err(|e| format!("stream result: {e}"))
		})
		.await
		.map_err(|e| format!("stream finish task: {e}"))??;

		let transcript = text.trim().to_string();
		let title = make_title(&transcript);
		Ok(VoiceNote { transcript, title, summary: String::new() })
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
		// Abort any in-flight segmented transcription too (e.g. model being deleted).
		s.transcribe_cancelled.store(true, Ordering::Relaxed);
		if let Some(h) = s.download_task.lock().unwrap().take() {
			h.abort();
		}
		if drop_loaded {
			if let Ok(mut slot) = model_slot().try_lock() {
				*slot = None;
			}
			if let Ok(mut slot) = vad_slot().try_lock() {
				*slot = None;
			}
			// Drop any live session; its worker sees `transcribe_cancelled` and exits.
			if let Ok(mut slot) = stream_slot().try_lock() {
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
		// Best-effort VAD: on failure we fall back to bounded fixed windows.
		let vad = ensure_vad(app).await;

		// Arm cancellation for this run (a later cancel/delete flips it true).
		state().transcribe_cancelled.store(false, Ordering::Relaxed);

		let app2 = app.clone();
		let text = tokio::task::spawn_blocking(move || {
			let mut last = Instant::now();
			model.transcribe_segmented(
				&pcm,
				sample_rate,
				vad.as_deref(),
				MAX_WINDOW_SECS,
				OVERLAP_SECS,
				&|| state().transcribe_cancelled.load(Ordering::Relaxed),
				&mut |p| {
					// Throttle to ~7/s, but always emit the final segment.
					if p.index == p.total || last.elapsed() >= Duration::from_millis(140) {
						last = Instant::now();
						let _ = app2.emit(
							PROGRESS_EVENT,
							TranscribeProgress {
								text: p.text,
								done: p.index as u64,
								total: p.total as u64,
							},
						);
					}
				},
			)
		})
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

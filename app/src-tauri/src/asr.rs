//! On-device voice-note transcription (Gemma 4 E4B via mistral.rs).
//!
//! Default builds ship only the command surface — `asr_status` reports
//! `unavailable` and `transcribe_audio` errors — so CI / default `cargo check`
//! stays light. The actual model, the first-run weights download into
//! `.avenOS/models/`, and the `asr:model-download` progress events live behind
//! the `local-asr` cargo feature (which pulls in the heavy `mistralrs` crate).
//!
//! The webview captures microphone PCM and calls `transcribe_audio`; the model
//! runs entirely on-device (no network, no API key) and returns the transcript,
//! which the talk UI streams into the message thread.

use serde::Serialize;
use tauri::AppHandle;

/// Friendly label shown in the download UI.
pub const MODEL_LABEL: &str = "Gemma 4 E4B";
/// Hugging Face model id (confirm exact casing/slug against the model card).
/// Only referenced by the `local-asr` build; default builds never read it.
#[cfg_attr(not(feature = "local-asr"), allow(dead_code))]
pub const MODEL_ID: &str = "google/gemma-4-E4B-it";
/// Tauri event the webview listens to for download progress / readiness.
/// Only referenced by the `local-asr` build; default builds never read it.
#[cfg_attr(not(feature = "local-asr"), allow(dead_code))]
pub const DOWNLOAD_EVENT: &str = "asr:model-download";

/// Reply for the `asr_status` command and the shape of `asr:model-download`
/// event payloads. `status` ∈ `downloading | ready | error | unavailable`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AsrStatus {
	pub status: String,
	pub model: String,
	pub received_bytes: u64,
	pub total_bytes: u64,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
}

impl AsrStatus {
	/// Only used by the stub (feature-off) build; `local-asr` builds never call it.
	#[cfg_attr(feature = "local-asr", allow(dead_code))]
	pub fn unavailable() -> Self {
		Self {
			status: "unavailable".into(),
			model: MODEL_LABEL.into(),
			received_bytes: 0,
			total_bytes: 0,
			error: None,
		}
	}
}

/// Current readiness/progress (used by `asr_status` and progress events).
#[tauri::command(rename_all = "camelCase")]
pub async fn asr_status(app: AppHandle) -> Result<AsrStatus, String> {
	Ok(imp::status(&app).await)
}

/// Transcribe captured PCM on-device. `pcm` is mono f32 samples at `sample_rate`.
#[tauri::command(rename_all = "camelCase")]
pub async fn transcribe_audio(
	app: AppHandle,
	pcm: Vec<f32>,
	sample_rate: u32,
) -> Result<String, String> {
	imp::transcribe(&app, pcm, sample_rate).await
}

/// Kick the first-run weights download in the background (no-op without `local-asr`).
/// Called once from the Tauri `setup()` hook.
pub fn spawn_model_download(app: &AppHandle) {
	imp::spawn_download(app);
}

/// One model directory found in the on-device HF cache.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
	/// Hugging Face repo id, e.g. `google/gemma-3n-E4B-it`.
	pub id: String,
	/// Bytes occupied on disk (resolved blobs).
	pub size_bytes: u64,
	/// True for the model AvenOS manages for voice transcription.
	pub is_active: bool,
}

/// List models present on disk (the HF hub cache under `.avenOS/models/hub`).
/// Filesystem-only, so it works regardless of the `local-asr` feature.
#[tauri::command(rename_all = "camelCase")]
pub async fn asr_local_models(app: AppHandle) -> Result<Vec<LocalModel>, String> {
	let dir = tauri_plugin_self::paths::models_dir(&app)?;
	let hub = std::env::var("HF_HUB_CACHE")
		.ok()
		.map(std::path::PathBuf::from)
		.unwrap_or_else(|| dir.join("hub"));

	let mut out = Vec::new();
	let entries = match std::fs::read_dir(&hub) {
		Ok(e) => e,
		Err(_) => return Ok(out), // nothing downloaded yet
	};
	for entry in entries.flatten() {
		let name = entry.file_name().to_string_lossy().to_string();
		// HF cache layout: `models--<org>--<name>`.
		let Some(rest) = name.strip_prefix("models--") else {
			continue;
		};
		let id = rest.replace("--", "/");
		let is_active = id.eq_ignore_ascii_case(MODEL_ID);
		out.push(LocalModel {
			id,
			size_bytes: dir_size(&entry.path()),
			is_active,
		});
	}
	out.sort_by(|a, b| a.id.cmp(&b.id));
	Ok(out)
}

/// Recursively sum file sizes under `path`. `DirEntry::metadata` does not follow
/// symlinks, so the cache's snapshot symlinks add negligible bytes — the real
/// weight bytes live once in `blobs/`.
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
#[cfg(not(feature = "local-asr"))]
mod imp {
	use super::{AppHandle, AsrStatus};

	pub async fn status(_app: &AppHandle) -> AsrStatus {
		AsrStatus::unavailable()
	}

	pub async fn transcribe(_app: &AppHandle, _pcm: Vec<f32>, _sr: u32) -> Result<String, String> {
		Err("on-device transcription is not available in this build (enable the `local-asr` feature)".into())
	}

	pub fn spawn_download(_app: &AppHandle) {}
}

// ───────────────────────── on-device build (`local-asr`) ────────────────────────
#[cfg(feature = "local-asr")]
mod imp {
	use std::path::PathBuf;
	use std::sync::atomic::{AtomicU64, Ordering};
	use std::sync::{Arc, Mutex, OnceLock};

	use hf_hub::api::tokio::{ApiBuilder, ApiRepo, Progress};
	use hf_hub::{Repo, RepoType};
	use mistralrs::{
		AudioInput, IsqType, Model, MultimodalMessages, MultimodalModelBuilder, TextMessageRole,
	};
	use tauri::{AppHandle, Emitter};

	use super::{AsrStatus, DOWNLOAD_EVENT, MODEL_ID, MODEL_LABEL};

	/// Shared readiness state, mirrored to the webview via `asr:model-download`.
	#[derive(Default)]
	struct State {
		status: Mutex<String>,
		error: Mutex<Option<String>>,
		received: AtomicU64,
		total: AtomicU64,
		/// Bytes at the last emitted progress event, for throttling.
		last_emit: AtomicU64,
	}

	fn state() -> &'static State {
		static STATE: OnceLock<State> = OnceLock::new();
		STATE.get_or_init(|| {
			let s = State::default();
			*s.status.lock().unwrap() = "idle".into();
			s
		})
	}

	fn model_cell() -> &'static tokio::sync::OnceCell<Arc<Model>> {
		static MODEL: OnceLock<tokio::sync::OnceCell<Arc<Model>>> = OnceLock::new();
		MODEL.get_or_init(tokio::sync::OnceCell::new)
	}

	fn snapshot() -> AsrStatus {
		let s = state();
		AsrStatus {
			status: s.status.lock().unwrap().clone(),
			model: MODEL_LABEL.into(),
			received_bytes: s.received.load(Ordering::Relaxed),
			total_bytes: s.total.load(Ordering::Relaxed),
			error: s.error.lock().unwrap().clone(),
		}
	}

	fn set_status(app: &AppHandle, status: &str, error: Option<String>) {
		let s = state();
		*s.status.lock().unwrap() = status.into();
		*s.error.lock().unwrap() = error;
		let _ = app.emit(DOWNLOAD_EVENT, snapshot());
	}

	pub async fn status(_app: &AppHandle) -> AsrStatus {
		snapshot()
	}

	/// ~4 MiB between progress emits, so the webview bar moves smoothly without
	/// flooding the event channel on every socket read.
	const EMIT_STEP: u64 = 4 * 1024 * 1024;

	fn emit(app: &AppHandle) {
		let _ = app.emit(DOWNLOAD_EVENT, snapshot());
	}

	/// hf-hub download progress → `asr:model-download` events. Cloned per file;
	/// every clone shares the global byte counters in `state()`.
	#[derive(Clone)]
	struct EmitProgress {
		app: AppHandle,
	}

	impl Progress for EmitProgress {
		async fn init(&mut self, _size: usize, _filename: &str) {
			// Total is computed up-front from the repo listing; nothing to do here.
			emit(&self.app);
		}

		async fn update(&mut self, size: usize) {
			let s = state();
			let prev = s.received.fetch_add(size as u64, Ordering::Relaxed);
			let next = prev + size as u64;
			// Throttle to one event per EMIT_STEP boundary crossed.
			if prev / EMIT_STEP != next / EMIT_STEP {
				s.last_emit.store(next, Ordering::Relaxed);
				emit(&self.app);
			}
		}

		async fn finish(&mut self) {
			emit(&self.app);
		}
	}

	/// A repo file we intend to fetch, with its byte size (`0` when unknown).
	struct RepoFile {
		path: String,
		size: u64,
	}

	/// Files mistral.rs won't load — skipped so the first-run download isn't
	/// inflated by duplicate weight formats (e.g. Gemma's `original/` checkpoint
	/// or parallel PyTorch `.bin` weights alongside safetensors).
	fn is_wanted(path: &str, has_safetensors: bool) -> bool {
		let p = path.to_ascii_lowercase();
		if p.starts_with("original/") || p.starts_with(".git") {
			return false;
		}
		if p.ends_with(".gguf")
			|| p.ends_with(".pth")
			|| p.ends_with(".onnx")
			|| p.ends_with(".h5")
			|| p.ends_with(".msgpack")
			|| p.ends_with(".tflite")
		{
			return false;
		}
		if has_safetensors && p.ends_with(".bin") {
			return false;
		}
		true
	}

	/// List the repo's files with sizes via the already-authenticated
	/// `info_request` (so gated models work with `HF_TOKEN`). Reuses hf-hub's
	/// reqwest client; parsed with `serde_json` to read the `size` field that the
	/// typed `Siblings` struct drops.
	async fn list_repo_files(repo: &ApiRepo) -> Result<Vec<RepoFile>, String> {
		let body = repo
			.info_request()
			.query(&[("blobs", "true")])
			.send()
			.await
			.map_err(|e| format!("repo info: {e}"))?
			.error_for_status()
			.map_err(|e| format!("repo info: {e}"))?
			.text()
			.await
			.map_err(|e| format!("repo info body: {e}"))?;
		let json: serde_json::Value =
			serde_json::from_str(&body).map_err(|e| format!("repo info json: {e}"))?;
		let siblings = json
			.get("siblings")
			.and_then(|s| s.as_array())
			.ok_or_else(|| "repo info: missing siblings".to_string())?;

		let all: Vec<(String, u64)> = siblings
			.iter()
			.filter_map(|s| {
				let path = s.get("rfilename")?.as_str()?.to_string();
				let size = s.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
				Some((path, size))
			})
			.collect();
		let has_safetensors = all.iter().any(|(p, _)| p.ends_with(".safetensors"));
		Ok(all
			.into_iter()
			.filter(|(p, _)| is_wanted(p, has_safetensors))
			.map(|(path, size)| RepoFile { path, size })
			.collect())
	}

	/// Mirror mistral.rs's cache resolution (`HF_HUB_CACHE`, else `HF_HOME/hub`)
	/// so files we pre-download are the exact ones `build()` later loads.
	fn hub_cache_dir(hf_home: &PathBuf) -> PathBuf {
		std::env::var("HF_HUB_CACHE")
			.ok()
			.map(PathBuf::from)
			.unwrap_or_else(|| hf_home.join("hub"))
	}

	/// Pre-download every weight/config file the model needs into the HF cache,
	/// emitting real byte-level progress. `build()` then loads from cache without
	/// re-downloading. Best-effort: if the listing fails we return `Ok` and let
	/// `build()` fetch silently (still works, just without a progress bar).
	async fn prefetch_weights(app: &AppHandle, hf_home: &PathBuf) -> Result<(), String> {
		let token = std::env::var("HF_TOKEN")
			.or_else(|_| std::env::var("HUGGING_FACE_HUB_TOKEN"))
			.ok()
			.filter(|t| !t.trim().is_empty());
		let mut builder = ApiBuilder::from_env().with_cache_dir(hub_cache_dir(hf_home));
		if let Some(t) = token {
			builder = builder.with_token(Some(t));
		}
		let api = builder.build().map_err(|e| format!("hf api: {e}"))?;
		let repo = api.repo(Repo::new(MODEL_ID.to_string(), RepoType::Model));

		let files = match list_repo_files(&repo).await {
			Ok(files) => {
				let total: u64 = files.iter().map(|f| f.size).sum();
				if total > 0 {
					state().total.store(total, Ordering::Relaxed);
				}
				emit(app);
				files
			}
			Err(e) => {
				log::warn!(target: "avenos::asr", "repo listing failed; skipping pre-download progress: {e}");
				return Ok(());
			}
		};

		let progress = EmitProgress { app: app.clone() };
		for f in files {
			repo.download_with_progress(&f.path, progress.clone())
				.await
				.map_err(|e| format!("download {}: {e}", f.path))?;
		}
		Ok(())
	}

	/// Build the model once, pointing the HF cache at `.avenOS/models/` so weights
	/// land where the rest of AvenOS keeps on-device data. The first call triggers
	/// the download; subsequent calls reuse the cached instance.
	async fn ensure_model(app: &AppHandle) -> Result<Arc<Model>, String> {
		model_cell()
			.get_or_try_init(|| async {
				let dir = tauri_plugin_self::paths::models_dir(app)?;
				// hf-hub honours HF_HOME for its cache location.
				std::env::set_var("HF_HOME", &dir);
				set_status(app, "downloading", None);

				// Pre-download with real byte progress, then build from cache.
				prefetch_weights(app, &dir).await?;

				let model = MultimodalModelBuilder::new(MODEL_ID)
					.with_isq(IsqType::Q4K)
					.with_logging()
					.build()
					.await
					.map_err(|e| format!("load {MODEL_ID}: {e}"))?;

				set_status(app, "ready", None);
				Ok(Arc::new(model))
			})
			.await
			.cloned()
			.map_err(|e: String| {
				set_status(app, "error", Some(e.clone()));
				e
			})
	}

	pub fn spawn_download(app: &AppHandle) {
		let app = app.clone();
		tauri::async_runtime::spawn(async move {
			if let Err(e) = ensure_model(&app).await {
				log::warn!(target: "avenos::asr", "voice model preload failed: {e}");
			}
		});
	}

	pub async fn transcribe(app: &AppHandle, pcm: Vec<f32>, sample_rate: u32) -> Result<String, String> {
		let model = ensure_model(app).await?;

		let audio = AudioInput {
			samples: pcm,
			sample_rate,
			channels: 1,
		};
		let messages = MultimodalMessages::new().add_audio_message(
			TextMessageRole::User,
			"Transcribe this voice note verbatim. Return only the transcript text.",
			vec![audio],
		);

		let response = model
			.send_chat_request(messages)
			.await
			.map_err(|e| format!("transcribe: {e}"))?;

		Ok(response
			.choices
			.first()
			.and_then(|c| c.message.content.clone())
			.unwrap_or_default()
			.trim()
			.to_string())
	}
}

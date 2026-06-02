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

/// Tauri event the webview listens to for download progress / readiness.
/// Only referenced by the `local-asr` build; default builds never read it.
#[cfg_attr(not(feature = "local-asr"), allow(dead_code))]
pub const DOWNLOAD_EVENT: &str = "asr:model-download";

/// Best-effort model + quantization for the host hardware. All variants are
/// pre-quantized UQFF repos, so the download is the chosen `.uqff` shard plus the
/// shared `residual.safetensors` (the unquantized audio/vision towers) — far
/// smaller than the full BF16 safetensors, and no in-memory ISQ pass.
pub struct ModelConfig {
	/// Hugging Face UQFF repo id.
	pub repo: &'static str,
	/// Friendly label shown in the UI.
	pub label: &'static str,
	/// Human-readable quantization/optimization, shown as model metadata.
	pub quant: &'static str,
	/// The `.uqff` file (first shard) to load for this platform's quant level.
	pub uqff_file: &'static str,
}

/// - Apple Silicon macOS → E4B, AFQ4 (Metal-optimized affine quant).
/// - iOS → E2B, AFQ4 (smallest that fits a phone's memory budget).
/// - Linux / Windows / Intel Mac → E4B, Q4K (portable CPU/CUDA quant).
pub fn model_config() -> ModelConfig {
	#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
	return ModelConfig {
		repo: "mistralrs-community/gemma-4-E4B-it-UQFF",
		label: "Gemma 4 E4B",
		quant: "AFQ4 · Apple-optimized 4-bit",
		uqff_file: "afq4-0.uqff",
	};
	#[cfg(target_os = "ios")]
	return ModelConfig {
		repo: "mistralrs-community/gemma-4-E2B-it-UQFF",
		label: "Gemma 4 E2B",
		quant: "AFQ4 · Apple-optimized 4-bit",
		uqff_file: "afq4-0.uqff",
	};
	#[cfg(not(any(all(target_os = "macos", target_arch = "aarch64"), target_os = "ios")))]
	return ModelConfig {
		repo: "mistralrs-community/gemma-4-E4B-it-UQFF",
		label: "Gemma 4 E4B",
		quant: "Q4K · portable 4-bit",
		uqff_file: "q4k-0.uqff",
	};
}

/// Reply for the `asr_status` command and the shape of `asr:model-download`
/// event payloads. `status` ∈ `downloading | ready | error | unavailable`.
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
	/// Only used by the stub (feature-off) build; `local-asr` builds never call it.
	#[cfg_attr(feature = "local-asr", allow(dead_code))]
	pub fn unavailable() -> Self {
		let cfg = model_config();
		Self {
			status: "unavailable".into(),
			model: cfg.label.into(),
			quant: cfg.quant.into(),
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
	/// Hugging Face repo id, e.g. `mistralrs-community/gemma-4-E4B-it-UQFF`.
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
		let is_active = id.eq_ignore_ascii_case(model_config().repo);
		out.push(LocalModel {
			id,
			size_bytes: dir_size(&entry.path()),
			is_active,
		});
	}
	out.sort_by(|a, b| a.id.cmp(&b.id));
	Ok(out)
}

/// Stop the in-flight voice-model download and reset progress to idle. No-op in
/// the stub build.
#[tauri::command(rename_all = "camelCase")]
pub async fn asr_cancel_download(app: AppHandle) -> Result<(), String> {
	imp::cancel(&app);
	Ok(())
}

/// (Re)start the voice-model download/load in the background. Used by the Models
/// page's "Download" button after a stop, or for first-run on demand.
#[tauri::command(rename_all = "camelCase")]
pub async fn asr_start_download(app: AppHandle) -> Result<(), String> {
	spawn_model_download(&app);
	Ok(())
}

/// Delete a model directory from the on-device HF cache. If the active model is
/// being downloaded, the download is cancelled first.
#[tauri::command(rename_all = "camelCase")]
pub async fn asr_delete_model(app: AppHandle, id: String) -> Result<(), String> {
	if id.eq_ignore_ascii_case(model_config().repo) {
		imp::cancel(&app);
	}
	if id.contains("..") || id.starts_with('/') {
		return Err("invalid model id".into());
	}
	let dir = tauri_plugin_self::paths::models_dir(&app)?;
	let hub = std::env::var("HF_HUB_CACHE")
		.ok()
		.map(std::path::PathBuf::from)
		.unwrap_or_else(|| dir.join("hub"));
	let folder = format!("models--{}", id.replace('/', "--"));
	let target = hub.join(&folder);
	// Safety: only ever a single `models--*` directory directly under the cache.
	if target.parent() != Some(hub.as_path()) {
		return Err("invalid model id".into());
	}
	if target.exists() {
		std::fs::remove_dir_all(&target).map_err(|e| format!("delete {id}: {e}"))?;
	}
	Ok(())
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

	pub fn cancel(_app: &AppHandle) {}
}

// ───────────────────────── on-device build (`local-asr`) ────────────────────────
#[cfg(feature = "local-asr")]
mod imp {
	use std::path::PathBuf;
	use std::sync::atomic::{AtomicU64, Ordering};
	use std::sync::{Arc, Mutex, OnceLock};

	use hf_hub::api::tokio::{ApiBuilder, ApiRepo, Progress};
	use hf_hub::{Cache, Repo, RepoType};
	use mistralrs::{
		AudioInput, Model, MultimodalMessages, TextMessageRole, UqffMultimodalModelBuilder,
	};
	use tauri::{AppHandle, Emitter};

	use super::{model_config, AsrStatus, DOWNLOAD_EVENT};

	/// Shared readiness state, mirrored to the webview via `asr:model-download`.
	#[derive(Default)]
	struct State {
		status: Mutex<String>,
		error: Mutex<Option<String>>,
		received: AtomicU64,
		total: AtomicU64,
		/// Bytes at the last emitted progress event, for throttling.
		last_emit: AtomicU64,
		/// Handle to the in-flight download task, so `cancel()` can abort it.
		download_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
		/// Set when the user cancels, so the progress reporter aborts the download.
		cancelled: std::sync::atomic::AtomicBool,
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
		let cfg = model_config();
		AsrStatus {
			status: s.status.lock().unwrap().clone(),
			model: cfg.label.into(),
			quant: cfg.quant.into(),
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

	/// Error sentinel for a user-cancelled download (mapped to `idle`, not `error`).
	const CANCELLED: &str = "download cancelled";

	fn emit(app: &AppHandle) {
		let _ = app.emit(DOWNLOAD_EVENT, snapshot());
	}

	/// hf-hub download progress → `asr:model-download` events. Cloned per file;
	/// every clone shares the global byte counters in `state()`.
	#[derive(Clone)]
	struct EmitProgress {
		app: AppHandle,
		/// When the up-front sized listing was unavailable, grow the total as each
		/// file's download begins so the bar still reflects real progress.
		accumulate_total: bool,
	}

	impl Progress for EmitProgress {
		async fn init(&mut self, size: usize, _filename: &str) {
			if self.accumulate_total {
				state().total.fetch_add(size as u64, Ordering::Relaxed);
			}
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

	/// Which repo files to fetch. A UQFF repo ships ~11 quant levels; we keep only
	/// the chosen quant's shards (e.g. `afq4-*.uqff`) plus the shared
	/// `residual.safetensors` and config/tokenizer files — skipping the other
	/// quants and foreign weight formats so the download stays small.
	fn is_wanted(path: &str, uqff_file: &str) -> bool {
		let p = path.to_ascii_lowercase();
		if p.starts_with("original/") || p.starts_with(".git") {
			return false;
		}
		if p.ends_with(".uqff") {
			// Keep only the selected quant's shard(s): "afq4-0.uqff" → "afq4-".
			let stem = uqff_file.split('-').next().unwrap_or(uqff_file);
			return path.starts_with(&format!("{stem}-"));
		}
		if p.ends_with(".gguf")
			|| p.ends_with(".pth")
			|| p.ends_with(".onnx")
			|| p.ends_with(".h5")
			|| p.ends_with(".msgpack")
			|| p.ends_with(".tflite")
			|| p.ends_with(".bin")
		{
			return false;
		}
		true
	}

	/// List the repo's files with sizes via the already-authenticated
	/// `info_request` (so gated models work with `HF_TOKEN`). Reuses hf-hub's
	/// reqwest client; parsed with `serde_json` to read the `size` field that the
	/// typed `Siblings` struct drops.
	async fn list_repo_files(repo: &ApiRepo, uqff_file: &str) -> Result<Vec<RepoFile>, String> {
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
		Ok(all
			.into_iter()
			.filter(|(p, _)| is_wanted(p, uqff_file))
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
		let cfg = model_config();
		let repo = api.repo(Repo::new(cfg.repo.to_string(), RepoType::Model));
		// Cache view for "is this file already downloaded?" checks.
		let cache_repo = Cache::new(hub_cache_dir(hf_home)).repo(Repo::new(cfg.repo.to_string(), RepoType::Model));

		// Prefer the sized listing (exact total up-front). If it fails or comes
		// back empty, fall back to the typed `info()` filenames and grow the total
		// as each file downloads — so the bar always moves rather than sitting at 0.
		let (files, accumulate_total) = match list_repo_files(&repo, cfg.uqff_file).await {
			Ok(files) if !files.is_empty() => {
				let total: u64 = files.iter().map(|f| f.size).sum();
				if total > 0 {
					state().total.store(total, Ordering::Relaxed);
				}
				emit(app);
				(files, false)
			}
			other => {
				if let Err(e) = &other {
					log::warn!(target: "avenos::asr", "sized listing failed ({e}); falling back to info()");
				}
				match repo.info().await {
					Ok(info) => {
						let files: Vec<RepoFile> = info
							.siblings
							.into_iter()
							.map(|s| s.rfilename)
							.filter(|p| is_wanted(p, cfg.uqff_file))
							.map(|path| RepoFile { path, size: 0 })
							.collect();
						emit(app);
						(files, true)
					}
					Err(e) => {
						log::warn!(target: "avenos::asr", "repo info() failed ({e}); build() will fetch without a progress bar");
						return Ok(());
					}
				}
			}
		};

		let progress = EmitProgress {
			app: app.clone(),
			accumulate_total,
		};
		for f in files {
			if state().cancelled.load(Ordering::Relaxed) {
				return Err(CANCELLED.into());
			}
			// Already in the cache → count its bytes and skip (no re-download, no
			// lock contention). `download_with_progress` does NOT check the cache.
			if cache_repo.get(&f.path).is_some() {
				state().received.fetch_add(f.size, Ordering::Relaxed);
				emit(app);
				continue;
			}
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
				state().cancelled.store(false, Ordering::Relaxed);
				set_status(app, "downloading", None);

				// Pre-download with real byte progress, then build from cache.
				prefetch_weights(app, &dir).await?;

				// UQFF is already quantized — load it directly (no in-memory ISQ).
				let cfg = model_config();
				let model = UqffMultimodalModelBuilder::new(cfg.repo, vec![PathBuf::from(cfg.uqff_file)])
					.into_inner()
					.with_logging()
					.build()
					.await
					.map_err(|e| format!("load {}: {e}", cfg.repo))?;

				set_status(app, "ready", None);
				Ok(Arc::new(model))
			})
			.await
			.cloned()
			.map_err(|e: String| {
				// A cancel resets to idle rather than surfacing a scary error.
				if e == CANCELLED {
					set_status(app, "idle", None);
				} else {
					set_status(app, "error", Some(e.clone()));
				}
				e
			})
	}

	pub fn spawn_download(app: &AppHandle) {
		let app = app.clone();
		let handle = tauri::async_runtime::spawn(async move {
			if let Err(e) = ensure_model(&app).await {
				log::warn!(target: "avenos::asr", "voice model preload failed: {e}");
			}
		});
		*state().download_task.lock().unwrap() = Some(handle);
	}

	/// Abort any in-flight download and reset progress to idle. The aborted task
	/// drops its download future mid-file; cached bytes already on disk remain.
	pub fn cancel(app: &AppHandle) {
		let s = state();
		s.cancelled.store(true, Ordering::Relaxed);
		if let Some(h) = s.download_task.lock().unwrap().take() {
			h.abort();
		}
		s.received.store(0, Ordering::Relaxed);
		s.total.store(0, Ordering::Relaxed);
		s.last_emit.store(0, Ordering::Relaxed);
		*s.error.lock().unwrap() = None;
		{
			let mut st = s.status.lock().unwrap();
			if *st != "ready" {
				*st = "idle".into();
			}
		}
		emit(app);
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

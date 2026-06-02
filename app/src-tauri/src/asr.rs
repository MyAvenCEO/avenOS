//! On-device voice-note transcription (Voxtral Mini 3B via mistral.rs).
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
	/// Hugging Face repo id (full-precision safetensors; quantized via ISQ).
	pub repo: &'static str,
	/// Friendly label shown in the UI.
	pub label: &'static str,
	/// Human-readable quantization/optimization, shown as model metadata.
	pub quant: &'static str,
	/// Optional pre-quantized `.uqff` shard. Empty = load safetensors + ISQ.
	pub uqff_file: &'static str,
}

/// Voxtral Mini 3B — a dedicated speech-to-text model (audio + text), small
/// enough to run on-device on an 8 GB machine and iPhone. Loaded from the
/// full-precision repo and quantized to 4-bit in-memory via ISQ (~3 GB RAM):
/// - Apple Silicon (macOS/iOS) → AFQ4 (Metal-optimized affine quant).
/// - Linux / Windows / Intel → Q4K (portable CPU/CUDA quant).
pub fn model_config() -> ModelConfig {
	#[cfg(any(all(target_os = "macos", target_arch = "aarch64"), target_os = "ios"))]
	return ModelConfig {
		repo: "mistralai/Voxtral-Mini-3B-2507",
		label: "Voxtral Mini 3B",
		quant: "AFQ4 · Apple-optimized 4-bit (ISQ)",
		uqff_file: "",
	};
	#[cfg(not(any(all(target_os = "macos", target_arch = "aarch64"), target_os = "ios")))]
	return ModelConfig {
		repo: "mistralai/Voxtral-Mini-3B-2507",
		label: "Voxtral Mini 3B",
		quant: "Q4K · 4-bit (ISQ)",
		uqff_file: "",
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

/// The on-device voice feature runs on the PRIMARY instance only. The dev
/// harness launches a second instance tagged `AVENOS_DEV_INSTANCE=B` (etc.) that
/// shares the same `.avenOS/models` cache — it must not download or load the
/// model (a duplicate multi-GB RAM load + download-lock contention). Enabled when
/// the var is unset/empty (production) or "A" (primary dev instance).
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

/// A transcribed voice note: the verbatim transcript plus a model-extracted
/// title and summary. Produced in one constrained-decoding pass so the JSON is
/// always schema-valid. `JsonSchema` (used to constrain the model) is only
/// derived in the `local-asr` build.
#[derive(Serialize, Clone)]
// Derive from mistral.rs's re-exported schemars so the JsonSchema type matches
// what `generate_structured` expects (avoids a second schemars version).
#[cfg_attr(feature = "local-asr", derive(serde::Deserialize, mistralrs::schemars::JsonSchema))]
#[cfg_attr(feature = "local-asr", schemars(crate = "mistralrs::schemars"))]
#[serde(rename_all = "camelCase")]
pub struct VoiceNote {
	/// Verbatim transcript of what was said.
	pub transcript: String,
	/// Short headline (a few words).
	pub title: String,
	/// One- or two-sentence summary.
	pub summary: String,
}

/// Transcribe captured PCM on-device into `{ transcript, title, summary }`.
/// `pcm` is mono f32 samples at `sample_rate`.
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

/// Kick the first-run weights download in the background (no-op without
/// `local-asr`, or on a secondary dev instance). Called once from the Tauri
/// `setup()` hook.
pub fn spawn_model_download(app: &AppHandle) {
	if !instance_enabled() {
		log::info!(target: "avenos::asr", "secondary instance — skipping voice-model download/load");
		return;
	}
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
	use super::{AppHandle, AsrStatus, VoiceNote};

	pub async fn status(_app: &AppHandle) -> AsrStatus {
		AsrStatus::unavailable()
	}

	pub async fn transcribe(_app: &AppHandle, _pcm: Vec<f32>, _sr: u32) -> Result<VoiceNote, String> {
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
		AudioInput, IsqType, Model, MultimodalMessages, MultimodalModelBuilder, TextMessageRole,
	};
	use tauri::{AppHandle, Emitter};

	use super::{model_config, AsrStatus, VoiceNote, DOWNLOAD_EVENT};

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
		Ok(drop_duplicate_weights(
			all.into_iter()
				.filter(|(p, _)| is_wanted(p, uqff_file))
				.map(|(path, size)| RepoFile { path, size })
				.collect(),
		))
	}

	/// A HF-sharded weight file, e.g. `model-00001-of-00002.safetensors`.
	fn is_sharded_safetensors(path: &str) -> bool {
		path.starts_with("model-") && path.contains("-of-") && path.ends_with(".safetensors")
	}

	/// Drop duplicate weight formats. Mistral repos (e.g. Voxtral) ship the SAME
	/// weights twice: HF-sharded `model-*.safetensors` AND `consolidated.safetensors`.
	/// mistral.rs's loader prefers the shards (its `SAFETENSOR_MATCH` excludes
	/// consolidated), so when shards are present we skip consolidated — otherwise
	/// the first-run download is ~2× the model size.
	fn drop_duplicate_weights(files: Vec<RepoFile>) -> Vec<RepoFile> {
		let has_shards = files.iter().any(|f| is_sharded_safetensors(&f.path));
		if !has_shards {
			return files;
		}
		files
			.into_iter()
			.filter(|f| f.path != "consolidated.safetensors")
			.collect()
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
						let files = drop_duplicate_weights(
							info
								.siblings
								.into_iter()
								.map(|s| s.rfilename)
								.filter(|p| is_wanted(p, cfg.uqff_file))
								.map(|path| RepoFile { path, size: 0 })
								.collect(),
						);
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
			download_one(app, &repo, &cache_repo, &f, &progress).await?;
		}
		Ok(())
	}

	/// Max wall-clock to wait on a blob lock held by another process before giving
	/// up (covers the dev harness's 2nd instance waiting for the 1st to finish a
	/// multi-GB file). ~20 min at 2s/poll.
	const LOCK_WAIT_ATTEMPTS: u32 = 600;

	/// Download one file, coordinating with other processes via hf-hub's per-blob
	/// `flock`. The shared root cache means the model is fetched ONCE: whichever
	/// instance grabs the lock downloads it; the others re-check the cache and
	/// wait here until it appears (the lock frees when the downloader finishes or
	/// dies), then load from cache. No duplicate download, no hard error.
	async fn download_one(
		app: &AppHandle,
		repo: &ApiRepo,
		cache_repo: &hf_hub::CacheRepo,
		f: &RepoFile,
		progress: &EmitProgress,
	) -> Result<(), String> {
		for attempt in 0..LOCK_WAIT_ATTEMPTS {
			if state().cancelled.load(Ordering::Relaxed) {
				return Err(CANCELLED.into());
			}
			// Already cached (possibly just finished by another instance) → count + skip.
			if cache_repo.get(&f.path).is_some() {
				state().received.fetch_add(f.size, Ordering::Relaxed);
				emit(app);
				return Ok(());
			}
			match repo.download_with_progress(&f.path, progress.clone()).await {
				Ok(_) => return Ok(()),
				Err(e) => {
					let msg = e.to_string();
					if msg.contains("Lock acquisition") && attempt + 1 < LOCK_WAIT_ATTEMPTS {
						// Another instance is fetching this file — wait for it.
						if attempt % 15 == 0 {
							log::info!(target: "avenos::asr", "waiting on another instance to fetch {} ({}s)", f.path, attempt * 2);
						}
						tokio::time::sleep(std::time::Duration::from_secs(2)).await;
						continue;
					}
					return Err(format!("download {}: {e}", f.path));
				}
			}
		}
		Err(format!("download {}: timed out waiting on another instance's lock", f.path))
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

				// Load the safetensors and quantize to 4-bit in-memory (ISQ):
				// AFQ4 on Apple Silicon (Metal), Q4K elsewhere.
				#[cfg(any(all(target_os = "macos", target_arch = "aarch64"), target_os = "ios"))]
				let isq = IsqType::AFQ4;
				#[cfg(not(any(all(target_os = "macos", target_arch = "aarch64"), target_os = "ios")))]
				let isq = IsqType::Q4K;

				let cfg = model_config();
				let model = MultimodalModelBuilder::new(cfg.repo)
					.with_isq(isq)
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
		// Don't stack a second download on top of one already in flight.
		if *state().status.lock().unwrap() == "downloading" {
			return;
		}
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

	pub async fn transcribe(app: &AppHandle, pcm: Vec<f32>, sample_rate: u32) -> Result<VoiceNote, String> {
		let model = ensure_model(app).await?;

		let audio = AudioInput {
			samples: pcm,
			sample_rate,
			channels: 1,
		};
		let messages = MultimodalMessages::new().add_audio_message(
			TextMessageRole::User,
			"Transcribe this voice note. Return the verbatim transcript, a short title \
			 (a few words), and a one- or two-sentence summary.",
			vec![audio],
		);

		// Constrained JSON decoding → schema-valid { transcript, title, summary }.
		model
			.generate_structured::<VoiceNote>(messages)
			.await
			.map_err(|e| format!("transcribe: {e}"))
	}
}

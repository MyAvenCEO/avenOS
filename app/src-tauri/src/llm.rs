//! On-device text generation — thin Tauri adapter over the `aven-ai` crate
//! (LFM2.5-8B-A1B ONNX via onnxruntime/`ort`). Sibling of [`crate::asr`].
//!
//! The inference + model-download mechanics live in `aven-ai` (Tauri-free, behind
//! its `llm` feature). This file owns the app-side glue: the `#[tauri::command]`
//! surface, the `llm:model-download` progress events, the status/epoch/cancel
//! state machine, on-disk model listing/deletion, and — the LLM-specific part —
//! **streaming**: `llm_generate` emits one `llm:token` event per decoded token so
//! the webview can render the agent reply live, then a final `done` marker.
//!
//! Default builds (`--no-default-features`) ship only the command surface
//! (`llm_status` → `unavailable`); the real engine is behind the `local-llm`
//! feature (which enables `aven-ai/llm`). The onnxruntime dylib is loaded at
//! runtime from a bundled path (see `imp::resolve_dylib`) — never statically
//! linked, never downloaded as code (App-Store/TestFlight-safe); only the model
//! *weights* download at first run.

use serde::Serialize;
use tauri::AppHandle;

/// Progress/readiness event (download + load). Mirrors `asr:model-download`.
#[cfg_attr(not(any(feature = "local-llm", feature = "local-llama")), allow(dead_code))]
pub const DOWNLOAD_EVENT: &str = "llm:model-download";
/// Per-token streaming event emitted during `llm_generate`.
#[cfg_attr(not(any(feature = "local-llm", feature = "local-llama")), allow(dead_code))]
pub const TOKEN_EVENT: &str = "llm:token";

const MODEL_LABEL: &str = "LFM2.5 8B A1B";

// Backend-dependent label + on-disk dir. `local-llama` (llama.cpp GGUF on Metal) is the
// default; the ONNX/onnxruntime path stays behind `local-llm` for the reuse branch.
#[cfg(feature = "local-llama")]
const MODEL_QUANT: &str = "GGUF · Q4_K_M (llama.cpp · Metal)";
/// Directory under `.avenOS/models/` the GGUF downloads to (also the delete id). Must match
/// `aven_ai::llama::LFM2_5_8B_A1B.dir`.
#[cfg(feature = "local-llama")]
const MODEL_DIR: &str = "lfm2.5-8b-a1b-gguf";

#[cfg(not(feature = "local-llama"))]
const MODEL_QUANT: &str = "ONNX · q4f16 (onnxruntime)";
/// Directory under `.avenOS/models/` the model downloads to (also the delete id).
#[cfg(not(feature = "local-llama"))]
const MODEL_DIR: &str = "lfm2.5-8b-a1b-onnx-q4f16";

/// Status reply + `llm:model-download` payload shape.
/// `status` ∈ `idle | downloading | loading | ready | error | unavailable`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LlmStatus {
	pub status: String,
	pub model: String,
	pub quant: String,
	pub received_bytes: u64,
	pub total_bytes: u64,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
}

impl LlmStatus {
	#[cfg_attr(any(feature = "local-llm", feature = "local-llama"), allow(dead_code))]
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

/// One `llm:token` streaming event. `replyId` ties tokens to the agent message row
/// the webview created; `done` marks end-of-stream (with `token` empty).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LlmToken {
	pub reply_id: String,
	pub token: String,
	pub done: bool,
}

/// On-device LLM runs on the PRIMARY instance only (same rationale as ASR — a
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
pub async fn llm_status(app: AppHandle) -> Result<LlmStatus, String> {
	if !instance_enabled() {
		return Ok(LlmStatus::unavailable());
	}
	Ok(imp::status(&app).await)
}

/// Generate a reply for `prompt`, streaming tokens to the webview via `llm:token`
/// events tagged with `reply_id` (the agent message row the UI created). Returns
/// the full reply text once complete.
#[tauri::command(rename_all = "camelCase")]
pub async fn llm_generate(
	app: AppHandle,
	prompt: String,
	reply_id: String,
) -> Result<String, String> {
	if !instance_enabled() {
		return Err("on-device generation runs on the primary instance only".into());
	}
	imp::generate(&app, prompt, reply_id).await
}

pub fn spawn_model_download(app: &AppHandle) {
	if !instance_enabled() {
		log::info!(target: "avenos::llm", "secondary instance — skipping LLM model download/load");
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

/// List the LFM2 model directory on disk (pure filesystem — works in any build).
#[tauri::command(rename_all = "camelCase")]
pub async fn llm_local_models(app: AppHandle) -> Result<Vec<LocalModel>, String> {
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
pub async fn llm_cancel_download(app: AppHandle) -> Result<(), String> {
	imp::cancel(&app);
	Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn llm_start_download(app: AppHandle) -> Result<(), String> {
	spawn_model_download(&app);
	Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn llm_delete_model(app: AppHandle, id: String) -> Result<(), String> {
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

// ───────────────────────── default build (no engine) ─────────────────────────
#[cfg(not(any(feature = "local-llm", feature = "local-llama")))]
mod imp {
	use super::{AppHandle, LlmStatus};

	pub async fn status(_app: &AppHandle) -> LlmStatus {
		LlmStatus::unavailable()
	}

	pub async fn generate(_app: &AppHandle, _prompt: String, _reply_id: String) -> Result<String, String> {
		Err("on-device generation is not available in this build (enable the `local-llm` feature)".into())
	}

	pub fn spawn_download(_app: &AppHandle) {}
	pub fn cancel(_app: &AppHandle) {}
	pub fn unload(_app: &AppHandle) {}
}

// ─────────────────── ONNX/onnxruntime build (`local-llm` — reuse branch) ───────────────────
#[cfg(all(feature = "local-llm", not(feature = "local-llama")))]
mod imp {
	use std::path::PathBuf;
	use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
	use std::sync::{Arc, Mutex, OnceLock};

	use aven_ai::llm::{self, DownloadError, GenerateOptions, Generator, LlmModelSpec};
	use tauri::{AppHandle, Emitter, Manager};

	use super::{LlmStatus, LlmToken, DOWNLOAD_EVENT, MODEL_DIR, MODEL_LABEL, MODEL_QUANT, TOKEN_EVENT};

	const BASE_URL: &str = "https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-ONNX/resolve/main/";
	/// `(remote_subpath, local_filename)` — the q4f16 graph + its 3 external-weight
	/// sidecars (~4.7 GB total) + tokenizer/config JSON, all flattened into the dir
	/// so the `.onnx` finds its `.onnx_data` siblings.
	const FILES: &[(&str, &str)] = &[
		("onnx/model_q4f16.onnx", "model_q4f16.onnx"),
		("onnx/model_q4f16.onnx_data", "model_q4f16.onnx_data"),
		("onnx/model_q4f16.onnx_data_1", "model_q4f16.onnx_data_1"),
		("onnx/model_q4f16.onnx_data_2", "model_q4f16.onnx_data_2"),
		("tokenizer.json", "tokenizer.json"),
		("tokenizer_config.json", "tokenizer_config.json"),
		("config.json", "config.json"),
		("generation_config.json", "generation_config.json"),
	];

	fn spec() -> LlmModelSpec {
		LlmModelSpec {
			dir: MODEL_DIR,
			base_url: BASE_URL,
			files: FILES,
			onnx: "model_q4f16.onnx",
			tokenizer: "tokenizer.json",
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

	fn model_slot() -> &'static tokio::sync::Mutex<Option<Arc<Generator>>> {
		static MODEL: OnceLock<tokio::sync::Mutex<Option<Arc<Generator>>>> = OnceLock::new();
		MODEL.get_or_init(|| tokio::sync::Mutex::new(None))
	}

	fn build_lock() -> &'static tokio::sync::Mutex<()> {
		static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
		LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
	}

	fn snapshot() -> LlmStatus {
		let s = state();
		LlmStatus {
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

	pub async fn status(_app: &AppHandle) -> LlmStatus {
		snapshot()
	}

	/// Resolve the bundled onnxruntime dylib `ort` should load. Resolution order:
	/// 1. `AVENOS_ORT_DYLIB` env (dev escape hatch / explicit override),
	/// 2. the app bundle's resources (`<resources>/onnxruntime/libonnxruntime.dylib`,
	///    populated by the Tauri bundler — see the `Bundle onnxruntime` task),
	/// 3. `<models>/onnxruntime/libonnxruntime.dylib` (a dev-provisioned copy).
	/// Returns an error (not a panic) so the UI can surface "runtime missing".
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

	async fn build_model(app: &AppHandle) -> Result<Generator, String> {
		let root = tauri_plugin_self::paths::models_dir(app)?;
		state().cancelled.store(false, Ordering::Relaxed);

		if !spec().files_present(&root) {
			set_status(app, "downloading", None);
			let app2 = app.clone();
			let root2 = root.clone();
			let res = tokio::task::spawn_blocking(move || {
				llm::download_files(
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
		// Load the onnxruntime dylib (idempotent) before building the session.
		let dylib = resolve_dylib(app)?;
		llm::init_runtime(&dylib)?;
		let root3 = root.clone();
		tokio::task::spawn_blocking(move || Generator::load(&spec(), &root3))
			.await
			.map_err(|e| format!("load task: {e}"))?
	}

	async fn ensure_model(app: &AppHandle) -> Result<Arc<Generator>, String> {
		if let Some(m) = model_slot().lock().await.clone() {
			return Ok(m);
		}
		let _build = build_lock().lock().await;
		if let Some(m) = model_slot().lock().await.clone() {
			return Ok(m);
		}

		let my_epoch = state().epoch.load(Ordering::SeqCst);
		match build_model(app).await {
			Ok(g) => {
				if state().epoch.load(Ordering::SeqCst) != my_epoch {
					set_status(app, "idle", None);
					return Err(CANCELLED.into());
				}
				let arc = Arc::new(g);
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
				log::warn!(target: "avenos::llm", "LLM model preload failed: {e}");
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

	pub async fn generate(app: &AppHandle, prompt: String, reply_id: String) -> Result<String, String> {
		let model = ensure_model(app).await?;
		let app2 = app.clone();
		let reply = reply_id.clone();
		let text = tokio::task::spawn_blocking(move || {
			model.generate(
				&prompt,
				GenerateOptions::default(),
				|piece| {
					let _ = app2.emit(
						TOKEN_EVENT,
						LlmToken { reply_id: reply.clone(), token: piece.to_string(), done: false },
					);
				},
				|| false,
			)
		})
		.await
		.map_err(|e| format!("generate task: {e}"))?;

		// End-of-stream marker (also sent on error so the UI can stop the spinner).
		let _ = app.emit(
			TOKEN_EVENT,
			LlmToken { reply_id, token: String::new(), done: true },
		);
		text
	}
}

// ─────────────── llama.cpp / GGUF build (`local-llama` — Metal, default) ───────────────
// Same status/epoch/cancel state machine as the ONNX imp, but the engine is `aven_ai::llama`
// (LFM2.5-8B-A1B GGUF on Metal, statically linked — no dylib to resolve/sign). The model is
// loaded once into a resident `LlamaEngine` and reused; each generate streams tokens.
#[cfg(feature = "local-llama")]
mod imp {
	use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
	use std::sync::{Arc, Mutex, OnceLock};

	use aven_ai::llama::{self, DownloadError, LlamaEngine};
	use tauri::{AppHandle, Emitter};

	use super::{LlmStatus, LlmToken, DOWNLOAD_EVENT, MODEL_LABEL, MODEL_QUANT, TOKEN_EVENT};

	/// The GGUF spec (download URL + on-disk dir); `super::MODEL_DIR` mirrors `spec.dir`.
	fn spec() -> llama::LlamaModelSpec {
		llama::LFM2_5_8B_A1B
	}

	const CANCELLED: &str = "download cancelled";
	/// Cap on one reply's decode length.
	const MAX_NEW_TOKENS: usize = 512;

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

	fn model_slot() -> &'static tokio::sync::Mutex<Option<Arc<LlamaEngine>>> {
		static MODEL: OnceLock<tokio::sync::Mutex<Option<Arc<LlamaEngine>>>> = OnceLock::new();
		MODEL.get_or_init(|| tokio::sync::Mutex::new(None))
	}

	fn build_lock() -> &'static tokio::sync::Mutex<()> {
		static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
		LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
	}

	fn snapshot() -> LlmStatus {
		let s = state();
		LlmStatus {
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

	pub async fn status(_app: &AppHandle) -> LlmStatus {
		snapshot()
	}

	async fn build_model(app: &AppHandle) -> Result<LlamaEngine, String> {
		let root = tauri_plugin_self::paths::models_dir(app)?;
		state().cancelled.store(false, Ordering::Relaxed);
		let s = spec();

		if !s.is_present(&root) {
			set_status(app, "downloading", None);
			let app2 = app.clone();
			let root2 = root.clone();
			let res = tokio::task::spawn_blocking(move || {
				llama::download(
					&s,
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
		let path = s.model_path(&root);
		tokio::task::spawn_blocking(move || LlamaEngine::load(&path))
			.await
			.map_err(|e| format!("load task: {e}"))?
	}

	async fn ensure_model(app: &AppHandle) -> Result<Arc<LlamaEngine>, String> {
		if let Some(m) = model_slot().lock().await.clone() {
			return Ok(m);
		}
		let _build = build_lock().lock().await;
		if let Some(m) = model_slot().lock().await.clone() {
			return Ok(m);
		}

		let my_epoch = state().epoch.load(Ordering::SeqCst);
		match build_model(app).await {
			Ok(g) => {
				if state().epoch.load(Ordering::SeqCst) != my_epoch {
					set_status(app, "idle", None);
					return Err(CANCELLED.into());
				}
				let arc = Arc::new(g);
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
				log::warn!(target: "avenos::llm", "LLM model preload failed: {e}");
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

	pub async fn generate(app: &AppHandle, prompt: String, reply_id: String) -> Result<String, String> {
		let engine = ensure_model(app).await?;
		let app2 = app.clone();
		let reply = reply_id.clone();
		let stats = tokio::task::spawn_blocking(move || {
			engine.generate(
				&prompt,
				MAX_NEW_TOKENS,
				|piece| {
					let _ = app2.emit(
						TOKEN_EVENT,
						LlmToken { reply_id: reply.clone(), token: piece.to_string(), done: false },
					);
				},
				|| false,
			)
		})
		.await
		.map_err(|e| format!("generate task: {e}"))?;

		// End-of-stream marker (also sent on error so the UI can stop the spinner).
		let _ = app.emit(
			TOKEN_EVENT,
			LlmToken { reply_id, token: String::new(), done: true },
		);
		stats.map(|s| s.text)
	}
}

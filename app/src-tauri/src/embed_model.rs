//! EmbeddingGemma model management — the EXACT same download flow as the other local
//! models (asr/llm/tts): `embed_status` + `embed:model-download` progress events,
//! `embed_local_models`, `embed_start_download`, `embed_cancel_download`,
//! `embed_delete_model`. Weights come from the HF repo of
//! [`aven_ai::embed::EMBEDDINGGEMMA_300M`] via the shared resumable downloader.
//!
//! The brain picks the model up lazily (`avendb::brain_ipc::AppEmbedder`) — once the
//! files are present, the next brain call embeds with Gemma instead of the stub
//! (run `brainReembed` afterwards to migrate existing memories into Gemma space).

use serde::Serialize;
use tauri::AppHandle;
// `Emitter` is only used by the real (brain-gemma) `imp` to push download-progress events;
// without that feature there's no emit, so the import would be dead.
#[cfg(feature = "brain-gemma")]
use tauri::Emitter;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmbedStatus {
	pub status: String,
	pub model: String,
	pub received_bytes: u64,
	pub total_bytes: u64,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmbedLocalModel {
	pub id: String,
	pub size_bytes: u64,
	pub is_active: bool,
}

#[cfg(feature = "brain-gemma")]
mod imp {
	use super::*;
	use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
	use std::sync::{Mutex, OnceLock};

	pub const MODEL_ID: &str = aven_ai::embed::EMBEDDINGGEMMA_300M.dir;

	struct State {
		status: Mutex<String>,
		received: AtomicU64,
		total: AtomicU64,
		error: Mutex<Option<String>>,
		cancelled: AtomicBool,
		task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
	}

	fn state() -> &'static State {
		static S: OnceLock<State> = OnceLock::new();
		S.get_or_init(|| State {
			status: Mutex::new("idle".into()),
			received: AtomicU64::new(0),
			total: AtomicU64::new(0),
			error: Mutex::new(None),
			cancelled: AtomicBool::new(false),
			task: Mutex::new(None),
		})
	}

	pub fn snapshot(app: &AppHandle) -> EmbedStatus {
		let spec = &aven_ai::embed::EMBEDDINGGEMMA_300M;
		let mut status = state().status.lock().unwrap().clone();
		// Filesystem truth wins for the terminal state (same as the other models).
		if status == "idle" {
			if let Ok(root) = tauri_plugin_self::paths::models_dir(app) {
				if spec.files_present(&root) {
					status = "ready".into();
				}
			}
		}
		EmbedStatus {
			status,
			model: MODEL_ID.into(),
			received_bytes: state().received.load(Ordering::Relaxed),
			total_bytes: state().total.load(Ordering::Relaxed),
			error: state().error.lock().unwrap().clone(),
		}
	}

	fn emit(app: &AppHandle) {
		let _ = app.emit("embed:model-download", snapshot(app));
	}

	pub fn spawn_download(app: &AppHandle) {
		{
			let st = state().status.lock().unwrap();
			if *st == "downloading" {
				return;
			}
		}
		state().cancelled.store(false, Ordering::Relaxed);
		*state().error.lock().unwrap() = None;
		*state().status.lock().unwrap() = "downloading".into();
		emit(app);

		let app = app.clone();
		let handle = tauri::async_runtime::spawn(async move {
			let result = tauri::async_runtime::spawn_blocking({
				let app = app.clone();
				move || -> Result<(), String> {
					let spec = &aven_ai::embed::EMBEDDINGGEMMA_300M;
					let root = tauri_plugin_self::paths::models_dir(&app)?;
					let dir = spec.model_dir(&root);
					let base_url =
						format!("https://huggingface.co/{}/resolve/main/", spec.repo);
					let files: Vec<(&str, &str)> =
						spec.files.iter().map(|f| (*f, *f)).collect();
					let app2 = app.clone();
					aven_ai::download::download_files(
						&dir,
						&base_url,
						&files,
						|| state().cancelled.load(Ordering::Relaxed),
						move |recv, total| {
							state().received.store(recv, Ordering::Relaxed);
							state().total.store(total, Ordering::Relaxed);
							emit(&app2);
						},
					)
					.map_err(|e| e.to_string())
				}
			})
			.await
			.map_err(|e| format!("download task: {e}"))
			.and_then(|r| r);

			match result {
				Ok(()) => {
					*state().status.lock().unwrap() = "ready".into();
				}
				Err(e) => {
					let cancelled = state().cancelled.load(Ordering::Relaxed);
					if cancelled {
						*state().status.lock().unwrap() = "idle".into();
					} else {
						// Surface the failure as `error` (NOT `idle`) so the row shows WHY instead of
						// silently flicking back to a Download button.
						log::warn!(target: "avenos::embed", "gemma download failed: {e}");
						*state().status.lock().unwrap() = "error".into();
						*state().error.lock().unwrap() = Some(e);
					}
				}
			}
			emit(&app);
		});
		*state().task.lock().unwrap() = Some(handle);
	}

	pub fn cancel(app: &AppHandle) {
		state().cancelled.store(true, Ordering::Relaxed);
		if let Some(h) = state().task.lock().unwrap().take() {
			h.abort();
		}
		*state().status.lock().unwrap() = "idle".into();
		state().received.store(0, Ordering::Relaxed);
		state().total.store(0, Ordering::Relaxed);
		emit(app);
	}

	/// ENFORCE gemma mode: auto-start the download iff the weights aren't already on disk. No-op
	/// when present (avoids a downloading→ready flicker) or already in-flight (`spawn_download`
	/// guards that). Called on first brain use so the embedder is always fetched without a click.
	pub fn ensure(app: &AppHandle) {
		if let Ok(root) = tauri_plugin_self::paths::models_dir(app) {
			if aven_ai::embed::EMBEDDINGGEMMA_300M.files_present(&root) {
				return;
			}
		}
		spawn_download(app);
	}
}

#[cfg(not(feature = "brain-gemma"))]
mod imp {
	use super::*;
	pub const MODEL_ID: &str = "embeddinggemma-300m-onnx";
	pub fn snapshot(_app: &AppHandle) -> EmbedStatus {
		EmbedStatus {
			status: "unavailable".into(),
			model: MODEL_ID.into(),
			received_bytes: 0,
			total_bytes: 0,
			error: None,
		}
	}
	pub fn spawn_download(_app: &AppHandle) {}
	pub fn cancel(_app: &AppHandle) {}
}

/// ENFORCE gemma mode: auto-fetch the embedder weights if missing (idempotent). The brain calls
/// this on first use so it converges to EmbeddingGemma without a manual Download click. Only the
/// `brain-gemma` build has a downloader (and the only caller, `brain_ipc`, is likewise gated).
#[cfg(feature = "brain-gemma")]
pub fn ensure_download(app: &AppHandle) {
	imp::ensure(app);
}

#[tauri::command(rename_all = "camelCase")]
pub async fn embed_status(app: AppHandle) -> Result<EmbedStatus, String> {
	Ok(imp::snapshot(&app))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn embed_local_models(app: AppHandle) -> Result<Vec<EmbedLocalModel>, String> {
	let dir = tauri_plugin_self::paths::models_dir(&app)?;
	let model_dir = dir.join(imp::MODEL_ID);
	let mut out = Vec::new();
	if model_dir.exists() {
		out.push(EmbedLocalModel {
			id: imp::MODEL_ID.into(),
			size_bytes: dir_size(&model_dir),
			is_active: true,
		});
	}
	Ok(out)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn embed_start_download(app: AppHandle) -> Result<(), String> {
	imp::spawn_download(&app);
	Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn embed_cancel_download(app: AppHandle) -> Result<(), String> {
	imp::cancel(&app);
	Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn embed_delete_model(app: AppHandle, id: String) -> Result<(), String> {
	if id != imp::MODEL_ID {
		return Err("invalid model id".into());
	}
	let dir = tauri_plugin_self::paths::models_dir(&app)?;
	let target = dir.join(imp::MODEL_ID);
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

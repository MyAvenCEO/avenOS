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
pub const MODEL_ID: &str = "google/gemma-4-E4B-it";
/// Tauri event the webview listens to for download progress / readiness.
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
	use std::sync::atomic::{AtomicU64, Ordering};
	use std::sync::{Arc, Mutex, OnceLock};

	use mistralrs::{
		AudioInput, IsqType, Model, MultimodalModelBuilder, TextMessageRole, TextMessages,
	};
	use tauri::{AppHandle, Emitter, Manager};

	use super::{AsrStatus, DOWNLOAD_EVENT, MODEL_ID, MODEL_LABEL};

	/// Shared readiness state, mirrored to the webview via `asr:model-download`.
	#[derive(Default)]
	struct State {
		status: Mutex<String>,
		error: Mutex<Option<String>>,
		received: AtomicU64,
		total: AtomicU64,
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

		let audio = AudioInput::from_samples(pcm, sample_rate);
		let messages = TextMessages::new()
			.add_audio_message(
				TextMessageRole::User,
				"Transcribe this voice note verbatim. Return only the transcript text.",
				audio,
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

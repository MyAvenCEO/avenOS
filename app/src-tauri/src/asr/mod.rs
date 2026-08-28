//! Asset acquisition for the native voice recognizer.
//!
//! Microphone ownership, framing, VAD, and recognition are composed by the
//! software-first voice runtime. This module deliberately contains no Tauri
//! audio command and no webview PCM path.

use crate::assets::{cache_dir, ensure_file, ensure_files, stage};
use anyhow::Result;
use aven_voice_models::vad;

const MODEL_BASE: &str =
	"https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-3.5-asr-streaming-0.6b-onnx";

const MODEL_FILES: &[&str] = &[
	"config.json",
	"encoder.onnx",
	"encoder.onnx.data",
	"decoder_joint.onnx",
	"tokenizer.model",
];

pub(crate) struct ModelPaths {
	pub model_dir: std::path::PathBuf,
	pub vad_path: std::path::PathBuf,
}

pub(crate) fn prepare_model_paths(app: &tauri::AppHandle) -> Result<ModelPaths> {
	stage(app, "asr", "download");
	let dir = cache_dir(app, "asr", "nemotron-3.5-streaming")?;
	let wanted: Vec<(String, std::path::PathBuf)> = MODEL_FILES
		.iter()
		.map(|name| (format!("{MODEL_BASE}/{name}"), dir.join(name)))
		.collect();
	ensure_files(app, "asr", &wanted)?;

	let vad_path = cache_dir(app, "asr", "silero-vad")?.join("silero_vad.onnx");
	ensure_file(app, "asr", vad::MODEL_URL, &vad_path)?;

	stage(app, "asr", "load");
	let result = Ok(ModelPaths {
		model_dir: dir,
		vad_path,
		});
	stage(app, "asr", "ready");
	result
}

//! On-device German text to speech.
//!
//! Supertonic-3 (~99M params, 31 languages) run through ONNX Runtime. Nothing
//! leaves the machine and no API key exists: the models are downloaded once and
//! every synthesis after that is local.
//!
//! Why this and not the alternatives we tried first: Moonshine has no German
//! STT at all and licenses its non-English models non-commercially, and its
//! browser build cannot start Piper (the only vocoder with German) because the
//! WASM binding hands assets from memory while Piper insists on a real
//! directory. FluidAudio wraps these same Supertonic weights in CoreML, but
//! only from Swift — going straight to the upstream ONNX build keeps the whole
//! thing in Rust and works on Linux and Windows too.
//!
//! Measured on this machine (M-series, CPU only, no GPU/ANE): 9.23s of audio
//! synthesized in 2.09s, i.e. ~4.4x realtime. The webview splits replies into
//! sentences, so a sentence lands well inside the gap while the model writes
//! the next one.

mod supertonic;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::{Context, Result};
use tauri::State;

use crate::assets::{cache_dir, ensure_file, ensure_files};

/// Everything the synthesizer needs, published as one HuggingFace revision.
/// `vector_estimator` is by far the largest at ~245 MB.
const MODEL_FILES: &[&str] = &[
	"duration_predictor.onnx",
	"text_encoder.onnx",
	"vector_estimator.onnx",
	"vocoder.onnx",
	"tts.json",
	"unicode_indexer.json",
];

const MODEL_BASE: &str = "https://huggingface.co/Supertone/supertonic-3/resolve/main/onnx";
const VOICE_BASE: &str = "https://huggingface.co/Supertone/supertonic-3/resolve/main/voice_styles";

/// The ten presets Supertonic publishes. Each is a single JSON file fetched on
/// demand, so auditioning one costs ~290 KB rather than another model download.
pub const VOICES: &[&str] = &["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"];

/// M5 — the voice avenOS speaks with.
const DEFAULT_VOICE: &str = "M5";

/// Denoising steps. Upstream's default; lower trades quality for latency.
const TOTAL_STEPS: usize = 8;
/// Upstream's default speaking rate. 0.9-1.5 is the sane range.
const SPEED: f32 = 1.05;
/// Silence inserted between chunks of a long utterance, in seconds.
const CHUNK_SILENCE: f32 = 0.3;

/// The loaded engine. ONNX sessions are expensive to build (~400 MB of weights)
/// so it is created once on first use and reused for every utterance after.
#[derive(Default)]
pub struct TtsState {
	engine: Mutex<Option<Engine>>,
}

struct Engine {
	tts: supertonic::TextToSpeech,
	/// Styles are cached per voice so switching back to one already auditioned
	/// costs nothing. The ONNX sessions above are shared by all of them.
	styles: HashMap<String, supertonic::Style>,
	dir: PathBuf,
}

impl Engine {
	/// Fetch and decode `voice` if it is not cached yet.
	///
	/// Deliberately returns nothing rather than a reference: the caller reads
	/// `self.styles` and `self.tts` as separate fields, which the borrow checker
	/// allows, whereas handing back a borrow of `self` would not.
	fn ensure_style(&mut self, app: &tauri::AppHandle, voice: &str) -> Result<()> {
		if self.styles.contains_key(voice) {
			return Ok(());
		}
		let path = self.dir.join(format!("{voice}.json"));
		ensure_file(app, "tts", &format!("{VOICE_BASE}/{voice}.json"), &path)?;
		let style = supertonic::load_voice_style(&[path.to_string_lossy().to_string()], false)
			.with_context(|| format!("failed to load voice style {voice}"))?;
		self.styles.insert(voice.to_string(), style);
		Ok(())
	}
}

fn load_engine(app: &tauri::AppHandle) -> Result<Engine> {
	let dir = cache_dir(app, "tts", "supertonic-3")?;
	let wanted: Vec<(String, PathBuf)> = MODEL_FILES
		.iter()
		.map(|name| (format!("{MODEL_BASE}/{name}"), dir.join(name)))
		.collect();
	ensure_files(app, "tts", &wanted)?;

	let tts = supertonic::load_text_to_speech(&dir.to_string_lossy(), false)
		.context("failed to open the Supertonic ONNX sessions")?;

	let mut engine = Engine {
		tts,
		styles: HashMap::new(),
		dir,
	};
	// Warm the default so the first sentence does not pay for a fetch.
	engine.ensure_style(app, DEFAULT_VOICE)?;
	Ok(engine)
}

/// Load the models, downloading them on first run.
///
/// Separate from `tts_speak` so the UI can pay the multi-hundred-megabyte cost
/// at a moment of its choosing (and show that it is happening) rather than
/// having the first sentence mysteriously take a minute.
#[tauri::command]
pub async fn tts_prepare(app: tauri::AppHandle, state: State<'_, TtsState>) -> Result<(), String> {
	let mut guard = state.engine.lock().map_err(|e| e.to_string())?;
	if guard.is_some() {
		return Ok(());
	}
	*guard = Some(load_engine(&app).map_err(|e| format!("{e:#}"))?);
	Ok(())
}

/// Synthesize one utterance, returning a 44.1 kHz mono WAV.
///
/// A WAV rather than raw samples so the webview can hand it straight to
/// `decodeAudioData` — the bytes ride Tauri's IPC as a binary response, not as
/// a JSON array of a few hundred thousand floats.
#[tauri::command]
pub async fn tts_speak(
	app: tauri::AppHandle,
	state: State<'_, TtsState>,
	text: String,
	lang: Option<String>,
	voice: Option<String>,
) -> Result<tauri::ipc::Response, String> {
	let lang = lang.unwrap_or_else(|| "de".to_string());
	let voice = voice.unwrap_or_else(|| DEFAULT_VOICE.to_string());
	if !VOICES.contains(&voice.as_str()) {
		return Err(format!("unknown voice {voice}"));
	}
	if text.trim().is_empty() {
		return Err("nothing to say".into());
	}

	let mut guard = state.engine.lock().map_err(|e| e.to_string())?;
	if guard.is_none() {
		*guard = Some(load_engine(&app).map_err(|e| format!("{e:#}"))?);
	}
	let engine = guard.as_mut().expect("engine loaded above");

	engine.ensure_style(&app, &voice).map_err(|e| format!("{e:#}"))?;

	let started = std::time::Instant::now();
	// `styles` and `tts` are disjoint fields, so one can be read while the other
	// is mutated.
	let style = &engine.styles[&voice];
	let (samples, _duration) = engine
		.tts
		.call(&text, &lang, style, TOTAL_STEPS, SPEED, CHUNK_SILENCE)
		.map_err(|e| format!("synthesis failed: {e:#}"))?;

	let rate = engine.tts.sample_rate;
	log::info!(
		target: "avenos::tts",
		"spoke {} chars -> {:.2}s of audio in {:.2}s",
		text.chars().count(),
		samples.len() as f32 / rate as f32,
		started.elapsed().as_secs_f32()
	);

	Ok(tauri::ipc::Response::new(wav_bytes(&samples, rate)))
}

/// Minimal 16-bit PCM WAV container around the float samples.
fn wav_bytes(samples: &[f32], sample_rate: i32) -> Vec<u8> {
	let data_len = samples.len() * 2;
	let mut out = Vec::with_capacity(44 + data_len);

	out.extend_from_slice(b"RIFF");
	out.extend_from_slice(&((36 + data_len) as u32).to_le_bytes());
	out.extend_from_slice(b"WAVEfmt ");
	out.extend_from_slice(&16u32.to_le_bytes()); // PCM header size
	out.extend_from_slice(&1u16.to_le_bytes()); // PCM
	out.extend_from_slice(&1u16.to_le_bytes()); // mono
	out.extend_from_slice(&(sample_rate as u32).to_le_bytes());
	out.extend_from_slice(&((sample_rate as u32) * 2).to_le_bytes()); // byte rate
	out.extend_from_slice(&2u16.to_le_bytes()); // block align
	out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
	out.extend_from_slice(b"data");
	out.extend_from_slice(&(data_len as u32).to_le_bytes());

	for &sample in samples {
		out.extend_from_slice(&((sample.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
	}
	out
}

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

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use tauri::{Manager, State};

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

/// M1 — the default male preset, and the voice picked for avenOS. The other
/// nine (M2-M5, F1-F5) are the same download shape, so switching is a one-line
/// change plus a file fetch.
const VOICE: &str = "M1";

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
	style: supertonic::Style,
}

/// Where models live. `AVEN_TTS_MODEL_DIR` overrides it, which is how a dev
/// machine reuses an existing copy instead of pulling 400 MB again.
fn model_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
	if let Ok(dir) = std::env::var("AVEN_TTS_MODEL_DIR") {
		return Ok(PathBuf::from(dir));
	}
	let base = app
		.path()
		.app_cache_dir()
		.context("no app cache dir on this platform")?;
	Ok(base.join("tts").join("supertonic-3"))
}

/// Fetch `url` to `dest` unless it is already there.
///
/// Written to a `.part` file first so an interrupted download cannot leave a
/// truncated model behind that then fails to load with something inscrutable.
fn ensure_file(url: &str, dest: &Path) -> Result<()> {
	if dest.exists() {
		return Ok(());
	}
	if let Some(parent) = dest.parent() {
		fs::create_dir_all(parent)?;
	}

	log::info!(target: "avenos::tts", "downloading {url}");
	let response = ureq::get(url)
		.call()
		.with_context(|| format!("failed to fetch {url}"))?;

	let mut bytes = Vec::new();
	response.into_reader().read_to_end(&mut bytes)?;

	let part = dest.with_extension("part");
	fs::write(&part, &bytes)?;
	fs::rename(&part, dest)?;
	log::info!(target: "avenos::tts", "fetched {} ({} bytes)", dest.display(), bytes.len());
	Ok(())
}

fn ensure_models(dir: &Path) -> Result<PathBuf> {
	for name in MODEL_FILES {
		ensure_file(&format!("{MODEL_BASE}/{name}"), &dir.join(name))?;
	}
	let voice = dir.join(format!("{VOICE}.json"));
	ensure_file(&format!("{VOICE_BASE}/{VOICE}.json"), &voice)?;
	Ok(voice)
}

fn load_engine(app: &tauri::AppHandle) -> Result<Engine> {
	let dir = model_dir(app)?;
	let voice_path = ensure_models(&dir)?;

	let dir_str = dir.to_string_lossy().to_string();
	let tts = supertonic::load_text_to_speech(&dir_str, false)
		.context("failed to open the Supertonic ONNX sessions")?;
	let style = supertonic::load_voice_style(&[voice_path.to_string_lossy().to_string()], false)
		.context("failed to load the voice style")?;

	Ok(Engine { tts, style })
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
) -> Result<tauri::ipc::Response, String> {
	let lang = lang.unwrap_or_else(|| "de".to_string());
	if text.trim().is_empty() {
		return Err("nothing to say".into());
	}

	let mut guard = state.engine.lock().map_err(|e| e.to_string())?;
	if guard.is_none() {
		*guard = Some(load_engine(&app).map_err(|e| format!("{e:#}"))?);
	}
	let engine = guard.as_mut().expect("engine loaded above");

	let started = std::time::Instant::now();
	let (samples, _duration) = engine
		.tts
		.call(&text, &lang, &engine.style, TOTAL_STEPS, SPEED, CHUNK_SILENCE)
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

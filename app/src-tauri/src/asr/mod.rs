//! On-device German speech recognition, with voice-activity detection.
//!
//! Two models, both ONNX through the same runtime the voice already uses:
//!
//! - **Silero VAD v5** decides when someone is talking. It is language-agnostic
//!   (trained across thousands of languages), a few hundred kilobytes, and the
//!   only part that has to be fast enough to interrupt — barge-in never waits
//!   for transcription, it fires the moment speech is detected.
//! - **Nemotron 3.5 streaming 0.6B** turns that speech into text as it arrives,
//!   cache-aware over 560 ms chunks, 40 language-locales with German as
//!   `de-DE`. Licensed OpenMDW-1.1, which permits commercial use.
//!
//! The webview owns the microphone rather than Rust: `getUserMedia` gives us
//! echo cancellation for free, and without it the agent hears itself through
//! the speakers and interrupts itself the instant it starts talking.

use std::sync::Mutex;

use anyhow::{Context, Result};
use parakeet_rs::{Nemotron, NemotronMode};
use serde::Serialize;
use tauri::State;
use crate::assets::{cache_dir, ensure_file};

mod vad;
use vad::{Vad, WINDOW as VAD_WINDOW};

const MODEL_BASE: &str =
	"https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-3.5-asr-streaming-0.6b-onnx";

/// `encoder.onnx.data` is ~2.45 GB of fp32 tensors; there is no int8 export
/// published. Everything else is small.
const MODEL_FILES: &[&str] = &[
	"config.json",
	"encoder.onnx",
	"encoder.onnx.data",
	"decoder_joint.onnx",
	"tokenizer.model",
];

const LANG: &str = "de-DE";

/// Nemotron's cache-aware step, 560 ms at 16 kHz.
const ASR_CHUNK: usize = 8960;

/// Above this probability a window counts as speech.
const SPEECH_THRESHOLD: f32 = 0.5;
/// ~64 ms of speech opens an utterance. Short, because this is what gates
/// barge-in and a slow open makes interrupting feel unresponsive.
const START_WINDOWS: usize = 2;
/// ~800 ms of quiet closes it. Long enough to survive the pause mid-sentence
/// that every speaker makes, short enough not to feel like a wait.
const END_WINDOWS: usize = 25;

#[derive(Default)]
pub struct AsrState {
	engine: Mutex<Option<Engine>>,
}

struct Engine {
	model: Nemotron,
	vad: Vad,
	/// Samples not yet forming a whole VAD window.
	vad_buf: Vec<f32>,
	/// Speech samples not yet forming a whole ASR chunk.
	asr_buf: Vec<f32>,
	speaking: bool,
	run_speech: usize,
	run_silence: usize,
}

/// What one push of microphone audio produced.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AsrEvent {
	/// Someone is talking right now.
	pub speech: bool,
	/// Speech began during this push — the barge-in signal.
	pub started: bool,
	/// Speech ended during this push; `transcript` is then the finished utterance.
	pub ended: bool,
	/// Text recognized during this push.
	pub delta: String,
	/// Everything recognized in the current utterance.
	pub transcript: String,
}

fn load_engine(app: &tauri::AppHandle) -> Result<Engine> {
	let dir = cache_dir(app, "asr", "nemotron-3.5-streaming")?;
	for name in MODEL_FILES {
		ensure_file(&format!("{MODEL_BASE}/{name}"), &dir.join(name))?;
	}

	let mut model =
		Nemotron::from_pretrained(&dir, None).context("failed to open the Nemotron ONNX sessions")?;

	match model.mode() {
		NemotronMode::Multilingual => model
			.set_target_lang(LANG)
			.with_context(|| format!("{LANG} not accepted by this model"))?,
		NemotronMode::EnglishOnly => {
			anyhow::bail!("the English-only Nemotron was downloaded; German needs the 3.5 multilingual build")
		}
	}

	let vad_path = cache_dir(app, "asr", "silero-vad")?.join("silero_vad.onnx");
	ensure_file(vad::MODEL_URL, &vad_path)?;
	let vad = Vad::open(&vad_path)?;

	Ok(Engine {
		model,
		vad,
		vad_buf: Vec::with_capacity(VAD_WINDOW * 4),
		asr_buf: Vec::with_capacity(ASR_CHUNK * 2),
		speaking: false,
		run_speech: 0,
		run_silence: 0,
	})
}

impl Engine {
	/// Run whatever whole ASR chunks have accumulated, returning their text.
	fn drain_asr(&mut self) -> Result<String> {
		let mut delta = String::new();
		while self.asr_buf.len() >= ASR_CHUNK {
			let chunk: Vec<f32> = self.asr_buf.drain(..ASR_CHUNK).collect();
			delta.push_str(&self.model.transcribe_chunk(&chunk)?);
		}
		Ok(delta)
	}

	/// Close the utterance: pad the tail to a whole chunk, push silence so the
	/// model emits what it is still holding, then hand back the full transcript.
	fn finish(&mut self) -> Result<String> {
		let mut delta = String::new();
		if !self.asr_buf.is_empty() {
			let mut tail: Vec<f32> = std::mem::take(&mut self.asr_buf);
			tail.resize(ASR_CHUNK, 0.0);
			delta.push_str(&self.model.transcribe_chunk(&tail)?);
		}
		for _ in 0..3 {
			delta.push_str(&self.model.transcribe_chunk(&vec![0.0; ASR_CHUNK])?);
		}
		let _ = delta;
		Ok(self.model.get_transcript())
	}
}

/// Download and load the models. ~2.6 GB on first ever run.
#[tauri::command]
pub async fn asr_prepare(app: tauri::AppHandle, state: State<'_, AsrState>) -> Result<(), String> {
	let mut guard = state.engine.lock().map_err(|e| e.to_string())?;
	if guard.is_some() {
		return Ok(());
	}
	*guard = Some(load_engine(&app).map_err(|e| format!("{e:#}"))?);
	Ok(())
}

/// Feed one batch of 16 kHz mono microphone audio.
///
/// The webview sends these continuously while the mic is open; each returns
/// what changed, so the UI can react to speech starting (interrupt the agent)
/// and ending (send the utterance) without polling anything.
#[tauri::command]
pub async fn asr_push(
	state: State<'_, AsrState>,
	pcm: Vec<f32>,
) -> Result<AsrEvent, String> {
	let mut guard = state.engine.lock().map_err(|e| e.to_string())?;
	let Some(engine) = guard.as_mut() else {
		return Err("asr_prepare has not run".into());
	};

	let mut event = AsrEvent::default();
	engine.vad_buf.extend_from_slice(&pcm);

	while engine.vad_buf.len() >= VAD_WINDOW {
		let window: Vec<f32> = engine.vad_buf.drain(..VAD_WINDOW).collect();
		let speech = engine.vad.predict(&window).map_err(|e| format!("{e:#}"))? >= SPEECH_THRESHOLD;

		if speech {
			engine.run_speech += 1;
			engine.run_silence = 0;
		} else {
			engine.run_silence += 1;
			engine.run_speech = 0;
		}

		if !engine.speaking && engine.run_speech >= START_WINDOWS {
			engine.speaking = true;
			event.started = true;
			engine.model.reset();
		}

		// Keep feeding the recognizer through short pauses; only a closed
		// utterance stops the audio going in.
		if engine.speaking {
			engine.asr_buf.extend_from_slice(&window);
		}

		if engine.speaking && engine.run_silence >= END_WINDOWS {
			engine.speaking = false;
			event.ended = true;
			event.transcript = engine.finish().map_err(|e| format!("{e:#}"))?;
			engine.asr_buf.clear();
			break;
		}
	}

	if engine.speaking {
		event.delta = engine.drain_asr().map_err(|e| format!("{e:#}"))?;
		event.transcript = engine.model.get_transcript();
	}
	event.speech = engine.speaking;

	Ok(event)
}

/// Drop any half-heard utterance — used when the conversation is cleared.
#[tauri::command]
pub async fn asr_reset(state: State<'_, AsrState>) -> Result<(), String> {
	let mut guard = state.engine.lock().map_err(|e| e.to_string())?;
	if let Some(engine) = guard.as_mut() {
		engine.model.reset();
		engine.vad.reset();
		engine.vad_buf.clear();
		engine.asr_buf.clear();
		engine.speaking = false;
		engine.run_speech = 0;
		engine.run_silence = 0;
	}
	Ok(())
}

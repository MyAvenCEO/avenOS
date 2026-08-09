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

use std::path::Path;
use std::sync::Mutex;

use anyhow::{Context, Result};
use parakeet_rs::{Nemotron, NemotronMode};
use serde::Serialize;
use tauri::State;
use crate::assets::{cache_dir, ensure_file, ensure_files};

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
/// ~1.3 s of quiet closes it.
///
/// Was 800 ms, which fired in the pause people leave before the last clause of
/// a sentence — utterances were cut at "…ist es richtig" and the rest was lost.
/// The cost of being generous here is only that the reply starts a little
/// later; the cost of being eager is losing half the question.
const END_WINDOWS: usize = 40;

/// Audio kept from *before* speech was detected, in samples (512 ms).
///
/// Detection is necessarily late: the windows that prove someone is talking
/// have already gone by, and Silero needs a moment of signal before its
/// probability climbs at all. Without this the utterance began ~100-200 ms in,
/// which is exactly where the first word's opening consonant lives — so the
/// first word arrived clipped or missing, every other sentence.
const PREROLL: usize = 8192;

/// While the assistant is talking, speech has to be much more convincing.
///
/// `echoCancellation` is requested but does not hold in this webview, so the
/// microphone hears the assistant through the speakers. At the normal gate that
/// registered as the user talking and barge-in killed the reply the instant it
/// began — the empty bubbles. Echo is intermittent and rarely scores this high
/// for this long, whereas someone actually interrupting does.
const ECHO_THRESHOLD: f32 = 0.92;
const ECHO_START_WINDOWS: usize = 8;

/// What a normalized utterance should peak at. Short of 1.0 on purpose, so a
/// sample louder than anything heard so far has somewhere to go instead of
/// being clipped flat.
const TARGET_PEAK: f32 = 0.7;

/// Hard cap on the boost. A microphone peaking at 0.05 would otherwise be
/// amplified 20x and clipped against 1.0 on every loud syllable — distortion
/// the recognizer reads as garbled consonants. Quiet-but-clean beats loud-and-
/// square-waved.
const MAX_GAIN: f32 = 8.0;

#[derive(Default)]
pub struct AsrState {
	engine: Mutex<Option<Engine>>,
	/// True while the assistant's own voice is coming out of the speakers.
	speaking: std::sync::atomic::AtomicBool,
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
	/// Loudest sample in the current utterance, for the normalization gain.
	peak: f32,
	/// The most recent [`PREROLL`] samples, kept whether or not anyone is
	/// talking, so an utterance can start slightly before it was noticed.
	preroll: Vec<f32>,
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
	/// Highest speech probability Silero gave any window in this batch.
	///
	/// Surfaced purely so the threshold can be judged against what the model
	/// actually sees on this microphone, rather than tuned by guesswork.
	pub probability: f32,
}

fn load_engine(app: &tauri::AppHandle) -> Result<Engine> {
	let dir = cache_dir(app, "asr", "nemotron-3.5-streaming")?;
	let wanted: Vec<(String, std::path::PathBuf)> = MODEL_FILES
		.iter()
		.map(|name| (format!("{MODEL_BASE}/{name}"), dir.join(name)))
		.collect();
	ensure_files(app, "asr", &wanted)?;

	let vad_path = cache_dir(app, "asr", "silero-vad")?.join("silero_vad.onnx");
	ensure_file(app, "asr", vad::MODEL_URL, &vad_path)?;

	Engine::open(&dir, &vad_path)
}

impl Engine {
	/// Open both models from paths that already exist.
	///
	/// Separate from [`load_engine`] so it can be driven from a test without an
	/// `AppHandle` — which is how the recognizer gets exercised against a known
	/// recording rather than only through a live microphone.
	pub fn open(model_dir: &Path, vad_path: &Path) -> Result<Self> {
		let mut model = Nemotron::from_pretrained(model_dir, None)
			.context("failed to open the Nemotron ONNX sessions")?;

		match model.mode() {
			NemotronMode::Multilingual => model
				.set_target_lang(LANG)
				.with_context(|| format!("{LANG} not accepted by this model"))?,
			NemotronMode::EnglishOnly => anyhow::bail!(
				"the English-only Nemotron was downloaded; German needs the 3.5 multilingual build"
			),
		}

		Ok(Engine {
			model,
			vad: Vad::open(vad_path)?,
			vad_buf: Vec::with_capacity(VAD_WINDOW * 4),
			asr_buf: Vec::with_capacity(ASR_CHUNK * 2),
			speaking: false,
			run_speech: 0,
			run_silence: 0,
			peak: 0.0,
			preroll: Vec::with_capacity(PREROLL * 2),
		})
	}

	/// Scale a chunk toward full range before handing it to the recognizer.
	///
	/// Upstream's example normalizes the whole recording before streaming it and
	/// the model expects that, but a live utterance cannot be seen whole, so the
	/// gain follows the loudest sample heard so far.
	///
	/// Both bounds matter. Aiming at 1.0 meant every sample at the running peak
	/// landed exactly on the clamp, so any later syllable louder than the last
	/// one was squared off — and a 20x boost on a quiet microphone turned room
	/// noise into something with the shape of speech.
	fn normalized(&self, chunk: &[f32]) -> Vec<f32> {
		let gain = (TARGET_PEAK / self.peak.max(1e-4)).min(MAX_GAIN);
		chunk.iter().map(|s| (s * gain).clamp(-1.0, 1.0)).collect()
	}

	/// Run whatever whole ASR chunks have accumulated, returning their text.
	fn drain_asr(&mut self) -> Result<String> {
		let mut delta = String::new();
		while self.asr_buf.len() >= ASR_CHUNK {
			let chunk: Vec<f32> = self.asr_buf.drain(..ASR_CHUNK).collect();
			delta.push_str(&self.model.transcribe_chunk(&self.normalized(&chunk))?);
		}
		Ok(delta)
	}

	/// Close the utterance: pad the tail to a whole chunk, push silence so the
	/// model emits what it is still holding, then hand back the full transcript.
	fn finish(&mut self) -> Result<String> {
		if !self.asr_buf.is_empty() {
			let mut tail: Vec<f32> = std::mem::take(&mut self.asr_buf);
			tail.resize(ASR_CHUNK, 0.0);
			let tail = self.normalized(&tail);
			self.model.transcribe_chunk(&tail)?;
		}
		// Silence flushes whatever the decoder is still holding on to.
		for _ in 0..3 {
			self.model.transcribe_chunk(&vec![0.0; ASR_CHUNK])?;
		}
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
/// Audio arrives as a raw little-endian f32 body rather than as JSON.
///
/// A 2048-sample batch is 8 KB of bytes but roughly 40 KB as a JSON array of
/// numbers, eight times a second, each needing a parse on both sides. That was
/// enough to make Tauri's custom IPC protocol fall back to `postMessage`, which
/// adds latency to the one path that has to stay quick — the batches that carry
/// the start of speech, and therefore barge-in.
#[tauri::command]
pub async fn asr_push(
	state: State<'_, AsrState>,
	request: tauri::ipc::Request<'_>,
) -> Result<AsrEvent, String> {
	let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
		return Err("asr_push expects a raw f32 body".into());
	};
	let pcm: Vec<f32> = bytes
		.chunks_exact(4)
		.map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
		.collect();

	let mut guard = state.engine.lock().map_err(|e| e.to_string())?;
	let Some(engine) = guard.as_mut() else {
		return Err("asr_prepare has not run".into());
	};
	let echo_risk = state.speaking.load(std::sync::atomic::Ordering::Relaxed);
	push_into(engine, &pcm, echo_risk).map_err(|e| format!("{e:#}"))
}

/// Tell the recognizer whether the assistant is currently audible.
#[tauri::command]
pub fn asr_output_active(state: State<'_, AsrState>, active: bool) {
	state
		.speaking
		.store(active, std::sync::atomic::Ordering::Relaxed);
}

/// The whole VAD + recognition step for one batch of audio.
///
/// Split out of the command so the test can drive it with a recording — the
/// only way to tell a broken recognizer apart from audio that never arrived.
fn push_into(engine: &mut Engine, pcm: &[f32], echo_risk: bool) -> Result<AsrEvent> {
	let (threshold, to_open) = if echo_risk {
		(ECHO_THRESHOLD, ECHO_START_WINDOWS)
	} else {
		(SPEECH_THRESHOLD, START_WINDOWS)
	};
	let mut event = AsrEvent::default();
	engine.vad_buf.extend_from_slice(pcm);

	while engine.vad_buf.len() >= VAD_WINDOW {
		let window: Vec<f32> = engine.vad_buf.drain(..VAD_WINDOW).collect();
		let probability = engine.vad.predict(&window)?;
		event.probability = event.probability.max(probability);
		let speech = probability >= threshold;

		if speech {
			engine.run_speech += 1;
			engine.run_silence = 0;
		} else {
			engine.run_silence += 1;
			engine.run_speech = 0;
		}

		if !engine.speaking && engine.run_speech >= to_open {
			engine.speaking = true;
			event.started = true;
			engine.model.reset();
			engine.peak = 0.0;
			// Rewind: the utterance starts where the sound did, not where it was
			// noticed. Without this the first word loses its opening consonant.
			for sample in &engine.preroll {
				engine.peak = engine.peak.max(sample.abs());
			}
			engine.asr_buf.extend_from_slice(&engine.preroll);
			log::debug!(
				target: "avenos::asr",
				"speech started ({} ms of pre-roll)", engine.preroll.len() * 1000 / 16_000
			);
		}

		// Keep feeding the recognizer through short pauses; only a closed
		// utterance stops the audio going in.
		if engine.speaking {
			for sample in &window {
				engine.peak = engine.peak.max(sample.abs());
			}
			engine.asr_buf.extend_from_slice(&window);
		}

		// Kept for every window, talking or not — this is what the next utterance
		// will rewind into. Appended after the checks above so it never contains
		// the window currently being handled.
		engine.preroll.extend_from_slice(&window);
		if engine.preroll.len() > PREROLL {
			engine.preroll.drain(..engine.preroll.len() - PREROLL);
		}

		if engine.speaking && engine.run_silence >= END_WINDOWS {
			engine.speaking = false;
			event.ended = true;
			event.transcript = engine.finish()?;
			engine.asr_buf.clear();
			log::info!(
				target: "avenos::asr",
				"utterance (peak {:.3}): {:?}", engine.peak, event.transcript
			);
			break;
		}
	}

	if engine.speaking {
		event.delta = engine.drain_asr()?;
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
		engine.peak = 0.0;
		engine.preroll.clear();
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	/// What does the VAD actually say about known speech?
	#[test]
	#[ignore = "needs the downloaded models and a WAV"]
	fn vad_detects_speech() {
		let home = std::env::var("HOME").unwrap();
		let vad_path = format!("{home}/Library/Caches/ceo.aven.os/asr/silero-vad/silero_vad.onnx");
		let mut vad = Vad::open(Path::new(&vad_path)).expect("vad should open");

		let path = std::env::var("ASR_TEST_WAV").expect("set ASR_TEST_WAV");
		let mut reader = hound::WavReader::open(&path).expect("wav should open");
		let spec = reader.spec();
		let source: Vec<f32> = reader
			.samples::<i16>()
			.map(|s| s.unwrap() as f32 / 32768.0)
			.collect();
		let ratio = spec.sample_rate as f32 / 16_000.0;
		let out_len = (source.len() as f32 / ratio) as usize;
		let audio: Vec<f32> = (0..out_len)
			.map(|i| source[((i as f32 * ratio) as usize).min(source.len() - 1)])
			.collect();

		let mut probs = Vec::new();
		for window in audio.chunks(VAD_WINDOW) {
			if window.len() < VAD_WINDOW {
				break;
			}
			probs.push(vad.predict(window).expect("predict should work"));
		}
		let max = probs.iter().cloned().fold(0.0f32, f32::max);
		let over = probs.iter().filter(|p| **p >= 0.5).count();
		println!(
			"{} windows, max prob {max:.4}, {over} over 0.5, first 12: {:?}",
			probs.len(),
			&probs[..12.min(probs.len())]
		);
		assert!(max >= 0.5, "VAD never saw speech in a file that is entirely speech");
	}

	/// Drive the recognizer with a recording instead of a live microphone.
	///
	/// Ignored by default because it needs the ~2.6 GB of weights on disk. Run it
	/// when the mic produces nothing, to tell "the recognizer is broken" apart
	/// from "the audio never reached it":
	///
	/// ```sh
	/// ASR_TEST_WAV=/path/to/german.wav cargo test --manifest-path app/src-tauri/Cargo.toml \
	///   transcribes_a_recording -- --ignored --nocapture
	/// ```
	#[test]
	#[ignore = "needs the downloaded models and a WAV"]
	fn transcribes_a_recording() {
		let home = std::env::var("HOME").unwrap();
		let cache = format!("{home}/Library/Caches/ceo.aven.os/asr");
		let mut engine = Engine::open(
			Path::new(&cache).join("nemotron-3.5-streaming").as_path(),
			Path::new(&cache).join("silero-vad/silero_vad.onnx").as_path(),
		)
		.expect("models should open");

		let path = std::env::var("ASR_TEST_WAV").expect("set ASR_TEST_WAV");
		let mut reader = hound::WavReader::open(&path).expect("wav should open");
		let spec = reader.spec();
		let source: Vec<f32> = match spec.sample_format {
			hound::SampleFormat::Float => reader.samples::<f32>().map(|s| s.unwrap()).collect(),
			hound::SampleFormat::Int => reader
				.samples::<i16>()
				.map(|s| s.unwrap() as f32 / 32768.0)
				.collect(),
		};
		let mono: Vec<f32> = source
			.chunks(spec.channels as usize)
			.map(|c| c.iter().sum::<f32>() / c.len() as f32)
			.collect();

		// Linear resample to 16 kHz — crude, but this is a smoke test, and the
		// browser does the real conversion in production.
		let ratio = spec.sample_rate as f32 / 16_000.0;
		let out_len = (mono.len() as f32 / ratio) as usize;
		let audio: Vec<f32> = (0..out_len)
			.map(|i| mono[((i as f32 * ratio) as usize).min(mono.len() - 1)])
			.collect();

		println!(
			"{:.2}s of audio at 16 kHz, peak {:.3}",
			audio.len() as f32 / 16_000.0,
			audio.iter().fold(0.0f32, |a, &b| a.max(b.abs()))
		);

		// Same 2048-sample batches the AudioWorklet sends.
		let started = std::time::Instant::now();
		let mut transcript = String::new();
		for batch in audio.chunks(2048) {
			let event = push_into(&mut engine, batch, false).expect("push should succeed");
			if event.started {
				println!("  [vad] speech started");
			}
			if event.ended {
				println!("  [vad] speech ended -> {:?}", event.transcript);
				transcript = event.transcript;
			}
		}
		// Trailing silence, so the closing threshold is actually reached.
		for _ in 0..40 {
			let event = push_into(&mut engine, &[0.0; 2048], false).expect("push should succeed");
			if event.ended {
				println!("  [vad] speech ended -> {:?}", event.transcript);
				transcript = event.transcript;
			}
		}

		println!(
			"transcript: {transcript:?}  (in {:.2}s)",
			started.elapsed().as_secs_f32()
		);
		assert!(!transcript.trim().is_empty(), "recognized nothing at all");
	}
}

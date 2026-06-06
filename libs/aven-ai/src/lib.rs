//! AvenOS on-device AI core — Tauri-free primitives shared by the app.
//!
//! - [`stt`] (feature `stt`): speech-to-text via sherpa-onnx (Parakeet-TDT-0.6b-v3),
//!   plus the model download/extract/list/delete mechanics. No Tauri, no app
//!   state — the caller owns orchestration (status, cancel flag, event emission)
//!   and passes in a models-root path, a cancel predicate, and a progress sink.
//! - [`llm`] (feature `llm`): on-device text generation via onnxruntime (`ort`)
//!   for LFM2.5-8B-A1B ONNX — model download + a streaming greedy generate loop.
//! - [`tts`] (feature `tts`): on-device text-to-speech via onnxruntime (`ort`) for
//!   MOSS-TTS-Nano — model download + a streaming synth loop emitting 48 kHz PCM.
//! - [`onnx`] (features `llm`/`tts`): shared onnxruntime primitives (dylib init,
//!   resilient multi-file download, KV-cache wiring) used by both ONNX engines.
//! - `gemma` (feature `gemma`, future): on-device LLM via mistralrs.
//!
//! The app (`app/src-tauri/src/{asr,llm,tts}.rs`) provides thin Tauri adapters
//! over this crate.

#[cfg(feature = "stt")]
pub mod stt;

#[cfg(any(feature = "llm", feature = "tts"))]
pub mod onnx;

#[cfg(feature = "llm")]
pub mod llm;

#[cfg(feature = "tts")]
pub mod tts;

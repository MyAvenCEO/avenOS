//! AvenOS on-device AI core — Tauri-free primitives shared by the app.
//!
//! - [`stt`] (feature `stt`): speech-to-text via sherpa-onnx (Parakeet-TDT-0.6b-v3),
//!   plus the model download/extract/list/delete mechanics. No Tauri, no app
//!   state — the caller owns orchestration (status, cancel flag, event emission)
//!   and passes in a models-root path, a cancel predicate, and a progress sink.
//! - [`llm`] (feature `llm`): on-device text generation via onnxruntime (`ort`)
//!   for LFM2.5-8B-A1B ONNX — model download + a streaming greedy generate loop.
//! - [`llama`] (feature `llama`): on-device text generation via **llama.cpp** (GGUF) with
//!   Metal on Apple — statically linked (no dylib). The replacement for the ONNX `llm` path.
//! - [`tts`] (feature `tts`): on-device text-to-speech via onnxruntime (`ort`) for
//!   MOSS-TTS-Nano — model download + a streaming synth loop emitting 48 kHz PCM.
//! - [`onnx`] (feature `tts`): ort KV-cache/init helpers shared by the ONNX synth loop.
//!
//! The app (`app/src-tauri/src/{asr,llm,tts}.rs`) provides thin Tauri adapters
//! over this crate.

#[cfg(feature = "stt")]
pub mod stt;

/// Shared resumable model downloader (the ONNX `llm`, llama.cpp, and `tts` paths reuse it
/// for one identical download/progress UX, the same shape as the STT path).
#[cfg(any(feature = "llm", feature = "llama", feature = "tts"))]
pub mod download;

/// ort-specific helpers (dylib init, KV-cache wiring) for the ONNX `tts` synth loop.
#[cfg(feature = "tts")]
pub mod onnx;

#[cfg(feature = "llm")]
pub mod llm;

#[cfg(feature = "llama")]
pub mod llama;

/// On-device text embeddings (EmbeddingGemma-300m ONNX) via onnxruntime (`ort`).
#[cfg(feature = "embed")]
pub mod embed;

#[cfg(feature = "tts")]
pub mod tts;

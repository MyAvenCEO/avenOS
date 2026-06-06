//! AvenOS on-device AI core — Tauri-free primitives shared by the app.
//!
//! - [`stt`] (feature `stt`): speech-to-text via sherpa-onnx (Parakeet-TDT-0.6b-v3),
//!   plus the model download/extract/list/delete mechanics. No Tauri, no app
//!   state — the caller owns orchestration (status, cancel flag, event emission)
//!   and passes in a models-root path, a cancel predicate, and a progress sink.
//! - [`llm`] (feature `llm`): on-device text generation via onnxruntime (`ort`)
//!   for LFM2.5-8B-A1B ONNX — model download + a streaming greedy generate loop.
//! - `gemma` (feature `gemma`, future): on-device LLM via mistralrs.
//!
//! The app (`app/src-tauri/src/asr.rs`, `app/src-tauri/src/llm.rs`) provides thin
//! Tauri adapters over this crate.

#[cfg(feature = "stt")]
pub mod stt;

#[cfg(feature = "llm")]
pub mod llm;

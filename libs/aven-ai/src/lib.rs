//! AvenOS on-device AI core — Tauri-free primitives shared by the app.
//!
//! - [`stt`] (feature `stt`): speech-to-text via sherpa-onnx (Parakeet-TDT-0.6b-v3),
//!   plus the model download/extract/list/delete mechanics. No Tauri, no app
//!   state — the caller owns orchestration (status, cancel flag, event emission)
//!   and passes in a models-root path, a cancel predicate, and a progress sink.
//! - `gemma` (feature `gemma`, future): on-device LLM via mistralrs.
//!
//! The app (`app/src-tauri/src/asr.rs`) is a thin Tauri adapter over this crate.

#[cfg(feature = "stt")]
pub mod stt;

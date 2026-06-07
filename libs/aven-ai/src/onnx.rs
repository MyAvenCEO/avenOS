//! ort-specific onnxruntime helpers for the ONNX text-to-speech path ([`crate::tts`]).
//!
//! The MOSS-TTS-Nano synth loop loads `load-dynamic` onnxruntime and threads KV
//! caches between autoregressive steps. Those ort mechanics live here so `tts.rs`
//! stays focused on the generation logic. Model *downloading* is NOT here — that's
//! the shared, engine-agnostic [`crate::download`] module (also used by the `llm`
//! and `llama` paths). The legacy ONNX `llm` module keeps its own equivalents
//! inline (it predates this split and is off by default).
//!
//! - [`init_runtime`] — load + commit the bundled onnxruntime dylib (once).
//! - [`CacheData`] — owned KV-cache data that round-trips between decode steps
//!   (handles the empty step-0 allocation + f16/f32 element types).

use std::path::Path;
use std::sync::OnceLock;

use half::f16;
use ort::memory::Allocator;
use ort::value::{DynTensor, Tensor, TensorElementType};

/// Initialize the onnxruntime backend from a specific dylib path. Must be called
/// once, before the first session load. Idempotent.
///
/// `dylib_path` is the onnxruntime shared library bundled in the app (e.g.
/// `…/Frameworks/onnxruntime.framework/onnxruntime` on Apple). Passing it here
/// (rather than relying on `ORT_DYLIB_PATH`) keeps path resolution in Rust where
/// the app knows its bundle layout.
pub fn init_runtime(dylib_path: &Path) -> Result<(), String> {
	static INIT: OnceLock<Result<(), String>> = OnceLock::new();
	INIT.get_or_init(|| {
		ort::init_from(dylib_path)
			.map_err(|e| format!("onnxruntime load {}: {e}", dylib_path.display()))?
			.with_name("avenos-tts")
			.commit();
		Ok(())
	})
	.clone()
}

/// Owned cache data in whichever element type the graph uses (f16 for q4f16, with
/// an f32 fallback for fp32 exports).
pub enum CacheData {
	F16(Vec<f16>),
	F32(Vec<f32>),
}

impl CacheData {
	pub fn empty(ty: TensorElementType) -> Self {
		match ty {
			TensorElementType::Float32 => CacheData::F32(Vec::new()),
			_ => CacheData::F16(Vec::new()),
		}
	}

	pub fn to_value(
		&self,
		shape: &[i64],
	) -> Result<ort::session::SessionInputValue<'static>, String> {
		// An EMPTY (step-0) cache is initialized by ALLOCATING a zero tensor of the
		// exact shape via DynTensor::new (ORT's CreateTensorAsOrtValue, which
		// zero-fills). Unlike from_array ("from raw data"), it ALLOWS 0-length dims.
		let (is_empty, ty) = match self {
			CacheData::F16(v) => (v.is_empty(), TensorElementType::Float16),
			CacheData::F32(v) => (v.is_empty(), TensorElementType::Float32),
		};
		if is_empty {
			return DynTensor::new(&Allocator::default(), ty, shape.to_vec())
				.map(Into::into)
				.map_err(|e| format!("cache {ty:?} alloc: {e}"));
		}
		match self {
			CacheData::F16(v) => Tensor::from_array((shape.to_vec(), v.clone()))
				.map(Into::into)
				.map_err(|e| format!("cache f16: {e}")),
			CacheData::F32(v) => Tensor::from_array((shape.to_vec(), v.clone()))
				.map(Into::into)
				.map_err(|e| format!("cache f32: {e}")),
		}
	}

	pub fn extract(
		outputs: &ort::session::SessionOutputs,
		name: &str,
	) -> Result<(Vec<i64>, CacheData), String> {
		let value = &outputs[name];
		if let Ok((shape, data)) = value.try_extract_tensor::<f16>() {
			return Ok((shape.iter().copied().collect(), CacheData::F16(data.to_vec())));
		}
		let (shape, data) = value
			.try_extract_tensor::<f32>()
			.map_err(|e| format!("extract {name}: {e}"))?;
		Ok((shape.iter().copied().collect(), CacheData::F32(data.to_vec())))
	}
}

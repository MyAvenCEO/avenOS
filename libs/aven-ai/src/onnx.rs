//! Shared onnxruntime (`ort`) primitives for the on-device model paths
//! ([`crate::llm`], [`crate::tts`]).
//!
//! Both the LLM and TTS engines load `load-dynamic` onnxruntime, download a set
//! of files (the `.onnx` graphs + their external-weight sidecars + tokenizer/
//! config JSON) from a HF repo into a flat model dir, and thread KV caches
//! between autoregressive steps. Those mechanics live here so neither engine
//! duplicates them:
//!
//! - [`init_runtime`] — load + commit the bundled onnxruntime dylib (once).
//! - [`download_files`] / [`files_present`] — resilient multi-file HF download.
//! - [`CacheSpec`] / [`CacheData`] / [`pair_caches`] — the `past_* ↔ present*`
//!   KV-cache wiring discovered from a session's I/O metadata.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::OnceLock;

use half::f16;
use ort::memory::Allocator;
use ort::session::Session;
use ort::value::{DynTensor, Tensor, TensorElementType, ValueType};

/// Outcome of a model download.
#[derive(Debug)]
pub enum DownloadError {
	/// The `cancelled` predicate returned true mid-download.
	Cancelled,
	/// A network / IO failure.
	Failed(String),
}

impl std::fmt::Display for DownloadError {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			DownloadError::Cancelled => write!(f, "download cancelled"),
			DownloadError::Failed(e) => write!(f, "{e}"),
		}
	}
}

impl std::error::Error for DownloadError {}

const EMIT_STEP: u64 = 8 * 1024 * 1024;

/// True when every `(remote, local)` file in `files` is present under `<root>/<dir>/`.
pub fn files_present(root: &Path, dir: &str, files: &[(&str, &str)]) -> bool {
	let d = root.join(dir);
	files.iter().all(|(_, name)| d.join(name).is_file())
}

/// Download each `(remote_subpath, local_filename)` in `files` into `<root>/<dir>/`,
/// resolving each remote against `base_url`. Blocking — run on a dedicated thread.
/// `cancelled()` is polled every chunk; `on_progress(received, total)` reports
/// cumulative bytes across all files.
///
/// **Resilient**: each file streams to `<local>.part` and is renamed only when
/// complete, so finished files are never re-fetched. A partial `.part` resumes via
/// an HTTP `Range` request; if the server ignores the range (`200`) that one file
/// restarts cleanly, and a `416` means the `.part` is already complete (finalize
/// it). Cancelling keeps the `.part` so the next attempt continues — a multi-GB
/// pull survives app restarts.
pub fn download_files(
	root: &Path,
	dir: &str,
	base_url: &str,
	files: &[(&str, &str)],
	cancelled: impl Fn() -> bool,
	mut on_progress: impl FnMut(u64, u64),
) -> Result<(), DownloadError> {
	let fail = |e: String| DownloadError::Failed(e);
	let dir_path = root.join(dir);
	fs::create_dir_all(&dir_path).map_err(|e| fail(format!("create model dir: {e}")))?;

	// Pass 1 — compute the FULL grand total (and bytes already on disk) up front so
	// the progress bar has a stable denominator.
	let mut received: u64 = 0;
	let mut total: u64 = 0;
	for &(remote, local) in files.iter() {
		if let Ok(meta) = dir_path.join(local).metadata() {
			received += meta.len();
			total += meta.len();
			continue;
		}
		let have = dir_path
			.join(format!("{local}.part"))
			.metadata()
			.map(|m| m.len())
			.unwrap_or(0);
		received += have;
		total += head_content_length(&format!("{base_url}{remote}")).max(have);
	}
	on_progress(received, total);

	// Pass 2 — fetch each missing file, resuming a partial `.part` where possible.
	for &(remote, local) in files.iter() {
		let dest = dir_path.join(local);
		if dest.is_file() {
			continue; // already on disk + counted in pass 1
		}
		if cancelled() {
			return Err(DownloadError::Cancelled);
		}

		let tmp = dir_path.join(format!("{local}.part"));
		let resume_from = tmp.metadata().map(|m| m.len()).unwrap_or(0);

		let url = format!("{base_url}{remote}");
		let mut req = ureq::get(&url);
		if resume_from > 0 {
			req = req.set("Range", &format!("bytes={resume_from}-"));
		}
		let resp = match req.call() {
			Ok(r) => r,
			Err(ureq::Error::Status(416, _)) if resume_from > 0 => {
				fs::rename(&tmp, &dest).map_err(|e| fail(format!("finalize {local}: {e}")))?;
				continue;
			}
			Err(e) => return Err(fail(format!("download {local}: {e}"))),
		};

		let resuming = resp.status() == 206 && resume_from > 0;
		let mut file = if resuming {
			std::fs::OpenOptions::new()
				.append(true)
				.open(&tmp)
				.map_err(|e| fail(format!("open {}: {e}", tmp.display())))?
		} else {
			if resume_from > 0 {
				received = received.saturating_sub(resume_from);
				on_progress(received, total);
			}
			File::create(&tmp).map_err(|e| fail(format!("create {}: {e}", tmp.display())))?
		};

		let mut reader = resp.into_reader();
		let mut buf = vec![0u8; 1024 * 1024];
		let mut last_emit = received;
		loop {
			if cancelled() {
				file.flush().ok();
				return Err(DownloadError::Cancelled);
			}
			let n = reader.read(&mut buf).map_err(|e| fail(format!("read {local}: {e}")))?;
			if n == 0 {
				break;
			}
			file.write_all(&buf[..n]).map_err(|e| fail(format!("write {local}: {e}")))?;
			received += n as u64;
			if received - last_emit >= EMIT_STEP {
				last_emit = received;
				on_progress(received, total);
			}
		}
		file.flush().ok();
		drop(file);
		fs::rename(&tmp, &dest).map_err(|e| fail(format!("finalize {local}: {e}")))?;
		on_progress(received, total);
	}

	if !files_present(root, dir, files) {
		return Err(fail("model files missing after download".into()));
	}
	Ok(())
}

/// HEAD a URL and return its `Content-Length` (ureq follows the redirect to the
/// CDN, so this is the final file's size). `0` when unavailable.
fn head_content_length(url: &str) -> u64 {
	ureq::head(url)
		.call()
		.ok()
		.and_then(|r| r.header("Content-Length").and_then(|s| s.parse::<u64>().ok()))
		.unwrap_or(0)
}

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
			.with_name("avenos-ai")
			.commit();
		Ok(())
	})
	.clone()
}

/// How a single cache tensor is shaped and typed, captured from a session's input
/// metadata at load so we can synthesize an empty (past-length 0) tensor and know
/// which element type to round-trip.
#[derive(Clone, Debug)]
pub struct CacheSpec {
	/// The model input name (e.g. `past_key_values.2.key`, `past_conv.0`).
	pub input_name: String,
	/// The matching output name that produces its next-step value.
	pub output_name: String,
	/// Static dims with the dynamic sequence/cache-length axis pinned to 0 for the
	/// initial empty cache.
	pub empty_shape: Vec<i64>,
	/// Element type (almost always f16 for the q4f16 export, f32 for fp32 exports).
	pub ty: TensorElementType,
}

/// Pair every `past_*` session input with the `present*` output that feeds it next
/// step, and capture the static (cache-length-0) shape + element type. Heuristic
/// name matching (logged by the caller); the dominant optimum/transformers.js
/// convention is `past_key_values.{i}.{key,value}` ↔ `present.{i}.{key,value}`,
/// `past_conv.{i}` ↔ `present_conv.{i}`, and `past_key/value_{i}` ↔
/// `present_key/value_{i}` (the MOSS-TTS export).
pub fn pair_caches(session: &Session) -> Vec<CacheSpec> {
	let output_names: Vec<String> =
		session.outputs().iter().map(|o| o.name().to_string()).collect();

	let mut out = Vec::new();
	for input in session.inputs() {
		let name = input.name();
		if !name.starts_with("past") {
			continue;
		}
		let ValueType::Tensor { ty, shape, .. } = input.dtype() else {
			continue;
		};
		// Empty cache for step 0. A statically-known axis keeps its size. A dynamic
		// axis (-1) is either the BATCH axis (axis 0 → 1: we always run exactly one
		// sequence) or a length/cache axis (→ 0: empty at step 0).
		let empty_shape: Vec<i64> = shape
			.iter()
			.enumerate()
			.map(|(axis, &d)| {
				if d >= 0 {
					d
				} else if axis == 0 {
					1
				} else {
					0
				}
			})
			.collect();

		let candidate = name
			.replacen("past_key_values", "present", 1)
			.replacen("past_conv", "present_conv", 1)
			.replacen("past_key_", "present_key_", 1)
			.replacen("past_value_", "present_value_", 1)
			.replacen("past", "present", 1);
		let output_name = output_names
			.iter()
			.find(|o| **o == candidate)
			.or_else(|| {
				let suffix = name.splitn(2, '.').nth(1);
				suffix.and_then(|s| output_names.iter().find(|o| o.ends_with(s)))
			})
			.cloned()
			.unwrap_or_else(|| candidate.clone());

		out.push(CacheSpec {
			input_name: name.to_string(),
			output_name,
			empty_shape,
			ty: *ty,
		});
	}
	out
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
		// zero-fills). Unlike from_array ("from raw data"), it ALLOWS 0-length dims —
		// the empty attention KV-cache [1,h,0,d] — AND fixed-size conv/SSM state.
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

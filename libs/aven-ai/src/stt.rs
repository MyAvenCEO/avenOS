//! On-device speech-to-text via sherpa-onnx (offline NeMo transducer / Parakeet).
//!
//! Tauri-free: the caller passes a models-root directory, a `cancelled`
//! predicate, and a progress sink; this module owns the download/extract +
//! recognizer mechanics. `Transcriber` wraps a `Send + Sync` recognizer so the
//! caller can cache it in an `Arc` and run `transcribe` on a blocking thread.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OfflineTransducerModelConfig};

/// A downloadable offline transducer model (a sherpa-onnx release tarball that
/// extracts to `dir`, holding the encoder/decoder/joiner + token table).
#[derive(Clone, Copy, Debug)]
pub struct ModelSpec {
	/// Top-level directory the archive extracts to (under the models root).
	pub dir: &'static str,
	/// Download URL of the `.tar.bz2` release archive.
	pub url: &'static str,
	pub encoder: &'static str,
	pub decoder: &'static str,
	pub joiner: &'static str,
	pub tokens: &'static str,
}

impl ModelSpec {
	/// Absolute path to the extracted model directory under `root`.
	pub fn model_dir(&self, root: &Path) -> PathBuf {
		root.join(self.dir)
	}

	/// True when all required model files are present on disk.
	pub fn files_present(&self, root: &Path) -> bool {
		let d = self.model_dir(root);
		[self.encoder, self.decoder, self.joiner, self.tokens]
			.iter()
			.all(|f| d.join(f).is_file())
	}
}

/// Outcome of a model download.
#[derive(Debug)]
pub enum DownloadError {
	/// The `cancelled` predicate returned true mid-download.
	Cancelled,
	/// A network / IO / extraction failure.
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

/// ~4 MiB between progress reports, so a UI bar moves smoothly without flooding.
const EMIT_STEP: u64 = 4 * 1024 * 1024;

/// Download `spec`'s tarball into `root` and extract it. Blocking — run on a
/// dedicated thread. `cancelled()` is polled every chunk (return `true` to
/// abort); `on_progress(received, total)` is called at the start, at ~4 MiB
/// boundaries, and at the end (`total` is 0 when the server omits a length).
pub fn download_and_extract(
	spec: &ModelSpec,
	root: &Path,
	cancelled: impl Fn() -> bool,
	mut on_progress: impl FnMut(u64, u64),
) -> Result<(), DownloadError> {
	let fail = |e: String| DownloadError::Failed(e);
	fs::create_dir_all(root).map_err(|e| fail(format!("create models dir: {e}")))?;
	let tmp = root.join(format!("{}.part", spec.dir));

	let resp = ureq::get(spec.url)
		.call()
		.map_err(|e| fail(format!("download: {e}")))?;
	let total = resp
		.header("Content-Length")
		.and_then(|s| s.parse::<u64>().ok())
		.unwrap_or(0);
	on_progress(0, total);

	let mut reader = resp.into_reader();
	let mut file = File::create(&tmp).map_err(|e| fail(format!("create {}: {e}", tmp.display())))?;
	let mut buf = vec![0u8; 256 * 1024];
	let mut received: u64 = 0;
	loop {
		if cancelled() {
			drop(file);
			let _ = fs::remove_file(&tmp);
			return Err(DownloadError::Cancelled);
		}
		let n = reader.read(&mut buf).map_err(|e| fail(format!("read: {e}")))?;
		if n == 0 {
			break;
		}
		file.write_all(&buf[..n]).map_err(|e| fail(format!("write: {e}")))?;
		let prev = received;
		received += n as u64;
		if prev / EMIT_STEP != received / EMIT_STEP {
			on_progress(received, total);
		}
	}
	file.flush().ok();
	drop(file);
	on_progress(received, total);

	// Extract `*.tar.bz2` → root/<spec.dir>/...
	let f = File::open(&tmp).map_err(|e| fail(format!("open archive: {e}")))?;
	let bz = bzip2::read::BzDecoder::new(f);
	let mut ar = tar::Archive::new(bz);
	ar.unpack(root).map_err(|e| fail(format!("extract: {e}")))?;
	let _ = fs::remove_file(&tmp);

	if !spec.files_present(root) {
		return Err(fail(
			"model archive missing expected files after extraction".into(),
		));
	}
	Ok(())
}

/// A loaded offline recognizer. `Send + Sync` (the underlying sherpa-onnx
/// recognizer is), so wrap in an `Arc` and call `transcribe` from a blocking
/// thread.
pub struct Transcriber {
	rec: OfflineRecognizer,
}

impl Transcriber {
	/// Load the recognizer from the model files under `root`. Blocking (reads
	/// hundreds of MB of ONNX); run on a dedicated thread.
	pub fn load(spec: &ModelSpec, root: &Path) -> Result<Self, String> {
		let dir = spec.model_dir(root);
		let p = |f: &str| dir.join(f).to_string_lossy().into_owned();

		let mut config = OfflineRecognizerConfig::default();
		config.model_config.transducer = OfflineTransducerModelConfig {
			encoder: Some(p(spec.encoder)),
			decoder: Some(p(spec.decoder)),
			joiner: Some(p(spec.joiner)),
		};
		config.model_config.tokens = Some(p(spec.tokens));
		// Parakeet uses the TDT (token-and-duration) transducer decoding path.
		config.model_config.model_type = Some("nemo_transducer".into());
		config.model_config.num_threads = 2;

		let rec = OfflineRecognizer::create(&config)
			.ok_or_else(|| format!("failed to load recognizer from {}", dir.display()))?;
		Ok(Self { rec })
	}

	/// Transcribe mono `pcm` at `sample_rate` Hz into text. Blocking (runs the
	/// model); run on a dedicated thread.
	pub fn transcribe(&self, pcm: &[f32], sample_rate: u32) -> String {
		let stream = self.rec.create_stream();
		stream.accept_waveform(sample_rate as i32, pcm);
		self.rec.decode(&stream);
		stream
			.get_result()
			.map(|r| r.text)
			.unwrap_or_default()
	}

	/// Transcribe mono `pcm` into **word-level** timestamps. The transducer emits
	/// per-token start times (`timestamps`) + durations; this merges those tokens
	/// into words at the sentencepiece word-boundary marker (`▁`, U+2581). Returns
	/// `(text, words)`. Blocking — run on a dedicated thread.
	pub fn transcribe_words(&self, pcm: &[f32], sample_rate: u32) -> (String, Vec<Word>) {
		let stream = self.rec.create_stream();
		stream.accept_waveform(sample_rate as i32, pcm);
		self.rec.decode(&stream);
		let Some(res) = stream.get_result() else {
			return (String::new(), Vec::new());
		};
		let ts = res.timestamps.unwrap_or_default();
		let durs = res.durations.unwrap_or_default();

		let mut words: Vec<Word> = Vec::new();
		let mut cur = String::new();
		let mut cur_start = 0.0_f32;
		let mut cur_end = 0.0_f32;
		for (i, tok) in res.tokens.iter().enumerate() {
			let t = ts.get(i).copied().unwrap_or(cur_end);
			let d = durs.get(i).copied().unwrap_or(0.0).max(0.0);
			// sherpa decodes the sentencepiece boundary to either `▁` (U+2581) or a
			// leading space depending on the model — a token starting with either
			// begins a new word; punctuation tokens (".", ",") attach to the current.
			let starts_word = tok.starts_with('\u{2581}') || tok.starts_with(' ');
			let clean = tok.trim_start_matches(|c| c == '\u{2581}' || c == ' ');
			if starts_word && !cur.is_empty() {
				// close the previous word — its end is this word's onset
				words.push(Word { text: cur.clone(), start: cur_start, end: t });
				cur.clear();
			}
			if cur.is_empty() {
				cur_start = t;
			}
			cur.push_str(clean);
			cur_end = t + d;
		}
		if !cur.is_empty() {
			words.push(Word { text: cur, start: cur_start, end: cur_end });
		}
		(res.text, words)
	}
}

/// A recognized word with start/end times in seconds.
#[derive(Clone, Debug)]
pub struct Word {
	pub text: String,
	pub start: f32,
	pub end: f32,
}


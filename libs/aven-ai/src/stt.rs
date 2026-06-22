//! On-device speech-to-text via sherpa-onnx (offline NeMo transducer / Parakeet).
//!
//! Tauri-free: the caller passes a models-root directory, a `cancelled`
//! predicate, and a progress sink; this module owns the download/extract +
//! recognizer mechanics. `Transcriber` wraps a `Send + Sync` recognizer so the
//! caller can cache it in an `Arc` and run `transcribe` on a blocking thread.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use sherpa_onnx::{
	OfflineRecognizer, OfflineRecognizerConfig, OfflineTransducerModelConfig, SileroVadModelConfig,
	VadModelConfig, VoiceActivityDetector,
};

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

/// A downloadable single-file model (the Silero VAD ONNX — a bare `.onnx`, not a
/// tarball). Lives next to the Parakeet model under the same models root.
#[derive(Clone, Copy, Debug)]
pub struct VadSpec {
	/// File name under the models root (also what's checked for presence).
	pub file: &'static str,
	/// Download URL of the raw `.onnx`.
	pub url: &'static str,
}

impl VadSpec {
	/// Absolute path to the VAD file under `root`.
	pub fn path(&self, root: &Path) -> PathBuf {
		root.join(self.file)
	}

	/// True when the VAD file is present on disk.
	pub fn present(&self, root: &Path) -> bool {
		self.path(root).is_file()
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

/// Download a single file (the Silero VAD `.onnx`) to `dest`. Blocking — run on a
/// dedicated thread. Mirrors `download_and_extract`'s cancel/progress contract but
/// skips extraction; writes to a `.part` sibling and renames on success.
pub fn download_file(
	url: &str,
	dest: &Path,
	cancelled: impl Fn() -> bool,
	mut on_progress: impl FnMut(u64, u64),
) -> Result<(), DownloadError> {
	let fail = |e: String| DownloadError::Failed(e);
	if let Some(parent) = dest.parent() {
		fs::create_dir_all(parent).map_err(|e| fail(format!("create models dir: {e}")))?;
	}
	let tmp = dest.with_extension("part");

	let resp = ureq::get(url)
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
	fs::rename(&tmp, dest).map_err(|e| fail(format!("rename: {e}")))?;
	on_progress(received, total);
	Ok(())
}

/// Plan bounded decode windows over `total` samples: tile into windows of at most
/// `max_window` samples, each overlapping the previous by `overlap` samples so a
/// word straddling a cut still lands whole in one window. Pure (no model) so it's
/// the unit-testable core of the anti-hang guarantee — every decode is bounded.
/// Returns gap-free `(start, end)` sample ranges; the last ends exactly at `total`.
pub fn split_into_windows(total: usize, max_window: usize, overlap: usize) -> Vec<(usize, usize)> {
	if total == 0 {
		return Vec::new();
	}
	let max_window = max_window.max(1);
	if total <= max_window {
		return vec![(0, total)];
	}
	let overlap = overlap.min(max_window - 1);
	let step = max_window - overlap;
	let mut out = Vec::new();
	let mut start = 0;
	loop {
		let end = (start + max_window).min(total);
		out.push((start, end));
		if end == total {
			break;
		}
		start += step;
	}
	out
}

/// Join per-segment transcripts into one string: trim each, drop empties, single
/// space between. Pure — unit-testable without the model.
pub fn merge_segment_texts(parts: &[String]) -> String {
	parts
		.iter()
		.map(|s| s.trim())
		.filter(|s| !s.is_empty())
		.collect::<Vec<_>>()
		.join(" ")
}

/// Progress for one decoded segment: 1-based `index` of `total` segments, plus the
/// cumulative transcript so far (so the UI can show partial text as it streams).
#[derive(Clone, Debug)]
pub struct SegmentProgress {
	pub index: usize,
	pub total: usize,
	pub text: String,
}

/// A loaded Silero VAD. Splits a recording into speech-only segments so each
/// Parakeet decode is bounded (no single unbounded decode = no hang on long
/// recordings) and silence is skipped. `Send + Sync`; cache in an `Arc`.
pub struct Vad {
	det: VoiceActivityDetector,
	/// Detector window size in samples (512 for Silero v5 @ 16 kHz).
	window: usize,
	/// Sample rate the detector was configured for; segmentation only applies when
	/// the incoming audio matches it.
	sample_rate: u32,
}

impl Vad {
	/// Load the Silero VAD from `spec` under `root`. `max_window_secs` caps a single
	/// speech run (passed to the detector and re-enforced when draining). Blocking.
	pub fn load(
		spec: &VadSpec,
		root: &Path,
		sample_rate: u32,
		max_window_secs: f32,
	) -> Result<Self, String> {
		// Silero v5 is fixed at 512-sample windows @ 16 kHz (256 @ 8 kHz).
		let window = if sample_rate <= 8_000 { 256 } else { 512 };
		let mut config = VadModelConfig {
			sample_rate: sample_rate as i32,
			num_threads: 1,
			..Default::default()
		};
		config.silero_vad = SileroVadModelConfig {
			model: Some(spec.path(root).to_string_lossy().into_owned()),
			threshold: 0.5,
			min_silence_duration: 0.5,
			min_speech_duration: 0.25,
			window_size: window as i32,
			max_speech_duration: max_window_secs,
		};
		// The internal result buffer must hold at least one capped segment.
		let buffer_secs = (max_window_secs + 1.0).max(2.0);
		let det = VoiceActivityDetector::create(&config, buffer_secs)
			.ok_or_else(|| format!("failed to create Silero VAD from {}", spec.path(root).display()))?;
		Ok(Self { det, window, sample_rate })
	}

	/// The sample rate this detector was built for.
	pub fn sample_rate(&self) -> u32 {
		self.sample_rate
	}

	/// Split `pcm` into bounded speech-only chunks (silence dropped). Each chunk is
	/// at most `max_window` samples — any longer speech run is re-split by the pure
	/// planner, so the caller's per-chunk decode is always bounded.
	pub fn segments(&self, pcm: &[f32], max_window: usize, overlap: usize) -> Vec<Vec<f32>> {
		self.det.reset();
		let mut out: Vec<Vec<f32>> = Vec::new();
		let mut push_capped = |samples: &[f32]| {
			if samples.len() <= max_window {
				if !samples.is_empty() {
					out.push(samples.to_vec());
				}
			} else {
				for (s, e) in split_into_windows(samples.len(), max_window, overlap) {
					out.push(samples[s..e].to_vec());
				}
			}
		};

		let win = self.window.max(1);
		let mut i = 0;
		while i < pcm.len() {
			let end = (i + win).min(pcm.len());
			self.det.accept_waveform(&pcm[i..end]);
			while let Some(seg) = self.det.front() {
				push_capped(seg.samples());
				self.det.pop();
			}
			i = end;
		}
		// Flush any trailing speech the detector was still buffering.
		self.det.flush();
		while let Some(seg) = self.det.front() {
			push_capped(seg.samples());
			self.det.pop();
		}
		out
	}
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

	/// Decode one bounded chunk into text. Internal helper for the segmented path.
	fn decode_one(&self, chunk: &[f32], sample_rate: u32) -> String {
		let stream = self.rec.create_stream();
		stream.accept_waveform(sample_rate as i32, chunk);
		self.rec.decode(&stream);
		stream.get_result().map(|r| r.text).unwrap_or_default()
	}

	/// Transcribe `pcm` in **bounded segments** instead of one whole-recording
	/// decode — the fix for long recordings stalling. With a `vad` matching the
	/// sample rate, decode the Silero-VAD speech segments (silence skipped); else
	/// fall back to fixed overlapping windows. Either way no single decode exceeds
	/// `max_window_secs`. `cancelled()` is polled before each segment (bail out
	/// early); `on_progress` is called after each with the cumulative transcript so
	/// the caller can stream partials. Returns the full transcript. Blocking.
	pub fn transcribe_segmented(
		&self,
		pcm: &[f32],
		sample_rate: u32,
		vad: Option<&Vad>,
		max_window_secs: f32,
		overlap_secs: f32,
		cancelled: &dyn Fn() -> bool,
		on_progress: &mut dyn FnMut(SegmentProgress),
	) -> String {
		let max_window = ((max_window_secs * sample_rate as f32) as usize).max(1);
		let overlap = ((overlap_secs * sample_rate as f32) as usize).min(max_window - 1);
		let mut parts: Vec<String> = Vec::new();

		match vad {
			Some(v) if v.sample_rate() == sample_rate => {
				let chunks = v.segments(pcm, max_window, overlap);
				let total = chunks.len();
				for (i, chunk) in chunks.iter().enumerate() {
					if cancelled() {
						break;
					}
					parts.push(self.decode_one(chunk, sample_rate));
					on_progress(SegmentProgress {
						index: i + 1,
						total,
						text: merge_segment_texts(&parts),
					});
				}
			}
			_ => {
				let ranges = split_into_windows(pcm.len(), max_window, overlap);
				let total = ranges.len();
				for (i, &(s, e)) in ranges.iter().enumerate() {
					if cancelled() {
						break;
					}
					parts.push(self.decode_one(&pcm[s..e], sample_rate));
					on_progress(SegmentProgress {
						index: i + 1,
						total,
						text: merge_segment_texts(&parts),
					});
				}
			}
		}
		merge_segment_texts(&parts)
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

#[cfg(test)]
mod tests {
	use super::{merge_segment_texts, split_into_windows};

	#[test]
	fn windows_cover_a_ten_minute_buffer_bounded() {
		// 10 min @ 16 kHz, 30 s windows with 1 s overlap.
		let total = 16_000 * 600;
		let max = 16_000 * 30;
		let overlap = 16_000;
		let w = split_into_windows(total, max, overlap);

		assert!(!w.is_empty());
		assert_eq!(w.first().unwrap().0, 0, "first window starts at 0");
		assert_eq!(w.last().unwrap().1, total, "last window ends at total");
		for &(s, e) in &w {
			assert!(e > s, "non-empty window");
			assert!(e - s <= max, "every window is bounded by max_window");
		}
		// Gap-free: each window starts no later than the previous one ended.
		for pair in w.windows(2) {
			assert!(pair[1].0 <= pair[0].1, "no gap between consecutive windows");
		}
	}

	#[test]
	fn short_buffer_is_a_single_window() {
		assert_eq!(split_into_windows(100, 1000, 10), vec![(0, 100)]);
	}

	#[test]
	fn empty_buffer_yields_no_windows() {
		assert!(split_into_windows(0, 1000, 10).is_empty());
	}

	#[test]
	fn overlap_is_clamped_below_max_window() {
		// overlap >= max_window would stall; it must be clamped so progress is made.
		let w = split_into_windows(50, 10, 100);
		assert_eq!(w.first().unwrap().0, 0);
		assert_eq!(w.last().unwrap().1, 50);
		for &(s, e) in &w {
			assert!(e - s <= 10);
		}
	}

	#[test]
	fn merge_trims_drops_empties_and_single_spaces() {
		let parts = vec!["  hello ".to_string(), String::new(), "  world".to_string()];
		assert_eq!(merge_segment_texts(&parts), "hello world");
		assert_eq!(merge_segment_texts(&[]), "");
	}
}


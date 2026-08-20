//! Model files on disk.
//!
//! Both the voice and the ears pull weights from HuggingFace on first run — the
//! recognizer's `encoder.onnx.data` alone is 2.45 GB — so the fetching, the
//! cache layout, the progress reporting and the resume logic live here rather
//! than being written twice.

use std::fs;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Serialize;
use tauri::{Emitter, Manager};

/// How often to tell the UI, in bytes. At 8 MB a 2.45 GB file reports ~300
/// times; per-chunk would be tens of thousands of events and cost more than the
/// download itself.
const REPORT_EVERY: u64 = 8 * 1024 * 1024;

const BUFFER: usize = 256 * 1024;

/// Emitted as `model-progress` while weights are being fetched.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
	/// Which engine is loading — `"asr"` or `"tts"`.
	pub feature: String,
	pub received: u64,
	/// Total across everything still missing. Zero if the server would not say.
	pub total: u64,
	pub done: bool,
}

/// Tell the webview which phase a feature is in.
///
/// Downloading and opening are entirely different waits — the first has a
/// percentage and happens once ever, the second is eight seconds of ONNX
/// session creation on every launch. Showing a download bar stuck at 0% during
/// the second is how "loading 0%" ends up on screen for eight seconds looking
/// like something has hung.
pub fn stage(app: &tauri::AppHandle, feature: &str, stage: &str) {
	let _ = app.emit("model-stage", (feature.to_string(), stage.to_string()));
}

/// A per-feature directory under the app cache, e.g. `…/Caches/ceo.aven.os/tts/supertonic-3`.
///
/// `AVEN_MODEL_DIR` overrides the base, which is how a dev machine points at an
/// existing copy instead of pulling gigabytes again.
pub fn cache_dir(app: &tauri::AppHandle, feature: &str, model: &str) -> Result<PathBuf> {
	let base = match std::env::var("AVEN_MODEL_DIR") {
		Ok(dir) => PathBuf::from(dir),
		Err(_) => app
			.path()
			.app_cache_dir()
			.context("no app cache dir on this platform")?,
	};
	Ok(base.join(feature).join(model))
}

fn content_length(url: &str) -> Option<u64> {
	ureq::head(url)
		.call()
		.ok()?
		.header("content-length")?
		.parse()
		.ok()
}

/// Fetch every `(url, dest)` not already on disk, reporting overall progress.
///
/// `feature` names the engine in the emitted events so the UI can tell the ears
/// loading from the voice loading.
pub fn ensure_files(app: &tauri::AppHandle, feature: &str, files: &[(String, PathBuf)]) -> Result<()> {
	let missing: Vec<&(String, PathBuf)> = files.iter().filter(|(_, p)| !p.exists()).collect();
	if missing.is_empty() {
		return Ok(());
	}

	// One HEAD per file up front so the bar has a denominator. Cheap next to
	// what follows, and a percentage is the whole point — without a total this
	// would be a spinner that happens to move.
	let total: u64 = missing.iter().filter_map(|(url, _)| content_length(url)).sum();

	// Bytes already sitting in `.part` files count as received, or resuming a
	// 2 GB download would appear to start from zero.
	let resumable: u64 = missing
		.iter()
		.filter_map(|(_, dest)| fs::metadata(dest.with_extension("part")).ok())
		.map(|m| m.len())
		.sum();

	let emit = |received: u64, done: bool| {
		let _ = app.emit(
			"model-progress",
			Progress {
				feature: feature.to_string(),
				received,
				total,
				done,
			},
		);
	};

	let mut received = resumable;
	emit(received, false);

	for (url, dest) in missing {
		received = fetch(url, dest, received, &emit)?;
	}

	emit(received.max(total), true);
	Ok(())
}

/// Stream one file to disk, resuming a partial download if one is there.
///
/// Copied straight through rather than buffered: reading 2.45 GB into a Vec to
/// write it back out would cost that much RAM for nothing. The `.part` file is
/// renamed into place only on success, so an interrupted run can never leave a
/// truncated tensor file that later fails to load with something inscrutable.
fn fetch(url: &str, dest: &Path, already: u64, emit: &impl Fn(u64, bool)) -> Result<u64> {
	if let Some(parent) = dest.parent() {
		fs::create_dir_all(parent)?;
	}
	let part = dest.with_extension("part");

	// A 2.45 GB download is worth resuming rather than restarting, which also
	// means a rebuild mid-download does not throw the gigabytes away.
	let resume_from = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
	let mut request = ureq::get(url);
	if resume_from > 0 {
		request = request.set("range", &format!("bytes={resume_from}-"));
	}

	log::info!(target: "avenos::assets", "downloading {url} (from byte {resume_from})");
	let response = request.call().with_context(|| format!("failed to fetch {url}"))?;

	// 206 means the range was honoured; anything else means starting over, and
	// the running total has to be walked back so the bar does not overshoot.
	let resumed = response.status() == 206 && resume_from > 0;
	let mut file = if resumed {
		let mut f = fs::OpenOptions::new().write(true).open(&part)?;
		f.seek(std::io::SeekFrom::Start(resume_from))?;
		f
	} else {
		fs::File::create(&part)?
	};

	let mut running = if resumed { already } else { already.saturating_sub(resume_from) };
	let mut since_report = 0u64;
	let mut reader = response.into_reader();
	let mut buffer = vec![0u8; BUFFER];

	loop {
		let read = reader.read(&mut buffer)?;
		if read == 0 {
			break;
		}
		file.write_all(&buffer[..read])?;
		running += read as u64;
		since_report += read as u64;
		if since_report >= REPORT_EVERY {
			since_report = 0;
			emit(running, false);
		}
	}

	file.sync_all()?;
	drop(file);
	fs::rename(&part, dest)?;
	log::info!(target: "avenos::assets", "fetched {}", dest.display());
	Ok(running)
}

/// Single-file convenience for the small extras (a voice style, the VAD model).
pub fn ensure_file(app: &tauri::AppHandle, feature: &str, url: &str, dest: &Path) -> Result<()> {
	ensure_files(app, feature, &[(url.to_string(), dest.to_path_buf())])
}

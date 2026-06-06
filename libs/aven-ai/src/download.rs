//! Shared, engine-agnostic resumable model downloader. Used by the ONNX (`llm`) and
//! llama.cpp (`llama`) model paths so they get the *identical* download UX as each other
//! (and the same shape as the STT/Parakeet path): stream each file to `<local>.part`, resume
//! a partial via an HTTP `Range` request, rename on completion (finished files are never
//! re-fetched), and report cumulative `on_progress(received, total)` with a stable
//! denominator so the UI progress bar moves smoothly. No `ort`, no llama — just `ureq`.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

/// Outcome of a model download.
#[derive(Debug)]
pub enum DownloadError {
	Cancelled,
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

fn head_content_length(url: &str) -> u64 {
	ureq::head(url)
		.call()
		.ok()
		.and_then(|r| r.header("Content-Length").and_then(|s| s.parse::<u64>().ok()))
		.unwrap_or(0)
}

/// Download each `(remote_subpath, local_filename)` in `files` from `base_url` into `dir`.
/// Blocking — run on a dedicated thread. `cancelled()` is polled every chunk; `on_progress`
/// reports cumulative bytes across all files against a stable total computed up front.
///
/// **Resilient**: streams to `<local>.part`, renamed only when complete (finished files are
/// never re-fetched); a partial `.part` resumes via `Range` (a `206` appends; a `200`/dropped
/// range restarts that one file; a `416` means the `.part` is already complete → finalize).
/// Cancelling keeps the `.part`, so a multi-GB pull survives app restarts.
pub fn download_files(
	dir: &Path,
	base_url: &str,
	files: &[(&str, &str)],
	cancelled: impl Fn() -> bool,
	mut on_progress: impl FnMut(u64, u64),
) -> Result<(), DownloadError> {
	let fail = |e: String| DownloadError::Failed(e);
	fs::create_dir_all(dir).map_err(|e| fail(format!("create model dir: {e}")))?;

	// Pass 1 — full grand total + bytes already on disk, so the bar has a stable denominator.
	let mut received: u64 = 0;
	let mut total: u64 = 0;
	for &(remote, local) in files.iter() {
		if let Ok(meta) = dir.join(local).metadata() {
			received += meta.len();
			total += meta.len();
			continue;
		}
		let have = dir.join(format!("{local}.part")).metadata().map(|m| m.len()).unwrap_or(0);
		received += have;
		total += head_content_length(&format!("{base_url}{remote}")).max(have);
	}
	on_progress(received, total);

	// Pass 2 — fetch each missing file, resuming a partial `.part` where possible.
	for &(remote, local) in files.iter() {
		let dest = dir.join(local);
		if dest.is_file() {
			continue;
		}
		if cancelled() {
			return Err(DownloadError::Cancelled);
		}

		let tmp = dir.join(format!("{local}.part"));
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

	Ok(())
}

//! Model files on disk.
//!
//! Both the voice and the ears pull multi-hundred-megabyte weights from
//! HuggingFace on first run, so the fetching and the cache layout live here
//! rather than being written twice.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tauri::Manager;

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

/// Fetch `url` to `dest` unless it is already there.
///
/// Written to a `.part` file first and renamed on success, so an interrupted
/// download cannot leave a truncated 2 GB tensor file behind that then fails to
/// load with something inscrutable.
pub fn ensure_file(url: &str, dest: &Path) -> Result<()> {
	if dest.exists() {
		return Ok(());
	}
	if let Some(parent) = dest.parent() {
		fs::create_dir_all(parent)?;
	}

	log::info!(target: "avenos::assets", "downloading {url}");
	let response = ureq::get(url)
		.call()
		.with_context(|| format!("failed to fetch {url}"))?;

	// Copied straight to disk rather than buffered. The recognizer's
	// `encoder.onnx.data` is ~2.45 GB, and reading that into a Vec first would
	// mean holding all of it in memory to write it back out again.
	let part = dest.with_extension("part");
	let mut reader = response.into_reader();
	let mut file = fs::File::create(&part)?;
	let written = std::io::copy(&mut reader, &mut file)?;
	file.sync_all()?;
	drop(file);

	fs::rename(&part, dest)?;
	log::info!(target: "avenos::assets", "fetched {} ({written} bytes)", dest.display());
	Ok(())
}

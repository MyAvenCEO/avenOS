//! Canonical on-disk layout under `<Documents>/.avenOS/` (cross-platform: OS Documents folder).
//!
//! **Dev harness override**: if `AVENOS_DATA_DIR_OVERRIDE` is set, that path is used instead of
//! the Documents-relative default. This lets two Tauri instances on the same Mac use disjoint
//! data directories (e.g. `~/Documents/.avenOS/avenAlice` and `~/Documents/.avenOS/avenBob`)
//! for P2P sync development.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// `<Documents>/.avenOS` — all AvenOS user-local durable state (identity blobs, Jazz SurrealKV, etc.).
///
/// If `AVENOS_DATA_DIR_OVERRIDE` is set in the environment, that path is used verbatim instead.
/// The directory is created if it does not already exist.
pub fn aven_os_user_root<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
	let root = if let Ok(override_path) = std::env::var("AVENOS_DATA_DIR_OVERRIDE") {
		let p = PathBuf::from(shellexpand::tilde(&override_path).as_ref());
		log::info!(
			target: "avenos::paths",
			"AVENOS_DATA_DIR_OVERRIDE active: using {}",
			p.display()
		);
		p
	} else {
		let docs = app
			.path()
			.document_dir()
			.map_err(|e| format!("document_dir: {e}"))?;
		docs.join(".avenOS")
	};
	std::fs::create_dir_all(&root).map_err(|e| format!("create_dir_all {}: {e}", root.display()))?;
	Ok(root)
}

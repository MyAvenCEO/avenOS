//! Canonical on-disk layout under `<Documents>/.avenOS/` (cross-platform: OS Documents folder).

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// `<Documents>/.avenOS` — all AvenOS user-local durable state (identity blobs, Jazz SurrealKV, etc.).
pub fn aven_os_user_root<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
	let docs = app
		.path()
		.document_dir()
		.map_err(|e| format!("document_dir: {e}"))?;
	let root = docs.join(".avenOS");
	std::fs::create_dir_all(&root).map_err(|e| format!("create_dir_all {}: {e}", root.display()))?;
	Ok(root)
}

//! Scoped filesystem IPC for the website composer (a mainnet/alberobello feature).
//!
//! Every spark is a website project living at
//! `~/Documents/.avenOS/ceo.aven/mainnet/alberobello/sparks/<sparkId>/`. The composer belongs to
//! the mainnet app, which has NO avenDB vault/crypto — so this stores under the mainnet data root
//! (`paths::mainnet_app_base`), NOT the testnet avenDB identity root (`aven_os_app_base`, keyed to
//! `NETWORK_SEED`). All access is constrained to that subtree: spark ids and relative keys are
//! validated to reject `..`, absolute paths, and separators, so the webview can never read or
//! write outside the sparks folder.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

// Locale-routed home seeded at public/en/index.html (served at /en/, like next.aven.ceo). It links
// the shared /styles.css rather than inlining styles. board 0055.
const STARTER: &str = "<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>aven.ceo</title>\n<link rel=\"stylesheet\" href=\"/styles.css\"></head>\n<body><h1>aven.ceo — edit me</h1></body></html>\n";

// Shared stylesheet seeded at public/styles.css — every page links it via <link href=\"/styles.css\">.
const STARTER_CSS: &str = "body{font-family:ui-sans-serif,system-ui,sans-serif;background:#0B1F3A;color:#F4EFE6;display:grid;place-items:center;height:100vh;margin:0}\nh1{font-size:3rem;background:linear-gradient(180deg,#fff,#7aa2ff);-webkit-background-clip:text;background-clip:text;color:transparent}\n";

/// `<mainnet_base>/sparks` (i.e. `.avenOS/ceo.aven/mainnet/alberobello/sparks`) — created if
/// missing. Mainnet data root, not the testnet avenDB identity root.
fn sparks_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
	let base = tauri_plugin_self::paths::mainnet_app_base(app)?.join("sparks");
	fs::create_dir_all(&base).map_err(|e| format!("create_dir_all {}: {e}", base.display()))?;
	Ok(base)
}

fn valid_segment(s: &str) -> bool {
	!s.is_empty()
		&& s.len() <= 64
		&& !s.contains("..")
		&& !s.contains('/')
		&& !s.contains('\\')
		&& !s.starts_with('.')
}

fn spark_dir(app: &tauri::AppHandle, spark_id: &str) -> Result<PathBuf, String> {
	if !valid_segment(spark_id) {
		return Err("invalid spark id".into());
	}
	Ok(sparks_root(app)?.join(spark_id))
}

/// Resolve a relative key inside a spark, rejecting any escape via `..`/absolute.
fn spark_file(app: &tauri::AppHandle, spark_id: &str, rel: &str) -> Result<PathBuf, String> {
	let dir = spark_dir(app, spark_id)?;
	if rel.is_empty()
		|| rel.starts_with('/')
		|| rel.starts_with('\\')
		|| rel.split(['/', '\\']).any(|p| p == ".." || p == "." || p.is_empty())
	{
		return Err("invalid path".into());
	}
	Ok(dir.join(rel))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SparkFile {
	pub path: String,
	pub size: u64,
}

/// The single MVP spark. Each spark holds `public/` (the deploy bucket — a locale-routed static
/// site: `en/index.html` served at /en/, shared `styles.css`) and `private/` (dropped reference
/// images, never published). Mirrors the next.aven.ceo Tigris layout. board 0055.
#[tauri::command(rename_all = "camelCase")]
pub async fn sparks_list(app: tauri::AppHandle) -> Result<Vec<String>, String> {
	let root = sparks_root(&app)?;
	// MVP: a single spark. Drop any legacy spark2.
	let _ = fs::remove_dir_all(root.join("spark2"));
	let dir = root.join("spark1");
	let public = dir.join("public");
	let en = public.join("en");
	fs::create_dir_all(&en).map_err(|e| format!("seed spark1/public/en: {e}"))?;
	fs::create_dir_all(dir.join("private")).map_err(|e| format!("seed spark1/private: {e}"))?;
	let idx = en.join("index.html"); // public/en/index.html — the /en/ home
	let styles = public.join("styles.css");
	// Migrate older layouts into public/en/index.html (content preserved):
	//   spark1/public/index.html (pre-locale)  or  spark1/index.html (flat) → public/en/index.html.
	if !idx.exists() {
		let legacy_public = public.join("index.html");
		let legacy_flat = dir.join("index.html");
		if legacy_public.exists() {
			let _ = fs::rename(&legacy_public, &idx);
		} else if legacy_flat.exists() {
			let _ = fs::rename(&legacy_flat, &idx);
		}
	}
	if !idx.exists() {
		fs::write(&idx, STARTER).map_err(|e| format!("seed spark1/public/en/index.html: {e}"))?;
	}
	if !styles.exists() {
		fs::write(&styles, STARTER_CSS).map_err(|e| format!("seed spark1/public/styles.css: {e}"))?;
	}
	Ok(vec!["spark1".to_string()])
}

/// Recursively list files in a spark (relative, forward-slash paths).
#[tauri::command(rename_all = "camelCase")]
pub async fn spark_list_files(
	app: tauri::AppHandle,
	spark_id: String,
) -> Result<Vec<SparkFile>, String> {
	let dir = spark_dir(&app, &spark_id)?;
	fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
	fn walk(base: &Path, cur: &Path, out: &mut Vec<SparkFile>) {
		if let Ok(entries) = fs::read_dir(cur) {
			for e in entries.flatten() {
				let p = e.path();
				if p.is_dir() {
					walk(base, &p, out);
				} else if let Ok(rel) = p.strip_prefix(base) {
					let size = e.metadata().map(|m| m.len()).unwrap_or(0);
					out.push(SparkFile {
						path: rel.to_string_lossy().replace('\\', "/"),
						size,
					});
				}
			}
		}
	}
	let mut out = Vec::new();
	walk(&dir, &dir, &mut out);
	out.sort_by(|a, b| a.path.cmp(&b.path));
	Ok(out)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn spark_read_file(
	app: tauri::AppHandle,
	spark_id: String,
	path: String,
) -> Result<String, String> {
	let p = spark_file(&app, &spark_id, &path)?;
	fs::read_to_string(&p).map_err(|e| format!("read {path}: {e}"))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn spark_write_file(
	app: tauri::AppHandle,
	spark_id: String,
	path: String,
	content: String,
) -> Result<(), String> {
	let p = spark_file(&app, &spark_id, &path)?;
	if let Some(parent) = p.parent() {
		fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
	}
	fs::write(&p, content).map_err(|e| format!("write {path}: {e}"))
}

/// Write raw bytes to a spark file (e.g. a dropped image into `private/`). board 0055.
#[tauri::command(rename_all = "camelCase")]
pub async fn spark_write_bytes(
	app: tauri::AppHandle,
	spark_id: String,
	path: String,
	content: Vec<u8>,
) -> Result<(), String> {
	let p = spark_file(&app, &spark_id, &path)?;
	if let Some(parent) = p.parent() {
		fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
	}
	fs::write(&p, content).map_err(|e| format!("write {path}: {e}"))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn spark_delete_file(
	app: tauri::AppHandle,
	spark_id: String,
	path: String,
) -> Result<(), String> {
	let p = spark_file(&app, &spark_id, &path)?;
	if p.exists() {
		fs::remove_file(&p).map_err(|e| format!("delete {path}: {e}"))?;
	}
	Ok(())
}

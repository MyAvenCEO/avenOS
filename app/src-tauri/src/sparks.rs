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

const STARTER: &str = "<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\"><title>aven.ceo</title>\n<style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:#0B1F3A;color:#F4EFE6;display:grid;place-items:center;height:100vh;margin:0}h1{font-size:3rem;background:linear-gradient(180deg,#fff,#7aa2ff);-webkit-background-clip:text;background-clip:text;color:transparent}</style></head>\n<body><h1>aven.ceo — edit me</h1></body></html>\n";

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

/// List spark project folders; seed `spark1`/`spark2` on first use.
#[tauri::command(rename_all = "camelCase")]
pub async fn sparks_list(app: tauri::AppHandle) -> Result<Vec<String>, String> {
	let root = sparks_root(&app)?;
	let mut names: Vec<String> = Vec::new();
	if let Ok(entries) = fs::read_dir(&root) {
		for e in entries.flatten() {
			if e.path().is_dir() {
				if let Some(n) = e.file_name().to_str() {
					if valid_segment(n) {
						names.push(n.to_string());
					}
				}
			}
		}
	}
	if names.is_empty() {
		for s in ["spark1", "spark2"] {
			let d = root.join(s);
			fs::create_dir_all(&d).map_err(|e| format!("seed {s}: {e}"))?;
			let idx = d.join("index.html");
			if !idx.exists() {
				fs::write(&idx, STARTER).map_err(|e| format!("seed {s}/index.html: {e}"))?;
			}
			names.push(s.to_string());
		}
	}
	names.sort();
	Ok(names)
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

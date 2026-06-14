//! Loads `libs/aven-schema/schema.manifest.json` (Rust / avenDB source of truth).
//!
//! Parsing lives in `aven_db::manifest` (colocated with the engine); this module keeps
//! the app concerns: file locations, compile-time embeds, sandbox install, and the
//! sealing/exposure policy maps.
//!
//! - **Debug**: read from the repo checkout when present (fast iteration).
//! - **Release / sandbox**: compile-time embed + copy into `<network-root>/schema/` at startup
//!   (App Store cannot read the developer machine path under `CARGO_MANIFEST_DIR`).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use aven_db::manifest::{column_type_from_expose_ts, parse_manifest, Manifest};
use aven_db::query_manager::types::ColumnType;
use aven_db::Schema;
use tauri::AppHandle;

/// Subdirectory under [`tauri_plugin_self::paths::aven_os_app_base`] for schema cache files.
pub const SCHEMA_SUBDIR: &str = "schema";
pub const SCHEMA_MANIFEST_FILENAME: &str = "schema.manifest.json";

const EMBEDDED_MANIFEST: &str = include_str!(concat!(
	env!("CARGO_MANIFEST_DIR"),
	"/../../libs/aven-schema/schema.manifest.json"
));
const EMBEDDED_REGISTRY: &str = include_str!(concat!(
	env!("CARGO_MANIFEST_DIR"),
	"/../../libs/aven-schema/migrations/registry.json"
));
const EMBEDDED_SNAPSHOT_BEFORE_FILES: &str = include_str!(concat!(
	env!("CARGO_MANIFEST_DIR"),
	"/../../libs/aven-schema/migrations/snapshots/before-files.manifest.json"
));

static RUNTIME_AVEN_SCHEMA_ROOT: OnceLock<PathBuf> = OnceLock::new();

fn dev_aven_schema_root() -> PathBuf {
	PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../libs/aven-schema")
}

/// Root for manifest + migration registry (repo in debug when present, else network `schema/`).
pub fn aven_schema_root() -> PathBuf {
	if cfg!(debug_assertions) {
		let dev = dev_aven_schema_root();
		if dev.join(SCHEMA_MANIFEST_FILENAME).is_file() {
			return dev;
		}
	}
	RUNTIME_AVEN_SCHEMA_ROOT
		.get()
		.cloned()
		.unwrap_or_else(dev_aven_schema_root)
}

pub fn aven_schema_manifest_path() -> PathBuf {
	aven_schema_root().join(SCHEMA_MANIFEST_FILENAME)
}

/// Seed bundled schema files into `<network-root>/schema/` (macOS/iOS sandbox-safe).
pub fn install_runtime_schema_files<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<(), String> {
	let base = tauri_plugin_self::paths::aven_os_app_base(app)?;
	let root = base.join(SCHEMA_SUBDIR);
	let snapshots = root.join("migrations/snapshots");
	fs::create_dir_all(&snapshots)
		.map_err(|e| format!("mkdir {}: {e}", snapshots.display()))?;

	write_if_changed(&root.join(SCHEMA_MANIFEST_FILENAME), EMBEDDED_MANIFEST)?;
	write_if_changed(&root.join("migrations/registry.json"), EMBEDDED_REGISTRY)?;
	write_if_changed(
		&snapshots.join("before-files.manifest.json"),
		EMBEDDED_SNAPSHOT_BEFORE_FILES,
	)?;

	let _ = RUNTIME_AVEN_SCHEMA_ROOT.set(root);
	log::info!(
		target: "avenos::schema",
		"installed schema files under {}",
		RUNTIME_AVEN_SCHEMA_ROOT
			.get()
			.map(|p| p.display().to_string())
			.unwrap_or_default()
	);
	Ok(())
}

fn write_if_changed(path: &Path, contents: &str) -> Result<(), String> {
	if path.is_file() {
		if let Ok(existing) = fs::read_to_string(path) {
			if existing == contents {
				return Ok(());
			}
		}
	}
	fs::write(path, contents).map_err(|e| format!("write {}: {e}", path.display()))
}

fn read_manifest_json() -> Result<String, String> {
	if cfg!(debug_assertions) {
		let path = dev_aven_schema_root().join(SCHEMA_MANIFEST_FILENAME);
		if path.is_file() {
			return fs::read_to_string(&path)
				.map_err(|e| format!("read {}: {e}", path.display()));
		}
	}
	if let Some(root) = RUNTIME_AVEN_SCHEMA_ROOT.get() {
		let path = root.join(SCHEMA_MANIFEST_FILENAME);
		if path.is_file() {
			return fs::read_to_string(&path)
				.map_err(|e| format!("read {}: {e}", path.display()));
		}
	}
	Ok(EMBEDDED_MANIFEST.to_string())
}

fn read_manifest() -> Result<Manifest, String> {
	parse_manifest(&read_manifest_json()?)
}

static EXPOSE_TS_MAP: OnceLock<HashMap<(String, String), ColumnType>> = OnceLock::new();

fn expose_ts_map() -> &'static HashMap<(String, String), ColumnType> {
	EXPOSE_TS_MAP.get_or_init(|| {
		read_manifest()
			.ok()
			.map(|m| {
				let mut map = HashMap::new();
				for (table, def) in m.tables {
					for col in def.columns {
						let Some(slug) = col.expose_ts.as_deref() else {
							continue;
						};
						if let Ok(ct) = column_type_from_expose_ts(slug) {
							map.insert((table.clone(), col.name.clone()), ct);
						}
					}
				}
				map
			})
			.unwrap_or_default()
	})
}

/// Logical AvenDb/IPC type for a column (e.g. `bigint` for `text` + `exposeTs: bigint`).
pub fn expose_ts_for(table: &str, column: &str) -> Option<&'static ColumnType> {
	expose_ts_map().get(&(table.to_string(), column.to_string()))
}

/// Columns **without** `plaintext: true` are sealed at rest; IPC still requires biscuit admin for identity-scoped tables.
/// `plaintext: true` marks routing metadata only (not a “public visibility” mode).
pub fn manifest_sensitive_columns() -> Result<HashMap<String, HashSet<String>>, String> {
	let m = read_manifest()?;
	let mut out: HashMap<String, HashSet<String>> = HashMap::new();
	for (table_name, def) in m.tables {
		for col in def.columns {
			if col.plaintext {
				continue;
			}
			// Fail closed (board 0021): EVERY non-plaintext column is sealed at rest — the
			// manifest declares sealed columns with sealable storage (text/bytea), so a
			// non-string value in a sensitive column is a law violation and hydrate errors
			// (`secret_col_bad_storage`), never a silent plaintext pass-through.
			out.entry(table_name.clone())
				.or_default()
				.insert(col.name.clone());
		}
	}
	Ok(out)
}

/// Table names that carry a `owner` column — the manifest is the single source of truth
/// for which tables participate in biscuit-gated P2P sync and ACL object maps.
pub fn manifest_spark_scoped_table_names() -> Result<Vec<String>, String> {
	let m = read_manifest()?;
	// Ownership is intrinsic — EVERY value is owned by a SAFE (board 0037), so every manifest table
	// is identity-scoped. (The catalogue/schema infrastructure is a separate subsystem, not a value.)
	Ok(m.tables.keys().cloned().collect())
}

/// Build a AvenDb [`Schema`] from a manifest JSON file (e.g. migration snapshots).
pub fn load_avendb_schema_from_manifest_path(path: &std::path::Path) -> Result<Schema, String> {
	aven_db::manifest::schema_from_manifest_path(path)
}

/// Build a AvenDb [`Schema`] from the active manifest (repo, `.avenOS/aven-schema`, or compile-time embed).
pub fn load_avendb_schema_from_manifest() -> Result<Schema, String> {
	aven_db::manifest::schema_from_manifest_str(&read_manifest_json()?)
}

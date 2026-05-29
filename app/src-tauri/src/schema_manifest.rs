//! Loads `libs/aven-schema/schema.manifest.json` (Rust / Groove source of truth).
//!
//! - **Debug**: read from the repo checkout when present (fast iteration).
//! - **Release / sandbox**: compile-time embed + copy into `<Documents>/.avenOS/aven-schema/` at startup
//!   (App Store cannot read the developer machine path under `CARGO_MANIFEST_DIR`).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use groove::query_manager::types::{ColumnType, SchemaBuilder, TableSchemaBuilder};
use groove::Schema;
use serde::Deserialize;
use tauri::AppHandle;

/// Subdirectory under [`tauri_plugin_self::paths::aven_os_app_base`] for Aven schema files.
pub const AVEN_SCHEMA_SUBDIR: &str = "aven-schema";
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

#[derive(Debug, Deserialize)]
struct ManifestColumn {
	name: String,
	#[serde(rename = "type")]
	ty: String,
	#[serde(default)]
	nullable: bool,
	/// When true: routing/sync metadata stored unsealed (e.g. `spark_id`). Not world-readable.
	/// When false (default): column is sealed at rest and gated by biscuit on IPC paths.
	#[serde(default)]
	plaintext: bool,
	/// Required for `"type": "enum"`.
	#[serde(default)]
	variants: Option<Vec<String>>,
	/// Optional JSON Schema constraint for `"type": "json"`.
	#[serde(default)]
	schema: Option<serde_json::Value>,
	/// Logical IPC/TS type when Groove storage is `text` (sealed at rest). e.g. `"bigint"` for timestamps.
	#[serde(default, rename = "exposeTs")]
	expose_ts: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ManifestTable {
	columns: Vec<ManifestColumn>,
}

#[derive(Debug, Deserialize)]
struct Manifest {
	tables: BTreeMap<String, ManifestTable>,
}

fn dev_aven_schema_root() -> PathBuf {
	PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../libs/aven-schema")
}

/// Root for manifest + migration registry (repo in debug when present, else `.avenOS/aven-schema`).
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

/// Seed bundled schema files into `<Documents>/.avenOS/aven-schema/` (macOS/iOS sandbox-safe).
pub fn install_runtime_schema_files<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<(), String> {
	let base = tauri_plugin_self::paths::aven_os_app_base(app)?;
	let root = base.join(AVEN_SCHEMA_SUBDIR);
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
		"installed aven schema files under {}",
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

fn column_type_from_manifest(col: &ManifestColumn) -> Result<ColumnType, String> {
	match col.ty.as_str() {
		"text" => Ok(ColumnType::Text),
		"boolean" => Ok(ColumnType::Boolean),
		"integer" => Ok(ColumnType::Integer),
		"bigint" => Ok(ColumnType::BigInt),
		"uuid" => Ok(ColumnType::Uuid),
		"uuid[]" => Ok(ColumnType::Array {
			element: Box::new(ColumnType::Uuid),
		}),
		"bytea" => Ok(ColumnType::Bytea),
		"double" => Ok(ColumnType::Double),
		"timestamp" => Ok(ColumnType::Timestamp),
		"json" => Ok(ColumnType::Json {
			schema: col.schema.clone(),
		}),
		"enum" => {
			let variants = col.variants.clone().ok_or_else(|| {
				format!("enum column `{}` missing `variants`", col.name)
			})?;
			if variants.is_empty() {
				return Err(format!("enum column `{}` has empty `variants`", col.name));
			}
			Ok(ColumnType::Enum { variants })
		}
		"batch_id" => Ok(ColumnType::BatchId),
		other => Err(format!(
			"unknown column `{}` kind {other:?} (Row/nested array types are not supported in manifest)",
			col.name,
		)),
	}
}

fn add_column(tb: TableSchemaBuilder, col: &ManifestColumn) -> Result<TableSchemaBuilder, String> {
	let ct = column_type_from_manifest(col)?;
	if col.nullable {
		Ok(tb.nullable_column(&col.name, ct))
	} else {
		Ok(tb.column(&col.name, ct))
	}
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
	let raw = read_manifest_json()?;
	serde_json::from_str(&raw).map_err(|e| format!("manifest JSON: {e}"))
}

static EXPOSE_TS_MAP: OnceLock<HashMap<(String, String), ColumnType>> = OnceLock::new();

fn column_type_from_expose_ts(slug: &str) -> Result<ColumnType, String> {
	match slug {
		"string" => Ok(ColumnType::Text),
		"boolean" => Ok(ColumnType::Boolean),
		"bigint" => Ok(ColumnType::BigInt),
		"integer" => Ok(ColumnType::Integer),
		"uuid" => Ok(ColumnType::Uuid),
		"string[]" => Ok(ColumnType::Array {
			element: Box::new(ColumnType::Text),
		}),
		other => Err(format!("unknown exposeTs {other:?}")),
	}
}

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

/// Logical Jazz/IPC type for a column (e.g. `bigint` for `text` + `exposeTs: bigint`).
pub fn expose_ts_for(table: &str, column: &str) -> Option<&'static ColumnType> {
	expose_ts_map().get(&(table.to_string(), column.to_string()))
}

/// Columns **without** `plaintext: true` are sealed at rest; IPC still requires biscuit admin for spark-scoped tables.
/// `plaintext: true` marks routing metadata only (not a “public visibility” mode).
pub fn manifest_sensitive_columns() -> Result<HashMap<String, HashSet<String>>, String> {
	let m = read_manifest()?;
	let mut out: HashMap<String, HashSet<String>> = HashMap::new();
	for (table_name, def) in m.tables {
		for col in def.columns {
			if col.plaintext {
				continue;
			}
			out.entry(table_name.clone())
				.or_default()
				.insert(col.name.clone());
		}
	}
	Ok(out)
}

/// Back-compat name for callers that historically called this «secret manifest» for text-only sealing.
#[inline]
pub fn manifest_secret_columns() -> Result<HashMap<String, HashSet<String>>, String> {
	manifest_sensitive_columns()
}

/// Table names that carry a `spark_id` column — the manifest is the single source of truth
/// for which tables participate in biscuit-gated P2P sync and ACL object maps.
pub fn manifest_spark_scoped_table_names() -> Result<Vec<String>, String> {
	let m = read_manifest()?;
	Ok(m.tables
		.iter()
		.filter(|(_, def)| def.columns.iter().any(|c| c.name == "spark_id"))
		.map(|(name, _)| name.clone())
		.collect())
}

/// Build a Jazz [`Schema`] from a manifest JSON file (e.g. migration snapshots).
pub fn load_jazz_schema_from_manifest_path(path: &std::path::Path) -> Result<Schema, String> {
	let raw =
		std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
	let m: Manifest = serde_json::from_str(&raw).map_err(|e| format!("manifest JSON: {e}"))?;
	manifest_to_schema(m)
}

fn manifest_to_schema(m: Manifest) -> Result<Schema, String> {
	let mut builder = SchemaBuilder::new();
	for (table_name, def) in m.tables {
		let mut tb = TableSchemaBuilder::new(&table_name);
		for col in def.columns {
			tb = add_column(tb, &col)?;
		}
		builder = builder.table(tb);
	}
	Ok(builder.build())
}

/// Build a Jazz [`Schema`] from the active manifest (repo, `.avenOS/aven-schema`, or compile-time embed).
pub fn load_jazz_schema_from_manifest() -> Result<Schema, String> {
	let raw = read_manifest_json()?;
	let m: Manifest = serde_json::from_str(&raw).map_err(|e| format!("manifest JSON: {e}"))?;
	manifest_to_schema(m)
}

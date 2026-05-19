//! Loads `libs/jazz-schema/schema.manifest.json` — same file drives TS codegen (`types.ts`).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;

use groove::query_manager::types::{ColumnType, SchemaBuilder, TableSchemaBuilder};
use groove::Schema;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct ManifestColumn {
	name: String,
	#[serde(rename = "type")]
	ty: String,
	#[serde(default)]
	nullable: bool,
	/// When false (default): column is encrypted at rest and gated by biscuit on IPC paths.
	#[serde(default)]
	plaintext: bool,
}

#[derive(Debug, Deserialize)]
struct ManifestTable {
	columns: Vec<ManifestColumn>,
}

#[derive(Debug, Deserialize)]
struct Manifest {
	tables: BTreeMap<String, ManifestTable>,
}

fn add_column(tb: TableSchemaBuilder, col: &ManifestColumn) -> Result<TableSchemaBuilder, String> {
	let t = col.ty.as_str();
	let n = col.nullable;
	match (t, n) {
		("text", false) => Ok(tb.column(&col.name, ColumnType::Text)),
		("text", true) => Ok(tb.nullable_column(&col.name, ColumnType::Text)),
		("boolean", false) => Ok(tb.column(&col.name, ColumnType::Boolean)),
		("boolean", true) => Ok(tb.nullable_column(&col.name, ColumnType::Boolean)),
		("integer", false) => Ok(tb.column(&col.name, ColumnType::Integer)),
		("integer", true) => Ok(tb.nullable_column(&col.name, ColumnType::Integer)),
		("bigint", false) => Ok(tb.column(&col.name, ColumnType::BigInt)),
		("bigint", true) => Ok(tb.nullable_column(&col.name, ColumnType::BigInt)),
		("uuid", false) => Ok(tb.column(&col.name, ColumnType::Uuid)),
		("uuid", true) => Ok(tb.nullable_column(&col.name, ColumnType::Uuid)),
		("uuid[]", false) => Ok(tb.column(
			&col.name,
			ColumnType::Array(Box::new(ColumnType::Uuid)),
		)),
		("uuid[]", true) => Ok(tb.nullable_column(
			&col.name,
			ColumnType::Array(Box::new(ColumnType::Uuid)),
		)),
		_ => Err(format!(
			"unknown column `{}` kind {:?} nullable={}",
			col.name, t, col.nullable,
		)),
	}
}

pub fn jazz_schema_manifest_path() -> PathBuf {
	PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../libs/jazz-schema/schema.manifest.json")
}

fn read_manifest() -> Result<Manifest, String> {
	let path = jazz_schema_manifest_path();
	let raw =
		std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
	serde_json::from_str(&raw).map_err(|e| format!("manifest JSON: {e}"))
}

/// Rows marked `plaintext` in the manifest are public; everything else is sealed + IPC-gated by default.
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

/// Build a Jazz [`Schema`] from the checked-in manifest alongside this crate.
pub fn load_jazz_schema_from_manifest() -> Result<Schema, String> {
	load_jazz_schema_from_manifest_path(&jazz_schema_manifest_path())
}

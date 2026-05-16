//! Loads `libs/jazz-schema/schema.manifest.json` — same file drives TS codegen (`types.ts`).

use std::collections::BTreeMap;
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
		_ => Err(format!(
			"unknown column `{}` kind {:?} nullable={}",
			col.name, t, col.nullable,
		)),
	}
}

/// Build a Jazz [`Schema`] from the checked-in manifest alongside this crate.
pub fn load_jazz_schema_from_manifest() -> Result<Schema, String> {
	let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
		.join("../../../libs/jazz-schema/schema.manifest.json");
	let raw =
		std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
	let m: Manifest = serde_json::from_str(&raw).map_err(|e| format!("manifest JSON: {e}"))?;

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

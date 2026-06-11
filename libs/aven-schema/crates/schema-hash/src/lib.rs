//! Parse an aven-schema manifest JSON into a avenDB [`Schema`] — the single
//! source of truth for the canonical schema (and its [`SchemaHash`]).
//!
//! Both the `avenos-schema-hash` binary and `aven-node` use this so the server
//! builds **exactly** the same schema (same hash) the device app does — inbound
//! row batches carry `origin_schema_hash`, so a divergent parse would make the
//! server reject every replicated row.

use std::collections::BTreeMap;
use std::path::Path;

use aven_db::query_manager::types::{ColumnType, SchemaBuilder, TableSchemaBuilder};
use aven_db::Schema;
use serde::Deserialize;

/// The canonical manifest, embedded at build time (repo source of truth).
pub const EMBEDDED_MANIFEST: &str =
	include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../schema.manifest.json"));

#[derive(Debug, Deserialize)]
struct ManifestColumn {
	name: String,
	#[serde(rename = "type")]
	ty: String,
	#[serde(default)]
	nullable: bool,
	#[serde(default)]
	plaintext: bool,
	#[serde(default)]
	variants: Option<Vec<String>>,
	#[serde(default)]
	schema: Option<serde_json::Value>,
	/// Required for `"type": "vector"` — embedding dimensionality (e.g. 768).
	#[serde(default)]
	dim: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct ManifestTable {
	columns: Vec<ManifestColumn>,
}

#[derive(Debug, Deserialize)]
struct Manifest {
	tables: BTreeMap<String, ManifestTable>,
}

fn column_type_from_manifest(col: &ManifestColumn) -> Result<ColumnType, String> {
	let _ = col.plaintext; // routing/seal hint — not part of the storage column type
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
			let variants = col
				.variants
				.clone()
				.ok_or_else(|| format!("enum column `{}` missing `variants`", col.name))?;
			if variants.is_empty() {
				return Err(format!("enum column `{}` has empty `variants`", col.name));
			}
			Ok(ColumnType::Enum { variants })
		}
		"batch_id" => Ok(ColumnType::BatchId),
		"vector" => {
			let dim = col
				.dim
				.ok_or_else(|| format!("vector column `{}` missing `dim`", col.name))?;
			if dim == 0 {
				return Err(format!("vector column `{}` has zero `dim`", col.name));
			}
			Ok(ColumnType::Vector { dim })
		}
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

/// Parse a manifest JSON string into a avenDB [`Schema`].
pub fn load_schema_from_str(raw: &str) -> Result<Schema, String> {
	let m: Manifest = serde_json::from_str(raw).map_err(|e| format!("manifest JSON: {e}"))?;
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

/// Parse a manifest JSON file into a avenDB [`Schema`].
pub fn load_schema(path: &Path) -> Result<Schema, String> {
	let raw =
		std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
	load_schema_from_str(&raw)
}

/// The canonical schema parsed from the embedded manifest.
pub fn embedded_schema() -> Result<Schema, String> {
	load_schema_from_str(EMBEDDED_MANIFEST)
}

//! Print 32-byte hex Groove SchemaHash for an aven-schema manifest JSON file.
use std::collections::BTreeMap;
use std::env;
use std::path::PathBuf;

use groove::query_manager::types::{ColumnType, SchemaBuilder, SchemaHash, TableSchemaBuilder};
use groove::Schema;
use serde::Deserialize;

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

fn load_schema(path: &std::path::Path) -> Result<Schema, String> {
	let raw = std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
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

fn hash_hex(bytes: &[u8; 32]) -> String {
	bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn main() {
	let path = env::args().nth(1).map(PathBuf::from).unwrap_or_else(|| {
		eprintln!("usage: avenos-schema-hash <path-to.manifest.json>");
		std::process::exit(2);
	});
	match load_schema(&path) {
		Ok(schema) => {
			let hash = *SchemaHash::compute(&schema).as_bytes();
			println!("{}", hash_hex(&hash));
		}
		Err(e) => {
			eprintln!("{e}");
			std::process::exit(1);
		}
	}
}

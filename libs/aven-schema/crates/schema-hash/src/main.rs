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

//! Schema-manifest parsing: a JSON table/column manifest → an avenDB [`Schema`].
//!
//! Colocated in the engine (from `app/src-tauri/src/schema_manifest.rs`) so every
//! host — the Tauri app, `aven-node`, tools, tests — builds schemas from the same
//! parser. Hosts keep their own concerns: file locations, compile-time embeds,
//! sealing policy (`plaintext` flags), and TS exposure maps.
//!
//! Manifest shape (see `libs/aven-schema/schema.manifest.json`):
//! ```json
//! { "tables": { "<name>": { "columns": [
//!     { "name": "owner", "type": "uuid", "plaintext": true },
//!     { "name": "embedding", "type": "vector", "dim": 768, "nullable": true },
//!     { "name": "done", "type": "text", "exposeTs": "boolean" }
//! ] } } }
//! ```

use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;

use crate::query_manager::types::{ColumnType, Schema, SchemaBuilder, TableSchemaBuilder};

/// One column in the manifest.
#[derive(Debug, Clone, Deserialize)]
pub struct ManifestColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
    #[serde(default)]
    pub nullable: bool,
    /// When true: routing/sync metadata stored unsealed (e.g. `owner`). Not
    /// world-readable. When false (default): sealed at rest by the host's policy.
    #[serde(default)]
    pub plaintext: bool,
    /// Required for `"type": "enum"`.
    #[serde(default)]
    pub variants: Option<Vec<String>>,
    /// Optional JSON Schema constraint for `"type": "json"`.
    #[serde(default)]
    pub schema: Option<serde_json::Value>,
    /// Logical IPC/TS type when storage is `text` (sealed at rest), e.g. `"bigint"`.
    #[serde(default, rename = "exposeTs")]
    pub expose_ts: Option<String>,
    /// Required for `"type": "vector"` — embedding dimensionality (e.g. 768).
    #[serde(default)]
    pub dim: Option<usize>,
}

/// One table in the manifest.
#[derive(Debug, Clone, Deserialize)]
pub struct ManifestTable {
    pub columns: Vec<ManifestColumn>,
}

/// The whole manifest.
#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub tables: BTreeMap<String, ManifestTable>,
}

/// Parse manifest JSON.
pub fn parse_manifest(raw: &str) -> Result<Manifest, String> {
    serde_json::from_str(raw).map_err(|e| format!("manifest JSON: {e}"))
}

/// Map a manifest column to an engine [`ColumnType`].
pub fn column_type_from_manifest(col: &ManifestColumn) -> Result<ColumnType, String> {
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

/// Map an `exposeTs` slug to the logical IPC/TS [`ColumnType`].
pub fn column_type_from_expose_ts(slug: &str) -> Result<ColumnType, String> {
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

/// Build a [`Schema`] from a parsed manifest.
pub fn manifest_to_schema(m: Manifest) -> Result<Schema, String> {
    let mut builder = SchemaBuilder::new();
    for (table_name, def) in m.tables {
        let mut tb = TableSchemaBuilder::new(&table_name);
        for col in def.columns {
            let ct = column_type_from_manifest(&col)?;
            tb = if col.nullable {
                tb.nullable_column(&col.name, ct)
            } else {
                tb.column(&col.name, ct)
            };
        }
        builder = builder.table(tb);
    }
    Ok(builder.build())
}

/// Build a [`Schema`] from manifest JSON.
pub fn schema_from_manifest_str(raw: &str) -> Result<Schema, String> {
    manifest_to_schema(parse_manifest(raw)?)
}

/// Build a [`Schema`] from a manifest JSON file.
pub fn schema_from_manifest_path(path: &Path) -> Result<Schema, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    schema_from_manifest_str(&raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query_manager::types::TableName;

    #[test]
    fn parses_vector_columns_with_dim() {
        let raw = r#"{ "tables": { "memories": { "columns": [
            { "name": "owner", "type": "uuid", "plaintext": true },
            { "name": "embedding", "type": "vector", "dim": 768, "nullable": true }
        ] } } }"#;
        let schema = schema_from_manifest_str(raw).unwrap();
        let t = schema.get(&TableName::new("memories")).unwrap();
        let col = t.columns.column("embedding").unwrap();
        assert!(matches!(col.column_type, ColumnType::Vector { dim: 768 }));
    }

    #[test]
    fn vector_without_dim_is_rejected() {
        let raw = r#"{ "tables": { "t": { "columns": [
            { "name": "v", "type": "vector" }
        ] } } }"#;
        assert!(schema_from_manifest_str(raw).is_err());
    }
}

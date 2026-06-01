//! Spark-scoped sync policy — table classification and UI drain notifications.

use std::sync::OnceLock;

use groove::ObjectId;
use uuid::Uuid;

/// Snapshot of object→spark mappings used to gate outbound sync (updated on every shell hydrate).
#[derive(Clone)]
pub struct SyncAclSnapshot {
	/// Patch rows may omit spark_id — map `(table, object_id)` → spark scope for ACL.
	pub object_spark_ids: std::collections::HashMap<(String, ObjectId), Uuid>,
}

/// Build the outbound sync ACL snapshot from the hydrated vault shell.
pub fn build_sync_acl_snapshot(
	object_spark_ids: std::collections::HashMap<(String, ObjectId), Uuid>,
) -> SyncAclSnapshot {
	SyncAclSnapshot { object_spark_ids }
}

static SPARK_SCOPED_TABLES: OnceLock<Vec<String>> = OnceLock::new();

fn spark_scoped_tables_cached() -> &'static [String] {
	SPARK_SCOPED_TABLES.get_or_init(|| {
		let mut names = crate::schema_manifest::manifest_spark_scoped_table_names()
			.unwrap_or_else(|e| {
				log::warn!(
					target: "avenos::spark_sync",
					"manifest spark-scoped tables unavailable ({e}); using compile-time fallback",
				);
				vec![
					"sparks".into(),
					"keyshares".into(),
					"todos".into(),
					"messages".into(),
					"files".into(),
				]
			});
		names.sort();
		names
	})
}

/// Tables whose rows include `spark_id` per the active Jazz manifest.
pub fn spark_scoped_table_names() -> &'static [String] {
	spark_scoped_tables_cached()
}

/// Biscuit vault / trusted-peer tables — full shell re-hydrate on change.
pub const VAULT_SHELL_TABLES: &[&str] = &["sparks", "keyshares", "peers"];

/// Catalogue tables republished to the webview after vault shell re-hydrate (`peers` uses its own path).
pub const VAULT_CATALOGUE_UI_TABLES: &[&str] = &["sparks", "keyshares"];

/// Manifest `spark_id` tables except vault shell catalogue rows (`sparks`, `keyshares`).
pub fn is_spark_data_table(name: &str) -> bool {
	is_spark_scoped_table(name) && !matches!(name, "sparks" | "keyshares")
}

pub fn is_vault_shell_table(name: &str) -> bool {
	VAULT_SHELL_TABLES.contains(&name)
}

pub fn is_spark_scoped_table(name: &str) -> bool {
	spark_scoped_table_names()
		.iter()
		.any(|t| t.as_str() == name)
}

/// After local create, refresh the ACL object map before encrypt follow-up patches.
pub fn needs_acl_object_map_refresh_after_create(name: &str) -> bool {
	is_spark_data_table(name)
}

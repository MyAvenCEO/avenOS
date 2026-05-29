//! Spark-scoped P2P sync policy — **single source of truth** for table classification,
//! row-batch table resolution, and UI drain notifications.
//!
//! Table membership is derived from `libs/aven-schema/schema.manifest.json` (any table
//! with a `spark_id` column). Policy layers on top:
//! - **Vault shell** — biscuit / DEK / peers (`sparks`, `keyshares`, `peers`)
//! - **Spark data** — encrypted user rows scoped to a spark (manifest `spark_id` tables
//!   except `sparks` / `keyshares`)

use std::sync::{Arc, OnceLock};

use groove::metadata::MetadataKey;
use groove::query_manager::encoding::decode_row;
use groove::query_manager::types::Value;
use groove::row_histories::StoredRowBatch;
use groove::sync_manager::{RowMetadata, SyncPayload};
use groove::{ObjectId, Schema};
use uuid::Uuid;

use crate::jazz::jazz_engine;
use crate::spark_acc;

/// Snapshot of shell vault for sync ACL (updated whenever shell hydrates / grant runs).
#[derive(Clone)]
pub struct SyncAclSnapshot {
	pub schema: Arc<Schema>,
	/// `(spark_id -> biscuit chain)` for admin checks.
	pub sparks: std::collections::HashMap<Uuid, spark_acc::BiscuitSpark>,
	/// Patch rows may omit spark_id — map `(table, object_id)` → spark scope for ACL.
	pub object_spark_ids: std::collections::HashMap<(String, ObjectId), Uuid>,
}

pub fn load_acl_snapshot(
	vault: &spark_acc::BiscuitVault,
	object_spark_ids: std::collections::HashMap<(String, ObjectId), Uuid>,
) -> Result<SyncAclSnapshot, String> {
	let schema = Arc::new(crate::schema_manifest::load_jazz_schema_from_manifest()?);
	let sparks = vault
		.sparks
		.iter()
		.map(|(id, bs)| {
			(
				*id,
				spark_acc::BiscuitSpark {
					spark_id: bs.spark_id,
					biscuit: bs.biscuit.clone(),
				},
			)
		})
		.collect();
	Ok(SyncAclSnapshot {
		schema,
		sparks,
		object_spark_ids,
	})
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

/// Never forwarded over P2P (local trust graph only).
pub const P2P_BLOCKED_TABLES: &[&str] = &["peers"];

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

/// Info-level P2P sync diagnostics (matches prior `peer_sync_gate` logging policy).
pub fn is_p2p_sync_diag_table(name: &str) -> bool {
	matches!(name, "sparks" | "keyshares" | "messages" | "files") || name == "todos"
}

pub fn table_from_payload(payload: &SyncPayload) -> Option<String> {
	match payload {
		SyncPayload::RowBatchCreated { metadata: Some(m), .. }
		| SyncPayload::RowBatchNeeded { metadata: Some(m), .. } => table_from_row_metadata(m),
		SyncPayload::RowBatchCreated { row, .. } | SyncPayload::RowBatchNeeded { row, .. } => row
			.metadata
			.get(MetadataKey::Table.as_str())
			.map(|s| s.to_string()),
		_ => None,
	}
}

fn table_from_row_metadata(meta: &RowMetadata) -> Option<String> {
	meta.metadata
		.get(MetadataKey::Table.as_str())
		.cloned()
}

/// Tables to post on the UI drain channel for an inbound/outbound row-batch frame.
///
/// Row-batch patch replay often omits payload metadata (`include_metadata=false` after the
/// first frame per object). Without a fallback, grant/message/file deltas never wake the
/// drain and peer UIs stay stale.
pub fn tables_to_notify(payload: &SyncPayload) -> Vec<String> {
	if let Some(table) = table_from_payload(payload) {
		return vec![table];
	}
	match payload {
		SyncPayload::RowBatchCreated { .. } | SyncPayload::RowBatchNeeded { .. } => {
			spark_scoped_table_names().to_vec()
		}
		_ => Vec::new(),
	}
}

/// Resolve table for outbound biscuit ACL when payload/row metadata is absent.
pub fn resolve_table_for_acl(snap: &SyncAclSnapshot, payload: &SyncPayload) -> Option<String> {
	if let Some(table) = table_from_payload(payload) {
		return Some(table);
	}
	let (SyncPayload::RowBatchCreated { row, .. } | SyncPayload::RowBatchNeeded { row, .. }) =
		payload
	else {
		return None;
	};
	let oid = row.row_id;
	for name in spark_scoped_table_names() {
		if snap
			.object_spark_ids
			.contains_key(&(name.clone(), oid))
		{
			return Some(name.clone());
		}
		if spark_uuid_from_row_batch(&snap.schema, name, row).is_some() {
			return Some(name.clone());
		}
	}
	None
}

pub fn resolve_spark_uuid(
	snap: &SyncAclSnapshot,
	table: &str,
	row: &StoredRowBatch,
	object_id: ObjectId,
) -> Option<Uuid> {
	if let Some(spark) = spark_uuid_from_row_batch(&snap.schema, table, row) {
		return Some(spark);
	}
	snap.object_spark_ids
		.get(&(table.to_string(), object_id))
		.copied()
}

pub fn spark_uuid_from_row_batch(schema: &Schema, table: &str, row: &StoredRowBatch) -> Option<Uuid> {
	let tname = groove::query_manager::types::TableName::new(table);
	let ts = schema.get(&tname)?;
	let row_bytes = row.data.as_ref();
	let decoded = decode_row(&ts.columns, row_bytes).ok()?;
	let ix = jazz_engine::col_ix(ts, "spark_id").ok()?;
	let cell = decoded.get(ix)?;
	match cell {
		Value::Uuid(oid) => Some(*oid.uuid()),
		Value::Text(s) => Uuid::parse_str(s.trim()).ok(),
		_ => None,
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::sync::Arc;

	#[test]
	fn manifest_derives_spark_scoped_tables() {
		let names = spark_scoped_table_names();
		for expected in ["sparks", "keyshares", "messages", "todos", "files"] {
			assert!(
				names.iter().any(|n| n == expected),
				"missing {expected} in {names:?}",
			);
		}
	}

	#[test]
	fn metadata_less_row_batch_notifies_all_spark_scoped_tables() {
		let payload = SyncPayload::RowBatchCreated {
			metadata: None,
			row: StoredRowBatch {
				row_id: ObjectId::new(),
				batch_id: groove::row_histories::BatchId::new(),
				branch: "client/main".into(),
				parents: Default::default(),
				updated_at: 0,
				created_by: "test".into(),
				created_at: 0,
				updated_by: "test".into(),
				state: groove::row_histories::RowState::VisibleDirect,
				confirmed_tier: None,
				delete_kind: None,
				is_deleted: false,
				data: groove::query_manager::types::RowBytes::from(Vec::new()),
				metadata: groove::row_histories::RowMetadata::from_entries(Vec::new()),
			},
		};
		assert_eq!(tables_to_notify(&payload), spark_scoped_table_names().to_vec());
	}

	#[test]
	fn object_map_resolves_spark_when_patch_rows_omit_spark_id() {
		let spark = Uuid::new_v4();
		let obj = ObjectId::new();
		let mut object_spark_ids = std::collections::HashMap::new();
		object_spark_ids.insert(("sparks".to_string(), obj), spark);

		let snap = SyncAclSnapshot {
			schema: Arc::new(
				crate::schema_manifest::load_jazz_schema_from_manifest().expect("manifest schema"),
			),
			sparks: std::collections::HashMap::new(),
			object_spark_ids,
		};

		let row = StoredRowBatch {
			row_id: obj,
			batch_id: groove::row_histories::BatchId::new(),
			branch: "client/main".into(),
			parents: Default::default(),
			updated_at: 0,
			created_by: "test".into(),
			created_at: 0,
			updated_by: "test".into(),
			state: groove::row_histories::RowState::VisibleDirect,
			confirmed_tier: None,
			delete_kind: None,
			is_deleted: false,
			data: groove::query_manager::types::RowBytes::from(Vec::new()),
			metadata: groove::row_histories::RowMetadata::from_entries(Vec::new()),
		};
		let resolved = resolve_spark_uuid(&snap, "sparks", &row, obj);
		assert_eq!(resolved, Some(spark));
	}
}

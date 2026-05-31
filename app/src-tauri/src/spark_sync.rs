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
use groove::row_format::decode_row;
use groove::query_manager::types::Value;
use groove::row_histories::StoredRowBatch;
use groove::sync_manager::{RowMetadata, SyncPayload};
use groove::{ObjectId, Schema};
use uuid::Uuid;

use crate::jazz::jazz_engine;
use crate::spark_acc;
pub use tauri_plugin_p2p::SyncBootstrapPhase;

/// Snapshot of shell vault for sync ACL (updated whenever shell hydrates / grant runs).
#[derive(Clone)]
pub struct SyncAclSnapshot {
	pub schema: Arc<Schema>,
	/// `(spark_id -> biscuit chain)` for admin checks.
	pub sparks: std::collections::HashMap<Uuid, spark_acc::BiscuitSpark>,
	/// Patch rows may omit spark_id — map `(table, object_id)` → spark scope for ACL.
	pub object_spark_ids: std::collections::HashMap<(String, ObjectId), Uuid>,
}

/// Build the outbound P2P ACL snapshot from the hydrated vault shell (single source of truth).
pub fn build_sync_acl_snapshot(
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

/// Never forwarded over P2P (local identity / trust graph only).
pub const P2P_BLOCKED_TABLES: &[&str] = &["peers", "humans"];

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

/// Tables that may be queued for peer catch-up and forwarded over P2P.
pub fn is_p2p_replicable_table(name: &str) -> bool {
	if P2P_BLOCKED_TABLES.contains(&name) {
		return false;
	}
	is_vault_shell_table(name)
		|| is_spark_data_table(name)
		|| matches!(name, "catalogue_schema" | "catalogue_lens")
}

/// After local create, refresh the ACL object map before encrypt follow-up patches.
pub fn needs_acl_object_map_refresh_after_create(name: &str) -> bool {
	is_spark_data_table(name)
}

/// Info-level P2P sync diagnostics (matches prior `peer_sync_gate` logging policy).
pub fn is_p2p_sync_diag_table(name: &str) -> bool {
	matches!(name, "sparks" | "keyshares" | "messages" | "files") || name == "todos"
}

/// Whether an outbound P2P frame may be sent to `dest_did` (mesh allowlist → ClientId mapping).
///
/// Policy layers (first principles):
/// - **No ACL snapshot** — deny (caller should retry after shell hydrate).
/// - **`peers`** — never forwarded (local trust graph).
/// - **Vault shell** (`sparks`, `keyshares`) — allow to paired peer; biscuit admin is not required
///   for bootstrap (remote DID is not in `owns` until shell rows replicate).
/// - **Spark data** — require `spark_peer_is_owner` for the row's spark.
/// - **Control frames** (`BatchFate`, etc.) — allow when ACL is loaded even if table metadata is absent.
pub fn should_forward_p2p(
	snap: &SyncAclSnapshot,
	dest_did: &str,
	payload: &SyncPayload,
) -> bool {
	if payload.is_catalogue() {
		return true;
	}
	let Some(tbl) = resolve_table_for_acl(snap, payload) else {
		return !matches!(
			payload,
			SyncPayload::RowBatchCreated { .. } | SyncPayload::RowBatchNeeded { .. }
		);
	};
	if P2P_BLOCKED_TABLES.contains(&tbl.as_str()) {
		return false;
	}
	if matches!(tbl.as_str(), "catalogue_schema" | "catalogue_lens") {
		return true;
	}
	if is_vault_shell_table(&tbl) {
		return true;
	}
	let (SyncPayload::RowBatchCreated { row, .. } | SyncPayload::RowBatchNeeded { row, .. }) =
		payload
	else {
		return true;
	};
	let object_id = row.row_id;
	let Some(spark) = resolve_spark_uuid(snap, &tbl, row, object_id) else {
		return false;
	};
	let Some(entry) = snap.sparks.get(&spark) else {
		return false;
	};
	match spark_acc::spark_peer_is_owner(&entry.biscuit, spark, dest_did) {
		Ok(true) => true,
		Ok(false) | Err(_) => false,
	}
}

/// Permanent policy deny — do not re-queue (local-only tables, `peers`, `humans`, etc.).
pub fn p2p_forward_drop_is_permanent(payload: &SyncPayload) -> bool {
	table_from_payload(payload).is_some_and(|t| !is_p2p_replicable_table(&t))
}

/// Spark-data frame blocked during shell/trust bootstrap — defer without treating as permanent.
pub fn p2p_forward_drop_is_bootstrap_hold(payload: &SyncPayload) -> bool {
	let Some(tbl) = table_from_payload(payload) else {
		return false;
	};
	is_spark_data_table(&tbl)
}

/// Whether `dest_did` is biscuit admin on at least one spark in the ACL snapshot.
pub fn remote_is_spark_admin(snap: &SyncAclSnapshot, dest_did: &str) -> bool {
	snap.sparks.values().any(|bs| {
		spark_acc::spark_peer_is_owner(&bs.biscuit, bs.spark_id, dest_did).ok() == Some(true)
	})
}

/// Per-peer bootstrap phase for mesh UI + catch-up gating.
#[must_use]
pub fn compute_sync_bootstrap_phase(
	snap: Option<&SyncAclSnapshot>,
	dest_did: &str,
	mux_ready: bool,
) -> SyncBootstrapPhase {
	if !mux_ready {
		return SyncBootstrapPhase::TransportPending;
	}
	let Some(snap) = snap else {
		return SyncBootstrapPhase::ShellPending;
	};
	if remote_is_spark_admin(snap, dest_did) {
		return SyncBootstrapPhase::Ready;
	}
	if snap.sparks.is_empty() {
		return SyncBootstrapPhase::ShellPending;
	}
	SyncBootstrapPhase::TrustPending
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
/// Tables whose row batches should wake the UI drain (manifest spark-scoped set).
pub fn tables_to_notify(payload: &SyncPayload) -> Vec<String> {
	let mut tables = if let Some(table) = table_from_payload(payload) {
		vec![table]
	} else {
		match payload {
			SyncPayload::RowBatchCreated { .. } | SyncPayload::RowBatchNeeded { .. } => {
				spark_scoped_table_names().to_vec()
			}
			_ => Vec::new(),
		}
	};
	// Vault catalogue rows (sparks + keyshares) share one shell re-hydrate path.
	if tables
		.iter()
		.any(|t| VAULT_CATALOGUE_UI_TABLES.contains(&t.as_str()))
	{
		for t in VAULT_CATALOGUE_UI_TABLES {
			if !tables.iter().any(|x| x == *t) {
				tables.push((*t).to_string());
			}
		}
	}
	tables
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
	fn vault_catalogue_row_notifies_both_tables() {
		let payload = SyncPayload::RowBatchCreated {
			metadata: Some(RowMetadata {
				id: ObjectId::new(),
				metadata: [(
					MetadataKey::Table.as_str().to_string(),
					"keyshares".to_string(),
				)]
				.into_iter()
				.collect(),
			}),
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
		let tables = tables_to_notify(&payload);
		assert!(tables.iter().any(|t| t == "keyshares"));
		assert!(tables.iter().any(|t| t == "sparks"));
	}

	#[test]
	fn vault_shell_forwards_without_biscuit_owner() {
		let root = [9u8; 32];
		let vault = crate::spark_acc::build_vault_from_root(&root).expect("vault");
		let spark = Uuid::new_v4();
		let obj = ObjectId::new();
		let peer_did = "did:key:z6Mkpeer";
		let biscuit = crate::spark_acc::mint_genesis_spark(&vault, spark).expect("genesis");
		let mut sparks = std::collections::HashMap::new();
		sparks.insert(
			spark,
			crate::spark_acc::BiscuitSpark {
				spark_id: spark,
				biscuit,
			},
		);
		let snap = SyncAclSnapshot {
			schema: Arc::new(
				crate::schema_manifest::load_jazz_schema_from_manifest().expect("schema"),
			),
			sparks,
			object_spark_ids: std::collections::HashMap::new(),
		};
		let payload = SyncPayload::RowBatchCreated {
			metadata: Some(RowMetadata {
				id: obj,
				metadata: [(
					MetadataKey::Table.as_str().to_string(),
					"keyshares".to_string(),
				)]
				.into_iter()
				.collect(),
			}),
			row: StoredRowBatch {
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
			},
		};
		assert!(should_forward_p2p(&snap, peer_did, &payload));
	}

	#[test]
	fn batch_fate_forwards_when_acl_loaded() {
		use groove::batch_fate::BatchFate;

		let snap = SyncAclSnapshot {
			schema: Arc::new(
				crate::schema_manifest::load_jazz_schema_from_manifest().expect("schema"),
			),
			sparks: std::collections::HashMap::new(),
			object_spark_ids: std::collections::HashMap::new(),
		};
		let payload = SyncPayload::BatchFate {
			fate: BatchFate::Missing {
				batch_id: groove::row_histories::BatchId::new(),
			},
		};
		assert!(should_forward_p2p(&snap, "did:key:z6Mkpeer", &payload));
	}

	#[test]
	fn spark_data_blocked_when_remote_not_owner() {
		let root = [9u8; 32];
		let vault = crate::spark_acc::build_vault_from_root(&root).expect("vault");
		let spark = Uuid::new_v4();
		let obj = ObjectId::new();
		let peer_did = "did:key:z6Mkpeer";
		let biscuit = crate::spark_acc::mint_genesis_spark(&vault, spark).expect("genesis");
		let mut sparks = std::collections::HashMap::new();
		sparks.insert(
			spark,
			crate::spark_acc::BiscuitSpark {
				spark_id: spark,
				biscuit,
			},
		);
		let snap = SyncAclSnapshot {
			schema: Arc::new(
				crate::schema_manifest::load_jazz_schema_from_manifest().expect("schema"),
			),
			sparks,
			object_spark_ids: std::collections::HashMap::new(),
		};
		let payload = SyncPayload::RowBatchCreated {
			metadata: Some(RowMetadata {
				id: obj,
				metadata: [
					(MetadataKey::Table.as_str().to_string(), "messages".to_string()),
					("spark_id".to_string(), spark.to_string()),
				]
				.into_iter()
				.collect(),
			}),
			row: StoredRowBatch {
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
			},
		};
		assert!(!should_forward_p2p(&snap, peer_did, &payload));
		assert!(p2p_forward_drop_is_bootstrap_hold(&payload));
		assert!(!p2p_forward_drop_is_permanent(&payload));
	}

	#[test]
	fn bootstrap_phase_trust_when_shell_present_not_admin() {
		let root = [9u8; 32];
		let vault = crate::spark_acc::build_vault_from_root(&root).expect("vault");
		let spark = Uuid::new_v4();
		let biscuit = crate::spark_acc::mint_genesis_spark(&vault, spark).expect("genesis");
		let mut sparks = std::collections::HashMap::new();
		sparks.insert(
			spark,
			crate::spark_acc::BiscuitSpark {
				spark_id: spark,
				biscuit,
			},
		);
		let snap = SyncAclSnapshot {
			schema: Arc::new(
				crate::schema_manifest::load_jazz_schema_from_manifest().expect("schema"),
			),
			sparks,
			object_spark_ids: std::collections::HashMap::new(),
		};
		assert_eq!(
			compute_sync_bootstrap_phase(Some(&snap), "did:key:z6Mkpeer", true),
			SyncBootstrapPhase::TrustPending,
		);
	}

	#[test]
	fn peers_table_never_forwards() {
		let snap = SyncAclSnapshot {
			schema: Arc::new(
				crate::schema_manifest::load_jazz_schema_from_manifest().expect("schema"),
			),
			sparks: std::collections::HashMap::new(),
			object_spark_ids: std::collections::HashMap::new(),
		};
		let payload = SyncPayload::RowBatchCreated {
			metadata: Some(RowMetadata {
				id: ObjectId::new(),
				metadata: [(
					MetadataKey::Table.as_str().to_string(),
					"peers".to_string(),
				)]
				.into_iter()
				.collect(),
			}),
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
		assert!(!should_forward_p2p(&snap, "did:key:z6Mkpeer", &payload));
		assert!(p2p_forward_drop_is_permanent(&payload));
	}

	#[test]
	fn humans_table_never_forwarded_or_requeued() {
		let snap = SyncAclSnapshot {
			schema: Arc::new(
				crate::schema_manifest::load_jazz_schema_from_manifest().expect("manifest schema"),
			),
			sparks: std::collections::HashMap::new(),
			object_spark_ids: std::collections::HashMap::new(),
		};
		let payload = SyncPayload::RowBatchNeeded {
			metadata: Some(RowMetadata {
				id: ObjectId::new(),
				metadata: [(
					MetadataKey::Table.as_str().to_string(),
					"humans".to_string(),
				)]
				.into_iter()
				.collect(),
			}),
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
		assert!(!should_forward_p2p(&snap, "did:key:z6Mkpeer", &payload));
		assert!(p2p_forward_drop_is_permanent(&payload));
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

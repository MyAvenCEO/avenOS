//! Wrap [`groove::PeerTransport`] so outbound sync never leaks the local `peers` table and only
//! forwards spark-scoped data to DIDs that are biscuit admins for that spark.

use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use groove::metadata::MetadataKey;
use groove::query_manager::encoding::decode_row;
use groove::query_manager::types::Value;
use groove::row_histories::StoredRowBatch;
use groove::sync_manager::{ClientId, InboxEntry, RowMetadata, Source, SyncPayload};
use groove::{ObjectId, PeerTransport, Result as GrooveResult, Schema};
use uuid::Uuid;

use crate::jazz::jazz_engine;
use crate::schema_manifest;
use crate::spark_acc;

/// Maps remote Groove [`ClientId`] → `did:key` for policy checks.
#[derive(Clone)]
pub struct PeerClientIdMap {
	inner: Arc<RwLock<std::collections::HashMap<ClientId, String>>>,
}

impl PeerClientIdMap {
	/// Shares the same backing map as the Hyperswarm bridge (macOS).
	pub fn from_shared(inner: Arc<RwLock<std::collections::HashMap<ClientId, String>>>) -> Self {
		Self { inner }
	}

	pub fn get_did(&self, c: ClientId) -> Option<String> {
		self.inner.read().expect("peer cid map").get(&c).cloned()
	}
}

/// Snapshot of shell vault for sync ACL (updated whenever shell hydrates / grant runs).
#[derive(Clone)]
pub struct SyncAclSnapshot {
	pub schema: Arc<Schema>,
	/// `(spark_id -> biscuit chain)` for admin checks.
	pub sparks: std::collections::HashMap<Uuid, spark_acc::BiscuitSpark>,
	/// Patch rows may omit spark_id — map `(table, object_id)` → spark scope for ACL.
	pub object_spark_ids: std::collections::HashMap<(String, ObjectId), Uuid>,
}

#[derive(Clone)]
pub struct BiscuitGatedPeerTransport {
	inner: Arc<dyn PeerTransport>,
	cid_did: PeerClientIdMap,
	acl: Arc<RwLock<Option<SyncAclSnapshot>>>,
	change_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
}

impl BiscuitGatedPeerTransport {
	pub fn new(
		inner: Arc<dyn PeerTransport>,
		cid_did: PeerClientIdMap,
		acl: Arc<RwLock<Option<SyncAclSnapshot>>>,
		change_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
	) -> Self {
		Self {
			inner,
			cid_did,
			acl,
			change_tx,
		}
	}
}

fn is_sync_diag_table(tbl: &Option<String>) -> bool {
	matches!(
		tbl.as_deref(),
		Some("sparks" | "keyshares" | "messages" | "files")
	)
}

#[async_trait]
impl PeerTransport for BiscuitGatedPeerTransport {
	async fn send_to(&self, peer: ClientId, payload: SyncPayload) -> GrooveResult<()> {
		let dest_did = match self.cid_did.get_did(peer) {
			Some(d) => d,
			None => {
				log::warn!(target: "avenos::peer_sync_gate", "drop sync frame: unknown ClientId {peer:?}");
				return Ok(());
			}
		};
		let variant = payload_variant(&payload);
		let tbl = table_from_payload(&payload);
		if !should_forward(&self.acl, &dest_did, &payload) {
			let log_line = format!(
				"drop outbound peer={peer:?} did={dest_did} variant={variant} table={tbl:?}",
			);
			if is_sync_diag_table(&tbl) {
				log::info!(target: "avenos::peer_sync_gate", "{log_line}");
			} else {
				log::debug!(target: "avenos::peer_sync_gate", "{log_line}");
			}
			return Ok(());
		}
		if is_sync_diag_table(&tbl) {
			log::info!(
				target: "avenos::peer_sync_gate",
				"forward outbound peer={peer:?} did={dest_did} variant={variant} table={tbl:?}",
			);
		} else {
			log::trace!(
				target: "avenos::peer_sync_gate",
				"forward outbound peer={peer:?} did={dest_did} variant={variant} table={tbl:?}",
			);
		}
		self.inner.send_to(peer, payload).await
	}

	async fn recv_inbound(&self) -> Option<InboxEntry> {
		let entry = self.inner.recv_inbound().await?;
		let src = match &entry.source {
			Source::Client(c) => format!("Client({c:?})"),
			Source::Server(s) => format!("Server({s:?})"),
		};
		let variant = payload_variant(&entry.payload);
		let tbl = table_from_payload(&entry.payload);
		log::trace!(
			target: "avenos::peer_sync_gate",
			"recv inbound src={src} variant={variant} table={tbl:?}",
		);
		if let (Some(table), Some(tx)) = (tbl.as_ref(), self.change_tx.as_ref()) {
			if is_sync_diag_table(&tbl) {
				log::info!(
					target: "avenos::peer_sync_gate",
					"recv inbound src={src} variant={variant} table={table}",
				);
			}
			let _ = tx.send(table.clone());
		}
		Some(entry)
	}

	async fn shutdown(&self) -> GrooveResult<()> {
		self.inner.shutdown().await
	}
}

fn table_from_row_metadata(meta: &RowMetadata) -> Option<String> {
	meta.metadata
		.get(MetadataKey::Table.as_str())
		.cloned()
}

fn table_from_payload(payload: &SyncPayload) -> Option<String> {
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

fn payload_variant(p: &SyncPayload) -> &'static str {
	match p {
		SyncPayload::RowBatchCreated { .. } => "RowBatchCreated",
		SyncPayload::RowBatchNeeded { .. } => "RowBatchNeeded",
		SyncPayload::BatchFate { .. } => "BatchFate",
		_ => "Other",
	}
}

fn should_forward(acl: &Arc<RwLock<Option<SyncAclSnapshot>>>, dest_did: &str, payload: &SyncPayload) -> bool {
	if payload.is_catalogue() {
		return true;
	}
	let Some(tbl) = table_from_payload(payload) else {
		return false;
	};
	if tbl == "peers" {
		return false;
	}
	if matches!(tbl.as_str(), "catalogue_schema" | "catalogue_lens") {
		return true;
	}
	let (SyncPayload::RowBatchCreated { row, .. } | SyncPayload::RowBatchNeeded { row, .. }) =
		payload
	else {
		return true;
	};
	let guard = acl.read().expect("acl");
	let Some(snap) = guard.as_ref() else {
		return false;
	};
	let object_id = row.row_id;
	let Some(spark) = resolve_spark_uuid(&snap, &tbl, row, object_id) else {
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

fn resolve_spark_uuid(
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

fn spark_uuid_from_row_batch(schema: &Schema, table: &str, row: &StoredRowBatch) -> Option<Uuid> {
	let tname = groove::query_manager::types::TableName::new(table);
	let ts = schema.get(&tname)?;
	let row_bytes = row.data.as_ref();
	let decoded = decode_row(&ts.descriptor, row_bytes).ok()?;
	let ix = jazz_engine::col_ix(ts, "spark_id").ok()?;
	let cell = decoded.get(ix)?;
	match cell {
		Value::Uuid(oid) => Some(*oid.uuid()),
		Value::Text(s) => Uuid::parse_str(s.trim()).ok(),
		_ => None,
	}
}

pub fn load_acl_snapshot(
	vault: &spark_acc::BiscuitVault,
	object_spark_ids: std::collections::HashMap<(String, ObjectId), Uuid>,
) -> Result<SyncAclSnapshot, String> {
	let schema = Arc::new(schema_manifest::load_jazz_schema_from_manifest()?);
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn object_map_resolves_spark_when_patch_rows_omit_spark_id() {
		let spark = Uuid::new_v4();
		let obj = ObjectId::new();
		let mut object_spark_ids = std::collections::HashMap::new();
		object_spark_ids.insert(("sparks".to_string(), obj), spark);

		let snap = SyncAclSnapshot {
			schema: Arc::new(
				schema_manifest::load_jazz_schema_from_manifest().expect("manifest schema"),
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

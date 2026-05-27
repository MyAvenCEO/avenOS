//! Wrap [`groove::PeerTransport`] so outbound sync never leaks the local `peers` table and only
//! forwards spark-scoped data to DIDs that are biscuit admins for that spark.

use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use groove::commit::Commit;
use groove::metadata::MetadataKey;
use groove::query_manager::encoding::decode_row;
use groove::query_manager::types::Value;
use groove::sync_manager::{ClientId, InboxEntry, Source, SyncPayload};
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
	/// Patch commits omit unchanged columns — map `(table, object_id)` → spark scope for ACL.
	pub object_spark_ids: std::collections::HashMap<(String, ObjectId), Uuid>,
}

#[derive(Clone)]
pub struct BiscuitGatedPeerTransport {
	inner: Arc<dyn PeerTransport>,
	cid_did: PeerClientIdMap,
	acl: Arc<RwLock<Option<SyncAclSnapshot>>>,
	/// Optional MPSC sender wired to [`ManagedJazz::run_table_change_drain`]. When a
	/// peer-sync `ObjectUpdated` arrives carrying a `Table` metadata key we post the
	/// table name here so the drain can re-query and republish the snapshot on the
	/// per-table broadcaster (driving the webview's `jazz:<table>:changed` event).
	///
	/// Optional rather than required because tests construct the gate without a Tauri
	/// runtime; dropping the notify is a no-op.
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
		let tbl = table_from_metadata(&payload);
		if !should_forward(&self.acl, &dest_did, &payload) {
			// Keep at debug: a dropped spark frame is the usual ACL / catch-up timing signal.
			log::debug!(
				target: "avenos::peer_sync_gate",
				"drop outbound peer={peer:?} did={dest_did} variant={variant} table={tbl:?}",
			);
			return Ok(());
		}
		// Per-frame trace only — full catch-up can emit thousands/sec at `avenos=debug`.
		// Enable with `RUST_LOG=avenos::peer_sync_gate=trace` when you need wire-level detail.
		log::trace!(
			target: "avenos::peer_sync_gate",
			"forward outbound peer={peer:?} did={dest_did} variant={variant} table={tbl:?}",
		);
		self.inner.send_to(peer, payload).await
	}

	async fn recv_inbound(&self) -> Option<InboxEntry> {
		let entry = self.inner.recv_inbound().await?;
		let src = match &entry.source {
			Source::Client(c) => format!("Client({c:?})"),
			Source::Server(s) => format!("Server({s:?})"),
		};
		let variant = payload_variant(&entry.payload);
		let tbl = table_from_metadata(&entry.payload);
		let commits = match &entry.payload {
			SyncPayload::ObjectUpdated { commits, .. } => commits.len(),
			_ => 0,
		};
		log::trace!(
			target: "avenos::peer_sync_gate",
			"recv inbound src={src} variant={variant} table={tbl:?} commits={commits}",
		);
		// Notify the table-change drain so the webview's `jazz:<table>:changed`
		// subscribers see this peer delta without requiring a manual refresh.
		// We post before returning the entry: Groove applies it immediately after
		// `recv_inbound` returns, and the drain debounces ~50ms which is plenty
		// of headroom for that apply to land before we re-query.
		if let (Some(table), Some(tx)) = (tbl.as_ref(), self.change_tx.as_ref()) {
			let _ = tx.send(table.clone());
		}
		Some(entry)
	}

	async fn shutdown(&self) -> GrooveResult<()> {
		self.inner.shutdown().await
	}
}

fn table_from_metadata(payload: &SyncPayload) -> Option<String> {
	match payload {
		SyncPayload::ObjectUpdated {
			metadata: Some(m),
			..
		} => m
			.metadata
			.get(MetadataKey::Table.as_str())
			.cloned(),
		_ => None,
	}
}

fn payload_variant(p: &SyncPayload) -> &'static str {
	// Lightweight discriminator for diagnostic logs (avoids cloning payloads).
	match p {
		SyncPayload::ObjectUpdated { .. } => "ObjectUpdated",
		SyncPayload::ObjectTruncated { .. } => "ObjectTruncated",
		_ => "Other",
	}
}

fn should_forward(acl: &Arc<RwLock<Option<SyncAclSnapshot>>>, dest_did: &str, payload: &SyncPayload) -> bool {
	// TODO(perf): consider filtering unauthorized peers earlier (e.g. in Groove's
	// `queue_tips_to_client`) so we skip serializing payloads for DID↔spark pairs that
	// will never pass this check. Security is correct today: every outbound frame is
	// evaluated here (`spark_peer_is_owner`) before Hyperswarm.
	if payload.is_catalogue() {
		return true;
	}
	let Some(tbl) = table_from_metadata(payload) else {
		return false;
	};
	if tbl == "peers" {
		return false;
	}
	if matches!(tbl.as_str(), "catalogue_schema" | "catalogue_lens") {
		return true;
	}
	let SyncPayload::ObjectUpdated { commits, object_id, .. } = payload else {
		return true;
	};
	let guard = acl.read().expect("acl");
	let Some(snap) = guard.as_ref() else {
		return false;
	};
	let Some(spark) = resolve_spark_uuid(&snap, &tbl, commits, object_id) else {
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
	commits: &[Commit],
	object_id: &ObjectId,
) -> Option<Uuid> {
	if let Some(spark) = spark_uuid_from_commits(&snap.schema, table, commits) {
		return Some(spark);
	}
	snap.object_spark_ids
		.get(&(table.to_string(), *object_id))
		.copied()
}

fn spark_uuid_from_commits(schema: &Schema, table: &str, commits: &[Commit]) -> Option<Uuid> {
	for commit in commits {
		if let Ok(spark) = spark_uuid_from_commit(schema, table, &commit.content) {
			return Some(spark);
		}
	}
	None
}

fn spark_uuid_from_commit(schema: &Schema, table: &str, content: &[u8]) -> Result<Uuid, String> {
	let tname = groove::query_manager::types::TableName::new(table);
	let ts = schema
		.get(&tname)
		.ok_or_else(|| format!("unknown table {table}"))?;
	let row = decode_row(&ts.descriptor, content).map_err(|e| format!("decode_row:{e:?}"))?;
	let ix = jazz_engine::col_ix(ts, "spark_id")
		.map_err(|_| "spark_id column missing".to_string())?;
	let cell = row.get(ix).ok_or_else(|| "spark_id oob".to_string())?;
	match cell {
		Value::Uuid(oid) => Ok(*oid.uuid()),
		Value::Text(s) => Uuid::parse_str(s.trim()).map_err(|e| e.to_string()),
		Value::Null => Err("spark_id null in patch".into()),
		_ => Err("spark_id bad type".into()),
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
	use groove::query_manager::types::{ColumnDescriptor, ColumnType, RowDescriptor};

	#[test]
	fn patch_commit_without_spark_id_resolves_via_object_map() {
		let spark = Uuid::new_v4();
		let obj = ObjectId::new();
		let mut object_spark_ids = std::collections::HashMap::new();
		object_spark_ids.insert(("sparks".to_string(), obj), spark);

		let desc = RowDescriptor {
			columns: vec![
				ColumnDescriptor::new("spark_id", ColumnType::Uuid),
				ColumnDescriptor::new("genesis_b64", ColumnType::Text),
			],
		};
		let schema = Schema::new(std::collections::HashMap::from([(
			groove::query_manager::types::TableName::new("sparks"),
			groove::query_manager::types::TableSchema {
				descriptor: desc,
				..Default::default()
			},
		)]));
		let snap = SyncAclSnapshot {
			schema: Arc::new(schema),
			sparks: std::collections::HashMap::new(),
			object_spark_ids,
		};

		// Patch-only commit: genesis_b64 set, spark_id null.
		let patch_row = groove::query_manager::encoding::encode_row(
			&snap.schema.get(&groove::query_manager::types::TableName::new("sparks")).unwrap().descriptor,
			&[Value::Null, Value::Text("updated-genesis".into())],
		)
		.unwrap();
		let commit = Commit {
			parents: smallvec::smallvec![],
			content: patch_row,
			timestamp: 1,
			author: ObjectId::new(),
			metadata: None,
			stored_state: groove::commit::StoredState::Stored,
			ack_state: Default::default(),
		};

		let resolved = resolve_spark_uuid(&snap, "sparks", std::slice::from_ref(&commit), &obj);
		assert_eq!(resolved, Some(spark));
	}
}

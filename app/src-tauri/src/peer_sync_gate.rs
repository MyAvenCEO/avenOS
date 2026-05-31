//! Wrap [`groove::PeerTransport`] so outbound sync never leaks blocked tables and only
//! forwards spark-scoped data to DIDs that are biscuit admins for that spark.
//!
//! Table classification + row-batch resolution live in [`crate::spark_sync`] (manifest-driven).

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use groove::sync_manager::{ClientId, InboxEntry, Source, SyncPayload};
use groove::{PeerTransport, Result as GrooveResult};

use crate::spark_sync::{self, SyncAclSnapshot};

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

#[derive(Clone)]
pub struct BiscuitGatedPeerTransport {
	inner: Arc<dyn PeerTransport>,
	cid_did: PeerClientIdMap,
	acl: Arc<RwLock<Option<SyncAclSnapshot>>>,
}

impl BiscuitGatedPeerTransport {
	pub fn new(
		inner: Arc<dyn PeerTransport>,
		cid_did: PeerClientIdMap,
		acl: Arc<RwLock<Option<SyncAclSnapshot>>>,
	) -> Self {
		Self {
			inner,
			cid_did,
			acl,
		}
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
	let guard = acl.read().expect("acl");
	let Some(snap) = guard.as_ref() else {
		return false;
	};
	spark_sync::should_forward_p2p(snap, dest_did, payload)
}

fn now_ms() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_millis() as u64)
		.unwrap_or(0)
}

static POLICY_DROP_LOG_LAST: Mutex<Option<HashMap<String, u64>>> = Mutex::new(None);
const POLICY_LOG_INTERVAL_MS: u64 = 5_000;

fn should_log_policy_drop(key: &str) -> bool {
	let now = now_ms();
	let mut slot = POLICY_DROP_LOG_LAST.lock().expect("policy log lock");
	let map = slot.get_or_insert_with(HashMap::new);
	let last = map.get(key).copied().unwrap_or(0);
	if now.saturating_sub(last) >= POLICY_LOG_INTERVAL_MS {
		map.insert(key.to_string(), now);
		true
	} else {
		false
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
		let tbl = spark_sync::table_from_payload(&payload);
		if !should_forward(&self.acl, &dest_did, &payload) {
			let log_key = format!("{dest_did}:{tbl:?}");
			let log_line = format!(
				"policy_drop peer={peer:?} did={dest_did} variant={variant} table={tbl:?}",
			);
			let bootstrap_hold = spark_sync::p2p_forward_drop_is_bootstrap_hold(&payload);
			if should_log_policy_drop(&log_key) {
				if bootstrap_hold {
					log::info!(
						target: "avenos::peer_sync_gate",
						"{log_line} (bootstrap hold)",
					);
				} else if tbl.as_deref().is_some_and(spark_sync::is_p2p_sync_diag_table) {
					log::info!(target: "avenos::peer_sync_gate", "{log_line}");
				} else {
					log::debug!(target: "avenos::peer_sync_gate", "{log_line}");
				}
			}
			if spark_sync::p2p_forward_drop_is_permanent(&payload) {
				return Ok(());
			}
			// Transient / bootstrap hold — defer until shell + trust catch up.
			let reason = if bootstrap_hold {
				format!("bootstrap_hold {log_line}")
			} else {
				log_line
			};
			return Err(groove::JazzError::Sync(reason));
		}
		if tbl.as_deref().is_some_and(spark_sync::is_p2p_sync_diag_table) {
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
		let tbl = spark_sync::table_from_payload(&entry.payload);
		log::trace!(
			target: "avenos::peer_sync_gate",
			"recv inbound src={src} variant={variant} table={tbl:?}",
		);
		if let Some(table) = tbl.as_deref().filter(|t| spark_sync::is_p2p_sync_diag_table(t)) {
			log::info!(
				target: "avenos::peer_sync_gate",
				"recv inbound src={src} variant={variant} table={table}",
			);
		}
		Some(entry)
	}

	async fn shutdown(&self) -> GrooveResult<()> {
		self.inner.shutdown().await
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use groove::sync_manager::SyncPayload;

	#[test]
	fn spark_data_bootstrap_hold_is_not_permanent() {
		let payload = SyncPayload::RowBatchCreated {
			metadata: None,
			row: groove::row_histories::StoredRowBatch {
				row_id: groove::ObjectId::new(),
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
				metadata: groove::row_histories::RowMetadata::from_entries(vec![(
					groove::metadata::MetadataKey::Table.as_str().to_string(),
					"messages".to_string(),
				)]),
			},
		};
		assert!(spark_sync::p2p_forward_drop_is_bootstrap_hold(&payload));
		assert!(!spark_sync::p2p_forward_drop_is_permanent(&payload));
	}
}

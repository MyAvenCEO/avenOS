//! Wrap [`groove::PeerTransport`] so outbound sync never leaks blocked tables and only
//! forwards spark-scoped data to DIDs that are biscuit admins for that spark.
//!
//! Table classification + row-batch resolution live in [`crate::spark_sync`] (manifest-driven).

use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use groove::sync_manager::{ClientId, InboxEntry, Source, SyncPayload};
use groove::{PeerTransport, Result as GrooveResult};

use crate::spark_acc;
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
	if payload.is_catalogue() {
		return true;
	}
	let guard = acl.read().expect("acl");
	let Some(snap) = guard.as_ref() else {
		return false;
	};
	let Some(tbl) = spark_sync::resolve_table_for_acl(snap, payload) else {
		return false;
	};
	if spark_sync::P2P_BLOCKED_TABLES.contains(&tbl.as_str()) {
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
	let object_id = row.row_id;
	let Some(spark) = spark_sync::resolve_spark_uuid(snap, &tbl, row, object_id) else {
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
			let log_line = format!(
				"drop outbound peer={peer:?} did={dest_did} variant={variant} table={tbl:?}",
			);
			if tbl.as_deref().is_some_and(spark_sync::is_p2p_sync_diag_table) {
				log::info!(target: "avenos::peer_sync_gate", "{log_line}");
			} else {
				log::debug!(target: "avenos::peer_sync_gate", "{log_line}");
			}
			return Ok(());
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

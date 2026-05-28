//! Single source of truth for peer link phase — only `MuxReady` counts as connected for sync/UI.

#![cfg(any(target_os = "macos", target_os = "ios"))]

use std::collections::{HashMap, HashSet};

use groove::sync_manager::ClientId;
use tokio::sync::RwLock;

use crate::peer_connect_ui::PeerTransportMode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkPhase {
	Handshaking,
	MuxReady,
}

#[derive(Debug, Clone)]
pub struct LiveLink {
	pub phase: LinkPhase,
	pub client_id: ClientId,
	pub remote_did: String,
	pub transport_mode: Option<PeerTransportMode>,
	pub since_ms: u64,
}

#[derive(Default)]
pub struct LiveLinkRegistry {
	by_pk: RwLock<HashMap<[u8; 32], LiveLink>>,
}

fn now_ms() -> u64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as u64)
		.unwrap_or(0)
}

impl LiveLinkRegistry {
	pub fn new() -> Self {
		Self::default()
	}

	pub async fn clear_all(&self) {
		self.by_pk.write().await.clear();
	}

	pub async fn clear(&self, pk: &[u8; 32]) {
		self.by_pk.write().await.remove(pk);
	}

	pub async fn set_handshaking(
		&self,
		pk: [u8; 32],
		client_id: ClientId,
		remote_did: String,
	) {
		self.by_pk.write().await.insert(
			pk,
			LiveLink {
				phase: LinkPhase::Handshaking,
				client_id,
				remote_did,
				transport_mode: None,
				since_ms: now_ms(),
			},
		);
	}

	pub async fn set_mux_ready(
		&self,
		pk: [u8; 32],
		transport_mode: Option<PeerTransportMode>,
	) {
		if let Some(link) = self.by_pk.write().await.get_mut(&pk) {
			link.phase = LinkPhase::MuxReady;
			link.transport_mode = transport_mode;
			link.since_ms = now_ms();
		}
	}

	pub async fn demote_to_handshaking(&self, pk: [u8; 32]) {
		if let Some(link) = self.by_pk.write().await.get_mut(&pk) {
			link.phase = LinkPhase::Handshaking;
			link.since_ms = now_ms();
		}
	}

	pub async fn is_handshaking_by_pk(&self, pk: &[u8; 32]) -> bool {
		self.by_pk
			.read()
			.await
			.get(pk)
			.is_some_and(|l| l.phase == LinkPhase::Handshaking)
	}

	pub async fn is_mux_ready_by_pk(&self, pk: &[u8; 32]) -> bool {
		self.by_pk
			.read()
			.await
			.get(pk)
			.is_some_and(|l| l.phase == LinkPhase::MuxReady)
	}

	pub async fn transport_mode_for_pk(&self, pk: &[u8; 32]) -> Option<PeerTransportMode> {
		self.by_pk
			.read()
			.await
			.get(pk)
			.map(|l| l.transport_mode)
			.flatten()
	}

	pub async fn mux_ready_count(&self) -> usize {
		self.by_pk
			.read()
			.await
			.values()
			.filter(|l| l.phase == LinkPhase::MuxReady)
			.count()
	}

	pub async fn handshaking_count(&self) -> usize {
		self.by_pk
			.read()
			.await
			.values()
			.filter(|l| l.phase == LinkPhase::Handshaking)
			.count()
	}

	/// DIDs with an in-flight or live link (Handshaking or MuxReady).
	pub async fn snapshot_all_dids(&self) -> HashSet<String> {
		self.by_pk
			.read()
			.await
			.values()
			.map(|l| l.remote_did.clone())
			.collect()
	}

	pub async fn snapshot_mux_ready_dids(&self) -> HashSet<String> {
		self.by_pk
			.read()
			.await
			.values()
			.filter(|l| l.phase == LinkPhase::MuxReady)
			.map(|l| l.remote_did.clone())
			.collect()
	}

	pub async fn snapshot_mux_ready_clients(&self) -> Vec<ClientId> {
		self.by_pk
			.read()
			.await
			.values()
			.filter(|l| l.phase == LinkPhase::MuxReady)
			.map(|l| l.client_id)
			.collect()
	}

	pub async fn is_mux_ready_by_did(&self, did: &str) -> bool {
		self.by_pk
			.read()
			.await
			.values()
			.any(|l| l.phase == LinkPhase::MuxReady && l.remote_did == did)
	}

	pub async fn is_mux_ready_by_client(&self, client: ClientId) -> bool {
		self.by_pk
			.read()
			.await
			.values()
			.any(|l| l.phase == LinkPhase::MuxReady && l.client_id == client)
	}

	pub async fn client_id_for_did(&self, did: &str) -> Option<ClientId> {
		self.by_pk
			.read()
			.await
			.values()
			.find(|l| l.phase == LinkPhase::MuxReady && l.remote_did == did)
			.map(|l| l.client_id)
	}

	pub async fn pk_for_client(&self, client: ClientId) -> Option<[u8; 32]> {
		self.by_pk
			.read()
			.await
			.iter()
			.find(|(_, l)| l.client_id == client)
			.map(|(pk, _)| *pk)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[tokio::test]
	async fn pairing_reset_clears_stale_links() {
		let reg = LiveLinkRegistry::new();
		let pk = [1u8; 32];
		let cid = ClientId(uuid::Uuid::new_v4());
		reg.set_handshaking(pk, cid, "did:key:z6Mktest".into())
			.await;
		reg.set_mux_ready(pk, None).await;
		assert_eq!(reg.mux_ready_count().await, 1);
		reg.clear_all().await;
		assert_eq!(reg.mux_ready_count().await, 0);
	}

	#[tokio::test]
	async fn handshaking_not_counted_as_linked() {
		let reg = LiveLinkRegistry::new();
		let pk = [2u8; 32];
		let cid = ClientId(uuid::Uuid::new_v4());
		reg.set_handshaking(pk, cid, "did:key:z6Mkother".into())
			.await;
		assert_eq!(reg.mux_ready_count().await, 0);
		assert_eq!(reg.handshaking_count().await, 1);
		assert_eq!(
			reg.snapshot_all_dids().await,
			HashSet::from(["did:key:z6Mkother".to_string()])
		);
		reg.set_mux_ready(pk, None).await;
		assert_eq!(reg.mux_ready_count().await, 1);
		assert_eq!(reg.handshaking_count().await, 0);
		assert!(reg.is_mux_ready_by_client(cid).await);
	}

	#[tokio::test]
	async fn demote_mux_ready_back_to_handshaking() {
		let reg = LiveLinkRegistry::new();
		let pk = [3u8; 32];
		let cid = ClientId(uuid::Uuid::new_v4());
		reg.set_handshaking(pk, cid, "did:key:z6Mkdemote".into())
			.await;
		reg.set_mux_ready(pk, Some(PeerTransportMode::Relay)).await;
		assert_eq!(reg.mux_ready_count().await, 1);
		reg.demote_to_handshaking(pk).await;
		assert_eq!(reg.mux_ready_count().await, 0);
		assert_eq!(reg.handshaking_count().await, 1);
		assert!(!reg.is_mux_ready_by_pk(&pk).await);
		assert_eq!(
			reg.transport_mode_for_pk(&pk).await,
			Some(PeerTransportMode::Relay)
		);
	}
}

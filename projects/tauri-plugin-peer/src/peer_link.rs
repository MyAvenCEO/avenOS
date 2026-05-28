//! Single owner per remote static key — phase, transport suppress gate, and UI/sync authority.

#![cfg(any(target_os = "macos", target_os = "ios"))]

use std::collections::{HashMap, HashSet};
use std::sync::RwLock as StdRwLock;

use groove::sync_manager::ClientId;
use serde::Serialize;
use tokio::sync::RwLock;

use crate::peer_connect_ui::PeerTransportMode;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PeerLinkPhase {
	Idle,
	Discovering,
	TransportUp,
	Handshaking,
	Live,
	Backoff,
}

/// Back-compat alias used by older call sites.
#[allow(dead_code)]
pub type LinkPhase = PeerLinkPhase;

impl PeerLinkPhase {
	pub fn suppresses_transport(self) -> bool {
		matches!(
			self,
			PeerLinkPhase::TransportUp | PeerLinkPhase::Handshaking | PeerLinkPhase::Live
		)
	}

	pub fn counts_as_in_flight(self) -> bool {
		self.suppresses_transport()
	}

	pub fn counts_as_linked_for_sync(self) -> bool {
		matches!(self, PeerLinkPhase::Live)
	}
}

#[derive(Debug, Clone)]
pub struct PeerLinkEntry {
	pub phase: PeerLinkPhase,
	pub client_id: ClientId,
	pub remote_did: String,
	pub transport_mode: Option<PeerTransportMode>,
	pub since_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerLinkMeshRow {
	pub remote_did: String,
	pub phase: PeerLinkPhase,
	pub transport_mode: Option<PeerTransportMode>,
}

pub struct PeerLinkCoordinator {
	by_pk: RwLock<HashMap<[u8; 32], PeerLinkEntry>>,
	/// Sync-readable snapshot for peeroxide `should_suppress_transport`.
	suppress_pks: StdRwLock<HashSet<[u8; 32]>>,
}

pub type LiveLinkRegistry = PeerLinkCoordinator;

#[allow(dead_code)]
pub type LiveLink = PeerLinkEntry;

fn now_ms() -> u64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as u64)
		.unwrap_or(0)
}

fn refresh_suppress_snapshot(by_pk: &HashMap<[u8; 32], PeerLinkEntry>, out: &StdRwLock<HashSet<[u8; 32]>>) {
	let set: HashSet<[u8; 32]> = by_pk
		.iter()
		.filter(|(_, e)| e.phase.suppresses_transport())
		.map(|(pk, _)| *pk)
		.collect();
	if let Ok(mut w) = out.write() {
		*w = set;
	}
}

impl Default for PeerLinkCoordinator {
	fn default() -> Self {
		Self {
			by_pk: RwLock::new(HashMap::new()),
			suppress_pks: StdRwLock::new(HashSet::new()),
		}
	}
}

impl PeerLinkCoordinator {
	pub fn new() -> Self {
		Self::default()
	}

	pub fn should_suppress_transport_sync(&self, pk: &[u8; 32]) -> bool {
		self.suppress_pks
			.read()
			.ok()
			.is_some_and(|s| s.contains(pk))
	}

	pub async fn clear_all(&self) {
		let mut guard = self.by_pk.write().await;
		guard.clear();
		refresh_suppress_snapshot(&guard, &self.suppress_pks);
	}

	pub async fn clear(&self, pk: &[u8; 32]) {
		let mut guard = self.by_pk.write().await;
		guard.remove(pk);
		refresh_suppress_snapshot(&guard, &self.suppress_pks);
	}

	async fn upsert(
		&self,
		pk: [u8; 32],
		phase: PeerLinkPhase,
		client_id: ClientId,
		remote_did: String,
		transport_mode: Option<PeerTransportMode>,
	) {
		let mut guard = self.by_pk.write().await;
		let entry = guard.entry(pk).or_insert_with(|| PeerLinkEntry {
			phase,
			client_id,
			remote_did: remote_did.clone(),
			transport_mode: None,
			since_ms: now_ms(),
		});
		entry.phase = phase;
		entry.client_id = client_id;
		entry.remote_did = remote_did;
		if let Some(mode) = transport_mode {
			entry.transport_mode = Some(mode);
		}
		entry.since_ms = now_ms();
		refresh_suppress_snapshot(&guard, &self.suppress_pks);
	}

	pub async fn set_discovering(&self, pk: [u8; 32], client_id: ClientId, remote_did: String) {
		self.upsert(
			pk,
			PeerLinkPhase::Discovering,
			client_id,
			remote_did,
			None,
		)
		.await;
	}

	pub async fn set_transport_up(&self, pk: [u8; 32], client_id: ClientId, remote_did: String) {
		self.upsert(
			pk,
			PeerLinkPhase::TransportUp,
			client_id,
			remote_did,
			None,
		)
		.await;
	}

	pub async fn set_handshaking(
		&self,
		pk: [u8; 32],
		client_id: ClientId,
		remote_did: String,
	) {
		self.upsert(
			pk,
			PeerLinkPhase::Handshaking,
			client_id,
			remote_did,
			None,
		)
		.await;
	}

	pub async fn set_mux_ready(
		&self,
		pk: [u8; 32],
		transport_mode: Option<PeerTransportMode>,
	) {
		let mut guard = self.by_pk.write().await;
		if let Some(link) = guard.get_mut(&pk) {
			link.phase = PeerLinkPhase::Live;
			link.transport_mode = transport_mode;
			link.since_ms = now_ms();
		}
		refresh_suppress_snapshot(&guard, &self.suppress_pks);
	}

	pub async fn set_backoff(&self, pk: [u8; 32]) {
		let mut guard = self.by_pk.write().await;
		if let Some(link) = guard.get_mut(&pk) {
			link.phase = PeerLinkPhase::Backoff;
			link.since_ms = now_ms();
		}
		refresh_suppress_snapshot(&guard, &self.suppress_pks);
	}

	pub async fn demote_to_handshaking(&self, pk: [u8; 32]) {
		let mut guard = self.by_pk.write().await;
		if let Some(link) = guard.get_mut(&pk) {
			link.phase = PeerLinkPhase::Handshaking;
			link.since_ms = now_ms();
		}
		refresh_suppress_snapshot(&guard, &self.suppress_pks);
	}

	pub async fn phase_for_pk(&self, pk: &[u8; 32]) -> Option<PeerLinkPhase> {
		self.by_pk.read().await.get(pk).map(|l| l.phase)
	}

	pub async fn phase_for_did(&self, did: &str) -> Option<PeerLinkPhase> {
		self.by_pk
			.read()
			.await
			.values()
			.find(|l| l.remote_did == did)
			.map(|l| l.phase)
	}

	pub async fn is_handshaking_by_pk(&self, pk: &[u8; 32]) -> bool {
		self.phase_for_pk(pk)
			.await
			.is_some_and(|p| p == PeerLinkPhase::Handshaking)
	}

	pub async fn is_mux_ready_by_pk(&self, pk: &[u8; 32]) -> bool {
		self.phase_for_pk(pk)
			.await
			.is_some_and(PeerLinkPhase::counts_as_linked_for_sync)
	}

	pub async fn transport_mode_for_pk(&self, pk: &[u8; 32]) -> Option<PeerTransportMode> {
		self.by_pk
			.read()
			.await
			.get(pk)
			.and_then(|l| l.transport_mode)
	}

	pub async fn in_flight_count(&self) -> usize {
		self.by_pk
			.read()
			.await
			.values()
			.filter(|l| l.phase.counts_as_in_flight())
			.count()
	}

	pub async fn mux_ready_count(&self) -> usize {
		self.by_pk
			.read()
			.await
			.values()
			.filter(|l| l.phase.counts_as_linked_for_sync())
			.count()
	}

	pub async fn handshaking_count(&self) -> usize {
		self.by_pk
			.read()
			.await
			.values()
			.filter(|l| l.phase == PeerLinkPhase::Handshaking)
			.count()
	}

	pub async fn any_in_flight(&self) -> bool {
		self.in_flight_count().await > 0
	}

	pub async fn snapshot_all_dids(&self) -> HashSet<String> {
		self.by_pk
			.read()
			.await
			.values()
			.filter(|l| {
				matches!(
					l.phase,
					PeerLinkPhase::Discovering
						| PeerLinkPhase::TransportUp
						| PeerLinkPhase::Handshaking
						| PeerLinkPhase::Live
				)
			})
			.map(|l| l.remote_did.clone())
			.collect()
	}

	pub async fn snapshot_in_flight_dids(&self) -> HashSet<String> {
		self.by_pk
			.read()
			.await
			.values()
			.filter(|l| l.phase.counts_as_in_flight())
			.map(|l| l.remote_did.clone())
			.collect()
	}

	pub async fn snapshot_mux_ready_dids(&self) -> HashSet<String> {
		self.by_pk
			.read()
			.await
			.values()
			.filter(|l| l.phase.counts_as_linked_for_sync())
			.map(|l| l.remote_did.clone())
			.collect()
	}

	pub async fn snapshot_mux_ready_clients(&self) -> Vec<ClientId> {
		self.by_pk
			.read()
			.await
			.values()
			.filter(|l| l.phase.counts_as_linked_for_sync())
			.map(|l| l.client_id)
			.collect()
	}

	pub async fn snapshot_mesh_rows(&self) -> Vec<PeerLinkMeshRow> {
		self.by_pk
			.read()
			.await
			.values()
			.map(|l| PeerLinkMeshRow {
				remote_did: l.remote_did.clone(),
				phase: l.phase,
				transport_mode: l.transport_mode,
			})
			.collect()
	}

	pub async fn is_mux_ready_by_did(&self, did: &str) -> bool {
		self.phase_for_did(did)
			.await
			.is_some_and(PeerLinkPhase::counts_as_linked_for_sync)
	}

	pub async fn is_mux_ready_by_client(&self, client: ClientId) -> bool {
		self.by_pk
			.read()
			.await
			.values()
			.any(|l| l.phase.counts_as_linked_for_sync() && l.client_id == client)
	}

	pub async fn client_id_for_did(&self, did: &str) -> Option<ClientId> {
		self.by_pk
			.read()
			.await
			.values()
			.find(|l| l.phase.counts_as_linked_for_sync() && l.remote_did == did)
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
		let reg = PeerLinkCoordinator::new();
		let pk = [1u8; 32];
		let cid = ClientId(uuid::Uuid::new_v4());
		reg.set_handshaking(pk, cid, "did:key:z6Mktest".into())
			.await;
		reg.set_mux_ready(pk, None).await;
		assert_eq!(reg.mux_ready_count().await, 1);
		reg.clear_all().await;
		assert_eq!(reg.mux_ready_count().await, 0);
		assert!(!reg.should_suppress_transport_sync(&pk));
	}

	#[tokio::test]
	async fn handshaking_not_counted_as_linked() {
		let reg = PeerLinkCoordinator::new();
		let pk = [2u8; 32];
		let cid = ClientId(uuid::Uuid::new_v4());
		reg.set_handshaking(pk, cid, "did:key:z6Mkother".into())
			.await;
		assert_eq!(reg.mux_ready_count().await, 0);
		assert_eq!(reg.handshaking_count().await, 1);
		assert!(reg.should_suppress_transport_sync(&pk));
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
	async fn demote_live_back_to_handshaking() {
		let reg = PeerLinkCoordinator::new();
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
		assert!(reg.should_suppress_transport_sync(&pk));
		assert_eq!(
			reg.transport_mode_for_pk(&pk).await,
			Some(PeerTransportMode::Relay)
		);
	}

	#[tokio::test]
	async fn in_flight_includes_transport_up_and_handshaking() {
		let reg = PeerLinkCoordinator::new();
		let pk = [4u8; 32];
		let cid = ClientId(uuid::Uuid::new_v4());
		reg.set_transport_up(pk, cid, "did:key:z6Mktransport".into())
			.await;
		assert_eq!(reg.in_flight_count().await, 1);
		assert!(reg.should_suppress_transport_sync(&pk));
	}
}

//! Single owner per remote static key — phase, transport suppress gate, and UI/sync authority.

#![cfg(any(target_os = "macos", target_os = "ios"))]

use std::collections::{HashMap, HashSet};
use std::sync::RwLock as StdRwLock;

use groove::sync_manager::ClientId;
use serde::Serialize;

use crate::peer_connect_ui::PeerTransportMode;

type ByPkMap = HashMap<[u8; 32], PeerLinkEntry>;

fn read_by_pk(map: &StdRwLock<ByPkMap>) -> std::sync::RwLockReadGuard<'_, ByPkMap> {
	map.read().unwrap_or_else(|e| e.into_inner())
}

fn write_by_pk(map: &StdRwLock<ByPkMap>) -> std::sync::RwLockWriteGuard<'_, ByPkMap> {
	map.write().unwrap_or_else(|e| e.into_inner())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PeerLinkPhase {
	Idle,
	Discovering,
	/// peeroxide handshake / blind-relay in progress (before mux worker).
	SwarmConnecting,
	TransportUp,
	Handshaking,
	Live,
	Backoff,
}

impl PeerLinkPhase {
	pub fn counts_as_in_flight_with_worker(self, worker_active: bool) -> bool {
		match self {
			PeerLinkPhase::Live => true,
			PeerLinkPhase::Discovering | PeerLinkPhase::SwarmConnecting => true,
			PeerLinkPhase::TransportUp | PeerLinkPhase::Handshaking => worker_active,
			_ => false,
		}
	}

	pub fn counts_as_establishing_with_worker(self, worker_active: bool) -> bool {
		match self {
			PeerLinkPhase::Discovering | PeerLinkPhase::SwarmConnecting => true,
			PeerLinkPhase::TransportUp | PeerLinkPhase::Handshaking => worker_active,
			_ => false,
		}
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
	/// True while the bridge mux worker task is running for this pk.
	pub worker_active: bool,
	/// Reconnect attempts while in Backoff (relay-only steady reconcile).
	pub backoff_attempts: u32,
}

impl PeerLinkEntry {
	fn suppresses_transport(&self) -> bool {
		// Relay-only steady state: only live mux with active worker suppresses reconnect.
		self.phase == PeerLinkPhase::Live && self.worker_active
	}

	fn counts_as_in_flight(&self) -> bool {
		self.phase.counts_as_in_flight_with_worker(self.worker_active)
	}

	fn is_phantom(&self) -> bool {
		matches!(
			self.phase,
			PeerLinkPhase::TransportUp | PeerLinkPhase::Handshaking
		) && !self.worker_active
	}
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerLinkMeshRow {
	pub remote_did: String,
	pub phase: PeerLinkPhase,
	pub transport_mode: Option<PeerTransportMode>,
}

pub struct PeerLinkCoordinator {
	by_pk: StdRwLock<ByPkMap>,
	/// Sync-readable snapshot for peeroxide `should_suppress_transport`.
	suppress_pks: StdRwLock<HashSet<[u8; 32]>>,
}

fn now_ms() -> u64 {
	crate::peer_util::now_ms()
}

fn refresh_suppress_snapshot(
	by_pk: &HashMap<[u8; 32], PeerLinkEntry>,
	out: &StdRwLock<HashSet<[u8; 32]>>,
) {
	let set: HashSet<[u8; 32]> = by_pk
		.iter()
		.filter(|(_, e)| e.suppresses_transport())
		.map(|(pk, _)| *pk)
		.collect();
	if let Ok(mut w) = out.write() {
		*w = set;
	}
}

impl Default for PeerLinkCoordinator {
	fn default() -> Self {
		Self {
			by_pk: StdRwLock::new(HashMap::new()),
			suppress_pks: StdRwLock::new(HashSet::new()),
		}
	}
}

impl PeerLinkCoordinator {
	pub fn new() -> Self {
		Self::default()
	}

	fn refresh_suppress(&self, by_pk: &HashMap<[u8; 32], PeerLinkEntry>) {
		refresh_suppress_snapshot(by_pk, &self.suppress_pks);
	}

	/// Drop coordinator rows stuck in SwarmConnecting/Discovering longer than `max_age_ms`.
	pub async fn clear_stale_swarm_connecting(&self, max_age_ms: u64) {
		let now = now_ms();
		let mut guard = write_by_pk(&self.by_pk);
		guard.retain(|_, e| {
			if !matches!(
				e.phase,
				PeerLinkPhase::Discovering | PeerLinkPhase::SwarmConnecting
			) {
				return true;
			}
			now.saturating_sub(e.since_ms) <= max_age_ms
		});
		self.refresh_suppress(&guard);
	}

	pub fn should_suppress_transport_sync(&self, pk: &[u8; 32]) -> bool {
		self.suppress_pks
			.read()
			.ok()
			.is_some_and(|s| s.contains(pk))
	}

	pub async fn clear_all(&self) {
		let mut guard = write_by_pk(&self.by_pk);
		guard.clear();
		self.refresh_suppress(&guard);
	}

	pub async fn clear(&self, pk: &[u8; 32]) {
		let mut guard = write_by_pk(&self.by_pk);
		guard.remove(pk);
		self.refresh_suppress(&guard);
	}

	async fn upsert(
		&self,
		pk: [u8; 32],
		phase: PeerLinkPhase,
		client_id: ClientId,
		remote_did: String,
		transport_mode: Option<PeerTransportMode>,
	) {
		let mut guard = write_by_pk(&self.by_pk);
		let entry = guard.entry(pk).or_insert_with(|| PeerLinkEntry {
			phase,
			client_id,
			remote_did: remote_did.clone(),
			transport_mode: None,
			since_ms: now_ms(),
			worker_active: false,
			backoff_attempts: 0,
		});
		entry.phase = phase;
		entry.client_id = client_id;
		entry.remote_did = remote_did;
		if let Some(mode) = transport_mode {
			entry.transport_mode = Some(mode);
		}
		entry.since_ms = now_ms();
		self.refresh_suppress(&guard);
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

	pub async fn set_swarm_connecting(&self, pk: [u8; 32], remote_did: String) {
		let cid = crate::peer_util::client_id_from_pubkey(&pk);
		self.upsert(
			pk,
			PeerLinkPhase::SwarmConnecting,
			cid,
			remote_did,
			None,
		)
		.await;
	}

	pub async fn set_swarm_connecting_by_pk(&self, pk: [u8; 32]) {
		let Ok(did) = crate::did::peer_did_from_ed25519(&pk) else {
			return;
		};
		self.set_swarm_connecting(pk, did).await;
	}

	pub async fn clear_swarm_connecting(&self, pk: &[u8; 32]) {
		let mut guard = write_by_pk(&self.by_pk);
		if let Some(link) = guard.get(pk) {
			if matches!(
				link.phase,
				PeerLinkPhase::Discovering | PeerLinkPhase::SwarmConnecting
			) {
				guard.remove(pk);
			}
		}
		self.refresh_suppress(&guard);
	}

	/// Sync connect-ui hook path — avoids spawned mirror tasks.
	pub fn note_connect_progress(&self, pk: [u8; 32], phase: aven_p2p::dht::connect_ui::ConnectProgressPhase) {
		use aven_p2p::dht::connect_ui::ConnectProgressPhase;
		let mut guard = write_by_pk(&self.by_pk);
		match phase {
			ConnectProgressPhase::Discovering => {
				let Ok(did) = crate::did::peer_did_from_ed25519(&pk) else {
					return;
				};
				let cid = crate::peer_util::client_id_from_pubkey(&pk);
				let entry = guard.entry(pk).or_insert_with(|| PeerLinkEntry {
					phase: PeerLinkPhase::Discovering,
					client_id: cid,
					remote_did: did.clone(),
					transport_mode: None,
					since_ms: now_ms(),
					worker_active: false,
					backoff_attempts: 0,
				});
				entry.phase = PeerLinkPhase::Discovering;
				entry.client_id = cid;
				entry.remote_did = did;
				entry.since_ms = now_ms();
			}
			ConnectProgressPhase::Handshaking | ConnectProgressPhase::RelayPairing => {
				let Ok(did) = crate::did::peer_did_from_ed25519(&pk) else {
					return;
				};
				let cid = crate::peer_util::client_id_from_pubkey(&pk);
				let entry = guard.entry(pk).or_insert_with(|| PeerLinkEntry {
					phase: PeerLinkPhase::SwarmConnecting,
					client_id: cid,
					remote_did: did.clone(),
					transport_mode: None,
					since_ms: now_ms(),
					worker_active: false,
					backoff_attempts: 0,
				});
				entry.phase = PeerLinkPhase::SwarmConnecting;
				entry.client_id = cid;
				entry.remote_did = did;
				entry.since_ms = now_ms();
			}
		}
		self.refresh_suppress(&guard);
	}

	pub fn clear_swarm_connecting_blocking(&self, pk: &[u8; 32]) {
		let mut guard = write_by_pk(&self.by_pk);
		if let Some(link) = guard.get(pk) {
			if matches!(
				link.phase,
				PeerLinkPhase::Discovering | PeerLinkPhase::SwarmConnecting
			) {
				guard.remove(pk);
			}
		}
		self.refresh_suppress(&guard);
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
		let mut guard = write_by_pk(&self.by_pk);
		if let Some(link) = guard.get_mut(&pk) {
			link.phase = PeerLinkPhase::Live;
			link.transport_mode = transport_mode;
			link.backoff_attempts = 0;
			link.since_ms = now_ms();
		}
		self.refresh_suppress(&guard);
	}

	pub async fn set_backoff(&self, pk: [u8; 32]) {
		let mut guard = write_by_pk(&self.by_pk);
		if let Some(link) = guard.get_mut(&pk) {
			link.phase = PeerLinkPhase::Backoff;
			link.worker_active = false;
			link.backoff_attempts = link.backoff_attempts.saturating_add(1);
			link.since_ms = now_ms();
		}
		self.refresh_suppress(&guard);
	}

	/// DIDs eligible for relay-only reconnect (not Live, backoff expired, not establishing).
	pub async fn filter_reconnect_ready(&self, targets: &[String]) -> Vec<String> {
		let live = self.snapshot_mux_ready_dids().await;
		let establishing = self.snapshot_establishing_dids().await;
		let entries: Vec<PeerLinkEntry> = read_by_pk(&self.by_pk).values().cloned().collect();
		let now = now_ms();
		targets
			.iter()
			.filter(|did| {
				if live.contains(did.as_str()) || establishing.contains(did.as_str()) {
					return false;
				}
				let Some(entry) = entries.iter().find(|e| e.remote_did == **did) else {
					return true;
				};
				if entry.phase != PeerLinkPhase::Backoff {
					return true;
				}
				let delay = crate::transport::relay_backoff_delay_ms(entry.backoff_attempts);
				now.saturating_sub(entry.since_ms) >= delay
			})
			.cloned()
			.collect()
	}

	pub async fn reset_backoff(&self, pk: &[u8; 32]) {
		let mut guard = write_by_pk(&self.by_pk);
		if let Some(link) = guard.get_mut(pk) {
			link.backoff_attempts = 0;
		}
	}

	pub async fn set_worker_active(&self, pk: [u8; 32], active: bool) {
		let mut guard = write_by_pk(&self.by_pk);
		if let Some(link) = guard.get_mut(&pk) {
			link.worker_active = active;
			link.since_ms = now_ms();
		}
		self.refresh_suppress(&guard);
	}

	/// Drop coordinator rows stuck in TransportUp/Handshaking with no running mux worker.
	pub async fn clear_phantom_entries(&self) {
		let mut guard = write_by_pk(&self.by_pk);
		guard.retain(|_, e| !e.is_phantom());
		self.refresh_suppress(&guard);
	}

	pub async fn demote_to_handshaking(&self, pk: [u8; 32]) {
		let mut guard = write_by_pk(&self.by_pk);
		if let Some(link) = guard.get_mut(&pk) {
			link.phase = PeerLinkPhase::Handshaking;
			link.worker_active = false;
			link.since_ms = now_ms();
		}
		self.refresh_suppress(&guard);
	}

	pub async fn phase_for_pk(&self, pk: &[u8; 32]) -> Option<PeerLinkPhase> {
		read_by_pk(&self.by_pk).get(pk).map(|l| l.phase)
	}

	pub async fn phase_for_did(&self, did: &str) -> Option<PeerLinkPhase> {
		read_by_pk(&self.by_pk)
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
		read_by_pk(&self.by_pk)
			.get(pk)
			.and_then(|l| l.transport_mode)
	}

	pub async fn in_flight_count(&self) -> usize {
		read_by_pk(&self.by_pk)
			.values()
			.filter(|l| l.counts_as_in_flight())
			.count()
	}

	pub async fn phantom_count(&self) -> usize {
		read_by_pk(&self.by_pk)
			.values()
			.filter(|l| l.is_phantom())
			.count()
	}

	pub async fn mux_ready_count(&self) -> usize {
		read_by_pk(&self.by_pk)
			.values()
			.filter(|l| l.phase.counts_as_linked_for_sync())
			.count()
	}

	pub async fn handshaking_count(&self) -> usize {
		read_by_pk(&self.by_pk)
			.values()
			.filter(|l| l.phase == PeerLinkPhase::Handshaking)
			.count()
	}

	pub async fn any_in_flight(&self) -> bool {
		self.in_flight_count().await > 0
	}

	pub async fn establishing_count(&self) -> usize {
		read_by_pk(&self.by_pk)
			.values()
			.filter(|l| l.phase.counts_as_establishing_with_worker(l.worker_active))
			.count()
	}

	pub async fn any_establishing_or_live(&self) -> bool {
		read_by_pk(&self.by_pk)
			.values()
			.any(|l| {
				l.phase.counts_as_linked_for_sync()
					|| l.phase.counts_as_establishing_with_worker(l.worker_active)
			})
	}

	/// Single predicate for global `prepare_reconnect` / worker abort authorization.
	pub async fn may_global_reset(&self) -> bool {
		!self.any_establishing_or_live().await
	}

	pub async fn snapshot_establishing_dids(&self) -> HashSet<String> {
		read_by_pk(&self.by_pk)
			.values()
			.filter(|l| l.phase.counts_as_establishing_with_worker(l.worker_active))
			.map(|l| l.remote_did.clone())
			.collect()
	}

	pub async fn all_allowlisted_live_or_establishing(
		&self,
		allowlist: &[String],
	) -> bool {
		if allowlist.is_empty() {
			return true;
		}
		let live = self.snapshot_mux_ready_dids().await;
		let establishing = self.snapshot_establishing_dids().await;
		allowlist
			.iter()
			.all(|d| live.contains(d) || establishing.contains(d))
	}

	pub async fn register_worker(&self, pk: [u8; 32], client_id: ClientId) {
		let mut guard = write_by_pk(&self.by_pk);
		if let Some(link) = guard.get_mut(&pk) {
			link.client_id = client_id;
			link.worker_active = true;
			link.since_ms = now_ms();
		}
		self.refresh_suppress(&guard);
	}

	pub async fn unregister_worker(&self, pk: &[u8; 32]) {
		let mut guard = write_by_pk(&self.by_pk);
		if let Some(link) = guard.get_mut(pk) {
			link.worker_active = false;
			link.since_ms = now_ms();
		}
		self.refresh_suppress(&guard);
	}

	pub async fn snapshot_all_dids(&self) -> HashSet<String> {
		read_by_pk(&self.by_pk)
			.values()
			.filter(|l| {
				matches!(
					l.phase,
					PeerLinkPhase::Discovering
						| PeerLinkPhase::SwarmConnecting
						| PeerLinkPhase::TransportUp
						| PeerLinkPhase::Handshaking
						| PeerLinkPhase::Live
				)
			})
			.map(|l| l.remote_did.clone())
			.collect()
	}

	pub async fn snapshot_in_flight_dids(&self) -> HashSet<String> {
		read_by_pk(&self.by_pk)
			.values()
			.filter(|l| l.counts_as_in_flight())
			.map(|l| l.remote_did.clone())
			.collect()
	}

	/// Peers with an active mux worker still handshaking (not yet Live).
	pub async fn snapshot_connecting_dids(&self) -> HashSet<String> {
		read_by_pk(&self.by_pk)
			.values()
			.filter(|l| {
				l.worker_active
					&& matches!(
						l.phase,
						PeerLinkPhase::TransportUp | PeerLinkPhase::Handshaking
					)
			})
			.map(|l| l.remote_did.clone())
			.collect()
	}

	pub async fn snapshot_mux_ready_dids(&self) -> HashSet<String> {
		read_by_pk(&self.by_pk)
			.values()
			.filter(|l| l.phase.counts_as_linked_for_sync())
			.map(|l| l.remote_did.clone())
			.collect()
	}

	pub async fn snapshot_mux_ready_clients(&self) -> Vec<ClientId> {
		read_by_pk(&self.by_pk)
			.values()
			.filter(|l| l.phase.counts_as_linked_for_sync())
			.map(|l| l.client_id)
			.collect()
	}

	/// Live mux coordinator rows — `(client_id, static_pk, since_ms)`.
	pub async fn snapshot_mux_live_entries(&self) -> Vec<(ClientId, [u8; 32], u64)> {
		read_by_pk(&self.by_pk)
			.iter()
			.filter(|(_, l)| l.phase.counts_as_linked_for_sync())
			.map(|(pk, l)| (l.client_id, *pk, l.since_ms))
			.collect()
	}


	pub async fn snapshot_mesh_rows(&self) -> Vec<PeerLinkMeshRow> {
		read_by_pk(&self.by_pk)
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
		read_by_pk(&self.by_pk)
			.values()
			.any(|l| l.phase.counts_as_linked_for_sync() && l.client_id == client)
	}

	pub async fn client_id_for_did(&self, did: &str) -> Option<ClientId> {
		read_by_pk(&self.by_pk)
			.values()
			.find(|l| l.phase.counts_as_linked_for_sync() && l.remote_did == did)
			.map(|l| l.client_id)
	}

	pub async fn snapshot_non_live_entries(&self) -> Vec<(ClientId, [u8; 32])> {
		read_by_pk(&self.by_pk)
			.iter()
			.filter(|(_, e)| !e.phase.counts_as_linked_for_sync())
			.map(|(pk, e)| (e.client_id, *pk))
			.collect()
	}

	pub async fn pk_for_client(&self, client: ClientId) -> Option<[u8; 32]> {
		read_by_pk(&self.by_pk)
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
		assert!(!reg.should_suppress_transport_sync(&pk));
		reg.set_worker_active(pk, true).await;
		assert!(!reg.should_suppress_transport_sync(&pk));
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
	async fn phantom_handshaking_cleared_and_does_not_suppress() {
		let reg = PeerLinkCoordinator::new();
		let pk = [5u8; 32];
		let cid = ClientId(uuid::Uuid::new_v4());
		reg.set_handshaking(pk, cid, "did:key:z6Mkphantom".into())
			.await;
		assert_eq!(reg.phantom_count().await, 1);
		reg.clear_phantom_entries().await;
		assert!(reg.phase_for_pk(&pk).await.is_none());
		assert!(!reg.should_suppress_transport_sync(&pk));
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
		assert!(!reg.should_suppress_transport_sync(&pk));
		reg.set_worker_active(pk, true).await;
		assert!(!reg.should_suppress_transport_sync(&pk));
		assert_eq!(
			reg.transport_mode_for_pk(&pk).await,
			Some(PeerTransportMode::Relay)
		);
	}

	#[tokio::test]
	async fn swarm_connecting_blocks_global_reset() {
		let reg = PeerLinkCoordinator::new();
		let pk = [9u8; 32];
		reg.set_swarm_connecting(pk, "did:key:z6Mkswarm".into())
			.await;
		assert!(!reg.should_suppress_transport_sync(&pk));
		assert_eq!(reg.establishing_count().await, 1);
		assert!(!reg.may_global_reset().await);
		reg.clear_swarm_connecting(&pk).await;
		assert!(reg.may_global_reset().await);
	}

	#[tokio::test]
	async fn relay_only_live_suppresses() {
		let reg = PeerLinkCoordinator::new();
		let pk = [10u8; 32];
		let cid = ClientId(uuid::Uuid::new_v4());
		reg.set_swarm_connecting(pk, "did:key:z6Mkpair".into())
			.await;
		assert!(!reg.should_suppress_transport_sync(&pk));
		reg.set_handshaking(pk, cid, "did:key:z6Mkpair".into())
			.await;
		reg.set_worker_active(pk, true).await;
		assert!(!reg.should_suppress_transport_sync(&pk));
		reg.set_mux_ready(pk, None).await;
		assert!(reg.should_suppress_transport_sync(&pk));
		reg.set_worker_active(pk, false).await;
		assert!(!reg.should_suppress_transport_sync(&pk));
	}

	#[tokio::test]
	async fn in_flight_requires_active_worker() {
		let reg = PeerLinkCoordinator::new();
		let pk = [4u8; 32];
		let cid = ClientId(uuid::Uuid::new_v4());
		reg.set_transport_up(pk, cid, "did:key:z6Mktransport".into())
			.await;
		assert_eq!(reg.in_flight_count().await, 0);
		reg.set_worker_active(pk, true).await;
		assert_eq!(reg.in_flight_count().await, 1);
		assert!(!reg.should_suppress_transport_sync(&pk));
	}

	#[tokio::test]
	async fn note_connect_progress_from_swarm_hook_path() {
		use aven_p2p::dht::connect_ui::ConnectProgressPhase;

		let reg = PeerLinkCoordinator::new();
		let pk = [9u8; 32];
		reg.note_connect_progress(pk, ConnectProgressPhase::Discovering);
		assert_eq!(reg.phase_for_pk(&pk).await, Some(PeerLinkPhase::Discovering));
		assert!(!reg.should_suppress_transport_sync(&pk));
	}
}

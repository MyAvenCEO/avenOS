//! Per-peer connect sub-states and established transport mode for mesh UI.

use std::collections::HashMap;
use std::sync::{Arc, RwLock, Weak};

use aven_p2p::dht::connect_ui::{
	ConnectProgressPhase, ConnectTransportMode, ConnectUiEvent, ConnectUiHook,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PeerConnectSubstate {
	Discovering,
	Handshaking,
	RelayPairing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PeerTransportMode {
	Lan,
	Direct,
	Punched,
	Relay,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerConnectUiRow {
	#[serde(skip_serializing_if = "Option::is_none")]
	pub connect_substate: Option<PeerConnectSubstate>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub transport_mode: Option<PeerTransportMode>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub reconnect_attempt: Option<u32>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub last_disconnect_at_ms: Option<u64>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub last_disconnect_reason: Option<String>,
}

#[derive(Default)]
struct Row {
	connect_substate: Option<PeerConnectSubstate>,
	transport_mode: Option<PeerTransportMode>,
	reconnect_attempt: u32,
	last_disconnect_at_ms: Option<u64>,
	last_disconnect_reason: Option<String>,
}

fn now_ms() -> u64 {
	crate::peer_util::now_ms()
}

pub struct PeerConnectUiTracker {
	by_did: RwLock<HashMap<String, Row>>,
	on_change: Option<Arc<dyn Fn() + Send + Sync>>,
	coordinator: RwLock<Option<Weak<crate::peer_link::PeerLinkCoordinator>>>,
	last_path_change_at_ms: RwLock<Option<u64>>,
	last_foreground_heal_at_ms: RwLock<Option<u64>>,
	heal_in_progress: RwLock<bool>,
}

impl PeerConnectUiTracker {
	pub fn new(on_change: Option<Arc<dyn Fn() + Send + Sync>>) -> Self {
		Self {
			by_did: RwLock::new(HashMap::new()),
			on_change,
			coordinator: RwLock::new(None),
			last_path_change_at_ms: RwLock::new(None),
			last_foreground_heal_at_ms: RwLock::new(None),
			heal_in_progress: RwLock::new(false),
		}
	}

	pub fn attach_coordinator(&self, coord: Arc<crate::peer_link::PeerLinkCoordinator>) {
		*self.coordinator.write().expect("coord attach poisoned") = Some(Arc::downgrade(&coord));
	}

	pub fn hook(self: &Arc<Self>) -> ConnectUiHook {
		let weak = Arc::downgrade(self);
		Arc::new(move |event| {
			let Some(tracker) = weak.upgrade() else {
				return;
			};
			tracker.apply(event);
		})
	}

	fn apply(&self, event: ConnectUiEvent) {
		let (did, remote_pk) = match &event {
			ConnectUiEvent::Progress { remote_pk, .. }
			| ConnectUiEvent::Connected { remote_pk, .. }
			| ConnectUiEvent::Disconnected { remote_pk } => {
				let Ok(d) = crate::did::peer_did_from_ed25519(remote_pk) else {
					return;
				};
				(d, *remote_pk)
			}
		};

		if let Some(coord) = self
			.coordinator
			.read()
			.ok()
			.and_then(|g| g.as_ref().and_then(Weak::upgrade))
		{
			match &event {
				ConnectUiEvent::Progress { phase, .. } => {
					coord.note_connect_progress(remote_pk, *phase);
				}
				ConnectUiEvent::Disconnected { .. } => {
					coord.clear_swarm_connecting_blocking(&remote_pk);
				}
				ConnectUiEvent::Connected { .. } => {
					// Keep SwarmConnecting until HyperswarmGrooveBridge handoff (set_transport_up).
				}
			}
		}

		let changed = {
			let mut map = self.by_did.write().expect("peer connect ui poisoned");
			let row = map.entry(did).or_default();
			match event {
				ConnectUiEvent::Progress { phase, .. } => {
					let next = Some(map_progress(phase));
					if row.connect_substate == next {
						false
					} else {
						row.connect_substate = next;
						true
					}
				}
				ConnectUiEvent::Connected { mode, .. } => {
					let next_mode = Some(map_mode(mode));
					if row.connect_substate.is_none() && row.transport_mode == next_mode {
						false
					} else {
						row.connect_substate = None;
						row.transport_mode = next_mode;
						true
					}
				}
				ConnectUiEvent::Disconnected { .. } => {
					if row.connect_substate.is_none() && row.transport_mode.is_none() {
						false
					} else {
						row.connect_substate = None;
						row.transport_mode = None;
						true
					}
				}
			}
		};

		if changed {
			if let Some(cb) = &self.on_change {
				cb();
			}
		}
	}

	pub fn note_inbound_connected(&self, remote_pk: &[u8; 32], mode: Option<ConnectTransportMode>) {
		let Ok(did) = crate::did::peer_did_from_ed25519(remote_pk) else {
			return;
		};
		let changed = {
			let mut map = self.by_did.write().expect("peer connect ui poisoned");
			let row = map.entry(did).or_default();
			let next_mode = mode.map(map_mode);
			if row.connect_substate.is_none() && row.transport_mode == next_mode {
				false
			} else {
				row.connect_substate = None;
				row.transport_mode = next_mode;
				true
			}
		};
		if changed {
			if let Some(cb) = &self.on_change {
				cb();
			}
		}
	}

	pub fn note_disconnected_pk(&self, remote_pk: &[u8; 32]) {
		self.note_disconnected_pk_with_reason(remote_pk, "link_down");
	}

	pub fn note_disconnected_pk_with_reason(&self, remote_pk: &[u8; 32], reason: &str) {
		let Ok(did) = crate::did::peer_did_from_ed25519(remote_pk) else {
			return;
		};
		let changed = {
			let mut map = self.by_did.write().expect("peer connect ui poisoned");
			let row = map.entry(did).or_default();
			row.last_disconnect_at_ms = Some(now_ms());
			row.last_disconnect_reason = Some(reason.to_string());
			if row.connect_substate.is_none() && row.transport_mode.is_none() {
				true
			} else {
				row.connect_substate = None;
				row.transport_mode = None;
				true
			}
		};
		if changed {
			if let Some(cb) = &self.on_change {
				cb();
			}
		}
	}

	pub fn bump_reconnect_attempt(&self, did: &str) {
		let mut map = self.by_did.write().expect("peer connect ui poisoned");
		let row = map.entry(did.to_string()).or_default();
		row.reconnect_attempt = row.reconnect_attempt.saturating_add(1);
	}

	pub fn mark_path_change(&self) {
		*self
			.last_path_change_at_ms
			.write()
			.expect("path change poisoned") = Some(now_ms());
	}

	pub fn mark_foreground_heal(&self) {
		*self
			.last_foreground_heal_at_ms
			.write()
			.expect("foreground heal poisoned") = Some(now_ms());
	}

	pub fn set_heal_in_progress(&self, v: bool) {
		*self.heal_in_progress.write().expect("heal poisoned") = v;
	}

	pub fn global_heal_snapshot(&self) -> (Option<u64>, Option<u64>, bool) {
		(
			*self
				.last_path_change_at_ms
				.read()
				.expect("path change poisoned"),
			*self
				.last_foreground_heal_at_ms
				.read()
				.expect("foreground heal poisoned"),
			*self.heal_in_progress.read().expect("heal poisoned"),
		)
	}

	pub fn snapshot(&self) -> HashMap<String, PeerConnectUiRow> {
		self.by_did
			.read()
			.expect("peer connect ui poisoned")
			.iter()
			.map(|(did, row)| (did.clone(), row_to_public(row)))
			.collect()
	}

	pub fn row_for_did(&self, peer_did: &str) -> PeerConnectUiRow {
		self.by_did
			.read()
			.expect("peer connect ui poisoned")
			.get(peer_did)
			.map(row_to_public)
			.unwrap_or_default()
	}
}

fn row_to_public(row: &Row) -> PeerConnectUiRow {
	PeerConnectUiRow {
		connect_substate: row.connect_substate,
		transport_mode: row.transport_mode,
		reconnect_attempt: if row.reconnect_attempt > 0 {
			Some(row.reconnect_attempt)
		} else {
			None
		},
		last_disconnect_at_ms: row.last_disconnect_at_ms,
		last_disconnect_reason: row.last_disconnect_reason.clone(),
	}
}

fn map_progress(phase: ConnectProgressPhase) -> PeerConnectSubstate {
	match phase {
		ConnectProgressPhase::Discovering => PeerConnectSubstate::Discovering,
		ConnectProgressPhase::Handshaking => PeerConnectSubstate::Handshaking,
		ConnectProgressPhase::RelayPairing => PeerConnectSubstate::RelayPairing,
	}
}

fn map_mode(_mode: ConnectTransportMode) -> PeerTransportMode {
	PeerTransportMode::Relay
}

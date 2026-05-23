//! Per-peer connect sub-states and established transport mode for mesh UI.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use peeroxide_dht::connect_ui::{
	ConnectProgressPhase, ConnectTransportMode, ConnectUiEvent, ConnectUiHook,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PeerConnectSubstate {
	Discovering,
	Handshaking,
	Holepunching,
	RelayFallback,
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
}

#[derive(Default)]
struct Row {
	connect_substate: Option<PeerConnectSubstate>,
	transport_mode: Option<PeerTransportMode>,
}

pub struct PeerConnectUiTracker {
	by_did: RwLock<HashMap<String, Row>>,
	on_change: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl PeerConnectUiTracker {
	pub fn new(on_change: Option<Arc<dyn Fn() + Send + Sync>>) -> Self {
		Self {
			by_did: RwLock::new(HashMap::new()),
			on_change,
		}
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
		let did = match &event {
			ConnectUiEvent::Progress { remote_pk, .. }
			| ConnectUiEvent::Connected { remote_pk, .. }
			| ConnectUiEvent::Disconnected { remote_pk } => match crate::did::peer_did_from_ed25519(remote_pk) {
				Ok(d) => d,
				Err(_) => return,
			},
		};

		{
			let mut map = self.by_did.write().expect("peer connect ui poisoned");
			let row = map.entry(did).or_default();
			match event {
				ConnectUiEvent::Progress { phase, .. } => {
					row.connect_substate = Some(map_progress(phase));
				}
				ConnectUiEvent::Connected { mode, .. } => {
					row.connect_substate = None;
					row.transport_mode = Some(map_mode(mode));
				}
				ConnectUiEvent::Disconnected { .. } => {
					row.connect_substate = None;
					row.transport_mode = None;
				}
			}
		}

		if let Some(cb) = &self.on_change {
			cb();
		}
	}

	pub fn note_inbound_connected(&self, remote_pk: &[u8; 32], mode: Option<ConnectTransportMode>) {
		let Ok(did) = crate::did::peer_did_from_ed25519(remote_pk) else {
			return;
		};
		let mut map = self.by_did.write().expect("peer connect ui poisoned");
		let row = map.entry(did).or_default();
		row.connect_substate = None;
		if let Some(m) = mode {
			row.transport_mode = Some(map_mode(m));
		}
	}

	pub fn note_disconnected_pk(&self, remote_pk: &[u8; 32]) {
		self.apply(ConnectUiEvent::Disconnected {
			remote_pk: *remote_pk,
		});
	}

	pub fn snapshot(&self) -> HashMap<String, PeerConnectUiRow> {
		self.by_did
			.read()
			.expect("peer connect ui poisoned")
			.iter()
			.map(|(did, row)| {
				(
					did.clone(),
					PeerConnectUiRow {
						connect_substate: row.connect_substate,
						transport_mode: row.transport_mode,
					},
				)
			})
			.collect()
	}

	pub fn row_for_did(&self, peer_did: &str) -> PeerConnectUiRow {
		self.by_did
			.read()
			.expect("peer connect ui poisoned")
			.get(peer_did)
			.map(|row| PeerConnectUiRow {
				connect_substate: row.connect_substate,
				transport_mode: row.transport_mode,
			})
			.unwrap_or_default()
	}
}

fn map_progress(phase: ConnectProgressPhase) -> PeerConnectSubstate {
	match phase {
		ConnectProgressPhase::Discovering => PeerConnectSubstate::Discovering,
		ConnectProgressPhase::Handshaking => PeerConnectSubstate::Handshaking,
		ConnectProgressPhase::Holepunching => PeerConnectSubstate::Holepunching,
		ConnectProgressPhase::RelayFallback => PeerConnectSubstate::RelayFallback,
	}
}

fn map_mode(mode: ConnectTransportMode) -> PeerTransportMode {
	match mode {
		ConnectTransportMode::Lan => PeerTransportMode::Lan,
		ConnectTransportMode::Direct => PeerTransportMode::Direct,
		ConnectTransportMode::Punched => PeerTransportMode::Punched,
		ConnectTransportMode::Relay => PeerTransportMode::Relay,
	}
}

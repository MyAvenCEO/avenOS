//! Transport mode ranking for upgrade decisions (lower rank = better path).

use crate::peer_connect_ui::PeerTransportMode;

#[must_use]
pub fn transport_rank(mode: PeerTransportMode) -> u8 {
	match mode {
		PeerTransportMode::Lan => 1,
		PeerTransportMode::Direct => 2,
		PeerTransportMode::Punched => 3,
		PeerTransportMode::Relay => 4,
	}
}

#[must_use]
pub fn is_better(a: PeerTransportMode, b: PeerTransportMode) -> bool {
	transport_rank(a) < transport_rank(b)
}

#[must_use]
pub fn map_dht_mode(mode: peeroxide_dht::connect_ui::ConnectTransportMode) -> PeerTransportMode {
	match mode {
		peeroxide_dht::connect_ui::ConnectTransportMode::Lan => PeerTransportMode::Lan,
		peeroxide_dht::connect_ui::ConnectTransportMode::Direct => PeerTransportMode::Direct,
		peeroxide_dht::connect_ui::ConnectTransportMode::Punched => PeerTransportMode::Punched,
		peeroxide_dht::connect_ui::ConnectTransportMode::Relay => PeerTransportMode::Relay,
	}
}

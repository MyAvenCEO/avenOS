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

/// Prefer a fresh inbound link unless it is a strict transport downgrade.
#[must_use]
pub fn should_replace_link(
	new_mode: Option<PeerTransportMode>,
	existing_mode: Option<PeerTransportMode>,
) -> bool {
	match (new_mode, existing_mode) {
		(Some(new_m), Some(old_m)) => is_better(new_m, old_m) || new_m == old_m,
		_ => true,
	}
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

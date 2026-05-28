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

/// Prefer a fresh inbound link only when transport strictly improves (LAN > direct > punched > relay).
///
/// `existing_mux_ready` must be true — never tear down a link still handshaking or with unknown
/// transport (deferred blind-relay often arrives with `None` mode while pairing mux is live).
#[must_use]
pub fn should_replace_link(
	new_mode: Option<PeerTransportMode>,
	existing_mode: Option<PeerTransportMode>,
	existing_mux_ready: bool,
) -> bool {
	if !existing_mux_ready {
		return false;
	}
	match (new_mode, existing_mode) {
		(Some(new_m), Some(old_m)) => is_better(new_m, old_m),
		// Keep a live mux when we never recorded its path (pairing / relay race).
		(Some(_), None) | (None, Some(_)) | (None, None) => false,
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

/// Whether an upgrade probe may find a better path (LAN is best — never probe).
#[must_use]
pub fn should_probe_upgrade(mode: Option<PeerTransportMode>) -> bool {
	match mode {
		None => true,
		Some(m) => transport_rank(m) > 1,
	}
}

/// Minimum ms between upgrade probes per peer (shorter when path is worse).
#[must_use]
pub fn probe_interval_ms(mode: PeerTransportMode) -> u64 {
	match mode {
		PeerTransportMode::Lan => u64::MAX,
		PeerTransportMode::Direct => 75_000,
		PeerTransportMode::Punched => 45_000,
		PeerTransportMode::Relay => 20_000,
	}
}

#[must_use]
pub fn format_mode(mode: Option<PeerTransportMode>) -> &'static str {
	match mode {
		None => "unknown",
		Some(PeerTransportMode::Lan) => "lan",
		Some(PeerTransportMode::Direct) => "direct",
		Some(PeerTransportMode::Punched) => "punched",
		Some(PeerTransportMode::Relay) => "relay",
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn probe_upgrade_skips_lan() {
		assert!(!should_probe_upgrade(Some(PeerTransportMode::Lan)));
		assert!(should_probe_upgrade(Some(PeerTransportMode::Relay)));
		assert!(should_probe_upgrade(None));
	}

	#[test]
	fn replace_requires_strict_improvement() {
		assert!(should_replace_link(
			Some(PeerTransportMode::Lan),
			Some(PeerTransportMode::Relay),
			true,
		));
		assert!(!should_replace_link(
			Some(PeerTransportMode::Relay),
			Some(PeerTransportMode::Relay),
			true,
		));
	}

	#[test]
	fn replace_rejects_while_handshaking_or_unknown_mode() {
		assert!(!should_replace_link(
			Some(PeerTransportMode::Lan),
			Some(PeerTransportMode::Relay),
			false,
		));
		assert!(!should_replace_link(
			Some(PeerTransportMode::Relay),
			None,
			true,
		));
		assert!(!should_replace_link(None, None, true));
	}
}

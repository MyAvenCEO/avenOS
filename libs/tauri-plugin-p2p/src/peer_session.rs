//! Single authority for per-peer transport + mesh usability (UI phase derivation).

use serde::Serialize;

use crate::peer_link::PeerLinkPhase;

/// P2P sync bootstrap per allowlisted peer (shell before spark data).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SyncBootstrapPhase {
	#[default]
	TransportPending,
	ShellPending,
	TrustPending,
	Ready,
}

/// Derived readiness for mesh UI — one predicate, no split-brain between coordinator / linked / catch-up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PeerUsability {
	/// Inactive peer row or hyperswarm down with no path to sync.
	Unavailable,
	/// Discovering, handshaking, or mux not ready yet.
	Connecting,
	/// Mux live; ACL and/or outbound catch-up still in flight.
	LiveSyncing,
	/// Mux + sync ACL + catch-up complete — may show “Up to date”.
	Usable,
}

/// Inputs assembled once per peer row when building a mesh snapshot.
#[derive(Debug, Clone)]
pub struct PeerSessionFacts {
	pub db_status: String,
	pub hyperswarm_running: bool,
	pub coordinator_phase: Option<PeerLinkPhase>,
	pub mux_ready: bool,
	pub sync_ready: bool,
	pub catchup_ready: bool,
	pub global_catchup_pending: bool,
	pub bootstrap: SyncBootstrapPhase,
}

#[must_use]
pub fn derive_usability(f: &PeerSessionFacts) -> PeerUsability {
	if f.db_status != "active" {
		return PeerUsability::Unavailable;
	}
	if !f.hyperswarm_running {
		return PeerUsability::Connecting;
	}
	if !f.mux_ready {
		return PeerUsability::Connecting;
	}
	if !f.sync_ready || f.global_catchup_pending || !f.catchup_ready {
		return PeerUsability::LiveSyncing;
	}
	PeerUsability::Usable
}

/// Mesh phase labels for the webview (`PeerMeshPhase` in the app crate mirrors these names).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeshPhaseHint {
	Pairing,
	Offline,
	Searching,
	Syncing,
	Ready,
}

#[must_use]
pub fn mesh_phase_from_facts(f: &PeerSessionFacts) -> MeshPhaseHint {
	if f.db_status == "pairing" {
		return MeshPhaseHint::Pairing;
	}
	if f.db_status != "active" {
		return MeshPhaseHint::Offline;
	}
	if !f.hyperswarm_running {
		return MeshPhaseHint::Searching;
	}
	match derive_usability(f) {
		PeerUsability::Unavailable | PeerUsability::Connecting => MeshPhaseHint::Searching,
		PeerUsability::LiveSyncing => MeshPhaseHint::Syncing,
		PeerUsability::Usable => MeshPhaseHint::Ready,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn active_live_mux(sync_ready: bool, catchup_ready: bool) -> PeerSessionFacts {
		PeerSessionFacts {
			db_status: "active".into(),
			hyperswarm_running: true,
			coordinator_phase: Some(PeerLinkPhase::Live),
			mux_ready: true,
			sync_ready,
			catchup_ready,
			global_catchup_pending: false,
			bootstrap: SyncBootstrapPhase::Ready,
		}
	}

	#[test]
	fn never_usable_without_mux() {
		let f = PeerSessionFacts {
			mux_ready: false,
			coordinator_phase: Some(PeerLinkPhase::Live),
			..active_live_mux(true, true)
		};
		assert_eq!(derive_usability(&f), PeerUsability::Connecting);
		assert_eq!(mesh_phase_from_facts(&f), MeshPhaseHint::Searching);
	}

	#[test]
	fn live_coordinator_without_mux_is_searching_not_ready() {
		let f = PeerSessionFacts {
			mux_ready: false,
			..active_live_mux(true, true)
		};
		assert_ne!(mesh_phase_from_facts(&f), MeshPhaseHint::Ready);
	}

	#[test]
	fn ready_requires_mux_sync_and_catchup() {
		let f = active_live_mux(true, true);
		assert_eq!(derive_usability(&f), PeerUsability::Usable);
		assert_eq!(mesh_phase_from_facts(&f), MeshPhaseHint::Ready);
	}

	#[test]
	fn syncing_when_acl_or_catchup_pending() {
		let no_acl = active_live_mux(false, true);
		assert_eq!(derive_usability(&no_acl), PeerUsability::LiveSyncing);
		let no_catchup = active_live_mux(true, false);
		assert_eq!(derive_usability(&no_catchup), PeerUsability::LiveSyncing);
	}

	#[test]
	fn never_usable_until_catchup_ready() {
		let no_catchup = active_live_mux(true, false);
		assert_eq!(derive_usability(&no_catchup), PeerUsability::LiveSyncing);
		assert_ne!(mesh_phase_from_facts(&no_catchup), MeshPhaseHint::Ready);
	}
}

//! Single source of truth for per-peer P2P mesh UI state (Hyperswarm + Jazz mesh).
//!
//! Snapshots are built on the Groove actor (reads peer rows via `conn` there only).

use serde::Serialize;
use tauri::Manager;

use crate::jazz::runtime::groove_actor;
use crate::peers::PeerRowReply;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PeerMeshPhase {
	Pairing,
	Offline,
	Searching,
	Syncing,
	Ready,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PeerSyncBlockReason {
	MuxPending,
	PolicyPending,
	CatchupPending,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerMeshPeerState {
	pub id: String,
	pub peer_did: String,
	pub device_label: String,
	pub db_status: String,
	pub added_at_ms: i64,
	pub phase: PeerMeshPhase,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub usability: Option<tauri_plugin_p2p::PeerUsability>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub connect_substate: Option<tauri_plugin_p2p::PeerConnectSubstate>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub transport_mode: Option<tauri_plugin_p2p::PeerTransportMode>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub reconnect_attempt: Option<u32>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub last_disconnect_at_ms: Option<u64>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub last_disconnect_reason: Option<String>,
	/// Groove mux worker + outbound channel ready (can send spark/keyshare frames).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub groove_mux_ready: Option<bool>,
	/// Biscuit ACL snapshot loaded and peer registered for Groove P2P sync.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub sync_ready: Option<bool>,
	/// Outbound catch-up finished for this peer (`PeerCatchupPhase::Ready`).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub catchup_ready: Option<bool>,
	/// While syncing, why the peer is not yet usable (mux / policy / catch-up).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub sync_block_reason: Option<PeerSyncBlockReason>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub bootstrap: Option<tauri_plugin_p2p::SyncBootstrapPhase>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerMeshStatusReply {
	pub hyperswarm_running: bool,
	pub hyperswarm_start_error: Option<String>,
	pub local_pk_prefix_hex: String,
	pub pairing_code_pending: Option<String>,
	pub p2p_diagnostics: tauri_plugin_p2p::P2pDiagnostics,
	pub peers: Vec<PeerMeshPeerState>,
}

pub async fn publish_peer_mesh_snapshot(app: &tauri::AppHandle) {
	groove_actor(app).publish_mesh().await;
}

/// Assemble UI snapshot from transport + coordinator phase and pre-fetched DB rows (no `conn` here).
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub(crate) async fn assemble_mesh_snapshot(
	app: &tauri::AppHandle,
	jazz: &crate::jazz::ManagedJazz,
	db_rows: Vec<PeerRowReply>,
) -> Result<PeerMeshStatusReply, String> {
	use std::collections::HashMap;
	use std::sync::Arc;

	use groove::sync_manager::ClientId;
	use tauri_plugin_p2p::PeerSessionFacts;

	use tauri_plugin_p2p::PeerCtl;

	let peer_ctl: tauri::State<'_, Arc<PeerCtl>> = app.state();
	let bridge = app.state::<tauri_plugin_p2p::HyperswarmGrooveBridge>();

	let catchup = app
		.state::<crate::peer_catchup::PeerCatchupHandle>()
		.mesh_catchup_ui_snapshot(&*bridge)
		.await;

	let transport = peer_ctl.peer_transport_status().await;
	let catchup_pending = catchup.global_catchup_busy;
	let mesh_catchup = catchup.ready_client_ids;
	let live_links = app.state::<std::sync::Arc<tauri_plugin_p2p::PeerLinkCoordinator>>();
	let live: Vec<ClientId> = live_links.snapshot_mux_ready_clients().await;
	let cid_map = bridge.shared_client_id_to_did();

	let sync_acl_ready = jazz.sync_acl_ready();
	let sync_acl_snap = jazz
		.sync_acl
		.read()
		.expect("sync_acl poisoned")
		.clone();

	let mut coordinator_phase_by_did: HashMap<String, tauri_plugin_p2p::PeerLinkPhase> =
		HashMap::new();
	for row in live_links.snapshot_mesh_rows().await {
		coordinator_phase_by_did.insert(row.remote_did, row.phase);
	}

	let mut catchup_done_by_did: HashMap<String, bool> = HashMap::new();
	let mut groove_mux_ready_by_did: HashMap<String, bool> = HashMap::new();
	let mut sync_ready_by_did: HashMap<String, bool> = HashMap::new();
	for cid in &live {
		let did = cid_map.read().expect("cid map").get(cid).cloned();
		if let Some(did) = did {
			let send_ready = bridge.peer_send_ready(*cid).await;
			let inbound_ok = bridge.peer_inbound_liveness_ok(*cid).await;
			let link_live = send_ready && inbound_ok;
			let catchup_done = mesh_catchup.contains(cid) && link_live;
			catchup_done_by_did.insert(did.clone(), catchup_done);
			groove_mux_ready_by_did.insert(did.clone(), link_live);
			let registered = jazz.is_groove_peer_registered(*cid).await;
			sync_ready_by_did.insert(did, sync_acl_ready && registered);
		}
	}

	let mut out: Vec<PeerMeshPeerState> = Vec::new();
	for row in db_rows {
		let coordinator_phase = coordinator_phase_by_did.get(&row.peer_did).copied();
		let mux_ready = groove_mux_ready_by_did
			.get(&row.peer_did)
			.copied()
			.unwrap_or(false);
		let sync_ready = sync_ready_by_did.get(&row.peer_did).copied().unwrap_or(false);
		let catchup_ready = catchup_done_by_did.get(&row.peer_did).copied().unwrap_or(false);
		let bootstrap = crate::spark_sync::compute_sync_bootstrap_phase(
			sync_acl_snap.as_ref(),
			&row.peer_did,
			mux_ready,
		);

		let facts = PeerSessionFacts {
			db_status: row.status.clone(),
			hyperswarm_running: transport.hyperswarm_running,
			coordinator_phase,
			mux_ready,
			sync_ready,
			catchup_ready,
			global_catchup_pending: catchup_pending,
			bootstrap,
		};
		let usability = tauri_plugin_p2p::derive_usability(&facts);
		let phase = mesh_phase_hint_to_peer_phase(tauri_plugin_p2p::mesh_phase_from_facts(&facts));
		let sync_block_reason = sync_block_reason_for_usability(
			usability,
			mux_ready,
			sync_ready,
			catchup_ready,
			catchup_pending,
			bootstrap,
		);

		let ui = peer_ctl.connect_ui_row_for_did(&row.peer_did);
		let connect_substate = link_phase_connect_substate(coordinator_phase);
		out.push(PeerMeshPeerState {
			id: row.id,
			peer_did: row.peer_did,
			device_label: row.device_label,
			db_status: row.status,
			added_at_ms: row.added_at_ms,
			phase,
			usability: Some(usability),
			connect_substate,
			transport_mode: ui.transport_mode,
			reconnect_attempt: ui.reconnect_attempt,
			last_disconnect_at_ms: ui.last_disconnect_at_ms,
			last_disconnect_reason: ui.last_disconnect_reason,
			groove_mux_ready: Some(mux_ready),
			sync_ready: Some(sync_ready),
			catchup_ready: Some(catchup_ready),
			sync_block_reason,
			bootstrap: Some(bootstrap),
		});
	}

	out.sort_by(|a, b| a.device_label.to_lowercase().cmp(&b.device_label.to_lowercase()));

	Ok(PeerMeshStatusReply {
		hyperswarm_running: transport.hyperswarm_running,
		hyperswarm_start_error: transport.hyperswarm_start_error,
		local_pk_prefix_hex: transport.local_pk_prefix_hex,
		pairing_code_pending: transport.pairing_code_pending,
		p2p_diagnostics: transport.p2p_diagnostics,
		peers: out,
	})
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn mesh_phase_hint_to_peer_phase(hint: tauri_plugin_p2p::MeshPhaseHint) -> PeerMeshPhase {
	use tauri_plugin_p2p::MeshPhaseHint;
	match hint {
		MeshPhaseHint::Pairing => PeerMeshPhase::Pairing,
		MeshPhaseHint::Offline => PeerMeshPhase::Offline,
		MeshPhaseHint::Searching => PeerMeshPhase::Searching,
		MeshPhaseHint::Syncing => PeerMeshPhase::Syncing,
		MeshPhaseHint::Ready => PeerMeshPhase::Ready,
	}
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn sync_block_reason_for_usability(
	usability: tauri_plugin_p2p::PeerUsability,
	mux_ready: bool,
	sync_ready: bool,
	catchup_ready: bool,
	catchup_pending: bool,
	_bootstrap: tauri_plugin_p2p::SyncBootstrapPhase,
) -> Option<PeerSyncBlockReason> {
	if usability == tauri_plugin_p2p::PeerUsability::Usable {
		return None;
	}
	if !mux_ready {
		return Some(PeerSyncBlockReason::MuxPending);
	}
	if !sync_ready {
		return Some(PeerSyncBlockReason::PolicyPending);
	}
	if catchup_pending || !catchup_ready {
		return Some(PeerSyncBlockReason::CatchupPending);
	}
	None
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn link_phase_connect_substate(
	phase: Option<tauri_plugin_p2p::PeerLinkPhase>,
) -> Option<tauri_plugin_p2p::PeerConnectSubstate> {
	use tauri_plugin_p2p::{PeerConnectSubstate, PeerLinkPhase};
	match phase {
		Some(PeerLinkPhase::Discovering) => Some(PeerConnectSubstate::Discovering),
		Some(PeerLinkPhase::SwarmConnecting) => Some(PeerConnectSubstate::RelayPairing),
		Some(PeerLinkPhase::Handshaking | PeerLinkPhase::TransportUp) => {
			Some(PeerConnectSubstate::Handshaking)
		}
		Some(PeerLinkPhase::Live)
		| Some(PeerLinkPhase::Idle)
		| Some(PeerLinkPhase::Backoff)
		| None => None,
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use tauri_plugin_p2p::{derive_usability, mesh_phase_from_facts, MeshPhaseHint, PeerSessionFacts, PeerUsability};

	#[test]
	fn phase_never_ready_without_sync_acl() {
		let facts = PeerSessionFacts {
			db_status: "active".into(),
			hyperswarm_running: true,
			coordinator_phase: Some(tauri_plugin_p2p::PeerLinkPhase::Live),
			mux_ready: true,
			sync_ready: false,
			catchup_ready: true,
			global_catchup_pending: false,
			bootstrap: tauri_plugin_p2p::SyncBootstrapPhase::TrustPending,
		};
		assert_eq!(mesh_phase_from_facts(&facts), MeshPhaseHint::Syncing);
		assert_eq!(derive_usability(&facts), PeerUsability::LiveSyncing);
	}

	#[test]
	fn phase_never_ready_without_mux() {
		let facts = PeerSessionFacts {
			db_status: "active".into(),
			hyperswarm_running: true,
			coordinator_phase: Some(tauri_plugin_p2p::PeerLinkPhase::Live),
			mux_ready: false,
			sync_ready: true,
			catchup_ready: true,
			global_catchup_pending: false,
			bootstrap: tauri_plugin_p2p::SyncBootstrapPhase::TransportPending,
		};
		assert_eq!(mesh_phase_from_facts(&facts), MeshPhaseHint::Searching);
		assert_ne!(mesh_phase_hint_to_peer_phase(mesh_phase_from_facts(&facts)), PeerMeshPhase::Ready);
		assert_eq!(derive_usability(&facts), PeerUsability::Connecting);
	}

	#[test]
	fn catchup_pending_maps_to_sync_block_reason() {
		let reason = sync_block_reason_for_usability(
			PeerUsability::LiveSyncing,
			true,
			true,
			false,
			false,
			tauri_plugin_p2p::SyncBootstrapPhase::TrustPending,
		);
		assert_eq!(reason, Some(PeerSyncBlockReason::CatchupPending));
	}
}

/// Push mesh snapshot to the webview on `avenos:runtime` (single ingress).
pub(crate) fn emit_mesh_snapshot_events(app: &tauri::AppHandle, snap: &PeerMeshStatusReply) {
	use tauri::Emitter;

	if let Err(e) = app.emit(
		"avenos:runtime",
		&serde_json::json!({ "kind": "mesh", "snapshot": snap }),
	) {
		log::debug!(
			target: "avenos::jazz",
			"emit avenos:runtime mesh snapshot failed: {e}",
		);
	}
}

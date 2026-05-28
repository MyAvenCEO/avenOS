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
	pub connect_substate: Option<tauri_plugin_peer::PeerConnectSubstate>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub transport_mode: Option<tauri_plugin_peer::PeerTransportMode>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub reconnect_attempt: Option<u32>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub last_disconnect_at_ms: Option<u64>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub last_disconnect_reason: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub desired_transport: Option<tauri_plugin_peer::PeerTransportMode>,
	/// Groove mux worker + outbound channel ready (can send spark/keyshare frames).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub groove_mux_ready: Option<bool>,
	/// Outbound catch-up finished for this peer (`PeerCatchupPhase::Ready`).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub catchup_ready: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerMeshStatusReply {
	pub hyperswarm_running: bool,
	pub hyperswarm_start_error: Option<String>,
	pub local_pk_prefix_hex: String,
	pub pairing_code_pending: Option<String>,
	pub p2p_diagnostics: tauri_plugin_peer::P2pDiagnostics,
	pub peers: Vec<PeerMeshPeerState>,
}

pub async fn publish_peer_mesh_snapshot(app: &tauri::AppHandle) {
	groove_actor(app).publish_mesh().await;
}

/// Assemble UI snapshot from transport + bridge state and pre-fetched DB rows (no `conn` here).
#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
pub(crate) async fn assemble_mesh_snapshot(
	app: &tauri::AppHandle,
	_jazz: &crate::jazz::ManagedJazz,
	db_rows: Vec<PeerRowReply>,
) -> Result<PeerMeshStatusReply, String> {
	use std::collections::{HashMap, HashSet};
	use std::sync::Arc;

	use groove::sync_manager::ClientId;

	use tauri_plugin_peer::PeerCtl;

	let peer_ctl: tauri::State<'_, Arc<PeerCtl>> = app.state();
	let bridge = app.state::<tauri_plugin_peer::HyperswarmGrooveBridge>();

	let catchup = app
		.state::<crate::peer_catchup::PeerCatchupHandle>()
		.mesh_catchup_ui_snapshot()
		.await;

	let transport = peer_ctl.peer_transport_status().await;
	let linked: HashSet<String> = transport.linked_peer_dids.iter().cloned().collect();
	let catchup_pending = catchup.global_catchup_busy;
	let mesh_catchup = catchup.ready_client_ids;
	let _bridge = app.state::<tauri_plugin_peer::HyperswarmGrooveBridge>();
	let live_links = app.state::<std::sync::Arc<tauri_plugin_peer::LiveLinkRegistry>>();
	let live: Vec<ClientId> = live_links.snapshot_mux_ready_clients().await;
	let cid_map = bridge.shared_client_id_to_did();

	let mut catchup_done_by_did: HashMap<String, bool> = HashMap::new();
	let mut groove_mux_ready_by_did: HashMap<String, bool> = HashMap::new();
	for cid in &live {
		let did = cid_map.read().expect("cid map").get(cid).cloned();
		if let Some(did) = did {
			catchup_done_by_did.insert(did.clone(), mesh_catchup.contains(cid));
			groove_mux_ready_by_did.insert(did, true);
		}
	}

	let mut out: Vec<PeerMeshPeerState> = Vec::new();
	for row in db_rows {
		let phase = phase_for_peer(
			&row.peer_did,
			&row.status,
			transport.hyperswarm_running,
			&linked,
			catchup_pending,
			&catchup_done_by_did,
		);
		let ui = peer_ctl.connect_ui_row_for_did(&row.peer_did);
		let catchup_ready = catchup_done_by_did.get(&row.peer_did).copied();
		let groove_mux = groove_mux_ready_by_did.get(&row.peer_did).copied();
		out.push(PeerMeshPeerState {
			id: row.id,
			peer_did: row.peer_did,
			device_label: row.device_label,
			db_status: row.status,
			added_at_ms: row.added_at_ms,
			phase,
			connect_substate: ui.connect_substate,
			transport_mode: ui.transport_mode,
			reconnect_attempt: ui.reconnect_attempt,
			last_disconnect_at_ms: ui.last_disconnect_at_ms,
			last_disconnect_reason: ui.last_disconnect_reason,
			desired_transport: ui.desired_transport,
			groove_mux_ready: groove_mux,
			catchup_ready: catchup_ready,
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

#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
fn phase_for_peer(
	peer_did: &str,
	db_status: &str,
	hyperswarm_running: bool,
	linked: &std::collections::HashSet<String>,
	catchup_pending: bool,
	catchup_done_by_did: &std::collections::HashMap<String, bool>,
) -> PeerMeshPhase {
	if db_status == "pairing" {
		return PeerMeshPhase::Pairing;
	}
	if db_status != "active" {
		return PeerMeshPhase::Offline;
	}
	if !hyperswarm_running {
		return PeerMeshPhase::Searching;
	}
	if linked.contains(peer_did) {
		let catchup_done = catchup_done_by_did.get(peer_did).copied().unwrap_or(false);
		if catchup_pending || !catchup_done {
			return PeerMeshPhase::Syncing;
		}
		return PeerMeshPhase::Ready;
	}
	PeerMeshPhase::Searching
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

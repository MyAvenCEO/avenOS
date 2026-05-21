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
	pub peer_did: String,
	pub device_label: String,
	pub db_status: String,
	pub phase: PeerMeshPhase,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerMeshStatusReply {
	pub hyperswarm_running: bool,
	pub local_pk_prefix_hex: String,
	pub pairing_code_pending: Option<String>,
	pub peers: Vec<PeerMeshPeerState>,
}

pub const PEER_MESH_CHANGED_EVENT: &str = "peer:mesh-changed";

pub async fn publish_peer_mesh_snapshot(app: &tauri::AppHandle) {
	groove_actor(app).publish_mesh().await;
}

/// Assemble UI snapshot from transport + bridge state and pre-fetched DB rows (no `conn` here).
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) async fn assemble_mesh_snapshot(
	app: &tauri::AppHandle,
	jazz: &crate::jazz::ManagedJazz,
	db_rows: Vec<PeerRowReply>,
) -> Result<PeerMeshStatusReply, String> {
	use std::collections::{HashMap, HashSet};
	use std::sync::Arc;

	use groove::sync_manager::ClientId;

	use tauri_plugin_peer::PeerCtl;

	let peer_ctl: tauri::State<'_, Arc<PeerCtl>> = app.state();
	let bridge = app.state::<tauri_plugin_peer::HyperswarmGrooveBridge>();

	let transport = peer_ctl.peer_transport_status().await;
	let linked: HashSet<String> = transport.linked_peer_dids.iter().cloned().collect();
	let (catchup_pending, mesh_catchup) = jazz.peer_mesh_catchup_snapshot().await;

	let live: Vec<ClientId> = bridge.snapshot_remote_clients().await;
	let cid_map = bridge.shared_client_id_to_did();

	let mut catchup_done_by_did: HashMap<String, bool> = HashMap::new();
	for cid in &live {
		if let Some(did) = cid_map.read().expect("cid map").get(cid).cloned() {
			catchup_done_by_did.insert(did, mesh_catchup.contains(cid));
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
		out.push(PeerMeshPeerState {
			peer_did: row.peer_did,
			device_label: row.device_label,
			db_status: row.status,
			phase,
		});
	}

	out.sort_by(|a, b| a.device_label.to_lowercase().cmp(&b.device_label.to_lowercase()));

	Ok(PeerMeshStatusReply {
		hyperswarm_running: transport.hyperswarm_running,
		local_pk_prefix_hex: transport.local_pk_prefix_hex,
		pairing_code_pending: transport.pairing_code_pending,
		peers: out,
	})
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
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

/// Emit mesh snapshot events (caller must already hold snapshot on the actor).
pub(crate) fn emit_mesh_snapshot_events(app: &tauri::AppHandle, snap: &PeerMeshStatusReply) {
	use tauri::Emitter;

	if let Err(e) = app.emit(PEER_MESH_CHANGED_EVENT, snap) {
		log::debug!(
			target: "avenos::jazz",
			"emit {PEER_MESH_CHANGED_EVENT} failed: {e}",
		);
	}
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

//! Non-macOS stubs — Hyperswarm not available.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerTransportStatusReply {
	pub hyperswarm_running: bool,
	pub hyperswarm_start_error: Option<String>,
	pub local_pk_prefix_hex: String,
	pub linked_peer_ids: Vec<String>,
	pub linked_peer_dids: Vec<String>,
	pub pairing_code_pending: Option<String>,
	pub p2p_diagnostics: crate::P2pDiagnostics,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInviteCreateReply {
	pub code: String,
}

#[tauri::command]
pub async fn peer_transport_status() -> Result<PeerTransportStatusReply, String> {
	Ok(PeerTransportStatusReply {
		hyperswarm_running: false,
		hyperswarm_start_error: None,
		local_pk_prefix_hex: String::new(),
		linked_peer_ids: vec![],
		linked_peer_dids: vec![],
		pairing_code_pending: None,
		p2p_diagnostics: crate::P2pDiagnostics {
			central_mode: false,
			dht_bootstrap: String::new(),
			joined_topic_count: 0,
			allowlist_count: 0,
			linked_count: 0,
			pairing_session_active: false,
			pairing_topic_hex: None,
			relay_https_probe: None,
			dht_bootstrap_closest_seen: None,
			last_path_change_at_ms: None,
			last_foreground_heal_at_ms: None,
			heal_in_progress: false,
			network_interfaces: vec![],
			link_health: crate::LinkHealth::None,
			prefer_relay_only: true,
		},
	})
}

#[tauri::command]
pub async fn peer_invite_create() -> Result<PeerInviteCreateReply, String> {
	Err("Hyperswarm pairing is macOS-only in this build.".into())
}

#[tauri::command]
pub async fn peer_invite_accept(_code: String) -> Result<(), String> {
	Err("Hyperswarm pairing is macOS-only in this build.".into())
}

#[tauri::command]
pub async fn peer_invite_cancel() -> Result<(), String> {
	Ok(())
}

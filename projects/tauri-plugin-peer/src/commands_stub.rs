//! Non-macOS stubs — Hyperswarm not available.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerTransportStatusReply {
	pub hyperswarm_running: bool,
	pub local_pk_prefix_hex: String,
	pub linked_peer_ids: Vec<String>,
	pub linked_peer_dids: Vec<String>,
	pub pairing_code_pending: Option<String>,
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
		local_pk_prefix_hex: String::new(),
		linked_peer_ids: vec![],
		linked_peer_dids: vec![],
		pairing_code_pending: None,
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

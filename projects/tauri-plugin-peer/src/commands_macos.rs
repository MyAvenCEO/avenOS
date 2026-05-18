//! Tauri IPC for Hyperswarm / pairing (macOS).

use std::sync::Arc;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_self::state::SelfState;

use crate::{PeerCtl, PeerInviteCreateReply, PeerTransportStatusReply};

#[tauri::command]
pub async fn peer_transport_status(
	ctl: State<'_, Arc<PeerCtl>>,
) -> Result<PeerTransportStatusReply, String> {
	Ok(ctl.peer_transport_status().await)
}

#[tauri::command]
pub async fn peer_invite_create(
	app: AppHandle,
	ctl: State<'_, Arc<PeerCtl>>,
) -> Result<PeerInviteCreateReply, String> {
	if !app.state::<SelfState>().is_unlocked() {
		return Err("Unlock AvenOS identity first.".into());
	}
	let code = ctl.peer_invite_create().await?;
	Ok(PeerInviteCreateReply { code })
}

#[tauri::command]
pub async fn peer_invite_accept(
	app: AppHandle,
	ctl: State<'_, Arc<PeerCtl>>,
	code: String,
	label: String,
) -> Result<(), String> {
	if !app.state::<SelfState>().is_unlocked() {
		return Err("Unlock AvenOS identity first.".into());
	}
	ctl.peer_invite_accept(code, label).await
}

#[tauri::command]
pub async fn peer_invite_cancel(app: AppHandle, ctl: State<'_, Arc<PeerCtl>>) -> Result<(), String> {
	if !app.state::<SelfState>().is_unlocked() {
		return Err("Unlock AvenOS identity first.".into());
	}
	ctl.peer_invite_cancel().await
}

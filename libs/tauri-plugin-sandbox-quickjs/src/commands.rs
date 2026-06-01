use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::session::{InterfaceDef, SessionManager};

pub const STATE_EVENT: &str = "sandbox-qjs://state";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMountRequest {
	#[allow(dead_code)]
	pub view: Value,
	#[allow(dead_code)]
	pub style: Value,
	pub source: Value,
	pub interface: InterfaceDef,
	pub logic: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMountResponse {
	pub session_id: String,
	pub state: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDispatchRequest {
	pub session_id: String,
	pub send: String,
	#[serde(default)]
	pub payload: Value,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDispatchResponse {
	pub ok: bool,
	pub state: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUnmountRequest {
	pub session_id: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateEventPayload {
	pub session_id: String,
	pub state: Value,
}

#[tauri::command]
pub fn session_mount(
	manager: State<'_, SessionManager>,
	request: SessionMountRequest,
) -> Result<SessionMountResponse, String> {
	let (session_id, state) = manager.mount(request.logic, request.source, request.interface)?;
	Ok(SessionMountResponse { session_id, state })
}

#[tauri::command]
pub fn session_dispatch(
	app: AppHandle,
	manager: State<'_, SessionManager>,
	request: SessionDispatchRequest,
) -> Result<SessionDispatchResponse, String> {
	let state = manager.dispatch(&request.session_id, &request.send, request.payload)?;
	let payload = StateEventPayload {
		session_id: request.session_id.clone(),
		state: state.clone(),
	};
	app.emit(STATE_EVENT, payload)
		.map_err(|e| e.to_string())?;
	Ok(SessionDispatchResponse {
		ok: true,
		state,
	})
}

#[tauri::command]
pub fn session_unmount(
	manager: State<'_, SessionManager>,
	request: SessionUnmountRequest,
) -> Result<(), String> {
	manager.unmount(&request.session_id)
}

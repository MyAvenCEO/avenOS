//! IPC: Stronghold secret metadata + write paths. Values never cross to JS except on explicit reveal.

use serde::Serialize;
use tauri::State;
use tauri_plugin_self::StrongholdSession;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretListEntry {
	pub id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretSetPayload {
	pub id: String,
	pub value: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretIdPayload {
	pub id: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn secrets_list(stronghold: State<'_, StrongholdSession>) -> Result<Vec<SecretListEntry>, String> {
	let ids = stronghold.secrets_list_ids()?;
	Ok(ids
		.into_iter()
		.filter(|id| id != "__index__")
		.map(|id| SecretListEntry { id })
		.collect())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn secrets_set(
	stronghold: State<'_, StrongholdSession>,
	payload: SecretSetPayload,
) -> Result<(), String> {
	validate_secret_id(&payload.id)?;
	stronghold.secrets_insert(&payload.id, payload.value.as_bytes())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn secrets_reveal(
	stronghold: State<'_, StrongholdSession>,
	payload: SecretIdPayload,
) -> Result<String, String> {
	validate_secret_id(&payload.id)?;
	let raw = stronghold.secrets_get(&payload.id)?;
	String::from_utf8(raw).map_err(|_| "secret_value_not_utf8".into())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn secrets_delete(
	stronghold: State<'_, StrongholdSession>,
	payload: SecretIdPayload,
) -> Result<(), String> {
	validate_secret_id(&payload.id)?;
	stronghold.secrets_remove(&payload.id)
}

fn validate_secret_id(id: &str) -> Result<(), String> {
	if id.trim().is_empty() || id.contains('/') || id == "__index__" {
		return Err("invalid_secret_id".into());
	}
	Ok(())
}

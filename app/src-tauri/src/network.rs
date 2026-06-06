//! Hardcoded network id exposed to the frontend.

#[tauri::command]
pub async fn network_seed() -> Result<String, String> {
	Ok(tauri_plugin_self::network::NETWORK_SEED.to_string())
}

/// The well-known `avenCEO` control-identity id for this network (deterministic from
/// the network seed). The UI shows this identity by default in every account; the
/// first device to claim it (mint its genesis) becomes the network owner/admin.
#[tauri::command]
pub async fn aven_ceo_identity() -> Result<String, String> {
	Ok(crate::identity_acc::aven_ceo_identity(tauri_plugin_self::network::NETWORK_SEED).to_string())
}

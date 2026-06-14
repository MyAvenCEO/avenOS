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

/// The well-known **Addressbook** spark id — the sealed network directory, a spark SAFE
/// controlled by avenCEO (board 0049). Deterministic: `derive_subgroup_id(avenCEO,"registry")`.
/// The UI uses it to nest the Addressbook inside avenCEO instead of showing a separate card.
#[tauri::command]
pub async fn aven_ceo_addressbook_id() -> Result<String, String> {
	let avenceo = crate::identity_acc::aven_ceo_identity(tauri_plugin_self::network::NETWORK_SEED);
	Ok(crate::identity_acc::derive_subgroup_id(avenceo, "registry").to_string())
}

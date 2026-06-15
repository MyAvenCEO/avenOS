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

/// Google OAuth client config for the NATIVE desktop sign-in (tauri-plugin-google-auth,
/// board 0050). Use a Google "Desktop app" client (secret is non-confidential / PKCE), the
/// SAME id Better Auth verifies the idToken audience against. Read from the Rust process env
/// so the secret never ships in the JS/web bundle — the frontend asks for it only inside the
/// Tauri runtime, then hands the resulting Google idToken to Better Auth.
#[derive(serde::Serialize)]
pub struct GoogleOAuthConfig {
	pub client_id: String,
	pub client_secret: String,
}

#[tauri::command]
pub async fn google_oauth_config() -> Result<GoogleOAuthConfig, String> {
	let client_id =
		std::env::var("GOOGLE_CLIENT_ID").map_err(|_| "GOOGLE_CLIENT_ID not set".to_string())?;
	let client_secret = std::env::var("GOOGLE_CLIENT_SECRET")
		.map_err(|_| "GOOGLE_CLIENT_SECRET not set".to_string())?;
	Ok(GoogleOAuthConfig {
		client_id,
		client_secret,
	})
}

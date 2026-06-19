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
/// SAME id Better Auth verifies the idToken audience against. Never ships in the JS/web
/// bundle — the frontend asks for it only inside the Tauri runtime, then hands the resulting
/// Google idToken to Better Auth.
#[derive(serde::Serialize)]
pub struct GoogleOAuthConfig {
	pub client_id: String,
	pub client_secret: String,
}

/// Resolve a build-time-or-runtime value: prefer the value baked at COMPILE time (so a
/// shipped/packaged app has it with no process env), and fall back to the runtime env for
/// `bun run dev` (the launcher injects GOOGLE_CLIENT_ID/SECRET). board 0050.
fn baked_or_env(compile_time: Option<&str>, key: &str) -> Result<String, String> {
	compile_time
		.map(str::to_string)
		.or_else(|| std::env::var(key).ok())
		.filter(|v| !v.is_empty())
		.ok_or_else(|| format!("{key} not set"))
}

#[tauri::command]
pub async fn google_oauth_config() -> Result<GoogleOAuthConfig, String> {
	Ok(GoogleOAuthConfig {
		client_id: baked_or_env(option_env!("GOOGLE_CLIENT_ID"), "GOOGLE_CLIENT_ID")?,
		client_secret: baked_or_env(option_env!("GOOGLE_CLIENT_SECRET"), "GOOGLE_CLIENT_SECRET")?,
	})
}

use serde::{Deserialize, Serialize};
use tauri::{plugin::TauriPlugin, Runtime};

#[cfg(target_os = "ios")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_ios_passkey);

#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginRequest {
	domain: String,
	challenge: Vec<u8>,
}

#[cfg(target_os = "ios")]
struct IosPasskey<R: Runtime>(PluginHandle<R>);

#[tauri::command]
async fn login<R: Runtime>(
	app: tauri::AppHandle<R>,
	domain: String,
	challenge: Vec<u8>,
	salt: Vec<u8>,
) -> Result<serde_json::Value, String> {
	#[cfg(target_os = "ios")]
	{
		let _ = salt;
		return app
			.state::<IosPasskey<R>>()
			.0
			.run_mobile_plugin("login", LoginRequest { domain, challenge })
			.map_err(|error| error.to_string());
	}

	#[cfg(not(target_os = "ios"))]
	{
		let _ = (app, domain, challenge, salt);
		Err("Native iOS passkeys are unavailable on this platform.".to_string())
	}
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
	tauri::plugin::Builder::new("ios-passkey")
		.setup(|app, api| {
			#[cfg(target_os = "ios")]
			app.manage(IosPasskey(
				api.register_ios_plugin(init_plugin_ios_passkey)?,
			));
			#[cfg(not(target_os = "ios"))]
			let _ = (app, api);
			Ok(())
		})
		.invoke_handler(tauri::generate_handler![login])
		.build()
}

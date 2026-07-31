//! `tauri-plugin-vault` — Stronghold secrets CRUD via [`tauri_plugin_self::StrongholdSession`].

mod commands;

use tauri::{generate_handler, plugin::Builder};

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
	Builder::new("vault")
		.invoke_handler(generate_handler![
			commands::secrets_list,
			commands::secrets_set,
			commands::secrets_reveal,
			commands::secrets_delete,
		])
		.build()
}

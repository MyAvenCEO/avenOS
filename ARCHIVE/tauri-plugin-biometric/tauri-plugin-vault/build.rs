fn main() {
	const COMMANDS: &[&str] = &[
		"secrets_list",
		"secrets_set",
		"secrets_reveal",
		"secrets_delete",
	];
	tauri_plugin::Builder::new(COMMANDS).build();
}

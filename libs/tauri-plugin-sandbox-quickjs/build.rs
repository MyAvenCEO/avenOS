fn main() {
	const COMMANDS: &[&str] = &["session_mount", "session_dispatch", "session_unmount"];
	tauri_plugin::Builder::new(COMMANDS).build();
}

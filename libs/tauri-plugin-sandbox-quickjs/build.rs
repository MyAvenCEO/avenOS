fn main() {
	const COMMANDS: &[&str] = &["session_mount", "session_dispatch", "session_unmount", "run_tool"];
	tauri_plugin::Builder::new(COMMANDS).build();
}

fn main() {
	tauri_plugin::Builder::new(&["login"])
		.ios_path("ios")
		.build();
}

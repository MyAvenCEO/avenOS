fn main() {
	const COMMANDS: &[&str] = &["register_passkey", "login_passkey"];

	if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
		use swift_rs::SwiftLinker;

		SwiftLinker::new("15.0")
			.with_package("PasskeyBridge", "swift-lib")
			.link();
	} else {
		println!("cargo:warning=tauri-plugin-passkey: Swift bridge skipped (target_os != macos)");
	}
	tauri_plugin::Builder::new(COMMANDS).build();
}

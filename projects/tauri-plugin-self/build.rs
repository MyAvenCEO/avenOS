fn main() {
	const COMMANDS: &[&str] = &[
		"register",
		"public_key",
		"unlock",
		"peer_status",
		"device_peer_did",
		"signing_peer_did",
		"signing_public_key",
		"sign",
		"verify",
		"lock",
		"vault_list",
		"vault_slug_preview",
		"vault_select",
		"vault_create",
		"vault_selected_slug",
	];

	if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
		swift_rs::SwiftLinker::new("13")
			.with_package("SelfBridge", "swift-lib")
			.link();
	} else {
		println!(
			"cargo:warning=tauri-plugin-self: Swift bridge skipped (target_os != macos)"
		);
	}

	tauri_plugin::Builder::new(COMMANDS).build();
}

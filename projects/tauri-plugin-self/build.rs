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
		"host_device_label",
		"vault_list",
		"vault_slug_preview",
		"vault_select",
		"vault_create",
		"vault_selected_slug",
		"active_identity",
	];

	let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
	if matches!(target_os.as_str(), "macos" | "ios") {
		let mut link = swift_rs::SwiftLinker::new("13").with_package("SelfBridge", "swift-lib");
		if target_os == "ios" {
			link = link.with_ios("14");
		}
		link.link();
	} else {
		println!(
			"cargo:warning=tauri-plugin-self: Swift bridge skipped (target_os not macos/ios)"
		);
	}

	tauri_plugin::Builder::new(COMMANDS).build();
}

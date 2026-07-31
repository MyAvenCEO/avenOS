fn main() {
	const COMMANDS: &[&str] = &[
		"register",
		"public_key",
		"unlock",
		"peer_status",
		"signer_did",
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
		"vault_ui_settings_get",
		"vault_ui_settings_set_locale",
	];

	let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
	let target_abi = std::env::var("CARGO_CFG_TARGET_ABI").unwrap_or_default();
	let ios_sim = target_os == "ios" && target_abi == "sim";
	if matches!(target_os.as_str(), "macos" | "ios") && !ios_sim {
		let mut link = swift_rs::SwiftLinker::new("13").with_package("SelfBridge", "swift-lib");
		if target_os == "ios" {
			link = link.with_ios("14");
			// Xcode's "Build Rust Code" phase exports SDKROOT=iphoneos. SwiftPM must parse
			// Package.swift for the host (macOS); leaving SDKROOT set breaks manifest compile.
			std::env::remove_var("SDKROOT");
		}
		link.link();
	} else if ios_sim {
		println!(
			"cargo:warning=tauri-plugin-self: Swift bridge skipped (iOS Simulator uses dev_insecure identity)"
		);
	} else {
		println!(
			"cargo:warning=tauri-plugin-self: Swift bridge skipped (target_os not macos/ios)"
		);
	}

	tauri_plugin::Builder::new(COMMANDS).build();
}

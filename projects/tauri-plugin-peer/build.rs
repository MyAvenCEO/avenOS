fn main() {
	const COMMANDS: &[&str] = &[
		"peer_transport_status",
		"peer_swarm_retry",
		"peer_invite_create",
		"peer_invite_accept",
		"peer_invite_cancel",
	];

	let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
	if matches!(target_os.as_str(), "macos" | "ios") {
		let mut link =
			swift_rs::SwiftLinker::new("13").with_package("NetworkPathBridge", "swift-lib");
		if target_os == "ios" {
			link = link.with_ios("14");
			std::env::remove_var("SDKROOT");
		}
		link.link();
	}

	tauri_plugin::Builder::new(COMMANDS).build();
}

fn main() {
	const COMMANDS: &[&str] = &[
		"peer_transport_status",
		"peer_invite_create",
		"peer_invite_accept",
		"peer_invite_cancel",
	];

	tauri_plugin::Builder::new(COMMANDS).build();
}

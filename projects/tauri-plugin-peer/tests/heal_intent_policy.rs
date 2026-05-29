//! Heal intent policy — coordinator reset gate.

use groove::sync_manager::ClientId;
use tauri_plugin_peer::PeerLinkCoordinator;
use uuid::Uuid;

#[tokio::test]
async fn coordinator_may_reset_when_idle() {
	let coord = PeerLinkCoordinator::new();
	assert!(coord.may_global_reset().await);
}

#[tokio::test]
async fn handshaking_with_worker_blocks_reset() {
	let coord = PeerLinkCoordinator::new();
	let pk = [1u8; 32];
	let cid = ClientId(Uuid::new_v4());
	coord
		.set_transport_up(pk, cid, "did:key:z6Mkhs".into())
		.await;
	coord
		.set_handshaking(pk, cid, "did:key:z6Mkhs".into())
		.await;
	coord.register_worker(pk, cid).await;
	assert!(!coord.may_global_reset().await);
}

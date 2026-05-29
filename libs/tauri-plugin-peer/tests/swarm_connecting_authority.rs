//! SwarmConnecting phase blocks global reset and suppresses transport.

use tauri_plugin_peer::PeerLinkCoordinator;

#[tokio::test]
async fn swarm_connecting_blocks_global_reset() {
	let coord = PeerLinkCoordinator::new();
	let pk = [9u8; 32];
	coord
		.set_swarm_connecting(pk, "did:key:z6Mkswarm".into())
		.await;
	assert!(coord.should_suppress_transport_sync(&pk));
	assert!(!coord.may_global_reset().await);
}

#[tokio::test]
async fn establishing_includes_swarm_connecting_dids() {
	let coord = PeerLinkCoordinator::new();
	let pk = [10u8; 32];
	coord
		.set_swarm_connecting(pk, "did:key:z6Mkest".into())
		.await;
	let est = coord.snapshot_establishing_dids().await;
	assert!(est.contains("did:key:z6Mkest"));
}

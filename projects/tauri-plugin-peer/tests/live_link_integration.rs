//! Integration tests for LiveLinkRegistry (colocated per first-principles TDD).

use groove::sync_manager::ClientId;
use tauri_plugin_peer::PeerLinkCoordinator;
use uuid::Uuid;

#[tokio::test]
async fn mux_ready_count_tracks_phase_transitions() {
	let reg = PeerLinkCoordinator::new();
	let pk = [3u8; 32];
	let cid = ClientId(Uuid::new_v4());
	reg.set_handshaking(pk, cid, "did:key:z6Mkabc".into())
		.await;
	assert_eq!(reg.mux_ready_count().await, 0);
	reg.set_mux_ready(pk, None).await;
	assert_eq!(reg.mux_ready_count().await, 1);
	assert!(reg.is_mux_ready_by_did("did:key:z6Mkabc").await);
	reg.clear_all().await;
	assert_eq!(reg.mux_ready_count().await, 0);
}

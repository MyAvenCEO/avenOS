//! Pairing → live → teardown transitions for [`PeerLinkCoordinator`].

use groove::sync_manager::ClientId;
use tauri_plugin_peer::{PeerLinkCoordinator, PeerLinkPhase, PeerTransportMode};
use uuid::Uuid;

#[tokio::test]
async fn pairing_to_live_then_clear() {
	let coord = PeerLinkCoordinator::new();
	let pk = [7u8; 32];
	let cid = ClientId(Uuid::new_v4());
	let did = "did:key:z6Mkpairlive".to_string();

	coord.set_transport_up(pk, cid, did.clone()).await;
	assert_eq!(coord.phase_for_pk(&pk).await, Some(PeerLinkPhase::TransportUp));
	assert!(coord.should_suppress_transport_sync(&pk));

	coord.set_handshaking(pk, cid, did.clone()).await;
	assert_eq!(coord.phase_for_pk(&pk).await, Some(PeerLinkPhase::Handshaking));

	coord
		.set_mux_ready(pk, Some(PeerTransportMode::Lan))
		.await;
	assert_eq!(coord.phase_for_pk(&pk).await, Some(PeerLinkPhase::Live));
	assert_eq!(coord.mux_ready_count().await, 1);
	assert!(coord.is_mux_ready_by_did(&did).await);

	coord.clear(&pk).await;
	assert_eq!(coord.phase_for_pk(&pk).await, None);
	assert!(!coord.should_suppress_transport_sync(&pk));
}

#[tokio::test]
async fn in_flight_blocks_global_heal_drain_semantics() {
	let coord = PeerLinkCoordinator::new();
	let pk = [8u8; 32];
	let cid = ClientId(Uuid::new_v4());
	coord
		.set_handshaking(pk, cid, "did:key:z6Mkinflight".into())
		.await;
	assert!(coord.any_in_flight().await);
	assert_eq!(coord.snapshot_in_flight_dids().await.len(), 1);
	assert_eq!(coord.mux_ready_count().await, 0);
}

#[tokio::test]
async fn link_down_backoff_then_clear() {
	let coord = PeerLinkCoordinator::new();
	let pk = [12u8; 32];
	let cid = ClientId(Uuid::new_v4());
	coord
		.set_handshaking(pk, cid, "did:key:z6Mkdown".into())
		.await;
	coord.set_mux_ready(pk, None).await;
	coord.set_backoff(pk).await;
	assert_eq!(coord.phase_for_pk(&pk).await, Some(PeerLinkPhase::Backoff));
	assert!(!coord.should_suppress_transport_sync(&pk));
	coord.clear(&pk).await;
	assert!(coord.phase_for_pk(&pk).await.is_none());
}

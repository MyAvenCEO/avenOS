//! LiveLinkRegistry phase is the single authority for linked/sync UI counts.

use groove::sync_manager::ClientId;
use tauri_plugin_peer::PeerLinkCoordinator;
use tauri_plugin_peer::PeerTransportMode;
use uuid::Uuid;

#[tokio::test]
async fn handshaking_excluded_from_linked_snapshot() {
	let reg = PeerLinkCoordinator::new();
	let pk = [9u8; 32];
	let cid = ClientId(Uuid::new_v4());
	reg.set_handshaking(pk, cid, "did:key:z6Mkhandshake".into())
		.await;
	assert_eq!(reg.mux_ready_count().await, 0);
	assert_eq!(reg.handshaking_count().await, 1);
	assert!(reg.snapshot_mux_ready_dids().await.is_empty());
	assert!(reg.snapshot_mux_ready_clients().await.is_empty());
}

#[tokio::test]
async fn mux_ready_only_after_explicit_promotion() {
	let reg = PeerLinkCoordinator::new();
	let pk = [10u8; 32];
	let cid = ClientId(Uuid::new_v4());
	reg.set_handshaking(pk, cid, "did:key:z6Mkmux".into()).await;
	reg.set_mux_ready(pk, Some(PeerTransportMode::Relay)).await;
	assert_eq!(reg.mux_ready_count().await, 1);
	assert!(reg.is_mux_ready_by_client(cid).await);
	assert!(reg.is_mux_ready_by_did("did:key:z6Mkmux").await);
}

#[tokio::test]
async fn send_path_loss_demotes_without_full_clear() {
	let reg = PeerLinkCoordinator::new();
	let pk = [11u8; 32];
	let cid = ClientId(Uuid::new_v4());
	reg.set_handshaking(pk, cid, "did:key:z6Mksend".into()).await;
	reg.set_mux_ready(pk, Some(PeerTransportMode::Punched)).await;
	reg.demote_to_handshaking(pk).await;
	assert_eq!(reg.mux_ready_count().await, 0);
	assert_eq!(reg.handshaking_count().await, 1);
	assert!(!reg.is_mux_ready_by_client(cid).await);
}

//! The transport seam — plan §9 T4. A frame sent on endpoint A arrives at B's
//! `recv_inbound`, tagged with A's source. Proves the `SyncTransport` seam end
//! to end with zero networking, so the frontier protocol can run on it.

use groove::sync_transport::{LoopbackTransport, SyncTransport};
use groove::{ClientId, Source, SyncPayload};
use groove::SyncTargetId;

#[tokio::test]
async fn loopback_delivers_frame() {
    let a_source = Source::Client(ClientId::new());
    let b_source = Source::Client(ClientId::new());
    let (a, b) = LoopbackTransport::pair(a_source.clone(), b_source);

    // B's inbox starts empty.
    assert!(b.recv_inbound().await.is_none());

    // A sends a frame → it lands in B's inbox, tagged as coming from A.
    let payload = SyncPayload::BatchFateNeeded { batch_ids: vec![] };
    a.send_to(SyncTargetId::peer_did("did:key:b"), payload.clone())
        .await
        .expect("loopback send");

    assert_eq!(b.pending(), 1);
    let frame = b.recv_inbound().await.expect("frame delivered");
    assert_eq!(frame.source, a_source);
    assert_eq!(frame.payload, payload);

    // Drained — the seam does not duplicate.
    assert!(b.recv_inbound().await.is_none());
}

#[tokio::test]
async fn loopback_is_directional() {
    let a_source = Source::Client(ClientId::new());
    let b_source = Source::Client(ClientId::new());
    let (a, b) = LoopbackTransport::pair(a_source, b_source.clone());

    // B → A does not leak into B's own inbox.
    b.send_to(SyncTargetId::peer_did("did:key:a"), SyncPayload::BatchFateNeeded { batch_ids: vec![] })
        .await
        .expect("loopback send");
    assert_eq!(b.pending(), 0);
    let frame = a.recv_inbound().await.expect("frame delivered to A");
    assert_eq!(frame.source, b_source);
}

//! Dev TCP transport — real localhost sockets, identity handshake, framed
//! delivery (plan §8 M1 step 7, the dev stand-in for peeroxide).

use groove::sync_transport::SyncTransport;
use groove::{ClientId, Source, SyncPayload, SyncTargetId, TcpSyncTransport};
use tokio::net::TcpListener;

#[tokio::test]
async fn tcp_transport_handshakes_and_round_trips() {
    let a_id = ClientId::new();
    let b_id = ClientId::new();

    // Pre-bind an ephemeral port so the dialer knows where to connect.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap().to_string();

    // A accepts while B dials — the handshake is bidirectional, so run concurrently.
    let a_task = tokio::spawn(async move { TcpSyncTransport::accept(listener, a_id).await.unwrap() });
    let b = TcpSyncTransport::dial(&addr, b_id).await.unwrap();
    let a = a_task.await.unwrap();

    // Each side learned the other's identity from the handshake.
    assert_eq!(a.remote_client_id(), b_id);
    assert_eq!(b.remote_client_id(), a_id);

    // A → B: the frame arrives at B, tagged as coming from A (its registered peer).
    let payload = SyncPayload::BatchFateNeeded { batch_ids: vec![] };
    a.send_to(SyncTargetId::Client(b_id), payload.clone())
        .await
        .expect("send");
    let frame = b.recv_inbound().await.expect("frame delivered");
    assert_eq!(frame.source, Source::Client(a_id));
    assert_eq!(frame.payload, payload);

    // And the reverse direction, independently.
    b.send_to(SyncTargetId::Client(a_id), payload.clone())
        .await
        .expect("send");
    let frame = a.recv_inbound().await.expect("frame delivered to A");
    assert_eq!(frame.source, Source::Client(b_id));
}

//! Single blind-relay UDX transport invariants (first-principles collapse).
//!
//! The client now runs ONE reusable UDP socket: DHT requests, the Noise IK
//! handshake, and the blind-relay UDX stream all egress from the same local
//! port. That single-socket guarantee is what makes the relay's observed
//! reflexive `from` equal the UDX stream's reflexive source, which is the
//! structural fix for relay-only pairing (no more two-socket reflexive split).

use aven_p2p::dht::rpc::{spawn, DhtConfig};
use libudx::UdxRuntime;

/// A DHT node binds exactly one reusable UDP socket: the port used for DHT
/// request egress (`local_port`) must equal the port of the `listen_socket`
/// that subsequently carries UDX traffic.
#[tokio::test]
async fn dht_request_and_listen_socket_share_one_local_port() {
    let rt = UdxRuntime::new().expect("udx runtime");

    let mut cfg = DhtConfig::default();
    cfg.bootstrap = vec![];
    cfg.port = 0;
    cfg.host = "127.0.0.1".to_string();
    cfg.bind_host = None;
    cfg.ephemeral = Some(false);

    let (task, handle) = spawn(&rt, cfg).await.expect("spawn dht");

    let request_port = handle.local_port().await.expect("local port");
    assert_ne!(request_port, 0, "node must bind a concrete UDP port");

    let listen = handle
        .listen_socket()
        .await
        .expect("listen_socket command")
        .expect("single reusable socket must be present");
    let listen_addr = listen.local_addr().await.expect("listen local addr");

    assert_eq!(
        listen_addr.port(),
        request_port,
        "single-socket invariant: DHT request egress and the UDX listen socket must share one local port",
    );

    handle.destroy().await.expect("destroy");
    task.abort();
}

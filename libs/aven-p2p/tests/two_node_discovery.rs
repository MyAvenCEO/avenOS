//! Repro for the single-socket discovery regression.
//!
//! A bootstrap "server" node (non-ephemeral, fixed identity) plus an ephemeral
//! client that bootstraps to it over localhost. After the single-socket
//! collapse the live app reported `announce closest=0` / `discoveredPeerTotal=0`.
//! This exercises the same path locally: the client must discover the server
//! (find_node returns at least the bootstrap node).

use aven_p2p::dht::rpc::{spawn, DhtConfig};
use libudx::UdxRuntime;

#[tokio::test]
async fn ephemeral_client_discovers_bootstrap_server_single_socket() {
    let server_rt = UdxRuntime::new().expect("server rt");
    let mut server_cfg = DhtConfig::default();
    server_cfg.bootstrap = vec![];
    server_cfg.port = 0;
    server_cfg.host = "127.0.0.1".to_string();
    server_cfg.ephemeral = Some(false);
    let (server_task, server) = spawn(&server_rt, server_cfg).await.expect("spawn server");
    server.bootstrapped().await.expect("server bootstrap");
    let server_port = server.local_port().await.expect("server port");
    assert_ne!(server_port, 0, "server must bind a concrete port");

    let client_rt = UdxRuntime::new().expect("client rt");
    let mut client_cfg = DhtConfig::default();
    client_cfg.bootstrap = vec![format!("127.0.0.1:{server_port}")];
    client_cfg.port = 0;
    client_cfg.host = "127.0.0.1".to_string();
    // ephemeral resolves to true (bootstrap present) — matches the app client.
    let (client_task, client) = spawn(&client_rt, client_cfg).await.expect("spawn client");
    client.bootstrapped().await.expect("client bootstrap");

    // Give the client a moment to settle its routing table from bootstrap.
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    let replies = client.find_node([7u8; 32]).await.expect("find_node");

    assert!(
        !replies.is_empty(),
        "single-socket ephemeral client must discover the bootstrap server (closest>=1), got 0",
    );

    let _ = client.destroy().await;
    let _ = server.destroy().await;
    client_task.abort();
    server_task.abort();
}

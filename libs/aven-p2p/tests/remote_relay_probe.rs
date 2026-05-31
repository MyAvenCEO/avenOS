//! Manual probe against the live relay's DHT. Ignored by default (needs network).
//!
//! Run with:
//!   cargo test --test remote_relay_probe -- --ignored --nocapture

use aven_p2p::dht::rpc::{spawn, DhtConfig};
use libudx::UdxRuntime;

use aven_p2p::dht::hyperdht::{self, HyperDhtConfig, KeyPair};

#[tokio::test]
#[ignore]
async fn probe_live_relay_dht_responds() {
    let rt = UdxRuntime::new().expect("rt");
    let mut cfg = DhtConfig::default();
    cfg.bootstrap = vec!["137.66.21.59@relay.aven.ceo:49737".to_string()];
    cfg.port = 0;
    cfg.host = "0.0.0.0".to_string();

    let (task, handle) = spawn(&rt, cfg).await.expect("spawn");
    handle.bootstrapped().await.expect("bootstrapped");

    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

    let replies = handle.find_node([9u8; 32]).await.expect("find_node");
    eprintln!("RELAY_PROBE find_node closest={}", replies.len());
    for r in &replies {
        eprintln!("  node from={}:{}", r.from.host, r.from.port);
    }

    assert!(
        !replies.is_empty(),
        "live relay must respond to FIND_NODE (closest>=1); got 0 — relay unreachable or not serving DHT",
    );

    let _ = handle.destroy().await;
    task.abort();
}

/// Full-stack probe using the exact `hyperdht` announce (LOOKUP + commit) path
/// the app uses, against the live relay.
#[tokio::test]
#[ignore]
async fn probe_live_relay_announce_lookup() {
    let rt = UdxRuntime::new().expect("rt");
    let mut cfg = HyperDhtConfig::default();
    cfg.dht.bootstrap = vec!["137.66.21.59@relay.aven.ceo:49737".to_string()];
    cfg.dht.port = 0;
    cfg.dht.host = "0.0.0.0".to_string();

    let (task, handle, _server_rx) = hyperdht::spawn(&rt, cfg).await.expect("spawn");
    handle.bootstrapped().await.expect("bootstrapped");
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

    let kp = KeyPair::generate();
    let topic = [0x90u8; 32];
    let result = handle.announce(topic, &kp, &[]).await.expect("announce");
    eprintln!(
        "RELAY_PROBE announce(LOOKUP) closest={}",
        result.closest_nodes.len()
    );

    assert!(
        !result.closest_nodes.is_empty(),
        "live relay must answer LOOKUP/announce (closest>=1); got 0",
    );

    task.abort();
}

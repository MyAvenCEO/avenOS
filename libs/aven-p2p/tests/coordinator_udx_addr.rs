//! Relay coordinator UDX target must not follow relayed client reflexive `peer_address`.

use aven_p2p::dht::hyperdht::pick_relay_coordinator_udx_addr;
use aven_p2p::dht::hyperdht_messages::{FIREWALL_UNKNOWN, NoisePayload};
use aven_p2p::dht::messages::Ipv4Peer;

const RELAY_SIGNAL_PORT: u16 = 49737;

#[test]
fn pick_relay_coordinator_ignores_relayed_client_reflexive() {
    let handshake_relay = Ipv4Peer {
        host: "137.66.21.59".into(),
        port: RELAY_SIGNAL_PORT,
    };
    let client_reflexive = Ipv4Peer {
        host: "176.2.213.40".into(),
        port: 50638,
    };
    let remote = NoisePayload {
        version: 1,
        error: 0,
        firewall: FIREWALL_UNKNOWN,
        holepunch: None,
        addresses4: vec![],
        addresses6: vec![],
        udx: None,
        secret_stream: None,
        relay_through: None,
        relay_addresses: None,
    };
    let picked = pick_relay_coordinator_udx_addr(
        &handshake_relay,
        &[],
        &remote,
        None,
        &client_reflexive,
    );
    assert_eq!(picked.host, "137.66.21.59");
    assert_eq!(picked.port, RELAY_SIGNAL_PORT);
    assert_ne!(picked.host, client_reflexive.host);
}

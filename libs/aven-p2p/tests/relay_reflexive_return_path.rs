//! Relay return-path invariant: the responder always replies to the observed
//! reflexive `from`, never to a peer-advertised LAN address.
//!
//! With a single reusable socket the client's UDX stream egresses from the same
//! reflexive source as its Noise handshake, so the relay must connect its
//! responder UDX back to exactly that `from`. This test drives a real IK
//! initiation and asserts `client_address == from` even when the client
//! advertises a different (LAN) address in its Noise payload.

use aven_p2p::dht::hyperdht::{finish_server_noise_ik_handshake, KeyPair, ServerConfig};
use aven_p2p::dht::hyperdht_messages::{
    HandshakeMessage, NoisePayload, SecretStreamInfo, UdxInfo, FIREWALL_OPEN, MODE_FROM_CLIENT,
};
use aven_p2p::dht::messages::Ipv4Peer;
use aven_p2p::dht::noise::generate_keypair;
use aven_p2p::dht::noise_wrap::NoiseWrap;

#[test]
fn responder_replies_to_reflexive_from_not_advertised_lan() {
    let server = ServerConfig::new(KeyPair::generate(), FIREWALL_OPEN);

    let client_kp = generate_keypair();
    let mut initiator = NoiseWrap::new_initiator(client_kp, server.key_pair.public_key);

    // Client advertises a private LAN address that is NOT how the relay sees it.
    let advertised_lan = Ipv4Peer {
        host: "192.168.1.50".to_string(),
        port: 4242,
    };
    let client_payload = NoisePayload {
        version: 1,
        error: 0,
        firewall: FIREWALL_OPEN,
        addresses4: vec![advertised_lan.clone()],
        addresses6: vec![],
        udx: Some(UdxInfo {
            version: 1,
            reusable_socket: true,
            id: 7,
            seq: 0,
        }),
        secret_stream: Some(SecretStreamInfo { version: 1 }),
        relay_through: None,
        relay_addresses: None,
    };
    let noise = initiator.send(&client_payload).expect("client IK initiation");

    // The reflexive source the relay actually observes for this datagram.
    let from = Ipv4Peer {
        host: "203.0.113.7".to_string(),
        port: 51820,
    };

    let msg = HandshakeMessage {
        mode: MODE_FROM_CLIENT,
        noise,
        peer_address: Some(advertised_lan.clone()),
        relay_address: None,
    };

    let outcome = finish_server_noise_ik_handshake(&server, msg, &from, None)
        .expect("responder finishes IK handshake");

    assert_eq!(
        outcome.establish.client_address, from,
        "responder must target the observed reflexive `from`, not the advertised LAN address",
    );
    assert_ne!(
        outcome.establish.client_address, advertised_lan,
        "advertised LAN address must never be used as the UDX return target",
    );
}

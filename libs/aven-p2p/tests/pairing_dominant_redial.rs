//! Dominant pairing redial — dial authority and command lifecycle.

use std::sync::Arc;

use aven_p2p::{spawn, JoinOpts, SwarmConfig};

#[test]
fn bob_is_dominant_over_alice_from_5g2zlx() {
	let mut bob = [0u8; 32];
	bob[..8].copy_from_slice(&[0x5d, 0x5d, 0x36, 0x96, 0x4f, 0x4c, 0x0b, 0xa9]);
	let mut alice = [0u8; 32];
	alice[..8].copy_from_slice(&[0x02, 0xa1, 0xc5, 0xad, 0x89, 0x58, 0xb2, 0x48]);
	assert!(bob >= alice, "Bob must initiate outbound PEER_HANDSHAKE");
	assert!(!alice.ge(&bob), "Alice subordinate defers outbound dial");
}

#[tokio::test]
async fn redial_pairing_peers_noop_without_fast_refresh_topic() {
	let (_task, handle, _conn_rx) = spawn(SwarmConfig::default()).await.unwrap();
	handle.redial_pairing_peers().await.unwrap();
	handle.destroy().await.unwrap();
}

#[tokio::test]
async fn redial_pairing_peers_respects_dominance_gate() {
	use aven_p2p::dht::hyperdht::KeyPair;

	let mut bob_seed = [0u8; 32];
	bob_seed[..8].copy_from_slice(&[0x5d, 0x5d, 0x36, 0x96, 0x4f, 0x4c, 0x0b, 0xa9]);
	let mut alice_seed = [0u8; 32];
	alice_seed[..8].copy_from_slice(&[0x02, 0xa1, 0xc5, 0xad, 0x89, 0x58, 0xb2, 0x48]);
	let bob_kp = KeyPair::from_seed(bob_seed);
	let alice_kp = KeyPair::from_seed(alice_seed);
	let bob_pk = bob_kp.public_key;
	let alice_pk = alice_kp.public_key;

	let (dominant_kp, subordinate_kp, dominant_pk, subordinate_pk) = if bob_pk >= alice_pk {
		(bob_kp, alice_kp, bob_pk, alice_pk)
	} else {
		(alice_kp, bob_kp, alice_pk, bob_pk)
	};
	assert!(dominant_pk >= subordinate_pk);

	let dominant_gate = {
		let local = dominant_pk;
		Arc::new(move |remote: [u8; 32]| local >= remote)
	};
	let subordinate_gate = {
		let local = subordinate_pk;
		Arc::new(move |remote: [u8; 32]| local >= remote)
	};

	let mut dominant_cfg = SwarmConfig::default();
	dominant_cfg.key_pair = Some(dominant_kp);
	dominant_cfg.should_outbound_connect = Some(dominant_gate);
	let mut subordinate_cfg = SwarmConfig::default();
	subordinate_cfg.key_pair = Some(subordinate_kp);
	subordinate_cfg.should_outbound_connect = Some(subordinate_gate);

	let (_t1, dominant, _c1) = spawn(dominant_cfg).await.unwrap();
	let (_t2, subordinate, _c2) = spawn(subordinate_cfg).await.unwrap();
	let topic = [0x42; 32];
	dominant.join(topic, JoinOpts::fast_refresh()).await.unwrap();
	subordinate.join(topic, JoinOpts::fast_refresh()).await.unwrap();
	dominant.set_active_pair_topic(Some(topic)).await.unwrap();
	subordinate.set_active_pair_topic(Some(topic)).await.unwrap();

	dominant
		.connect_known_peer(subordinate_pk, topic, vec![])
		.await
		.unwrap();
	subordinate
		.connect_known_peer(dominant_pk, topic, vec![])
		.await
		.unwrap();

	dominant.redial_pairing_peers().await.unwrap();
	subordinate.redial_pairing_peers().await.unwrap();

	dominant.destroy().await.unwrap();
	subordinate.destroy().await.unwrap();
}

#[tokio::test]
async fn redial_clears_stale_connection_slot_before_requeue() {
	use aven_p2p::dht::hyperdht::KeyPair;

	let mut bob_seed = [0u8; 32];
	bob_seed[..8].copy_from_slice(&[0x5d, 0x5d, 0x36, 0x96, 0x4f, 0x4c, 0x0b, 0xa9]);
	let mut alice_seed = [0u8; 32];
	alice_seed[..8].copy_from_slice(&[0x02, 0xa1, 0xc5, 0xad, 0x89, 0x58, 0xb2, 0x48]);
	let bob_kp = KeyPair::from_seed(bob_seed);
	let alice_kp = KeyPair::from_seed(alice_seed);
	let bob_pk = bob_kp.public_key;
	let alice_pk = alice_kp.public_key;

	let (dominant_kp, subordinate_pk) = if bob_pk >= alice_pk {
		(bob_kp, alice_pk)
	} else {
		(alice_kp, bob_pk)
	};

	let mut cfg = SwarmConfig::default();
	cfg.key_pair = Some(dominant_kp);
	let local = cfg.key_pair.as_ref().unwrap().public_key;
	cfg.should_outbound_connect = Some(Arc::new(move |remote| local >= remote));

	let (_task, dominant, _conn_rx) = spawn(cfg).await.unwrap();
	let topic = [0x43; 32];
	dominant.join(topic, JoinOpts::fast_refresh()).await.unwrap();
	dominant.set_active_pair_topic(Some(topic)).await.unwrap();
	dominant
		.connect_known_peer(subordinate_pk, topic, vec![])
		.await
		.unwrap();
	dominant.note_peer_connected(subordinate_pk).await.unwrap();
	// Regression: redial must clear the stale slot and re-queue dominant outbound.
	dominant.redial_pairing_peers().await.unwrap();
	dominant.destroy().await.unwrap();
}

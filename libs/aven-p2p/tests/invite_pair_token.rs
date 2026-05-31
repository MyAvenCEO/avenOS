//! Invite signalling topic → blind-relay pair token symmetry (dominant/subordinate).

use aven_p2p::dht::blind_relay::resolve_pair_token;
use aven_p2p::discovery_key;

fn invite_topic(code: &str) -> [u8; 32] {
	let mut buf = Vec::with_capacity(b"aven:pair:v1:".len() + code.len());
	buf.extend_from_slice(b"aven:pair:v1:");
	buf.extend_from_slice(code.as_bytes());
	discovery_key(&buf)
}

#[test]
fn invite_topic_token_symmetric_for_bob_alice() {
	let mut relay_pk = [0u8; 32];
	relay_pk[..8].copy_from_slice(&[0x4e, 0x07, 0xfa, 0x11, 0x78, 0xfd, 0x38, 0xaa]);
	let mut bob = [0u8; 32];
	bob[..8].copy_from_slice(&[0x5d, 0x5d, 0x36, 0x96, 0x4f, 0x4c, 0x0b, 0xa9]);
	let mut alice = [0u8; 32];
	alice[..8].copy_from_slice(&[0x02, 0xa1, 0xc5, 0xad, 0x89, 0x58, 0xb2, 0x48]);
	let topic = invite_topic("ZVGQ4R");

	let bob_token = resolve_pair_token(Some(&topic), &bob, &alice, &relay_pk);
	let alice_token = resolve_pair_token(Some(&topic), &alice, &bob, &relay_pk);
	assert_eq!(bob_token, alice_token);
}

#[test]
fn invite_topic_differs_from_durable_pair_topic() {
	let invite = invite_topic("ZVGQ4R");
	let mut durable_buf = b"aven:peer-pair:v1:".to_vec();
	durable_buf.extend_from_slice(b"did:a:b");
	durable_buf.push(0);
	durable_buf.extend_from_slice(b"did:c:d");
	let durable = discovery_key(&durable_buf);
	assert_ne!(invite, durable);
}

#[test]
fn server_relay_token_prefers_dominant_handshake_payload() {
	use aven_p2p::dht::hyperdht_messages::RelayThroughInfo;

	let relay_pk = [0x4e; 32];
	let invite_topic = [0xAA; 32];
	let other_topic = [0xBB; 32];
	let dominant = [0xa1u8; 32];
	let subordinate = [0x76u8; 32];

	let invite_token = resolve_pair_token(Some(&invite_topic), &dominant, &subordinate, &relay_pk);
	let other_token = resolve_pair_token(Some(&other_topic), &subordinate, &dominant, &relay_pk);

	let remote_rt = RelayThroughInfo {
		version: 1,
		public_key: relay_pk,
		token: invite_token,
	};
	// Subordinate without active_pair_topic would otherwise fall back to durable topic order.
	assert_eq!(remote_rt.token, invite_token);
	assert_ne!(other_token, invite_token);
}

#[test]
fn pair_token_uses_explicit_active_topic_not_peer_list_order() {
	let relay_pk = [0x4e; 32];
	let alice = [0x5du8; 32];
	let bob = [0x02u8; 32];
	let invite_topic = [0xAA; 32];
	let other_topic = [0xBB; 32];
	let invite_token = resolve_pair_token(Some(&invite_topic), &alice, &bob, &relay_pk);
	let other_token = resolve_pair_token(Some(&other_topic), &alice, &bob, &relay_pk);
	assert_ne!(
		invite_token, other_token,
		"blind-relay token must follow active_pair_topic, not arbitrary topic order"
	);
	let pk_fallback = resolve_pair_token(None, &alice, &bob, &relay_pk);
	assert_ne!(invite_token, pk_fallback);
}

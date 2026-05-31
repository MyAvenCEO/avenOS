//! Inbound PEER_HANDSHAKE must spawn blind-relay `pair(true)` before the Noise reply.
//!
//! Regression: deferring or suppressing the subordinate half after sending the reply left
//! the dominant on `pair(false)` until connect timeout (no matching initiator on coordinator).

use aven_p2p::dht::blind_relay::resolve_pair_token;
use aven_p2p::dht::hyperdht_messages::RelayThroughInfo;

#[test]
fn subordinate_token_follows_dominant_handshake_without_active_pair_topic() {
	let relay_pk = [0x4e; 32];
	let invite_topic = [0xe9, 0x09, 0xc3, 0x49, 0x87, 0x3c, 0x7c, 0x00].repeat(4);
	let invite_topic: [u8; 32] = {
		let mut t = [0u8; 32];
		t.copy_from_slice(&invite_topic[..32]);
		t
	};
	let dominant = [0x5bu8; 32];
	let subordinate = [0x03u8; 32];

	let dominant_token =
		resolve_pair_token(Some(&invite_topic), &dominant, &subordinate, &relay_pk);
	let remote_rt = RelayThroughInfo {
		version: 1,
		public_key: relay_pk,
		token: dominant_token,
	};
	// Subordinate resolves the same token from the dominant payload even when
	// `active_pair_topic` is not armed yet (invite-accept race).
	assert_eq!(remote_rt.token, dominant_token);
	assert_eq!(
		resolve_pair_token(Some(&invite_topic), &subordinate, &dominant, &relay_pk),
		dominant_token,
	);
}

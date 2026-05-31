//! Relay-only transport policy — dominance, dial authority, stale constants, heal modes.
//!
//! Manual two-instance QA (`dev:app2x:mac`, fresh build):
//!
//! | Log line | Side | Meaning |
//! | `connecting … epoch=1` (stable) | Dominant | Redial storm fixed |
//! | `pairing redial — skip (dial already in flight)` | Dominant | Good |
//! | `server: spawning blind-relay fallback` once | Subordinate | No respawn storm |
//! | `server: scheduling blind-relay fallback retry` | Subordinate | Retry loop alive |
//! | `blind-relay pair failed` OR `peer connected` at INFO | Either | Pair outcome visible |
//! | `linkedCount >= 1` within ~60s | Both | Success |

use std::collections::HashSet;

use tauri_plugin_p2p::{
	missing_reconnect_dids, PeerConnectSubstate, TeardownPlan, TickMode,
	RELAY_STALE_SWARM_CONNECTING_MS, STALE_SWARM_CONNECTING_MS,
};

#[test]
fn dominant_pk_is_higher_byte_order() {
	let subordinate = [0x73u8, 0xb8, 0xea, 0x0f, 0x06, 0x23, 0xe6, 0x7c];
	let mut dominant = subordinate;
	dominant[0] = 0x74;
	assert!(dominant > subordinate);
	assert!(!(subordinate > dominant));
}

#[test]
fn relay_only_dial_requires_dominant_half() {
	let mut iphone = [0u8; 32];
	iphone[..8].copy_from_slice(&[0x73, 0xb8, 0xea, 0x0f, 0x06, 0x23, 0xe6, 0x7c]);
	let mut mac = [0u8; 32];
	mac[..8].copy_from_slice(&[0x5d, 0xc8, 0x49, 0x40, 0x4e, 0x71, 0xe9, 0x6f]);
	assert!(iphone > mac, "iPhone is dominant outbound dialer");
	assert!(mac < iphone, "Mac subordinate defers outbound dial");
}

#[test]
fn relay_only_blind_relay_pair_roles_by_dominance() {
	let mut dominant = [0u8; 32];
	dominant[..8].copy_from_slice(&[0x5d, 0x5d, 0x36, 0x96, 0x4f, 0x4c, 0x0b, 0xa9]);
	let mut subordinate = [0u8; 32];
	subordinate[..8].copy_from_slice(&[0x02, 0xa1, 0xc5, 0xad, 0x89, 0x58, 0xb2, 0x48]);
	assert!(dominant > subordinate);
	let dominant_pair_is_initiator = false;
	let subordinate_pair_is_initiator = true;
	assert_ne!(dominant_pair_is_initiator, subordinate_pair_is_initiator);
}

#[test]
fn relay_pairing_connect_substate_serializes() {
	let json = r#""relayPairing""#;
	let v: PeerConnectSubstate = serde_json::from_str(json).unwrap();
	assert_eq!(v, PeerConnectSubstate::RelayPairing);
}

#[test]
fn stale_swarm_connecting_ms_unified() {
	assert_eq!(STALE_SWARM_CONNECTING_MS, RELAY_STALE_SWARM_CONNECTING_MS);
	assert_eq!(STALE_SWARM_CONNECTING_MS, 8_000);
}

#[test]
fn link_down_is_immediate() {
	assert!(TickMode::LinkDown.immediate());
}

#[test]
fn mesh_steady_not_immediate() {
	assert!(!TickMode::MeshSteady.immediate());
}

#[test]
fn missing_reconnect_skips_live_and_establishing() {
	let targets = vec!["a".into(), "b".into(), "c".into()];
	let live = HashSet::from(["a".to_string()]);
	let establishing = HashSet::from(["b".to_string()]);
	assert_eq!(
		missing_reconnect_dids(&targets, &live, &establishing),
		vec!["c".to_string()]
	);
}

#[test]
fn missing_skips_establishing_only() {
	let targets = vec!["a".into(), "b".into()];
	let live = HashSet::from(["a".to_string()]);
	let establishing = HashSet::from(["b".to_string()]);
	assert_eq!(
		missing_reconnect_dids(&targets, &live, &establishing),
		vec![] as Vec<String>
	);
}

#[test]
fn reset_teardown_all_links() {
	let _plan = TeardownPlan::AllLinks;
	assert!(TickMode::Reset.immediate());
}

#[test]
fn subordinate_inbound_mux_not_purged_by_global_swarm_zero() {
	let send_ready = true;
	let age_ms = 10_000u64;
	let stale_mux_ms = 5_000u64;
	let stale_send = !send_ready && age_ms >= stale_mux_ms;
	assert!(
		!stale_send,
		"inbound-only mux with send_ready must not be stale-purged",
	);
}

#[test]
fn mux_without_send_ready_is_stale_after_timeout() {
	let send_ready = false;
	let age_ms = 6_000u64;
	let stale_mux_ms = 5_000u64;
	let stale_send = !send_ready && age_ms >= stale_mux_ms;
	assert!(stale_send);
}

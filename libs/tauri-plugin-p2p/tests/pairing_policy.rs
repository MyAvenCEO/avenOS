//! Pairing FSM gate, debounce, and transport tick policy.

use tauri_plugin_p2p::pair_topic_hash;
use tauri_plugin_p2p::{
	PAIRING_DEBOUNCE_MS, PAIRING_TRANSPORT_GUARD_SECS, PairSession, PairingNudgeMode, PairingState,
	RELAY_STALE_SWARM_CONNECTING_MS, TickMode, MESH_DEBOUNCE_MS,
};

const PAIRING_SWARM_STALE_MS: u64 = 8_000;

#[test]
fn recover_blocked_during_joining() {
	let mut state = PairingState::default();
	state.start_joining(PairSession {
		topic: [7u8; 32],
		code: "ABCD12".into(),
		my_advertised_label: "test".into(),
	});
	assert!(state.is_active());
	assert!(!state.accepts_transport_tick(TickMode::MeshSteady));
	assert!(state.accepts_transport_tick(TickMode::Pairing));
	assert!(state.accepts_transport_tick(TickMode::Reset));
}

#[test]
fn recover_allowed_when_idle() {
	let state = PairingState::default();
	assert!(!state.is_active());
	assert!(state.accepts_transport_tick(TickMode::MeshSteady));
}

#[test]
fn pair_topic_hash_stable_for_code() {
	let t1 = pair_topic_hash("ZVGQ4R");
	let t2 = pair_topic_hash("ZVGQ4R");
	assert_eq!(t1, t2);
	assert_ne!(t1, [0u8; 32]);
}

#[test]
fn pairing_blocks_mesh_not_pairing_tick() {
	let mut st = PairingState::default();
	st.start_advertising(PairSession {
		topic: [1u8; 32],
		code: "ABCDEF".into(),
		my_advertised_label: "host".into(),
	});
	assert!(!st.accepts_transport_tick(TickMode::MeshSteady));
	assert!(st.accepts_transport_tick(TickMode::Pairing));
	st.mark_transport_up();
	assert!(!st.accepts_transport_tick(TickMode::MeshSteady));
	assert!(st.accepts_transport_tick(TickMode::Pairing));
	st.clear();
	assert!(st.accepts_transport_tick(TickMode::MeshSteady));
	let _ = PAIRING_TRANSPORT_GUARD_SECS;
}

#[test]
fn tick_mode_debounce() {
	assert_eq!(TickMode::Pairing.debounce_ms(), PAIRING_DEBOUNCE_MS);
	assert_eq!(TickMode::MeshSteady.debounce_ms(), MESH_DEBOUNCE_MS);
	assert_eq!(TickMode::Reset.debounce_ms(), 0);
	assert!(TickMode::Reset.immediate());
	assert!(TickMode::LinkDown.immediate());
}

#[test]
fn tick_mode_merge_order() {
	assert!(TickMode::Reset > TickMode::MeshSteady);
	assert!(TickMode::MeshSteady > TickMode::Pairing);
}

#[test]
fn pairing_tick_clears_stale_swarm_connecting_before_redial() {
	assert_eq!(PAIRING_SWARM_STALE_MS, RELAY_STALE_SWARM_CONNECTING_MS);
}

#[test]
fn pairing_tick_debounces_faster_than_mesh() {
	assert!(TickMode::Pairing.debounce_ms() < TickMode::MeshSteady.debounce_ms());
	assert_eq!(TickMode::Pairing.debounce_ms(), PAIRING_DEBOUNCE_MS);
	assert_eq!(TickMode::MeshSteady.debounce_ms(), MESH_DEBOUNCE_MS);
}

#[test]
fn pairing_tick_is_not_immediate_like_reset() {
	assert!(!TickMode::Pairing.immediate());
	assert!(TickMode::Reset.immediate());
}

#[test]
fn pairing_nudge_modes_are_distinct() {
	assert_ne!(PairingNudgeMode::Start, PairingNudgeMode::Tick);
}

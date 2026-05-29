//! Pairing FSM blocks Recover during active invite.

use tauri_plugin_peer::HealIntent;
use tauri_plugin_peer::PairSession;
use tauri_plugin_peer::PairingState;

#[test]
fn recover_blocked_during_joining() {
	let mut state = PairingState::default();
	state.start_joining(PairSession {
		topic: [7u8; 32],
		code: "ABCD1234".into(),
		my_advertised_label: "test".into(),
	});
	assert!(state.is_active());
	assert!(!state.accepts_heal_intent(HealIntent::Recover));
	assert!(state.accepts_heal_intent(HealIntent::Rendezvous));
	assert!(state.accepts_heal_intent(HealIntent::Reset));
}

#[test]
fn recover_allowed_when_idle() {
	let state = PairingState::default();
	assert!(!state.is_active());
	assert!(state.accepts_heal_intent(HealIntent::Recover));
}

//! HealScheduler coalescing and debounce constants.

use tauri_plugin_peer::HealIntent;

#[test]
fn intent_priority_reset_wins() {
	assert_eq!(
		HealIntent::Rendezvous.merge(HealIntent::Reset),
		HealIntent::Reset
	);
	assert_eq!(
		HealIntent::Recover.merge(HealIntent::Rendezvous),
		HealIntent::Recover
	);
}

#[test]
fn debounce_ms_per_intent() {
	assert_eq!(HealIntent::Rendezvous.debounce_ms(), 8_000);
	assert_eq!(HealIntent::Recover.debounce_ms(), 12_000);
	assert_eq!(HealIntent::Reset.debounce_ms(), 0);
}

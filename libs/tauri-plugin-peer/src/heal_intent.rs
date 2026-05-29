//! Heal intent — rendezvous, recover, and reset select allowed side effects.

#![cfg(any(target_os = "macos", target_os = "ios"))]

use crate::peer_reconnect::{ReconnectOpts, TeardownPlan};

/// What a heal pass is allowed to do — replaces reason-string side-effect matrices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum HealIntent {
	/// Pairing DHT rendezvous only — never abort workers or prepare_reconnect.
	Rendezvous = 0,
	/// Mesh / path / foreground soft heal.
	Recover = 1,
	/// Pairing reset, confirmed dead link, empty allowlist drain.
	Reset = 2,
}

impl HealIntent {
	pub fn merge(self, other: Self) -> Self {
		self.max(other)
	}

	pub fn debounce_ms(self) -> u64 {
		match self {
			Self::Rendezvous => crate::peer_reconnect::PAIRING_DISCOVERY_DEBOUNCE_MS,
			Self::Recover => crate::peer_reconnect::MESH_NUDGE_DEBOUNCE_MS,
			Self::Reset => 0,
		}
	}

	pub fn exempt_from_debounce(self, opts: ReconnectOpts) -> bool {
		self == Self::Reset
			|| opts.path_changed
			|| opts.teardown_all_links
			|| opts.force_teardown
	}
}

/// Teardown plan from intent + coordinator snapshot — no missing_count heuristics.
pub fn plan_teardown_for_intent(
	intent: HealIntent,
	phantom_count: usize,
	mux_live: usize,
	establishing: usize,
	opts: ReconnectOpts,
) -> TeardownPlan {
	match intent {
		HealIntent::Rendezvous => {
			if phantom_count > 0 {
				TeardownPlan::NonLiveOnly
			} else {
				TeardownPlan::None
			}
		}
		HealIntent::Recover => {
			if mux_live > 0 || establishing > 0 {
				if phantom_count > 0 {
					return TeardownPlan::NonLiveOnly;
				}
				return TeardownPlan::None;
			}
			if phantom_count > 0 {
				TeardownPlan::NonLiveOnly
			} else {
				TeardownPlan::None
			}
		}
		HealIntent::Reset => {
			if opts.teardown_all_links {
				TeardownPlan::AllLinks
			} else if mux_live == 0 && establishing == 0 && opts.force_teardown {
				TeardownPlan::AllWorkers
			} else if phantom_count > 0 {
				TeardownPlan::NonLiveOnly
			} else {
				TeardownPlan::None
			}
		}
	}
}

pub fn allows_prepare_reconnect(intent: HealIntent, may_global_reset: bool) -> bool {
	may_global_reset && matches!(intent, HealIntent::Recover | HealIntent::Reset)
}

pub fn allows_worker_abort(intent: HealIntent, teardown: TeardownPlan) -> bool {
	matches!(intent, HealIntent::Reset)
		&& matches!(teardown, TeardownPlan::AllLinks | TeardownPlan::AllWorkers)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn intent_merge_picks_highest() {
		assert_eq!(
			HealIntent::Rendezvous.merge(HealIntent::Recover),
			HealIntent::Recover,
		);
		assert_eq!(
			HealIntent::Recover.merge(HealIntent::Reset),
			HealIntent::Reset,
		);
	}

	#[test]
	fn rendezvous_never_all_workers() {
		assert_eq!(
			plan_teardown_for_intent(HealIntent::Rendezvous, 0, 0, 0, ReconnectOpts::default()),
			TeardownPlan::None,
		);
	}

	#[test]
	fn recover_preserves_establishing() {
		assert_eq!(
			plan_teardown_for_intent(HealIntent::Recover, 0, 0, 1, ReconnectOpts::default()),
			TeardownPlan::None,
		);
	}

	#[test]
	fn reset_all_links_on_pairing_reset() {
		assert_eq!(
			plan_teardown_for_intent(
				HealIntent::Reset,
				0,
				0,
				0,
				ReconnectOpts::pairing_reset(),
			),
			TeardownPlan::AllLinks,
		);
	}

	#[test]
	fn prepare_reconnect_blocked_for_rendezvous() {
		assert!(!allows_prepare_reconnect(HealIntent::Rendezvous, true));
		assert!(allows_prepare_reconnect(HealIntent::Recover, true));
	}
}

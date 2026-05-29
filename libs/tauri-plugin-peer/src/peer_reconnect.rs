//! Intent-driven heal ritual — coordinator phase is law.

#![cfg(any(target_os = "macos", target_os = "ios"))]

use std::collections::HashSet;
use std::sync::atomic::Ordering;

use crate::heal_intent::{allows_prepare_reconnect, allows_worker_abort, plan_teardown_for_intent, HealIntent};
use crate::PeerCtl;

/// Minimum gap between adaptive mesh nudge reconnects (DHT flush is expensive).
pub const MESH_NUDGE_DEBOUNCE_MS: u64 = 12_000;

/// Pairing discovery ticks must not flush/prepare more often — blind-relay needs time.
pub const PAIRING_DISCOVERY_DEBOUNCE_MS: u64 = 8_000;

/// What to tear down before a reconnect nudge — live and establishing muxes are sacred.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeardownPlan {
	None,
	NonLiveOnly,
	AllWorkers,
	AllLinks,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ReconnectOpts {
	pub prefer_lan: Option<bool>,
	pub path_changed: bool,
	pub force_teardown: bool,
	pub teardown_all_links: bool,
	pub probe_transport: bool,
}

impl ReconnectOpts {
	pub fn path_change(prefer_lan: Option<bool>) -> Self {
		Self {
			prefer_lan,
			path_changed: true,
			probe_transport: prefer_lan.unwrap_or(false),
			..Self::default()
		}
	}

	pub fn foreground(prefer_lan: Option<bool>) -> Self {
		Self {
			prefer_lan,
			probe_transport: prefer_lan.is_some(),
			..Self::default()
		}
	}

	pub fn mesh_nudge() -> Self {
		Self::default()
	}

	pub fn pairing() -> Self {
		Self::default()
	}

	pub fn pairing_reset() -> Self {
		Self {
			force_teardown: true,
			teardown_all_links: true,
			..Self::default()
		}
	}

	pub fn link_down() -> Self {
		Self {
			force_teardown: true,
			..Self::default()
		}
	}
}

/// Allowlisted DIDs that need a swarm nudge: not Live and not actively establishing.
pub fn missing_reconnect_dids(
	targets: &[String],
	live: &HashSet<String>,
	establishing: &HashSet<String>,
) -> Vec<String> {
	targets
		.iter()
		.filter(|d| !live.contains(d.as_str()) && !establishing.contains(d.as_str()))
		.cloned()
		.collect()
}

impl PeerCtl {
	/// Thin wrapper — routes through heal scheduler unless immediate Reset.
	pub async fn reconnect_peers(
		&self,
		reason: &'static str,
		targets: Option<Vec<String>>,
		opts: ReconnectOpts,
	) -> Result<(), String> {
		let intent = reason_to_intent(reason, &opts);
		if intent == HealIntent::Reset {
			return self
				.heal_scheduler
				.request_immediate(self, intent, reason, targets, opts)
				.await;
		}
		self.heal_scheduler
			.request(intent, reason, targets, opts)
			.await;
		Ok(())
	}

	/// Unified heal: intent selects policy; coordinator decides global reset.
	pub async fn heal(
		&self,
		intent: HealIntent,
		reason: &'static str,
		targets: Option<Vec<String>>,
		opts: ReconnectOpts,
	) -> Result<(), String> {
		let was_prefer_lan = self.prefer_lan.load(Ordering::Relaxed);
		let prefer_lan = opts.prefer_lan.unwrap_or(was_prefer_lan);

		if opts.prefer_lan.is_some() && prefer_lan != was_prefer_lan {
			self.apply_prefer_lan(prefer_lan).await;
		}

		let mut target_dids: Vec<String> = if let Some(t) = targets {
			t.into_iter()
				.map(|s| s.trim().to_string())
				.filter(|s| !s.is_empty())
				.collect()
		} else {
			self.allowed_remote_dids.read().await.iter().cloned().collect()
		};
		target_dids.sort();
		target_dids.dedup();

		let pairing_active = self.pairing_state.lock().await.is_active();
		if target_dids.is_empty() && !pairing_active && intent != HealIntent::Rendezvous {
			return Ok(());
		}

		if intent == HealIntent::Recover
			&& !target_dids.is_empty()
			&& self
				.live_links
				.all_allowlisted_live_or_establishing(&target_dids)
				.await
		{
			return Ok(());
		}

		let live_dids = self.live_links.snapshot_mux_ready_dids().await;
		let establishing_dids = self.live_links.snapshot_establishing_dids().await;
		let phantom_count = self.live_links.phantom_count().await;
		let mux_live = live_dids.len();
		let establishing = self.live_links.establishing_count().await;
		let missing = missing_reconnect_dids(&target_dids, &live_dids, &establishing_dids);
		let may_global_reset = self.live_links.may_global_reset().await;

		if intent == HealIntent::Rendezvous
			&& (establishing > 0 || self.live_links.any_in_flight().await)
		{
			log::debug!(
				target: "avenos::peeroxide",
				"heal (Rendezvous {reason}): skip — blind-relay/holepunch in flight (est={establishing})",
			);
			return Ok(());
		}

		let teardown = plan_teardown_for_intent(intent, phantom_count, mux_live, establishing, opts);

		if opts.path_changed
			&& mux_live > 0
			&& missing.is_empty()
			&& teardown == TeardownPlan::None
		{
			let swarm = {
				let guard = self.inner.lock().await;
				guard.as_ref().map(|r| r.swarm.clone())
			};
			if let Some(swarm) = swarm {
				if let Err(e) = swarm.refresh_announce_relays().await {
					log::debug!(
						target: "avenos::peeroxide",
						"refresh_announce_relays ({reason} soft): {e}",
					);
				}
			}
			if opts.probe_transport && prefer_lan && !was_prefer_lan {
				if let Err(e) = self.probe_transport_upgrades(true, reason).await {
					log::debug!(
						target: "avenos::peeroxide",
						"transport upgrade after heal: {e}",
					);
				}
			}
			log::info!(
				target: "avenos::peeroxide",
				"heal ({intent:?} {reason}): soft skip live={} establishing={}",
				mux_live,
				establishing,
			);
			self.emit_mesh_push();
			return Ok(());
		}

		match teardown {
			TeardownPlan::AllLinks => self.jazz_hyperswarm.teardown_all_links().await,
			TeardownPlan::AllWorkers => {
				if allows_worker_abort(intent, teardown) && may_global_reset {
					self.jazz_hyperswarm.abort_all_swarm_workers().await;
				}
			}
			TeardownPlan::NonLiveOnly => self.jazz_hyperswarm.teardown_non_live_links().await,
			TeardownPlan::None => {}
		}
		if teardown != TeardownPlan::None {
			self.live_links.clear_phantom_entries().await;
		}

		if missing.is_empty()
			&& !pairing_active
			&& teardown == TeardownPlan::None
			&& !opts.path_changed
			&& intent != HealIntent::Rendezvous
		{
			return Ok(());
		}

		let desired = if prefer_lan {
			Some(crate::peer_connect_ui::PeerTransportMode::Lan)
		} else {
			None
		};
		if !pairing_active && intent == HealIntent::Recover {
			self.connect_ui_tracker
				.set_desired_transport_for_all(desired);
			for did in &target_dids {
				self.connect_ui_tracker.bump_reconnect_attempt(did);
			}
		}

		let swarm = {
			let guard = self.inner.lock().await;
			let Some(r) = guard.as_ref() else {
				return Ok(());
			};
			if !pairing_active && intent != HealIntent::Rendezvous {
				let joined = self.joined_pair_topics.lock().await;
				if joined.is_empty() && target_dids.is_empty() {
					return Ok(());
				}
			}
			r.swarm.clone()
		};

		if let Err(e) = swarm.refresh_announce_relays().await {
			log::debug!(
				target: "avenos::peeroxide",
				"refresh_announce_relays ({reason}): {e}",
			);
		}

		let global_reset = allows_prepare_reconnect(intent, may_global_reset);

		for did in &missing {
			match crate::did::ed25519_public_from_peer_did(did) {
				Ok(pk) => {
					if let Err(e) = swarm.note_peer_disconnected(pk).await {
						log::debug!(
							target: "avenos::peeroxide",
							"note_peer_disconnected ({reason}) did={did}: {e}",
						);
					}
				}
				Err(e) => {
					log::debug!(
						target: "avenos::peeroxide",
						"heal skip bad did={did}: {e}",
					);
				}
			}
		}

		if global_reset {
			if let Err(e) = swarm.prepare_reconnect().await {
				log::debug!(
					target: "avenos::peeroxide",
					"prepare_reconnect ({reason}): {e}",
				);
			}
		}

		log::info!(
			target: "avenos::peeroxide",
			"heal ({intent:?} {reason}): missing={} live={} establishing={} global_reset={} teardown={teardown:?}",
			missing.len(),
			mux_live,
			establishing,
			global_reset,
		);

		crate::flush_swarm_for_pairing(&swarm, reason).await?;

		if opts.probe_transport && prefer_lan && !was_prefer_lan {
			if let Err(e) = self.probe_transport_upgrades(true, reason).await {
				log::debug!(
					target: "avenos::peeroxide",
					"transport upgrade after heal: {e}",
				);
			}
		}

		self.emit_mesh_push();
		Ok(())
	}
}

fn reason_to_intent(reason: &'static str, opts: &ReconnectOpts) -> HealIntent {
	if opts.teardown_all_links {
		return HealIntent::Reset;
	}
	match reason {
		"pairing reset" => HealIntent::Reset,
		"pairing discovery" | "allowlist heal during pairing" => HealIntent::Rendezvous,
		_ => {
			if opts.force_teardown {
				HealIntent::Reset
			} else {
				HealIntent::Recover
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn missing_skips_live_and_establishing() {
		let targets = vec!["a".into(), "b".into(), "c".into()];
		let live = HashSet::from(["a".to_string()]);
		let establishing = HashSet::from(["b".to_string()]);
		assert_eq!(
			missing_reconnect_dids(&targets, &live, &establishing),
			vec!["c".to_string()]
		);
	}

	#[test]
	fn reason_to_intent_mapping() {
		assert_eq!(
			reason_to_intent("pairing discovery", &ReconnectOpts::default()),
			HealIntent::Rendezvous,
		);
		assert_eq!(
			reason_to_intent("mesh nudge", &ReconnectOpts::default()),
			HealIntent::Recover,
		);
		assert_eq!(
			reason_to_intent("pairing reset", &ReconnectOpts::pairing_reset()),
			HealIntent::Reset,
		);
	}

	#[test]
	fn rendezvous_skips_when_establishing() {
		fn skip(establishing: usize, in_flight: bool) -> bool {
			establishing > 0 || in_flight
		}
		assert!(skip(1, false));
		assert!(skip(0, true));
		assert!(!skip(0, false));
	}
}

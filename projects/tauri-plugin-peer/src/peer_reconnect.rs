//! Single reconnect ritual — every heal trigger funnels through [`PeerCtl::reconnect_peers`].

#![cfg(any(target_os = "macos", target_os = "ios"))]

use std::collections::HashSet;
use std::sync::atomic::Ordering;

use crate::PeerCtl;

#[derive(Debug, Clone, Copy, Default)]
pub struct ReconnectOpts {
	pub prefer_lan: Option<bool>,
	pub path_changed: bool,
	/// Tear down stale non-live mux workers (path change, link down).
	pub force_teardown: bool,
	/// Full mux reset before pairing (clears live links too).
	pub teardown_all_links: bool,
	pub probe_transport: bool,
}

impl ReconnectOpts {
	pub fn path_change(prefer_lan: Option<bool>) -> Self {
		Self {
			prefer_lan,
			path_changed: true,
			force_teardown: true,
			probe_transport: true,
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

/// Allowlisted DIDs that need a swarm nudge: not Live and not actively connecting.
pub fn missing_reconnect_dids(
	targets: &[String],
	live: &HashSet<String>,
	connecting: &HashSet<String>,
) -> Vec<String> {
	targets
		.iter()
		.filter(|d| !live.contains(d.as_str()) && !connecting.contains(d.as_str()))
		.cloned()
		.collect()
}

/// Global `prepare_reconnect` when no live link can be preserved.
pub fn use_global_prepare_reconnect(
	pairing_active: bool,
	live_count: usize,
	in_flight_count: usize,
) -> bool {
	if pairing_active && live_count == 0 {
		return true;
	}
	live_count == 0 && in_flight_count == 0
}

/// Allowlisted heal: global reset when nothing live and no active mux worker suppressing transport.
pub fn use_allowlist_global_reset(live_count: usize, in_flight_count: usize) -> bool {
	live_count == 0 && in_flight_count == 0
}

impl PeerCtl {
	/// Unified heal: refresh relays, tear down stale mux, nudge missing peers, flush DHT.
	pub async fn reconnect_peers(
		&self,
		reason: &'static str,
		targets: Option<Vec<String>>,
		opts: ReconnectOpts,
	) -> Result<(), String> {
		let pairing_active = self.pairing_session.lock().await.is_some();
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

		if target_dids.is_empty() && !pairing_active {
			return Ok(());
		}

		let live_dids = self.live_links.snapshot_mux_ready_dids().await;
		let connecting_dids = self.live_links.snapshot_connecting_dids().await;
		let phantom_count = self.live_links.phantom_count().await;
		let mux_live = live_dids.len();
		let allowlist_heal = !target_dids.is_empty();
		let missing = missing_reconnect_dids(&target_dids, &live_dids, &connecting_dids);

		let needs_teardown = opts.force_teardown
			|| opts.path_changed
			|| phantom_count > 0
			|| (allowlist_heal && mux_live == 0 && !missing.is_empty())
			|| (pairing_active && mux_live == 0 && (opts.path_changed || opts.force_teardown));

		if needs_teardown {
			if opts.teardown_all_links {
				self.jazz_hyperswarm.teardown_all_links().await;
			} else {
				self.jazz_hyperswarm.teardown_non_live_links().await;
			}
			self.live_links.clear_phantom_entries().await;
		}

		let in_flight_count = self.live_links.in_flight_count().await;

		if missing.is_empty() && !pairing_active && !needs_teardown && !opts.path_changed {
			return Ok(());
		}

		let desired = if prefer_lan {
			Some(crate::peer_connect_ui::PeerTransportMode::Lan)
		} else {
			None
		};
		if !pairing_active {
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
			if !pairing_active {
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

		let global_reset = if allowlist_heal {
			use_allowlist_global_reset(mux_live, in_flight_count)
		} else {
			use_global_prepare_reconnect(pairing_active, mux_live, in_flight_count)
		};
		if global_reset {
			if let Err(e) = swarm.prepare_reconnect().await {
				log::debug!(
					target: "avenos::peeroxide",
					"prepare_reconnect ({reason}): {e}",
				);
			}
		} else {
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
							"reconnect skip bad did={did}: {e}",
						);
					}
				}
			}
		}

		log::info!(
			target: "avenos::peeroxide",
			"reconnect_peers ({reason}): missing={} live={} in_flight={} global_reset={} teardown={}",
			missing.len(),
			mux_live,
			in_flight_count,
			global_reset,
			needs_teardown,
		);

		crate::flush_swarm_for_pairing(&swarm, reason).await?;

		if opts.probe_transport && prefer_lan && !was_prefer_lan {
			if let Err(e) = self.probe_transport_upgrades(true, reason).await {
				log::debug!(
					target: "avenos::peeroxide",
					"transport upgrade after reconnect: {e}",
				);
			}
		}

		self.emit_mesh_push();
		Ok(())
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn missing_skips_live_and_connecting() {
		let targets = vec!["a".into(), "b".into(), "c".into()];
		let live = HashSet::from(["a".to_string()]);
		let connecting = HashSet::from(["b".to_string()]);
		assert_eq!(
			missing_reconnect_dids(&targets, &live, &connecting),
			vec!["c".to_string()]
		);
	}

	#[test]
	fn global_reset_when_pairing_and_no_live() {
		assert!(use_global_prepare_reconnect(true, 0, 2));
		assert!(!use_global_prepare_reconnect(true, 1, 0));
	}

	#[test]
	fn global_reset_when_all_down() {
		assert!(use_global_prepare_reconnect(false, 0, 0));
		assert!(!use_global_prepare_reconnect(false, 0, 1));
		assert!(!use_global_prepare_reconnect(false, 1, 0));
	}

	#[test]
	fn allowlist_global_reset_ignores_pairing_in_flight() {
		assert!(use_allowlist_global_reset(0, 0));
		assert!(!use_allowlist_global_reset(0, 1));
		assert!(!use_allowlist_global_reset(1, 0));
	}
}

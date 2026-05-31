//! Single transport tick — pairing rendezvous, mesh heal, and reset (relay-only).

#![cfg(any(target_os = "macos", target_os = "ios"))]

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::pairing_transport::{execute_pairing_nudge_tick, PairingNudgeMode};
use crate::PeerCtl;

/// Minimum gap between steady mesh reconnects.
pub const MESH_DEBOUNCE_MS: u64 = 15_000;
/// Pairing DHT flush debounce.
pub const PAIRING_DEBOUNCE_MS: u64 = 8_000;
/// Stale SwarmConnecting rows block redial after this age (pairing + steady reconcile).
pub const STALE_SWARM_CONNECTING_MS: u64 = 8_000;
/// Alias for pairing policy tests.
pub const RELAY_STALE_SWARM_CONNECTING_MS: u64 = STALE_SWARM_CONNECTING_MS;
pub const RELAY_BACKOFF_BASE_MS: u64 = 2_000;
pub const RELAY_BACKOFF_CAP_MS: u64 = 8_000;

#[must_use]
pub fn relay_backoff_delay_ms(attempts: u32) -> u64 {
	let shift = attempts.min(2);
	(RELAY_BACKOFF_BASE_MS << shift).min(RELAY_BACKOFF_CAP_MS)
}

/// What to tear down before a reconnect nudge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeardownPlan {
	None,
	NonLiveOnly,
	AllLinks,
}

/// Unified transport action — replaces heal intent + reconnect opts + relay reconcile modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum TickMode {
	Pairing = 0,
	MeshSteady = 1,
	MeshMissing = 2,
	Force = 3,
	Reset = 4,
	LinkDown = 5,
}

impl TickMode {
	pub fn debounce_ms(self) -> u64 {
		match self {
			Self::Pairing => PAIRING_DEBOUNCE_MS,
			Self::Reset | Self::LinkDown => 0,
			_ => MESH_DEBOUNCE_MS,
		}
	}

	pub fn immediate(self) -> bool {
		matches!(self, Self::Reset | Self::LinkDown)
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

fn plan_teardown(mode: TickMode, phantom_count: usize, mux_live: usize, establishing: usize) -> TeardownPlan {
	match mode {
		TickMode::Pairing => {
			if phantom_count > 0 {
				TeardownPlan::NonLiveOnly
			} else {
				TeardownPlan::None
			}
		}
		TickMode::MeshSteady | TickMode::MeshMissing | TickMode::Force | TickMode::LinkDown => {
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
		TickMode::Reset => TeardownPlan::AllLinks,
	}
}

#[derive(Debug, Clone)]
struct PendingTick {
	mode: TickMode,
	reason: &'static str,
	targets: Option<Vec<String>>,
}

pub struct TransportScheduler {
	pending: Mutex<Option<PendingTick>>,
	last_drain_ms: AtomicU64,
	drain_notify: tokio::sync::Notify,
}

impl Default for TransportScheduler {
	fn default() -> Self {
		Self::new()
	}
}

impl TransportScheduler {
	pub fn new() -> Self {
		Self {
			pending: Mutex::new(None),
			last_drain_ms: AtomicU64::new(0),
			drain_notify: tokio::sync::Notify::new(),
		}
	}

	pub fn spawn_drain(self: &Arc<Self>, ctl: Arc<PeerCtl>) {
		let sched = Arc::clone(self);
		tauri::async_runtime::spawn(async move {
			sched.drain_loop(ctl).await;
		});
	}

	async fn drain_loop(self: Arc<Self>, ctl: Arc<PeerCtl>) {
		loop {
			self.drain_notify.notified().await;
			loop {
				tokio::time::sleep(std::time::Duration::from_millis(50)).await;
				let job = self.pending.lock().await.take();
				let Some(job) = job else {
					break;
				};
				let now_ms = crate::peer_util::now_ms();
				let debounce = job.mode.debounce_ms();
				if debounce > 0 {
					let last = self.last_drain_ms.load(Ordering::Relaxed);
					if now_ms.saturating_sub(last) < debounce {
						log::debug!(
							target: "avenos::peeroxide",
							"transport ({:?}): debounced ({}ms since last)",
							job.mode,
							now_ms.saturating_sub(last),
						);
						*self.pending.lock().await = Some(job);
						tokio::time::sleep(std::time::Duration::from_millis(
							debounce.saturating_sub(now_ms.saturating_sub(last)),
						))
						.await;
						continue;
					}
				}
				if !ctl.accepts_transport_tick(job.mode).await
					&& matches!(job.mode, TickMode::MeshSteady | TickMode::MeshMissing | TickMode::Force)
				{
					log::debug!(
						target: "avenos::peeroxide",
						"transport ({:?}): blocked by pairing phase",
						job.mode,
					);
					break;
				}
				if let Err(e) = ctl
					.run_transport_tick(job.mode, job.reason, job.targets)
					.await
				{
					log::debug!(
						target: "avenos::peeroxide",
						"transport ({:?} {reason}): {e}",
						job.mode,
						reason = job.reason,
					);
				}
				self.last_drain_ms
					.store(crate::peer_util::now_ms(), Ordering::Relaxed);
				if self.pending.lock().await.is_some() {
					continue;
				}
				break;
			}
		}
	}

	pub async fn queue(
		self: &Arc<Self>,
		mode: TickMode,
		reason: &'static str,
		targets: Option<Vec<String>>,
	) {
		{
			let mut guard = self.pending.lock().await;
			if let Some(existing) = guard.as_mut() {
				existing.mode = existing.mode.max(mode);
				if mode.immediate() || targets.is_some() {
					existing.reason = reason;
					existing.targets = targets;
				}
			} else {
				*guard = Some(PendingTick {
					mode,
					reason,
					targets,
				});
			}
		}
		self.drain_notify.notify_one();
	}

	pub async fn run_immediate(
		self: &Arc<Self>,
		ctl: &PeerCtl,
		mode: TickMode,
		reason: &'static str,
		targets: Option<Vec<String>>,
	) -> Result<(), String> {
		if !ctl.accepts_transport_tick(mode).await
			&& matches!(mode, TickMode::MeshSteady | TickMode::MeshMissing | TickMode::Force)
		{
			return Ok(());
		}
		let result = ctl.run_transport_tick(mode, reason, targets).await;
		self.last_drain_ms
			.store(crate::peer_util::now_ms(), Ordering::Relaxed);
		result
	}
}

impl PeerCtl {
	pub async fn accepts_transport_tick(&self, mode: TickMode) -> bool {
		self.pairing_state.lock().await.accepts_transport_tick(mode)
	}

	/// Single entry for pairing rendezvous, mesh heal, path/foreground, and reset.
	pub async fn transport_tick(
		&self,
		mode: TickMode,
		reason: &'static str,
		targets: Option<Vec<String>>,
	) -> Result<(), String> {
		if mode.immediate() {
			return self
				.transport_scheduler
				.run_immediate(self, mode, reason, targets)
				.await;
		}
		if mode == TickMode::LinkDown {
			return self
				.transport_scheduler
				.run_immediate(self, mode, reason, targets)
				.await;
		}
		self.transport_scheduler
			.queue(mode, reason, targets)
			.await;
		Ok(())
	}

	pub(crate) async fn run_transport_tick(
		&self,
		mode: TickMode,
		reason: &'static str,
		targets: Option<Vec<String>>,
	) -> Result<(), String> {
		if mode == TickMode::Pairing {
			return execute_pairing_nudge_tick(self, reason, PairingNudgeMode::Tick).await;
		}

		if mode == TickMode::Force {
			self.connect_ui_tracker.set_heal_in_progress(true);
		}

		let allow: Vec<String> = match targets {
			Some(t) if !t.is_empty() => t,
			_ => self.allowed_remote_dids.read().await.iter().cloned().collect(),
		};

		if mode == TickMode::MeshSteady || mode == TickMode::MeshMissing || mode == TickMode::Force {
			self.live_links
				.clear_stale_swarm_connecting(STALE_SWARM_CONNECTING_MS)
				.await;
		}

		if mode == TickMode::MeshSteady {
			if allow.is_empty() {
				return Ok(());
			}
			self.live_links
				.clear_stale_swarm_connecting(STALE_SWARM_CONNECTING_MS)
				.await;
			if self.live_links.mux_ready_count().await > 0 {
				return Ok(());
			}
			if self.live_links.establishing_count().await > 0 {
				log::debug!(
					target: "avenos::peeroxide",
					"transport (MeshSteady): skip — link establishing",
				);
				return Ok(());
			}
			log::info!(
				target: "avenos::peeroxide",
				"transport (MeshSteady): mux_live=0 allowlist={}",
				allow.len(),
			);
		}

		let target_dids: Vec<String> = match mode {
			TickMode::MeshMissing => {
				if allow.is_empty() {
					return Ok(());
				}
				let live = self.live_links.snapshot_mux_ready_dids().await;
				let establishing = self.live_links.snapshot_establishing_dids().await;
				let missing = missing_reconnect_dids(&allow, &live, &establishing);
				if missing.is_empty() {
					return Ok(());
				}
				missing
			}
			_ => {
				if allow.is_empty() && mode != TickMode::Reset {
					return Ok(());
				}
				allow
			}
		};

		let pairing_active = self.pairing_state.lock().await.is_active();
		if pairing_active {
			self.live_links
				.clear_stale_swarm_connecting(STALE_SWARM_CONNECTING_MS)
				.await;
		}

		if matches!(mode, TickMode::MeshSteady | TickMode::MeshMissing | TickMode::Force | TickMode::LinkDown) {
			self.live_links
				.clear_stale_swarm_connecting(STALE_SWARM_CONNECTING_MS)
				.await;
			if mode == TickMode::LinkDown {
				self.live_links.clear_phantom_entries().await;
			}
		}

		let live_dids = self.live_links.snapshot_mux_ready_dids().await;
		let establishing_dids = self.live_links.snapshot_establishing_dids().await;
		let phantom_count = self.live_links.phantom_count().await;
		let mux_live = live_dids.len();
		let establishing = self.live_links.establishing_count().await;
		let mut missing = missing_reconnect_dids(&target_dids, &live_dids, &establishing_dids);

		if matches!(mode, TickMode::MeshSteady | TickMode::MeshMissing | TickMode::Force | TickMode::LinkDown) {
			let ready = self.live_links.filter_reconnect_ready(&target_dids).await;
			missing.retain(|d| ready.contains(d));
		}

		let may_global_reset = self.live_links.may_global_reset().await;

		if mode == TickMode::MeshSteady
			&& !target_dids.is_empty()
			&& self
				.live_links
				.all_allowlisted_live_or_establishing(&target_dids)
				.await
		{
			return Ok(());
		}

		let teardown = plan_teardown(mode, phantom_count, mux_live, establishing);

		match teardown {
			TeardownPlan::AllLinks => self.jazz_hyperswarm.teardown_all_links().await,
			TeardownPlan::NonLiveOnly => self.jazz_hyperswarm.teardown_non_live_links().await,
			TeardownPlan::None => {}
		}
		if teardown != TeardownPlan::None {
			self.live_links.clear_phantom_entries().await;
		}

		if missing.is_empty()
			&& !pairing_active
			&& teardown == TeardownPlan::None
		{
			return Ok(());
		}

		if !pairing_active && matches!(mode, TickMode::MeshSteady | TickMode::Force | TickMode::LinkDown) {
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

		let global_reset = (mode == TickMode::LinkDown && !missing.is_empty())
			|| (may_global_reset
				&& matches!(
					mode,
					TickMode::Reset | TickMode::MeshSteady | TickMode::Force | TickMode::LinkDown
				));

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
						"transport skip bad did={did}: {e}",
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
			if mode == TickMode::Reset {
				if let Err(e) = swarm.reset_peer_dial_state(None).await {
					log::debug!(
						target: "avenos::peeroxide",
						"reset_peer_dial_state ({reason}): {e}",
					);
				}
			}
		}

		if matches!(mode, TickMode::MeshSteady | TickMode::MeshMissing | TickMode::Force | TickMode::LinkDown)
			&& !missing.is_empty()
		{
			if let Err(e) = self.dial_allowlisted_peers(&missing, reason).await {
				log::debug!(
					target: "avenos::peeroxide",
					"dial_allowlisted ({reason}): {e}",
				);
			}
		}

		log::info!(
			target: "avenos::peeroxide",
			"transport ({mode:?} {reason}): missing={} live={} establishing={} global_reset={} teardown={teardown:?}",
			missing.len(),
			mux_live,
			establishing,
			global_reset,
		);

		if mode != TickMode::Reset {
			let _ = crate::flush_swarm_mode(&swarm, crate::FlushMode::Background { label: reason }).await;
		}

		if mode == TickMode::Force {
			self.connect_ui_tracker.set_heal_in_progress(false);
		}

		self.emit_mesh_push();
		Ok(())
	}
}

/// Mux-only reset before pairing — shared by `TickMode::Reset` and pairing `Start` nudge.
pub(crate) async fn teardown_mux_reset(ctl: &PeerCtl, reason: &'static str) -> Result<(), String> {
	let may_global_reset = ctl.live_links.may_global_reset().await;

	ctl.jazz_hyperswarm.teardown_all_links().await;
	if may_global_reset {
		ctl.jazz_hyperswarm.abort_all_swarm_workers().await;
	}
	ctl.live_links.clear_phantom_entries().await;

	let swarm = {
		let guard = ctl.inner.lock().await;
		let Some(r) = guard.as_ref() else {
			return Err(
				"Hyperswarm is not running yet — unlock identity and wait a moment.".into(),
			);
		};
		r.swarm.clone()
	};

	if let Err(e) = swarm.refresh_announce_relays().await {
		log::debug!(
			target: "avenos::peeroxide",
			"teardown_mux_reset ({reason}): refresh_announce_relays: {e}",
		);
	}

	if may_global_reset {
		if let Err(e) = swarm.prepare_reconnect().await {
			log::debug!(
				target: "avenos::peeroxide",
				"teardown_mux_reset ({reason}): prepare_reconnect: {e}",
			);
		}
		if let Err(e) = swarm.reset_peer_dial_state(None).await {
			log::debug!(
				target: "avenos::peeroxide",
				"teardown_mux_reset ({reason}): reset_peer_dial_state: {e}",
			);
		}
	}

	log::info!(
		target: "avenos::peeroxide",
		"transport (Reset {reason}): mux reset global_reset={may_global_reset}",
	);
	Ok(())
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
	fn reset_is_immediate() {
		assert!(TickMode::Reset.immediate());
		assert_eq!(TickMode::Pairing.debounce_ms(), PAIRING_DEBOUNCE_MS);
	}
}

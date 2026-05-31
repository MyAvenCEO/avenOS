//! Sole pairing transport entry — invite start, mesh tick, swarm restore.

#![cfg(any(target_os = "macos", target_os = "ios"))]

use std::time::Duration;

use crate::{
	join_pairing_topic, map_swarm_cmd_err, PeerCtl,
};

/// Pairing transport nudge mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PairingNudgeMode {
	/// Invite create/accept: teardown mux, then rendezvous.
	Start,
	/// Mesh reconcile + post-restart: flush + dominant redial only.
	Tick,
}

fn transient_swarm_err(msg: &str) -> bool {
	msg.contains("not running")
		|| msg.contains("stopped")
		|| msg.contains("channel closed")
		|| msg.contains("Destroyed")
		|| msg.contains("Hyperswarm stopped")
}

/// Mux-only reset before pairing — free fn avoids async recursion with `run_transport_tick`.
pub(crate) async fn execute_mux_reset(ctl: &PeerCtl, reason: &'static str) -> Result<(), String> {
	crate::transport::teardown_mux_reset(ctl, reason).await?;
	ctl.emit_mesh_push();
	Ok(())
}

async fn execute_pairing_nudge_once(
	ctl: &PeerCtl,
	label: &'static str,
	mode: PairingNudgeMode,
) -> Result<(), String> {
	if !ctl.pairing_state.lock().await.is_active() {
		return Ok(());
	}

	let topic = ctl
		.pairing_state
		.lock()
		.await
		.topic()
		.ok_or_else(|| "pairing nudge: no active invite topic".to_string())?;

	if mode == PairingNudgeMode::Start {
		execute_mux_reset(ctl, "pairing reset").await?;
		ctl.enter_pairing_mode().await;
	}

	let swarm = {
		let guard = ctl.inner.lock().await;
		let Some(r) = guard.as_ref() else {
			return Err(
				"Hyperswarm is not running yet — unlock identity and wait a moment.".into(),
			);
		};
		r.swarm.clone()
	};

	swarm
		.set_active_pair_topic(Some(topic))
		.await
		.map_err(|e| map_swarm_cmd_err("set_active_pair_topic", e))?;

	if mode == PairingNudgeMode::Tick {
		if swarm.pairing_dial_in_flight().await.unwrap_or(false) {
			log::debug!(
				target: "avenos::peeroxide",
				"pairing_nudge ({label}) — skip tick (dial or relay half in flight)",
			);
			return Ok(());
		}
	}

	// Start-only: mux reset already cleared slots; Tick must not bump connect_epoch
	// while a dominant blind-relay pair is in flight (~20s on the relay).
	if mode == PairingNudgeMode::Start {
		swarm
			.reset_peer_dial_state(None)
			.await
			.map_err(|e| map_swarm_cmd_err("reset_peer_dial_state", e))?;
	}

	if let Err(e) = swarm.refresh_announce_relays().await {
		log::debug!(
			target: "avenos::peeroxide",
			"pairing_nudge ({label}): refresh_announce_relays: {e}",
		);
	}

	// Start joins the invite topic once; Tick only refreshes announces + redial so
	// mesh reconcile does not flush DHT and abort in-flight blind-relay pairs.
	if mode == PairingNudgeMode::Start {
		join_pairing_topic(&swarm, topic, label).await?;
	}

	ctl.clear_stale_pairing_transport().await;

	swarm
		.redial_pairing_peers()
		.await
		.map_err(|e| map_swarm_cmd_err("redial_pairing_peers", e))?;

	log::info!(
		target: "avenos::peeroxide",
		"pairing_nudge ({label}) complete topic={}",
		hex::encode(&topic[..8]),
	);

	ctl.connect_ui_tracker.set_heal_in_progress(false);
	ctl.emit_mesh_push();
	Ok(())
}

/// Pairing rendezvous body — free fn so `run_transport_tick(Pairing)` does not recurse.
pub(crate) async fn execute_pairing_nudge_tick(
	ctl: &PeerCtl,
	label: &'static str,
	mode: PairingNudgeMode,
) -> Result<(), String> {
	let _guard = ctl.pairing_transport_lock.lock().await;

	let mut effective_mode = mode;
	for attempt in 0..3 {
		match execute_pairing_nudge_once(ctl, label, effective_mode).await {
			Ok(()) => return Ok(()),
			Err(e) if transient_swarm_err(&e) && attempt + 1 < 3 => {
				log::warn!(
					target: "avenos::peeroxide",
					"pairing_nudge ({label}) transient failure (attempt {}): {e}",
					attempt + 1,
				);
				effective_mode = PairingNudgeMode::Tick;
				tokio::time::sleep(Duration::from_millis(400)).await;
			}
			Err(e) => return Err(e),
		}
	}
	Ok(())
}

impl PeerCtl {
	/// Sole pairing transport entry — invite start, mesh tick, swarm restore.
	pub async fn pairing_nudge(
		&self,
		label: &'static str,
		mode: PairingNudgeMode,
	) -> Result<(), String> {
		execute_pairing_nudge_tick(self, label, mode).await
	}

	pub(crate) async fn enter_pairing_mode(&self) {
		self.extend_pairing_transport_guard(crate::pairing::PAIRING_TRANSPORT_GUARD_SECS);
		self.apply_enforce_relay_steady_state().await;
		log::info!(
			target: "avenos::peeroxide",
			"pairing relay-first: blind-relay only",
		);
	}

	pub(crate) async fn leave_pairing_mode(&self) {
		self.apply_enforce_relay_steady_state().await;
		log::debug!(
			target: "avenos::peeroxide",
			"pairing relay-first ended — blind-relay steady state",
		);
	}
}

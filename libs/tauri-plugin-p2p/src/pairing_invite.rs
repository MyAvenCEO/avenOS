//! Invite IPC handlers — FSM session setup + `pairing_nudge` transport.

#![cfg(any(target_os = "macos", target_os = "ios"))]

use tauri::Manager;

use crate::pairing;
use crate::{PairingNudgeMode, PeerCtl};

fn pairing_advertised_label(app: &tauri::AppHandle) -> String {
	let vault = app.state::<tauri_plugin_self::vault::ActiveVault>();
	tauri_plugin_self::vault::pairing_label_for_app(app, &*vault).unwrap_or_else(|| "Peer".into())
}

impl PeerCtl {
	/// Leave the short-lived 6-char invite topic.
	pub async fn leave_pairing_signaling_topic(&self) -> Result<(), String> {
		let mut inner = self.inner.lock().await;
		let topic = {
			let state = self.pairing_state.lock().await;
			state.session.as_ref().map(|s| s.topic)
		};
		let Some(running) = inner.as_mut() else {
			self.pairing_state.lock().await.clear();
			return Ok(());
		};

		if let Some(topic) = topic {
			running
				.swarm
				.leave(topic)
				.await
				.map_err(|e| format!("pair leave failed: {e}"))?;
			log::debug!(
				target: "avenos::peeroxide",
				"leave_pairing_signaling_topic left invite topic",
			);
		}
		self.pairing_state.lock().await.clear();
		self.emit_mesh_push();
		Ok(())
	}

	pub(crate) async fn peer_invite_create(&self) -> Result<String, String> {
		let code = pairing::generate_pair_code();
		let normalized = pairing::normalize_pair_code(&code)?;
		let topic = pairing::pair_topic_hash(&normalized);

		let advertised = pairing_advertised_label(&self.app_handle);

		{
			let mut inner = self.inner.lock().await;
			let Some(running) = inner.as_mut() else {
				return Err("Hyperswarm is not running yet — unlock identity and wait a moment.".into());
			};

			let mut state = self.pairing_state.lock().await;
			if let Some(prev) = state.session.take() {
				let _ = running.swarm.leave(prev.topic).await;
			}
			state.start_advertising(pairing::PairSession {
				topic,
				code: normalized.clone(),
				my_advertised_label: advertised,
			});
		}

		self.pairing_nudge("peer_invite_create", PairingNudgeMode::Start)
			.await?;

		log::info!(
			target: "avenos::peeroxide",
			"peer_invite_create ready code={normalized} topic={} (DHT flushed — share with other device)",
			hex::encode(&topic[..8])
		);

		self.emit_mesh_push();
		Ok(normalized)
	}

	pub(crate) async fn peer_invite_accept(&self, raw_code: String) -> Result<(), String> {
		let normalized = pairing::normalize_pair_code(&raw_code)?;
		let topic = pairing::pair_topic_hash(&normalized);

		let my_label = pairing_advertised_label(&self.app_handle);

		{
			let mut inner = self.inner.lock().await;
			let Some(running) = inner.as_mut() else {
				return Err("Hyperswarm is not running yet — unlock identity and wait a moment.".into());
			};

			{
				let mut state = self.pairing_state.lock().await;
				if let Some(prev) = state.session.take() {
					if prev.topic != topic {
						let _ = running.swarm.leave(prev.topic).await;
					}
				}
				state.start_joining(pairing::PairSession {
					topic,
					code: normalized.clone(),
					my_advertised_label: my_label,
				});
			}
		}

		self.pairing_nudge("peer_invite_accept", PairingNudgeMode::Start)
			.await?;

		log::info!(
			target: "avenos::peeroxide",
			"peer_invite_accept ready code={normalized} topic={} (DHT flushed — awaiting host)",
			hex::encode(&topic[..8])
		);

		self.emit_mesh_push();
		Ok(())
	}

	pub async fn peer_invite_cancel(&self) -> Result<(), String> {
		let mut inner = self.inner.lock().await;
		let topic = {
			let state = self.pairing_state.lock().await;
			state.session.as_ref().map(|s| s.topic)
		};
		let Some(running) = inner.as_mut() else {
			self.pairing_state.lock().await.clear();
			self.leave_pairing_mode().await;
			return Ok(());
		};

		if let Some(topic) = topic {
			running
				.swarm
				.leave(topic)
				.await
				.map_err(|e| format!("pair leave failed: {e}"))?;
			log::debug!(target: "avenos::peeroxide", "peer_invite_cancel left pairing topic");
		}
		self.disarm_pairing_swarm().await;
		self.pairing_state.lock().await.clear();
		self.leave_pairing_mode().await;
		self.emit_mesh_push();
		Ok(())
	}

	pub(crate) async fn disarm_pairing_swarm(&self) {
		let guard = self.inner.lock().await;
		if let Some(r) = guard.as_ref() {
			let _ = r.swarm.set_active_pair_topic(None).await;
		}
	}
}

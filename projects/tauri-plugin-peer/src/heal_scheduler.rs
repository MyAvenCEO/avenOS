//! Coalesced heal ingress — one drain per debounce window; highest intent wins.

#![cfg(any(target_os = "macos", target_os = "ios"))]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::heal_intent::HealIntent;
use crate::peer_reconnect::ReconnectOpts;
use crate::PeerCtl;

#[derive(Debug, Clone)]
struct PendingHeal {
	intent: HealIntent,
	reason: &'static str,
	targets: Option<Vec<String>>,
	opts: ReconnectOpts,
}

pub struct HealScheduler {
	pending: Mutex<Option<PendingHeal>>,
	last_drain_ms: AtomicU64,
	drain_notify: tokio::sync::Notify,
}

impl Default for HealScheduler {
	fn default() -> Self {
		Self::new()
	}
}

impl HealScheduler {
	pub fn new() -> Self {
		Self {
			pending: Mutex::new(None),
			last_drain_ms: AtomicU64::new(0),
			drain_notify: tokio::sync::Notify::new(),
		}
	}

	/// Queue a heal; spawns coalesced drain on the PeerCtl actor loop.
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
				if self.pending.lock().await.is_none() {
					break;
				}
				let job = self.pending.lock().await.take();
				let Some(job) = job else {
					break;
				};
				let now_ms = crate::peer_util::now_ms();
				let debounce = job.intent.debounce_ms();
				if debounce > 0 && !job.intent.exempt_from_debounce(job.opts) {
					let last = self.last_drain_ms.load(Ordering::Relaxed);
					if now_ms.saturating_sub(last) < debounce {
						log::debug!(
							target: "avenos::peeroxide",
							"heal ({:?}): debounced ({}ms since last)",
							job.intent,
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
				if !ctl.accepts_heal_intent(job.intent).await {
					log::debug!(
						target: "avenos::peeroxide",
						"heal ({:?}): blocked by pairing phase",
						job.intent,
					);
					break;
				}
				if let Err(e) = ctl
					.heal(job.intent, job.reason, job.targets, job.opts)
					.await
				{
					log::debug!(
						target: "avenos::peeroxide",
						"heal ({:?} {reason}): {e}",
						job.intent,
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

	/// Merge into pending queue and wake drain loop.
	pub async fn request(
		self: &Arc<Self>,
		intent: HealIntent,
		reason: &'static str,
		targets: Option<Vec<String>>,
		opts: ReconnectOpts,
	) {
		{
			let mut guard = self.pending.lock().await;
			if let Some(existing) = guard.as_mut() {
				existing.intent = existing.intent.merge(intent);
				if intent == HealIntent::Reset || targets.is_some() {
					existing.reason = reason;
					existing.targets = targets;
					existing.opts = opts;
				}
			} else {
				*guard = Some(PendingHeal {
					intent,
					reason,
					targets,
					opts,
				});
			}
		}
		self.drain_notify.notify_one();
	}

	/// Immediate heal — bypasses scheduler coalescing (Reset, link-down).
	pub async fn request_immediate(
		self: &Arc<Self>,
		ctl: &PeerCtl,
		intent: HealIntent,
		reason: &'static str,
		targets: Option<Vec<String>>,
		opts: ReconnectOpts,
	) -> Result<(), String> {
		if !ctl.accepts_heal_intent(intent).await && intent == HealIntent::Recover {
			return Ok(());
		}
		let result = ctl.heal(intent, reason, targets, opts).await;
		self.last_drain_ms
			.store(crate::peer_util::now_ms(), Ordering::Relaxed);
		result
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reset_exempt_from_debounce() {
		assert!(HealIntent::Reset.exempt_from_debounce(ReconnectOpts::default()));
		assert!(!HealIntent::Rendezvous.exempt_from_debounce(ReconnectOpts::default()));
	}
}

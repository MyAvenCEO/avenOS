//! Per-peer outbound Groove catch-up: [`PeerCatchupHandle`] mails into one worker task so
//! `rebroadcast_peer_catchup` plus a single `flush_peer_sync` coalesce instead of spawning per tick.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use groove::sync_manager::ClientId;
use tauri::{AppHandle, Manager};
use tokio::sync::{mpsc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PeerCatchupPhase {
	Idle,
	Pending,
	Flushing,
	Ready,
}

struct Entry {
	#[cfg_attr(not(test), allow(dead_code))] // For future transport-aware retries / debugging
	link_epoch: u64,
	phase: PeerCatchupPhase,
	fail_count: u32,
}

struct Registry {
	next_link_serial: u64,
	acl_flush_fail_count: u32,
	peers: HashMap<ClientId, Entry>,
	current_live: HashSet<ClientId>,
	allowlisted_live: HashSet<ClientId>,
	acl_bootstrap_pending: bool,
}

impl Registry {
	fn new() -> Self {
		Self {
			next_link_serial: 1,
			acl_flush_fail_count: 0,
			peers: HashMap::new(),
			current_live: HashSet::new(),
			allowlisted_live: HashSet::new(),
			acl_bootstrap_pending: false,
		}
	}

	fn assign_link_serial(&mut self) -> u64 {
		let n = self.next_link_serial;
		self.next_link_serial = self.next_link_serial.saturating_add(1).max(1);
		n
	}

	fn clear_all(&mut self) {
		*self = Self::new();
	}

	fn acl_retry_backoff(&self) -> Duration {
		let ms = 500u64.saturating_mul(1u64 << self.acl_flush_fail_count.min(16));
		Duration::from_millis(ms.min(30_000))
	}

	fn idle_peer_offline(&mut self, cid: ClientId) {
		if let Some(e) = self.peers.get_mut(&cid) {
			e.phase = PeerCatchupPhase::Idle;
		}
	}

	/// Bump a peer back to Pending for link / reconcile events. Does not clobber [`PeerCatchupPhase::Flushing`] — the
	/// worker owns that lifecycle until flush returns.
	fn bump_to_pending_live_allowlisted(&mut self, cid: ClientId) {
		if !self.current_live.contains(&cid) || !self.allowlisted_live.contains(&cid) {
			return;
		}
		if matches!(
			self.peers.get(&cid).map(|e| e.phase),
			Some(PeerCatchupPhase::Flushing)
		) {
			return;
		}
		let le = self.assign_link_serial();
		self.peers.insert(
			cid,
			Entry {
				link_epoch: le,
				phase: PeerCatchupPhase::Pending,
				fail_count: 0,
			},
		);
	}

	/// After `rebroadcast_all_peer_clients_and_flush` for ACL hydration, force a per-peer outbound catch-up for every
	/// live allowlisted Groove peer.
	fn requeue_all_live_allowlisted_pending_after_acl(&mut self) {
		let cids = self
			.current_live
			.intersection(&self.allowlisted_live)
			.copied()
			.collect::<Vec<_>>();
		for cid in cids {
			let le = self.assign_link_serial();
			self.peers.insert(
				cid,
				Entry {
					link_epoch: le,
					phase: PeerCatchupPhase::Pending,
					fail_count: 0,
				},
			);
		}
	}

	/// Called when Hyperswarm link set changes (`bridge.snapshot_remote_clients()`).
	fn apply_live_clients_changed(&mut self, live: HashSet<ClientId>) {
		let prev = std::mem::replace(&mut self.current_live, live);
		let current = self.current_live.clone();
		for cid in prev.difference(&current).copied().collect::<Vec<_>>() {
			self.idle_peer_offline(cid);
		}
		for cid in current.difference(&prev).copied().collect::<Vec<_>>() {
			if self.allowlisted_live.contains(&cid) {
				self.bump_to_pending_live_allowlisted(cid);
			}
		}
	}

	/// Authoritative mesh view: intersection of Hyperswarm live + vault allow-list (Groove reconcile).
	fn sync_allowlisted_live(&mut self, allow_live: HashSet<ClientId>) {
		self.allowlisted_live = allow_live;
		for cid in self
			.current_live
			.intersection(&self.allowlisted_live)
			.copied()
			.collect::<Vec<_>>()
		{
			match self.peers.get(&cid).map(|e| e.phase) {
				None | Some(PeerCatchupPhase::Idle) => self.bump_to_pending_live_allowlisted(cid),
				Some(PeerCatchupPhase::Pending) | Some(PeerCatchupPhase::Flushing) => {}
				Some(PeerCatchupPhase::Ready) => {}
			}
		}
		for cid in self.peers.keys().copied().collect::<Vec<_>>() {
			let ok = self.allowlisted_live.contains(&cid) && self.current_live.contains(&cid);
			if !ok {
				self.idle_peer_offline(cid);
			}
		}
	}

	/// [`register_peer_sync_client`] succeeded; we still owe outbound catch-up until `flush_peer_sync` Ok.
	fn peer_registered_after_groove(&mut self, cid: ClientId) {
		match self.peers.get(&cid).map(|e| e.phase) {
			None => {
				self.bump_to_pending_live_allowlisted(cid);
			}
			Some(PeerCatchupPhase::Ready | PeerCatchupPhase::Idle) => {
				self.bump_to_pending_live_allowlisted(cid);
			}
			Some(PeerCatchupPhase::Pending | PeerCatchupPhase::Flushing) => {}
		}
	}

	fn has_acl_flush_work(&self) -> bool {
		self.acl_bootstrap_pending && !self.current_live.is_empty()
	}

	fn pop_pending_into_flushing(&mut self, targets: &mut Vec<ClientId>) -> bool {
		targets.clear();
		for (cid, e) in &mut self.peers {
			if e.phase != PeerCatchupPhase::Pending {
				continue;
			}
			if !self.current_live.contains(cid) || !self.allowlisted_live.contains(cid) {
				continue;
			}
			e.phase = PeerCatchupPhase::Flushing;
			targets.push(*cid);
		}
		!targets.is_empty()
	}

	fn flushing_to_pending_incr_fail(&mut self, targets: &[ClientId]) {
		for cid in targets {
			if let Some(e) = self.peers.get_mut(cid) {
				if e.phase == PeerCatchupPhase::Flushing {
					e.phase = PeerCatchupPhase::Pending;
					e.fail_count = e.fail_count.saturating_add(1);
				}
			}
		}
	}

	fn flushing_to_pending_no_incr(&mut self, targets: &[ClientId]) {
		for cid in targets {
			if let Some(e) = self.peers.get_mut(cid) {
				if e.phase == PeerCatchupPhase::Flushing {
					e.phase = PeerCatchupPhase::Pending;
				}
			}
		}
	}

	fn flushing_to_ready(&mut self, targets: &[ClientId]) {
		for cid in targets {
			if let Some(e) = self.peers.get_mut(cid) {
				if e.phase == PeerCatchupPhase::Flushing {
					e.phase = PeerCatchupPhase::Ready;
					e.fail_count = 0;
				}
			}
		}
	}

	fn backoff_delay(fails: u32) -> Duration {
		let ms = 500u64.saturating_mul(1u64 << fails.min(16));
		Duration::from_millis(ms.min(30_000))
	}

	fn max_flushing_fail(&self, targets: &[ClientId]) -> u32 {
		targets
			.iter()
			.filter_map(|cid| self.peers.get(cid).map(|e| e.fail_count))
			.max()
			.unwrap_or(0)
	}

	fn any_live_allowlisted_busy(&self) -> bool {
		for (cid, e) in &self.peers {
			if !self.current_live.contains(cid) || !self.allowlisted_live.contains(cid) {
				continue;
			}
			if matches!(
				e.phase,
				PeerCatchupPhase::Pending | PeerCatchupPhase::Flushing
			) {
				return true;
			}
		}
		false
	}

	fn ready_clients_for_ui(&self) -> HashSet<ClientId> {
		let mut s = HashSet::new();
		for (cid, e) in &self.peers {
			if e.phase == PeerCatchupPhase::Ready && self.current_live.contains(cid) {
				s.insert(*cid);
			}
		}
		s
	}

	fn catchup_busy_for_ui(&self) -> bool {
		self.acl_bootstrap_pending || self.any_live_allowlisted_busy()
	}

	fn acl_increment_fail_round(&mut self) {
		self.acl_flush_fail_count = self.acl_flush_fail_count.saturating_add(1);
	}

	fn acl_reset_fail_round(&mut self) {
		self.acl_flush_fail_count = 0;
	}
}

enum Msg {
	Live(HashSet<ClientId>),
	SyncAllowlisted(HashSet<ClientId>),
	PeerRegistered(ClientId),
	RequestWork,
	ConnReset,
	OnShellAclFirstLoaded,
}

#[derive(Clone)]
pub(crate) struct PeerCatchupHandle {
	tx: mpsc::Sender<Msg>,
	reg: Arc<Mutex<Registry>>,
}

pub(crate) struct PeerMeshCatchupSnap {
	pub(crate) global_catchup_busy: bool,
	pub(crate) ready_client_ids: HashSet<ClientId>,
}

impl PeerCatchupHandle {
	async fn enqueue(&self, m: Msg) {
		let _ = self.tx.send(m).await;
	}

	pub(crate) async fn live_clients_changed(&self, live: HashSet<ClientId>) {
		self.enqueue(Msg::Live(live)).await;
		self.enqueue(Msg::RequestWork).await;
	}

	pub(crate) async fn sync_allowlisted_live(&self, set: HashSet<ClientId>) {
		self.enqueue(Msg::SyncAllowlisted(set)).await;
		self.enqueue(Msg::RequestWork).await;
	}

	pub(crate) async fn on_peer_registered(&self, cid: ClientId) {
		self.enqueue(Msg::PeerRegistered(cid)).await;
		self.enqueue(Msg::RequestWork).await;
	}

	pub(crate) async fn on_conn_reset_for_jazz_teardown(&self) {
		self.enqueue(Msg::ConnReset).await;
	}

	pub(crate) async fn on_shell_acl_first_loaded_prepare_catchup(&self) {
		self.enqueue(Msg::OnShellAclFirstLoaded).await;
		self.enqueue(Msg::RequestWork).await;
	}

	/// Re-push sparks/keyshares after grant even when DB already reflects the admin.
	pub(crate) async fn on_spark_access_granted(&self) {
		{
			let mut g = self.reg.lock().await;
			g.requeue_all_live_allowlisted_pending_after_acl();
		}
		self.enqueue(Msg::RequestWork).await;
	}

	pub(crate) async fn mesh_catchup_ui_snapshot(&self) -> PeerMeshCatchupSnap {
		let g = self.reg.lock().await;
		PeerMeshCatchupSnap {
			global_catchup_busy: g.catchup_busy_for_ui(),
			ready_client_ids: g.ready_clients_for_ui(),
		}
	}
}

/// Called alongside [`crate::jazz::ManagedJazz::reset_connection`] before tearing down Groove (`Ctrl+C`,
/// fingerprint mismatch, clear DB, groove actor reset, etc.).
pub(crate) async fn notify_jazz_connection_teardown(app: &AppHandle) {
	let h = app.state::<PeerCatchupHandle>();
	h.on_conn_reset_for_jazz_teardown().await;
}

pub(crate) fn spawn_peer_catchup_worker(app: AppHandle) -> PeerCatchupHandle {
	let (tx, mut rx) = mpsc::channel::<Msg>(256);
	let reg = Arc::new(Mutex::new(Registry::new()));

	let reg_loop = Arc::clone(&reg);
	let app_loop = app.clone();

	tauri::async_runtime::spawn(async move {
		while let Some(msg) = rx.recv().await {
			match msg {
				Msg::Live(live) => {
					let mut g = reg_loop.lock().await;
					g.apply_live_clients_changed(live);
				}
				Msg::SyncAllowlisted(set) => {
					let mut g = reg_loop.lock().await;
					g.sync_allowlisted_live(set);
				}
				Msg::PeerRegistered(cid) => {
					let mut g = reg_loop.lock().await;
					g.peer_registered_after_groove(cid);
				}
				Msg::ConnReset => {
					reg_loop.lock().await.clear_all();
				}
				Msg::OnShellAclFirstLoaded => {
					let mut g = reg_loop.lock().await;
					g.peers.clear();
					g.acl_bootstrap_pending = true;
				}
				Msg::RequestWork => {}
			}

			process_until_idle(&reg_loop, &app_loop, &mut rx).await;
		}
	});

	PeerCatchupHandle { tx, reg }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
async fn all_peers_send_ready(app: &AppHandle, peers: &[ClientId]) -> bool {
	if peers.is_empty() {
		return false;
	}
	let bridge = app.state::<tauri_plugin_peer::HyperswarmGrooveBridge>();
	for p in peers {
		if !bridge.peer_send_ready(*p).await {
			return false;
		}
	}
	true
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
async fn all_peers_send_ready(_app: &AppHandle, _peers: &[ClientId]) -> bool {
	true
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
async fn any_live_peer_send_ready(app: &AppHandle) -> bool {
	let bridge = app.state::<tauri_plugin_peer::HyperswarmGrooveBridge>();
	for cid in bridge.snapshot_remote_clients().await {
		if bridge.peer_send_ready(cid).await {
			return true;
		}
	}
	false
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
async fn any_live_peer_send_ready(_app: &AppHandle) -> bool {
	true
}

enum EitherPlan {
	None,
	Acl,
	Peers(Vec<ClientId>),
}

async fn process_until_idle(reg: &Arc<Mutex<Registry>>, app: &AppHandle, rx: &mut mpsc::Receiver<Msg>) {
	use std::sync::atomic::{AtomicU64, Ordering};

	static IN_FLIGHT_ID: AtomicU64 = AtomicU64::new(0);
	let jazz = app.state::<crate::jazz::ManagedJazz>();
	let mut targets: Vec<ClientId> = Vec::with_capacity(16);

	drain_secondary_mailbox(reg, rx).await;

	loop {
		let plan = {
			let mut g = reg.lock().await;
			if g.has_acl_flush_work() {
				EitherPlan::Acl
			} else if g.pop_pending_into_flushing(&mut targets) {
				EitherPlan::Peers(std::mem::take(&mut targets))
			} else {
				EitherPlan::None
			}
		};
		match plan {
			EitherPlan::None => break,
			EitherPlan::Acl => {
				let batch = IN_FLIGHT_ID.fetch_add(1, Ordering::AcqRel) + 1;
				let epoch = jazz.groove_conn_epoch();
				let Some(client) = jazz.groove_clone_connected_client().await else {
					let mut g = reg.lock().await;
					g.acl_bootstrap_pending = true;
					break;
				};
				#[cfg(any(target_os = "macos", target_os = "ios"))]
				{
					let live = {
						let g = reg.lock().await;
						g.current_live.clone()
					};
					if !live.is_empty() && !any_live_peer_send_ready(app).await {
						log::debug!(
							target: "avenos::jazz",
							"peer catch-up worker: acl bootstrap deferred — Groove mux not send-ready",
						);
						tokio::time::sleep(Duration::from_millis(400)).await;
						drain_secondary_mailbox(reg, rx).await;
						continue;
					}
				}
				match client.rebroadcast_all_peer_clients_and_flush().await {
					Ok(()) => {
						if !jazz.groove_conn_epoch_is(epoch) {
							reg.lock().await.acl_bootstrap_pending = true;
							drain_secondary_mailbox(reg, rx).await;
							continue;
						}
						let mut g = reg.lock().await;
						log::debug!(
							target: "avenos::jazz",
							"peer catch-up worker: acl bootstrap flushed (batch {})",
							batch
						);
						g.acl_bootstrap_pending = false;
						g.acl_reset_fail_round();
						g.requeue_all_live_allowlisted_pending_after_acl();
						drop(g);
						let actor = app.state::<crate::jazz::runtime::GrooveActorHandle>();
						let mut vault_tables = std::collections::HashSet::new();
						vault_tables.insert("sparks".to_string());
						vault_tables.insert("keyshares".to_string());
						let _ = actor.enqueue_drain(vault_tables).await;
					}
					Err(e) => {
						log::warn!(
							target: "avenos::jazz",
							"peer catch-up worker: acl bootstrap flush failed batch {}: {e}",
							batch
						);
						let delay = {
							let mut g = reg.lock().await;
							g.acl_increment_fail_round();
							g.acl_retry_backoff()
						};
						tokio::time::sleep(delay).await;
					}
				}
				crate::peer_mesh_state::publish_peer_mesh_snapshot(app).await;
				drain_secondary_mailbox(reg, rx).await;
			}
			EitherPlan::Peers(peers) => {
				let batch = IN_FLIGHT_ID.fetch_add(1, Ordering::AcqRel) + 1;
				let peers = peers;
					if !all_peers_send_ready(app, &peers).await {
						log::info!(
							target: "avenos::jazz",
							"peer catch-up worker: defer batch {batch} {:?} — Groove mux not send-ready",
							peers,
						);
					reg.lock().await.flushing_to_pending_no_incr(&peers);
					tokio::time::sleep(Duration::from_millis(400)).await;
					drain_secondary_mailbox(reg, rx).await;
					continue;
				}
				let epoch = jazz.groove_conn_epoch();
				let Some(client) = jazz.groove_clone_connected_client().await else {
					reg.lock().await.flushing_to_pending_no_incr(&peers);
					break;
				};
				for p in &peers {
					if let Err(e) = client.rebroadcast_peer_catchup(*p) {
						log::warn!(
							target: "avenos::jazz",
							"peer catch-up worker: rebroadcast_peer_catchup {:?} batch {} failed: {e}",
							p,
							batch
						);
					}
				}
				match client.flush_peer_sync().await {
					Ok(()) => {
						if !jazz.groove_conn_epoch_is(epoch) {
							reg.lock().await.flushing_to_pending_no_incr(&peers);
							drain_secondary_mailbox(reg, rx).await;
							continue;
						}
						if !all_peers_send_ready(app, &peers).await {
							log::debug!(
								target: "avenos::jazz",
								"peer catch-up worker: flush batch {batch} {:?} Ok but link dropped — retry",
								peers,
							);
							reg.lock().await.flushing_to_pending_no_incr(&peers);
							tokio::time::sleep(Duration::from_millis(400)).await;
							drain_secondary_mailbox(reg, rx).await;
							continue;
						}
						let mut g = reg.lock().await;
						g.flushing_to_ready(&peers);
						log::info!(
							target: "avenos::jazz",
							"peer catch-up worker: peer flush batch {} {:?} Ok (catch-up ready)",
							batch,
							peers
						);
						drop(g);
						// Peer may have received sparks/keyshares during catch-up — re-hydrate
						// vault ACL and push table snapshots to any open UI subscribers.
						let actor = app.state::<crate::jazz::runtime::GrooveActorHandle>();
						let mut vault_tables = std::collections::HashSet::new();
						vault_tables.insert("sparks".to_string());
						vault_tables.insert("keyshares".to_string());
						let _ = actor.enqueue_drain(vault_tables).await;
					}
					Err(e) => {
						let delay = {
							let mut g = reg.lock().await;
							g.flushing_to_pending_incr_fail(&peers);
							let max_f = g.max_flushing_fail(&peers);
							Registry::backoff_delay(max_f)
						};
						log::warn!(
							target: "avenos::jazz",
							"peer catch-up worker: flush_peer_sync batch {:?} batch {} failed: {e}",
							peers,
							batch
						);
						tokio::time::sleep(delay).await;
					}
				}
				crate::peer_mesh_state::publish_peer_mesh_snapshot(app).await;
				drain_secondary_mailbox(reg, rx).await;
			}
		}
	}
}

async fn drain_secondary_mailbox(reg: &Arc<Mutex<Registry>>, rx: &mut mpsc::Receiver<Msg>) {
	while let Ok(m) = rx.try_recv() {
		match m {
			Msg::Live(live) => {
				let mut g = reg.lock().await;
				g.apply_live_clients_changed(live);
			}
			Msg::SyncAllowlisted(set) => {
				let mut g = reg.lock().await;
				g.sync_allowlisted_live(set);
			}
			Msg::PeerRegistered(cid) => {
				let mut g = reg.lock().await;
				g.peer_registered_after_groove(cid);
			}
			Msg::ConnReset => {
				reg.lock().await.clear_all();
			}
			Msg::OnShellAclFirstLoaded => {
				let mut g = reg.lock().await;
				g.peers.clear();
				g.acl_bootstrap_pending = true;
			}
			Msg::RequestWork => {}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use groove::sync_manager::ClientId;
	use uuid::Uuid;

	fn cid(n: u128) -> ClientId {
		ClientId(Uuid::from_u128(n))
	}

	#[test]
	fn link_down_idles_then_link_up_repends() {
		let mut r = Registry::new();
		r.allowlisted_live.insert(cid(1));
		r.apply_live_clients_changed(HashSet::from([cid(1)]));
		assert!(matches!(
			r.peers.get(&cid(1)).map(|e| e.phase),
			Some(PeerCatchupPhase::Pending)
		));
		let le1 = r.peers.get(&cid(1)).unwrap().link_epoch;
		r.apply_live_clients_changed(HashSet::new());
		assert_eq!(
			r.peers.get(&cid(1)).map(|e| e.phase),
			Some(PeerCatchupPhase::Idle)
		);
		r.apply_live_clients_changed(HashSet::from([cid(1)]));
		let le2 = r.peers.get(&cid(1)).unwrap().link_epoch;
		assert_ne!(le1, le2);
		assert_eq!(
			r.peers.get(&cid(1)).map(|e| e.phase),
			Some(PeerCatchupPhase::Pending)
		);
	}

	#[test]
	fn register_moves_ready_back_to_pending() {
		let mut r = Registry::new();
		r.allowlisted_live.insert(cid(2));
		r.current_live.insert(cid(2));
		r.peers.insert(
			cid(2),
			Entry {
				link_epoch: 1,
				phase: PeerCatchupPhase::Ready,
				fail_count: 0,
			},
		);
		r.peer_registered_after_groove(cid(2));
		assert_eq!(
			r.peers.get(&cid(2)).map(|e| e.phase),
			Some(PeerCatchupPhase::Pending)
		);
	}

	#[test]
	fn concurrent_peers_keep_independent_phase() {
		let mut r = Registry::new();
		r.allowlisted_live.extend([cid(3), cid(4)]);
		r.apply_live_clients_changed(HashSet::from([cid(3), cid(4)]));
		r.sync_allowlisted_live(HashSet::from([cid(3), cid(4)]));
		let mut tgt = vec![];
		assert!(r.pop_pending_into_flushing(&mut tgt));
		assert!(tgt.contains(&cid(3)) && tgt.contains(&cid(4)));
		r.flushing_to_ready(&[cid(3)]);
		r.peers.entry(cid(4)).and_modify(|e| {
			e.phase = PeerCatchupPhase::Pending;
		});
		assert_eq!(
			r.peers.get(&cid(3)).map(|e| e.phase),
			Some(PeerCatchupPhase::Ready)
		);
		assert_eq!(
			r.peers.get(&cid(4)).map(|e| e.phase),
			Some(PeerCatchupPhase::Pending)
		);
	}

	#[test]
	fn allowlist_removed_idles_live_peer_record() {
		let mut r = Registry::new();
		r.allowlisted_live.insert(cid(5));
		r.apply_live_clients_changed(HashSet::from([cid(5)]));
		r.sync_allowlisted_live(HashSet::new());
		assert_eq!(
			r.peers.get(&cid(5)).map(|e| e.phase),
			Some(PeerCatchupPhase::Idle)
		);
	}
}

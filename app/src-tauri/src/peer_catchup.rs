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
	link_epoch: u64,
	phase: PeerCatchupPhase,
	fail_count: u32,
	/// Sparks/keyshares catch-up flushed before full spark-data replay.
	shell_bootstrap_done: bool,
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
		let shell_bootstrap_done = self
			.peers
			.get(&cid)
			.is_some_and(|e| e.shell_bootstrap_done);
		let le = self.assign_link_serial();
		self.peers.insert(
			cid,
			Entry {
				link_epoch: le,
				phase: PeerCatchupPhase::Pending,
				fail_count: 0,
				shell_bootstrap_done,
			},
		);
	}

	/// After ACL object-map refresh, force a per-peer outbound catch-up for every live allowlisted Groove peer.
	fn requeue_all_live_allowlisted_pending_after_acl(&mut self) {
		let cids = self
			.current_live
			.intersection(&self.allowlisted_live)
			.copied()
			.collect::<Vec<_>>();
		for cid in cids {
			let shell_bootstrap_done = self
				.peers
				.get(&cid)
				.is_some_and(|e| e.shell_bootstrap_done);
			let le = self.assign_link_serial();
			self.peers.insert(
				cid,
				Entry {
					link_epoch: le,
					phase: PeerCatchupPhase::Pending,
					fail_count: 0,
					shell_bootstrap_done,
				},
			);
		}
	}

	/// Queue full spark-data catch-up (shell phase already complete).
	fn bump_to_full_catchup_pending(&mut self, cid: ClientId) {
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
				shell_bootstrap_done: true,
			},
		);
	}

	fn shell_bootstrap_pending(&self, cid: ClientId) -> bool {
		self.peers.get(&cid).is_some_and(|e| {
			e.phase == PeerCatchupPhase::Pending && !e.shell_bootstrap_done
		})
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
				if e.phase == PeerCatchupPhase::Flushing && e.shell_bootstrap_done {
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

	/// Shell rows replicated and biscuit trust is ready — retry full spark-data catch-up.
	pub(crate) async fn on_trust_bootstrap_ready(&self, peers: HashSet<ClientId>) {
		{
			let mut g = self.reg.lock().await;
			for cid in peers {
				if !g.current_live.contains(&cid) {
					continue;
				}
				// Trust nudge may arrive before the mesh tick updates allowlisted_live.
				g.allowlisted_live.insert(cid);
				match g.peers.get(&cid).map(|e| e.phase) {
					Some(PeerCatchupPhase::Ready) | Some(PeerCatchupPhase::Flushing) => {}
					Some(PeerCatchupPhase::Pending) | Some(PeerCatchupPhase::Idle) | None => {
						g.bump_to_full_catchup_pending(cid);
					}
				}
			}
		}
		self.enqueue(Msg::RequestWork).await;
	}

	/// After a local spark-scoped write, nudge outbound catch-up for live allowlisted peers.
	pub(crate) async fn on_spark_data_written(&self) {
		{
			let mut g = self.reg.lock().await;
			let cids = g
				.current_live
				.intersection(&g.allowlisted_live)
				.copied()
				.collect::<Vec<_>>();
			for cid in cids {
				g.bump_to_pending_live_allowlisted(cid);
			}
		}
		self.enqueue(Msg::RequestWork).await;
	}

	pub(crate) async fn mesh_catchup_ui_snapshot(
		&self,
		bridge: &tauri_plugin_p2p::HyperswarmGrooveBridge,
	) -> PeerMeshCatchupSnap {
		let g = self.reg.lock().await;
		let global_catchup_busy = g.catchup_busy_for_ui();
		let raw_ready = g.ready_clients_for_ui();
		drop(g);
		let mut ready_client_ids = HashSet::new();
		for cid in raw_ready {
			if bridge.peer_send_ready(cid).await {
				ready_client_ids.insert(cid);
			}
		}
		PeerMeshCatchupSnap {
			global_catchup_busy,
			ready_client_ids,
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
	let live_links = app.state::<std::sync::Arc<tauri_plugin_p2p::PeerLinkCoordinator>>();
	let bridge = app.state::<tauri_plugin_p2p::HyperswarmGrooveBridge>();
	for p in peers {
		if !live_links.is_mux_ready_by_client(*p).await {
			return false;
		}
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
	let live_links = app.state::<std::sync::Arc<tauri_plugin_p2p::PeerLinkCoordinator>>();
	let bridge = app.state::<tauri_plugin_p2p::HyperswarmGrooveBridge>();
	for cid in live_links.snapshot_mux_ready_clients().await {
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

#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
async fn peers_trust_ready_for_spark_data(
	app: &AppHandle,
	jazz: &crate::jazz::ManagedJazz,
	peers: &[ClientId],
) -> bool {
	let snap = jazz
		.sync_acl
		.read()
		.expect("sync_acl poisoned")
		.clone();
	let Some(snap) = snap else {
		return false;
	};
	let bridge = app.state::<tauri_plugin_p2p::HyperswarmGrooveBridge>();
	let cid_map = bridge.shared_client_id_to_did();
	let g = cid_map.read().expect("cid map poisoned");
	peers.iter().all(|p| {
		g.get(p)
			.is_some_and(|did| crate::spark_sync::remote_is_spark_admin(&snap, did))
	})
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "ios")))]
async fn peers_trust_ready_for_spark_data(
	_app: &AppHandle,
	_jazz: &crate::jazz::ManagedJazz,
	_peers: &[ClientId],
) -> bool {
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
				match jazz.refresh_sync_acl_object_map(client.as_ref()).await {
					Ok(()) => {
						if !jazz.groove_conn_epoch_is(epoch) {
							reg.lock().await.acl_bootstrap_pending = true;
							drain_secondary_mailbox(reg, rx).await;
							continue;
						}
						let mut g = reg.lock().await;
						log::debug!(
							target: "avenos::jazz",
							"peer catch-up worker: acl bootstrap refreshed (batch {})",
							batch
						);
						g.acl_bootstrap_pending = false;
						g.acl_reset_fail_round();
						g.requeue_all_live_allowlisted_pending_after_acl();
						drop(g);
						let drain = app.state::<crate::jazz::ui_drain::UiTableDrainHandle>();
						let mut vault_tables = std::collections::HashSet::new();
						for t in crate::spark_sync::VAULT_CATALOGUE_UI_TABLES {
							vault_tables.insert(t.to_string());
						}
						let _ = drain.enqueue(vault_tables).await;
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
				if let Err(e) = jazz.refresh_sync_acl_object_map(client.as_ref()).await {
					log::debug!(
						target: "avenos::jazz",
						"peer catch-up worker: refresh_sync_acl_object_map batch {batch} failed: {e}",
					);
				}

				for p in &peers {
					let shell_first = {
						let g = reg.lock().await;
						g.shell_bootstrap_pending(*p)
					};
					if shell_first {
						if let Err(e) = client.rebroadcast_peer_shell_catchup(*p) {
							log::warn!(
								target: "avenos::jazz",
								"peer catch-up worker: rebroadcast_peer_shell_catchup {:?} batch {} failed: {e}",
								p,
								batch
							);
						}
					}
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
						{
							let mut g = reg.lock().await;
							for p in &peers {
								if let Some(e) = g.peers.get_mut(p) {
									if e.phase == PeerCatchupPhase::Flushing {
										e.shell_bootstrap_done = true;
									}
								}
							}
						}
						if peers_trust_ready_for_spark_data(app, &*jazz, &peers).await {
							let link_epoch = {
								let g = reg.lock().await;
								peers
									.first()
									.and_then(|p| g.peers.get(p).map(|e| e.link_epoch))
									.unwrap_or(0)
							};
							let mut g = reg.lock().await;
							g.flushing_to_ready(&peers);
							log::info!(
								target: "avenos::jazz",
								"peer catch-up worker: peer flush batch {} {:?} Ok (catch-up ready, link_epoch={link_epoch})",
								batch,
								peers
							);
						} else {
							let mut g = reg.lock().await;
							for p in &peers {
								if let Some(e) = g.peers.get_mut(p) {
									if e.phase == PeerCatchupPhase::Flushing {
										e.phase = PeerCatchupPhase::Pending;
									}
								}
							}
							log::info!(
								target: "avenos::jazz",
								"peer catch-up worker: flush batch {} {:?} Ok — trust pending, requeued",
								batch,
								peers
							);
						}
						// Peer may have received sparks/keyshares/messages during catch-up.
						let drain = app.state::<crate::jazz::ui_drain::UiTableDrainHandle>();
						let mut drain_tables = std::collections::HashSet::new();
						for t in crate::spark_sync::VAULT_CATALOGUE_UI_TABLES {
							drain_tables.insert(t.to_string());
						}
						for name in crate::spark_sync::spark_scoped_table_names() {
							if crate::spark_sync::is_spark_data_table(name) {
								drain_tables.insert(name.clone());
							}
						}
						let _ = drain.enqueue(drain_tables).await;
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
				shell_bootstrap_done: true,
			},
		);
		r.peer_registered_after_groove(cid(2));
		assert_eq!(
			r.peers.get(&cid(2)).map(|e| e.phase),
			Some(PeerCatchupPhase::Pending)
		);
		assert!(r.peers.get(&cid(2)).is_some_and(|e| e.shell_bootstrap_done));
	}

	#[test]
	fn bump_preserves_shell_bootstrap_done() {
		let mut r = Registry::new();
		r.allowlisted_live.insert(cid(6));
		r.current_live.insert(cid(6));
		r.peers.insert(
			cid(6),
			Entry {
				link_epoch: 1,
				phase: PeerCatchupPhase::Ready,
				fail_count: 0,
				shell_bootstrap_done: true,
			},
		);
		r.bump_to_pending_live_allowlisted(cid(6));
		assert_eq!(
			r.peers.get(&cid(6)).map(|e| e.phase),
			Some(PeerCatchupPhase::Pending)
		);
		assert!(r.peers.get(&cid(6)).is_some_and(|e| e.shell_bootstrap_done));
		assert!(!r.shell_bootstrap_pending(cid(6)));
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
		if let Some(e) = r.peers.get_mut(&cid(3)) {
			e.shell_bootstrap_done = true;
		}
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
	fn trust_ready_queues_full_when_live_not_yet_allowlisted() {
		let mut r = Registry::new();
		r.current_live.insert(cid(8));
		r.peers.insert(
			cid(8),
			Entry {
				link_epoch: 1,
				phase: PeerCatchupPhase::Pending,
				fail_count: 0,
				shell_bootstrap_done: true,
			},
		);
		// Simulates on_trust_bootstrap_ready: mesh tick may not have synced allowlist yet.
		r.allowlisted_live.insert(cid(8));
		r.bump_to_full_catchup_pending(cid(8));
		assert_eq!(
			r.peers.get(&cid(8)).map(|e| e.phase),
			Some(PeerCatchupPhase::Pending)
		);
		assert!(r.peers.get(&cid(8)).is_some_and(|e| e.shell_bootstrap_done));
	}

	#[test]
	fn shell_done_trust_ready_marks_ready_after_flush() {
		let mut r = Registry::new();
		r.allowlisted_live.insert(cid(9));
		r.current_live.insert(cid(9));
		r.peers.insert(
			cid(9),
			Entry {
				link_epoch: 1,
				phase: PeerCatchupPhase::Flushing,
				fail_count: 0,
				shell_bootstrap_done: true,
			},
		);
		r.flushing_to_ready(&[cid(9)]);
		assert_eq!(
			r.peers.get(&cid(9)).map(|e| e.phase),
			Some(PeerCatchupPhase::Ready)
		);
	}
}

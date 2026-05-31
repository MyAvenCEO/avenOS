//! Hyperswarm secret-stream sockets → Jazz [`groove::peer_transport::PeerTransport`].
#![cfg(any(target_os = "macos", target_os = "ios"))]

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, RwLock};
use std::time::Duration;

use async_trait::async_trait;
use groove::sync_manager::{ClientId, InboxEntry, Source, SyncPayload};
use groove::{decode_length_prefixed, encode_length_prefixed, PeerTransport as GroovePeerTransport};
use groove::{JazzError, Result as GrooveResult};
use aven_p2p::SwarmConnection;
use sha2::{Digest, Sha256};
use tokio::sync::{mpsc, oneshot, Mutex, Notify};
// `Mutex` is used only for the bridge's internal bookkeeping maps
// (`outbound_by_peer`, `active_remote_clients`, …). The encrypted SecretStream
// is *not* shared behind a mutex anywhere — `multiplex_connection` splits it
// via the vendored `SecretStream::into_split()` patch and runs the reader and
// writer on independent tasks so they never contend for state. See the long
// rationale on `multiplex_connection`.
use uuid::Uuid;

use crate::did;

/// Fired when the Groove bridge accepts or finishes a Hyperswarm encrypted link.
pub enum GrooveLinkLifecycle {
	Up([u8; 32]),
	Down([u8; 32]),
}

type LinkLifecycleHook = Arc<dyn Fn(GrooveLinkLifecycle) + Send + Sync>;

/// Tear down a half-dead mux when the peer reconnects or keepalive misses.
const MUX_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(8);
const MUX_KEEPALIVE_MISSED: u32 = 4;
const MUX_KEEPALIVE_FRAME: &[u8] = b"avenos/mux-ping/v1";
/// Backstop if the peer sends no mux keepalive or Groove frames (inbound only).
const INBOUND_LIVENESS_TIMEOUT: Duration = Duration::from_secs(24);
/// Backstop if local writer stalls with no inbound progress (outbound-only writes do not count).
const LINK_ACTIVITY_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
/// Consecutive `send_to` failures before tearing down the mux (fast recover).
const SEND_FAIL_TEARDOWN: u32 = 2;
/// Drop mux rows stuck without a send path (was 15s).
const STALE_MUX_MS: u64 = 5_000;
/// Abort mux promotion if the outbound writer never enters its recv loop.
const MUX_WRITER_START_TIMEOUT: Duration = Duration::from_secs(10);

fn now_epoch_ms() -> u64 {
	crate::peer_util::now_ms()
}

fn is_mux_keepalive_frame(data: &[u8]) -> bool {
	data.starts_with(MUX_KEEPALIVE_FRAME)
}

#[must_use]
fn groove_client_uuid_from_pubkey(pubkey: &[u8; 32]) -> Uuid {
	let mut digest = Sha256::new();
	digest.update(b"ceo.aven.os/jazz/client-id-v1");
	digest.update(pubkey.as_slice());
	let hash16: [u8; 16] = digest.finalize()[..16]
		.try_into()
		.expect("sha256 truncation");
	Uuid::from_bytes(hash16)
}

pub struct HyperswarmGrooveBridgeInner {
	local_client_id: Mutex<Option<ClientId>>,
	local_ready: Notify,
	inbound_dispatch: mpsc::UnboundedSender<InboxEntry>,
	inbound_rx: Mutex<Option<mpsc::UnboundedReceiver<InboxEntry>>>,
	outbound_by_peer: Mutex<HashMap<ClientId, mpsc::UnboundedSender<Vec<u8>>>>,
	/// Set when the mux writer task enters its recv loop — `peer_send_ready` gate.
	writer_ready: Mutex<HashMap<ClientId, Arc<AtomicBool>>>,
	active_remote_clients: Mutex<HashSet<ClientId>>,
	swarm_workers: Mutex<HashMap<ClientId, tokio::task::JoinHandle<()>>>,
	shutting_down: Mutex<bool>,
	/// Groove [`ClientId`] → remote `did:key` (Noise static key), shared with biscuit outbound gate.
	pub(crate) client_id_to_did: Arc<RwLock<HashMap<ClientId, String>>>,
	/// Fires whenever a remote peer is added or removed from `active_remote_clients`. The host app
	/// listens to this to call `JazzClient::register_peer_sync_client` for newly-arrived peers and
	/// otherwise reconcile its peer mesh — the bridge itself has no JazzClient handle.
	peer_set_changed: Arc<Notify>,
	/// Last inbound mux keepalive or Groove frame (epoch ms) — writer activity is tracked separately.
	last_inbound_activity_ms: Mutex<HashMap<ClientId, u64>>,
	outbound_send_fail_streak: Mutex<HashMap<ClientId, u32>>,
	/// Set once at plugin init — `std::sync` so attach + notify never block the tokio runtime.
	connect_ui_tracker: StdMutex<Option<Arc<crate::peer_connect_ui::PeerConnectUiTracker>>>,
	link_lifecycle: StdMutex<Option<LinkLifecycleHook>>,
	live_links: StdMutex<Option<Arc<crate::peer_link::PeerLinkCoordinator>>>,
	/// Epoch ms — while `now < guard`, reject inbound links that would replace a mux-ready peer.
	pairing_transport_guard_until_ms: StdMutex<Option<Arc<AtomicU64>>>,
}

#[derive(Clone)]
pub struct HyperswarmGrooveBridge(Arc<HyperswarmGrooveBridgeInner>);

impl HyperswarmGrooveBridge {
	pub fn new() -> Self {
		let (dispatch_tx, recv) = mpsc::unbounded_channel::<InboxEntry>();
		let cid_map = Arc::new(RwLock::new(HashMap::new()));
		let inner = Arc::new(HyperswarmGrooveBridgeInner {
			local_client_id: Mutex::new(None),
			local_ready: Notify::new(),
			inbound_dispatch: dispatch_tx,
			inbound_rx: Mutex::new(Some(recv)),
			outbound_by_peer: Mutex::new(HashMap::new()),
			writer_ready: Mutex::new(HashMap::new()),
			active_remote_clients: Mutex::new(HashSet::new()),
			swarm_workers: Mutex::new(HashMap::new()),
			shutting_down: Mutex::new(false),
			client_id_to_did: cid_map,
			peer_set_changed: Arc::new(Notify::new()),
			last_inbound_activity_ms: Mutex::new(HashMap::new()),
			outbound_send_fail_streak: Mutex::new(HashMap::new()),
			connect_ui_tracker: StdMutex::new(None),
			link_lifecycle: StdMutex::new(None),
			live_links: StdMutex::new(None),
			pairing_transport_guard_until_ms: StdMutex::new(None),
		});
		HyperswarmGrooveBridge(inner)
	}

	pub fn attach_connect_ui(&self, tracker: Arc<crate::peer_connect_ui::PeerConnectUiTracker>) {
		if let Ok(mut slot) = self.0.connect_ui_tracker.lock() {
			*slot = Some(tracker);
		}
	}

	pub fn set_link_lifecycle_hook(&self, hook: LinkLifecycleHook) {
		if let Ok(mut slot) = self.0.link_lifecycle.lock() {
			*slot = Some(hook);
		}
	}

	pub fn attach_live_link_registry(&self, registry: Arc<crate::peer_link::PeerLinkCoordinator>) {
		if let Ok(mut slot) = self.0.live_links.lock() {
			*slot = Some(registry);
		}
	}

	pub fn attach_pairing_transport_guard(&self, guard_until_ms: Arc<AtomicU64>) {
		if let Ok(mut slot) = self.0.pairing_transport_guard_until_ms.lock() {
			*slot = Some(guard_until_ms);
		}
	}

	fn pairing_transport_guard_active(&self) -> bool {
		let until = self
			.0
			.pairing_transport_guard_until_ms
			.lock()
			.ok()
			.and_then(|g| g.as_ref().map(|a| a.load(Ordering::Acquire)))
			.unwrap_or(0);
		until > 0 && now_epoch_ms() < until
	}

	fn notify_link_lifecycle(&self, event: GrooveLinkLifecycle) {
		if let Ok(guard) = self.0.link_lifecycle.lock() {
			if let Some(hook) = guard.as_ref() {
				hook(event);
			}
		}
	}

	fn live_links_registry(&self) -> Option<Arc<crate::peer_link::PeerLinkCoordinator>> {
		self.0
			.live_links
			.lock()
			.ok()
			.and_then(|g| g.as_ref().cloned())
	}

	fn connect_ui_tracker(&self) -> Option<Arc<crate::peer_connect_ui::PeerConnectUiTracker>> {
		self.0
			.connect_ui_tracker
			.lock()
			.ok()
			.and_then(|g| g.as_ref().cloned())
	}

	pub fn shared_client_id_to_did(&self) -> Arc<RwLock<HashMap<ClientId, String>>> {
		Arc::clone(&self.0.client_id_to_did)
	}

	/// Wake on every remote-peer add/drop. Host app polls `snapshot_remote_clients` after the wake.
	pub fn peer_set_changed_notify(&self) -> Arc<Notify> {
		Arc::clone(&self.0.peer_set_changed)
	}

	pub fn arc_transport_dyn(&self) -> Arc<dyn GroovePeerTransport> {
		Arc::new(self.clone())
	}

	pub async fn configure_local_party(&self, local: ClientId) {
		*self.0.local_client_id.lock().await = Some(local);
		self.0.local_ready.notify_waiters();
	}

	pub async fn snapshot_remote_clients(&self) -> Vec<ClientId> {
		self.0
			.active_remote_clients
			.lock()
			.await
			.iter()
			.copied()
			.collect()
	}

	/// DIDs with mux-ready Groove links (authoritative for sync gating).
	pub async fn snapshot_live_linked_dids(&self) -> std::collections::HashSet<String> {
		if let Some(reg) = self.live_links_registry() {
			reg.snapshot_mux_ready_dids().await
		} else {
			std::collections::HashSet::new()
		}
	}

	/// DIDs with coordinator-tracked establishing phases (SwarmConnecting or mux handshaking).
	pub async fn snapshot_establishing_dids(&self) -> std::collections::HashSet<String> {
		if let Some(reg) = self.live_links_registry() {
			return reg.snapshot_establishing_dids().await;
		}
		std::collections::HashSet::new()
	}

	/// Active UDX/swarm links with a running mux worker (may be half-open vs coordinator Live).
	pub async fn active_swarm_link_count(&self) -> usize {
		self.0.active_remote_clients.lock().await.len()
	}

	/// Epoch ms of last inbound keepalive or Groove frame from `peer`, if any.
	pub async fn last_inbound_activity_ms(&self, peer: ClientId) -> Option<u64> {
		self.0
			.last_inbound_activity_ms
			.lock()
			.await
			.get(&peer)
			.copied()
	}

	/// True when mux is live and the peer has sent keepalive or data recently (bidirectional health).
	pub async fn peer_inbound_liveness_ok(&self, peer: ClientId) -> bool {
		let Some(reg) = self.live_links_registry() else {
			return false;
		};
		let Some(pk) = reg.pk_for_client(peer).await else {
			return false;
		};
		if !reg.is_mux_ready_by_pk(&pk).await {
			return false;
		}
		let now = now_epoch_ms();
		let Some(last) = self.last_inbound_activity_ms(peer).await else {
			return false;
		};
		now.saturating_sub(last) < INBOUND_LIVENESS_TIMEOUT.as_millis() as u64
	}

	async fn note_inbound_activity(&self, peer: ClientId) {
		self.0
			.last_inbound_activity_ms
			.lock()
			.await
			.insert(peer, now_epoch_ms());
	}

	async fn clear_peer_liveness(&self, peer: ClientId) {
		self.0
			.last_inbound_activity_ms
			.lock()
			.await
			.remove(&peer);
		self.0
			.outbound_send_fail_streak
			.lock()
			.await
			.remove(&peer);
	}

	async fn client_id_for_pk(&self, remote_pk: [u8; 32]) -> Option<ClientId> {
		let reg = self.live_links_registry()?;
		reg.snapshot_mux_live_entries()
			.await
			.into_iter()
			.find(|(_, pk, _)| *pk == remote_pk)
			.map(|(cid, _, _)| cid)
	}

	async fn mux_ready_for_send_failure(&self, peer: ClientId) -> bool {
		match self.live_links_registry() {
			Some(reg) => reg.is_mux_ready_by_client(peer).await,
			None => false,
		}
	}

	async fn record_outbound_send_failure(&self, peer: ClientId) {
		if !self.mux_ready_for_send_failure(peer).await {
			// Mux already torn down but Groove still has a stale outbound capsule channel —
			// heal immediately instead of spinning on ChannelClosed with no link_down.
			let ghost = self.0.outbound_by_peer.lock().await.contains_key(&peer);
			if ghost {
				if let Some(pk) = match self.live_links_registry() {
					Some(reg) => reg.pk_for_client(peer).await,
					None => None,
				} {
					log::info!(
						target: "avenos::peeroxide",
						"ghost outbound channel peer={peer:?} — tearing down for recover",
					);
					let bridge = self.clone();
					tokio::spawn(async move {
						bridge
							.teardown_peer_link_immediate(peer, pk, "ghost_channel")
							.await;
					});
				}
			}
			return;
		}
		let n = {
			let mut streak = self.0.outbound_send_fail_streak.lock().await;
			let entry = streak.entry(peer).or_insert(0);
			*entry = entry.saturating_add(1);
			*entry
		};
		if n < SEND_FAIL_TEARDOWN {
			self.0.peer_set_changed.notify_waiters();
			return;
		}
		let Some(pk) = (match self.live_links_registry() {
			Some(reg) => reg.pk_for_client(peer).await,
			None => None,
		}) else {
			return;
		};
		log::info!(
			target: "avenos::peeroxide",
			"outbound send fail streak={n} peer={peer:?} — tearing down for recover",
		);
		self.0.outbound_send_fail_streak.lock().await.remove(&peer);
		let bridge = self.clone();
		tokio::spawn(async move {
			bridge
				.teardown_peer_link_immediate(peer, pk, "send_fail")
				.await;
		});
	}

	async fn clear_outbound_send_failure(&self, peer: ClientId) {
		self.0
			.outbound_send_fail_streak
			.lock()
			.await
			.remove(&peer);
	}

	/// Abort mux, clear coordinator, fire link-down lifecycle (idempotent).
	async fn teardown_peer_link_immediate(
		&self,
		remote_client: ClientId,
		remote_pk: [u8; 32],
		reason: &str,
	) {
		self.abort_worker_for(remote_client, remote_pk).await;
		let still_mux = match self.live_links_registry() {
			Some(reg) => reg.is_mux_ready_by_pk(&remote_pk).await,
			None => false,
		};
		if still_mux
			|| self
				.0
				.active_remote_clients
				.lock()
				.await
				.contains(&remote_client)
		{
			self.cleanup_remote_link_state(remote_client, remote_pk, reason)
				.await;
		}
	}

	/// Stale mux purge + inbound liveness audit (bidirectional link health).
	pub async fn audit_bidirectional_link_liveness(&self) {
		self.purge_stale_mux_links().await;
		let now = now_epoch_ms();
		let Some(reg) = self.live_links_registry() else {
			return;
		};
		let entries = reg.snapshot_mux_live_entries().await;
		for (cid, pk, _) in entries {
			if !reg.is_mux_ready_by_pk(&pk).await {
				continue;
			}
			let Some(last_in) = self.last_inbound_activity_ms(cid).await else {
				continue;
			};
			let inbound_age = now.saturating_sub(last_in);
			if inbound_age >= INBOUND_LIVENESS_TIMEOUT.as_millis() as u64 {
				log::info!(
					target: "avenos::peeroxide",
					"inbound liveness timeout peer={cid:?} age_ms={inbound_age} — tearing down",
				);
				self.teardown_peer_link_immediate(cid, pk, "inbound_stale")
					.await;
			}
		}
	}

	/// Drop coordinator Live + mux when send path never came up or swarm has no active links.
	pub async fn purge_stale_mux_links(&self) {
		let now = crate::peer_util::now_ms();
		let Some(reg) = self.live_links_registry() else {
			return;
		};
		let entries = reg.snapshot_mux_live_entries().await;
		for (cid, pk, since_ms) in entries {
			let mux_live = reg.is_mux_ready_by_pk(&pk).await;
			if !mux_live {
				continue;
			}
			let send_ready = self.peer_send_ready(cid).await;
			let age_ms = now.saturating_sub(since_ms);
			// Per-peer only: subordinate relay-only halves never outbound-dial but hold valid inbound mux.
			let stale_send = !send_ready && age_ms >= STALE_MUX_MS;
			if stale_send {
				log::info!(
					target: "avenos::peeroxide",
					"purge stale mux peer={cid:?} send_ready={send_ready} age_ms={age_ms}",
				);
				self.cleanup_remote_link_state(cid, pk, "stale_mux").await;
			}
		}
	}

	/// True when the mux worker is running, outbound channel is open, and LiveLink is MuxReady.
	pub async fn peer_send_ready(&self, client: ClientId) -> bool {
		if let Some(reg) = self.live_links_registry() {
			if !reg.is_mux_ready_by_client(client).await {
				return false;
			}
		}
		let workers = self.0.swarm_workers.lock().await;
		let outbound = self.0.outbound_by_peer.lock().await;
		let writer_ready = self.0.writer_ready.lock().await;
		let live = self.0.active_remote_clients.lock().await;
		live.contains(&client)
			&& workers.contains_key(&client)
			&& outbound.contains_key(&client)
			&& writer_ready
				.get(&client)
				.is_some_and(|f| f.load(Ordering::Acquire))
	}

	/// Abort every mux worker and clear transport bookkeeping (pairing reset / allowlist clear).
	pub async fn teardown_all_links(&self) {
		let clients: Vec<ClientId> = self
			.0
			.swarm_workers
			.lock()
			.await
			.keys()
			.copied()
			.collect();
		for cid in clients {
			let pk = if let Some(reg) = self.live_links_registry() {
				reg.pk_for_client(cid).await
			} else {
				None
			};
			if let Some(pk) = pk {
				self.abort_worker_for(cid, pk).await;
			} else if let Some(h) = self.0.swarm_workers.lock().await.remove(&cid) {
				h.abort();
				let _ = h.await;
			}
		}
		self.0.outbound_by_peer.lock().await.clear();
		self.0.writer_ready.lock().await.clear();
		self.0.active_remote_clients.lock().await.clear();
		if let Some(reg) = self.live_links_registry() {
			reg.clear_all().await;
		}
		self.0.peer_set_changed.notify_waiters();
	}

	/// Tear down in-flight or dead mux workers so reconnect can proceed.
	pub async fn teardown_non_live_links(&self) {
		let stale: Vec<(ClientId, [u8; 32])> = if let Some(reg) = self.live_links_registry() {
			reg.snapshot_non_live_entries().await
		} else {
			Vec::new()
		};
		for (cid, pk) in stale {
			if self.0.swarm_workers.lock().await.contains_key(&cid) {
				self.abort_worker_for(cid, pk).await;
			} else if let Some(reg) = self.live_links_registry() {
				reg.clear(&pk).await;
			}
		}
		self.0.peer_set_changed.notify_waiters();
	}

	/// Abort every mux worker — used when Groove has no live link but a stale worker still suppresses inbound handshakes.
	pub async fn abort_all_swarm_workers(&self) {
		let worker_ids: Vec<ClientId> = self.0.swarm_workers.lock().await.keys().copied().collect();
		for cid in worker_ids {
			let pk = if let Some(reg) = self.live_links_registry() {
				reg.pk_for_client(cid).await
			} else {
				None
			};
			if let Some(pk) = pk {
				self.abort_worker_for(cid, pk).await;
			} else if let Some(h) = self.0.swarm_workers.lock().await.remove(&cid) {
				h.abort();
				let _ = h.await;
			}
		}
		if let Some(reg) = self.live_links_registry() {
			reg.clear_phantom_entries().await;
		}
		self.0.peer_set_changed.notify_waiters();
	}

	async fn wait_until_local_party(&self) -> ClientId {
		loop {
			if let Some(id) = *self.0.local_client_id.lock().await {
				return id;
			}
			self.0.local_ready.notified().await;
		}
	}

	/// Drive a single peer link: spawn an independent reader and writer task
	/// over the split halves of the encrypted SecretStream.
	///
	/// Why split halves instead of a single owning task + `tokio::select!`:
	///
	/// `peeroxide-dht::SecretStream::read` calls `tokio::io::AsyncReadExt::read_exact`
	/// internally. `read_exact` is **not cancel-safe** — if it has consumed a
	/// partial frame header from the underlying UDX socket and the future is
	/// dropped, the next `read()` reads from a misaligned offset, the
	/// `secretstream::Pull::next` decrypt step then fails with
	/// `Decrypt(DecryptionFailed)`, and the link dies forever.
	///
	/// `tokio::select!` between `stream.read()` and `capsule_rx.recv()` always
	/// cancels the losing future, so any write request that arrives mid-frame
	/// corrupts the decrypt counter. We saw this in production:
	///   `[B] peer stream read stopped: Decrypt(DecryptionFailed)`
	/// after about one second of healthy bidirectional sync.
	///
	/// With `SecretStream::into_split()` (vendored AvenOS patch) the read and
	/// write halves own disjoint state — independent libsodium counters plus
	/// the two halves of `tokio::io::split(raw_stream)` — so two tasks can run
	/// concurrently with zero shared state and zero cancellation hazards.
	async fn on_mux_send_lost(&self, remote_pk: [u8; 32]) {
		let mux_was_live = match self.live_links_registry() {
			Some(reg) => reg.is_mux_ready_by_pk(&remote_pk).await,
			None => false,
		};
		if let Some(reg) = self.live_links_registry() {
			reg.set_worker_active(remote_pk, false).await;
			if mux_was_live {
				reg.set_backoff(remote_pk).await;
			}
		}
		if mux_was_live {
			if let Some(cid) = self.client_id_for_pk(remote_pk).await {
				let bridge = self.clone();
				log::info!(
					target: "avenos::peeroxide",
					"mux send lost peer={cid:?} — scheduling immediate teardown + recover",
				);
				tokio::spawn(async move {
					bridge
						.teardown_peer_link_immediate(cid, remote_pk, "mux_send_lost")
						.await;
				});
			}
		}
		self.0.peer_set_changed.notify_waiters();
	}

	async fn promote_mux_ready(
		&self,
		remote_pk: [u8; 32],
		remote_client: ClientId,
		transport_mode: Option<crate::peer_connect_ui::PeerTransportMode>,
		dht_mode: Option<aven_p2p::dht::connect_ui::ConnectTransportMode>,
	) {
		self.0
			.active_remote_clients
			.lock()
			.await
			.insert(remote_client);
		if let Some(reg) = self.live_links_registry() {
			reg.set_mux_ready(remote_pk, transport_mode).await;
		}
		self.note_inbound_activity(remote_client).await;
		self.clear_outbound_send_failure(remote_client).await;
		if let Some(tracker) = self.connect_ui_tracker() {
			tracker.note_inbound_connected(&remote_pk, dht_mode);
		}
		self.notify_link_lifecycle(GrooveLinkLifecycle::Up(remote_pk));
		self.0.peer_set_changed.notify_waiters();
		log::info!(
			target: "avenos::peeroxide",
			"groove_p2p link up peer={remote_client:?} mode=relay",
		);
	}

	async fn multiplex_connection(
		bridge: HyperswarmGrooveBridge,
		conn: SwarmConnection,
		remote_client: ClientId,
		remote_pk: [u8; 32],
		capsule_rx: mpsc::UnboundedReceiver<Vec<u8>>,
		transport_mode: Option<crate::peer_connect_ui::PeerTransportMode>,
	) {
		let local_party_id = bridge.wait_until_local_party().await;
		let dht_mode = conn.peer.transport_mode;

		let (mut reader, mut writer) = conn.peer.stream.into_split();
		let inbound = bridge.0.inbound_dispatch.clone();

		// Notify both halves to tear down when either side dies, so we don't
		// leak a half-task hanging on a dead socket.
		let shutdown = Arc::new(Notify::new());
		let peer_set_changed = Arc::clone(&bridge.0.peer_set_changed);
		let bridge_for_writer = bridge.clone();
		let (writer_ready_tx, writer_ready_rx) = oneshot::channel::<()>();
		let mux_live_flag = Arc::new(AtomicBool::new(false));

		// Reader task: pure inbound — decode every frame, dispatch to Groove.
		let bridge_for_reader = bridge.clone();
		let reader_handle = tokio::spawn({
			let shutdown = Arc::clone(&shutdown);
			let mux_live_flag = Arc::clone(&mux_live_flag);
			async move {
				let mut idle = tokio::time::interval(LINK_ACTIVITY_IDLE_TIMEOUT);
				idle.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
				idle.tick().await;
				loop {
					tokio::select! {
						_ = shutdown.notified() => break,
						_ = idle.tick() => {
							if !mux_live_flag.load(Ordering::Acquire) {
								idle.reset();
								continue;
							}
							let Some(last_in) =
								bridge_for_reader.last_inbound_activity_ms(remote_client).await
							else {
								continue;
							};
							let since =
								now_epoch_ms().saturating_sub(last_in);
							if since < LINK_ACTIVITY_IDLE_TIMEOUT.as_millis() as u64 {
								continue;
							}
							log::info!(
								target: "avenos::peeroxide",
								"peer stream idle timeout peer={remote_client:?} ({since}ms) — closing stale link",
							);
							bridge_for_reader.on_mux_send_lost(remote_pk).await;
							break;
						}
						msg = reader.read() => {
							match msg {
								Ok(Some(plaintext)) => {
									idle.reset();
									if is_mux_keepalive_frame(&plaintext) {
										bridge_for_reader
											.note_inbound_activity(remote_client)
											.await;
										continue;
									}
									bridge_for_reader
										.note_inbound_activity(remote_client)
										.await;
									match decode_length_prefixed(&plaintext) {
										Ok((decoded_target, payload)) => {
											if decoded_target != local_party_id {
												log::warn!(
													target: "avenos::peeroxide",
													"dropping mis-addressed groove frame from {remote_client:?}; target={decoded_target:?}, local={local_party_id:?}",
												);
												continue;
											}
											let entry = InboxEntry {
												source: Source::Client(remote_client),
												payload,
											};
											if inbound.send(entry).is_err() {
												break;
											}
										}
										Err(msg) => {
											log::warn!(target: "avenos::peeroxide", "groove capsule decode failed: {msg}");
										}
									}
								}
								Ok(None) => {
									bridge_for_reader.on_mux_send_lost(remote_pk).await;
									break;
								}
								Err(e) => {
									log::debug!(target: "avenos::peeroxide", "peer stream read stopped: {e:?}");
									bridge_for_reader.on_mux_send_lost(remote_pk).await;
									break;
								}
							}
						}
					}
				}
				// Reader exited → signal writer to stop too.
				shutdown.notify_waiters();
			}
		});

		// Writer task: pure outbound — pull capsules from the bridge's mpsc
		// and encrypt-write them. No cancellation here either; we only stop
		// on a write error or shutdown signal from the reader.
		let writer_ready_flag = bridge
			.0
			.writer_ready
			.lock()
			.await
			.get(&remote_client)
			.cloned()
			.expect("writer_ready flag installed before mux worker spawn");
		let writer_handle = tokio::spawn({
			let shutdown = Arc::clone(&shutdown);
			let mux_live_flag = Arc::clone(&mux_live_flag);
			let mut capsule_rx = capsule_rx;
			let mut keepalive = tokio::time::interval(MUX_KEEPALIVE_INTERVAL);
			keepalive.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
			keepalive.tick().await;
			async move {
				writer_ready_flag.store(true, Ordering::Release);
				let _ = writer_ready_tx.send(());
				peer_set_changed.notify_waiters();
				loop {
					tokio::select! {
						_ = shutdown.notified() => break,
						_ = keepalive.tick() => {
							if !mux_live_flag.load(Ordering::Acquire) {
								continue;
							}
							let miss_ms =
								MUX_KEEPALIVE_INTERVAL.as_millis() as u64 * u64::from(MUX_KEEPALIVE_MISSED);
							if let Some(last_in) =
								bridge_for_writer.last_inbound_activity_ms(remote_client).await
							{
								let since = now_epoch_ms().saturating_sub(last_in);
								if since >= miss_ms {
									log::info!(
										target: "avenos::peeroxide",
										"peer mux keepalive missed (no inbound) peer={remote_client:?} ({since}ms) — closing link",
									);
									bridge_for_writer.on_mux_send_lost(remote_pk).await;
									break;
								}
							}
							if let Err(e) = writer.write(MUX_KEEPALIVE_FRAME).await {
								log::warn!(
									target: "avenos::peeroxide",
									"peer mux keepalive write failed peer={remote_client:?}: {e:?}",
								);
								bridge_for_writer.on_mux_send_lost(remote_pk).await;
								break;
							}
						}
						capsule_opt = capsule_rx.recv() => {
							let Some(data) = capsule_opt else { break };
							if let Err(e) = writer.write(&data).await {
								log::warn!(
									target: "avenos::peeroxide",
									"peer stream write failed peer={remote_client:?}: {e:?}",
								);
								bridge_for_writer.on_mux_send_lost(remote_pk).await;
								break;
							}
						}
					}
				}
				writer_ready_flag.store(false, Ordering::Release);
				bridge_for_writer.on_mux_send_lost(remote_pk).await;
				let _ = writer.shutdown().await;
				shutdown.notify_waiters();
			}
		});

		// MuxReady + Groove Up only after the outbound path is live — avoids
		// linkedCount:1 while PeerTransport::send_to returns ChannelClosed.
		match tokio::time::timeout(MUX_WRITER_START_TIMEOUT, writer_ready_rx).await {
			Ok(Ok(())) => {
				mux_live_flag.store(true, Ordering::Release);
				bridge
					.promote_mux_ready(
						remote_pk,
						remote_client,
						transport_mode,
						dht_mode,
					)
					.await;
			}
			Ok(Err(_)) | Err(_) => {
				log::warn!(
					target: "avenos::peeroxide",
					"peer mux writer never became ready peer={remote_client:?} — tearing down",
				);
				shutdown.notify_waiters();
			}
		}

		// Park until both halves wind down.
		let _ = tokio::join!(reader_handle, writer_handle);

		if bridge
			.0
			.active_remote_clients
			.lock()
			.await
			.contains(&remote_client)
			|| match bridge.live_links_registry() {
				Some(reg) => reg.is_mux_ready_by_pk(&remote_pk).await,
				None => false,
			}
		{
			bridge
				.cleanup_remote_link_state(remote_client, remote_pk, "link_down")
				.await;
		}
	}

	pub async fn on_swarm_connection(&self, conn: SwarmConnection) {
		if *self.0.shutting_down.lock().await {
			return;
		}

		let remote_pk = *conn.remote_public_key();
		let remote_client = ClientId(groove_client_uuid_from_pubkey(&remote_pk));
		let new_mode = Some(crate::peer_connect_ui::PeerTransportMode::Relay);

		if self.0.swarm_workers.lock().await.contains_key(&remote_client) {
			let (handshaking, mux_ready) = if let Some(reg) = self.live_links_registry() {
				(
					reg.is_handshaking_by_pk(&remote_pk).await,
					reg.is_mux_ready_by_pk(&remote_pk).await,
				)
			} else {
				(false, false)
			};

			if handshaking {
				log::debug!(
					target: "avenos::peeroxide",
					"groove_p2p duplicate swarm link for {:?} — keeping handshaking mux",
					remote_client,
				);
				drop(conn);
				return;
			}

			if mux_ready && self.pairing_transport_guard_active() {
				if self.peer_send_ready(remote_client).await {
					log::debug!(
						target: "avenos::peeroxide",
						"groove_p2p duplicate swarm link for {:?} — pairing guard blocks duplicate relay link",
						remote_client,
					);
					drop(conn);
					return;
				}
				log::info!(
					target: "avenos::peeroxide",
					"groove_p2p stale mux for {:?} — accepting relay reconnect",
					remote_client,
				);
			}

			if !mux_ready {
				log::info!(
					target: "avenos::peeroxide",
					"peer_heal: replace link {:?} (relay-only)",
					remote_client,
				);
				self.abort_worker_for(remote_client, remote_pk).await;
			} else {
				log::debug!(
					target: "avenos::peeroxide",
					"groove_p2p duplicate swarm link for {:?} — keeping existing relay mux",
					remote_client,
				);
				drop(conn);
				return;
			}
		}

		if let Ok(did) = did::peer_did_from_ed25519(&remote_pk) {
			{
				let mut m = self.0.client_id_to_did.write().expect("cid map poisoned");
				m.insert(remote_client, did.clone());
			}
			if let Some(reg) = self.live_links_registry() {
				reg.clear_swarm_connecting(&remote_pk).await;
				reg.set_transport_up(remote_pk, remote_client, did.clone())
					.await;
				reg.set_handshaking(remote_pk, remote_client, did)
					.await;
			}
		} else {
			log::warn!(target: "avenos::peeroxide", "groove_p2p: could not derive did:key for remote static key");
		}

		let (caps_tx, caps_rx) = mpsc::unbounded_channel::<Vec<u8>>();
		self.0
			.outbound_by_peer
			.lock()
			.await
			.insert(remote_client, caps_tx);
		self.0
			.writer_ready
			.lock()
			.await
			.insert(remote_client, Arc::new(AtomicBool::new(false)));

		let groove_bridge = HyperswarmGrooveBridge(Arc::clone(&self.0));
		let mode_for_mux = new_mode;

		let h = tokio::spawn(async move {
			HyperswarmGrooveBridge::multiplex_connection(
				groove_bridge,
				conn,
				remote_client,
				remote_pk,
				caps_rx,
				mode_for_mux,
			)
			.await;
		});

		self.0
			.swarm_workers
			.lock()
			.await
			.insert(remote_client, h);
		if let Some(reg) = self.live_links_registry() {
			reg.register_worker(remote_pk, remote_client).await;
		}
	}

	async fn abort_worker_for(
		&self,
		remote_client: ClientId,
		remote_pk: [u8; 32],
	) {
		if let Some(h) = self.0.swarm_workers.lock().await.remove(&remote_client) {
			h.abort();
			let _ = h.await;
		}
		self.0.outbound_by_peer.lock().await.remove(&remote_client);
		self.0.writer_ready.lock().await.remove(&remote_client);
		self.0
			.active_remote_clients
			.lock()
			.await
			.remove(&remote_client);
		if let Some(reg) = self.live_links_registry() {
			reg.unregister_worker(&remote_pk).await;
		}
		self.0.peer_set_changed.notify_waiters();
	}

	async fn cleanup_remote_link_state(
		&self,
		remote_client: ClientId,
		remote_pk: [u8; 32],
		reason: &str,
	) {
		self.clear_peer_liveness(remote_client).await;
		self.0.swarm_workers.lock().await.remove(&remote_client);
		self.0.outbound_by_peer.lock().await.remove(&remote_client);
		self.0.writer_ready.lock().await.remove(&remote_client);
		{
			let mut peers = self.0.active_remote_clients.lock().await;
			peers.remove(&remote_client);
		}
		self.0.peer_set_changed.notify_waiters();
		if let Some(reg) = self.live_links_registry() {
			reg.clear(&remote_pk).await;
		}
		if let Some(tracker) = self.connect_ui_tracker() {
			tracker.note_disconnected_pk_with_reason(&remote_pk, reason);
		}
		self.notify_link_lifecycle(GrooveLinkLifecycle::Down(remote_pk));
		log::info!(
			target: "avenos::peeroxide",
			"groove_p2p link torn down peer={remote_client:?} reason={reason}",
		);
	}
}

#[async_trait]
impl GroovePeerTransport for HyperswarmGrooveBridge {
	async fn send_to(&self, peer: ClientId, payload: SyncPayload) -> GrooveResult<()> {
		if *self.0.shutting_down.lock().await {
			return Err(JazzError::ChannelClosed);
		}
		if !self.peer_send_ready(peer).await {
			self.record_outbound_send_failure(peer).await;
			return Err(JazzError::ChannelClosed);
		}
		let capsule = encode_length_prefixed(peer, &payload).map_err(JazzError::Sync)?;
		let tx = self
			.0
			.outbound_by_peer
			.lock()
			.await
			.get(&peer)
			.ok_or_else(|| {
				JazzError::Sync(format!("hyperswarm: no active link for peer {:?}", peer))
			})?
			.clone();
		if tx.send(capsule).is_err() {
			self.record_outbound_send_failure(peer).await;
			return Err(JazzError::ChannelClosed);
		}
		self.clear_outbound_send_failure(peer).await;
		Ok(())
	}

	async fn recv_inbound(&self) -> Option<InboxEntry> {
		let mut slot = self.0.inbound_rx.lock().await;
		slot.as_mut()?.recv().await
	}

	async fn shutdown(&self) -> GrooveResult<()> {
		{
			let mut g = self.0.shutting_down.lock().await;
			*g = true;
		}
		self.0.outbound_by_peer.lock().await.clear();
		self.0.writer_ready.lock().await.clear();

		let mut workers = self.0.swarm_workers.lock().await;
		for (_, h) in workers.drain() {
			h.abort();
			let _ = h.await;
		}

		self.0.active_remote_clients.lock().await.clear();
		{
			let mut m = self.0.client_id_to_did.write().expect("cid map poisoned");
			m.clear();
		}
		Ok(())
	}
}


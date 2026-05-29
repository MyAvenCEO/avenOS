//! Hyperswarm secret-stream sockets → Jazz [`groove::peer_transport::PeerTransport`].
#![cfg(any(target_os = "macos", target_os = "ios"))]

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use async_trait::async_trait;
use groove::sync_manager::{ClientId, InboxEntry, Source, SyncPayload};
use groove::{decode_length_prefixed, encode_length_prefixed, PeerTransport as GroovePeerTransport};
use groove::{JazzError, Result as GrooveResult};
use peeroxide::SwarmConnection;
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
/// Backstop if keepalive state stalls entirely (relay/cellular can be quiet for stretches).
const LINK_ACTIVITY_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
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
	connect_ui_tracker: Mutex<Option<Arc<crate::peer_connect_ui::PeerConnectUiTracker>>>,
	link_lifecycle: Mutex<Option<LinkLifecycleHook>>,
	live_links: Mutex<Option<Arc<crate::peer_link::PeerLinkCoordinator>>>,
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
			connect_ui_tracker: Mutex::new(None),
			link_lifecycle: Mutex::new(None),
			live_links: Mutex::new(None),
		});
		HyperswarmGrooveBridge(inner)
	}

	pub fn attach_connect_ui(&self, tracker: Arc<crate::peer_connect_ui::PeerConnectUiTracker>) {
		*self
			.0
			.connect_ui_tracker
			.blocking_lock() = Some(tracker);
	}

	pub fn set_link_lifecycle_hook(&self, hook: LinkLifecycleHook) {
		*self.0.link_lifecycle.blocking_lock() = Some(hook);
	}

	pub fn attach_live_link_registry(&self, registry: Arc<crate::peer_link::PeerLinkCoordinator>) {
		*self.0.live_links.blocking_lock() = Some(registry);
	}

	fn notify_link_lifecycle(&self, event: GrooveLinkLifecycle) {
		if let Some(hook) = self.0.link_lifecycle.blocking_lock().as_ref() {
			hook(event);
		}
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
		if let Some(reg) = self.0.live_links.lock().await.as_ref() {
			reg.snapshot_mux_ready_dids().await
		} else {
			std::collections::HashSet::new()
		}
	}

	/// DIDs with coordinator-tracked establishing phases (SwarmConnecting or mux handshaking).
	pub async fn snapshot_establishing_dids(&self) -> std::collections::HashSet<String> {
		if let Some(reg) = self.0.live_links.lock().await.as_ref() {
			return reg.snapshot_establishing_dids().await;
		}
		std::collections::HashSet::new()
	}

	/// True when the mux worker is running, outbound channel is open, and LiveLink is MuxReady.
	pub async fn peer_send_ready(&self, client: ClientId) -> bool {
		if let Some(reg) = self.0.live_links.lock().await.as_ref() {
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
			let pk = if let Some(reg) = self.0.live_links.lock().await.as_ref() {
				reg.pk_for_client(cid).await
			} else {
				None
			};
			if let Some(pk) = pk {
				self.abort_worker_for(cid, pk, false).await;
			} else if let Some(h) = self.0.swarm_workers.lock().await.remove(&cid) {
				h.abort();
				let _ = h.await;
			}
		}
		self.0.outbound_by_peer.lock().await.clear();
		self.0.writer_ready.lock().await.clear();
		self.0.active_remote_clients.lock().await.clear();
		if let Some(reg) = self.0.live_links.lock().await.as_ref() {
			reg.clear_all().await;
		}
		self.0.peer_set_changed.notify_waiters();
	}

	/// Tear down in-flight or dead mux workers so a path change (e.g. LAN → cellular) can reconnect.
	pub async fn teardown_non_live_links(&self) {
		let stale: Vec<(ClientId, [u8; 32])> = if let Some(reg) = self.0.live_links.lock().await.as_ref() {
			reg.snapshot_non_live_entries().await
		} else {
			Vec::new()
		};
		for (cid, pk) in stale {
			if self.0.swarm_workers.lock().await.contains_key(&cid) {
				self.abort_worker_for(cid, pk, false).await;
			} else if let Some(reg) = self.0.live_links.lock().await.as_ref() {
				reg.clear(&pk).await;
			}
		}
		self.0.peer_set_changed.notify_waiters();
	}

	/// Abort every mux worker — used when Groove has no live link but a stale worker still suppresses inbound handshakes.
	pub async fn abort_all_swarm_workers(&self) {
		let worker_ids: Vec<ClientId> = self.0.swarm_workers.lock().await.keys().copied().collect();
		for cid in worker_ids {
			let pk = if let Some(reg) = self.0.live_links.lock().await.as_ref() {
				reg.pk_for_client(cid).await
			} else {
				None
			};
			if let Some(pk) = pk {
				self.abort_worker_for(cid, pk, false).await;
			} else if let Some(h) = self.0.swarm_workers.lock().await.remove(&cid) {
				h.abort();
				let _ = h.await;
			}
		}
		if let Some(reg) = self.0.live_links.lock().await.as_ref() {
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
		if let Some(reg) = self.0.live_links.lock().await.as_ref() {
			reg.set_worker_active(remote_pk, false).await;
			if reg.is_mux_ready_by_pk(&remote_pk).await {
				// Backoff — not Handshaking — so peeroxide transport is not suppressed
				// while the dead socket winds down and reconnect can start on cellular/relay.
				reg.set_backoff(remote_pk).await;
			}
		}
		self.0.peer_set_changed.notify_waiters();
	}

	async fn promote_mux_ready(
		&self,
		remote_pk: [u8; 32],
		remote_client: ClientId,
		transport_mode: Option<crate::peer_connect_ui::PeerTransportMode>,
		dht_mode: Option<peeroxide_dht::connect_ui::ConnectTransportMode>,
	) {
		self.0
			.active_remote_clients
			.lock()
			.await
			.insert(remote_client);
		if let Some(reg) = self.0.live_links.lock().await.as_ref() {
			reg.set_mux_ready(remote_pk, transport_mode).await;
		}
		if let Some(tracker) = self.0.connect_ui_tracker.lock().await.as_ref() {
			tracker.note_inbound_connected(&remote_pk, dht_mode);
		}
		self.notify_link_lifecycle(GrooveLinkLifecycle::Up(remote_pk));
		log::info!(
			target: "avenos::peeroxide",
			"groove_p2p link up peer={remote_client:?} mode={}",
			crate::transport_rank::format_mode(transport_mode),
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
		let last_activity_ms = Arc::new(AtomicU64::new(now_epoch_ms()));
		let mux_live_flag = Arc::new(AtomicBool::new(false));

		// Reader task: pure inbound — decode every frame, dispatch to Groove.
		let bridge_for_reader = bridge.clone();
		let reader_handle = tokio::spawn({
			let shutdown = Arc::clone(&shutdown);
			let last_activity_ms = Arc::clone(&last_activity_ms);
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
							let since = now_epoch_ms()
								.saturating_sub(last_activity_ms.load(Ordering::Acquire));
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
									if !is_mux_keepalive_frame(&plaintext) {
										last_activity_ms.store(now_epoch_ms(), Ordering::Release);
									}
									if is_mux_keepalive_frame(&plaintext) {
										continue;
									}
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
			let last_activity_ms = Arc::clone(&last_activity_ms);
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
							let since = now_epoch_ms()
								.saturating_sub(last_activity_ms.load(Ordering::Acquire));
							let miss_ms =
								MUX_KEEPALIVE_INTERVAL.as_millis() as u64 * u64::from(MUX_KEEPALIVE_MISSED);
							if since >= miss_ms {
								log::info!(
									target: "avenos::peeroxide",
									"peer mux keepalive missed peer={remote_client:?} ({since}ms) — closing link",
								);
								bridge_for_writer.on_mux_send_lost(remote_pk).await;
								break;
							}
							if let Err(e) = writer.write(MUX_KEEPALIVE_FRAME).await {
								log::warn!(
									target: "avenos::peeroxide",
									"peer mux keepalive write failed peer={remote_client:?}: {e:?}",
								);
								bridge_for_writer.on_mux_send_lost(remote_pk).await;
								break;
							}
							last_activity_ms.store(now_epoch_ms(), Ordering::Release);
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
							last_activity_ms.store(now_epoch_ms(), Ordering::Release);
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

		bridge
			.cleanup_remote_link_state(remote_client, remote_pk, "link_down")
			.await;
	}

	pub async fn on_swarm_connection(&self, conn: SwarmConnection) {
		if *self.0.shutting_down.lock().await {
			return;
		}

		let remote_pk = *conn.remote_public_key();
		let remote_client = ClientId(groove_client_uuid_from_pubkey(&remote_pk));
		let new_mode = conn
			.peer
			.transport_mode
			.map(crate::transport_rank::map_dht_mode);

		let mut transport_upgrade = false;
		if self.0.swarm_workers.lock().await.contains_key(&remote_client) {
			let (handshaking, mux_ready, live_mode) = if let Some(reg) =
				self.0.live_links.lock().await.as_ref()
			{
				let handshaking = reg.is_handshaking_by_pk(&remote_pk).await;
				let mux_ready = reg.is_mux_ready_by_pk(&remote_pk).await;
				let mode = reg.transport_mode_for_pk(&remote_pk).await;
				(handshaking, mux_ready, mode)
			} else {
				(false, false, None)
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

			let ui_mode = self
				.0
				.connect_ui_tracker
				.lock()
				.await
				.as_ref()
				.and_then(|t| {
					did::peer_did_from_ed25519(&remote_pk)
						.ok()
						.and_then(|d| t.row_for_did(&d).transport_mode)
				});
			let existing_mode = live_mode.or(ui_mode);

			if crate::transport_rank::should_replace_link(new_mode, existing_mode, mux_ready) {
				let upgraded = existing_mode.is_some_and(|old| {
					new_mode.is_some_and(|new_m| crate::transport_rank::is_better(new_m, old))
				});
				transport_upgrade = upgraded;
				log::info!(
					target: "avenos::peeroxide",
					"peer_heal: {} link {:?} {} -> {}",
					if upgraded { "upgrade" } else { "replace" },
					remote_client,
					crate::transport_rank::format_mode(existing_mode),
					crate::transport_rank::format_mode(new_mode),
				);
				// In-place mux swap — avoid link_down/reconnect churn during upgrades.
				self.abort_worker_for(remote_client, remote_pk, true).await;
			} else {
				log::debug!(
					target: "avenos::peeroxide",
					"groove_p2p duplicate swarm link for {:?} — keeping existing (downgrade rejected)",
					remote_client,
				);
				drop(conn);
				return;
			}
		}

		if !transport_upgrade {
			if let Ok(did) = did::peer_did_from_ed25519(&remote_pk) {
				{
					let mut m = self.0.client_id_to_did.write().expect("cid map poisoned");
					m.insert(remote_client, did.clone());
				}
				if let Some(reg) = self.0.live_links.lock().await.as_ref() {
					reg.clear_swarm_connecting(&remote_pk).await;
					reg.set_transport_up(remote_pk, remote_client, did.clone())
						.await;
					reg.set_handshaking(remote_pk, remote_client, did)
						.await;
				}
			} else {
				log::warn!(target: "avenos::peeroxide", "groove_p2p: could not derive did:key for remote static key");
			}
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
		if let Some(reg) = self.0.live_links.lock().await.as_ref() {
			reg.register_worker(remote_pk, remote_client).await;
		}
	}

	async fn abort_worker_for(
		&self,
		remote_client: ClientId,
		remote_pk: [u8; 32],
		transport_upgrade: bool,
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
		if transport_upgrade {
			if let Some(reg) = self.0.live_links.lock().await.as_ref() {
				reg.demote_to_handshaking(remote_pk).await;
			}
		} else if let Some(reg) = self.0.live_links.lock().await.as_ref() {
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
		self.0.swarm_workers.lock().await.remove(&remote_client);
		self.0.outbound_by_peer.lock().await.remove(&remote_client);
		self.0.writer_ready.lock().await.remove(&remote_client);
		{
			let mut peers = self.0.active_remote_clients.lock().await;
			peers.remove(&remote_client);
		}
		self.0.peer_set_changed.notify_waiters();
		if let Some(reg) = self.0.live_links.lock().await.as_ref() {
			reg.clear(&remote_pk).await;
		}
		if let Some(tracker) = self.0.connect_ui_tracker.lock().await.as_ref() {
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
		tx.send(capsule).map_err(|_| JazzError::ChannelClosed)?;
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


//! Hyperswarm secret-stream sockets → Jazz [`groove::peer_transport::PeerTransport`].
#![cfg(target_os = "macos")]

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use groove::sync_manager::{ClientId, InboxEntry, Source, SyncPayload};
use groove::{decode_length_prefixed, encode_length_prefixed, PeerTransport as GroovePeerTransport};
use groove::{JazzError, Result as GrooveResult};
use peeroxide::SwarmConnection;
use sha2::{Digest, Sha256};
use tokio::sync::{mpsc, Mutex, Notify};
// `Mutex` is used only for the bridge's internal bookkeeping maps
// (`outbound_by_peer`, `active_remote_clients`, …). The encrypted SecretStream
// is *not* shared behind a mutex anywhere — `multiplex_connection` splits it
// via the vendored `SecretStream::into_split()` patch and runs the reader and
// writer on independent tasks so they never contend for state. See the long
// rationale on `multiplex_connection`.
use uuid::Uuid;

use crate::did;

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
	active_remote_clients: Mutex<HashSet<ClientId>>,
	swarm_workers: Mutex<Vec<tokio::task::JoinHandle<()>>>,
	shutting_down: Mutex<bool>,
	/// Groove [`ClientId`] → remote `did:key` (Noise static key), shared with biscuit outbound gate.
	pub(crate) client_id_to_did: Arc<RwLock<HashMap<ClientId, String>>>,
	/// Fires whenever a remote peer is added or removed from `active_remote_clients`. The host app
	/// listens to this to call `JazzClient::register_peer_sync_client` for newly-arrived peers and
	/// otherwise reconcile its peer mesh — the bridge itself has no JazzClient handle.
	peer_set_changed: Arc<Notify>,
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
			active_remote_clients: Mutex::new(HashSet::new()),
			swarm_workers: Mutex::new(Vec::new()),
			shutting_down: Mutex::new(false),
			client_id_to_did: cid_map,
			peer_set_changed: Arc::new(Notify::new()),
		});
		HyperswarmGrooveBridge(inner)
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
	async fn multiplex_connection(
		bridge: HyperswarmGrooveBridge,
		conn: SwarmConnection,
		remote_client: ClientId,
		capsule_rx: mpsc::UnboundedReceiver<Vec<u8>>,
		local_party_id: ClientId,
	) {
		let (mut reader, mut writer) = conn.peer.stream.into_split();
		let inbound = bridge.0.inbound_dispatch.clone();

		// Notify both halves to tear down when either side dies, so we don't
		// leak a half-task hanging on a dead socket.
		let shutdown = Arc::new(Notify::new());

		// Reader task: pure inbound — decode every frame, dispatch to Groove.
		let reader_handle = tokio::spawn({
			let shutdown = Arc::clone(&shutdown);
			async move {
				loop {
					tokio::select! {
						_ = shutdown.notified() => break,
						msg = reader.read() => {
							match msg {
								Ok(Some(plaintext)) => {
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
								Ok(None) => break,
								Err(e) => {
									log::debug!(target: "avenos::peeroxide", "peer stream read stopped: {e:?}");
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
		let writer_handle = tokio::spawn({
			let shutdown = Arc::clone(&shutdown);
			let mut capsule_rx = capsule_rx;
			async move {
				loop {
					tokio::select! {
						_ = shutdown.notified() => break,
						capsule_opt = capsule_rx.recv() => {
							let Some(data) = capsule_opt else { break };
							if let Err(e) = writer.write(&data).await {
								log::warn!(
									target: "avenos::peeroxide",
									"peer stream write failed peer={remote_client:?}: {e:?}",
								);
								break;
							}
						}
					}
				}
				let _ = writer.shutdown().await;
				shutdown.notify_waiters();
			}
		});

		// Park until both halves wind down.
		let _ = tokio::join!(reader_handle, writer_handle);

		bridge
			.0
			.outbound_by_peer
			.lock()
			.await
			.remove(&remote_client);
		{
			let mut peers = bridge.0.active_remote_clients.lock().await;
			peers.remove(&remote_client);
		}
		{
			let mut m = bridge.0.client_id_to_did.write().expect("cid map poisoned");
			m.remove(&remote_client);
		}
		bridge.0.peer_set_changed.notify_waiters();
		log::debug!(
			target: "avenos::peeroxide",
			"groove_p2p link closed peer={:?}",
			remote_client
		);
	}

	pub async fn on_swarm_connection(&self, conn: SwarmConnection) {
		if *self.0.shutting_down.lock().await {
			return;
		}

		let remote_pk = conn.remote_public_key();
		let remote_client = ClientId(groove_client_uuid_from_pubkey(remote_pk));
		if let Ok(did) = did::peer_did_from_ed25519(remote_pk) {
			let mut m = self.0.client_id_to_did.write().expect("cid map poisoned");
			m.insert(remote_client, did);
		} else {
			log::warn!(target: "avenos::peeroxide", "groove_p2p: could not derive did:key for remote static key");
		}

		let (caps_tx, caps_rx) = mpsc::unbounded_channel::<Vec<u8>>();
		let replace = {
			let mut map = self.0.outbound_by_peer.lock().await;
			map.insert(remote_client, caps_tx)
		};
		if replace.is_some() {
			log::warn!(
				target: "avenos::peeroxide",
				"groove_p2p replacing duplicate swarm link {:?}",
				remote_client,
			);
		}

		self.0
			.active_remote_clients
			.lock()
			.await
			.insert(remote_client);
		self.0.peer_set_changed.notify_waiters();
		log::info!(
			target: "avenos::peeroxide",
			"groove_p2p link up peer={:?}",
			remote_client
		);

		let groove_bridge = HyperswarmGrooveBridge(Arc::clone(&self.0));

		// `multiplex_connection` internally splits the SecretStream and spawns
		// independent reader + writer tasks — see its doc comment for the
		// rationale (deadlock + cancel-safety hazards of the prior designs).
		let h = tokio::spawn(async move {
			let local_party_id = groove_bridge.wait_until_local_party().await;
			HyperswarmGrooveBridge::multiplex_connection(
				groove_bridge,
				conn,
				remote_client,
				caps_rx,
				local_party_id,
			)
			.await;
		});

		self.0.swarm_workers.lock().await.push(h);
	}
}

#[async_trait]
impl GroovePeerTransport for HyperswarmGrooveBridge {
	async fn send_to(&self, peer: ClientId, payload: SyncPayload) -> GrooveResult<()> {
		if *self.0.shutting_down.lock().await {
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

		let mut workers = self.0.swarm_workers.lock().await;
		for h in workers.drain(..) {
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


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
// `Mutex` is still used for the bridge's internal bookkeeping maps
// (`outbound_by_peer`, `active_remote_clients`, etc.). The SwarmConnection
// itself is no longer mutex-wrapped — it's moved into a single owning task
// inside `multiplex_connection` to avoid the read/write deadlock that
// previously made P2P sync silently fail.
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

	async fn multiplex_connection(
		bridge: HyperswarmGrooveBridge,
		mut conn: SwarmConnection,
		remote_client: ClientId,
		mut capsule_rx: mpsc::UnboundedReceiver<Vec<u8>>,
		local_party_id: ClientId,
	) {
		// Owning task that interleaves reads and writes on a single `SwarmConnection`.
		//
		// Previously the bridge wrapped the connection in `Arc<Mutex<SwarmConnection>>`
		// and spawned two tasks — one calling `stream.read().await` and one calling
		// `stream.write().await`, each acquiring the mutex around the IO. Because
		// `SecretStream::read` suspends until incoming bytes arrive AND the
		// `MutexGuard` is held across that `.await`, the writer could never acquire
		// the mutex and **no outbound bytes ever left the wire**. From the host's
		// perspective every `forward outbound` log line was a lie — the capsule made
		// it into the mpsc channel but the writer half was deadlocked behind the
		// reader holding the connection mutex. (Symptom: both peers logged endless
		// `forward outbound` events but zero `recv inbound` on either side.)
		//
		// Borrow-checker shape: each `select!` branch only borrows a disjoint field of
		// the local task (one borrows `capsule_rx`, the other borrows `conn.peer.stream`).
		// When one branch wins, the other future is dropped before the matched handler
		// runs, freeing the mutable borrow for the handler.
		//
		// Cancel-safety caveat: `SecretStream::read` is not fully cancel-safe — if a
		// partial frame has been consumed from the underlying UDX stream and the read
		// future is dropped, the next `read()` will desync. In practice the window is
		// microseconds because UDX delivers frames atomically per packet. The `biased`
		// ordering below makes `read` win when both are ready, so cancellation only
		// happens when `read` is blocked with zero bytes in flight (the actual
		// deadlock-relevant case). TODO: vendor `peeroxide-dht::SecretStream` to add
		// `into_split()` so reader/writer have independent state and full cancel-safety.
		let inbound = bridge.0.inbound_dispatch.clone();
		loop {
			tokio::select! {
				biased;
				msg = conn.peer.stream.read() => {
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
				capsule_opt = capsule_rx.recv() => {
					let Some(data) = capsule_opt else { break };
					if let Err(e) = conn.peer.stream.write(&data).await {
						log::warn!(
							target: "avenos::peeroxide",
							"peer stream write failed peer={remote_client:?}: {e:?}",
						);
						break;
					}
				}
			}
		}

		let _ = conn.peer.stream.shutdown().await;

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

		// IMPORTANT: pass the `SwarmConnection` by value into the owning task. Earlier
		// versions wrapped it in `Arc<Mutex<SwarmConnection>>` and ran read+write on
		// separate tasks, which deadlocked permanently because `SecretStream::read`
		// suspends the task while holding the connection mutex (see `multiplex_connection`
		// docs above).
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


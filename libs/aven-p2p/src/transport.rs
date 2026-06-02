//! [`HyperswarmTransport`] — one `groove::SyncTransport` over peeroxide.
//!
//! Per connection, peeroxide hands us an encrypted `SecretStream`. We wrap it in
//! a protomux [`Mux`] (its own task owns the stream and does the non-cancel-safe
//! framed reads internally) and open one `avenos/sync` [`Channel`]. The channel's
//! `recv()` is mpsc-backed (cancel-safe) and `send()` is non-blocking, so a single
//! `select!` actor reconciles inbound frames and an outbound queue without ever
//! corrupting the stream — the duplex problem the raw `SecretStream` can't solve.
//!
//! Frames are the engine's length-prefixed `SyncFrameV1` (reused codec), tagged
//! on arrival with `Source::Client(remote_pubkey)` — and that pubkey, being
//! Noise-authenticated, *is* the peer's biscuit-subject DID (plan §2.7).

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use groove::{
    decode_length_prefixed, encode_length_prefixed, InboxEntry, JazzError, PeerId, Source,
    SyncPayload, SyncTargetId, SyncTransport,
};
use peeroxide::{spawn, SwarmConfig, SwarmConnection, SwarmHandle};
use peeroxide_dht::protomux::{ChannelEvent, Mux};
use tokio::sync::{mpsc, Mutex};

/// protomux protocol name for the spark-sync channel.
const SYNC_PROTOCOL: &str = "avenos/sync";
/// protomux message-type index for a sync frame.
const SYNC_MSG: u32 = 0;

type PeerMap = Arc<Mutex<HashMap<PeerId, mpsc::Sender<Vec<u8>>>>>;

/// peeroxide Hyperswarm transport. Construct via [`HyperswarmTransport::join`],
/// then hand `Arc<Self>` to the engine as `Arc<dyn SyncTransport>` and drain
/// [`HyperswarmTransport::next_peer`] to register discovered peers.
pub struct HyperswarmTransport {
    handle: SwarmHandle,
    inbound_rx: Mutex<mpsc::Receiver<InboxEntry>>,
    peers: PeerMap,
    peer_events_rx: Mutex<mpsc::Receiver<PeerId>>,
    _swarm_task: tokio::task::JoinHandle<()>,
    _accept_task: tokio::task::JoinHandle<()>,
}

impl HyperswarmTransport {
    /// Open the swarm with `config`, join every `topic`, and start accepting
    /// connections. `server` = announce on the topics (avens); devices pass
    /// `false` (lookup only) — both still accept inbound connections.
    pub async fn join(
        config: SwarmConfig,
        topics: Vec<[u8; 32]>,
        server: bool,
    ) -> groove::Result<Self> {
        let (swarm_task, handle, mut conn_rx) = spawn(config)
            .await
            .map_err(|e| JazzError::Sync(format!("swarm spawn: {e}")))?;
        for t in &topics {
            handle
                .join(*t, crate::join_opts(server, true))
                .await
                .map_err(|e| JazzError::Sync(format!("topic join: {e}")))?;
        }

        let (inbound_tx, inbound_rx) = mpsc::channel::<InboxEntry>(1024);
        let (peer_tx, peer_rx) = mpsc::channel::<PeerId>(64);
        let peers: PeerMap = Arc::new(Mutex::new(HashMap::new()));

        let peers_accept = peers.clone();
        let accept_task = tokio::spawn(async move {
            while let Some(conn) = conn_rx.recv().await {
                let peer = PeerId(*conn.remote_public_key());
                let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>(256);
                peers_accept.lock().await.insert(peer, out_tx);
                tokio::spawn(run_connection(
                    conn,
                    peer,
                    inbound_tx.clone(),
                    out_rx,
                    peers_accept.clone(),
                    peer_tx.clone(),
                ));
            }
        });

        Ok(Self {
            handle,
            inbound_rx: Mutex::new(inbound_rx),
            peers,
            peer_events_rx: Mutex::new(peer_rx),
            _swarm_task: swarm_task,
            _accept_task: accept_task,
        })
    }

    /// The next newly-connected, Noise-authenticated peer. The app drains this in
    /// a task and calls `register_peer_sync_client(peer)` so the engine begins
    /// frontier reconciliation with it.
    pub async fn next_peer(&self) -> Option<PeerId> {
        self.peer_events_rx.lock().await.recv().await
    }
}

/// One connection actor: drives a protomux channel, bridging inbound frames to
/// the shared inbox and an outbound queue to the wire. Owns `conn` for its whole
/// life so peeroxide's runtime/socket keep-alive guards survive.
async fn run_connection(
    conn: SwarmConnection,
    peer: PeerId,
    inbound: mpsc::Sender<InboxEntry>,
    mut out_rx: mpsc::Receiver<Vec<u8>>,
    peers: PeerMap,
    notify: mpsc::Sender<PeerId>,
) {
    // Partial-move the stream into the mux; `conn` (minus stream) stays in scope
    // so its UDX runtime/socket guards live as long as this actor.
    let (mux, run) = Mux::new(conn.peer.stream);
    let mux_task = tokio::spawn(run);
    let mut channel = match mux.create_channel(SYNC_PROTOCOL, None, None).await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("aven-p2p: open sync channel to {peer}: {e}");
            peers.lock().await.remove(&peer);
            mux_task.abort();
            return;
        }
    };
    let _ = channel.wait_opened().await;
    let _ = notify.send(peer).await;

    let _keep_mux = mux; // hold a cmd_tx so run_mux stays alive
    loop {
        tokio::select! {
            ev = channel.recv() => match ev {
                Some(ChannelEvent::Message { data, .. }) => match decode_length_prefixed(&data) {
                    Ok((_target, payload)) => {
                        if inbound
                            .send(InboxEntry { source: Source::Client(peer), payload })
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(e) => tracing::warn!("aven-p2p: frame decode from {peer}: {e}"),
                },
                Some(ChannelEvent::Closed { .. }) | None => break,
                _ => {}
            },
            maybe = out_rx.recv() => match maybe {
                Some(frame) => {
                    if channel.send(SYNC_MSG, &frame).is_err() {
                        break;
                    }
                }
                None => break,
            }
        }
    }

    peers.lock().await.remove(&peer);
    mux_task.abort();
}

#[async_trait]
impl SyncTransport for HyperswarmTransport {
    async fn send_to(&self, target: SyncTargetId, payload: SyncPayload) -> groove::Result<()> {
        let peer = match &target {
            SyncTargetId::Client(p) => *p,
            // The mesh addresses peers by their connection handle; DID targets
            // are not used on this path.
            SyncTargetId::PeerDid(_) => return Ok(()),
        };
        let bytes = encode_length_prefixed(target, &payload).map_err(JazzError::Sync)?;
        if let Some(tx) = self.peers.lock().await.get(&peer) {
            let _ = tx.send(bytes).await;
        }
        Ok(())
    }

    async fn recv_inbound(&self) -> Option<InboxEntry> {
        self.inbound_rx.lock().await.recv().await
    }

    async fn shutdown(&self) -> groove::Result<()> {
        let _ = self.handle.destroy().await;
        Ok(())
    }
}

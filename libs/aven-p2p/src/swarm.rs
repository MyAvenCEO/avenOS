use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use rand::Rng;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use std::sync::Arc;

use libudx::{RuntimeHandle, UdxRuntime};
use crate::dht::blind_relay;
use crate::dht::crypto::hash;
use crate::dht::hyperdht::{
    self, HyperDhtConfig, HyperDhtHandle, KeyPair, PeerConnection, ServerEvent,
};
use crate::dht::hyperdht_messages::{
    encode_handshake_to_bytes, HandshakeMessage, NoisePayload, RelayThroughInfo,
    SecretStreamInfo, UdxInfo, MODE_REPLY,
};
use crate::dht::messages::Ipv4Peer;
use crate::dht::noise::Keypair as NoiseKeypair;
use crate::dht::noise_wrap::NoiseWrap;

use crate::connection_set::{ConnectionInfo, ConnectionSet};
use crate::error::SwarmError;
use crate::peer_discovery::{run_discovery, DiscoveryEvent, PeerDiscoveryConfig};
use crate::peer_info::{PeerInfo, Priority};
use crate::util::{is_unroutable_relay_host, short_hex};

static NEXT_STREAM_ID: AtomicU32 = AtomicU32::new(1);

fn next_stream_id() -> u32 {
    NEXT_STREAM_ID.fetch_add(1, Ordering::Relaxed)
}

/// Parse `suggestedIPv4@hostname:port` HyperDHT bootstrap lines into the UDP endpoint peers use
/// for optimistic `PEER_HANDSHAKE` relay attempts. Skips non-IPv4 left sides.
fn ipv4_peers_from_dht_bootstraps(lines: &[String]) -> Vec<Ipv4Peer> {
    let mut out: Vec<Ipv4Peer> = Vec::new();
    for line in lines {
        let line = line.trim();
        let Some(at) = line.find('@') else {
            continue;
        };
        let ip = line[..at].trim();
        if ip.parse::<std::net::Ipv4Addr>().is_err() {
            continue;
        }
        let hp = line[at + 1..].trim();
        let Some(port_s) = hp.rsplit(':').next() else {
            continue;
        };
        let Ok(port) = port_s.parse::<u16>() else {
            continue;
        };
        let p = Ipv4Peer {
            host: ip.to_string(),
            port,
        };
        if out.iter().any(|x| x.host == p.host && x.port == p.port) {
            continue;
        }
        out.push(p);
        if out.len() >= 3 {
            break;
        }
    }
    out
}

const DEFAULT_MAX_PEERS: usize = 64;
const DEFAULT_MAX_PARALLEL: usize = 8;

// ── Retry backoff tiers (matching Node.js lib/retry-timer.js) ────────────────
// Each tier: [base_ms, jitter1, jitter2, jitter3]
// Delay = base + rand(0..j1) + rand(0..j2) + rand(0..j3)
const BACKOFF_S: [u64; 4] = [1000, 250, 100, 50];
const BACKOFF_M: [u64; 4] = [5000, 1000, 500, 250];
const BACKOFF_L: [u64; 4] = [15000, 5000, 2500, 1000];
const BACKOFF_X: [u64; 4] = [600_000, 60_000, 30_000, 15_000];

fn retry_delay(info: &PeerInfo) -> Duration {
    let idx = if info.proven {
        (info.attempts as usize).min(3)
    } else {
        ((info.attempts + 1) as usize).min(3)
    };
    let tier = match idx {
        0 => &BACKOFF_S,
        1 => &BACKOFF_M,
        2 => &BACKOFF_L,
        _ => &BACKOFF_X,
    };
    let mut rng = rand::rng();
    let jitter = rng.random_range(0..tier[1])
        + rng.random_range(0..tier[2])
        + rng.random_range(0..tier[3]);
    Duration::from_millis(tier[0] + jitter)
}

// ── Public types ─────────────────────────────────────────────────────────────

/// Configuration for a [`Hyperswarm`](SwarmHandle) instance.
#[non_exhaustive]
pub struct SwarmConfig {
    /// Ed25519 key pair. Auto-generated if `None`.
    pub key_pair: Option<KeyPair>,
    /// Underlying HyperDHT configuration.
    pub dht: HyperDhtConfig,
    /// Maximum total peer connections (default 64).
    pub max_peers: usize,
    /// Maximum concurrent outgoing connection attempts (default 8).
    pub max_parallel: usize,
    /// Firewall value sent in handshakes (default 0).
    pub firewall: u64,
    /// Public key of the hosted blind-relay node (`relay_through` in Noise).
    pub relay_through: Option<[u8; 32]>,
    /// Socket address hints for Hyperswarm blind-relay wired mode (normally unused).
    pub relay_address: Option<std::net::SocketAddr>,
    /// Extra UDP hints advertised in handshake `relay_addresses` (e.g. DHT bootstrap + blind-relay).
    pub relay_address_hints: Vec<std::net::SocketAddr>,
    /// Optional connect UI progress callbacks (outbound connect path).
    pub connect_ui: Option<crate::dht::connect_ui::ConnectUiHook>,
    /// When true, outbound connects use blind-relay only (vault relay-only mode).
    pub prefer_relay_only: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// When `true` for a remote static key, suppress blind-relay fallback, stale-slot
    /// clearing, and dominant-side outbound nudges — the host app owns an in-flight link.
    pub should_suppress_transport: Option<Arc<dyn Fn([u8; 32]) -> bool + Send + Sync>>,
    /// When `false`, skip outbound DHT connect for this remote pk (relay-only subordinate half).
    pub should_outbound_connect: Option<Arc<dyn Fn([u8; 32]) -> bool + Send + Sync>>,
}

impl Default for SwarmConfig {
    fn default() -> Self {
        Self {
            key_pair: None,
            dht: HyperDhtConfig::default(),
            max_peers: DEFAULT_MAX_PEERS,
            max_parallel: DEFAULT_MAX_PARALLEL,
            firewall: 0,
            relay_through: None,
            relay_address: None,
            relay_address_hints: Vec::new(),
            connect_ui: None,
            prefer_relay_only: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
            should_suppress_transport: None,
            should_outbound_connect: None,
        }
    }
}

impl SwarmConfig {
    /// Create a config pre-populated with the public HyperDHT bootstrap nodes.
    pub fn with_public_bootstrap() -> Self {
        Self {
            dht: HyperDhtConfig::with_public_bootstrap(),
            ..Self::default()
        }
    }
}

/// Options for joining a topic.
#[non_exhaustive]
pub struct JoinOpts {
    /// Announce on this topic (server mode).
    pub server: bool,
    /// Look up peers on this topic (client mode).
    pub client: bool,
    /// Re-announce / re-lookup every few seconds (for short-lived invite topics).
    pub fast_refresh: bool,
}

impl Default for JoinOpts {
    fn default() -> Self {
        Self {
            server: true,
            client: true,
            fast_refresh: false,
        }
    }
}

impl JoinOpts {
    /// Invite / short-lived topics: fast DHT refresh and capped connect retry backoff.
    pub fn fast_refresh() -> Self {
        Self {
            server: true,
            client: true,
            fast_refresh: true,
        }
    }
}

/// An established swarm connection.
#[non_exhaustive]
pub struct SwarmConnection {
    /// The underlying encrypted peer connection.
    pub peer: PeerConnection,
    /// `true` if we initiated this connection.
    pub is_initiator: bool,
    /// Topic(s) associated with this connection.
    pub topics: Vec<[u8; 32]>,
    _runtime: UdxRuntime,
}

impl SwarmConnection {
    /// Returns the remote peer's static public key.
    pub fn remote_public_key(&self) -> &[u8; 32] {
        &self.peer.remote_public_key
    }
}

impl fmt::Debug for SwarmConnection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SwarmConnection")
            .field("remote_public_key", &short_hex(&self.peer.remote_public_key))
            .field("is_initiator", &self.is_initiator)
            .field("topics", &self.topics.len())
            .finish()
    }
}

/// Clone-able handle for controlling a running Hyperswarm.
#[derive(Clone)]
pub struct SwarmHandle {
    cmd_tx: mpsc::Sender<SwarmCommand>,
    dht: HyperDhtHandle,
    key_pair: KeyPair,
}

impl SwarmHandle {
    /// Access the underlying [`HyperDhtHandle`] for low-level DHT operations.
    ///
    /// This exposes mutable/immutable storage, manual peer lookup, and other
    /// DHT primitives not covered by the high-level swarm API.
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// # use peeroxide::{spawn, discovery_key, JoinOpts, SwarmConfig, KeyPair};
    /// # #[tokio::main]
    /// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// let config = SwarmConfig::with_public_bootstrap();
    /// let (_task, handle, _conn_rx) = spawn(config).await?;
    ///
    /// // Publish a mutable record under the swarm's own keypair
    /// let kp = handle.key_pair();
    /// handle.dht().mutable_put(kp, b"hello", 0).await?;
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// # Caveats
    ///
    /// - **Do not call `destroy()`** on the returned handle. The swarm owns
    ///   the DHT lifecycle; destroying it here will break discovery and
    ///   connection establishment.
    /// - **`connect` methods require a `UdxRuntime`** that is not accessible
    ///   from the public API. Use swarm-level topic joins for connection
    ///   establishment instead.
    pub fn dht(&self) -> &HyperDhtHandle {
        &self.dht
    }

    /// The Ed25519 key pair identifying this swarm node.
    ///
    /// This is the same key pair used for topic announcements and Noise
    /// handshakes. It can also be used with [`HyperDhtHandle::mutable_put`]
    /// to publish data that other peers can discover and verify.
    pub fn key_pair(&self) -> &KeyPair {
        &self.key_pair
    }

    /// Join a topic for peer discovery.
    ///
    /// When `opts.server` is true, the swarm announces so other peers can
    /// connect to us. When `opts.client` is true, the swarm looks up peers
    /// and initiates connections.
    pub async fn join(&self, topic: [u8; 32], opts: JoinOpts) -> Result<(), SwarmError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.cmd_tx
            .send(SwarmCommand::Join {
                topic,
                server: opts.server,
                client: opts.client,
                fast_refresh: opts.fast_refresh,
                reply_tx,
            })
            .await
            .map_err(|_| SwarmError::Destroyed)?;
        reply_rx.await.map_err(|_| SwarmError::ChannelClosed)?
    }

    /// Leave a topic, stopping discovery and unannouncing.
    pub async fn leave(&self, topic: [u8; 32]) -> Result<(), SwarmError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.cmd_tx
            .send(SwarmCommand::Leave { topic, reply_tx })
            .await
            .map_err(|_| SwarmError::Destroyed)?;
        reply_rx.await.map_err(|_| SwarmError::ChannelClosed)?
    }

    /// Wait until all joined topics have completed their initial discovery.
    pub async fn flush(&self) -> Result<(), SwarmError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.cmd_tx
            .send(SwarmCommand::Flush { reply_tx })
            .await
            .map_err(|_| SwarmError::Destroyed)?;
        reply_rx.await.map_err(|_| SwarmError::ChannelClosed)?
    }

    /// Destroy the swarm, cancelling all discovery and closing connections.
    pub async fn destroy(&self) -> Result<(), SwarmError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        let _ = self.cmd_tx.send(SwarmCommand::Destroy { reply_tx }).await;
        let _ = reply_rx.await;
        Ok(())
    }

    /// Groove bridge reports an encrypted link is live — suppress parallel outbound connects.
    pub async fn note_peer_connected(&self, public_key: [u8; 32]) -> Result<(), SwarmError> {
        self.cmd_tx
            .send(SwarmCommand::NotePeerConnected { public_key })
            .await
            .map_err(|_| SwarmError::Destroyed)
    }

    /// Groove bridge reports a link closed — clear stale bookkeeping and schedule reconnect.
    pub async fn note_peer_disconnected(&self, public_key: [u8; 32]) -> Result<(), SwarmError> {
        self.cmd_tx
            .send(SwarmCommand::NotePeerDisconnected { public_key })
            .await
            .map_err(|_| SwarmError::Destroyed)
    }

    /// Clear all swarm connection slots and re-queue peers (Groove has no live links).
    pub async fn prepare_reconnect(&self) -> Result<(), SwarmError> {
        self.cmd_tx
            .send(SwarmCommand::PrepareReconnect)
            .await
            .map_err(|_| SwarmError::Destroyed)
    }

    /// Recompute DHT announce relay hints from current bootstrap/local relay and force refresh.
    pub async fn refresh_announce_relays(&self) -> Result<(), SwarmError> {
        self.cmd_tx
            .send(SwarmCommand::RefreshAnnounceRelays)
            .await
            .map_err(|_| SwarmError::Destroyed)
    }

    /// When true, outbound connects use blind-relay only (relay-only cutover; always true in AvenOS).
    pub fn set_prefer_relay_only(&self, _on: bool) {
        self.dht.set_prefer_relay_only(true);
    }

    /// Queue outbound connect to a known peer pk (allowlist dial — no DHT discovery required).
    pub async fn connect_known_peer(
        &self,
        public_key: [u8; 32],
        topic: [u8; 32],
        relay_addresses: Vec<Ipv4Peer>,
    ) -> Result<(), SwarmError> {
        self.cmd_tx
            .send(SwarmCommand::ConnectKnownPeer {
                public_key,
                topic,
                relay_addresses,
            })
            .await
            .map_err(|_| SwarmError::Destroyed)
    }

    /// Invite/signalling topic for blind-relay pair tokens during fast_refresh pairing.
    pub async fn set_active_pair_topic(&self, topic: Option<[u8; 32]>) -> Result<(), SwarmError> {
        self.cmd_tx
            .send(SwarmCommand::SetActivePairTopic { topic })
            .await
            .map_err(|_| SwarmError::Destroyed)
    }

    /// Clear retry/backoff state so pairing or heal can redial immediately.
    pub async fn reset_peer_dial_state(
        &self,
        public_key: Option<[u8; 32]>,
    ) -> Result<(), SwarmError> {
        self.cmd_tx
            .send(SwarmCommand::ResetPeerDialState { public_key })
            .await
            .map_err(|_| SwarmError::Destroyed)
    }

    /// Re-queue outbound dials for peers discovered on fast_refresh (pairing) topics.
    pub async fn redial_pairing_peers(&self) -> Result<(), SwarmError> {
        self.cmd_tx
            .send(SwarmCommand::RedialPairingPeers)
            .await
            .map_err(|_| SwarmError::Destroyed)
    }

    /// True when a dominant outbound dial or subordinate blind-relay half is in flight during pairing.
    pub async fn pairing_dial_in_flight(&self) -> Result<bool, SwarmError> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(SwarmCommand::PairingDialInFlight { reply_tx: tx })
            .await
            .map_err(|_| SwarmError::Destroyed)?;
        rx.await.map_err(|_| SwarmError::Destroyed)
    }
}

// ── Internal types ───────────────────────────────────────────────────────────

enum SwarmCommand {
    Join {
        topic: [u8; 32],
        server: bool,
        client: bool,
        fast_refresh: bool,
        reply_tx: oneshot::Sender<Result<(), SwarmError>>,
    },
    Leave {
        topic: [u8; 32],
        reply_tx: oneshot::Sender<Result<(), SwarmError>>,
    },
    Flush {
        reply_tx: oneshot::Sender<Result<(), SwarmError>>,
    },
    Destroy {
        reply_tx: oneshot::Sender<Result<(), SwarmError>>,
    },
    NotePeerConnected {
        public_key: [u8; 32],
    },
    NotePeerDisconnected {
        public_key: [u8; 32],
    },
    PrepareReconnect,
    RefreshAnnounceRelays,
    /// Reserve a transport slot immediately before delivering an inbound connection.
    ReserveTransportSlot {
        public_key: [u8; 32],
        is_initiator: bool,
    },
    /// Dial a known allowlisted peer without waiting for DHT lookup (relay-only reconnect).
    ConnectKnownPeer {
        public_key: [u8; 32],
        topic: [u8; 32],
        relay_addresses: Vec<Ipv4Peer>,
    },
    SetActivePairTopic {
        topic: Option<[u8; 32]>,
    },
    ResetPeerDialState {
        public_key: Option<[u8; 32]>,
    },
    /// Dominant pairing redial — re-queue peers on fast_refresh topics (invite rendezvous).
    RedialPairingPeers,
    /// Subordinate blind-relay fallback task finished (success or failure).
    NoteRelayFallbackComplete {
        public_key: [u8; 32],
        retry: Option<ServerRelayFallbackParams>,
    },
    /// Retry subordinate blind-relay half after a failed attempt during pairing.
    RespawnRelayFallback {
        params: ServerRelayFallbackParams,
    },
    /// Query whether pairing transport is busy (dominant dial or subordinate relay half).
    PairingDialInFlight {
        reply_tx: oneshot::Sender<bool>,
    },
}

#[allow(dead_code)] // Fields read during leave/unannounce (future)
struct TopicState {
    is_server: bool,
    is_client: bool,
    fast_refresh: bool,
    cancel_tx: Option<oneshot::Sender<()>>,
    force_refresh_tx: mpsc::UnboundedSender<()>,
    refreshed: bool,
}

struct ActorConfig {
    max_peers: usize,
    max_parallel: usize,
    firewall: u64,
    relay_through: Option<[u8; 32]>,
    relay_address: Option<std::net::SocketAddr>,
    relay_address_hints: Vec<std::net::SocketAddr>,
    /// Public DHT bootstrap UDP addresses (`ip:port` from `ip@host:port` lines) — advertised
    /// ahead of loopback in topic announces so remote peers can route handshakes via the same
    /// bootstrap that already forwards `PEER_HANDSHAKE` relay traffic.
    announce_bootstrap_relays: Vec<Ipv4Peer>,
}

struct SwarmActor {
    key_pair: KeyPair,
    dht: HyperDhtHandle,
    config: ActorConfig,
    runtime_handle: Arc<RuntimeHandle>,

    topics: HashMap<[u8; 32], TopicState>,
    discovery_event_tx: mpsc::UnboundedSender<DiscoveryEvent>,

    peers: HashMap<[u8; 32], PeerInfo>,
    connections: ConnectionSet,
    queue: Vec<[u8; 32]>,

    conn_tx: mpsc::Sender<SwarmConnection>,
    cmd_tx: mpsc::Sender<SwarmCommand>,

    server_registered: bool,
    relay_address: Option<Ipv4Peer>,

    active_connects: usize,
    flush_waiters: Vec<oneshot::Sender<Result<(), SwarmError>>>,
    connect_ui: Option<crate::dht::connect_ui::ConnectUiHook>,
    /// Vault relay-only — blind-relay data plane only (owned by HyperDHT handle).
    _prefer_relay_only: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// Shared relay list for DHT announces — refreshed on network path change.
    announce_relay_addrs: Arc<std::sync::RwLock<Vec<Ipv4Peer>>>,
    should_suppress_transport: Option<Arc<dyn Fn([u8; 32]) -> bool + Send + Sync>>,
    should_outbound_connect: Option<Arc<dyn Fn([u8; 32]) -> bool + Send + Sync>>,
    /// Per-peer abort handles for deferred/eager blind-relay fallback tasks.
    relay_fallback_abort: HashMap<[u8; 32], tokio::task::AbortHandle>,
    /// Superseded outbound connect attempts (relay-only — one in-flight dial per pk).
    connect_epoch: HashMap<[u8; 32], u64>,
    /// Signalling topic for deterministic blind-relay tokens during invite pairing.
    active_pair_topic: Option<[u8; 32]>,
}

struct ConnectAttemptResult {
    public_key: [u8; 32],
    epoch: u64,
    result: Result<(PeerConnection, UdxRuntime), SwarmError>,
}

// ── Spawn ────────────────────────────────────────────────────────────────────

/// Create and start a Hyperswarm instance.
///
/// Returns a background task handle, a control handle, and a receiver
/// that yields each new [`SwarmConnection`].
pub async fn spawn(
    config: SwarmConfig,
) -> Result<(JoinHandle<()>, SwarmHandle, mpsc::Receiver<SwarmConnection>), SwarmError> {
    let SwarmConfig {
        key_pair: key_pair_opt,
        mut dht,
        max_peers,
        max_parallel,
        firewall,
        relay_through,
        relay_address,
        relay_address_hints,
        connect_ui,
        prefer_relay_only,
        should_suppress_transport,
        should_outbound_connect,
    } = config;

    dht.connect_relay.relay_through = relay_through;
    dht.connect_relay.relay_address = relay_address;
    dht.connect_relay.relay_address_hints = relay_address_hints.clone();
    dht.connect_ui = connect_ui.clone();
    dht.prefer_relay_only = prefer_relay_only.clone();
    prefer_relay_only.store(true, std::sync::atomic::Ordering::Release);

    let key_pair = key_pair_opt.unwrap_or_else(KeyPair::generate);
    let runtime = UdxRuntime::new()?;

    let bootstrap_lines = dht.dht.bootstrap.clone();

    let (dht_join, dht, server_rx) = hyperdht::spawn(&runtime, dht).await?;
    dht.bootstrapped().await?;

    let local_port = dht.dht().local_port().await?;
    let local_relay_peer = Ipv4Peer {
        host: "127.0.0.1".to_string(),
        port: local_port,
    };

    tracing::info!(port = local_port, "swarm started");

    let (cmd_tx, cmd_rx) = mpsc::channel(64);
    let (conn_tx, conn_rx) = mpsc::channel(64);
    let (discovery_event_tx, discovery_event_rx) = mpsc::unbounded_channel();

    let announce_bootstrap_relays = ipv4_peers_from_dht_bootstraps(&bootstrap_lines);

    let mut initial_relays = announce_bootstrap_relays.clone();
    if initial_relays.len() > 3 {
        initial_relays.truncate(3);
    }
    if !is_unroutable_relay_host(&local_relay_peer.host) && initial_relays.len() < 3 {
        let dup = initial_relays
            .iter()
            .any(|a| a.host == local_relay_peer.host && a.port == local_relay_peer.port);
        if !dup {
            initial_relays.push(local_relay_peer.clone());
        }
    }
    let announce_relay_addrs = Arc::new(std::sync::RwLock::new(initial_relays));

    let handle_dht = dht.clone();
    let handle_key_pair = key_pair.clone();

    let actor = SwarmActor {
        key_pair,
        dht,
        config: ActorConfig {
            max_peers,
            max_parallel,
            firewall,
            relay_through,
            relay_address,
            relay_address_hints,
            announce_bootstrap_relays,
        },
        runtime_handle: runtime.handle(),
        topics: HashMap::new(),
        discovery_event_tx,
        peers: HashMap::new(),
        connections: ConnectionSet::new(),
        queue: Vec::new(),
        conn_tx,
        cmd_tx: cmd_tx.clone(),
        server_registered: false,
        relay_address: Some(local_relay_peer),
        active_connects: 0,
        flush_waiters: Vec::new(),
        connect_ui,
        _prefer_relay_only: prefer_relay_only,
        announce_relay_addrs,
        should_suppress_transport,
        should_outbound_connect,
        relay_fallback_abort: HashMap::new(),
        connect_epoch: HashMap::new(),
        active_pair_topic: None,
    };

    // Keep the DHT runtime alive for the swarm's lifetime.
    // We must await dht_join AFTER actor.run() (which calls dht.destroy()),
    // so the DhtNode finishes closing its IO sockets before we drop the runtime.
    let join = tokio::spawn(async move {
        actor.run(cmd_rx, discovery_event_rx, server_rx).await;
        let _ = dht_join.await;
        drop(runtime);
    });

    let handle = SwarmHandle {
        cmd_tx,
        dht: handle_dht,
        key_pair: handle_key_pair,
    };
    Ok((join, handle, conn_rx))
}

// ── Actor ────────────────────────────────────────────────────────────────────

impl SwarmActor {
    async fn run(
        mut self,
        mut cmd_rx: mpsc::Receiver<SwarmCommand>,
        mut discovery_rx: mpsc::UnboundedReceiver<DiscoveryEvent>,
        mut server_rx: mpsc::UnboundedReceiver<ServerEvent>,
    ) {
        let (connect_result_tx, mut connect_result_rx) =
            mpsc::unbounded_channel::<ConnectAttemptResult>();

        loop {
            tokio::select! {
                cmd = cmd_rx.recv() => {
                    let Some(cmd) = cmd else { break };
                    if self.handle_command(cmd, &connect_result_tx) {
                        break;
                    }
                }
                event = discovery_rx.recv() => {
                    if let Some(event) = event {
                        self.handle_discovery_event(event, &connect_result_tx);
                    }
                }
                event = server_rx.recv() => {
                    if let Some(event) = event {
                        self.handle_server_event(event, &connect_result_tx);
                    }
                }
                result = connect_result_rx.recv() => {
                    if let Some(result) = result {
                        self.handle_connect_result(result, &connect_result_tx);
                    }
                }
            }
        }

        tracing::info!(
            pk = %short_hex(&self.key_pair.public_key),
            topics = self.topics.len(),
            "swarm actor shutting down"
        );

        for (_, state) in self.topics.drain() {
            if let Some(cancel) = state.cancel_tx {
                let _ = cancel.send(());
            }
        }

        if self.server_registered {
            let target = hash(&self.key_pair.public_key);
            self.dht.unregister_server(&target);
            self.server_registered = false;
        }

        let _ = self.dht.destroy().await;
    }

    /// Returns `true` when the actor should shut down.
    fn handle_command(
        &mut self,
        cmd: SwarmCommand,
        connect_result_tx: &mpsc::UnboundedSender<ConnectAttemptResult>,
    ) -> bool {
        match cmd {
            SwarmCommand::Join {
                topic,
                server,
                client,
                fast_refresh,
                reply_tx,
            } => {
                let result = self.do_join(topic, server, client, fast_refresh);
                let _ = reply_tx.send(result);
                false
            }
            SwarmCommand::Leave { topic, reply_tx } => {
                let result = self.do_leave(topic);
                let _ = reply_tx.send(result);
                false
            }
            SwarmCommand::Flush { reply_tx } => {
                if self.all_topics_refreshed() {
                    let _ = reply_tx.send(Ok(()));
                } else {
                    self.flush_waiters.push(reply_tx);
                }
                false
            }
            SwarmCommand::Destroy { reply_tx } => {
                tracing::info!(
                    pk = %short_hex(&self.key_pair.public_key),
                    topics = self.topics.len(),
                    "swarm destroy requested"
                );
                if self.server_registered {
                    let target = hash(&self.key_pair.public_key);
                    self.dht.unregister_server(&target);
                    self.server_registered = false;
                }
                let _ = reply_tx.send(Ok(()));
                true
            }
            SwarmCommand::NotePeerConnected { public_key } => {
                self.note_peer_connected(public_key);
                false
            }
            SwarmCommand::NotePeerDisconnected { public_key } => {
                self.note_peer_disconnected(public_key, connect_result_tx);
                false
            }
            SwarmCommand::PrepareReconnect => {
                self.prepare_stale_reconnect(connect_result_tx);
                false
            }
            SwarmCommand::RefreshAnnounceRelays => {
                self.refresh_announce_relays();
                false
            }
            SwarmCommand::ReserveTransportSlot {
                public_key,
                is_initiator,
            } => {
                if !self.connections.has(&public_key) {
                    self.connections.add(
                        public_key,
                        ConnectionInfo { is_initiator },
                    );
                }
                false
            }
            SwarmCommand::ConnectKnownPeer {
                public_key,
                topic,
                relay_addresses,
            } => {
                self.connect_known_peer(public_key, topic, relay_addresses, connect_result_tx);
                false
            }
            SwarmCommand::SetActivePairTopic { topic } => {
                self.active_pair_topic = topic;
                false
            }
            SwarmCommand::ResetPeerDialState { public_key } => {
                self.reset_peer_dial_state(public_key, connect_result_tx);
                false
            }
            SwarmCommand::RedialPairingPeers => {
                self.redial_pairing_peers(connect_result_tx);
                false
            }
            SwarmCommand::NoteRelayFallbackComplete { public_key, retry } => {
                self.relay_fallback_abort.remove(&public_key);
                if let Some(params) = retry {
                    self.maybe_schedule_relay_fallback_retry(params);
                }
                false
            }
            SwarmCommand::RespawnRelayFallback { params } => {
                self.spawn_server_blind_relay_fallback_params(params);
                false
            }
            SwarmCommand::PairingDialInFlight { reply_tx } => {
                let _ = reply_tx.send(self.pairing_dial_in_flight());
                false
            }
        }
    }

    fn pairing_dial_in_flight(&self) -> bool {
        if !self.any_fast_refresh_topic() {
            return false;
        }
        let dominant_busy = self.peers.iter().any(|(pk, info)| {
            *pk != self.key_pair.public_key
                && self.may_outbound_connect(*pk)
                && !info.banned
                && !info.topics.is_empty()
                && (info.connecting || info.queued)
        });
        dominant_busy || !self.relay_fallback_abort.is_empty()
    }

    fn maybe_schedule_relay_fallback_retry(&self, params: ServerRelayFallbackParams) {
        if !self.any_fast_refresh_topic() {
            return;
        }
        if self.connections.has(&params.remote_pk) {
            return;
        }
        if self.relay_fallback_abort.contains_key(&params.remote_pk) {
            return;
        }
        if self.transport_suppressed(params.remote_pk) {
            return;
        }
        tracing::info!(
            pk = %short_hex(&params.remote_pk),
            token = %format_args!("{:02x?}", &params.token[..4]),
            "server: scheduling blind-relay fallback retry",
        );
        let cmd_tx = self.cmd_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            let _ = cmd_tx
                .send(SwarmCommand::RespawnRelayFallback { params })
                .await;
        });
    }

    fn connect_known_peer(
        &mut self,
        public_key: [u8; 32],
        topic: [u8; 32],
        relay_addresses: Vec<Ipv4Peer>,
        connect_result_tx: &mpsc::UnboundedSender<ConnectAttemptResult>,
    ) {
        if public_key == self.key_pair.public_key {
            return;
        }
        let addrs = if relay_addresses.is_empty() {
            self.build_relay_addrs()
        } else {
            relay_addresses
        };
        if !self.may_outbound_connect(public_key) {
            tracing::debug!(
                pk = %short_hex(&public_key),
                "deferring outbound connect — subordinate relay-only half",
            );
            self.upsert_discovered_peer(public_key, addrs, topic);
            return;
        }
        if self.connections.has(&public_key) {
            return;
        }
        if self.connections.len() >= self.config.max_peers {
            return;
        }

        if let Some(hook) = &self.connect_ui {
            hook(crate::dht::connect_ui::ConnectUiEvent::Progress {
                remote_pk: public_key,
                phase: crate::dht::connect_ui::ConnectProgressPhase::Discovering,
            });
        }

        self.upsert_discovered_peer(public_key, addrs, topic);
        self.try_queue_outbound(public_key, connect_result_tx);
    }

    fn upsert_discovered_peer(
        &mut self,
        public_key: [u8; 32],
        relay_addresses: Vec<Ipv4Peer>,
        topic: [u8; 32],
    ) {
        let info = self
            .peers
            .entry(public_key)
            .or_insert_with(|| PeerInfo::new(public_key, relay_addresses.clone()));
        if !relay_addresses.is_empty() {
            info.relay_addresses = relay_addresses;
        }
        if !info.topics.contains(&topic) {
            info.topics.push(topic);
        }
    }

    fn clear_peer_dial(&mut self, pk: [u8; 32], remove_slot: bool) {
        self.cancel_relay_fallback(pk);
        if let Some(epoch) = self.connect_epoch.get_mut(&pk) {
            *epoch += 1;
        }
        if remove_slot {
            self.connections.remove(&pk);
        }
        if let Some(info) = self.peers.get_mut(&pk) {
            info.connecting = false;
            info.queued = false;
            info.set_waiting(false);
        }
        self.queue.retain(|queued| *queued != pk);
    }

    fn pair_topic_for_peer(&self, pk: &[u8; 32]) -> Option<[u8; 32]> {
        if self.any_fast_refresh_topic() {
            if let Some(topic) = self.active_pair_topic {
                return Some(topic);
            }
        }
        self.peers
            .get(pk)
            .and_then(|info| info.topics.first().copied())
    }

    /// Queue outbound dial when gates allow; clears retry backoff on discovery/redial.
    fn try_queue_outbound(
        &mut self,
        public_key: [u8; 32],
        connect_result_tx: &mpsc::UnboundedSender<ConnectAttemptResult>,
    ) {
        let pairing = self.any_fast_refresh_topic();
        let Some(info) = self.peers.get_mut(&public_key) else {
            return;
        };
        if info.banned {
            tracing::debug!(pk = %short_hex(&public_key), "outbound skip — banned");
            return;
        }
        if pairing {
            info.set_waiting(false);
        } else if info.is_waiting() {
            info.set_waiting(false);
        }
        if info.queued {
            tracing::debug!(pk = %short_hex(&public_key), "outbound skip — already queued");
            return;
        }
        if info.connecting {
            tracing::debug!(pk = %short_hex(&public_key), "outbound skip — connecting");
            return;
        }
        if self.connections.has(&public_key) {
            tracing::debug!(pk = %short_hex(&public_key), "outbound skip — connection slot");
            return;
        }
        info.queued = true;
        info.priority = info.get_priority();
        self.queue.push(public_key);
        self.attempt_connections(connect_result_tx);
    }

    fn reset_peer_dial_state(
        &mut self,
        public_key: Option<[u8; 32]>,
        connect_result_tx: &mpsc::UnboundedSender<ConnectAttemptResult>,
    ) {
        let pks: Vec<[u8; 32]> = match public_key {
            Some(pk) => vec![pk],
            None => self.peers.keys().copied().collect(),
        };
        for pk in &pks {
            self.clear_peer_dial(*pk, true);
        }
        for pk in pks {
            if pk == self.key_pair.public_key {
                continue;
            }
            let Some(info) = self.peers.get(&pk) else {
                continue;
            };
            if info.banned || info.topics.is_empty() || !self.may_outbound_connect(pk) {
                continue;
            }
            self.try_queue_outbound(pk, connect_result_tx);
        }
    }

    /// Pairing rendezvous: dominant re-queues dials for all peers on invite topics.
    fn redial_pairing_peers(
        &mut self,
        connect_result_tx: &mpsc::UnboundedSender<ConnectAttemptResult>,
    ) {
        if !self.any_fast_refresh_topic() {
            return;
        }
        let pks: Vec<[u8; 32]> = self
            .peers
            .iter()
            .filter(|(pk, info)| {
                **pk != self.key_pair.public_key
                    && !info.banned
                    && !info.topics.is_empty()
                    && self.may_outbound_connect(**pk)
            })
            .map(|(pk, _)| *pk)
            .collect();
        if pks.is_empty() {
            let total = self.peers.len();
            let subordinate_only = self
                .peers
                .keys()
                .filter(|pk| **pk != self.key_pair.public_key && !self.may_outbound_connect(**pk))
                .count();
            tracing::info!(
                peers_map = total,
                subordinate_only,
                "pairing redial — no dominant outbound peers (awaiting discovery or subordinate half)",
            );
            return;
        }
        for pk in pks {
            if self
                .peers
                .get(&pk)
                .is_some_and(|info| info.connecting || info.queued)
            {
                tracing::info!(
                    pk = %short_hex(&pk),
                    "pairing redial — skip (dial already in flight)",
                );
                continue;
            }
            if self.connections.has(&pk) {
                self.clear_peer_dial(pk, true);
            } else if let Some(info) = self.peers.get_mut(&pk) {
                info.queued = false;
                info.set_waiting(false);
            }
            tracing::info!(pk = %short_hex(&pk), "pairing redial — queue outbound");
            self.try_queue_outbound(pk, connect_result_tx);
        }
    }

    fn note_peer_connected(&mut self, pk: [u8; 32]) {
        if !self.connections.has(&pk) {
            self.connections
                .add(pk, ConnectionInfo { is_initiator: false });
        }
        if let Some(info) = self.peers.get_mut(&pk) {
            info.connecting = false;
            info.queued = false;
            info.set_waiting(false);
            info.connected();
        }
        self.queue.retain(|queued| *queued != pk);
    }

    fn note_peer_disconnected(
        &mut self,
        pk: [u8; 32],
        connect_result_tx: &mpsc::UnboundedSender<ConnectAttemptResult>,
    ) {
        self.connections.remove(&pk);
        if let Some(info) = self.peers.get_mut(&pk) {
            info.connecting = false;
            info.disconnected();
        }
        if let Some(info) = self.peers.get(&pk) {
            if !info.banned && !info.topics.is_empty() && !info.queued {
                self.schedule_retry(pk, connect_result_tx);
            }
        }
    }

    /// Groove bridge is authoritative for live links; clear stale swarm slots and re-queue.
    fn prepare_stale_reconnect(
        &mut self,
        connect_result_tx: &mpsc::UnboundedSender<ConnectAttemptResult>,
    ) {
        for pk in self.connections.drain_all() {
            if let Some(info) = self.peers.get_mut(&pk) {
                info.connecting = false;
                info.disconnected();
            }
        }
        for info in self.peers.values_mut() {
            info.connecting = false;
            info.set_waiting(false);
        }
        let to_retry: Vec<[u8; 32]> = self
            .peers
            .iter()
            .filter(|(pk, info)| {
                **pk != self.key_pair.public_key
                    && !info.banned
                    && !info.topics.is_empty()
                    && !info.connecting
                    && !info.queued
                    && self.may_outbound_connect(**pk)
            })
            .map(|(pk, _)| *pk)
            .collect();
        for pk in to_retry {
            self.schedule_retry(pk, connect_result_tx);
        }
    }

    fn any_fast_refresh_topic(&self) -> bool {
        self.topics.values().any(|t| t.fast_refresh)
    }

    fn build_relay_addrs(&self) -> Vec<Ipv4Peer> {
        let mut relay_addrs = self.config.announce_bootstrap_relays.clone();
        if relay_addrs.len() > 3 {
            relay_addrs.truncate(3);
        }
        if let Some(local) = &self.relay_address {
            if !is_unroutable_relay_host(&local.host) {
                let dup = relay_addrs
                    .iter()
                    .any(|a| a.host == local.host && a.port == local.port);
                if !dup && relay_addrs.len() < 3 {
                    relay_addrs.push(local.clone());
                }
            }
        }
        relay_addrs
    }

    fn refresh_announce_relays(&mut self) {
        let addrs = self.build_relay_addrs();
        if let Ok(mut guard) = self.announce_relay_addrs.write() {
            *guard = addrs;
        }
        for state in self.topics.values_mut() {
            state.refreshed = false;
            let _ = state.force_refresh_tx.send(());
        }
        tracing::debug!("announce relay addrs refreshed for {} topic(s)", self.topics.len());
    }

    fn do_join(
        &mut self,
        topic: [u8; 32],
        server: bool,
        client: bool,
        fast_refresh: bool,
    ) -> Result<(), SwarmError> {
        if let Some(state) = self.topics.get_mut(&topic) {
            // Pairing nudge re-joins the same invite topic — force an immediate lookup
            // so flush() waits for fresh PeerFound events before dominant redial.
            state.refreshed = false;
            let _ = state.force_refresh_tx.send(());
            return Ok(());
        }

        if server && !self.server_registered {
            let target = hash(&self.key_pair.public_key);
            self.dht.register_server(&target);
            self.server_registered = true;
            tracing::debug!(pk = %short_hex(&self.key_pair.public_key), "server registered");
        }

        let (cancel_tx, cancel_rx) = oneshot::channel();
        let (force_refresh_tx, force_refresh_rx) = mpsc::unbounded_channel();

        let relay_addrs = Arc::clone(&self.announce_relay_addrs);

        tokio::spawn(run_discovery(
            PeerDiscoveryConfig {
                topic,
                is_server: server,
                is_client: client,
                fast_refresh,
            },
            self.dht.clone(),
            self.key_pair.clone(),
            relay_addrs,
            self.discovery_event_tx.clone(),
            force_refresh_rx,
            cancel_rx,
        ));

        self.topics.insert(
            topic,
            TopicState {
                is_server: server,
                is_client: client,
                fast_refresh,
                cancel_tx: Some(cancel_tx),
                force_refresh_tx,
                refreshed: false,
            },
        );
        Ok(())
    }

    fn do_leave(&mut self, topic: [u8; 32]) -> Result<(), SwarmError> {
        if let Some(state) = self.topics.remove(&topic) {
            if let Some(cancel) = state.cancel_tx {
                let _ = cancel.send(());
            }
            for peer in self.peers.values_mut() {
                peer.topics.retain(|t| *t != topic);
            }

            if state.is_server && self.server_registered {
                let has_remaining_server_topics =
                    self.topics.values().any(|t| t.is_server);
                if !has_remaining_server_topics {
                    let target = hash(&self.key_pair.public_key);
                    self.dht.unregister_server(&target);
                    self.server_registered = false;
                    tracing::debug!(
                        pk = %short_hex(&self.key_pair.public_key),
                        "server unregistered (no remaining server topics)"
                    );
                }
            }
        }
        Ok(())
    }

    fn handle_discovery_event(
        &mut self,
        event: DiscoveryEvent,
        connect_result_tx: &mpsc::UnboundedSender<ConnectAttemptResult>,
    ) {
        match event {
            DiscoveryEvent::PeerFound {
                public_key,
                relay_addresses,
                topic,
            } => {
                if public_key == self.key_pair.public_key {
                    return;
                }
                if !self.may_outbound_connect(public_key) {
                    tracing::debug!(
                        pk = %short_hex(&public_key),
                        "deferring outbound connect — subordinate relay-only half",
                    );
                    self.upsert_discovered_peer(public_key, relay_addresses, topic);
                    return;
                }
                if self.connections.has(&public_key) {
                    tracing::debug!(
                        pk = %short_hex(&public_key),
                        "discovery skip — connection slot",
                    );
                    return;
                }
                if self.connections.len() >= self.config.max_peers {
                    tracing::debug!(
                        pk = %short_hex(&public_key),
                        "discovery skip — max peers",
                    );
                    return;
                }

                if let Some(hook) = &self.connect_ui {
                    hook(crate::dht::connect_ui::ConnectUiEvent::Progress {
                        remote_pk: public_key,
                        phase: crate::dht::connect_ui::ConnectProgressPhase::Discovering,
                    });
                }

                self.upsert_discovered_peer(public_key, relay_addresses, topic);
                if self.any_fast_refresh_topic() {
                    tracing::info!(
                        pk = %short_hex(&public_key),
                        "pairing discovery — dominant queue outbound",
                    );
                }
                self.try_queue_outbound(public_key, connect_result_tx);
            }
            DiscoveryEvent::RefreshComplete { topic } => {
                if let Some(state) = self.topics.get_mut(&topic) {
                    state.refreshed = true;
                }
                self.check_flush_waiters();
            }
        }
    }

    fn attempt_connections(
        &mut self,
        connect_result_tx: &mpsc::UnboundedSender<ConnectAttemptResult>,
    ) {
        while self.active_connects < self.config.max_parallel && !self.queue.is_empty() {
            // Sort by priority descending
            self.queue.sort_by(|a, b| {
                let pa = self
                    .peers
                    .get(a)
                    .map_or(Priority::VeryLow, |i| i.priority);
                let pb = self
                    .peers
                    .get(b)
                    .map_or(Priority::VeryLow, |i| i.priority);
                pb.cmp(&pa)
            });

            let pk = self.queue.remove(0);
            let relay_addrs = if let Some(info) = self.peers.get_mut(&pk) {
                info.queued = false;
                info.connecting = true;
                info.attempts += 1;
                info.relay_addresses.clone()
            } else {
                vec![]
            };

            self.active_connects += 1;
            let epoch = {
                let entry = self.connect_epoch.entry(pk).or_insert(0);
                *entry += 1;
                *entry
            };
            let dht = self.dht.clone();
            let key_pair = self.key_pair.clone();
            let result_tx = connect_result_tx.clone();
            let rh = self.runtime_handle.clone();

            let pair_topic = self.pair_topic_for_peer(&pk);
            tokio::spawn(async move {
                let conn_runtime = UdxRuntime::shared(rh);
                tracing::info!(
                    pk = %short_hex(&pk),
                    epoch,
                    pair_topic = ?pair_topic.map(|t| short_hex(&t)),
                    "connecting to peer (relay-only)"
                );
                match dht
                    .connect_with_nodes(&key_pair, pk, &relay_addrs, pair_topic, &conn_runtime)
                    .await
                {
                    Ok(conn) => {
                        tracing::info!(pk = %short_hex(&pk), "peer connected");
                        let _ = result_tx.send(ConnectAttemptResult {
                            public_key: pk,
                            epoch,
                            result: Ok((conn, conn_runtime)),
                        });
                    }
                    Err(e) => {
                        tracing::debug!(pk = %short_hex(&pk), err = %e, "peer connect failed");
                        let _ = result_tx.send(ConnectAttemptResult {
                            public_key: pk,
                            epoch,
                            result: Err(SwarmError::Dht(e)),
                        });
                    }
                }
            });
        }
    }

    fn handle_connect_result(
        &mut self,
        result: ConnectAttemptResult,
        connect_result_tx: &mpsc::UnboundedSender<ConnectAttemptResult>,
    ) {
        self.active_connects = self.active_connects.saturating_sub(1);

        if self
            .connect_epoch
            .get(&result.public_key)
            .is_some_and(|current| *current != result.epoch)
        {
            tracing::debug!(
                pk = %short_hex(&result.public_key),
                "connect result stale — superseded dial"
            );
            return;
        }

        if let Some(info) = self.peers.get_mut(&result.public_key) {
            info.connecting = false;
        }

        match result.result {
            Ok((conn, runtime)) => {
                let pk = result.public_key;

                // Dedup: compare public keys to decide tie-break
                if self.connections.has(&pk) {
                    let we_are_dominant = self.key_pair.public_key > pk;
                    if let Some(existing) = self.connections.get(&pk) {
                        if existing.is_initiator == we_are_dominant {
                            tracing::debug!(pk = %short_hex(&pk), "dedup: keeping existing");
                            return;
                        }
                    }
                    self.connections.remove(&pk);
                }

                self.connections
                    .add(pk, ConnectionInfo { is_initiator: true });

                let topics = if let Some(info) = self.peers.get_mut(&pk) {
                    info.connected();
                    info.topics.clone()
                } else {
                    vec![]
                };

                let swarm_conn = SwarmConnection {
                    peer: conn,
                    is_initiator: true,
                    topics,
                    _runtime: runtime,
                };
                if self.conn_tx.try_send(swarm_conn).is_err() {
                    tracing::warn!("connection channel full, dropping connection");
                }
            }
            Err(e) => {
                if self.any_fast_refresh_topic() {
                    tracing::info!(
                        pk = %short_hex(&result.public_key),
                        err = %e,
                        "connect failed during pairing",
                    );
                } else {
                    tracing::debug!(
                        pk = %short_hex(&result.public_key),
                        err = %e,
                        "connect failed",
                    );
                }
                if let Some(hook) = &self.connect_ui {
                    hook(crate::dht::connect_ui::ConnectUiEvent::Disconnected {
                        remote_pk: result.public_key,
                    });
                }
                self.schedule_retry(result.public_key, connect_result_tx);
            }
        }

        self.attempt_connections(connect_result_tx);
    }

    fn schedule_retry(
        &mut self,
        pk: [u8; 32],
        connect_result_tx: &mpsc::UnboundedSender<ConnectAttemptResult>,
    ) {
        if !self.may_outbound_connect(pk) {
            return;
        }
        let cap_for_pairing = self.any_fast_refresh_topic();
        let Some(info) = self.peers.get_mut(&pk) else {
            return;
        };
        if info.banned || info.topics.is_empty() {
            return;
        }

        if cap_for_pairing {
            self.try_queue_outbound(pk, connect_result_tx);
            return;
        }

        if info.is_waiting() || info.queued || info.connecting {
            return;
        }

        let delay = retry_delay(info);
        info.set_waiting(true);

        let cmd_tx = self.cmd_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            let _ = cmd_tx
                .send(SwarmCommand::ResetPeerDialState {
                    public_key: Some(pk),
                })
                .await;
        });
    }

    fn handle_server_event(
        &mut self,
        event: ServerEvent,
        connect_result_tx: &mpsc::UnboundedSender<ConnectAttemptResult>,
    ) {
        match event {
            ServerEvent::PeerHandshake {
                msg,
                from,
                target: _,
                reply_tx,
            } => {
                self.handle_server_handshake(msg, from, reply_tx, connect_result_tx);
            }
        }
    }

    fn transport_suppressed(&self, pk: [u8; 32]) -> bool {
        self.should_suppress_transport
            .as_ref()
            .is_some_and(|f| f(pk))
    }

    fn may_outbound_connect(&self, remote_pk: [u8; 32]) -> bool {
        self.should_outbound_connect
            .as_ref()
            .is_none_or(|gate| gate(remote_pk))
    }

    fn cancel_relay_fallback(&mut self, pk: [u8; 32]) {
        if let Some(h) = self.relay_fallback_abort.remove(&pk) {
            h.abort();
        }
    }

    fn handle_server_handshake(
        &mut self,
        msg: HandshakeMessage,
        from: Ipv4Peer,
        reply_tx: oneshot::Sender<Option<Vec<u8>>>,
        _connect_result_tx: &mpsc::UnboundedSender<ConnectAttemptResult>,
    ) {
        let noise_kp = NoiseKeypair {
            public_key: self.key_pair.public_key,
            secret_key: self.key_pair.secret_key,
        };

        let mut nw = NoiseWrap::new_responder(noise_kp);

        let remote_payload = match nw.recv(&msg.noise) {
            Ok(p) => p,
            Err(e) => {
                tracing::debug!(err = %e, "server handshake: noise recv failed");
                let _ = reply_tx.send(None);
                return;
            }
        };

        if remote_payload.error != 0 {
            let _ = reply_tx.send(None);
            return;
        }

        let remote_pk = match nw.remote_static_key() {
            Some(pk) => pk,
            None => {
                tracing::debug!("server handshake: remote static key unknown after recv");
                let _ = reply_tx.send(None);
                return;
            }
        };

        let local_stream_id = next_stream_id();

        let (relay_token, relay_through_info) = if let Some(relay_pk) = self.config.relay_through {
            let pair_topic = self.pair_topic_for_peer(&remote_pk);
            let token = blind_relay::resolve_pair_token(
                pair_topic.as_ref(),
                &self.key_pair.public_key,
                &remote_pk,
                &relay_pk,
            );
            let info = RelayThroughInfo {
                version: 1,
                public_key: relay_pk,
                token,
            };
            (Some(token), Some(info))
        } else {
            (None, None)
        };

        let reply_payload = NoisePayload {
            version: 1,
            error: 0,
            firewall: self.config.firewall,
            addresses4: vec![],
            addresses6: vec![],
            udx: Some(UdxInfo {
                version: 1,
                reusable_socket: true,
                id: u64::from(local_stream_id),
                seq: 0,
            }),
            secret_stream: Some(SecretStreamInfo { version: 1 }),
            relay_through: relay_through_info,
            relay_addresses: {
                let mut addrs: Vec<Ipv4Peer> = self
                    .config
                    .relay_address_hints
                    .iter()
                    .filter_map(|addr| {
                        let host = addr.ip().to_string();
                        if is_unroutable_relay_host(&host) {
                            return None;
                        }
                        Some(Ipv4Peer {
                            host,
                            port: addr.port(),
                        })
                    })
                    .collect();
                if let Some(addr) = self.config.relay_address {
                    let host = addr.ip().to_string();
                    let port = addr.port();
                    if !is_unroutable_relay_host(&host)
                        && !addrs.iter().any(|a| a.host == host && a.port == port)
                    {
                        addrs.push(Ipv4Peer { host, port });
                    }
                }
                if addrs.is_empty() {
                    None
                } else {
                    Some(addrs)
                }
            },
        };

        let noise_reply = match nw.send(&reply_payload) {
            Ok(b) => b,
            Err(e) => {
                tracing::debug!(err = %e, "server handshake: noise send failed");
                let _ = reply_tx.send(None);
                return;
            }
        };

        let nw_result = match nw.finalize() {
            Ok(r) => r,
            Err(e) => {
                tracing::debug!(err = %e, "server handshake: noise finalize failed");
                let _ = reply_tx.send(None);
                return;
            }
        };

        let relayed_via = msg.peer_address.clone();

        let reply_msg = HandshakeMessage {
            mode: MODE_REPLY,
            noise: noise_reply,
            peer_address: relayed_via.as_ref().map(|_| from.clone()),
            relay_address: None,
        };
        let _ = reply_tx.send(encode_handshake_to_bytes(&reply_msg).ok());

        if self.connections.has(&remote_pk) {
            if self.transport_suppressed(remote_pk) {
                tracing::debug!(
                    pk = %short_hex(&remote_pk),
                    "server: inbound reconnect suppressed — active link in progress",
                );
                return;
            }
            tracing::info!(
                pk = %short_hex(&remote_pk),
                "server: inbound reconnect — clearing stale connection slot",
            );
            self.connections.remove(&remote_pk);
        }

        if let Some(token) = relay_token {
            tracing::info!(
                pk = %short_hex(&remote_pk),
                "server: blind-relay inbound half (pair initiator)",
            );
            self.spawn_server_blind_relay_fallback_params(ServerRelayFallbackParams {
                remote_pk,
                token,
                nw_result,
                topics: self
                    .peers
                    .get(&remote_pk)
                    .map(|info| info.topics.clone())
                    .unwrap_or_default(),
                relay_pk: self.config.relay_through.expect("checked above"),
                relay_addr: self.config.relay_address,
                key_pair: self.key_pair.clone(),
                dht: self.dht.clone(),
                runtime_handle: self.runtime_handle.clone(),
            });
        } else {
            tracing::debug!(
                pk = %short_hex(&remote_pk),
                "server: no relay token — cannot connect",
            );
        }
    }

    /// When the Noise handshake completes on a relayed path, the outbound client
    /// may fall back to blind-relay with `pair(false, remote_token)`. The server
    /// must register the matching `pair(true, local_token)` on the same relay.
    fn spawn_server_blind_relay_fallback_params(&mut self, params: ServerRelayFallbackParams) {
        let remote_pk = params.remote_pk;
        if self.transport_suppressed(remote_pk) {
            tracing::debug!(
                pk = %short_hex(&remote_pk),
                "server: skip blind-relay fallback — link handshaking/live",
            );
            return;
        }
        if self.relay_fallback_abort.contains_key(&remote_pk) {
            tracing::debug!(
                pk = %short_hex(&remote_pk),
                "server: blind-relay fallback already in flight",
            );
            return;
        }

        tracing::debug!(
            pk = %short_hex(&remote_pk),
            token = %format_args!("{:02x?}", &params.token[..4]),
            "server: spawning blind-relay fallback (pair initiator)",
        );

        let conn_tx = self.conn_tx.clone();
        let cmd_tx = self.cmd_tx.clone();
        let suppress = self.should_suppress_transport.clone();
        let handle = tokio::spawn(async move {
            if suppress.as_ref().is_some_and(|f| f(remote_pk)) {
                tracing::debug!(
                    pk = %short_hex(&remote_pk),
                    "server: blind-relay fallback aborted — link active",
                );
                let _ = cmd_tx
                    .send(SwarmCommand::NoteRelayFallbackComplete {
                        public_key: remote_pk,
                        retry: None,
                    })
                    .await;
            } else {
                deliver_server_relay_connection(cmd_tx, conn_tx, params).await;
            }
        });
        self.relay_fallback_abort
            .insert(remote_pk, handle.abort_handle());
    }

    fn all_topics_refreshed(&self) -> bool {
        !self.topics.is_empty() && self.topics.values().all(|t| t.refreshed)
    }

    fn check_flush_waiters(&mut self) {
        if self.all_topics_refreshed() {
            for waiter in self.flush_waiters.drain(..) {
                let _ = waiter.send(Ok(()));
            }
        }
    }
}

async fn reserve_and_deliver_connection(
    cmd_tx: mpsc::Sender<SwarmCommand>,
    conn_tx: mpsc::Sender<SwarmConnection>,
    public_key: [u8; 32],
    is_initiator: bool,
    swarm_conn: SwarmConnection,
) {
    let _ = cmd_tx
        .send(SwarmCommand::ReserveTransportSlot {
            public_key,
            is_initiator,
        })
        .await;
    if conn_tx.send(swarm_conn).await.is_err() {
        tracing::warn!("connection channel closed");
    }
}

#[derive(Clone)]
struct ServerRelayFallbackParams {
    remote_pk: [u8; 32],
    token: [u8; 32],
    nw_result: crate::dht::noise_wrap::NoiseWrapResult,
    topics: Vec<[u8; 32]>,
    relay_pk: [u8; 32],
    relay_addr: Option<std::net::SocketAddr>,
    key_pair: KeyPair,
    dht: HyperDhtHandle,
    runtime_handle: Arc<RuntimeHandle>,
}

async fn deliver_server_relay_connection(
    cmd_tx: mpsc::Sender<SwarmCommand>,
    conn_tx: mpsc::Sender<SwarmConnection>,
    params: ServerRelayFallbackParams,
) {
    let remote_pk = params.remote_pk;
    let topics = params.topics.clone();
    let retry_params = params.clone();
    match create_server_relay_connection(params).await {
        Ok((conn, runtime)) => {
            let swarm_conn = SwarmConnection {
                peer: conn,
                is_initiator: false,
                topics,
                _runtime: runtime,
            };
            reserve_and_deliver_connection(cmd_tx.clone(), conn_tx, remote_pk, false, swarm_conn)
                .await;
            let _ = cmd_tx
                .send(SwarmCommand::NoteRelayFallbackComplete {
                    public_key: remote_pk,
                    retry: None,
                })
                .await;
        }
        Err(e) => {
            tracing::info!(
                err = %e,
                pk = %short_hex(&remote_pk),
                token = %format_args!("{:02x?}", &retry_params.token[..4]),
                "server: blind-relay inbound half failed",
            );
            let _ = cmd_tx
                .send(SwarmCommand::NoteRelayFallbackComplete {
                    public_key: remote_pk,
                    retry: Some(retry_params),
                })
                .await;
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn create_server_relay_connection(
    params: ServerRelayFallbackParams,
) -> Result<(PeerConnection, UdxRuntime), SwarmError> {
    use crate::dht::relay_link;

    let ServerRelayFallbackParams {
        token,
        nw_result,
        relay_pk,
        relay_addr,
        key_pair,
        dht,
        runtime_handle,
        ..
    } = params;

    let work = async move {
        let runtime = UdxRuntime::shared(runtime_handle);
        let relay_conn = if let Some(addr) = relay_addr {
            tracing::debug!(?addr, "server: connecting to relay at known address");
            dht.connect_to(&key_pair, relay_pk, addr, &runtime)
                .await
                .map_err(SwarmError::Dht)?
        } else {
            dht.connect(&key_pair, relay_pk, &runtime)
                .await
                .map_err(SwarmError::Dht)?
        };

        let conn = relay_link::establish(relay_link::RelayLinkParams {
            key_pair: &key_pair,
            token: &token,
            pair_is_initiator: true,
            noise_is_initiator: false,
            noise_result: &nw_result,
            relay_control: relay_conn,
            runtime: &runtime,
        })
        .await
        .map_err(|e| {
            tracing::info!(
                token = %format_args!("{:02x?}", &token[..4]),
                err = %e,
                "server: blind-relay pair failed",
            );
            SwarmError::Dht(e)
        })?;

        Ok::<_, SwarmError>((conn, runtime))
    };

    tokio::time::timeout(crate::dht::relay_link::SERVER_RELAY_LINK_TIMEOUT, work)
        .await
        .map_err(|_| {
            SwarmError::Dht(crate::dht::hyperdht::HyperDhtError::HandshakeFailed(
                "relay link timeout".into(),
            ))
        })?
        .map_err(|e| {
            tracing::info!(
                err = %e,
                "server: blind-relay inbound half failed (timeout or pair error)",
            );
            e
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_delay_first_attempt_unproven() {
        let mut info = PeerInfo::new([0u8; 32], vec![]);
        info.attempts = 0;
        let d = retry_delay(&info);
        // Tier M: 5000..6750 ms (unproven, idx = min(0+1, 3) = 1)
        assert!(d.as_millis() >= 5000);
        assert!(d.as_millis() < 7000);
    }

    #[test]
    fn retry_delay_first_attempt_proven() {
        let mut info = PeerInfo::new([0u8; 32], vec![]);
        info.attempts = 0;
        info.proven = true;
        let d = retry_delay(&info);
        // Tier S: 1000..1400 ms (proven, idx = min(0, 3) = 0)
        assert!(d.as_millis() >= 1000);
        assert!(d.as_millis() < 1500);
    }

    #[test]
    fn retry_delay_many_attempts() {
        let mut info = PeerInfo::new([0u8; 32], vec![]);
        info.attempts = 10;
        let d = retry_delay(&info);
        // Tier X: 600_000..705_000 ms (idx capped at 3)
        assert!(d.as_millis() >= 600_000);
        assert!(d.as_millis() < 710_000);
    }

    #[test]
    fn server_relay_link_timeout_covers_pair_budget() {
        use crate::dht::relay_link::{PAIR_TIMEOUT, SERVER_RELAY_LINK_TIMEOUT, SERVER_RELAY_LINK_TIMEOUT_SECS};
        assert!(SERVER_RELAY_LINK_TIMEOUT >= PAIR_TIMEOUT);
        assert_eq!(SERVER_RELAY_LINK_TIMEOUT_SECS, 35);
    }

    #[test]
    fn short_hex_format() {
        let bytes = [0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33];
        assert_eq!(short_hex(&bytes), "deadbeef");
    }

    #[test]
    fn default_config() {
        let c = SwarmConfig::default();
        assert!(c.key_pair.is_none());
        assert_eq!(c.max_peers, 64);
        assert_eq!(c.max_parallel, 8);
        assert_eq!(c.firewall, 0);
    }

    #[test]
    fn default_join_opts() {
        let j = JoinOpts::default();
        assert!(j.server);
        assert!(j.client);
        assert!(!j.fast_refresh);
    }

    #[tokio::test]
    async fn server_unregistered_on_leave_last_topic() {
        let config = SwarmConfig::default();

        let (_task, handle, _conn_rx) = crate::spawn(config).await.unwrap();
        let target = hash(&handle.key_pair().public_key);
        let topic = [0xAA; 32];

        handle
            .join(
                topic,
                JoinOpts {
                    server: true,
                    client: false,
                    fast_refresh: false,
                },
            )
            .await
            .unwrap();

        {
            let router = handle.dht().router().lock().unwrap();
            assert!(
                router.get(&target).is_some(),
                "server must be registered after join"
            );
        }

        handle.leave(topic).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;

        {
            let router = handle.dht().router().lock().unwrap();
            assert!(
                router.get(&target).is_none(),
                "server must be unregistered after leaving last server topic"
            );
        }

        handle.destroy().await.unwrap();
    }

    #[tokio::test]
    async fn server_unregistered_on_destroy() {
        let config = SwarmConfig::default();

        let (_task, handle, _conn_rx) = crate::spawn(config).await.unwrap();
        let target = hash(&handle.key_pair().public_key);
        let topic = [0xBB; 32];

        handle
            .join(
                topic,
                JoinOpts {
                    server: true,
                    client: false,
                    fast_refresh: false,
                },
            )
            .await
            .unwrap();

        {
            let router = handle.dht().router().lock().unwrap();
            assert!(
                router.get(&target).is_some(),
                "server must be registered after join"
            );
        }

        handle.destroy().await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;

        {
            let router = handle.dht().router().lock().unwrap();
            assert!(
                router.get(&target).is_none(),
                "server must be unregistered after destroy"
            );
        }
    }

    #[tokio::test]
    async fn server_unregistered_on_handle_drop() {
        let config = SwarmConfig::default();

        let (task, handle, _conn_rx) = crate::spawn(config).await.unwrap();
        let dht_handle = handle.dht().clone();
        let target = hash(&handle.key_pair().public_key);
        let topic = [0xCC; 32];

        handle
            .join(
                topic,
                JoinOpts {
                    server: true,
                    client: false,
                    fast_refresh: false,
                },
            )
            .await
            .unwrap();

        {
            let router = dht_handle.router().lock().unwrap();
            assert!(
                router.get(&target).is_some(),
                "server must be registered after join"
            );
        }

        drop(handle);
        drop(_conn_rx);
        let _ = tokio::time::timeout(Duration::from_secs(2), task).await;

        {
            let router = dht_handle.router().lock().unwrap();
            assert!(
                router.get(&target).is_none(),
                "server must be unregistered after implicit shutdown (handle drop)"
            );
        }
    }
}

#![deny(clippy::all)]

use std::fmt;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use ed25519_dalek::SigningKey;
use rand::random;
use thiserror::Error;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use libudx::{UdxAsyncStream, UdxRuntime, UdxSocket};

use super::blind_relay::RelayError;
use super::crypto::{
    ann_signable, hash, mutable_signable, sign_detached, verify_detached, NS_ANNOUNCE,
    NS_MUTABLE_PUT, NS_UNANNOUNCE,
};
use super::hyperdht_messages::{
    decode_hyper_peer_from_bytes,
    decode_lookup_raw_reply_from_bytes, decode_mutable_get_response_from_bytes,
    encode_announce_to_bytes, encode_hyper_peer_to_bytes,
    encode_mutable_put_request_to_bytes, AnnounceMessage, HandshakeMessage,
    HyperPeer, MutablePutRequest, NoisePayload,
    RelayThroughInfo, SecretStreamInfo, UdxInfo, ANNOUNCE, FIND_PEER,
    FIREWALL_UNKNOWN, IMMUTABLE_GET, IMMUTABLE_PUT, LOOKUP, MUTABLE_GET, MUTABLE_PUT,
    PEER_HANDSHAKE, UNANNOUNCE,
};
use super::messages::Ipv4Peer;
use super::noise::Keypair as NoiseKeypair;
use super::noise_wrap::{NoiseWrap, NoiseWrapResult};
use super::peer::NodeId;
use super::persistent::{
    HandlerReply, IncomingHyperRequest, Persistent, PersistentConfig, PersistentStats,
};
use super::relay_link;
use super::router::{ForwardEntry, HandshakeAction, Router};
use super::query::QueryReply;
use super::rpc::{DhtConfig, DhtError, DhtHandle, UserQueryParams, UserRequestParams};
use super::secret_stream::{SecretStream, SecretStreamError};

// ── Errors ────────────────────────────────────────────────────────────────────

static NEXT_STREAM_ID: AtomicU32 = AtomicU32::new(1);

/// Process-global UDX stream id allocator (shared by all HyperDHT / relay paths on one runtime).
pub fn next_stream_id() -> u32 {
    NEXT_STREAM_ID.fetch_add(1, Ordering::Relaxed)
}

fn pk_prefix(pk: &[u8; 32]) -> String {
    pk.iter().take(8).fold(String::new(), |acc, b| acc + &format!("{b:02x}"))
}

/// First discovered peer hint that is not the bootstrap relay we are dialing through.
fn peer_handshake_destination(
    bootstrap: &Ipv4Peer,
    hints: &[Ipv4Peer],
) -> Option<Ipv4Peer> {
    hints
        .iter()
        .find(|h| h.host != bootstrap.host || h.port != bootstrap.port)
        .cloned()
}

fn noise_relay_addresses(
    relay_address: Option<SocketAddr>,
    relay_address_hints: &[SocketAddr],
) -> Option<Vec<Ipv4Peer>> {
    let mut addrs: Vec<Ipv4Peer> = relay_address_hints
        .iter()
        .filter_map(|addr| {
            let host = addr.ip().to_string();
            if crate::util::is_unroutable_relay_host(&host) {
                return None;
            }
            Some(Ipv4Peer {
                host,
                port: addr.port(),
            })
        })
        .collect();
    if let Some(addr) = relay_address {
        let host = addr.ip().to_string();
        let port = addr.port();
        if !crate::util::is_unroutable_relay_host(&host)
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
}

fn noise_relay_through_info(relay_pk: [u8; 32], token: [u8; 32]) -> RelayThroughInfo {
    RelayThroughInfo {
        version: 1,
        public_key: relay_pk,
        token,
    }
}

/// Outbound handshake `relay_through.token` — deterministic from pair topic + relay pk.
fn outbound_relay_through_token(
    relay_pk: [u8; 32],
    pair_topic: Option<&[u8; 32]>,
    local_pk: &[u8; 32],
    remote_pk: &[u8; 32],
    _relay_only_peer: bool,
) -> [u8; 32] {
    super::blind_relay::resolve_pair_token(pair_topic, local_pk, remote_pk, &relay_pk)
}

#[derive(Debug, Error)]
/// Errors returned by HyperDHT operations.
#[non_exhaustive]
pub enum HyperDhtError {
    /// Error propagated from the underlying DHT client.
    #[error("DHT error: {0}")]
    Dht(#[from] DhtError),
    /// Error while encoding or decoding protocol data.
    #[error("encoding error: {0}")]
    Encoding(#[from] super::compact_encoding::EncodingError),
    /// Error from Noise handshake or session setup.
    #[error("noise error: {0}")]
    Noise(#[from] super::noise::NoiseError),
    /// Error from the Noise wrapper layer.
    #[error("noise wrap error: {0}")]
    NoiseWrap(#[from] super::noise_wrap::NoiseWrapError),
    /// Error from the router state machine.
    #[error("router error: {0}")]
    Router(#[from] super::router::RouterError),
    /// This DHT instance has been destroyed.
    #[error("node destroyed")]
    Destroyed,
    /// A signature did not verify.
    #[error("invalid signature")]
    InvalidSignature,
    /// A content hash did not match.
    #[error("invalid hash")]
    InvalidHash,
    /// The internal channel was closed.
    #[error("channel closed")]
    ChannelClosed,
    /// No peer was found for the requested target.
    #[error("peer not found")]
    PeerNotFound,
    /// No relay nodes were available for the operation.
    #[error("no relay nodes available")]
    NoRelayNodes,
    /// The handshake failed with the given message.
    #[error("handshake failed: {0}")]
    HandshakeFailed(String),
    /// The remote firewall rejected the connection.
    #[error("firewall rejected")]
    FirewallRejected,
    /// Error from the UDX transport layer.
    #[error("UDX error: {0}")]
    Udx(#[from] libudx::UdxError),
    /// Error from the secret stream layer.
    #[error("secret stream error: {0}")]
    SecretStream(#[from] SecretStreamError),
    /// Failed to establish a UDX stream.
    #[error("stream establishment failed: {0}")]
    StreamEstablishment(String),
    /// Error from the relay subsystem.
    #[error("relay error: {0}")]
    Relay(#[from] RelayError),
}

// ── Server events (forwarded to listen() subscribers) ────────────────────────

#[derive(Debug)]
/// Events forwarded to server-side listeners.
#[non_exhaustive]
pub enum ServerEvent {
    /// A peer handshake request that may need local server handling.
    PeerHandshake {
        /// The decoded handshake message.
        msg: HandshakeMessage,
        /// Address of the peer that sent the request.
        from: Ipv4Peer,
        /// Optional DHT target associated with the request.
        target: Option<NodeId>,
        /// Reply channel for the generated response.
        reply_tx: oneshot::Sender<Option<Vec<u8>>>,
    },
}

// ── KeyPair ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
/// An Ed25519 key pair (libsodium layout: seed‖public_key).
pub struct KeyPair {
    /// The 32-byte public key.
    pub public_key: [u8; 32],
    /// The 64-byte secret key in libsodium layout.
    pub secret_key: [u8; 64],
}

impl KeyPair {
    /// Generate a new random key pair.
    pub fn generate() -> Self {
        let seed: [u8; 32] = random();
        Self::from_seed(seed)
    }

    /// Derive a deterministic key pair from a 32-byte seed.
    pub fn from_seed(seed: [u8; 32]) -> Self {
        let signing_key = SigningKey::from_bytes(&seed);
        let pk: [u8; 32] = signing_key.verifying_key().to_bytes();
        let mut sk = [0u8; 64];
        sk[..32].copy_from_slice(&seed);
        sk[32..].copy_from_slice(&pk);
        Self {
            public_key: pk,
            secret_key: sk,
        }
    }
}

impl fmt::Debug for KeyPair {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("KeyPair")
            .field("public_key", &to_hex(self.public_key))
            .finish_non_exhaustive()
    }
}

impl KeyPair {
    fn to_noise_keypair(&self) -> NoiseKeypair {
        NoiseKeypair {
            public_key: self.public_key,
            secret_key: self.secret_key,
        }
    }
}

// ── Result types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
/// Result from a LOOKUP query.
#[non_exhaustive]
pub struct LookupResult {
    /// Node that returned the lookup result.
    pub from: Ipv4Peer,
    /// Optional intermediate hop used to reach the node.
    pub to: Option<Ipv4Peer>,
    /// Peers advertised by the node.
    pub peers: Vec<HyperPeer>,
}

#[derive(Debug, Clone)]
/// Result from an ANNOUNCE operation.
#[non_exhaustive]
pub struct AnnounceResult {
    /// Closest nodes contacted during the announce.
    pub closest_nodes: Vec<Ipv4Peer>,
}

#[derive(Debug, Clone)]
/// Result from an immutable put operation.
#[non_exhaustive]
pub struct ImmutablePutResult {
    /// Content hash used as the target key.
    pub hash: [u8; 32],
    /// Closest nodes contacted during the write.
    pub closest_nodes: Vec<Ipv4Peer>,
}

#[derive(Debug, Clone)]
/// Result from a mutable put operation.
#[non_exhaustive]
pub struct MutablePutResult {
    /// Public key used as the mutable record key.
    pub public_key: [u8; 32],
    /// Closest nodes contacted during the write.
    pub closest_nodes: Vec<Ipv4Peer>,
    /// Record sequence number that was written.
    pub seq: u64,
    /// Signature over the stored value.
    pub signature: [u8; 64],
    /// Number of commit-phase requests that timed out.
    pub commit_timeouts: u32,
}

#[derive(Debug, Clone)]
/// Result from a mutable get operation.
#[non_exhaustive]
pub struct MutableGetResult {
    /// Retrieved value bytes.
    pub value: Vec<u8>,
    /// Sequence number attached to the value.
    pub seq: u64,
    /// Signature verifying the value.
    pub signature: [u8; 64],
    /// Node that returned the value.
    pub from: Ipv4Peer,
}

#[derive(Debug, Clone)]
/// Metadata needed to establish a peer connection.
#[non_exhaustive]
pub struct ConnectResult {
    /// Remote peer's public key.
    pub remote_public_key: [u8; 32],
    /// Address used to reach the server during handshake.
    pub server_address: Ipv4Peer,
    /// Address of the client-side peer endpoint.
    pub client_address: Ipv4Peer,
    /// Whether the connection was relayed through a third party.
    pub is_relayed: bool,
    /// Final Noise state and negotiated keys.
    pub noise: NoiseWrapResult,
    /// Local UDX stream id to use for the connection.
    pub local_stream_id: u32,
    /// Remote UDX metadata advertised by the peer.
    pub remote_udx: Option<UdxInfo>,
    /// How the UDX stream was established (blind-relay only).
    pub transport_mode: Option<super::connect_ui::ConnectTransportMode>,
}

/// Established encrypted connection to a peer.
///
/// Wraps a [`SecretStream`] over a UDX transport, keeping the underlying
/// socket alive for the connection's lifetime.
#[non_exhaustive]
pub struct PeerConnection {
    /// Encrypted bidirectional stream to the peer.
    pub stream: SecretStream<UdxAsyncStream>,
    /// Remote peer's public key.
    pub remote_public_key: [u8; 32],
    /// Remote peer's network address (used by server-side relay to connect data streams).
    pub remote_addr: Option<std::net::SocketAddr>,
    /// The UDX socket underlying this connection. Public so relay flows
    /// in downstream crates can reuse the control channel's socket for
    /// data streams (matching Node.js behaviour).
    pub socket: UdxSocket,
    _relay_task: Option<JoinHandle<()>>,
    /// Established data-path mode when known (initiator connect path).
    pub transport_mode: Option<super::connect_ui::ConnectTransportMode>,
}

impl PeerConnection {
    /// Create a new peer connection from its components.
    pub fn new(
        stream: SecretStream<UdxAsyncStream>,
        remote_public_key: [u8; 32],
        socket: UdxSocket,
        relay_task: Option<JoinHandle<()>>,
    ) -> Self {
        Self {
            stream,
            remote_public_key,
            remote_addr: None,
            socket,
            _relay_task: relay_task,
            transport_mode: None,
        }
    }

    /// Create a new peer connection with a known remote address.
    pub fn with_remote_addr(
        stream: SecretStream<UdxAsyncStream>,
        remote_public_key: [u8; 32],
        remote_addr: std::net::SocketAddr,
        socket: UdxSocket,
        relay_task: Option<JoinHandle<()>>,
    ) -> Self {
        Self {
            stream,
            remote_public_key,
            remote_addr: Some(remote_addr),
            socket,
            _relay_task: relay_task,
            transport_mode: None,
        }
    }
}

impl fmt::Debug for PeerConnection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PeerConnection")
            .field("remote_public_key", &&self.remote_public_key[..8])
            .field("remote_addr", &self.remote_addr)
            .field("relayed", &self._relay_task.is_some())
            .finish_non_exhaustive()
    }
}

/// Configuration used by the server-side Noise IK handshake responder.
#[non_exhaustive]
pub struct ServerConfig {
    /// Server identity key pair.
    pub key_pair: KeyPair,
    /// Firewall mode advertised to connecting peers.
    pub firewall: u64,
    /// DHT UDP listen port used to build Noise `addresses4` LAN hints.
    pub noise_addresses_listen_udp_port: Option<u16>,
}

impl ServerConfig {
    /// Create a new server configuration.
    pub fn new(key_pair: KeyPair, firewall: u64) -> Self {
        Self {
            key_pair,
            firewall,
            noise_addresses_listen_udp_port: None,
        }
    }
}

/// Outcome of responder-side Noise IK finishing on `PEER_HANDSHAKE` (`handle_server_handshake`).
///
/// Bootstrap / relay binaries use this together with [`establish_responder_peer_connection`]
/// to open the UDX + [`SecretStream`] control channel matching Hyperswarm.
#[derive(Clone)]
pub struct EstablishedNoiseIkSession {
    /// IKNoise session keys and transcript (responder-side).
    pub noise: super::noise_wrap::NoiseWrapResult,
    /// Local responder UDX stream id chosen for this session.
    pub local_stream_id: u32,
    /// Peer's advertised UDX info from the IK payload (their stream id etc.).
    pub remote_udx: Option<UdxInfo>,
    /// UDP endpoint to connect the responder UDX stream toward (relay path uses `MODE_FROM_RELAY` peer addr).
    pub client_address: Ipv4Peer,
}

/// Wire reply plus session material after completing responder Noise IK (`PEER_HANDSHAKE`).
#[non_exhaustive]
pub struct ServerNoiseIkHandshakeOutcome {
    /// Encoded `MODE_REPLY` message for `reply_tx`.
    pub reply_wire: Vec<u8>,
    /// Establish UDX + [`SecretStream`] responder path.
    pub establish: EstablishedNoiseIkSession,
}

/// Run Noise IK responder logic for inbound `PEER_HANDSHAKE`; returns encoded reply plus session material.
///
/// Mirrors [`handle_server_handshake`] but callers can additionally call [`establish_responder_peer_connection`].
pub fn finish_server_noise_ik_handshake(
    config: &ServerConfig,
    msg: HandshakeMessage,
    from: &Ipv4Peer,
    _target: Option<&NodeId>,
) -> Option<ServerNoiseIkHandshakeOutcome> {
    let mut nw =
        NoiseWrap::new_responder(config.key_pair.to_noise_keypair());

    let remote_payload = match nw.recv(&msg.noise) {
        Ok(p) => p,
        Err(_) => return None,
    };

    if remote_payload.error != 0 {
        return None;
    }

    let local_stream_id = next_stream_id();

    let addresses4 = config
        .noise_addresses_listen_udp_port
        .map(|p| super::local_addresses::build_addresses4(p))
        .unwrap_or_default();

    let reply_payload = NoisePayload {
        version: 1,
        error: 0,
        firewall: config.firewall,
        addresses4,
        addresses6: vec![],
        udx: Some(UdxInfo {
            version: 1,
            reusable_socket: true,
            id: u64::from(local_stream_id),
            seq: 0,
        }),
        secret_stream: Some(SecretStreamInfo { version: 1 }),
        relay_through: None,
        relay_addresses: None,
    };

    let noise_reply = match nw.send(&reply_payload) {
        Ok(b) => b,
        Err(_) => return None,
    };

    let nw_result = match nw.finalize() {
        Ok(r) => r,
        Err(_) => return None,
    };

    // Single reusable socket: the client's UDX stream originates from the same
    // reflexive source as this handshake, so always reply to `from` (never an
    // advertised LAN address). This is the blind-relay return-path invariant.
    let client_address = from.clone();

    let reply_msg = HandshakeMessage {
        mode: super::hyperdht_messages::MODE_REPLY,
        noise: noise_reply,
        peer_address: Some(from.clone()),
        relay_address: None,
    };
    let reply_wire = super::hyperdht_messages::encode_handshake_to_bytes(&reply_msg).ok()?;

    Some(ServerNoiseIkHandshakeOutcome {
        reply_wire,
        establish: EstablishedNoiseIkSession {
            noise: nw_result,
            local_stream_id,
            remote_udx: remote_payload.udx,
            client_address,
        },
    })
}

/// Open responder UDX + [`SecretStream::from_session`] after [`finish_server_noise_ik_handshake`].
///
/// Equivalent to swarm `create_server_connection` for inbound IK.
pub async fn establish_responder_peer_connection(
    dht: &HyperDhtHandle,
    runtime: &UdxRuntime,
    est: &EstablishedNoiseIkSession,
) -> Result<PeerConnection, HyperDhtError> {
    let remote_udx = est
        .remote_udx
        .as_ref()
        .ok_or_else(|| HyperDhtError::StreamEstablishment("noise payload missing UDX info".into()))?;

    let remote_id = u32::try_from(remote_udx.id).map_err(|_| {
        HyperDhtError::StreamEstablishment("remote UDX id out of u32 range".into())
    })?;

    let addr: SocketAddr = SocketAddr::new(
        est
            .client_address
            .host
            .parse()
            .map_err(|e| HyperDhtError::StreamEstablishment(format!("invalid client UDP host: {e}")))?,
        est.client_address.port,
    );

    let socket = dht
        .listen_socket()
        .await?
        .ok_or_else(|| HyperDhtError::StreamEstablishment("DHT listen socket not available".into()))?;

    let stream = runtime
        .create_stream(est.local_stream_id)
        .await
        .map_err(|e| HyperDhtError::StreamEstablishment(e.to_string()))?;

    stream
        .connect(&socket, remote_id, addr)
        .await
        .map_err(|e| HyperDhtError::StreamEstablishment(e.to_string()))?;

    let async_stream = stream.into_async_stream();
    let ss = SecretStream::from_session(
        false,
        async_stream,
        est.noise.tx,
        est.noise.rx,
        est.noise.handshake_hash,
        est.noise.remote_public_key,
    )
    .await
    .map_err(HyperDhtError::SecretStream)?;

    Ok(PeerConnection {
        remote_public_key: est.noise.remote_public_key,
        stream: ss,
        remote_addr: Some(addr),
        socket,
        _relay_task: None,
        transport_mode: None,
    })
}

// ── Bootstrap defaults ────────────────────────────────────────────────────────

/// The three public HyperDHT bootstrap nodes (from `hyperdht/lib/constants.js`).
///
/// Format: `suggestedIP@hostname:port`.  `parse_bootstrap_str`
/// extracts the IP before `@`, so these work without DNS resolution.
pub const DEFAULT_BOOTSTRAP: [&str; 3] = [
    "88.99.3.86@node1.hyperdht.org:49737",
    "142.93.90.113@node2.hyperdht.org:49737",
    "138.68.147.8@node3.hyperdht.org:49737",
];

// ── Config ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default)]
/// Blind-relay fallback advertised in Noise handshakes (`relay_through` / `relay_addresses`).
#[non_exhaustive]
pub struct ConnectRelayConfig {
    /// Hosted blind-relay public key (32 bytes).
    pub relay_through: Option<[u8; 32]>,
    /// Primary UDP address hint for the blind-relay node.
    pub relay_address: Option<SocketAddr>,
    /// Extra UDP hints (bootstrap + blind-relay).
    pub relay_address_hints: Vec<SocketAddr>,
}

#[derive(Clone, Default)]
/// Configuration for a HyperDHT instance.
#[non_exhaustive]
pub struct HyperDhtConfig {
    /// DHT transport and bootstrap settings.
    pub dht: DhtConfig,
    /// Persistent storage settings for stored records.
    pub persistent: PersistentConfig,
    /// Blind-relay transport configuration (Hyperswarm `relay_through`; the sole data plane).
    pub connect_relay: ConnectRelayConfig,
    /// Optional UI progress / transport-mode callbacks (outbound connect path).
    pub connect_ui: Option<super::connect_ui::ConnectUiHook>,
    /// Retained for API compatibility — blind-relay is now the only transport (always on).
    pub prefer_relay_only: Arc<AtomicBool>,
}

impl HyperDhtConfig {
    /// Create a config pre-populated with the public HyperDHT bootstrap nodes.
    ///
    /// This is the typical starting point for connecting to the live network.
    /// `DhtConfig::default()` intentionally keeps `bootstrap` empty so that
    /// unit tests can run without network access.
    pub fn with_public_bootstrap() -> Self {
        Self {
            dht: DhtConfig {
                bootstrap: DEFAULT_BOOTSTRAP.iter().map(|s| (*s).to_string()).collect(),
                ..DhtConfig::default()
            },
            persistent: PersistentConfig::default(),
            connect_relay: ConnectRelayConfig::default(),
            connect_ui: None,
            prefer_relay_only: Arc::new(AtomicBool::new(true)),
        }
    }
}

// ── AdminRequest ──────────────────────────────────────────────────────────────

enum AdminRequest {
    PersistentStats { reply: oneshot::Sender<PersistentStats> },
}

// ── HyperDhtHandle ────────────────────────────────────────────────────────────

#[derive(Clone)]
/// Main public HyperDHT API handle.
pub struct HyperDhtHandle {
    dht: DhtHandle,
    router: Arc<Mutex<Router>>,
    server_tx: mpsc::UnboundedSender<ServerEvent>,
    admin_tx: mpsc::UnboundedSender<AdminRequest>,
    connect_relay: ConnectRelayConfig,
    connect_ui: Option<super::connect_ui::ConnectUiHook>,
    prefer_relay_only: Arc<AtomicBool>,
}

impl HyperDhtHandle {
    /// Relay-only steady state — always on; blind-relay UDX is the single transport.
    pub fn set_prefer_relay_only(&self, _on: bool) {
        self.prefer_relay_only.store(true, Ordering::Release);
    }

    fn emit_connect_ui(&self, event: super::connect_ui::ConnectUiEvent) {
        if let Some(hook) = &self.connect_ui {
            hook(event);
        }
    }
    // ── WIRE STATS ────────────────────────────────────────────────────────────

    /// Snapshot of cumulative wire bytes (sent, received) since this DHT
    /// node started. Counts every UDP datagram exchanged at the IO layer
    /// — queries, requests, replies, retries, relays, and any user-issued
    /// puts/gets — regardless of which higher-level operation produced them.
    ///
    /// Useful for distinguishing "useful payload throughput" (what consumers
    /// see) from "raw network throughput" (what the OS sees). The ratio
    /// between them is the DHT's protocol amplification factor.
    pub fn wire_stats(&self) -> (u64, u64) {
        self.dht.wire_stats()
    }

    /// Borrow the shared wire-counter handle for long-lived sampling. The
    /// returned counters are `Arc<AtomicU64>` internally; cloning is cheap.
    pub fn wire_counters(&self) -> super::io::WireCounters {
        self.dht.wire_counters()
    }

    // ── LOOKUP ────────────────────────────────────────────────────────────────

    /// Query the DHT for peers advertising the target.
    pub async fn lookup(&self, target: [u8; 32]) -> Result<Vec<LookupResult>, HyperDhtError> {
        let replies = self
            .dht
            .query(UserQueryParams {
                target,
                command: LOOKUP,
                value: None,
                commit: false,
                concurrency: None,
            })
            .await?;

        let mut results = Vec::new();
        for reply in replies {
            if let Some(value) = &reply.value {
                if let Ok(raw) = decode_lookup_raw_reply_from_bytes(value) {
                    if !raw.peers.is_empty() {
                        results.push(LookupResult {
                            from: reply.from.clone(),
                            to: None,
                            peers: raw.peers,
                        });
                    }
                }
            }
        }
        Ok(results)
    }

    // ── ANNOUNCE ─────────────────────────────────────────────────────────────

    /// Announce this peer under the given target.
    pub async fn announce(
        &self,
        target: [u8; 32],
        key_pair: &KeyPair,
        relay_addresses: &[Ipv4Peer],
    ) -> Result<AnnounceResult, HyperDhtError> {
        let replies = self
            .dht
            .query(UserQueryParams {
                target,
                command: LOOKUP,
                value: None,
                commit: true,
                concurrency: None,
            })
            .await?;

        let mut closest_nodes = Vec::new();

        for reply in &replies {
            closest_nodes.push(reply.from.clone());

            let token = match &reply.token {
                Some(t) => *t,
                None => continue,
            };
            let node_id = match &reply.from_id {
                Some(id) => *id,
                None => continue,
            };

            let peer = HyperPeer {
                public_key: key_pair.public_key,
                relay_addresses: relay_addresses
                    .iter()
                    .take(3)
                    .cloned()
                    .collect(),
            };

            let peer_encoded = encode_hyper_peer_to_bytes(&peer)?;
            let signable =
                ann_signable(&target, &token, &node_id, &peer_encoded, &[], &NS_ANNOUNCE);
            let signature = sign_detached(&signable, &key_pair.secret_key);

            let ann = AnnounceMessage {
                peer: Some(peer),
                refresh: None,
                signature: Some(signature),
                bump: 0,
            };
            let ann_bytes = encode_announce_to_bytes(&ann)?;

            let _ = self
                .dht
                .request(
                    UserRequestParams {
                        token: Some(token),
                        command: ANNOUNCE,
                        target: Some(target),
                        value: Some(ann_bytes),
                    },
                    &reply.from.host,
                    reply.from.port,
                )
                .await;
        }

        Ok(AnnounceResult { closest_nodes })
    }

    // ── FIND_PEER ─────────────────────────────────────────────────────────────

    /// Return the first peer record found for the target.
    pub async fn find_peer(
        &self,
        target: [u8; 32],
    ) -> Result<Option<HyperPeer>, HyperDhtError> {
        let replies = self
            .dht
            .query(UserQueryParams {
                target,
                command: FIND_PEER,
                value: None,
                commit: false,
                concurrency: None,
            })
            .await?;

        for reply in replies {
            if let Some(value) = reply.value {
                if let Ok(peer) = decode_hyper_peer_from_bytes(&value) {
                    return Ok(Some(peer));
                }
            }
        }
        Ok(None)
    }

    /// Run a FIND_PEER query and return all raw replies.
    ///
    /// Unlike [`find_peer`](Self::find_peer), this returns every reply from
    /// the iterative query so callers can try connecting through each
    /// responding node's address.
    pub async fn query_find_peer(
        &self,
        target: [u8; 32],
    ) -> Result<Vec<QueryReply>, HyperDhtError> {
        Ok(self
            .dht
            .query(UserQueryParams {
                target,
                command: FIND_PEER,
                value: None,
                commit: false,
                concurrency: None,
            })
            .await?)
    }

    // ── UNANNOUNCE ────────────────────────────────────────────────────────────

    /// Remove a previously announced peer record.
    pub async fn unannounce(
        &self,
        target: [u8; 32],
        key_pair: &KeyPair,
    ) -> Result<(), HyperDhtError> {
        let replies = self
            .dht
            .query(UserQueryParams {
                target,
                command: LOOKUP,
                value: None,
                commit: false,
                concurrency: None,
            })
            .await?;

        for reply in &replies {
            let token = match &reply.token {
                Some(t) => *t,
                None => continue,
            };
            let node_id = match &reply.from_id {
                Some(id) => *id,
                None => continue,
            };

            let peer = HyperPeer {
                public_key: key_pair.public_key,
                relay_addresses: vec![],
            };
            let peer_encoded = encode_hyper_peer_to_bytes(&peer)?;
            let signable = ann_signable(
                &target,
                &token,
                &node_id,
                &peer_encoded,
                &[],
                &NS_UNANNOUNCE,
            );
            let signature = sign_detached(&signable, &key_pair.secret_key);

            let ann = AnnounceMessage {
                peer: Some(peer),
                refresh: None,
                signature: Some(signature),
                bump: 0,
            };
            let ann_bytes = encode_announce_to_bytes(&ann)?;

            let _ = self
                .dht
                .request(
                    UserRequestParams {
                        token: Some(token),
                        command: UNANNOUNCE,
                        target: Some(target),
                        value: Some(ann_bytes),
                    },
                    &reply.from.host,
                    reply.from.port,
                )
                .await;
        }

        Ok(())
    }

    // ── IMMUTABLE_PUT ────────────────────────────────────────────────────────

    /// Store immutable content under its content hash.
    pub async fn immutable_put(
        &self,
        value: &[u8],
    ) -> Result<ImmutablePutResult, HyperDhtError> {
        let target = hash(value);

        let replies = self
            .dht
            .query(UserQueryParams {
                target,
                command: IMMUTABLE_GET,
                value: None,
                commit: true,
                concurrency: None,
            })
            .await?;

        let mut closest_nodes = Vec::new();

        for reply in &replies {
            closest_nodes.push(reply.from.clone());

            let token = match &reply.token {
                Some(t) => *t,
                None => continue,
            };

            let _ = self
                .dht
                .request(
                    UserRequestParams {
                        token: Some(token),
                        command: IMMUTABLE_PUT,
                        target: Some(target),
                        value: Some(value.to_vec()),
                    },
                    &reply.from.host,
                    reply.from.port,
                )
                .await;
        }

        Ok(ImmutablePutResult {
            hash: target,
            closest_nodes,
        })
    }

    // ── IMMUTABLE_GET ────────────────────────────────────────────────────────

    /// Fetch immutable content by content hash.
    pub async fn immutable_get(
        &self,
        target: [u8; 32],
    ) -> Result<Option<Vec<u8>>, HyperDhtError> {
        let replies = self
            .dht
            .query(UserQueryParams {
                target,
                command: IMMUTABLE_GET,
                value: None,
                commit: false,
                concurrency: None,
            })
            .await?;

        for reply in replies {
            if let Some(value) = reply.value {
                if hash(&value) == target {
                    return Ok(Some(value));
                }
            }
        }
        Ok(None)
    }

    // ── MUTABLE_PUT ───────────────────────────────────────────────────────────

    /// Store a signed mutable record for the given key pair.
    pub async fn mutable_put(
        &self,
        key_pair: &KeyPair,
        value: &[u8],
        seq: u64,
    ) -> Result<MutablePutResult, HyperDhtError> {
        let target = hash(&key_pair.public_key);
        let signable = mutable_signable(&NS_MUTABLE_PUT, seq, value);
        let signature = sign_detached(&signable, &key_pair.secret_key);

        let put = MutablePutRequest {
            public_key: key_pair.public_key,
            seq,
            value: value.to_vec(),
            signature,
        };
        let put_bytes = encode_mutable_put_request_to_bytes(&put)?;

        let seq_bytes = encode_compact_uint(seq);

        let replies = self
            .dht
            .query(UserQueryParams {
                target,
                command: MUTABLE_GET,
                value: Some(seq_bytes),
                commit: true,
                concurrency: None,
            })
            .await?;

        let mut closest_nodes = Vec::new();
        let mut commit_timeouts: u32 = 0;

        for reply in &replies {
            closest_nodes.push(reply.from.clone());

            let token = match &reply.token {
                Some(t) => *t,
                None => continue,
            };

            if let Err(DhtError::RequestFailed(_)) = self
                .dht
                .request(
                    UserRequestParams {
                        token: Some(token),
                        command: MUTABLE_PUT,
                        target: Some(target),
                        value: Some(put_bytes.clone()),
                    },
                    &reply.from.host,
                    reply.from.port,
                )
                .await
            {
                commit_timeouts += 1;
            }
        }

        Ok(MutablePutResult {
            public_key: key_pair.public_key,
            closest_nodes,
            seq,
            signature,
            commit_timeouts,
        })
    }

    // ── MUTABLE_GET ───────────────────────────────────────────────────────────

    /// Fetch and verify a mutable record for the given public key.
    pub async fn mutable_get(
        &self,
        public_key: &[u8; 32],
        seq: u64,
    ) -> Result<Option<MutableGetResult>, HyperDhtError> {
        let target = hash(public_key);
        let seq_bytes = encode_compact_uint(seq);

        let replies = self
            .dht
            .query(UserQueryParams {
                target,
                command: MUTABLE_GET,
                value: Some(seq_bytes),
                commit: false,
                concurrency: None,
            })
            .await?;

        for reply in replies {
            if let Some(value) = &reply.value {
                if let Ok(resp) = decode_mutable_get_response_from_bytes(value) {
                    if resp.seq >= seq {
                        let signable =
                            mutable_signable(&NS_MUTABLE_PUT, resp.seq, &resp.value);
                        if verify_detached(&resp.signature, &signable, public_key) {
                            return Ok(Some(MutableGetResult {
                                value: resp.value,
                                seq: resp.seq,
                                signature: resp.signature,
                                from: reply.from,
                            }));
                        }
                    }
                }
            }
        }
        Ok(None)
    }

    /// Wait until the DHT is bootstrapped.
    pub async fn bootstrapped(&self) -> Result<(), HyperDhtError> {
        self.dht.bootstrapped().await.map_err(HyperDhtError::Dht)
    }

    /// Destroy the underlying DHT instance.
    pub async fn destroy(&self) -> Result<(), HyperDhtError> {
        self.dht.destroy().await.map_err(HyperDhtError::Dht)
    }

    /// Returns the number of nodes in the routing table.
    pub async fn table_size(&self) -> Result<usize, HyperDhtError> {
        self.dht.table_size().await.map_err(HyperDhtError::Dht)
    }

    /// Returns the local port the DHT server socket is bound to.
    pub async fn local_port(&self) -> Result<u16, HyperDhtError> {
        self.dht.local_port().await.map_err(HyperDhtError::Dht)
    }

    /// Returns the single reusable UDP socket (DHT + UDX multiplex).
    pub async fn listen_socket(&self) -> Result<Option<UdxSocket>, HyperDhtError> {
        self.dht.listen_socket().await.map_err(HyperDhtError::Dht)
    }

    /// Access the shared router state.
    pub fn router(&self) -> &Arc<Mutex<Router>> {
        &self.router
    }

    /// Access the underlying DHT handle.
    pub fn dht(&self) -> &DhtHandle {
        &self.dht
    }

    /// Returns persistent storage statistics collected from the request handler.
    pub async fn persistent_stats(&self) -> Result<PersistentStats, HyperDhtError> {
        let (tx, rx) = oneshot::channel();
        self.admin_tx
            .send(AdminRequest::PersistentStats { reply: tx })
            .map_err(|_| HyperDhtError::Destroyed)?;
        rx.await.map_err(|_| HyperDhtError::Destroyed)
    }

    /// Mark a target as having a local server available.
    pub fn register_server(&self, target: &[u8; 32]) {
        if let Ok(mut router) = self.router.lock() {
            router.set(
                target,
                ForwardEntry {
                    relay: None,
                    has_server: true,
                    inserted: std::time::Instant::now(),
                },
            );
        }
    }

    /// Remove the local-server marker for a target.
    pub fn unregister_server(&self, target: &[u8; 32]) {
        if let Ok(mut router) = self.router.lock() {
            router.delete(target);
        }
    }

    /// Access the server event sender.
    pub fn server_sender(&self) -> &mpsc::UnboundedSender<ServerEvent> {
        &self.server_tx
    }

    // ── CONNECT (relay-only blind-relay) ───────────────────────────────────

    /// Connect to a remote peer via bootstrap DHT relay + blind-relay pair.
    pub async fn connect(
        &self,
        key_pair: &KeyPair,
        remote_public_key: [u8; 32],
        runtime: &UdxRuntime,
    ) -> Result<PeerConnection, HyperDhtError> {
        self.connect_with_nodes(key_pair, remote_public_key, &[], None, runtime)
            .await
    }

    /// Connect to a remote peer via the configured bootstrap relay.
    ///
    /// Peer connects: single bootstrap → Noise handshake → blind-relay pair.
    /// Relay-coordinator connects (`relay_through` pk): direct UDX control channel.
    ///
    /// `pair_topic` enables deterministic blind-relay pair tokens during invite pairing.
    pub async fn connect_with_nodes(
        &self,
        key_pair: &KeyPair,
        remote_public_key: [u8; 32],
        relay_addresses: &[Ipv4Peer],
        pair_topic: Option<[u8; 32]>,
        runtime: &UdxRuntime,
    ) -> Result<PeerConnection, HyperDhtError> {
        debug_assert!(
            self.prefer_relay_only.load(Ordering::Relaxed),
            "AvenOS is relay-only; prefer_relay_only must stay true"
        );
        self.emit_connect_ui(super::connect_ui::ConnectUiEvent::Progress {
            remote_pk: remote_public_key,
            phase: super::connect_ui::ConnectProgressPhase::Handshaking,
        });

        let blind_relay_target = self
            .connect_relay
            .relay_through
            .is_some_and(|pk| pk == remote_public_key);

        let mut relays: Vec<Ipv4Peer> = relay_addresses.to_vec();
        if relays.is_empty() {
            if let Some(addrs) = noise_relay_addresses(
                self.connect_relay.relay_address,
                &self.connect_relay.relay_address_hints,
            ) {
                relays.extend(addrs);
            }
        }

        if blind_relay_target {
            let mut last_err = HyperDhtError::NoRelayNodes;
            for relay in &relays {
                match self
                    .connect_through_node(
                        key_pair,
                        &remote_public_key,
                        relay,
                        runtime,
                        true,
                        None,
                        &[],
                    )
                    .await
                {
                    Ok(result) => return Ok(result),
                    Err(e) => {
                        tracing::debug!(
                            relay = %format!("{}:{}", relay.host, relay.port),
                            err = %e,
                            "relay coordinator connect attempt failed"
                        );
                        last_err = e;
                    }
                }
            }
            return Err(last_err);
        }

        let relay = relays.first().ok_or(HyperDhtError::NoRelayNodes)?;
        tracing::debug!(
            relay = %format!("{}:{}", relay.host, relay.port),
            "connect_with_nodes: relay-only single bootstrap attempt"
        );
        self.connect_through_node(
            key_pair,
            &remote_public_key,
            relay,
            runtime,
            false,
            pair_topic,
            &relays,
        )
        .await
    }

    /// Connect directly to a peer at a known address, bypassing DHT routing.
    ///
    /// Sends a PEER_HANDSHAKE directly to `target_addr` for `remote_public_key`.
    /// Useful when the target's address is already known (e.g. from prior
    /// configuration or out-of-band exchange), avoiding the FIND_NODE phase
    /// that requires the target to be well-propagated in the DHT.
    pub async fn connect_to(
        &self,
        key_pair: &KeyPair,
        remote_public_key: [u8; 32],
        target_addr: std::net::SocketAddr,
        runtime: &UdxRuntime,
    ) -> Result<PeerConnection, HyperDhtError> {
        let relay = Ipv4Peer {
            host: target_addr.ip().to_string(),
            port: target_addr.port(),
        };
        self.connect_through_node(key_pair, &remote_public_key, &relay, runtime, true, None, &[])
            .await
    }

    async fn connect_through_node(
        &self,
        key_pair: &KeyPair,
        remote_public_key: &[u8; 32],
        relay: &Ipv4Peer,
        runtime: &UdxRuntime,
        relay_control_channel: bool,
        pair_topic: Option<[u8; 32]>,
        peer_destination_hints: &[Ipv4Peer],
    ) -> Result<PeerConnection, HyperDhtError> {
        let target = hash(remote_public_key);

        tracing::info!(
            remote_pk = %pk_prefix(remote_public_key),
            relay = %format!("{}:{}", relay.host, relay.port),
            pair_topic = ?pair_topic.map(|t| pk_prefix(&t)),
            relay_control_channel,
            "connect_through_node — PEER_HANDSHAKE via bootstrap relay"
        );

        self.emit_connect_ui(super::connect_ui::ConnectUiEvent::Progress {
            remote_pk: *remote_public_key,
            phase: super::connect_ui::ConnectProgressPhase::Handshaking,
        });

        let local_addresses4: Vec<Ipv4Peer> = vec![];

        // Phase 1: Noise IK handshake via PEER_HANDSHAKE relay
        let mut nw = NoiseWrap::new_initiator(key_pair.to_noise_keypair(), *remote_public_key);

        let local_stream_id = next_stream_id();

        let relay_only_peer = !relay_control_channel;
        let relay_through_info = self.connect_relay.relay_through.map(|relay_pk| {
            let token = outbound_relay_through_token(
                relay_pk,
                pair_topic.as_ref(),
                &key_pair.public_key,
                remote_public_key,
                relay_only_peer,
            );
            noise_relay_through_info(relay_pk, token)
        });
        let relay_addresses = noise_relay_addresses(
            self.connect_relay.relay_address,
            &self.connect_relay.relay_address_hints,
        );

        let local_payload = NoisePayload {
            version: 1,
            error: 0,
            firewall: FIREWALL_UNKNOWN,
            addresses4: local_addresses4.clone(),
            addresses6: vec![],
            udx: Some(UdxInfo {
                version: 1,
                reusable_socket: true,
                id: u64::from(local_stream_id),
                seq: 0,
            }),
            secret_stream: Some(SecretStreamInfo { version: 1 }),
            relay_through: relay_through_info,
            relay_addresses,
        };

        let noise_bytes = nw.send(&local_payload)?;
        // Coordinator: relay_address = bootstrap. Peer dial: destination hint for the
        // remote peer (from discovery), not LAN peer_address — see hyperdht_connect_interop.
        let relay_hint = if relay_control_channel {
            Some(relay.clone())
        } else {
            peer_handshake_destination(relay, peer_destination_hints)
        };
        // Single reusable socket: the relay learns our UDX source from the handshake's
        // reflexive `from`, so we never advertise a (LAN) `peer_address`.
        let handshake_value = Router::encode_client_handshake(noise_bytes, None, relay_hint)?;

        let resp = self
            .dht
            .request(
                UserRequestParams {
                    token: None,
                    command: PEER_HANDSHAKE,
                    target: Some(target),
                    value: Some(handshake_value),
                },
                &relay.host,
                relay.port,
            )
            .await?;

        if resp.error != 0 {
            return Err(HyperDhtError::HandshakeFailed(format!(
                "error code {}",
                resp.error
            )));
        }

        let reply_value = resp
            .value
            .ok_or_else(|| HyperDhtError::HandshakeFailed("empty reply".into()))?;

        let hs_result = {
            let router = self.router.lock().map_err(|_| HyperDhtError::ChannelClosed)?;
            router.validate_handshake_reply(&reply_value, relay, &resp.from)?
        };

        let remote_payload = nw.recv(&hs_result.noise)?;
        let nw_result = nw.finalize()?;

        if remote_payload.error != 0 {
            return Err(HyperDhtError::FirewallRejected);
        }

        let relay_fallback = remote_payload.relay_through.clone();
        let relay_addr_hints = remote_payload.relay_addresses.clone().unwrap_or_default();

        tracing::debug!(
            relayed = hs_result.relayed,
            firewall = remote_payload.firewall,
            server_address = %format!("{}:{}", hs_result.server_address.host, hs_result.server_address.port),
            relay_control_channel,
            "handshake complete, deciding connection path"
        );

        if !relay_control_channel {
            let relay_through = relay_fallback.ok_or(HyperDhtError::NoRelayNodes)?;
            tracing::info!("connect path: blind-relay pair (relay-only)");
            self.emit_connect_ui(super::connect_ui::ConnectUiEvent::Progress {
                remote_pk: nw_result.remote_public_key,
                phase: super::connect_ui::ConnectProgressPhase::RelayPairing,
            });
            let mut conn = Box::pin(self.relay_connection(
                key_pair,
                &relay_through,
                &relay_addr_hints,
                &nw_result,
                false,
                true,
                runtime,
            ))
            .await?;
            conn.transport_mode = Some(super::connect_ui::ConnectTransportMode::Relay);
            self.emit_connect_ui(super::connect_ui::ConnectUiEvent::Connected {
                remote_pk: nw_result.remote_public_key,
                mode: super::connect_ui::ConnectTransportMode::Relay,
            });
            return Ok(conn);
        }

        // Relay coordinator control channel: post-handshake UDX to the relay host.
        // One reusable socket means the relay's observed reflexive source for the
        // handshake equals this UDX stream's source, so we target the bootstrap relay
        // (host:49737) directly — no reflexive/LAN address heuristics required.
        debug_assert!(relay_control_channel);
        let connect_addr = relay.clone();
        tracing::info!(
            direct = %format!("{}:{}", connect_addr.host, connect_addr.port),
            "connect path: relay host post-handshake UDX"
        );
        let direct = ConnectResult {
            remote_public_key: nw_result.remote_public_key,
            server_address: connect_addr.clone(),
            client_address: hs_result.client_address,
            is_relayed: hs_result.relayed,
            noise: nw_result.clone(),
            local_stream_id,
            remote_udx: remote_payload.udx.clone(),
            transport_mode: Some(super::connect_ui::ConnectTransportMode::Relay),
        };
        let shared = self.listen_socket().await?;
        let mut conn = establish_stream_with_socket(&direct, runtime, shared).await?;
        conn.transport_mode = Some(super::connect_ui::ConnectTransportMode::Relay);
        Ok(conn)
    }

    /// Establish an encrypted connection to a peer via a relay node.
    ///
    /// The relay node forwards raw UDX packets between the two peers using
    /// the blind-relay protocol. The returned [`PeerConnection`] is encrypted
    /// end-to-end with the original peer's keys (the relay cannot read the data).
    ///
    /// `relay_addr_hints` are optional addresses where the relay may be reachable
    /// directly (e.g. from the server's NoisePayload `relay_addresses`). They are
    /// tried first before falling back to full DHT routing.
    #[allow(clippy::too_many_arguments)]
    async fn relay_connection(
        &self,
        key_pair: &KeyPair,
        relay_through: &RelayThroughInfo,
        relay_addr_hints: &[Ipv4Peer],
        noise_result: &NoiseWrapResult,
        relay_is_initiator: bool,
        noise_is_initiator: bool,
        runtime: &UdxRuntime,
    ) -> Result<PeerConnection, HyperDhtError> {
        // 1. HyperDHT connection to the relay node.
        // Merge locally configured blind-relay hints with remote-advertised ones.
        let mut relay_addr_hints: Vec<Ipv4Peer> = relay_addr_hints.to_vec();
        if let Some(addrs) = noise_relay_addresses(
            self.connect_relay.relay_address,
            &self.connect_relay.relay_address_hints,
        ) {
            for addr in addrs {
                if !relay_addr_hints
                    .iter()
                    .any(|h| h.host == addr.host && h.port == addr.port)
                {
                    relay_addr_hints.insert(0, addr);
                }
            }
        }

        // Try known addresses first (pre-connect with direct-server encoding), then DHT routing.
        let relay_conn = self
            .connect_with_nodes(
                key_pair,
                relay_through.public_key,
                &relay_addr_hints,
                None,
                runtime,
            )
            .await?;

        relay_link::establish(relay_link::RelayLinkParams {
            key_pair,
            token: &relay_through.token,
            pair_is_initiator: relay_is_initiator,
            noise_is_initiator,
            noise_result,
            relay_control: relay_conn,
            runtime,
        })
        .await
    }
}

/// Create a UDX stream, connect it to the remote peer, and wrap with
/// [`SecretStream::from_session`] using the Noise handshake keys.
///
/// Call after [`HyperDhtHandle::connect`] to upgrade a [`ConnectResult`]
/// into an encrypted bidirectional stream.
///
/// A fresh UDX socket bound to an ephemeral port is created for the stream.
/// To reuse an existing socket (Node.js-style single-socket multiplexing),
/// use [`establish_stream_with_socket`] instead.
pub async fn establish_stream(
    result: &ConnectResult,
    runtime: &UdxRuntime,
) -> Result<PeerConnection, HyperDhtError> {
    establish_stream_with_socket(result, runtime, None).await
}

/// Call after [`HyperDhtHandle::connect`] to upgrade a [`ConnectResult`]
/// into an encrypted bidirectional stream, optionally reusing an existing socket.
///
/// When `shared_socket` is `Some`, the stream reuses that socket (matching
/// the Node.js single-socket multiplexing model). When `None`, a fresh socket
/// bound to an ephemeral port is created.
pub async fn establish_stream_with_socket(
    result: &ConnectResult,
    runtime: &UdxRuntime,
    shared_socket: Option<UdxSocket>,
) -> Result<PeerConnection, HyperDhtError> {
    let remote_udx = result
        .remote_udx
        .as_ref()
        .ok_or_else(|| HyperDhtError::StreamEstablishment("no remote UDX info".into()))?;

    let remote_id = u32::try_from(remote_udx.id)
        .map_err(|_| HyperDhtError::StreamEstablishment("remote UDX id out of u32 range".into()))?;

    let addr: SocketAddr = SocketAddr::new(
        result
            .server_address
            .host
            .parse()
            .map_err(|e| HyperDhtError::StreamEstablishment(format!("invalid address: {e}")))?,
        result.server_address.port,
    );

    tracing::debug!(local_id = result.local_stream_id, remote_id, %addr, "establishing UDX stream");
    let socket = if let Some(s) = shared_socket {
        s
    } else {
        let s = runtime.create_socket().await?;
        s.bind("0.0.0.0:0".parse().expect("valid addr")).await?;
        s
    };
    let stream = runtime.create_stream(result.local_stream_id).await?;
    stream.connect(&socket, remote_id, addr).await?;

    let async_stream = stream.into_async_stream();
    let ss = SecretStream::from_session(
        result.noise.is_initiator,
        async_stream,
        result.noise.tx,
        result.noise.rx,
        result.noise.handshake_hash,
        result.noise.remote_public_key,
    )
    .await?;
    tracing::debug!("SecretStream established");

    Ok(PeerConnection {
        remote_public_key: result.remote_public_key,
        stream: ss,
        remote_addr: Some(addr),
        socket,
        _relay_task: None,
        transport_mode: result.transport_mode,
    })
}

// ── Server-side event handler ─────────────────────────────────────────────────

/// Run the server-side request loop for inbound peer handshakes.
pub async fn run_server(
    mut event_rx: mpsc::UnboundedReceiver<ServerEvent>,
    config: ServerConfig,
    _runtime: UdxRuntime,
) {
    while let Some(event) = event_rx.recv().await {
        match event {
            ServerEvent::PeerHandshake {
                msg,
                from,
                target,
                reply_tx,
            } => {
                let reply = handle_server_handshake(&config, msg, &from, target.as_ref());
                let _ = reply_tx.send(reply);
            }
        }
    }
}

fn handle_server_handshake(
    config: &ServerConfig,
    msg: HandshakeMessage,
    from: &Ipv4Peer,
    target: Option<&NodeId>,
) -> Option<Vec<u8>> {
    finish_server_noise_ik_handshake(config, msg, from, target).map(|o| o.reply_wire)
}

// ── Spawn ─────────────────────────────────────────────────────────────────────

/// Create a HyperDHT instance and start its background tasks.
pub async fn spawn(
    runtime: &UdxRuntime,
    config: HyperDhtConfig,
) -> Result<
    (
        JoinHandle<Result<(), HyperDhtError>>,
        HyperDhtHandle,
        mpsc::UnboundedReceiver<ServerEvent>,
    ),
    HyperDhtError,
> {
    let (dht_join, dht_handle) = super::rpc::spawn(runtime, config.dht).await?;
    let persistent_config = config.persistent;
    let connect_relay = config.connect_relay.clone();
    let connect_ui = config.connect_ui.clone();
    let prefer_relay_only = config.prefer_relay_only.clone();

    let request_rx = dht_handle
        .subscribe_requests()
        .await
        .ok_or(HyperDhtError::ChannelClosed)?;

    let router = Arc::new(Mutex::new(Router::new()));
    let (server_tx, server_rx) = mpsc::unbounded_channel();
    let (admin_tx, admin_rx) = mpsc::unbounded_channel::<AdminRequest>();

    let request_task = tokio::spawn(run_request_handler(
        request_rx,
        persistent_config,
        dht_handle.clone(),
        Arc::clone(&router),
        server_tx.clone(),
        admin_rx,
    ));

    let join = tokio::spawn(async move {
        tokio::select! {
            res = dht_join => {
                match res {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(e)) => Err(HyperDhtError::Dht(e)),
                    Err(_) => Err(HyperDhtError::ChannelClosed),
                }
            }
            res = request_task => {
                match res {
                    Ok(()) => Ok(()),
                    Err(_) => Err(HyperDhtError::ChannelClosed),
                }
            }
        }
    });

    let handle = HyperDhtHandle {
        dht: dht_handle,
        router,
        server_tx,
        admin_tx,
        connect_relay,
        connect_ui,
        prefer_relay_only,
    };
    Ok((join, handle, server_rx))
}

async fn run_request_handler(
    mut rx: tokio::sync::mpsc::UnboundedReceiver<super::rpc::UserRequest>,
    config: PersistentConfig,
    dht: DhtHandle,
    router: Arc<Mutex<Router>>,
    server_tx: mpsc::UnboundedSender<ServerEvent>,
    mut admin_rx: mpsc::UnboundedReceiver<AdminRequest>,
) {
    let mut storage = Persistent::new(config);

    loop {
        let mut req = tokio::select! {
            biased;
            Some(admin_req) = admin_rx.recv() => {
                match admin_req {
                    AdminRequest::PersistentStats { reply } => {
                        let _ = reply.send(storage.stats());
                    }
                }
                continue;
            }
            req = rx.recv() => match req {
                Some(r) => r,
                None => break,
            },
        };
        match req.command {
            PEER_HANDSHAKE => {
                tracing::debug!(from = %format!("{}:{}", req.from.host, req.from.port), "request: PEER_HANDSHAKE");
                handle_peer_handshake(req, &dht, &router, &server_tx);
                continue;
            }
            _ => {}
        }

        let node_id = req.id;

        let incoming = IncomingHyperRequest {
            command: req.command,
            target: req.target,
            token: req.token,
            value: req.value.clone(),
            from: req.from.clone(),
            id: node_id,
        };

        let reply = match req.command {
            FIND_PEER => {
                tracing::debug!(from = %format!("{}:{}", req.from.host, req.from.port), "request: FIND_PEER");
                storage.on_find_peer(&incoming)
            }
            LOOKUP => {
                tracing::debug!(from = %format!("{}:{}", req.from.host, req.from.port), "request: LOOKUP");
                storage.on_lookup(&incoming)
            }
            ANNOUNCE => {
                tracing::debug!(from = %format!("{}:{}", req.from.host, req.from.port), "request: ANNOUNCE");
                let own_id = dht.table_id().await.ok().flatten();
                if let Some(nid) = own_id {
                    let result = storage.on_announce(&incoming, &nid);
                    if !matches!(result, HandlerReply::Silent) {
                        if let Some(target) = incoming.target {
                            if let Ok(mut r) = router.lock() {
                                let already_server = r.get(&target).is_some_and(|e| e.has_server);
                                if !already_server {
                                    r.set(
                                        &target,
                                        ForwardEntry {
                                            relay: Some(incoming.from.clone()),
                                            has_server: false,
                                            inserted: std::time::Instant::now(),
                                        },
                                    );
                                }
                            }
                        }
                    }
                    result
                } else {
                    HandlerReply::Silent
                }
            }
            UNANNOUNCE => {
                tracing::debug!(from = %format!("{}:{}", req.from.host, req.from.port), "request: UNANNOUNCE");
                let own_id = dht.table_id().await.ok().flatten();
                if let Some(nid) = own_id {
                    storage.on_unannounce(&incoming, &nid)
                } else {
                    HandlerReply::Silent
                }
            }
            MUTABLE_PUT => {
                tracing::debug!(from = %format!("{}:{}", req.from.host, req.from.port), "request: MUTABLE_PUT");
                storage.on_mutable_put(&incoming)
            }
            MUTABLE_GET => {
                tracing::debug!(from = %format!("{}:{}", req.from.host, req.from.port), "request: MUTABLE_GET");
                storage.on_mutable_get(&incoming)
            }
            IMMUTABLE_PUT => {
                tracing::debug!(from = %format!("{}:{}", req.from.host, req.from.port), "request: IMMUTABLE_PUT");
                storage.on_immutable_put(&incoming)
            }
            IMMUTABLE_GET => {
                tracing::debug!(from = %format!("{}:{}", req.from.host, req.from.port), "request: IMMUTABLE_GET");
                storage.on_immutable_get(&incoming)
            }
            _ => {
                tracing::debug!(cmd = req.command, from = %format!("{}:{}", req.from.host, req.from.port), "request: unknown command");
                drop(req);
                continue;
            }
        };

        match reply {
            HandlerReply::Value(v) | HandlerReply::ValueNoToken(v) => {
                req.reply(v);
            }
            HandlerReply::Error(code) => {
                req.error(code);
            }
            HandlerReply::Silent => {
                drop(req);
            }
        }
    }
}

fn handle_peer_handshake(
    mut req: super::rpc::UserRequest,
    dht: &DhtHandle,
    router: &Arc<Mutex<Router>>,
    server_tx: &mpsc::UnboundedSender<ServerEvent>,
) {
    let Some(value) = &req.value else {
        tracing::debug!(
            from = %format!("{}:{}", req.from.host, req.from.port),
            "handshake failed — PEER_HANDSHAKE missing value"
        );
        req.error(1);
        return;
    };

    let action = {
        let router = match router.lock() {
            Ok(r) => r,
            Err(_) => {
                tracing::warn!("handshake failed — router lock poisoned");
                req.error(1);
                return;
            }
        };
        match router.route_handshake(req.target.as_ref(), &req.from, value) {
            Ok(a) => a,
            Err(e) => {
                tracing::debug!(
                    from = %format!("{}:{}", req.from.host, req.from.port),
                    err = %e,
                    "handshake failed — route_handshake rejected payload"
                );
                req.error(1);
                return;
            }
        }
    };

    match action {
        HandshakeAction::Relay { value, to } => {
            // Proxy the relayed PEER_HANDSHAKE as a tracked request so the destination
            // peer's MODE_REPLY (carried in the response value) is forwarded back to
            // the original client. The previous `dht.relay()` + `req.reply(None)` path
            // dropped the response — clients saw `HandshakeFailed("empty reply")` and
            // pairing across NATs never completed.
            tracing::info!(
                from = %format!("{}:{}", req.from.host, req.from.port),
                to = %format!("{}:{}", to.host, to.port),
                "handshake RELAY — forwarding between peers"
            );
            let dht_clone = dht.clone();
            let target = req.target;
            let to_host = to.host.clone();
            let to_port = to.port;
            tokio::spawn(async move {
                match dht_clone
                    .request(
                        UserRequestParams {
                            token: None,
                            command: PEER_HANDSHAKE,
                            target,
                            value: Some(value),
                        },
                        &to_host,
                        to_port,
                    )
                    .await
                {
                    Ok(resp) => {
                        if resp.error != 0 {
                            tracing::warn!(
                                err = resp.error,
                                to = %format!("{}:{}", to_host, to_port),
                                "handshake failed — RELAY destination returned error"
                            );
                            req.error(resp.error);
                        } else {
                            req.reply(resp.value);
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            err = %e,
                            to = %format!("{}:{}", to_host, to_port),
                            "handshake failed — RELAY proxy request failed"
                        );
                        req.error(1);
                    }
                }
            });
        }
        HandshakeAction::Reply(value) => {
            tracing::debug!(from = %format!("{}:{}", req.from.host, req.from.port), "handshake REPLY");
            req.reply(Some(value));
        }
        HandshakeAction::HandleLocally(msg) => {
            tracing::debug!(from = %format!("{}:{}", req.from.host, req.from.port), "handshake HANDLE_LOCALLY");
            let (reply_tx, reply_rx) = oneshot::channel();
            let from = req.from.clone();
            let from_log = format!("{}:{}", from.host, from.port);
            let target = req.target;

            let sent = server_tx
                .send(ServerEvent::PeerHandshake {
                    msg,
                    from,
                    target,
                    reply_tx,
                })
                .is_ok();

            if sent {
                tokio::spawn(async move {
                    match reply_rx.await {
                        Ok(value) => req.reply(value),
                        Err(_) => {
                            tracing::warn!(
                                from = %from_log,
                                "handshake failed — local handler reply timeout"
                            );
                            req.error(1);
                        }
                    }
                });
            } else {
                tracing::debug!(
                    from = %format!("{}:{}", req.from.host, req.from.port),
                    "handshake failed — server event channel closed"
                );
                req.reply(None);
            }
        }
        HandshakeAction::CloserNodes => {
            tracing::debug!(from = %format!("{}:{}", req.from.host, req.from.port), "handshake CLOSER_NODES");
            req.reply(None);
        }
        HandshakeAction::Drop => {
            tracing::debug!(from = %format!("{}:{}", req.from.host, req.from.port), "handshake DROP");
            drop(req);
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn encode_compact_uint(v: u64) -> Vec<u8> {
    let mut state = super::compact_encoding::State::new();
    super::compact_encoding::preencode_uint(&mut state, v);
    state.alloc();
    super::compact_encoding::encode_uint(&mut state, v);
    state.buffer
}

fn to_hex(bytes: impl AsRef<[u8]>) -> String {
    let bytes = bytes.as_ref();
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
        use std::fmt::Write;
        write!(s, "{b:02x}").ok();
        s
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peer_handshake_destination_skips_bootstrap_relay() {
        let bootstrap = Ipv4Peer {
            host: "137.66.21.59".into(),
            port: 49737,
        };
        let hints = vec![
            bootstrap.clone(),
            Ipv4Peer {
                host: "10.0.0.2".into(),
                port: 4001,
            },
        ];
        let dest = peer_handshake_destination(&bootstrap, &hints).unwrap();
        assert_eq!(dest.host, "10.0.0.2");
        assert_eq!(dest.port, 4001);
    }

    #[test]
    fn hyperdht_config_defaults() {
        let cfg = HyperDhtConfig::default();
        assert_eq!(cfg.dht.port, 0);
        assert_eq!(cfg.dht.host, "0.0.0.0");
        assert_eq!(cfg.dht.concurrency, 10);
        assert!(cfg.dht.bootstrap.is_empty());
        assert_eq!(
            cfg.persistent.max_records,
            PersistentConfig::default().max_records
        );
        assert_eq!(
            cfg.persistent.max_per_key,
            PersistentConfig::default().max_per_key
        );
    }

    #[test]
    fn keypair_generate_produces_unique_keys() {
        let kp1 = KeyPair::generate();
        let kp2 = KeyPair::generate();
        assert_ne!(kp1.public_key, kp2.public_key);
    }

    #[test]
    fn keypair_from_seed_deterministic() {
        let seed = [0x42u8; 32];
        let kp1 = KeyPair::from_seed(seed);
        let kp2 = KeyPair::from_seed(seed);
        assert_eq!(kp1.public_key, kp2.public_key);
        assert_eq!(kp1.secret_key, kp2.secret_key);
    }

    #[test]
    fn keypair_public_key_matches_secret() {
        let kp = KeyPair::from_seed([0x11u8; 32]);
        assert_eq!(&kp.secret_key[32..], &kp.public_key);
    }

    #[test]
    fn keypair_sign_verify_roundtrip() {
        let kp = KeyPair::generate();
        let msg = b"test message";
        let sig = sign_detached(msg, &kp.secret_key);
        assert!(verify_detached(&sig, msg, &kp.public_key));
    }

    #[test]
    fn encode_compact_uint_round_trips() {
        use super::compact_encoding::{decode_uint, State};
        for val in [0u64, 1, 127, 128, 255, 65535, u64::MAX / 2] {
            let bytes = encode_compact_uint(val);
            let mut s = State::from_buffer(&bytes);
            let decoded = decode_uint(&mut s).unwrap();
            assert_eq!(decoded, val, "compact uint round-trip failed for {val}");
        }
    }

    #[test]
    fn hyperdht_error_display() {
        let e = HyperDhtError::Destroyed;
        assert!(e.to_string().contains("destroyed"));
        let e2 = HyperDhtError::InvalidSignature;
        assert!(e2.to_string().contains("signature"));
    }

    #[test]
    fn keypair_debug_hides_secret() {
        let kp = KeyPair::from_seed([0x42u8; 32]);
        let dbg = format!("{kp:?}");
        assert!(dbg.contains("KeyPair"));
        assert!(!dbg.contains("secret_key"));
    }

    #[tokio::test]
    async fn spawn_and_destroy() {
        let runtime = libudx::UdxRuntime::new().expect("runtime");
        let config = HyperDhtConfig {
            dht: DhtConfig {
                bootstrap: vec![],
                port: 0,
                ..DhtConfig::default()
            },
            persistent: PersistentConfig::default(),
            connect_relay: ConnectRelayConfig::default(),
            connect_ui: None,
            prefer_relay_only: Arc::new(AtomicBool::new(true)),
        };
        let (join, handle, _server_rx) = spawn(&runtime, config).await.expect("spawn");
        handle.destroy().await.expect("destroy");
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            join,
        )
        .await;
    }

    #[tokio::test]
    async fn wire_stats_starts_at_zero_and_is_addressable() {
        let runtime = libudx::UdxRuntime::new().expect("runtime");
        let config = HyperDhtConfig {
            dht: DhtConfig {
                bootstrap: vec![],
                port: 0,
                ..DhtConfig::default()
            },
            persistent: PersistentConfig::default(),
            connect_relay: ConnectRelayConfig::default(),
            connect_ui: None,
            prefer_relay_only: Arc::new(AtomicBool::new(true)),
        };
        let (join, handle, _rx) = spawn(&runtime, config).await.expect("spawn");
        let (sent, received) = handle.wire_stats();
        assert_eq!(sent, 0, "no traffic yet");
        assert_eq!(received, 0);
        // Counters are shared via Arc — incrementing through `wire_counters()`
        // must be visible via `wire_stats()`.
        let counters = handle.wire_counters();
        counters
            .bytes_sent
            .fetch_add(123, std::sync::atomic::Ordering::Relaxed);
        counters
            .bytes_received
            .fetch_add(456, std::sync::atomic::Ordering::Relaxed);
        let (sent, received) = handle.wire_stats();
        assert_eq!(sent, 123);
        assert_eq!(received, 456);
        handle.destroy().await.expect("destroy");
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), join).await;
    }

    #[test]
    fn next_stream_id_is_unique() {
        let a = next_stream_id();
        let b = next_stream_id();
        let c = next_stream_id();
        assert_ne!(a, b);
        assert_ne!(b, c);
        assert_ne!(a, c);
    }

    #[tokio::test]
    async fn establish_stream_missing_udx_info() {
        let runtime = libudx::UdxRuntime::new().expect("runtime");
        let nw_result = NoiseWrapResult {
            remote_public_key: [0xAA; 32],
            tx: [1; 32],
            rx: [2; 32],
            handshake_hash: [3; 64],
            is_initiator: true,
        };
        let result = ConnectResult {
            remote_public_key: [0xAA; 32],
            server_address: Ipv4Peer { host: "127.0.0.1".into(), port: 9999 },
            client_address: Ipv4Peer { host: "127.0.0.1".into(), port: 8888 },
            is_relayed: false,
            noise: nw_result,
            local_stream_id: 1,
            remote_udx: None,
            transport_mode: None,
        };
        let err = establish_stream(&result, &runtime).await.unwrap_err();
        assert!(matches!(err, HyperDhtError::StreamEstablishment(_)));
    }

    #[tokio::test]
    async fn establish_stream_bad_address() {
        let runtime = libudx::UdxRuntime::new().expect("runtime");
        let nw_result = NoiseWrapResult {
            remote_public_key: [0xBB; 32],
            tx: [1; 32],
            rx: [2; 32],
            handshake_hash: [3; 64],
            is_initiator: true,
        };
        let result = ConnectResult {
            remote_public_key: [0xBB; 32],
            server_address: Ipv4Peer { host: "not-an-ip".into(), port: 9999 },
            client_address: Ipv4Peer { host: "127.0.0.1".into(), port: 8888 },
            is_relayed: false,
            noise: nw_result,
            local_stream_id: next_stream_id(),
            remote_udx: Some(UdxInfo { version: 1, reusable_socket: true, id: 42, seq: 0 }),
            transport_mode: None,
        };
        let err = establish_stream(&result, &runtime).await.unwrap_err();
        assert!(matches!(err, HyperDhtError::StreamEstablishment(_)));
    }

    #[tokio::test]
    async fn establish_stream_remote_id_overflow() {
        let runtime = libudx::UdxRuntime::new().expect("runtime");
        let nw_result = NoiseWrapResult {
            remote_public_key: [0xCC; 32],
            tx: [1; 32],
            rx: [2; 32],
            handshake_hash: [3; 64],
            is_initiator: true,
        };
        let result = ConnectResult {
            remote_public_key: [0xCC; 32],
            server_address: Ipv4Peer { host: "127.0.0.1".into(), port: 9999 },
            client_address: Ipv4Peer { host: "127.0.0.1".into(), port: 8888 },
            is_relayed: false,
            noise: nw_result,
            local_stream_id: next_stream_id(),
            remote_udx: Some(UdxInfo {
                version: 1,
                reusable_socket: true,
                id: u64::from(u32::MAX) + 1,
                seq: 0,
            }),
            transport_mode: None,
        };
        let err = establish_stream(&result, &runtime).await.unwrap_err();
        assert!(matches!(err, HyperDhtError::StreamEstablishment(_)));
    }

    #[test]
    fn default_bootstrap_has_three_nodes() {
        assert_eq!(DEFAULT_BOOTSTRAP.len(), 3);
        for entry in &DEFAULT_BOOTSTRAP {
            assert!(entry.contains('@'), "missing @ in {entry}");
            assert!(entry.ends_with(":49737"), "wrong port in {entry}");
        }
    }

    #[test]
    fn with_public_bootstrap_populates_nodes() {
        let cfg = HyperDhtConfig::with_public_bootstrap();
        assert_eq!(cfg.dht.bootstrap.len(), 3);
        assert_eq!(cfg.dht.bootstrap[0], DEFAULT_BOOTSTRAP[0]);
        assert_eq!(cfg.dht.bootstrap[1], DEFAULT_BOOTSTRAP[1]);
        assert_eq!(cfg.dht.bootstrap[2], DEFAULT_BOOTSTRAP[2]);
        assert_eq!(cfg.dht.port, 0);
    }

    #[test]
    fn outbound_relay_token_deterministic_when_relay_only() {
        use crate::dht::blind_relay;
        let relay_pk = [0xaa; 32];
        let local = [0x01; 32];
        let remote = [0x02; 32];
        let topic = [0xbb; 32];
        let t1 = super::outbound_relay_through_token(relay_pk, Some(&topic), &local, &remote, true);
        let t2 = super::outbound_relay_through_token(relay_pk, Some(&topic), &local, &remote, true);
        assert_eq!(t1, t2);
        assert_eq!(
            t1,
            blind_relay::resolve_pair_token(Some(&topic), &local, &remote, &relay_pk)
        );
    }
}

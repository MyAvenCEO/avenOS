//! blind-relay protocol messages — wire-compatible with Node.js `blind-relay@1.4.0`.
//!
//! The blind-relay protocol uses Protomux with protocol name `"blind-relay"`.
//! It has exactly two message types:
//!
//! - **Pair** (type 0): Request to pair two connections through the relay.
//! - **Unpair** (type 1): Cancel a previous pair request.
//!
//! # Wire Format
//!
//! ## Pair (message type 0)
//! ```text
//! [bitfield(7): flags, bit0=isInitiator] [fixed32: token] [uint: id] [uint: seq]
//! ```
//!
//! ## Unpair (message type 1)
//! ```text
//! [bitfield(7): flags, all zero] [fixed32: token]
//! ```
//!
//! The `bitfield(7)` from `compact-encoding-bitfield` is a single byte holding
//! up to 7 boolean flags. Only bit 0 (`is_initiator`) is used.

use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use super::compact_encoding::{self as c, State};
use super::protomux::{self, Channel, ChannelEvent, Mux};
use libudx::{UdxRuntime, UdxSocket};
use thiserror::Error;
use tokio::sync::{Mutex, oneshot};
use tracing::{debug, warn};

/// Pair message — requests relay pairing with a 32-byte token.
#[derive(Debug, Clone, PartialEq)]
pub struct PairMessage {
    /// Indicates whether this peer initiated the pair request.
    pub is_initiator: bool,
    /// Relay token used to match the pair and unpair messages.
    pub token: [u8; 32],
    /// Stream identifier assigned by the local peer.
    pub id: u64,
    /// Sequence number for the pair request.
    pub seq: u64,
}

/// Unpair message — cancels a relay pairing.
#[derive(Debug, Clone, PartialEq)]
pub struct UnpairMessage {
    /// Relay token used to cancel a pending pair request.
    pub token: [u8; 32],
}

/// Protocol name used over Protomux.
pub const PROTOCOL_NAME: &str = "blind-relay";

/// Protomux message type index for pair.
pub const MSG_TYPE_PAIR: u32 = 0;

/// Protomux message type index for unpair.
pub const MSG_TYPE_UNPAIR: u32 = 1;

/// Pre-encodes a [`PairMessage`], advancing the state cursor.
pub fn preencode_pair(state: &mut State, msg: &PairMessage) {
    state.end += 1; // bitfield(7) = 1 byte
    state.end += 32; // fixed32 token
    c::preencode_uint(state, msg.id);
    c::preencode_uint(state, msg.seq);
}

/// Encodes a [`PairMessage`] into the state buffer.
pub fn encode_pair(state: &mut State, msg: &PairMessage) {
    let flags: u8 = if msg.is_initiator { 1 } else { 0 };
    c::encode_uint8(state, flags);
    c::encode_fixed32(state, &msg.token);
    c::encode_uint(state, msg.id);
    c::encode_uint(state, msg.seq);
}

/// Decodes a [`PairMessage`] from the state buffer.
pub fn decode_pair(state: &mut State) -> c::Result<PairMessage> {
    let flags = c::decode_uint8(state)?;
    let is_initiator = flags & 1 != 0;
    let token = c::decode_fixed32(state)?;
    let id = c::decode_uint(state)?;
    let seq = c::decode_uint(state)?;
    Ok(PairMessage {
        is_initiator,
        token,
        id,
        seq,
    })
}

/// Pre-encodes a [`UnpairMessage`], advancing the state cursor.
pub fn preencode_unpair(state: &mut State, _msg: &UnpairMessage) {
    state.end += 1; // bitfield(7) = 1 byte
    state.end += 32; // fixed32 token
}

/// Encodes a [`UnpairMessage`] into the state buffer.
pub fn encode_unpair(state: &mut State, msg: &UnpairMessage) {
    c::encode_uint8(state, 0); // flags = 0
    c::encode_fixed32(state, &msg.token);
}

/// Decodes a [`UnpairMessage`] from the state buffer.
pub fn decode_unpair(state: &mut State) -> c::Result<UnpairMessage> {
    let _flags = c::decode_uint8(state)?;
    let token = c::decode_fixed32(state)?;
    Ok(UnpairMessage { token })
}

/// Encode a pair message to bytes (preencode + allocate + encode).
pub fn encode_pair_to_vec(msg: &PairMessage) -> Vec<u8> {
    let mut state = State::new();
    preencode_pair(&mut state, msg);
    state.alloc();
    encode_pair(&mut state, msg);
    state.buffer
}

/// Encode an unpair message to bytes.
pub fn encode_unpair_to_vec(msg: &UnpairMessage) -> Vec<u8> {
    let mut state = State::new();
    preencode_unpair(&mut state, msg);
    state.alloc();
    encode_unpair(&mut state, msg);
    state.buffer
}

/// Decode a pair message from bytes.
pub fn decode_pair_from_slice(data: &[u8]) -> c::Result<PairMessage> {
    let mut state = State::from_buffer(data);
    decode_pair(&mut state)
}

/// Decode an unpair message from bytes.
pub fn decode_unpair_from_slice(data: &[u8]) -> c::Result<UnpairMessage> {
    let mut state = State::from_buffer(data);
    decode_unpair(&mut state)
}

// ── Client ───────────────────────────────────────────────────────────────────

/// Errors that can occur while using the blind relay client.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum RelayError {
    /// A Protomux operation failed while opening, sending, or receiving.
    #[error("protomux error: {0}")]
    Protomux(#[from] protomux::ProtomuxError),

    /// Encoding or decoding of relay messages failed.
    #[error("encoding error: {0}")]
    Encoding(#[from] c::EncodingError),

    /// The channel closed before a matching pair response arrived.
    #[error("channel closed before pair response")]
    ChannelClosed,

    /// The client was destroyed before the operation could complete.
    #[error("relay client destroyed")]
    Destroyed,

    /// Duplicate initiator/responder registration for same token while pending.
    #[error("duplicate blind-relay pair side")]
    DuplicatePairSide,

    /// Could not notify peer pairing completion.
    #[error("pair completion channel dropped")]
    PairNotifyDropped,

    /// Wrapped UDX error establishing relay data streams.
    #[error("relay udx error: {0}")]
    UdxRelay(#[from] libudx::UdxError),

    /// Pending pair cancelled (e.g. unpair) before a match arrived.
    #[error("blind relay pairing cancelled")]
    PairingCancelled,
}

/// Response from a successful relay pairing.
#[derive(Debug, Clone)]
pub struct PairResponse {
    /// Relay-assigned remote stream identifier.
    pub remote_id: u64,
}

/// Client-side blind-relay over an existing Protomux connection.
///
/// Wraps a Protomux channel with protocol `"blind-relay"`. Sends pair/unpair
/// messages and waits for the relay server to match the token.
pub struct BlindRelayClient {
    channel: Channel,
}

impl BlindRelayClient {
    /// Open a blind-relay channel on the given Mux.
    ///
    /// `id` should be the local public key used when connecting to the relay.
    /// Both the relay server and the connecting peer must use the same `id`
    /// (the connecting peer's public key) so that Protomux can pair the
    /// channels correctly.
    ///
    /// Sends the Open frame immediately. Call [`Self::wait_opened`] before
    /// sending pair/unpair messages.
    pub async fn open(mux: &Mux, id: Option<Vec<u8>>) -> Result<Self, RelayError> {
        let channel = mux.create_channel(PROTOCOL_NAME, id, None).await?;
        Ok(Self { channel })
    }

    /// Wait for the remote side to open the channel.
    pub async fn wait_opened(&mut self) -> Result<(), RelayError> {
        self.channel.wait_opened().await?;
        Ok(())
    }

    /// Send a pair request and wait for the relay server's response.
    ///
    /// Returns the relay-assigned `remote_id` (UDX stream ID on the relay side).
    /// Blocks until the server sends a matching pair message back.
    pub async fn pair(
        &mut self,
        is_initiator: bool,
        token: &[u8; 32],
        stream_id: u64,
    ) -> Result<PairResponse, RelayError> {
        let msg = PairMessage {
            is_initiator,
            token: *token,
            id: stream_id,
            seq: 0,
        };
        self.channel
            .send(MSG_TYPE_PAIR, &encode_pair_to_vec(&msg))?;

        debug!(
            is_initiator,
            token = %format_args!("{:02x?}", &token[..4]),
            stream_id,
            "sent pair request"
        );

        loop {
            match self.channel.recv().await {
                Some(ChannelEvent::Message { message_type, data }) => {
                    if message_type == MSG_TYPE_PAIR {
                        let response = decode_pair_from_slice(&data)?;
                        if response.token == *token && response.is_initiator == is_initiator {
                            debug!(
                                remote_id = response.id,
                                "pair response received"
                            );
                            return Ok(PairResponse {
                                remote_id: response.id,
                            });
                        }
                    }
                }
                Some(ChannelEvent::Closed { .. }) | None => {
                    return Err(RelayError::ChannelClosed);
                }
                Some(ChannelEvent::Opened { .. }) => {}
            }
        }
    }

    /// Cancel a pending pair request.
    pub fn unpair(&self, token: &[u8; 32]) -> Result<(), RelayError> {
        let msg = UnpairMessage { token: *token };
        self.channel
            .send(MSG_TYPE_UNPAIR, &encode_unpair_to_vec(&msg))?;
        Ok(())
    }

    /// Close the blind-relay channel.
    pub fn close(&mut self) {
        self.channel.close();
    }
}

// ── Server (Hyperswarm wire-compatible pairing + UDX relay) ───────────────────

#[derive(Default)]
struct TokenSlots {
    initiator: Option<HalfAwait>,
    responder: Option<HalfAwait>,
}

struct HalfAwait {
    peer_stream_id: u32,
    peer_udp: SocketAddr,
    reply: oneshot::Sender<Result<u64, RelayError>>,
}

/// Wired relay data streams kept alive until [`BlindRelayCoordinator::unpair_token`].
struct ActiveRelayLink {
    _s_a: libudx::UdxStream,
    _s_b: libudx::UdxStream,
}

struct BlindInner {
    rt: Arc<UdxRuntime>,
    relay_sock: UdxSocket,
    next_data_stream_id: AtomicU32,
    pending: Mutex<HashMap<[u8; 32], TokenSlots>>,
    active: Mutex<HashMap<[u8; 32], ActiveRelayLink>>,
}

/// Host-side Hyperswarm blind relay co-located with HyperDHT bootstrap (same UDP socket/runtime).
///
/// Pairs [`BlindRelayClient`] halves on a shared nonce; wires two [`relay_to`] streams like
/// [`blind-relay`](https://github.com/holepunchto/blind-relay) `BlindRelayServer`.
#[derive(Clone)]
pub struct BlindRelayCoordinator {
    inner: Arc<BlindInner>,
}

impl BlindRelayCoordinator {
    /// Multiplex relay data through `relay_sock` (typically the bootstrap / DHT [`listen`] socket).
    pub fn new(rt: Arc<UdxRuntime>, relay_sock: UdxSocket) -> Self {
        Self {
            inner: Arc::new(BlindInner {
                rt,
                relay_sock,
                next_data_stream_id: AtomicU32::new(60_000),
                pending: Mutex::new(HashMap::new()),
                active: Mutex::new(HashMap::new()),
            }),
        }
    }

    fn notify_half_drop(half: HalfAwait, err: RelayError) {
        let _ = half.reply.send(Err(err));
    }

    fn clear_token_waiters_locked(map: &mut HashMap<[u8; 32], TokenSlots>, token: &[u8; 32]) {
        if let Some(slots) = map.remove(token) {
            if let Some(h) = slots.initiator {
                Self::notify_half_drop(h, RelayError::PairingCancelled);
            }
            if let Some(h) = slots.responder {
                Self::notify_half_drop(h, RelayError::PairingCancelled);
            }
        }
    }

    /// Remove pending halves and tear down wired relay streams for `token`.
    pub async fn unpair_token(&self, token: &[u8; 32]) {
        let mut map = self.inner.pending.lock().await;
        Self::clear_token_waiters_locked(&mut map, token);
        drop(map);
        self.inner.active.lock().await.remove(token);
    }

    async fn wire_paired_streams(
        &self,
        token: [u8; 32],
        ini: HalfAwait,
        rsp: HalfAwait,
    ) -> Result<(), RelayError> {
        let relay_a = self.inner.next_data_stream_id.fetch_add(1, Ordering::SeqCst);
        let relay_b = self.inner.next_data_stream_id.fetch_add(1, Ordering::SeqCst);

        let s_a = self
            .inner
            .rt
            .create_stream(relay_a)
            .await
            .map_err(RelayError::UdxRelay)?;
        let s_b = self
            .inner
            .rt
            .create_stream(relay_b)
            .await
            .map_err(RelayError::UdxRelay)?;
        s_a.relay_to(&s_b)?;
        s_b.relay_to(&s_a)?;

        s_a.connect(
            &self.inner.relay_sock,
            ini.peer_stream_id,
            ini.peer_udp,
        )
        .await
        .map_err(RelayError::UdxRelay)?;
        s_b.connect(
            &self.inner.relay_sock,
            rsp.peer_stream_id,
            rsp.peer_udp,
        )
        .await
        .map_err(RelayError::UdxRelay)?;

        if ini.reply.send(Ok(u64::from(relay_a))).is_err() {
            return Err(RelayError::PairNotifyDropped);
        }
        if rsp.reply.send(Ok(u64::from(relay_b))).is_err() {
            return Err(RelayError::PairNotifyDropped);
        }

        self.inner.active.lock().await.insert(
            token,
            ActiveRelayLink {
                _s_a: s_a,
                _s_b: s_b,
            },
        );
        Ok(())
    }

    /// Register one control-session side until the counterpart arrives; returns relay-assigned UDX stream id.
    ///
    /// If the duplicate half arrives from the same token while that side slot is occupied, behaves like Node
    /// `else if (pair.links[+isInitiator]) return` (no-op, caller must handle hang — client should not resend).
    pub async fn register_pair_half(
        &self,
        token: [u8; 32],
        is_initiator: bool,
        peer_stream_id: u32,
        peer_udp: SocketAddr,
    ) -> Result<u64, RelayError> {
        let (reply_tx, reply_rx) = oneshot::channel();

        let to_wire = {
            let mut map = self.inner.pending.lock().await;
            let slots = match map.entry(token) {
                Entry::Vacant(v) => v.insert(TokenSlots::default()),
                Entry::Occupied(o) => o.into_mut(),
            };

            let side_occupied = if is_initiator {
                slots.initiator.is_some()
            } else {
                slots.responder.is_some()
            };
            if side_occupied {
                return Err(RelayError::DuplicatePairSide);
            }

            let half = HalfAwait {
                peer_stream_id,
                peer_udp,
                reply: reply_tx,
            };

            if is_initiator {
                slots.initiator = Some(half);
            } else {
                slots.responder = Some(half);
            }

            let paired_ready = slots.initiator.is_some() && slots.responder.is_some();
            if paired_ready {
                let ini = slots.initiator.take().expect("checked initiator occupied");
                let rsp = slots.responder.take().expect("checked responder occupied");
                map.remove(&token);
                Some((ini, rsp))
            } else {
                None
            }
        };

        if let Some((ini, rsp)) = to_wire {
            if let Err(e) = self.wire_paired_streams(token, ini, rsp).await {
                warn!(error = %e, "blind relay wire_paired_streams failed");
                return Err(e);
            }
        }

        reply_rx.await.map_err(|_| RelayError::PairNotifyDropped)?
    }
}

/// Run a responder-side blind-relay protomux session (Ik over SecretStream → [`Mux`]).
///
/// - `peer_udp` comes from Noise `MODE_FROM_RELAY`/`client_address`; used by UDX `.connect(..., peer_stream_id, peer_udp)`
///   like blind-relay `_onfirewall`.
/// - Drops all pending halves for channels closed mid-wait elsewhere via [`BlindRelayCoordinator::unpair_token`] if needed by callers.
///
/// Matches Node `BlindRelaySession` channel id = remote static key (`socket.remotePublicKey`).
pub fn spawn_blind_relay_control_session<S>(
    coord: BlindRelayCoordinator,
    stream: super::secret_stream::SecretStream<S>,
    peer_udp: SocketAddr,
) -> tokio::task::JoinHandle<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    tokio::spawn(blind_relay_control_loop(coord, stream, peer_udp))
}

async fn blind_relay_control_loop<S>(
    coord: BlindRelayCoordinator,
    stream: super::secret_stream::SecretStream<S>,
    peer_udp: SocketAddr,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let remote_pk = stream.remote_public_key().to_vec();
    let (mux, mux_run) = Mux::new(stream);
    tokio::spawn(mux_run);

    let mut channel = match mux
        .create_channel(PROTOCOL_NAME, Some(remote_pk.clone()), None)
        .await
    {
        Ok(c) => c,
        Err(e) => {
            warn!(error = %e, "blind relay: create protomux channel failed");
            return;
        }
    };

    if let Err(e) = channel.wait_opened().await {
        warn!(error = %e, "blind relay: channel wait_opened failed");
        return;
    }

    loop {
        match channel.recv().await {
            Some(ChannelEvent::Message {
                message_type,
                data,
            }) => {
                if message_type == MSG_TYPE_PAIR {
                    let pm = match decode_pair_from_slice(&data) {
                        Ok(m) => m,
                        Err(e) => {
                            warn!(error = %e, "blind relay: decode pair failed");
                            continue;
                        }
                    };

                    let peer_sid = match u32::try_from(pm.id) {
                        Ok(v) => v,
                        Err(_) => {
                            warn!(pair_id = pm.id, "blind relay: pair peer stream id overflows u32");
                            channel.close();
                            return;
                        }
                    };

                    let assigned = match coord
                        .register_pair_half(pm.token, pm.is_initiator, peer_sid, peer_udp)
                        .await
                    {
                        Ok(id) => id,
                        Err(RelayError::DuplicatePairSide) => {
                            // Node ignores duplicate registrations for same side/token.
                            continue;
                        }
                        Err(e) => {
                            warn!(
                                pair_id = pm.id,
                                is_initiator = pm.is_initiator,
                                error = %e,
                                "blind relay pair failed",
                            );
                            channel.close();
                            return;
                        }
                    };

                    let reply = PairMessage {
                        is_initiator: pm.is_initiator,
                        token: pm.token,
                        id: assigned,
                        seq: 0,
                    };
                    if let Err(e) = channel.send(MSG_TYPE_PAIR, &encode_pair_to_vec(&reply)) {
                        warn!(error = %e, "blind relay: send pair response failed");
                        return;
                    }
                } else if message_type == MSG_TYPE_UNPAIR {
                    match decode_unpair_from_slice(&data) {
                        Ok(u) => {
                            coord.unpair_token(&u.token).await;
                        }
                        Err(e) => warn!(error = %e, "blind relay: decode unpair failed"),
                    }
                }
            }
            Some(ChannelEvent::Closed { .. }) | None => break,
            Some(ChannelEvent::Opened { .. }) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::protomux::{FramedStream, Mux};
    use libudx::UdxRuntime;
    use std::net::SocketAddr;
    use std::sync::Arc;
    use tokio::sync::mpsc;

    struct MemStream {
        rx: mpsc::UnboundedReceiver<Vec<u8>>,
        tx: mpsc::UnboundedSender<Vec<u8>>,
    }

    impl FramedStream for MemStream {
        async fn read_frame(&mut self) -> std::io::Result<Option<Vec<u8>>> {
            Ok(self.rx.recv().await)
        }

        async fn write_frame(&mut self, data: &[u8]) -> std::io::Result<()> {
            self.tx
                .send(data.to_vec())
                .map_err(|_| std::io::Error::new(std::io::ErrorKind::BrokenPipe, "closed"))
        }
    }

    fn mem_pair() -> (MemStream, MemStream) {
        let (tx_a, rx_b) = mpsc::unbounded_channel();
        let (tx_b, rx_a) = mpsc::unbounded_channel();
        (
            MemStream { rx: rx_a, tx: tx_a },
            MemStream { rx: rx_b, tx: tx_b },
        )
    }

    #[test]
    fn pair_roundtrip_initiator() {
        let msg = PairMessage {
            is_initiator: true,
            token: [0xaa; 32],
            id: 42,
            seq: 7,
        };
        let encoded = encode_pair_to_vec(&msg);
        let decoded = decode_pair_from_slice(&encoded).unwrap();
        assert_eq!(decoded, msg);
    }

    #[test]
    fn pair_roundtrip_responder() {
        let msg = PairMessage {
            is_initiator: false,
            token: [0xbb; 32],
            id: 0,
            seq: 0,
        };
        let encoded = encode_pair_to_vec(&msg);
        let decoded = decode_pair_from_slice(&encoded).unwrap();
        assert_eq!(decoded, msg);
    }

    #[test]
    fn unpair_roundtrip() {
        let msg = UnpairMessage {
            token: [0xcc; 32],
        };
        let encoded = encode_unpair_to_vec(&msg);
        let decoded = decode_unpair_from_slice(&encoded).unwrap();
        assert_eq!(decoded, msg);
    }

    #[test]
    fn pair_wire_format() {
        let msg = PairMessage {
            is_initiator: true,
            token: [0x42; 32],
            id: 1,
            seq: 2,
        };
        let encoded = encode_pair_to_vec(&msg);

        assert_eq!(encoded[0], 0x01); // flags: bit0=1 (initiator)
        assert_eq!(&encoded[1..33], &[0x42; 32]); // token
        assert_eq!(encoded[33], 0x01); // id=1 (varint)
        assert_eq!(encoded[34], 0x02); // seq=2 (varint)
        assert_eq!(encoded.len(), 35);
    }

    #[test]
    fn pair_wire_format_responder() {
        let msg = PairMessage {
            is_initiator: false,
            token: [0x00; 32],
            id: 0,
            seq: 0,
        };
        let encoded = encode_pair_to_vec(&msg);

        assert_eq!(encoded[0], 0x00); // flags: bit0=0 (responder)
        assert_eq!(&encoded[1..33], &[0x00; 32]); // token
        assert_eq!(encoded[33], 0x00); // id=0
        assert_eq!(encoded[34], 0x00); // seq=0
    }

    #[test]
    fn unpair_wire_format() {
        let msg = UnpairMessage {
            token: [0xff; 32],
        };
        let encoded = encode_unpair_to_vec(&msg);

        assert_eq!(encoded[0], 0x00); // flags: all zero
        assert_eq!(&encoded[1..33], &[0xff; 32]); // token
        assert_eq!(encoded.len(), 33);
    }

    #[test]
    fn pair_large_ids() {
        let msg = PairMessage {
            is_initiator: true,
            token: [0xde; 32],
            id: 100_000,
            seq: 65_536,
        };
        let encoded = encode_pair_to_vec(&msg);
        let decoded = decode_pair_from_slice(&encoded).unwrap();
        assert_eq!(decoded, msg);
    }

    #[test]
    fn protocol_name_constant() {
        assert_eq!(PROTOCOL_NAME, "blind-relay");
    }

    #[tokio::test]
    async fn client_pair_with_fake_relay() {
        let (stream_a, stream_b) = mem_pair();

        let (mux_a, run_a) = Mux::new(stream_a);
        let (mux_b, run_b) = Mux::new(stream_b);

        tokio::spawn(run_a);
        tokio::spawn(run_b);

        let token = [0xaa; 32];

        let client_task = tokio::spawn(async move {
            let mut client = BlindRelayClient::open(&mux_a, None).await.unwrap();
            client.wait_opened().await.unwrap();
            let resp = client.pair(true, &token, 42).await.unwrap();
            client.close();
            resp
        });

        // Fake relay server: open matching channel, wait for pair, send response
        let mut server_ch = mux_b
            .create_channel(PROTOCOL_NAME, None, None)
            .await
            .unwrap();
        server_ch.wait_opened().await.unwrap();

        let event = server_ch.recv().await.unwrap();
        match event {
            ChannelEvent::Message { message_type, data } => {
                assert_eq!(message_type, MSG_TYPE_PAIR);
                let pair_msg = decode_pair_from_slice(&data).unwrap();
                assert!(pair_msg.is_initiator);
                assert_eq!(pair_msg.token, token);
                assert_eq!(pair_msg.id, 42);

                let reply = PairMessage {
                    is_initiator: true,
                    token,
                    id: 99,
                    seq: 0,
                };
                server_ch
                    .send(MSG_TYPE_PAIR, &encode_pair_to_vec(&reply))
                    .unwrap();
            }
            other => panic!("expected pair Message, got {other:?}"),
        }

        let resp = client_task.await.unwrap();
        assert_eq!(resp.remote_id, 99);
    }

    #[tokio::test]
    async fn client_unpair() {
        let (stream_a, stream_b) = mem_pair();

        let (mux_a, run_a) = Mux::new(stream_a);
        let (mux_b, run_b) = Mux::new(stream_b);

        tokio::spawn(run_a);
        tokio::spawn(run_b);

        let token = [0xbb; 32];

        let mut client = BlindRelayClient::open(&mux_a, None).await.unwrap();
        let mut server_ch = mux_b
            .create_channel(PROTOCOL_NAME, None, None)
            .await
            .unwrap();

        client.wait_opened().await.unwrap();
        server_ch.wait_opened().await.unwrap();

        client.unpair(&token).unwrap();

        let event = server_ch.recv().await.unwrap();
        match event {
            ChannelEvent::Message { message_type, data } => {
                assert_eq!(message_type, MSG_TYPE_UNPAIR);
                let unpair_msg = decode_unpair_from_slice(&data).unwrap();
                assert_eq!(unpair_msg.token, token);
            }
            other => panic!("expected unpair Message, got {other:?}"),
        }

        client.close();
    }

    /// Single relay UDP socket — both relay legs and both peers (production-shaped topology).
    #[tokio::test]
    async fn single_relay_socket_udx_smoke() {
        let relay_rt = UdxRuntime::new().expect("relay rt");
        let relay_sock = relay_rt.create_socket().await.expect("relay sock");
        relay_sock
            .bind("127.0.0.1:0".parse::<SocketAddr>().unwrap())
            .await
            .expect("relay bind");
        let relay_listen = relay_sock.local_addr().await.expect("relay local");

        let peer_a = UdxRuntime::new().expect("rt a");
        let peer_b = UdxRuntime::new().expect("rt b");

        let sa_sock = peer_a.create_socket().await.expect("sock a");
        sa_sock.bind("127.0.0.1:0".parse().unwrap()).await.unwrap();
        let pa = sa_sock.local_addr().await.unwrap();

        let sb_sock = peer_b.create_socket().await.expect("sock b");
        sb_sock.bind("127.0.0.1:0".parse().unwrap()).await.unwrap();
        let pb = sb_sock.local_addr().await.unwrap();

        let r1 = relay_rt.create_stream(10).await.expect("r1");
        let r2 = relay_rt.create_stream(20).await.expect("r2");
        r1.relay_to(&r2).expect("relay");
        r2.relay_to(&r1).expect("relay");
        r1.connect(&relay_sock, 1, pa).await.expect("r1 connect");
        r2.connect(&relay_sock, 2, pb).await.expect("r2 connect");

        let s_a = peer_a.create_stream(1).await.expect("s a");
        let mut s_b = peer_b.create_stream(2).await.expect("s b");
        s_a.connect(&sa_sock, 10, relay_listen).await.expect("a");
        s_b.connect(&sb_sock, 20, relay_listen).await.expect("b");

        s_a.write(b"single-sock").await.expect("write");
        let got = tokio::time::timeout(std::time::Duration::from_secs(5), s_b.read())
            .await
            .expect("timeout")
            .expect("read")
            .expect("bytes");
        assert_eq!(got, b"single-sock");
    }

    /// Matches [`relay_encrypted`]: pairing through [`BlindRelayCoordinator`] relays opaque payloads.
    #[tokio::test]
    async fn coordinator_udx_wire_smoke() {
        let relay_rt = Arc::new(UdxRuntime::new().expect("udx relay"));
        let relay_sock = relay_rt.create_socket().await.expect("relay sock");
        relay_sock
            .bind("127.0.0.1:0".parse::<SocketAddr>().expect("relay bind addr"))
            .await
            .expect("relay bind");
        let relay_listen = relay_sock.local_addr().await.expect("relay local");

        let peer_a = UdxRuntime::new().expect("runtime a");
        let peer_b = UdxRuntime::new().expect("runtime b");

        let sa_sock = peer_a.create_socket().await.expect("sock a");
        sa_sock
            .bind("127.0.0.1:0".parse::<SocketAddr>().unwrap())
            .await
            .expect("bind a");
        let pa = sa_sock.local_addr().await.expect("addr a");

        let sb_sock = peer_b.create_socket().await.expect("sock b");
        sb_sock
            .bind("127.0.0.1:0".parse::<SocketAddr>().unwrap())
            .await
            .expect("bind b");
        let pb = sb_sock.local_addr().await.expect("addr b");

        let coord = BlindRelayCoordinator::new(relay_rt.clone(), relay_sock.clone());
        let token = [0x11; 32];
        let (ra, rb) = tokio::join!(
            coord.register_pair_half(token, true, 1, pa),
            coord.register_pair_half(token, false, 2, pb),
        );
        let ra = ra.expect("ini relay-assigned stream id");
        let rb = rb.expect("rsp relay-assigned stream id");
        assert_ne!(ra, rb);

        let s_a = peer_a.create_stream(1).await.expect("stream a");
        let mut s_b = peer_b.create_stream(2).await.expect("stream b");

        let ra_u32 = u32::try_from(ra).expect("relay id fits u32");
        let rb_u32 = u32::try_from(rb).expect("relay id fits u32");

        // Peers use their bound UDP sockets; remote address is relay listen UDP (matches `relay_encrypted`).
        s_a.connect(&sa_sock, ra_u32, relay_listen)
            .await
            .expect("a connect relay");
        s_b.connect(&sb_sock, rb_u32, relay_listen)
            .await
            .expect("b connect relay");

        let payload = b"through-blind-coordinator";
        s_a.write(payload).await.expect("write");
        let got = tokio::time::timeout(std::time::Duration::from_secs(5), s_b.read())
            .await
            .expect("test timed out")
            .expect("read result")
            .expect("received bytes");
        assert_eq!(got, payload);
    }
}

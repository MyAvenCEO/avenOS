//! Dev-only TCP `SyncTransport` for `dev:app2x:mac` — two local app processes
//! converge a spark over `127.0.0.1`, with no DHT and no NAT traversal.
//!
//! This is a deliberate stand-in for the peeroxide mesh transport: "one more
//! `impl SyncTransport` under the already-proven frontier model" (plan §4). It
//! does exactly what the real transport must — establish an authenticated pipe
//! and surface the remote peer identity — minus discovery/holepunch, which a
//! fixed localhost address makes unnecessary for two side-by-side instances.
//!
//! Identity handshake: on connect each side sends its own 16-byte `PeerId`
//! (the engine's peer-connection handle) and learns the remote's. Inbound frames
//! are tagged with `Source::Client(remote)` so the engine attributes them to the
//! registered peer; the app reads [`TcpSyncTransport::remote_client_id`] to
//! register that peer before sync flows.

use async_trait::async_trait;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, mpsc};

use crate::JazzError;
use crate::sync_manager::{PeerId, InboxEntry, Source, SyncPayload};
use crate::sync_targets::SyncTargetId;
use crate::sync_transport::{SyncTransport, decode_length_prefixed, encode_length_prefixed};

/// Which end of the dev pair this instance is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DevRole {
    /// Bind the address and accept one peer (e.g. instance A).
    Listen,
    /// Dial the listener (e.g. instance B).
    Dial,
}

/// A localhost TCP `SyncTransport` connecting exactly two peers.
pub struct TcpSyncTransport {
    writer: Arc<Mutex<OwnedWriteHalf>>,
    inbound: Mutex<mpsc::Receiver<InboxEntry>>,
    remote: PeerId,
}

impl TcpSyncTransport {
    /// Establish the TCP connection + identity handshake, then spawn the read
    /// pump. `local` is this instance's own Groove client id.
    pub async fn connect(role: DevRole, addr: &str, local: PeerId) -> crate::Result<Self> {
        match role {
            DevRole::Listen => {
                let listener = TcpListener::bind(addr).await?;
                Self::accept(listener, local).await
            }
            DevRole::Dial => Self::dial(addr, local).await,
        }
    }

    /// Dial a listener at `addr`.
    pub async fn dial(addr: &str, local: PeerId) -> crate::Result<Self> {
        Self::from_stream(TcpStream::connect(addr).await?, local).await
    }

    /// Accept one peer on a pre-bound listener (lets callers pick an ephemeral port).
    pub async fn accept(listener: TcpListener, local: PeerId) -> crate::Result<Self> {
        let (stream, _peer) = listener.accept().await?;
        Self::from_stream(stream, local).await
    }

    async fn from_stream(stream: TcpStream, local: PeerId) -> crate::Result<Self> {
        stream.set_nodelay(true).ok();
        let (mut read_half, mut write_half) = stream.into_split();

        // Identity handshake — exchange the 32-byte peer pubkey both ways.
        write_half.write_all(&local.0).await?;
        write_half.flush().await?;
        let mut remote_bytes = [0u8; 32];
        read_half.read_exact(&mut remote_bytes).await?;
        let remote = PeerId(remote_bytes);

        let (tx, rx) = mpsc::channel::<InboxEntry>(256);
        tokio::spawn(async move {
            loop {
                // Length-prefixed frames: 4-byte LE length, then the body.
                let mut len_buf = [0u8; 4];
                if read_half.read_exact(&mut len_buf).await.is_err() {
                    break;
                }
                let len = u32::from_le_bytes(len_buf) as usize;
                let mut body = vec![0u8; len];
                if read_half.read_exact(&mut body).await.is_err() {
                    break;
                }
                let mut frame = Vec::with_capacity(4 + len);
                frame.extend_from_slice(&len_buf);
                frame.extend_from_slice(&body);
                match decode_length_prefixed(&frame) {
                    // The frame's `target` is the sender's view of us; the
                    // authoritative source is the handshake-established remote.
                    Ok((_target, payload)) => {
                        let entry = InboxEntry {
                            source: Source::Client(remote),
                            payload,
                        };
                        if tx.send(entry).await.is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        tracing::warn!("dev transport: frame decode failed: {e}");
                        break;
                    }
                }
            }
        });

        Ok(Self {
            writer: Arc::new(Mutex::new(write_half)),
            inbound: Mutex::new(rx),
            remote,
        })
    }

    /// The remote peer's `PeerId` learned during the handshake. The app must
    /// register this as a peer (`ensure_client_as_peer`) before sync flows.
    pub fn remote_client_id(&self) -> PeerId {
        self.remote
    }
}

#[async_trait]
impl SyncTransport for TcpSyncTransport {
    async fn send_to(&self, target: SyncTargetId, payload: SyncPayload) -> crate::Result<()> {
        let bytes = encode_length_prefixed(target, &payload).map_err(JazzError::Sync)?;
        let mut writer = self.writer.lock().await;
        writer.write_all(&bytes).await?;
        writer.flush().await?;
        Ok(())
    }

    async fn recv_inbound(&self) -> Option<InboxEntry> {
        self.inbound.lock().await.recv().await
    }
}

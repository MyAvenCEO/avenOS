//! WebSocket **client** transport — dials a Sprites-hosted aven-server over
//! `wss://<host>/sync` (or `ws://` for local dev) and completes the nonce-bound
//! did:key challenge.
//!
//! Why a second transport beside [`crate::ServerSyncTransport`]: a packaged app
//! reaches the server only over the Sprite's public URL, whose TLS is terminated
//! at the Sprites proxy. So (a) the wire is a WebSocket on :8080, not raw TCP, and
//! (b) the challenge **cannot** bind to the TLS session — the device's TLS ends at
//! the proxy. Replay is instead prevented by the server's single-use, TTL nonce
//! (`channel_binding = ""`, agreed by both ends). The engine's biscuit `may_sync`
//! gate still authorizes every frame, and spark data stays E2E-encrypted.
//!
//! Wire: handshake as three WS **text** messages (`ServerHello`, `ClientAuth`,
//! `AuthResult` as JSON); sync frames as WS **binary** messages, each one a
//! `groove::encode_length_prefixed` frame.

use async_trait::async_trait;
use ed25519_dalek::SigningKey;
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use groove::{
    decode_length_prefixed, encode_length_prefixed, InboxEntry, JazzError, PeerId, Source,
    SyncPayload, SyncTargetId, SyncTransport,
};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex, Notify};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use crate::challenge::{build_message, sign, AuthResult, ClientAuth, ServerHello};
use crate::{P2pError, Result};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Empty channel binding — TLS is proxy-terminated for wss, so the challenge binds
/// to the server nonce only. The server uses the same empty value.
const NO_CHANNEL_BINDING: &str = "";

/// Keepalive cadence: the writer sends a WS Ping this often; the server replies
/// with a Pong, which keeps return traffic flowing on a healthy link.
const PING_INTERVAL: std::time::Duration = std::time::Duration::from_secs(15);

/// If the reader sees NO frame (not even a Pong) for this long, the link is
/// presumed dead and we drop the connection so the supervisor re-dials. Must be a
/// few × `PING_INTERVAL` to tolerate a lost pong. This is the mechanism that breaks
/// the half-open "black-hole" socket left by a mobile Wi-Fi↔5G switch, where no
/// FIN/RST ever arrives and a plain `stream.next()` would block until app restart.
const READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);

/// The **client** WebSocket transport. One connection; `send_to` queues a binary
/// frame, inbound is tagged as coming from the server peer (the star's single hop).
pub struct WsClientTransport {
    out_tx: mpsc::Sender<Message>,
    inbound: Mutex<mpsc::Receiver<InboxEntry>>,
    server_peer: PeerId,
    /// Fired once when the underlying WS connection drops (reader or writer ends).
    /// The app's supervisor awaits this to re-dial + re-attach + re-register.
    disconnected: Arc<Notify>,
}

impl WsClientTransport {
    /// Dial `url` (`wss://host/sync` or `ws://host/sync`), complete the did:key
    /// challenge with `signing_key`, and start the frame pumps.
    pub async fn connect(url: &str, signing_key: SigningKey) -> Result<Self> {
        // The host app's dependency graph can pull more than one rustls
        // CryptoProvider (ring + aws-lc-rs), leaving the process-level default
        // unset — then tokio-tungstenite's wss TLS panics ("Could not
        // automatically determine the process-level CryptoProvider"). Install ring
        // explicitly. Idempotent: returns Err if a default is already set, which we
        // ignore (any installed provider is fine).
        let _ = rustls::crypto::ring::default_provider().install_default();

        let (ws, _resp) = connect_async(url)
            .await
            .map_err(|e| P2pError::Tls(format!("ws connect {url}: {e}")))?;
        let (mut sink, mut stream) = ws.split();

        // did:key challenge over WS messages (nonce-bound; cb = "").
        let hello: ServerHello = recv_json(&mut stream).await?;
        let did = groove::did_key::peer_did_from_ed25519(&signing_key.verifying_key().to_bytes())
            .map_err(|e| P2pError::Handshake(format!("encode our did: {e}")))?;
        let message = build_message(&hello, &did, NO_CHANNEL_BINDING);
        let signature = sign(&signing_key, &message);
        send_json(&mut sink, &ClientAuth { did, signature }).await?;

        let result: AuthResult = recv_json(&mut stream).await?;
        if !result.ok {
            return Err(P2pError::Handshake(
                result.error.unwrap_or_else(|| "server rejected handshake".into()),
            ));
        }
        let server_did = result
            .server_did
            .ok_or_else(|| P2pError::Handshake("server did missing".into()))?;
        let server_peer = PeerId(
            groove::did_key::ed25519_public_from_peer_did(&server_did)
                .map_err(|e| P2pError::Handshake(format!("decode server did: {e}")))?,
        );

        // Connection-drop signal: fired when either pump task ends. The app
        // supervisor awaits it to re-dial (network switch, hibernate, idle close).
        let disconnected = Arc::new(Notify::new());

        // Writer task: drain out_tx → ws sink, plus a periodic keepalive Ping. The
        // Ping elicits a server Pong so the reader's read-timeout keeps seeing
        // traffic on a healthy link; after a network switch the Ping just buffers
        // into the dead socket (no error for a long time), so the actual detection
        // is the reader's job below.
        let (out_tx, mut out_rx) = mpsc::channel::<Message>(256);
        let dc_writer = disconnected.clone();
        tokio::spawn(async move {
            let mut ping = tokio::time::interval(PING_INTERVAL);
            ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    msg = out_rx.recv() => match msg {
                        Some(m) => if sink.send(m).await.is_err() { break },
                        None => break, // transport dropped by the supervisor
                    },
                    _ = ping.tick() => {
                        if sink.send(Message::Ping(Default::default())).await.is_err() { break }
                    }
                }
            }
            let _ = sink.close().await;
            dc_writer.notify_one();
        });

        // Reader task: ws stream → decode binary frames → inbound queue. A read
        // timeout converts a silently-dead link (mobile network switch leaves a
        // half-open black-hole socket with no FIN/RST) into a disconnect so the
        // supervisor re-dials, instead of blocking forever until app restart.
        let (in_tx, in_rx) = mpsc::channel::<InboxEntry>(256);
        let dc_reader = disconnected.clone();
        tokio::spawn(async move {
            loop {
                let next = match tokio::time::timeout(READ_TIMEOUT, stream.next()).await {
                    Ok(n) => n,
                    Err(_elapsed) => {
                        tracing::warn!(
                            "ws transport: no frame for {}s — assuming connection dead",
                            READ_TIMEOUT.as_secs()
                        );
                        break;
                    }
                };
                let Some(next) = next else { break }; // stream ended (clean close)
                let Ok(msg) = next else { break };
                if let Message::Binary(buf) = msg {
                    match decode_length_prefixed(buf.as_ref()) {
                        Ok((_target, payload)) => {
                            let entry = InboxEntry {
                                source: Source::Client(server_peer),
                                payload,
                            };
                            if in_tx.send(entry).await.is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            tracing::warn!("ws transport: frame decode failed: {e}");
                            break;
                        }
                    }
                }
                // text/ping/pong/close after handshake are ignored; a pong just
                // resets the read timeout by virtue of being a received frame.
            }
            dc_reader.notify_one();
        });

        Ok(Self {
            out_tx,
            inbound: Mutex::new(in_rx),
            server_peer,
            disconnected,
        })
    }

    /// The server's authenticated `PeerId` — register it via
    /// `JazzClient::register_peer_sync_client` before sync flows.
    pub fn server_peer_id(&self) -> PeerId {
        self.server_peer
    }

    /// A handle that is notified once the connection drops. The supervisor calls
    /// `transport.disconnected().notified().await` to know when to reconnect.
    pub fn disconnected(&self) -> Arc<Notify> {
        self.disconnected.clone()
    }
}

#[async_trait]
impl SyncTransport for WsClientTransport {
    async fn send_to(&self, target: SyncTargetId, payload: SyncPayload) -> groove::Result<()> {
        let bytes = encode_length_prefixed(target, &payload).map_err(JazzError::Sync)?;
        self.out_tx
            .send(Message::Binary(bytes.into()))
            .await
            .map_err(|e| JazzError::Sync(format!("ws transport send: {e}")))?;
        Ok(())
    }

    async fn recv_inbound(&self) -> Option<InboxEntry> {
        self.inbound.lock().await.recv().await
    }
}

async fn send_json<T: serde::Serialize>(sink: &mut SplitSink<Ws, Message>, msg: &T) -> Result<()> {
    let body =
        serde_json::to_string(msg).map_err(|e| P2pError::Handshake(format!("encode handshake: {e}")))?;
    sink.send(Message::Text(body.into()))
        .await
        .map_err(|e| P2pError::Handshake(format!("ws send handshake: {e}")))?;
    Ok(())
}

async fn recv_json<T: serde::de::DeserializeOwned>(stream: &mut SplitStream<Ws>) -> Result<T> {
    loop {
        match stream.next().await {
            Some(Ok(Message::Text(t))) => {
                return serde_json::from_str(t.as_ref())
                    .map_err(|e| P2pError::Handshake(format!("decode handshake: {e}")));
            }
            Some(Ok(Message::Binary(b))) => {
                return serde_json::from_slice(b.as_ref())
                    .map_err(|e| P2pError::Handshake(format!("decode handshake: {e}")));
            }
            Some(Ok(_)) => continue, // ping/pong/close before the JSON arrives
            Some(Err(e)) => return Err(P2pError::Handshake(format!("ws recv handshake: {e}"))),
            None => return Err(P2pError::Handshake("ws closed during handshake".into())),
        }
    }
}

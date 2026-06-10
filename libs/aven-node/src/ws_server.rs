//! WebSocket sync transport for the hosted relay.
//!
//! Serves `/sync` on the Sprite's public :8080 (TLS terminated at the Sprites
//! proxy), runs the nonce-bound did:key challenge per connection (`channel_binding
//! = ""`, since there is no in-process TLS to bind to), then routes length-prefixed
//! frames by `PeerId`. It is the server analogue of `aven_p2p::WsClientTransport`
//! and implements `groove::SyncTransport`, so the engine wiring is unchanged.
//!
//! Each connection is owned by a single task that `select!`s between the engine's
//! per-peer outbound queue and inbound WS messages — no stream split needed.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use axum::extract::ws::{Message, WebSocket};
use groove::{
    decode_length_prefixed, encode_length_prefixed, InboxEntry, JazzError, PeerId, Source,
    SyncPayload, SyncTargetId, SyncTransport,
};
use tokio::sync::{mpsc, Mutex};

use aven_p2p::challenge::{
    build_message, is_expired, random_nonce_b64, unix_now_secs, verify, AuthResult, ChallengeParams,
    ClientAuth, ServerHello, CHALLENGE_TTL_SECS,
};

/// No channel binding: TLS is proxy-terminated, so the challenge binds to the
/// server nonce only. Must match `aven_p2p::ws_client` (also "").
const NO_CHANNEL_BINDING: &str = "";

/// One WS listener, N authenticated clients. `send_to` routes to the target
/// connection's queue; all inbound frames surface on one queue.
pub struct WsServerListener {
    registry: Mutex<HashMap<PeerId, mpsc::Sender<Message>>>,
    inbound_tx: mpsc::Sender<InboxEntry>,
    inbound_rx: Mutex<mpsc::Receiver<InboxEntry>>,
    peers_tx: mpsc::Sender<PeerId>,
    params: ChallengeParams,
    server_did: String,
}

impl WsServerListener {
    /// Build the listener + a stream of newly-authenticated peers (the host loop
    /// registers each via `register_peer_sync_client`).
    pub fn new(params: ChallengeParams, server_did: String) -> (Arc<Self>, mpsc::Receiver<PeerId>) {
        let (inbound_tx, inbound_rx) = mpsc::channel(1024);
        let (peers_tx, peers_rx) = mpsc::channel(64);
        let this = Arc::new(Self {
            registry: Mutex::new(HashMap::new()),
            inbound_tx,
            inbound_rx: Mutex::new(inbound_rx),
            peers_tx,
            params,
            server_did,
        });
        (this, peers_rx)
    }

    /// Drive one upgraded WS connection: handshake → register → pump (until close).
    pub async fn accept(self: Arc<Self>, ws: WebSocket) {
        if let Err(e) = self.accept_inner(ws).await {
            tracing::warn!("aven-node ws connection dropped: {e}");
        }
    }

    async fn accept_inner(self: &Arc<Self>, mut ws: WebSocket) -> Result<(), String> {
        // did:key challenge: send ServerHello, receive ClientAuth, verify, reply.
        let now = unix_now_secs();
        let hello = ServerHello {
            domain: self.params.domain.clone(),
            uri: self.params.uri.clone(),
            network: self.params.network_seed.clone(),
            nonce: random_nonce_b64(),
            issued_at: now.to_string(),
            expiration_time: (now + CHALLENGE_TTL_SECS).to_string(),
        };
        send_json(&mut ws, &hello).await?;
        let auth: ClientAuth = recv_json(&mut ws).await?;
        let verdict = verify_client(&hello, &auth);
        let result = AuthResult {
            ok: verdict.is_ok(),
            error: verdict.as_ref().err().cloned(),
            server_did: Some(self.server_did.clone()),
        };
        send_json(&mut ws, &result).await?;
        let peer = verdict?;

        // Register an outbound queue for the engine to route frames into.
        let (out_tx, mut out_rx) = mpsc::channel::<Message>(256);
        self.registry.lock().await.insert(peer, out_tx);
        let _ = self.peers_tx.send(peer).await;
        tracing::info!(%peer, "aven-node ws peer authenticated");

        // One task owns the socket: outbound (engine → ws) and inbound (ws → engine).
        let inbound_tx = self.inbound_tx.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    out = out_rx.recv() => match out {
                        Some(m) => if ws.send(m).await.is_err() { break },
                        None => break,
                    },
                    inb = ws.recv() => match inb {
                        Some(Ok(Message::Binary(buf))) => match decode_length_prefixed(buf.as_ref()) {
                            Ok((_target, payload)) => {
                                let entry = InboxEntry { source: Source::Client(peer), payload };
                                if inbound_tx.send(entry).await.is_err() { break }
                            }
                            Err(e) => { tracing::warn!("ws frame decode failed: {e}"); break }
                        },
                        // Reply to the client's keepalive Ping so its read-timeout
                        // sees return traffic on a healthy link (axum does not
                        // auto-pong). This is what lets the client distinguish a live
                        // idle link from a dead one after a mobile network switch.
                        Some(Ok(Message::Ping(p))) => if ws.send(Message::Pong(p)).await.is_err() { break },
                        Some(Ok(_)) => {} // text/pong/close after handshake
                        Some(Err(_)) | None => break,
                    },
                }
            }
            // Intentionally NOT removing the registry entry here: on a network
            // switch the client reconnects with a fresh connection that overwrites
            // this peer's entry via `accept`'s insert. Removing on this (possibly
            // long-lived half-open) reader could clobber that newer entry — so we
            // leave it; a stale sender just fails `send_to` harmlessly until the
            // reconnect replaces it. (Follow-up: generation-tag entries to prune
            // peers that disconnect and never return.)
        });
        Ok(())
    }
}

/// Verify the client's challenge response; returns the proven `PeerId`.
fn verify_client(hello: &ServerHello, auth: &ClientAuth) -> Result<PeerId, String> {
    if is_expired(hello) {
        return Err("challenge expired".into());
    }
    let pubkey = groove::did_key::ed25519_public_from_signer_did(&auth.did)?;
    let message = build_message(hello, &auth.did, NO_CHANNEL_BINDING);
    verify(&pubkey, &message, &auth.signature)?;
    Ok(PeerId(pubkey))
}

#[async_trait]
impl SyncTransport for WsServerListener {
    async fn send_to(&self, target: SyncTargetId, payload: SyncPayload) -> groove::Result<()> {
        let peer = match &target {
            SyncTargetId::Client(p) => *p,
            SyncTargetId::SignerDid(did) => PeerId(
                groove::did_key::ed25519_public_from_signer_did(did)
                    .map_err(|e| JazzError::Sync(format!("route {did}: {e}")))?,
            ),
        };
        let tx = { self.registry.lock().await.get(&peer).cloned() };
        let Some(tx) = tx else {
            // Peer not connected — drop (frontier re-announces on reconnect).
            return Ok(());
        };
        let bytes = encode_length_prefixed(target, &payload).map_err(JazzError::Sync)?;
        tx.send(Message::Binary(bytes.into()))
            .await
            .map_err(|e| JazzError::Sync(format!("ws fanout: {e}")))?;
        Ok(())
    }

    async fn recv_inbound(&self) -> Option<InboxEntry> {
        self.inbound_rx.lock().await.recv().await
    }
}

async fn send_json<T: serde::Serialize>(ws: &mut WebSocket, msg: &T) -> Result<(), String> {
    let body = serde_json::to_string(msg).map_err(|e| format!("encode handshake: {e}"))?;
    ws.send(Message::Text(body.into()))
        .await
        .map_err(|e| format!("ws send handshake: {e}"))
}

async fn recv_json<T: serde::de::DeserializeOwned>(ws: &mut WebSocket) -> Result<T, String> {
    loop {
        match ws.recv().await {
            Some(Ok(Message::Text(t))) => {
                return serde_json::from_str(t.as_str()).map_err(|e| format!("decode handshake: {e}"))
            }
            Some(Ok(Message::Binary(b))) => {
                return serde_json::from_slice(b.as_ref()).map_err(|e| format!("decode handshake: {e}"))
            }
            Some(Ok(_)) => continue, // ping/pong before the JSON arrives
            Some(Err(e)) => return Err(format!("ws recv handshake: {e}")),
            None => return Err("ws closed during handshake".into()),
        }
    }
}

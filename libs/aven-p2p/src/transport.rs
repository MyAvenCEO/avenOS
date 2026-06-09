//! The two `groove::SyncTransport` implementations over authenticated TLS.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use ed25519_dalek::SigningKey;
use groove::{
    decode_length_prefixed, encode_length_prefixed, InboxEntry, JazzError, PeerId, Source,
    SyncPayload, SyncTargetId, SyncTransport,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};
use tokio_rustls::rustls::pki_types::ServerName;

use crate::challenge::{
    build_message, is_expired, random_nonce_b64, sign, unix_now_secs, verify, AuthResult,
    ChallengeParams, ClientAuth, ServerHello, CHALLENGE_TTL_SECS,
};
use crate::tls::{channel_binding_b64, ServerTls, ServerTrust, CB_LABEL};
use crate::{P2pError, Result};

/// SNI name used on dial — irrelevant to trust (we pin the cert, §tls), but TLS
/// requires a syntactically valid name.
const SNI: &str = "aven-node";
/// Max handshake-message size (the sync frames have their own larger limit).
const MAX_HANDSHAKE_BYTES: usize = 64 * 1024;

fn peer_from_did(did: &str) -> Result<PeerId> {
    let pk = groove::did_key::ed25519_public_from_peer_did(did)
        .map_err(|e| P2pError::Handshake(format!("decode did {did}: {e}")))?;
    Ok(PeerId(pk))
}

// ── length-prefixed JSON handshake framing (crate-private so tests can forge) ──

async fn write_json<W, T>(w: &mut W, msg: &T) -> Result<()>
where
    W: AsyncWriteExt + Unpin,
    T: serde::Serialize,
{
    let body = serde_json::to_vec(msg)
        .map_err(|e| P2pError::Handshake(format!("encode handshake: {e}")))?;
    let len: u32 = body
        .len()
        .try_into()
        .map_err(|_| P2pError::Handshake("handshake too large".into()))?;
    w.write_all(&len.to_le_bytes()).await?;
    w.write_all(&body).await?;
    w.flush().await?;
    Ok(())
}

async fn read_json<R, T>(r: &mut R) -> Result<T>
where
    R: AsyncReadExt + Unpin,
    T: serde::de::DeserializeOwned,
{
    let mut len_buf = [0u8; 4];
    r.read_exact(&mut len_buf).await?;
    let len = u32::from_le_bytes(len_buf) as usize;
    if len > MAX_HANDSHAKE_BYTES {
        return Err(P2pError::Handshake(format!("handshake frame too large: {len}")));
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).await?;
    serde_json::from_slice(&body).map_err(|e| P2pError::Handshake(format!("decode handshake: {e}")))
}

/// Read one length-prefixed sync frame; returns `None` on clean EOF.
async fn read_frame<R: AsyncReadExt + Unpin>(r: &mut R) -> Option<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    r.read_exact(&mut len_buf).await.ok()?;
    let len = u32::from_le_bytes(len_buf) as usize;
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).await.ok()?;
    let mut frame = Vec::with_capacity(4 + len);
    frame.extend_from_slice(&len_buf);
    frame.extend_from_slice(&body);
    Some(frame)
}

// ────────────────────────────── client side ──────────────────────────────

/// The **client** transport: a device dials the aven over TLS, proves its DID,
/// then syncs through it. One connection — `send_to` writes the frame; inbound
/// is tagged as coming from the server peer (the star's single hop).
pub struct ServerSyncTransport {
    writer: Arc<Mutex<tokio::io::WriteHalf<tokio_rustls::client::TlsStream<TcpStream>>>>,
    inbound: Mutex<mpsc::Receiver<InboxEntry>>,
    server_peer: PeerId,
}

impl ServerSyncTransport {
    /// Dial `addr`, verify the server against `trust`, complete the did:key
    /// challenge with `signing_key`, and start the frame pump.
    pub async fn dial(
        addr: &str,
        trust: ServerTrust,
        signing_key: SigningKey,
    ) -> Result<Self> {
        let connector = trust.connector()?;
        let tcp = TcpStream::connect(addr).await?;
        tcp.set_nodelay(true).ok();
        let server_name =
            ServerName::try_from(SNI).map_err(|e| P2pError::Tls(format!("server name: {e}")))?;
        let mut tls = connector
            .connect(server_name, tcp)
            .await
            .map_err(|e| P2pError::Tls(format!("tls connect: {e}")))?;

        // Channel binding from the live TLS session (must read before split).
        let cb = {
            let (_io, conn) = tls.get_ref();
            let out = conn
                .export_keying_material([0u8; 32], CB_LABEL, None)
                .map_err(|e| P2pError::Handshake(format!("channel binding: {e}")))?;
            channel_binding_b64(out)
        };

        // did:key challenge: receive nonce, sign the rebuilt message, send proof.
        let hello: ServerHello = read_json(&mut tls).await?;
        let did = groove::did_key::peer_did_from_ed25519(&signing_key.verifying_key().to_bytes())
            .map_err(|e| P2pError::Handshake(format!("encode our did: {e}")))?;
        // Raw-TLS path: the anti-relay anchor is the real TLS-exporter channel binding `cb`,
        // so the wss mutual-handshake client nonce is unused here (empty).
        let message = build_message(&hello, &did, &cb, "");
        let signature = sign(&signing_key, &message);
        write_json(
            &mut tls,
            &ClientAuth {
                did,
                signature,
                client_nonce: String::new(),
            },
        )
        .await?;

        let result: AuthResult = read_json(&mut tls).await?;
        if !result.ok {
            return Err(P2pError::Handshake(
                result.error.unwrap_or_else(|| "server rejected handshake".into()),
            ));
        }
        let server_did = result
            .server_did
            .ok_or_else(|| P2pError::Handshake("server did missing".into()))?;
        let server_peer = peer_from_did(&server_did)?;

        let (read_half, write_half) = tokio::io::split(tls);
        let (tx, rx) = mpsc::channel::<InboxEntry>(256);
        spawn_read_pump(read_half, tx, server_peer);

        Ok(Self {
            writer: Arc::new(Mutex::new(write_half)),
            inbound: Mutex::new(rx),
            server_peer,
        })
    }

    /// The server's authenticated `PeerId` — register it via
    /// `JazzClient::register_peer_sync_client` before sync flows.
    pub fn server_peer_id(&self) -> PeerId {
        self.server_peer
    }
}

#[async_trait]
impl SyncTransport for ServerSyncTransport {
    async fn send_to(&self, target: SyncTargetId, payload: SyncPayload) -> groove::Result<()> {
        let bytes = encode_length_prefixed(target, &payload)
            .map_err(|e| JazzError::Sync(e))?;
        let mut w = self.writer.lock().await;
        w.write_all(&bytes)
            .await
            .map_err(|e| JazzError::Sync(format!("server transport write: {e}")))?;
        w.flush()
            .await
            .map_err(|e| JazzError::Sync(format!("server transport flush: {e}")))?;
        Ok(())
    }

    async fn recv_inbound(&self) -> Option<InboxEntry> {
        self.inbound.lock().await.recv().await
    }
}

// ────────────────────────────── server side ──────────────────────────────

type WriteHalf = tokio::io::WriteHalf<tokio_rustls::server::TlsStream<TcpStream>>;
type Registry = Arc<Mutex<HashMap<PeerId, Arc<Mutex<WriteHalf>>>>>;

/// The **server** transport: one TLS listener, N authenticated clients. Routes
/// outbound frames to the target connection; surfaces all inbound on one queue.
pub struct ServerListener {
    registry: Registry,
    inbound: Mutex<mpsc::Receiver<InboxEntry>>,
}

impl ServerListener {
    /// Bind a TLS listener on `bind_addr` and start accepting. Returns the
    /// transport plus a stream of newly-authenticated peers (the server's host
    /// loop registers each via `register_peer_sync_client`).
    pub async fn serve(
        bind_addr: &str,
        server_tls: ServerTls,
        identity: SigningKey,
        params: ChallengeParams,
    ) -> Result<(Arc<Self>, mpsc::Receiver<PeerId>)> {
        let acceptor = server_tls.acceptor()?;
        let listener = TcpListener::bind(bind_addr).await?;
        let server_did =
            groove::did_key::peer_did_from_ed25519(&identity.verifying_key().to_bytes())
                .map_err(|e| P2pError::Config(format!("server did: {e}")))?;

        let registry: Registry = Arc::new(Mutex::new(HashMap::new()));
        let (inbound_tx, inbound_rx) = mpsc::channel::<InboxEntry>(1024);
        let (peers_tx, peers_rx) = mpsc::channel::<PeerId>(64);

        let this = Arc::new(Self {
            registry: registry.clone(),
            inbound: Mutex::new(inbound_rx),
        });

        tokio::spawn(async move {
            loop {
                let (tcp, addr) = match listener.accept().await {
                    Ok(pair) => pair,
                    Err(e) => {
                        tracing::warn!("aven-node accept failed: {e}");
                        continue;
                    }
                };
                tcp.set_nodelay(true).ok();
                let acceptor = acceptor.clone();
                let registry = registry.clone();
                let inbound_tx = inbound_tx.clone();
                let peers_tx = peers_tx.clone();
                let params = params.clone();
                let server_did = server_did.clone();
                tokio::spawn(async move {
                    if let Err(e) =
                        accept_one(tcp, acceptor, registry, inbound_tx, peers_tx, params, server_did)
                            .await
                    {
                        tracing::warn!("aven-node connection {addr} dropped: {e}");
                    }
                });
            }
        });

        Ok((this, peers_rx))
    }
}

#[allow(clippy::too_many_arguments)]
async fn accept_one(
    tcp: TcpStream,
    acceptor: tokio_rustls::TlsAcceptor,
    registry: Registry,
    inbound_tx: mpsc::Sender<InboxEntry>,
    peers_tx: mpsc::Sender<PeerId>,
    params: ChallengeParams,
    server_did: String,
) -> Result<()> {
    let mut tls = acceptor
        .accept(tcp)
        .await
        .map_err(|e| P2pError::Tls(format!("tls accept: {e}")))?;

    let cb = {
        let (_io, conn) = tls.get_ref();
        let out = conn
            .export_keying_material([0u8; 32], CB_LABEL, None)
            .map_err(|e| P2pError::Handshake(format!("channel binding: {e}")))?;
        channel_binding_b64(out)
    };

    let now = unix_now_secs();
    let hello = ServerHello {
        domain: params.domain.clone(),
        uri: params.uri.clone(),
        network: params.network_seed.clone(),
        nonce: random_nonce_b64(),
        issued_at: now.to_string(),
        expiration_time: (now + CHALLENGE_TTL_SECS).to_string(),
    };
    write_json(&mut tls, &hello).await?;

    let auth: ClientAuth = read_json(&mut tls).await?;
    let verdict = verify_client(&hello, &auth, &cb);
    let result = AuthResult {
        ok: verdict.is_ok(),
        error: verdict.as_ref().err().cloned(),
        server_did: Some(server_did),
        // Raw-TLS path is relay-resistant via the exporter channel binding, so no
        // application-layer server attestation is needed (that is the wss path's mechanism).
        signature: None,
    };
    write_json(&mut tls, &result).await?;
    let peer = verdict.map_err(P2pError::Handshake)?;

    let (read_half, write_half) = tokio::io::split(tls);
    registry
        .lock()
        .await
        .insert(peer, Arc::new(Mutex::new(write_half)));
    spawn_read_pump(read_half, inbound_tx, peer);
    let _ = peers_tx.send(peer).await;
    tracing::info!(%peer, "aven-node peer authenticated");
    Ok(())
}

/// Verify the client's challenge response; returns the proven `PeerId`.
fn verify_client(hello: &ServerHello, auth: &ClientAuth, cb: &str) -> std::result::Result<PeerId, String> {
    if is_expired(hello) {
        return Err("challenge expired".into());
    }
    let pubkey = groove::did_key::ed25519_public_from_peer_did(&auth.did)?;
    let message = build_message(hello, &auth.did, cb, &auth.client_nonce);
    verify(&pubkey, &message, &auth.signature)?;
    Ok(PeerId(pubkey))
}

#[async_trait]
impl SyncTransport for ServerListener {
    async fn send_to(&self, target: SyncTargetId, payload: SyncPayload) -> groove::Result<()> {
        let peer = match &target {
            SyncTargetId::Client(p) => *p,
            SyncTargetId::PeerDid(did) => peer_from_did(did)
                .map_err(|e| JazzError::Sync(format!("route {did}: {e}")))?,
        };
        let conn = {
            let reg = self.registry.lock().await;
            reg.get(&peer).cloned()
        };
        let Some(conn) = conn else {
            // Peer not connected — drop (the frontier re-announces on reconnect).
            tracing::debug!(%peer, "send_to: peer not connected; dropping frame");
            return Ok(());
        };
        let bytes = encode_length_prefixed(target, &payload)
            .map_err(|e| JazzError::Sync(e))?;
        let mut w = conn.lock().await;
        w.write_all(&bytes)
            .await
            .map_err(|e| JazzError::Sync(format!("server fanout write: {e}")))?;
        w.flush()
            .await
            .map_err(|e| JazzError::Sync(format!("server fanout flush: {e}")))?;
        Ok(())
    }

    async fn recv_inbound(&self) -> Option<InboxEntry> {
        self.inbound.lock().await.recv().await
    }
}

// ──────────────────────────────── shared ─────────────────────────────────

/// Spawn the read pump: decode frames, tag with the authenticated `Source`,
/// push to the inbound queue. Identical on both ends (the dev-transport half).
fn spawn_read_pump<R>(mut read_half: R, tx: mpsc::Sender<InboxEntry>, remote: PeerId)
where
    R: AsyncReadExt + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        while let Some(frame) = read_frame(&mut read_half).await {
            match decode_length_prefixed(&frame) {
                // The authoritative source is the handshake-proven remote, not
                // the frame's self-reported target (which we ignore, as dev does).
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
                    tracing::warn!("server transport: frame decode failed: {e}");
                    break;
                }
            }
        }
    });
}

#[cfg(test)]
mod tls_did_challenge {
    use super::*;
    use groove::sync_manager::SyncPayload;

    fn test_params() -> ChallengeParams {
        ChallengeParams::new("aven.test", "https://aven.test", "testnet")
    }

    fn ping() -> SyncPayload {
        // A cheap, always-constructible payload to prove a frame crosses.
        SyncPayload::FrontierAnnounce {
            resource: "spark:test".into(),
            heads: vec![],
        }
    }

    /// Bind an ephemeral port, learn its address, then hand it to `serve`.
    async fn free_addr() -> String {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let a = l.local_addr().unwrap();
        drop(l);
        a.to_string()
    }

    #[tokio::test]
    async fn happy_path_authenticated_routing() {
        let addr = free_addr().await;
        let server_tls = crate::tls::generate_self_signed(vec!["localhost".into()]).unwrap();
        let identity = SigningKey::from_bytes(&[9u8; 32]);
        let (server, mut peers) = ServerListener::serve(
            &addr,
            server_tls.clone(),
            identity,
            test_params(),
        )
        .await
        .unwrap();

        let key_a = SigningKey::from_bytes(&[1u8; 32]);
        let key_b = SigningKey::from_bytes(&[2u8; 32]);
        let peer_b = PeerId(key_b.verifying_key().to_bytes());

        let a = ServerSyncTransport::dial(&addr, server_tls.trust(), key_a)
            .await
            .expect("A dials");
        let b = ServerSyncTransport::dial(&addr, server_tls.trust(), key_b)
            .await
            .expect("B dials");

        // Two peers authenticated.
        let p1 = peers.recv().await.unwrap();
        let p2 = peers.recv().await.unwrap();
        assert!([p1, p2].contains(&PeerId(SigningKey::from_bytes(&[1u8; 32]).verifying_key().to_bytes())));

        // A sends to the server → server surfaces it as Source::Client(A).
        a.send_to(SyncTargetId::Client(peer_b), ping()).await.unwrap();
        let entry = tokio::time::timeout(std::time::Duration::from_secs(2), server.recv_inbound())
            .await
            .expect("server recv timeout")
            .expect("server inbound");
        assert_eq!(entry.source, Source::Client(PeerId(SigningKey::from_bytes(&[1u8; 32]).verifying_key().to_bytes())));

        // Server routes a frame to B by PeerId → B receives it.
        server.send_to(SyncTargetId::Client(peer_b), ping()).await.unwrap();
        let got = tokio::time::timeout(std::time::Duration::from_secs(2), b.recv_inbound())
            .await
            .expect("B recv timeout");
        assert!(got.is_some(), "B should receive the routed frame");
    }

    #[tokio::test]
    async fn untrusted_server_cert_rejected() {
        let addr = free_addr().await;
        let server_tls = crate::tls::generate_self_signed(vec!["localhost".into()]).unwrap();
        let identity = SigningKey::from_bytes(&[9u8; 32]);
        let (_server, _peers) =
            ServerListener::serve(&addr, server_tls, identity, test_params())
                .await
                .unwrap();

        // Dial with a DIFFERENT (untrusted) pinned cert.
        let other = crate::tls::generate_self_signed(vec!["localhost".into()]).unwrap();
        let key_a = SigningKey::from_bytes(&[1u8; 32]);
        let res = ServerSyncTransport::dial(&addr, other.trust(), key_a).await;
        assert!(res.is_err(), "dial must fail against an untrusted server cert");
    }

    #[tokio::test]
    async fn forged_did_rejected() {
        let addr = free_addr().await;
        let server_tls = crate::tls::generate_self_signed(vec!["localhost".into()]).unwrap();
        let identity = SigningKey::from_bytes(&[9u8; 32]);
        let (_server, _peers) =
            ServerListener::serve(&addr, server_tls.clone(), identity, test_params())
                .await
                .unwrap();

        // A malicious client: sign with key_a but CLAIM key_c's DID.
        let connector = server_tls.trust().connector().unwrap();
        let tcp = TcpStream::connect(&addr).await.unwrap();
        let server_name = ServerName::try_from(SNI).unwrap();
        let mut tls = connector.connect(server_name, tcp).await.unwrap();
        let cb = {
            let (_io, conn) = tls.get_ref();
            let out = conn.export_keying_material([0u8; 32], CB_LABEL, None).unwrap();
            channel_binding_b64(out)
        };
        let hello: ServerHello = read_json(&mut tls).await.unwrap();
        let key_a = SigningKey::from_bytes(&[1u8; 32]);
        let forged_did =
            groove::did_key::peer_did_from_ed25519(&SigningKey::from_bytes(&[7u8; 32]).verifying_key().to_bytes())
                .unwrap();
        // Sign the message that claims the forged DID, but with key_a's key.
        let message = build_message(&hello, &forged_did, &cb, "");
        let signature = sign(&key_a, &message);
        write_json(
            &mut tls,
            &ClientAuth { did: forged_did, signature, client_nonce: String::new() },
        )
        .await
        .unwrap();
        let result: AuthResult = read_json(&mut tls).await.unwrap();
        assert!(!result.ok, "server must reject a signature that does not match the claimed DID");
    }
}

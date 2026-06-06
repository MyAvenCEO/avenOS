//! aven-server — a headless, durable **blind replica** aven.
//!
//! One process: an HTTP + WebSocket server on :8080 (TLS terminated at the Sprites
//! proxy) serving `GET /health` and `GET /sync` — the nonce-bound did:key sync
//! transport (`ws_server`) — feeding a full groove engine on **RocksDB** with the
//! real schema. A peer holding a `replicate` grant ships this server its spark's
//! encrypted batches; it stores them durably and forwards them, but holds **no
//! keyshares**, so everything it mirrors stays ciphertext it cannot decrypt.
//!
//! Reachability: the public Sprite URL routes to :8080, so devices dial
//! `wss://<sprite>.sprites.app/sync` with no `sprite proxy`. TLS is the proxy's;
//! the challenge is nonce-bound (no channel binding). Config is all env; the
//! identity seed is a Sprite secret; `AVEN_SERVER_DATA_DIR` is the persistent path.

mod aven_ceo;
mod ws_server;

use std::sync::Arc;

use aven_p2p::ChallengeParams;
use axum::extract::{ws::WebSocketUpgrade, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use ed25519_dalek::SigningKey;
use groove::{AppContext, AppId, JazzClient, PeerId};
use tokio::signal::unix::{signal, SignalKind};

use ws_server::WsServerListener;

struct Config {
    http_bind: String,
    domain: String,
    uri: String,
    network_seed: String,
    seed: Option<[u8; 32]>,
}

impl Config {
    fn from_env() -> Self {
        let var = |k: &str| std::env::var(k).ok().filter(|s| !s.is_empty());
        let seed = var("AVEN_SERVER_SEED").and_then(|h| {
            let bytes = hex::decode(h.trim()).ok()?;
            let arr: [u8; 32] = bytes.try_into().ok()?;
            Some(arr)
        });
        Self {
            // The HTTP+WS server binds the Sprites-routed port (8080).
            http_bind: var("AVEN_SERVER_HEALTH_BIND").unwrap_or_else(|| "0.0.0.0:8080".into()),
            domain: var("AVEN_SERVER_DOMAIN").unwrap_or_else(|| "aven.local".into()),
            uri: var("AVEN_SERVER_URI").unwrap_or_else(|| "https://aven.local".into()),
            network_seed: var("AVEN_SERVER_NETWORK_SEED").unwrap_or_else(|| "testnet".into()),
            seed,
        }
    }
}

fn load_identity(cfg: &Config) -> SigningKey {
    match cfg.seed {
        Some(seed) => SigningKey::from_bytes(&seed),
        None => {
            tracing::warn!(
                "AVEN_SERVER_SEED unset — generated an ephemeral identity (set AVEN_SERVER_SEED \
                 for a stable DID across restarts)"
            );
            SigningKey::generate(&mut rand::rngs::OsRng)
        }
    }
}

async fn health() -> &'static str {
    "ok"
}

async fn sync_handler(
    ws: WebSocketUpgrade,
    State(listener): State<Arc<WsServerListener>>,
) -> Response {
    ws.on_upgrade(move |socket| async move { listener.accept(socket).await })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let cfg = Config::from_env();
    let identity = load_identity(&cfg);
    let server_peer = PeerId(identity.verifying_key().to_bytes());
    let server_did = groove::did_key::peer_did_from_ed25519(&server_peer.0)
        .map_err(|e| format!("server did: {e}"))?;
    tracing::info!(%server_did, "aven-server identity");

    // S.2 — a biscuit capability vault rooted in the server's key. The server is
    // the sole author/owner of the well-known avenCEO control spark; it will mint
    // its genesis (S.3) and auto-grant the first connecting peer admin (S.4). See
    // docs/ServerRootedAvenCeoPlan.md.
    let server_vault = aven_caps::caps::build_vault_from_signing_key(&identity)
        .map_err(|e| format!("server cap vault: {e}"))?;
    let avenceo_id = aven_caps::caps::aven_ceo_spark_id(&cfg.network_seed);
    tracing::info!(
        %avenceo_id,
        owner_did = %server_vault.peer_did,
        "avenCEO control spark — server is the owner"
    );

    let params = ChallengeParams::new(cfg.domain.clone(), cfg.uri.clone(), cfg.network_seed.clone());
    let (listener, mut new_peers) = WsServerListener::new(params, server_did);

    // Durable blind replica: a full RocksDB engine on the REAL schema, wired to the
    // WS listener. The real schema is required so the engine can persist & re-ship
    // replicated row batches; it holds NO keyshares, so every batch stays ciphertext.
    let schema =
        avenos_schema_hash::embedded_schema().map_err(|e| format!("load schema: {e}"))?;
    let data_dir = std::env::var("AVEN_SERVER_DATA_DIR")
        .ok()
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("aven-server-data"));
    tracing::info!(data_dir = %data_dir.display(), "durable storage (RocksDB)");
    let ctx = AppContext {
        app_id: AppId::from_name("ceo.aven.os"),
        client_id: Some(server_peer),
        schema,
        data_dir,
        live_schemas: vec![],
    };

    // Self-healing open: the local RocksDB is a re-pullable ciphertext cache, so if
    // it is ever unreadable (a hard crash that left it unfinalized) reset and re-open
    // rather than crash-loop; missing batches re-sync from peers. The graceful
    // shutdown below makes this path rare.
    let engine: Arc<JazzClient> =
        match JazzClient::connect_with_sync_transport(ctx.clone(), listener.clone(), None).await {
            Ok(engine) => Arc::new(engine),
            Err(e) if store_is_corrupt(&e) => {
                tracing::warn!(
                    error = %e,
                    data_dir = %ctx.data_dir.display(),
                    "blind replica store unreadable — resetting and re-pulling from peers"
                );
                let _ = std::fs::remove_dir_all(&ctx.data_dir);
                Arc::new(JazzClient::connect_with_sync_transport(ctx, listener.clone(), None).await?)
            }
            Err(e) => return Err(e.into()),
        };
    tracing::info!("blind replica engine connected (RocksDB, real schema)");

    // S.3 — the server is the avenCEO owner: mint its genesis on startup (idempotent).
    if let Err(e) = aven_ceo::ensure_avenceo_owned(&engine, &server_vault, &identity, avenceo_id).await {
        tracing::warn!("avenCEO mint: {e}");
    }

    // Register each newly-authenticated peer; hold the handle so we can stop it on
    // shutdown and reclaim its engine clone (to finalize RocksDB via sole ownership).
    let engine_for_peers = engine.clone();
    let peer_task = tokio::spawn(async move {
        while let Some(peer) = new_peers.recv().await {
            if let Err(e) = engine_for_peers.register_peer_sync_client(peer) {
                tracing::warn!(%peer, "register peer: {e}");
            }
        }
    });

    // One HTTP server on :8080: /health + /sync (WS). Devices reach /sync via the
    // public Sprite URL (proxy-terminated TLS).
    let app = Router::new()
        .route("/health", get(health))
        .route("/sync", get(sync_handler))
        .with_state(listener.clone());
    let tcp = tokio::net::TcpListener::bind(&cfg.http_bind).await?;
    tracing::info!(bind = %cfg.http_bind, "http+ws sync server listening (/health, /sync)");

    // Graceful shutdown: Sprites sends SIGTERM on hibernate/stop/redeploy. Catching
    // it (rather than being killed) lets axum drain, then we finalize RocksDB so the
    // next boot reopens cleanly (orphan-WAL corruption otherwise — see git history).
    let shutdown = async {
        let mut sigterm = signal(SignalKind::terminate()).expect("install SIGTERM handler");
        let mut sigint = signal(SignalKind::interrupt()).expect("install SIGINT handler");
        tokio::select! {
            _ = sigterm.recv() => tracing::info!("SIGTERM received — shutting down"),
            _ = sigint.recv() => tracing::info!("SIGINT received — shutting down"),
        }
    };
    axum::serve(tcp, app).with_graceful_shutdown(shutdown).await?;

    // Stop the peer task, take sole ownership, run RocksDB Close via shutdown(self).
    tracing::info!("finalizing RocksDB store…");
    peer_task.abort();
    let _ = peer_task.await;
    match Arc::try_unwrap(engine) {
        Ok(client) => {
            if let Err(e) = client.shutdown().await {
                tracing::warn!("graceful shutdown: {e}");
            }
        }
        Err(still_shared) => {
            tracing::warn!("engine still shared at shutdown; flushing WAL only");
            let _ = still_shared.flush_peer_sync().await;
        }
    }
    tracing::info!("clean shutdown complete (RocksDB finalized)");
    Ok(())
}

/// A storage-open failure a blind replica can recover from by resetting its
/// (re-pullable) cache — chiefly a RocksDB store left unfinalized by a hard crash.
fn store_is_corrupt(e: &impl std::fmt::Display) -> bool {
    let m = e.to_string();
    m.contains("Corruption") || m.contains("wal_dir") || m.contains("rocksdb open")
}

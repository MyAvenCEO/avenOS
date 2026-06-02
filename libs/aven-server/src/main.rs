//! aven-server — a headless, durable **blind replica** aven (plan §4, minus auth).
//!
//! One process: an authenticated TLS [`ServerListener`] (server cert + per-client
//! did:key challenge) feeding a full groove engine on **RocksDB** with the real
//! schema. A peer that holds a `replicate` grant ships this server its spark's
//! encrypted batches; the server stores them durably and forwards them to other
//! members — but it holds **no keyshares**, so everything it mirrors stays
//! ciphertext it cannot decrypt (store-and-forward + durable backup, not a
//! member). Config is all env; the TLS cert/key + identity seed come from fly
//! secrets, and `AVEN_SERVER_DATA_DIR` is the (volume-backed) storage path.

use std::sync::Arc;

use aven_p2p::{generate_self_signed, ChallengeParams, ServerListener, ServerTls};
use ed25519_dalek::SigningKey;
use groove::{AppContext, AppId, JazzClient, PeerId};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;

struct Config {
    sync_bind: String,
    health_bind: String,
    domain: String,
    uri: String,
    network_seed: String,
    seed: Option<[u8; 32]>,
    tls_cert_path: Option<String>,
    tls_key_path: Option<String>,
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
            sync_bind: var("AVEN_SERVER_BIND").unwrap_or_else(|| "0.0.0.0:4290".into()),
            health_bind: var("AVEN_SERVER_HEALTH_BIND").unwrap_or_else(|| "0.0.0.0:8080".into()),
            domain: var("AVEN_SERVER_DOMAIN").unwrap_or_else(|| "aven.local".into()),
            uri: var("AVEN_SERVER_URI").unwrap_or_else(|| "https://aven.local".into()),
            network_seed: var("AVEN_SERVER_NETWORK_SEED").unwrap_or_else(|| "testnet".into()),
            seed,
            tls_cert_path: var("AVEN_SERVER_TLS_CERT"),
            tls_key_path: var("AVEN_SERVER_TLS_KEY"),
        }
    }
}

fn load_identity(cfg: &Config) -> SigningKey {
    match cfg.seed {
        Some(seed) => SigningKey::from_bytes(&seed),
        None => {
            let sk = SigningKey::generate(&mut rand::rngs::OsRng);
            tracing::warn!(
                "AVEN_SERVER_SEED unset — generated an ephemeral identity (set the seed in \
                 fly secrets for a stable DID across restarts)"
            );
            sk
        }
    }
}

fn load_tls(cfg: &Config) -> Result<ServerTls, Box<dyn std::error::Error>> {
    match (&cfg.tls_cert_path, &cfg.tls_key_path) {
        (Some(cert), Some(key)) => {
            let cert_pem = std::fs::read(cert)?;
            let key_pem = std::fs::read(key)?;
            Ok(ServerTls::from_pem(&cert_pem, &key_pem)?)
        }
        _ => {
            tracing::warn!(
                "AVEN_SERVER_TLS_CERT/KEY unset — generating a self-signed cert (dev). Clients \
                 must pin its certificate; the cert fingerprint is logged below."
            );
            let mut sans = vec!["localhost".to_string(), cfg.domain.clone()];
            sans.dedup();
            Ok(generate_self_signed(sans)?)
        }
    }
}

/// Minimal HTTP liveness endpoint for the fly + Docker healthcheck.
async fn run_healthcheck(bind: String) -> std::io::Result<()> {
    let listener = TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "healthcheck listening");
    loop {
        let (mut sock, _) = listener.accept().await?;
        tokio::spawn(async move {
            let body = "ok";
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = sock.write_all(resp.as_bytes()).await;
            let _ = sock.shutdown().await;
        });
    }
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
    tracing::info!(%server_did, "aven-server mini identity");

    let server_tls = load_tls(&cfg)?;
    if cfg.tls_cert_path.is_none() {
        let pin: String = server_tls.cert_der.iter().map(|b| format!("{b:02x}")).collect();
        tracing::info!(cert_der_pin = %pin, "self-signed cert (pin this DER on the client)");
        // Dev convenience: hand the freshly-generated pin to a harness via a file
        // (the `dev:app2x` script reads it to set `AVENOS_SERVER_CERT_PIN`). Set
        // only when self-signing; a real cert is pinned out of band.
        if let Some(pin_file) = std::env::var("AVEN_SERVER_PIN_FILE").ok().filter(|s| !s.is_empty()) {
            if let Err(e) = std::fs::write(&pin_file, &pin) {
                tracing::warn!(%pin_file, "failed to write AVEN_SERVER_PIN_FILE: {e}");
            } else {
                tracing::info!(%pin_file, "wrote cert pin for the dev harness");
            }
        }
    }

    let params = ChallengeParams::new(cfg.domain.clone(), cfg.uri.clone(), cfg.network_seed.clone());
    let (listener, mut new_peers) =
        ServerListener::serve(&cfg.sync_bind, server_tls, identity, params).await?;
    tracing::info!(bind = %cfg.sync_bind, "authenticated TLS sync transport listening");

    // Durable blind replica: a full RocksDB engine on the REAL schema, wired to
    // the TLS listener. The real schema is required so the engine can persist &
    // re-ship replicated row batches (inbound batches carry `origin_schema_hash`;
    // an empty schema would reject them). It holds NO keyshares, so every batch it
    // mirrors stays ciphertext it cannot decrypt — a blind store-and-forward
    // mirror, not a member.
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
    let engine: Arc<JazzClient> =
        Arc::new(JazzClient::connect_with_sync_transport(ctx, listener.clone(), None).await?);
    tracing::info!("blind replica engine connected (RocksDB, real schema)");

    // Register each newly-authenticated peer so the engine ships catch-up to it.
    let engine_for_peers = engine.clone();
    tokio::spawn(async move {
        while let Some(peer) = new_peers.recv().await {
            if let Err(e) = engine_for_peers.register_peer_sync_client(peer) {
                tracing::warn!(%peer, "register peer: {e}");
            }
        }
    });

    // Block on the healthcheck loop (keeps the process alive).
    run_healthcheck(cfg.health_bind).await?;
    Ok(())
}

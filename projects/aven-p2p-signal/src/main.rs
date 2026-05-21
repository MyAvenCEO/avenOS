#![forbid(unsafe_code)]

//! Isolated HyperDHT bootstrap process for local dev.
//! Writes a single JSON line to stdout when ready (machine-readable handshake for `scripts/p2p-signal.ts`).

use peeroxide_dht::hyperdht::{spawn, HyperDhtConfig};
use peeroxide_dht::rpc::DhtConfig;
use serde::Serialize;

use libudx::UdxRuntime;

#[derive(Serialize)]
struct ReadyLine {
    ready: bool,
    /// HyperDHT bootstrap form (`127.0.0.1@host:port`) for `AVENOS_DHT_BOOTSTRAP`.
    bootstrap: String,
    /// Preferred reachability host for bootstrap string (often `127.0.0.1` locally; Fly uses `AVENOS_P2P_ADVERTISED_HOST`).
    host: String,
    /// Listening UDP port of this bootstrap node.
    port: u16,
}

fn env_port(name: &'static str, default: u16) -> u16 {
    match std::env::var(name) {
        Ok(s) => s.trim().parse().unwrap_or(default),
        Err(_) => default,
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    // Fly mentions `fly-global-services` for some stacks; **`peeroxide_dht` parses bind host as SocketAddr**.
    // Map that sentinel to **`0.0.0.0`**; missing / empty env ⇒ **`127.0.0.1`** (local dev).
    let host = std::env::var("AVENOS_P2P_SIGNAL_HOST")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| {
            if s.eq_ignore_ascii_case("fly-global-services") {
                "0.0.0.0".to_string()
            } else {
                s
            }
        })
        .unwrap_or_else(|| "127.0.0.1".to_string());

    let port = env_port("AVENOS_P2P_SIGNAL_PORT", 49737);

    let mut dht_cfg = DhtConfig::default();
    dht_cfg.bootstrap = vec![];
    dht_cfg.port = port;
    dht_cfg.host = host.clone();
    dht_cfg.firewalled = false;
    dht_cfg.ephemeral = Some(false);

    let mut cfg = HyperDhtConfig::default();
    cfg.dht = dht_cfg;

    let runtime = UdxRuntime::new()?;
    let (join_handle, handle, mut _srv_rx) = spawn(&runtime, cfg).await?;

    tracing::info!("waiting for local HyperDHT bootstrap to initialize…");
    handle.bootstrapped().await?;
    let local_port = handle.local_port().await.unwrap_or(port);

    let loop_hint_local = if host == "0.0.0.0" || host == "::" {
        "127.0.0.1".to_string()
    } else {
        host.clone()
    };
    let advertise_host = std::env::var("AVENOS_P2P_ADVERTISED_HOST")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| loop_hint_local.clone());
    let bootstrap = format!("127.0.0.1@{advertise_host}:{local_port}");

    let msg = ReadyLine {
        ready: true,
        bootstrap,
        host: advertise_host.clone(),
        port: local_port,
    };
    println!("{}", serde_json::to_string(&msg)?);

    tracing::info!(
        advertise = %advertise_host,
        port = local_port,
        "HyperDHT signal ready — clients use bootstrap line on stdout"
    );

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {},
    }

    let _ = handle.destroy().await;
    join_handle.abort();
    Ok(())
}

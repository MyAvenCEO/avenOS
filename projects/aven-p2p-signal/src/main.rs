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

async fn resolve_fly_global_services_v4() -> Option<String> {
    match tokio::net::lookup_host("fly-global-services:0").await {
        Ok(mut addrs) => addrs.find(|a| a.is_ipv4()).map(|a| a.ip().to_string()),
        Err(e) => {
            tracing::debug!("fly-global-services DNS: {e}");
            None
        }
    }
}

async fn resolve_advertised_ipv4(hostname: &str) -> Option<String> {
    match tokio::net::lookup_host(format!("{hostname}:0")).await {
        Ok(mut addrs) => addrs.find(|a| a.is_ipv4()).map(|a| a.ip().to_string()),
        Err(e) => {
            tracing::debug!(%hostname, err = %e, "advertised host DNS failed");
            None
        }
    }
}

/// UDP bind address for HyperDHT. Fly public ingress needs fly-global-services IPv4.
async fn resolve_udp_bind_host(raw: Option<&str>) -> String {
    match raw {
        None => "127.0.0.1".to_string(),
        Some(s) if s.eq_ignore_ascii_case("fly-global-services") => {
            resolve_fly_global_services_v4().await.unwrap_or_else(|| {
                tracing::warn!(
                    "fly-global-services unresolved — binding 127.0.0.1 (local dev only; Fly needs the resolved IPv4)"
                );
                "127.0.0.1".to_string()
            })
        }
        Some(s) if s == "0.0.0.0" || s == "::" => {
            if std::env::var("FLY_APP_NAME").is_ok() {
                if let Some(ip) = resolve_fly_global_services_v4().await {
                    tracing::warn!(
                        %ip,
                        "AVENOS_P2P_SIGNAL_HOST=0.0.0.0 on Fly — using fly-global-services IPv4 for public UDP ingress"
                    );
                    return ip;
                }
            }
            s.to_string()
        }
        Some(s) => s.to_string(),
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

    // Fly public UDP ingress requires binding fly-global-services; node id must match public IP clients see.
    let host_raw = std::env::var("AVENOS_P2P_SIGNAL_HOST")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let bind_host = resolve_udp_bind_host(host_raw.as_deref()).await;

    let port = env_port("AVENOS_P2P_SIGNAL_PORT", 49737);

    let advertise_host = std::env::var("AVENOS_P2P_ADVERTISED_HOST")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| {
            if bind_host == "0.0.0.0" || bind_host == "::" {
                "127.0.0.1".to_string()
            } else {
                bind_host.clone()
            }
        });

    let identity_host = if matches!(
        advertise_host.to_ascii_lowercase().as_str(),
        "127.0.0.1" | "localhost" | "::1"
    ) {
        advertise_host.clone()
    } else if let Some(ip) = resolve_advertised_ipv4(&advertise_host).await {
        tracing::info!(
            %advertise_host,
            %ip,
            bind = %bind_host,
            "DHT identity host (public) vs UDP bind"
        );
        ip
    } else {
        tracing::warn!(
            %advertise_host,
            bind = %bind_host,
            "could not resolve advertised host — using bind address for node id (may break remote clients)"
        );
        bind_host.clone()
    };

    let mut dht_cfg = DhtConfig::default();
    dht_cfg.bootstrap = vec![];
    dht_cfg.port = port;
    dht_cfg.host = identity_host.clone();
    if bind_host != identity_host {
        dht_cfg.bind_host = Some(bind_host.clone());
    }
    dht_cfg.firewalled = false;
    dht_cfg.ephemeral = Some(false);

    let mut cfg = HyperDhtConfig::default();
    cfg.dht = dht_cfg;

    let runtime = UdxRuntime::new()?;
    let (join_handle, handle, mut _srv_rx) = spawn(&runtime, cfg).await?;

    tracing::info!(bind = %bind_host, identity = %identity_host, port, "HyperDHT UDP listening");
    handle.bootstrapped().await?;
    let local_port = handle.local_port().await.unwrap_or(port);

    let bootstrap = if matches!(
        advertise_host.to_ascii_lowercase().as_str(),
        "127.0.0.1" | "localhost" | "::1"
    ) {
        format!("127.0.0.1@{advertise_host}:{local_port}")
    } else {
        format!("{identity_host}@{advertise_host}:{local_port}")
    };

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

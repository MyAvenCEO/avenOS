#![forbid(unsafe_code)]

//! Isolated HyperDHT bootstrap + co-hosted Rust blind-relay (single UDP port).
//! Writes one JSON line to stdout when ready (`scripts/p2p-signal.ts` / Fly `start-fly.ts`).

mod relay_host;

use std::sync::Arc;

use aven_p2p::dht::blind_relay::BlindRelayCoordinator;
use aven_p2p::dht::hyperdht::{spawn, HyperDhtConfig};
use aven_p2p::dht::rpc::DhtConfig;
use serde::Serialize;

use libudx::UdxRuntime;

use relay_host::{
    bootstrap_server_config, keys_dir_from_env, relay_public_key_hex,
    relay_public_key_hex_from_seed_hex, relay_server_config, run_signal_server,
    setup_relay_registration, RELAY_SEED_ENV,
};

#[derive(Serialize)]
struct ReadyLine {
    ready: bool,
    /// HyperDHT bootstrap form (`127.0.0.1@host:port`) for `AVENOS_DHT_BOOTSTRAP`.
    bootstrap: String,
    /// Preferred reachability host for bootstrap string.
    host: String,
    /// Listening UDP port (DHT + blind-relay).
    port: u16,
    /// Blind-relay static Ed25519 public key (64 hex).
    #[serde(rename = "relayPublicKeyHex")]
    relay_public_key_hex: String,
    /// Blind-relay UDP port (same as `port` — single HyperDHT socket).
    #[serde(rename = "relayUdpPort")]
    relay_udp_port: u16,
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
    if std::env::args().nth(1).as_deref() == Some("--derive-relay-public-key") {
        let seed_hex = std::env::var(RELAY_SEED_ENV)
            .map_err(|_| format!("{RELAY_SEED_ENV} unset"))?;
        let pk = relay_public_key_hex_from_seed_hex(seed_hex.trim())?;
        println!("{pk}");
        return Ok(());
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

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
    dht_cfg.ephemeral = Some(false);

    let mut cfg = HyperDhtConfig::default();
    cfg.dht = dht_cfg;

    let runtime = Arc::new(UdxRuntime::new()?);
    let (join_handle, handle, server_rx) = spawn(&runtime, cfg).await?;

    tracing::info!(bind = %bind_host, identity = %identity_host, port, "HyperDHT UDP listening");
    handle.bootstrapped().await?;
    let local_port = handle.local_port().await.unwrap_or(port);

    let keys_dir = keys_dir_from_env();
    let (relay_kp, relay_target) = setup_relay_registration(&handle)?;
    let relay_pk_hex = relay_public_key_hex(&relay_kp);
    tracing::info!(
        relay_pk = %relay_pk_hex,
        "blind-relay registered on bootstrap DHT (co-hosted UDP)"
    );

    let listen_sock = handle
        .listen_socket()
        .await?
        .ok_or("DHT listen socket not available")?;
    let coordinator = BlindRelayCoordinator::new(Arc::clone(&runtime), listen_sock);

    let bootstrap_config = bootstrap_server_config(&keys_dir, local_port)?;
    let relay_config = relay_server_config(relay_kp, local_port);

    tokio::spawn(run_signal_server(
        server_rx,
        handle.clone(),
        Arc::clone(&runtime),
        coordinator,
        bootstrap_config,
        relay_config,
        relay_target,
    ));

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
        relay_public_key_hex: relay_pk_hex,
        relay_udp_port: local_port,
    };
    println!("{}", serde_json::to_string(&msg)?);

    tracing::info!(
        advertise = %advertise_host,
        port = local_port,
        "HyperDHT + blind-relay ready — clients use stdout JSON handshake"
    );

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {},
    }

    let _ = handle.destroy().await;
    join_handle.abort();
    Ok(())
}

//! Co-hosted Hyperswarm blind-relay on the same HyperDHT bootstrap UDP socket (port 49737).
//!
//! Registers `hash(relay_pk)` on the running DHT, answers Noise IK for relay targets, and runs
//! Protomux `"blind-relay"` control sessions via [`BlindRelayCoordinator`].

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use libudx::UdxRuntime;
use aven_p2p::dht::blind_relay::{spawn_blind_relay_control_session, BlindRelayCoordinator};
use aven_p2p::dht::crypto::hash;
use aven_p2p::dht::hyperdht::{
    establish_responder_peer_connection, finish_server_noise_ik_handshake,
    handle_peer_holepunch_reply, EstablishedNoiseIkSession, HolepunchServerPeerState,
    HyperDhtHandle, KeyPair, ServerConfig, ServerEvent, ServerSession,
};
use aven_p2p::dht::hyperdht_messages::FIREWALL_UNKNOWN;
use aven_p2p::dht::messages::Ipv4Peer;
use aven_p2p::dht::socket_pool::SocketPool;
use rand::RngCore;
use tokio::sync::mpsc;
use tracing::warn;

pub const BOOTSTRAP_SEED_FILE: &str = "bootstrap-hyperdht.seed";

/// 32-byte Ed25519 seed (64 hex chars) — required relay identity (env / Fly secret).
pub const RELAY_SEED_ENV: &str = "AVENOS_RELAY_SEED_HEX";
/// Optional sanity check against [`RELAY_SEED_ENV`] (64 hex chars public key).
pub const RELAY_PUBLIC_KEY_ENV: &str = "AVENOS_RELAY_PUBLIC_KEY_HEX";

fn parse_32_byte_hex(raw: &str, label: &str) -> Result<[u8; 32], String> {
    let t = raw.trim();
    if t.len() != 64 {
        return Err(format!("{label}: expected 64 hex chars, got {}", t.len()));
    }
    let bytes = hex::decode(t).map_err(|e| format!("{label}: hex decode: {e}"))?;
    if bytes.len() != 32 {
        return Err(format!("{label}: decoded {} bytes, want 32", bytes.len()));
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&bytes);
    Ok(seed)
}

fn relay_seed_from_env() -> Result<Option<[u8; 32]>, String> {
    let Ok(raw) = std::env::var(RELAY_SEED_ENV) else {
        return Ok(None);
    };
    let t = raw.trim();
    if t.is_empty() {
        return Ok(None);
    }
    parse_32_byte_hex(t, RELAY_SEED_ENV).map(Some)
}

fn verify_relay_public_key_hex(kp: &KeyPair) -> Result<(), String> {
    let Ok(raw) = std::env::var(RELAY_PUBLIC_KEY_ENV) else {
        return Ok(());
    };
    let t = raw.trim();
    if t.is_empty() {
        return Ok(());
    }
    let expect = parse_32_byte_hex(t, RELAY_PUBLIC_KEY_ENV)?;
    if kp.public_key != expect {
        return Err(format!(
            "{RELAY_PUBLIC_KEY_ENV} does not match {RELAY_SEED_ENV} (got {}, expected {})",
            relay_public_key_hex(kp),
            t.to_ascii_lowercase()
        ));
    }
    Ok(())
}

/// Load blind-relay seed from [`RELAY_SEED_ENV`] (required).
pub fn load_relay_seed() -> Result<[u8; 32], Box<dyn std::error::Error + Send + Sync>> {
    match relay_seed_from_env()? {
        Some(seed) => {
            tracing::info!(target: "avenos::p2p-signal", "relay seed from {RELAY_SEED_ENV}");
            Ok(seed)
        }
        None => Err(format!(
            "{RELAY_SEED_ENV} is required — set in repo .env or Fly secret (never commit the seed)"
        )
        .into()),
    }
}

/// Load or create a 32-byte Ed25519 seed (Hyperswarm / HyperDHT layout).
pub fn load_or_create_seed(keys_dir: &Path, filename: &str) -> std::io::Result<[u8; 32]> {
    std::fs::create_dir_all(keys_dir)?;
    let path = keys_dir.join(filename);
    if path.is_file() {
        let bytes = std::fs::read(&path)?;
        if bytes.len() != 32 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{}: expected 32-byte seed, got {}", path.display(), bytes.len()),
            ));
        }
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&bytes);
        return Ok(seed);
    }
    let mut seed = [0u8; 32];
    rand::rng().fill_bytes(&mut seed);
    std::fs::write(&path, seed)?;
    Ok(seed)
}

pub fn keys_dir_from_env() -> PathBuf {
    std::env::var("AVENOS_P2P_SIGNAL_KEYS_DIR")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".avenOS/dev/p2p-signal"))
}

pub fn relay_public_key_hex(relay_kp: &KeyPair) -> String {
    relay_kp.public_key.iter().map(|b| format!("{b:02x}")).collect()
}

/// Derive blind-relay public key hex from a 64-char seed hex (for `.env` setup).
pub fn relay_public_key_hex_from_seed_hex(seed_hex: &str) -> Result<String, String> {
    let seed = parse_32_byte_hex(seed_hex, RELAY_SEED_ENV)?;
    Ok(relay_public_key_hex(&KeyPair::from_seed(seed)))
}

fn ipv4_peer_to_socket_addr(peer: &Ipv4Peer) -> Result<SocketAddr, String> {
    let ip: std::net::IpAddr = peer
        .host
        .parse()
        .map_err(|e| format!("invalid UDP host {}: {e}", peer.host))?;
    Ok(SocketAddr::new(ip, peer.port))
}

async fn accept_relay_control_session(
    dht: HyperDhtHandle,
    runtime: Arc<UdxRuntime>,
    coordinator: BlindRelayCoordinator,
    est: EstablishedNoiseIkSession,
) {
    let peer_udp = match ipv4_peer_to_socket_addr(&est.client_address) {
        Ok(a) => a,
        Err(e) => {
            warn!(error = %e, "relay host: bad client UDP address");
            return;
        }
    };
    match establish_responder_peer_connection(&dht, &runtime, &est).await {
        Ok(conn) => {
            let socket = conn.socket;
            let stream = conn.stream;
            let session = spawn_blind_relay_control_session(coordinator, stream, peer_udp);
            let _ = session.await;
            drop(socket);
        }
        Err(e) => warn!(error = %e, "relay host: establish responder peer connection failed"),
    }
}

/// Bootstrap holepunch + blind-relay IK accept loop (replaces dropping `server_rx`).
pub async fn run_signal_server(
    mut server_rx: mpsc::UnboundedReceiver<ServerEvent>,
    dht: HyperDhtHandle,
    runtime: Arc<UdxRuntime>,
    coordinator: BlindRelayCoordinator,
    bootstrap_config: ServerConfig,
    relay_config: ServerConfig,
    relay_target: [u8; 32],
) {
    let mut bootstrap_session = ServerSession::new();
    let mut relay_session = ServerSession::new();
    let pool = SocketPool::new("0.0.0.0".into());

    while let Some(event) = server_rx.recv().await {
        match event {
            ServerEvent::PeerHandshake {
                msg,
                from,
                target,
                reply_tx,
            } => {
                let is_relay = target.as_ref().is_some_and(|t| *t == relay_target);
                if is_relay {
                    match finish_server_noise_ik_handshake(
                        &relay_config,
                        &mut relay_session,
                        msg,
                        &from,
                        target.as_ref(),
                    ) {
                        Some(outcome) => {
                            let _ = reply_tx.send(Some(outcome.reply_wire.clone()));
                            let dht2 = dht.clone();
                            let rt2 = Arc::clone(&runtime);
                            let coord2 = coordinator.clone();
                            let est = outcome.establish;
                            tokio::spawn(async move {
                                accept_relay_control_session(dht2, rt2, coord2, est).await;
                            });
                        }
                        None => {
                            let _ = reply_tx.send(None);
                        }
                    }
                } else {
                    let reply = finish_server_noise_ik_handshake(
                        &bootstrap_config,
                        &mut bootstrap_session,
                        msg,
                        &from,
                        target.as_ref(),
                    )
                    .map(|o| o.reply_wire);
                    let _ = reply_tx.send(reply);
                }
            }
            ServerEvent::PeerHolepunch {
                msg,
                from: _,
                peer_address,
                target: _,
                reply_tx,
            } => {
                let secrets: Vec<&HolepunchServerPeerState> =
                    bootstrap_session.holepunch_peer_states().collect();
                let reply = handle_peer_holepunch_reply(
                    bootstrap_config.firewall,
                    bootstrap_config.noise_addresses_listen_udp_port,
                    &secrets,
                    &pool,
                    &runtime,
                    msg,
                    &peer_address,
                )
                .await;
                let _ = reply_tx.send(reply);
            }
            _ => {}
        }
    }
}

/// Load relay keypair, register relay on the DHT router, return `(relay_kp, relay_target)`.
pub fn setup_relay_registration(dht: &HyperDhtHandle) -> Result<(KeyPair, [u8; 32]), Box<dyn std::error::Error + Send + Sync>> {
    let relay_seed = load_relay_seed()?;
    let relay_kp = KeyPair::from_seed(relay_seed);
    verify_relay_public_key_hex(&relay_kp)?;
    let relay_target = hash(&relay_kp.public_key);
    dht.register_server(&relay_target);
    Ok((relay_kp, relay_target))
}

pub fn bootstrap_server_config(
    keys_dir: &Path,
    listen_port: u16,
) -> Result<ServerConfig, Box<dyn std::error::Error + Send + Sync>> {
    let seed = load_or_create_seed(keys_dir, BOOTSTRAP_SEED_FILE)?;
    let kp = KeyPair::from_seed(seed);
    let mut cfg = ServerConfig::new(kp, FIREWALL_UNKNOWN);
    cfg.noise_addresses_listen_udp_port = Some(listen_port);
    Ok(cfg)
}

pub fn relay_server_config(relay_kp: KeyPair, listen_port: u16) -> ServerConfig {
    let mut cfg = ServerConfig::new(relay_kp, FIREWALL_UNKNOWN);
    cfg.noise_addresses_listen_udp_port = Some(listen_port);
    cfg
}

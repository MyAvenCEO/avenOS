//! `tauri-plugin-peer` — Hyperswarm when AvenOS unlocks (`self:did-unlock`).
//!
//! The swarm static key uses the **same Ed25519 seed** as plugin-self / Jazz
//! (`HKDFExpand` with info `ceo.aven.os/identity/ed25519/v1` over the device root secret).

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod did;
#[cfg(any(target_os = "macos", target_os = "ios"))]
mod pairing_label;
#[cfg(any(target_os = "macos", target_os = "ios"))]
mod peer_connect_ui;
#[cfg(any(target_os = "macos", target_os = "ios"))]
mod hyperswarm_groove_bridge;
#[cfg(any(target_os = "macos", target_os = "ios"))]
mod network_path;
#[cfg(any(target_os = "macos", target_os = "ios"))]
mod transport_rank;
#[cfg(any(target_os = "macos", target_os = "ios"))]
mod commands_macos;
pub use hyperswarm_groove_bridge::HyperswarmGrooveBridge;
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub use peer_connect_ui::{PeerConnectSubstate, PeerConnectUiRow, PeerTransportMode};

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
mod commands_stub;

#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::generate_handler;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::Listener;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::Manager;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::plugin::Builder;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use groove::PeerTransport as _;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::Emitter;

struct PeerListenGuards {
	#[allow(dead_code)]
	_unlock: tauri::EventId,
	#[allow(dead_code)]
	_lock: tauri::EventId,
	#[allow(dead_code)]
	_path: tauri::EventId,
	#[allow(dead_code)]
	_foreground: tauri::EventId,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct P2pDiagnostics {
	pub central_mode: bool,
	pub dht_bootstrap: String,
	pub joined_topic_count: usize,
	pub allowlist_count: usize,
	pub linked_count: usize,
	/// `true` while a 6-char invite code is active in this process (host or acceptor).
	#[serde(default)]
	pub pairing_session_active: bool,
	/// Lowercase hex of the active short-lived pair topic (`hash(b"aven:pair:v1:" + CODE)`).
	#[serde(default)]
	pub pairing_topic_hex: Option<String>,
	/// Result of an HTTPS GET to `https://<relay-host>/.well-known/aven-relay.json` from THIS device.
	/// `"ok (<ms>ms)"` proves TCP/443 + DNS work even when UDP DHT bootstrap times out.
	#[serde(default)]
	pub relay_https_probe: Option<String>,
	/// `Ok(N)` from peeroxide-dht's most recent bootstrap `find_node` query. `0` means no UDP reply
	/// came back from the configured bootstrap node within the query timeout.
	#[serde(default)]
	pub dht_bootstrap_closest_seen: Option<usize>,
	#[serde(default)]
	pub last_path_change_at_ms: Option<u64>,
	#[serde(default)]
	pub last_foreground_heal_at_ms: Option<u64>,
	#[serde(default)]
	pub heal_in_progress: bool,
	/// LAN-first connect paths (false on cellular-only).
	pub prefer_lan: bool,
	/// Last reported network interfaces from NWPathMonitor (e.g. `wifi`, `cellular`).
	#[serde(default)]
	pub network_interfaces: Vec<String>,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerTransportStatusReply {
	pub hyperswarm_running: bool,
	/// Set when `start_swarm` failed after unlock (e.g. missing `AVEN_RELAY_URL` in sandbox builds).
	pub hyperswarm_start_error: Option<String>,
	pub local_pk_prefix_hex: String,
	/// Groove runtime ids for live Hyperswarm links (diagnostics).
	pub linked_peer_ids: Vec<String>,
	/// `did:key` of each live link — use for UI row state (matches Jazz `peers.peer_did`).
	pub linked_peer_dids: Vec<String>,
	pub pairing_code_pending: Option<String>,
	pub p2p_diagnostics: P2pDiagnostics,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PeerInviteCreateReply {
	pub code: String,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
struct PairSession {
	topic: [u8; 32],
	code: String,
	/// This device's advertised pairing label (`first/device`).
	my_advertised_label: String,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
#[derive(Clone)]
pub struct PeerCtl {
	inner: Arc<tokio::sync::Mutex<Option<RunningSwarm>>>,
	/// Coalesces concurrent `start_swarm` (setup + `self:did-unlock`) into one actor.
	swarm_starting: Arc<AtomicBool>,
	swarm_start_notify: Arc<tokio::sync::Notify>,
	jazz_hyperswarm: HyperswarmGrooveBridge,
	pairing_session: Arc<tokio::sync::Mutex<Option<PairSession>>>,
	app_handle: tauri::AppHandle,
	allowed_remote_dids: Arc<tokio::sync::RwLock<std::collections::HashSet<String>>>,
	joined_pair_topics: Arc<tokio::sync::Mutex<std::collections::HashSet<[u8; 32]>>>,
	/// Jazz may call `set_allowlist` before Hyperswarm finishes booting; applied in `start_swarm`.
	pending_allowlist: Arc<tokio::sync::Mutex<Option<(String, Vec<String>)>>>,
	/// Last allowlist synced from `peers` table — skips redundant Hyperswarm `set_allowlist` on mesh ticks.
	applied_peer_allow_sorted: Arc<tokio::sync::Mutex<Option<Vec<String>>>>,
	/// Last transport upgrade probe per DID (ms since epoch).
	last_upgrade_probe_at: Arc<tokio::sync::Mutex<std::collections::HashMap<String, u64>>>,
	/// Last `start_swarm` failure — surfaced to UI when buttons stay disabled.
	swarm_start_error: Arc<tokio::sync::Mutex<Option<String>>>,
	/// Last resolved P2P stack config — surfaced in UI for TestFlight diagnostics.
	p2p_diagnostics: Arc<tokio::sync::RwLock<P2pDiagnostics>>,
	connect_ui_tracker: Arc<peer_connect_ui::PeerConnectUiTracker>,
	/// Shared with peeroxide/HyperDHT — toggled on network path changes.
	prefer_lan: Arc<AtomicBool>,
	last_network_interfaces: Arc<tokio::sync::RwLock<Vec<String>>>,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn prefer_lan_from_path(interfaces: &[String], satisfied: bool) -> Option<bool> {
	if interfaces.is_empty() {
		return None;
	}
	Some(satisfied && interfaces.iter().any(|i| i == "wifi" || i == "wired"))
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl PeerCtl {
	pub fn connect_ui_row_for_did(&self, peer_did: &str) -> peer_connect_ui::PeerConnectUiRow {
		self.connect_ui_tracker.row_for_did(peer_did)
	}
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
struct RunningSwarm {
	swarm: peeroxide::SwarmHandle,
	actor_join: tokio::task::JoinHandle<()>,
	conns_worker: tokio::task::JoinHandle<()>,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
const PAIR_CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn hex_pk_prefix(pk: &[u8]) -> String {
	pk.iter().take(8).fold(String::new(), |acc, b| acc + &format!("{b:02x}"))
}

/// Optional Hyperswarm tuning from the process environment (lab / self-hosted relays).
///
/// **Master switch — `AVEN_RELAY`** (alias **`AVENOS_RELAY`**): defaults **on** (central discovery).
/// Set **`AVEN_RELAY=false`** for public Holepunch HyperDHT roots.
///
/// When **`AVEN_RELAY` is central**, **`AVEN_RELAY_URL` is required** (e.g. `127.0.0.1` for embedded
/// dev stacks, `relay.aven.ceo` for hosted Fly bootstrap). With **`AVENOS_DHT_BOOTSTRAP`** unset or
/// blank, bootstrap is derived from **`AVEN_RELAY_URL`**: **`127.0.0.1@{host}:{dht_port}`** for local
/// embedded signal, or **`{host}:{dht_port}`** for remote hosts (DNS-resolved — not loopback).
///
/// - `AVENOS_DHT_ISOLATED=1`: empty bootstrap table unless `AVENOS_DHT_BOOTSTRAP` fills it (set by central mode).
/// - `AVENOS_DHT_PUBLIC=1`: public Holepunch roots (non-central mode).
/// - `AVENOS_DHT_BOOTSTRAP`: comma-separated bootstrap strings (`ip@host:port` HyperDHT form).
/// - Connectivity: HyperDHT in-band handshake relay + holepunch + LAN `addresses4` (peeroxide docs).
///   Blind-relay (`relay_through`) is **last-resort fallback** after holepunch — set via
///   `AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX` + `AVENOS_HYPERSWARM_RELAY_ADDR` (runtime or compile-time embed).
/// - `AVENOS_HYPERSWARM_MAX_PARALLEL` / `AVENOS_HYPERSWARM_MAX_PEERS`: positive integers.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn env_truthy_os(key: &str) -> bool {
	std::env::var(key)
		.map(|v| {
			matches!(
				v.trim(),
				"1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON"
			)
		})
		.unwrap_or(false)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn env_falsy_os(key: &str) -> bool {
	std::env::var(key)
		.map(|v| {
			matches!(
				v.trim(),
				"0" | "false" | "FALSE" | "no" | "NO" | "off" | "OFF"
			)
		})
		.unwrap_or(false)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn aven_relay_central_mode() -> bool {
	if env_truthy_os("AVENOS_SKIP_P2P_SIGNAL") {
		return false;
	}
	if env_falsy_os("AVEN_RELAY") || env_falsy_os("AVENOS_RELAY") {
		return false;
	}
	true
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn base_swarm_config_from_env() -> peeroxide::SwarmConfig {
	if aven_relay_central_mode() {
		log::info!(
			target: "avenos::peeroxide",
			"AVEN_RELAY central discovery — HyperDHT bootstrap (in-band handshake relay / holepunch)"
		);
		return peeroxide::SwarmConfig::default();
	}
	if env_truthy_os("AVENOS_DHT_PUBLIC") || !env_truthy_os("AVENOS_DHT_ISOLATED") {
		return peeroxide::SwarmConfig::with_public_bootstrap();
	}
	peeroxide::SwarmConfig::default()
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn p2p_dht_udp_port_default() -> u16 {
	std::env::var("AVENOS_P2P_SIGNAL_PORT")
		.ok()
		.and_then(|s| s.trim().parse().ok())
		.unwrap_or(49737)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn is_embedded_local_relay_host(host: &str) -> bool {
	matches!(
		host.to_ascii_lowercase().as_str(),
		"127.0.0.1" | "localhost" | "::1"
	)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn resolve_ipv4(hostname: &str) -> Option<String> {
	use std::net::ToSocketAddrs;
	format!("{hostname}:0")
		.to_socket_addrs()
		.ok()?
		.find_map(|a| a.is_ipv4().then(|| a.ip().to_string()))
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn central_bootstrap_line(hostname: &str, udp: u16) -> String {
	if is_embedded_local_relay_host(hostname) {
		format!("127.0.0.1@{hostname}:{udp}")
	} else if let Some(ip) = resolve_ipv4(hostname) {
		format!("{ip}@{hostname}:{udp}")
	} else {
		format!("{hostname}:{udp}")
	}
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn normalize_aven_relay_url_host(raw: &str) -> Result<String, String> {
	fn trim_outer_quotes(mut s: &str) -> &str {
		s = s.trim();
		while (s.starts_with('"') && s.ends_with('"') && s.len() >= 2)
			|| (s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2)
		{
			s = &s[1..s.len() - 1].trim();
		}
		s
	}
	let mut h = trim_outer_quotes(raw);
	if h.is_empty() {
		return Err("AVEN_RELAY_URL is empty".into());
	}
	let lower = h.to_ascii_lowercase();
	if lower.starts_with("https://") {
		h = &h["https://".len()..];
	} else if lower.starts_with("http://") {
		h = &h["http://".len()..];
	}
	if let Some(ix) = h.find('/') {
		h = &h[..ix];
	}
	if let Some(close) = h.find(']') {
		if h.starts_with('[') {
			let inner = h[1..close].trim();
			if inner.is_empty() {
				return Err("AVEN_RELAY_URL: empty IPv6".into());
			}
			return Ok(inner.to_string());
		}
		return Err("AVEN_RELAY_URL: unexpected ']' outside bracketed IPv6".into());
	}
	if let Some(lc) = h.rfind(':') {
		if lc > 0 {
			let tail = &h[lc + 1..];
			if tail.parse::<u16>().is_ok() {
				h = &h[..lc];
			}
		}
	}
	let h = h.trim();
	if h.is_empty() {
		return Err("AVEN_RELAY_URL: no hostname".into());
	}
	Ok(h.to_string())
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn resolve_aven_relay_url() -> Result<String, String> {
	if let Ok(v) = std::env::var("AVEN_RELAY_URL") {
		let t = v.trim();
		if !t.is_empty() {
			return Ok(t.to_string());
		}
	}
	if let Some(baked) = option_env!("AVEN_RELAY_URL") {
		let t = baked.trim();
		if !t.is_empty() {
			log::info!(
				target: "avenos::peeroxide",
				"AVEN_RELAY_URL from compile-time embed: {t}",
			);
			return Ok(t.to_string());
		}
	}
	const PRODUCTION_RELAY_HOST: &str = "relay.aven.ceo";
	log::info!(
		target: "avenos::peeroxide",
		"AVEN_RELAY_URL unset — using production default {PRODUCTION_RELAY_HOST}",
	);
	Ok(PRODUCTION_RELAY_HOST.to_string())
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn parse_relay_pubkey_hex(raw: &str) -> Result<[u8; 32], String> {
	let t = raw.trim();
	if t.len() != 64 {
		return Err(format!(
			"AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX: expected 64 hex chars, got {}",
			t.len()
		));
	}
	let bytes = hex::decode(t).map_err(|e| format!("relay pubkey hex decode: {e}"))?;
	if bytes.len() != 32 {
		return Err(format!(
			"AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX: decoded {} bytes, want 32",
			bytes.len()
		));
	}
	let mut pk = [0u8; 32];
	pk.copy_from_slice(&bytes);
	Ok(pk)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn parse_relay_socket_addr(raw: &str) -> Result<std::net::SocketAddr, String> {
	raw.trim()
		.parse()
		.map_err(|e| format!("AVENOS_HYPERSWARM_RELAY_ADDR parse ({raw:?}): {e}"))
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn resolve_hyperswarm_relay_embed() -> Option<(String, String)> {
	let pk = option_env!("AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX")?.trim();
	let addr = option_env!("AVENOS_HYPERSWARM_RELAY_ADDR")?.trim();
	if pk.is_empty() || addr.is_empty() || pk.len() != 64 {
		return None;
	}
	Some((pk.to_string(), addr.to_string()))
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn parse_dht_bootstrap_udp_endpoints(lines: &[String]) -> Vec<std::net::SocketAddr> {
	let mut out: Vec<std::net::SocketAddr> = Vec::new();
	for line in lines {
		let line = line.trim();
		if line.is_empty() {
			continue;
		}
		// `suggestedIPv4@hostname:port` or `host:port`
		let host_port = line.rsplit('@').next().unwrap_or(line);
		let Some((host, port_s)) = host_port.rsplit_once(':') else {
			continue;
		};
		let Ok(port) = port_s.parse::<u16>() else {
			continue;
		};
		let addr = if let Some(at) = line.find('@') {
			let ip = line[..at].trim();
			if let Ok(v4) = ip.parse::<std::net::Ipv4Addr>() {
				std::net::SocketAddr::new(std::net::IpAddr::V4(v4), port)
			} else if let Ok(v4) = host.parse::<std::net::Ipv4Addr>() {
				std::net::SocketAddr::new(std::net::IpAddr::V4(v4), port)
			} else {
				continue;
			}
		} else if let Ok(v4) = host.parse::<std::net::Ipv4Addr>() {
			std::net::SocketAddr::new(std::net::IpAddr::V4(v4), port)
		} else {
			continue;
		};
		if !out.contains(&addr) {
			out.push(addr);
		}
		if out.len() >= 3 {
			break;
		}
	}
	out
}

/// Co-hosted blind-relay shares the DHT UDP port (49737). Older embeds still point at 49738.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn coalesce_blind_relay_with_bootstrap(cfg: &mut peeroxide::SwarmConfig) {
	if cfg.relay_through.is_none() {
		return;
	}
	let bootstrap_endpoints = parse_dht_bootstrap_udp_endpoints(&cfg.dht.dht.bootstrap);
	if bootstrap_endpoints.is_empty() {
		return;
	}

	for addr in &bootstrap_endpoints {
		if !cfg.relay_address_hints.contains(addr) {
			cfg.relay_address_hints.push(*addr);
		}
	}

	let Some(relay_addr) = cfg.relay_address else {
		cfg.relay_address = Some(bootstrap_endpoints[0]);
		log::info!(
			target: "avenos::peeroxide",
			"blind-relay addr unset — using DHT bootstrap UDP {}",
			bootstrap_endpoints[0],
		);
		return;
	};

	let bootstrap_port = bootstrap_endpoints[0].port();
	if relay_addr.port() != bootstrap_port {
		let coalesced = std::net::SocketAddr::new(relay_addr.ip(), bootstrap_port);
		log::info!(
			target: "avenos::peeroxide",
			"blind-relay addr port coalesced {relay_addr} → {coalesced} (DHT bootstrap UDP port)",
		);
		cfg.relay_address = Some(coalesced);
	}

	// Ensure hints include the coalesced addr (may differ from stale embed).
	if let Some(addr) = cfg.relay_address {
		if !cfg.relay_address_hints.contains(&addr) {
			cfg.relay_address_hints.insert(0, addr);
		}
	}
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn apply_hyperswarm_blind_relay(cfg: &mut peeroxide::SwarmConfig) -> Result<(), String> {
	let mut pk_hex: Option<String> = std::env::var("AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX")
		.ok()
		.map(|s| s.trim().to_string())
		.filter(|s| !s.is_empty());
	let mut addr_raw: Option<String> = std::env::var("AVENOS_HYPERSWARM_RELAY_ADDR")
		.ok()
		.map(|s| s.trim().to_string())
		.filter(|s| !s.is_empty());

	if pk_hex.is_none() || addr_raw.is_none() {
		if let Some((baked_pk, baked_addr)) = resolve_hyperswarm_relay_embed() {
			pk_hex.get_or_insert(baked_pk);
			addr_raw.get_or_insert(baked_addr);
		}
	}

	let (Some(pk_hex), Some(addr_raw)) = (pk_hex, addr_raw) else {
		log::info!(
			target: "avenos::peeroxide",
			"blind-relay fallback unset (no AVENOS_HYPERSWARM_RELAY_* — holepunch-only data plane)"
		);
		return Ok(());
	};

	let relay_through = parse_relay_pubkey_hex(&pk_hex)?;
	let relay_address = parse_relay_socket_addr(&addr_raw)?;
	cfg.relay_through = Some(relay_through);
	cfg.relay_address = Some(relay_address);
	coalesce_blind_relay_with_bootstrap(cfg);
	log::info!(
		target: "avenos::peeroxide",
		"blind-relay fallback configured relay_through={} relay_addr={} hints={}",
		hex_pk_prefix(&relay_through),
		cfg.relay_address.map(|a| a.to_string()).unwrap_or_default(),
		cfg.relay_address_hints.len(),
	);
	Ok(())
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
async fn apply_avensos_swarm_env(cfg: &mut peeroxide::SwarmConfig) -> Result<(), String> {
	let central = aven_relay_central_mode();
	let isolated = central
		|| (env_truthy_os("AVENOS_DHT_ISOLATED") && !env_truthy_os("AVENOS_DHT_PUBLIC"));

	if central {
		resolve_aven_relay_url()?;
	}

	let mut env_bootstrap_entries: Vec<String> = match std::env::var("AVENOS_DHT_BOOTSTRAP") {
		Ok(raw) => raw
			.split(',')
			.map(|s| s.trim().to_string())
			.filter(|s| !s.is_empty())
			.collect(),
		Err(_) => Vec::new(),
	};
	if env_bootstrap_entries.is_empty() {
		if let Some(baked) = option_env!("AVENOS_DHT_BOOTSTRAP") {
			let t = baked.trim();
			if !t.is_empty() {
				log::info!(
					target: "avenos::peeroxide",
					"AVENOS_DHT_BOOTSTRAP from compile-time embed: {t}",
				);
				env_bootstrap_entries.push(t.to_string());
			}
		}
	}

	let mut bootstrap_nodes = env_bootstrap_entries.clone();
	if isolated && central && bootstrap_nodes.is_empty() {
		let relay_raw = resolve_aven_relay_url()?;
		let hostname = normalize_aven_relay_url_host(&relay_raw)?;
		let udp = p2p_dht_udp_port_default();
		let line = central_bootstrap_line(&hostname, udp);
		bootstrap_nodes = vec![line.clone()];
		log::info!(
			target: "avenos::peeroxide",
			"DHT bootstrap from AVEN_RELAY_URL (central, no AVENOS_DHT_BOOTSTRAP): {line}",
		);
	}

	if isolated {
		cfg.dht.dht.bootstrap = bootstrap_nodes.clone();
		let n = bootstrap_nodes.len();
		if n == 0 {
			log::warn!(
				target: "avenos::peeroxide",
				"isolated DHT but bootstrap list is empty — peers cannot bootstrap"
			);
		} else {
			log::info!(
				target: "avenos::peeroxide",
				"custom DHT bootstrap only (isolated): {n} node(s) — {}",
				bootstrap_nodes.join(", ")
			);
		}
	} else {
		let n = env_bootstrap_entries.len();
		for s in env_bootstrap_entries.into_iter().rev() {
			cfg.dht.dht.bootstrap.insert(0, s);
		}
		if n > 0 {
			log::info!(
				target: "avenos::peeroxide",
				"prepended {n} DHT bootstrap node(s) from AVENOS_DHT_BOOTSTRAP"
			);
		}
	}

	if let Ok(v) = std::env::var("AVENOS_HYPERSWARM_MAX_PARALLEL") {
		if let Ok(n) = v.trim().parse::<usize>() {
			if !(1..=512).contains(&n) {
				return Err(format!(
					"AVENOS_HYPERSWARM_MAX_PARALLEL: out of range 1..=512 ({n})"
				));
			}
			cfg.max_parallel = n;
			log::info!(target: "avenos::peeroxide", "max_parallel={n} from env");
		}
	}

	if let Ok(v) = std::env::var("AVENOS_HYPERSWARM_MAX_PEERS") {
		if let Ok(n) = v.trim().parse::<usize>() {
			if !(1..=4096).contains(&n) {
				return Err(format!(
					"AVENOS_HYPERSWARM_MAX_PEERS: out of range 1..=4096 ({n})"
				));
			}
			cfg.max_peers = n;
			log::info!(target: "avenos::peeroxide", "max_peers={n} from env");
		}
	}

	apply_hyperswarm_blind_relay(cfg)?;

	Ok(())
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn build_p2p_diagnostics(cfg: &peeroxide::SwarmConfig, linked_count: usize) -> P2pDiagnostics {
	let dht_bootstrap = if cfg.dht.dht.bootstrap.is_empty() {
		"(empty)".to_string()
	} else {
		cfg.dht.dht.bootstrap.join(", ")
	};
	P2pDiagnostics {
		central_mode: aven_relay_central_mode(),
		dht_bootstrap,
		joined_topic_count: 0,
		allowlist_count: 0,
		linked_count,
		pairing_session_active: false,
		pairing_topic_hex: None,
		relay_https_probe: None,
		dht_bootstrap_closest_seen: None,
		last_path_change_at_ms: None,
		last_foreground_heal_at_ms: None,
		heal_in_progress: false,
		prefer_lan: cfg.prefer_lan.load(Ordering::Relaxed),
		network_interfaces: Vec::new(),
	}
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn normalize_pair_code(raw: &str) -> Result<String, String> {
	let mut s = raw.trim().to_ascii_uppercase();
	s.retain(|c| !matches!(c, ' ' | '-' | '_'));
	if s.len() != 6 {
		return Err("Pairing code must be exactly 6 characters.".into());
	}
	if !s.bytes().all(|b| PAIR_CODE_ALPHABET.contains(&b)) {
		return Err("Pairing code contains invalid characters.".into());
	}
	Ok(s)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn pair_topic_hash(normalized_code: &str) -> [u8; 32] {
	let mut buf = Vec::with_capacity(b"aven:pair:v1:".len() + normalized_code.len());
	buf.extend_from_slice(b"aven:pair:v1:");
	buf.extend_from_slice(normalized_code.as_bytes());
	peeroxide::discovery_key(&buf)
}

/// Per-pair durable sync topic: `discovery_key("aven:peer-pair:v1:" + sort(didA,didB))`.
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub fn pair_topic_from_dids(local_did: &str, remote_did: &str) -> [u8; 32] {
	let (a, b) = if local_did <= remote_did {
		(local_did, remote_did)
	} else {
		(remote_did, local_did)
	};
	let mut buf = Vec::with_capacity(64 + a.len() + b.len());
	buf.extend_from_slice(b"aven:peer-pair:v1:");
	buf.extend_from_slice(a.as_bytes());
	buf.push(0);
	buf.extend_from_slice(b.as_bytes());
	peeroxide::discovery_key(&buf)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn generate_pair_code() -> String {
	use rand::Rng;
	let mut rng = rand::thread_rng();
	(0..6)
		.map(|_| PAIR_CODE_ALPHABET[rng.gen_range(0..PAIR_CODE_ALPHABET.len())] as char)
		.collect()
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn pairing_advertised_label(app: &tauri::AppHandle) -> String {
	let vault = app.state::<tauri_plugin_self::vault::ActiveVault>();
	tauri_plugin_self::vault::pairing_label_for_app(app, &*vault).unwrap_or_else(|| "Peer".into())
}

/// Short-lived invite topics: fast DHT refresh + capped connect backoff in vendored peeroxide.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn pairing_join_opts() -> peeroxide::JoinOpts {
	peeroxide::JoinOpts::fast_refresh()
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
async fn join_topic(
	swarm: &peeroxide::SwarmHandle,
	topic: [u8; 32],
	opts: peeroxide::JoinOpts,
) -> Result<(), String> {
	swarm
		.clone()
		.join(topic, opts)
		.await
		.map_err(|e| format!("join topic: {e}"))
}

/// Wait for the first announce/lookup cycle (can take many seconds on the public DHT).
#[cfg(any(target_os = "macos", target_os = "ios"))]
async fn flush_swarm(swarm: &peeroxide::SwarmHandle) -> Result<(), String> {
	swarm
		.clone()
		.flush()
		.await
		.map_err(|e| format!("flush after join: {e}"))
}

/// Return to the UI immediately; DHT flush continues without blocking other Tauri IPC.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn spawn_flush_background(swarm: peeroxide::SwarmHandle, label: &'static str) {
	tokio::spawn(async move {
		if let Err(e) = flush_swarm(&swarm).await {
			log::warn!(target: "avenos::peeroxide", "{label} background flush failed: {e}");
		}
	});
}

/// Pairing **requires** at least one DHT announce/lookup cycle; background-only flush broke rendezvous.
#[cfg(any(target_os = "macos", target_os = "ios"))]
async fn flush_swarm_for_pairing(swarm: &peeroxide::SwarmHandle, label: &'static str) -> Result<(), String> {
	const PAIRING_FLUSH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(4);
	match tokio::time::timeout(PAIRING_FLUSH_TIMEOUT, flush_swarm(swarm)).await {
		Ok(Ok(())) => {
			log::info!(target: "avenos::peeroxide", "{label} pairing DHT flush ok");
			Ok(())
		}
		Ok(Err(e)) => Err(e),
		Err(_) => {
			log::warn!(
				target: "avenos::peeroxide",
				"{label} pairing DHT flush timed out after {}s — continuing lookup in background",
				PAIRING_FLUSH_TIMEOUT.as_secs(),
			);
			spawn_flush_background(swarm.clone(), label);
			Ok(())
		}
	}
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
async fn join_pairing_topic(
	swarm: &peeroxide::SwarmHandle,
	topic: [u8; 32],
	flush_label: &'static str,
) -> Result<(), String> {
	join_topic(swarm, topic, pairing_join_opts()).await?;
	flush_swarm_for_pairing(swarm, flush_label).await
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl PeerCtl {
	async fn start_swarm(&self, app: tauri::AppHandle) -> Result<(), String> {
		loop {
			{
				let guard = self.inner.lock().await;
				if guard.is_some() {
					return Ok(());
				}
			}
			if self
				.swarm_starting
				.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
				.is_ok()
			{
				break;
			}
			self.swarm_start_notify.notified().await;
		}

		let result = self.start_swarm_inner(app).await;
		self.swarm_starting.store(false, Ordering::Release);
		self.swarm_start_notify.notify_waiters();
		result
	}

	async fn start_swarm_inner(&self, app: tauri::AppHandle) -> Result<(), String> {
		use tauri_plugin_self::derive::derive_ed25519_seed;

		*self.swarm_start_error.lock().await = None;

		let seed_z = app
			.state::<tauri_plugin_self::state::SelfState>()
			.with_root(|root| derive_ed25519_seed(root))?;
		let seed: [u8; 32] = *seed_z;

		let kp = peeroxide::KeyPair::from_seed(seed);
		let mut cfg = base_swarm_config_from_env();
		cfg.key_pair = Some(kp);
		cfg.max_parallel = 8;
		if let Err(e) = apply_avensos_swarm_env(&mut cfg).await {
			*self.swarm_start_error.lock().await = Some(e.clone());
			return Err(e);
		}
		cfg.connect_ui = Some(self.connect_ui_tracker.hook());
		cfg.prefer_lan = Arc::clone(&self.prefer_lan);
		cfg.dht.prefer_lan = Arc::clone(&self.prefer_lan);

		let linked_count = self.jazz_hyperswarm.snapshot_remote_clients().await.len();
		let mut diag = build_p2p_diagnostics(&cfg, linked_count);
		diag.joined_topic_count = self.joined_pair_topics.lock().await.len();
		diag.allowlist_count = self.allowed_remote_dids.read().await.len();
		*self.p2p_diagnostics.write().await = diag;

		let (actor_join, swarm, mut conn_rx) = match peeroxide::spawn(cfg).await {
			Ok(v) => v,
			Err(e) => {
				let msg = format!("peeroxide spawn: {e}");
				*self.swarm_start_error.lock().await = Some(msg.clone());
				return Err(msg);
			}
		};

		let ctl_for_conns = self.clone();
		let conns_worker = tokio::spawn(async move {
			while let Some(conn) = conn_rx.recv().await {
				let ctl2 = ctl_for_conns.clone();
				tokio::spawn(async move {
					ctl2.handle_incoming_swarm_conn(conn).await;
				});
			}
			log::debug!(target: "avenos::peeroxide", "swarm incoming connection channel closed");
		});

		let local_pk = swarm.key_pair().public_key;
		let local_prefix_len = std::cmp::min(8, local_pk.len());

		let mut guard = self.inner.lock().await;
		if guard.is_some() {
			log::warn!(
				target: "avenos::peeroxide",
				"hyperswarm spawn finished but swarm already running; tearing down duplicate actor",
			);
			drop(guard);
			let _ = swarm.destroy().await;
			actor_join.abort();
			conns_worker.abort();
			return Ok(());
		}

		log::info!(
			target: "avenos::peeroxide",
			"hyperswarm_up local_pk_prefix={:02x?} (awaiting per-pair topic joins)",
			&local_pk[..local_prefix_len],
		);

		*guard = Some(RunningSwarm {
			swarm,
			actor_join,
			conns_worker,
		});
		drop(guard);

		if let Err(e) = app.emit("peer:hyperswarm-ready", serde_json::Value::Null) {
			log::debug!(target: "avenos::peeroxide", "emit peer:hyperswarm-ready failed: {e}");
		}

		if let Err(e) = self.apply_pending_allowlist().await {
			log::warn!(target: "avenos::peeroxide", "apply_pending_allowlist: {e}");
		}
		let _ = app.emit("peer:mesh-push", ());
		Ok(())
	}

	async fn handle_incoming_swarm_conn(&self, mut conn: peeroxide::SwarmConnection) {
		let remote_pk = *conn.remote_public_key();
		let transport_mode = conn.peer.transport_mode;
		let Ok(remote_did) = crate::did::peer_did_from_ed25519(&remote_pk) else {
			log::warn!(target: "avenos::peeroxide", "reject swarm: invalid remote static key");
			drop(conn);
			return;
		};

		let topics = &conn.topics;
		// `peeroxide` often delivers **inbound** `SwarmConnection`s with `topics: []`
		// (see `create_server_connection` / relay paths — topic is not copied onto the handle).
		// Outbound/client paths may populate `topics` from discovery. During an active invite we
		// must not require topic metadata, or pairing always fails on the server side.
		let on_pairing = {
			let pairing = self.pairing_session.lock().await;
			pairing.as_ref().is_some_and(|s| {
				topics.is_empty() || topics.iter().any(|t| *t == s.topic)
			})
		};

		if !on_pairing {
			let allow = self.allowed_remote_dids.read().await;
			if !allow.contains(&remote_did) {
				log::warn!(
					target: "avenos::peeroxide",
					"reject swarm conn: {remote_did} not in allowlist (topics={})",
					topics.len(),
				);
				drop(conn);
				return;
			}
		}

		if on_pairing {
			log::info!(
				target: "avenos::peeroxide",
				"pairing swarm conn from {remote_did} (initiator={})",
				conn.is_initiator,
			);
			if let Err(e) = self.ensure_durable_pair_topic_for_remote(&remote_did).await {
				log::warn!(
					target: "avenos::peeroxide",
					"early per-pair topic join for {remote_did}: {e}",
				);
			}

			let my_label = {
				let pairing = self.pairing_session.lock().await;
				pairing
					.as_ref()
					.map(|s| s.my_advertised_label.clone())
					.unwrap_or_else(|| "Peer".into())
			};
			let remote_label = match pairing_label::exchange_pairing_label(
				&mut conn.peer.stream,
				&my_label,
				conn.is_initiator,
			)
			.await
			{
				Ok(l) => l,
				Err(e) => {
					log::warn!(target: "avenos::peeroxide", "pair label exchange: {e}");
					pairing_label::short_did_fallback(&remote_did)
				}
			};
			if let Err(e) = self.app_handle.emit(
				"peer:invite-paired",
				serde_json::json!({
					"remoteDid": remote_did,
					"remoteDisplayLabel": remote_label,
					"label": remote_label,
				}),
			) {
				log::warn!(target: "avenos::peeroxide", "emit peer:invite-paired failed: {e}");
			}
			// Pairing topic is short-lived, but the blind-relay/direct stream is already up —
			// attach Groove here. Durable-topic reconnect often fails to re-pair blind-relay.
			log::info!(
				target: "avenos::peeroxide",
				"pairing conn complete for {remote_did}; attaching Groove mux on live link",
			);
			self.connect_ui_tracker
				.note_inbound_connected(&remote_pk, transport_mode);
			self.jazz_hyperswarm.on_swarm_connection(conn).await;
			return;
		}

		self.connect_ui_tracker
			.note_inbound_connected(&remote_pk, transport_mode);

		self.jazz_hyperswarm.on_swarm_connection(conn).await;
	}

	pub async fn peer_transport_status(&self) -> PeerTransportStatusReply {
		let inner = self.inner.lock().await;
		let (hyperswarm_running, local_pk_prefix_hex) = match inner.as_ref() {
			Some(r) => {
				let pk = r.swarm.key_pair().public_key;
				(true, hex_pk_prefix(&pk))
			}
			None => (false, String::new()),
		};
		drop(inner);

		let live = self.jazz_hyperswarm.snapshot_remote_clients().await;
		let linked_peer_ids: Vec<String> = live.iter().map(|id| id.to_string()).collect();
		let cid_map = self.jazz_hyperswarm.shared_client_id_to_did();
		let linked_peer_dids: Vec<String> = live
			.iter()
			.filter_map(|id| cid_map.read().expect("cid map").get(id).cloned())
			.collect();

		let pairing_code_pending = self
			.pairing_session
			.lock()
			.await
			.as_ref()
			.map(|s| s.code.clone());

		let pairing_session_topic = self
			.pairing_session
			.lock()
			.await
			.as_ref()
			.map(|s| s.topic);

		let hyperswarm_start_error = self.swarm_start_error.lock().await.clone();
		let mut p2p_diagnostics = self.p2p_diagnostics.read().await.clone();
		p2p_diagnostics.linked_count = linked_peer_dids.len();
		p2p_diagnostics.joined_topic_count = self.joined_pair_topics.lock().await.len();
		p2p_diagnostics.allowlist_count = self.allowed_remote_dids.read().await.len();
		p2p_diagnostics.pairing_session_active = pairing_code_pending.is_some();
		p2p_diagnostics.pairing_topic_hex = pairing_session_topic.map(|t| hex::encode(t));
		let (path_ms, fg_ms, heal_busy) = self.connect_ui_tracker.global_heal_snapshot();
		p2p_diagnostics.last_path_change_at_ms = path_ms;
		p2p_diagnostics.last_foreground_heal_at_ms = fg_ms;
		p2p_diagnostics.heal_in_progress = heal_busy;
		p2p_diagnostics.prefer_lan = self.prefer_lan.load(Ordering::Relaxed);
		p2p_diagnostics.network_interfaces = self
			.last_network_interfaces
			.read()
			.await
			.clone();

		PeerTransportStatusReply {
			hyperswarm_running,
			hyperswarm_start_error,
			local_pk_prefix_hex,
			linked_peer_ids,
			linked_peer_dids,
			pairing_code_pending,
			p2p_diagnostics,
		}
	}

	/// Reset after lock / partial invite-topic joins — next DB sync reapplies full allowlist + topics.
	pub async fn invalidate_allowlist_peer_table_cache(&self) {
		*self.applied_peer_allow_sorted.lock().await = None;
	}

	/// One round trip: update in-memory DID allowset, join pair topics if needed, **capped** DHT flush — peeroxide reconnect pattern.
	pub async fn sync_allowlist_from_peer_table(
		&self,
		local_did: &str,
		active_remote_dids: &[String],
	) -> Result<(), String> {
		let mut sorted: Vec<String> = active_remote_dids
			.iter()
			.map(|s| s.trim().to_string())
			.filter(|s| !s.is_empty())
			.collect();
		sorted.sort();
		sorted.dedup();
		{
			let guard = self.applied_peer_allow_sorted.lock().await;
			if guard.as_ref() == Some(&sorted) {
				return Ok(());
			}
		}
		self.set_allowlist_and_join_pair_topics(local_did, &sorted).await?;
		*self.applied_peer_allow_sorted.lock().await = Some(sorted);
		Ok(())
	}

	/// Force one DHT announce/lookup round while a 6-char invite code is active (pairing topic rendezvous).
	pub async fn nudge_pairing_discovery(&self) -> Result<(), String> {
		if self.pairing_session.lock().await.is_none() {
			return Ok(());
		}
		let swarm = {
			let guard = self.inner.lock().await;
			let Some(r) = guard.as_ref() else {
				return Ok(());
			};
			r.swarm.clone()
		};
		flush_swarm_for_pairing(&swarm, "nudge pairing discovery").await
	}

	/// Force DHT announce/lookup for allowlisted peers that lack a live Groove link.
	///
	/// When **all** links are down, clears stale swarm slots via `prepare_reconnect`.
	/// When **some** peers stay linked, nudges only missing DIDs via per-peer
	/// `note_peer_disconnected` so live connections are not torn down.
	pub async fn nudge_allowlisted_discovery(
		&self,
		active_remote_dids: &[String],
	) -> Result<(), String> {
		let allow: Vec<String> = active_remote_dids
			.iter()
			.map(|s| s.trim().to_string())
			.filter(|s| !s.is_empty())
			.collect();
		if allow.is_empty() {
			return Ok(());
		}

		let live_dids = self.jazz_hyperswarm.snapshot_live_linked_dids().await;
		let missing: Vec<String> = allow
			.iter()
			.filter(|d| !live_dids.contains(d.as_str()))
			.cloned()
			.collect();
		if missing.is_empty() {
			return Ok(());
		}

		let swarm = {
			let guard = self.inner.lock().await;
			let Some(r) = guard.as_ref() else {
				return Ok(());
			};
			let joined = self.joined_pair_topics.lock().await;
			if joined.is_empty() {
				return Ok(());
			}
			r.swarm.clone()
		};

		if live_dids.is_empty() {
			if let Err(e) = swarm.prepare_reconnect().await {
				log::debug!(
					target: "avenos::peeroxide",
					"prepare_reconnect before nudge: {e}",
				);
			}
		} else {
		for did in &missing {
			self.connect_ui_tracker.bump_reconnect_attempt(did);
			match crate::did::ed25519_public_from_peer_did(did) {
					Ok(pk) => {
						if let Err(e) = swarm.note_peer_disconnected(pk).await {
							log::debug!(
								target: "avenos::peeroxide",
								"note_peer_disconnected nudge did={did}: {e}",
							);
						}
					}
					Err(e) => {
						log::debug!(
							target: "avenos::peeroxide",
							"peer heal: skip nudge bad did={did}: {e}",
						);
					}
				}
			}
		}

		log::info!(
			target: "avenos::peeroxide",
			"peer heal: nudge {} missing allowlisted peer(s) ({} live)",
			missing.len(),
			live_dids.len(),
		);
		flush_swarm_for_pairing(&swarm, "nudge missing allowlisted peer(s)").await
	}

	/// Soft heal after network path change or app foreground — refresh relays, flush, per-peer nudge.
	pub async fn soft_heal(&self, reason: &str, prefer_lan: Option<bool>) -> Result<(), String> {
		self.connect_ui_tracker.set_heal_in_progress(true);
		let result = self.soft_heal_inner(reason, prefer_lan).await;
		self.connect_ui_tracker.set_heal_in_progress(false);
		result
	}

	async fn soft_heal_inner(&self, reason: &str, prefer_lan: Option<bool>) -> Result<(), String> {
		let pairing_active = self.pairing_session.lock().await.is_some();
		let was_prefer_lan = self.prefer_lan.load(Ordering::Relaxed);
		let prefer_lan = prefer_lan.unwrap_or(was_prefer_lan);

		if prefer_lan != was_prefer_lan {
			self.apply_prefer_lan(prefer_lan).await;
			if was_prefer_lan && !prefer_lan && !pairing_active {
				let swarm = {
					let guard = self.inner.lock().await;
					guard.as_ref().map(|r| r.swarm.clone())
				};
				if let Some(swarm) = swarm {
					if let Err(e) = swarm.prepare_reconnect().await {
						log::debug!(
							target: "avenos::peeroxide",
							"prepare_reconnect ({reason}, lan→non-lan): {e}",
						);
					}
				}
			}
		}

		if pairing_active {
			log::debug!(
				target: "avenos::peeroxide",
				"soft heal ({reason}): pairing active — prefer_lan={prefer_lan}, nudge only",
			);
			return self.nudge_pairing_discovery().await;
		}

		let flush_label: &'static str = match reason {
			"network path changed" => "network path changed",
			"app foreground" => "app foreground",
			_ => "soft heal",
		};
		let allow: Vec<String> = self.allowed_remote_dids.read().await.iter().cloned().collect();
		if allow.is_empty() {
			return Ok(());
		}

		let desired = if prefer_lan {
			Some(peer_connect_ui::PeerTransportMode::Lan)
		} else {
			None
		};
		self.connect_ui_tracker.set_desired_transport_for_all(desired);
		for did in &allow {
			self.connect_ui_tracker.bump_reconnect_attempt(did);
		}

		let swarm = {
			let guard = self.inner.lock().await;
			let Some(r) = guard.as_ref() else {
				return Ok(());
			};
			r.swarm.clone()
		};

		if let Err(e) = swarm.refresh_announce_relays().await {
			log::debug!(
				target: "avenos::peeroxide",
				"refresh_announce_relays ({reason}): {e}",
			);
		}
		flush_swarm_for_pairing(&swarm, flush_label).await?;
		self.nudge_allowlisted_discovery(&allow).await?;
		let force_probe = prefer_lan && !was_prefer_lan;
		if let Err(e) = self
			.probe_transport_upgrades(force_probe, "soft heal")
			.await
		{
			log::debug!(target: "avenos::peeroxide", "transport upgrade after heal: {e}");
		}
		let _ = self.app_handle.emit("peer:mesh-push", ());
		Ok(())
	}

	pub async fn on_network_path_changed(
		&self,
		payload: &network_path::NetworkPathChangedPayload,
	) -> Result<(), String> {
		self.connect_ui_tracker.mark_path_change();
		*self.last_network_interfaces.write().await = payload.interfaces.clone();
		let prefer_lan = prefer_lan_from_path(&payload.interfaces, payload.satisfied);
		log::info!(
			target: "avenos::peeroxide",
			"peer_heal: path_change interfaces={:?} prefer_lan={:?}",
			payload.interfaces,
			prefer_lan,
		);
		self.soft_heal("network path changed", prefer_lan).await
	}

	pub async fn on_app_foreground(&self) -> Result<(), String> {
		self.connect_ui_tracker.mark_foreground_heal();
		let ifaces = self.last_network_interfaces.read().await.clone();
		let prefer_lan = if ifaces.is_empty() {
			None
		} else {
			prefer_lan_from_path(&ifaces, true)
		};
		self.soft_heal("app foreground", prefer_lan).await
	}

	/// Probe linked peers for a better transport (LAN/direct) and hot-swap the Groove mux.
	pub async fn probe_transport_upgrades(&self, force: bool, reason: &str) -> Result<(), String> {
		use std::time::{SystemTime, UNIX_EPOCH};

		let now_ms = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.map(|d| d.as_millis() as u64)
			.unwrap_or(0);

		let live_dids = self.jazz_hyperswarm.snapshot_live_linked_dids().await;
		if live_dids.is_empty() {
			return Ok(());
		}

		let swarm = {
			let guard = self.inner.lock().await;
			let Some(r) = guard.as_ref() else {
				return Ok(());
			};
			r.swarm.clone()
		};

		for did in live_dids {
			let ui = self.connect_ui_tracker.row_for_did(&did);
			let mode = ui.transport_mode;
			if !crate::transport_rank::should_probe_upgrade(mode) {
				continue;
			}
			let interval = mode
				.map(crate::transport_rank::probe_interval_ms)
				.unwrap_or(15_000);
			if !force {
				let mut probes = self.last_upgrade_probe_at.lock().await;
				if probes
					.get(&did)
					.is_some_and(|t| now_ms.saturating_sub(*t) < interval)
				{
					continue;
				}
				probes.insert(did.clone(), now_ms);
			}
			match crate::did::ed25519_public_from_peer_did(&did) {
				Ok(pk) => {
					log::info!(
						target: "avenos::peeroxide",
						"peer_heal: transport upgrade probe ({reason}) did={did} mode={:?}",
						mode,
					);
					if let Err(e) = swarm.probe_transport_upgrade(pk).await {
						log::debug!(
							target: "avenos::peeroxide",
							"probe_transport_upgrade did={did}: {e}",
						);
					}
				}
				Err(e) => {
					log::debug!(
						target: "avenos::peeroxide",
						"probe skip bad did={did}: {e}",
					);
				}
			}
		}
		Ok(())
	}

	/// Periodic transport upgrade probes (mesh reconcile tick).
	pub async fn maybe_probe_transport_upgrades(&self) -> Result<(), String> {
		self.probe_transport_upgrades(false, "periodic").await
	}

	fn schedule_post_link_upgrade_probe(&self, remote_pk: [u8; 32]) {
		let ctl = self.clone();
		tokio::spawn(async move {
			tokio::time::sleep(std::time::Duration::from_secs(5)).await;
			let Ok(did) = crate::did::peer_did_from_ed25519(&remote_pk) else {
				return;
			};
			let ui = ctl.connect_ui_tracker.row_for_did(&did);
			if !crate::transport_rank::should_probe_upgrade(ui.transport_mode) {
				return;
			}
			let swarm = {
				let guard = ctl.inner.lock().await;
				guard.as_ref().map(|r| r.swarm.clone())
			};
			let Some(swarm) = swarm else {
				return;
			};
			log::info!(
				target: "avenos::peeroxide",
				"peer_heal: post-link upgrade probe did={did} mode={:?}",
				ui.transport_mode,
			);
			if let Err(e) = swarm.probe_transport_upgrade(remote_pk).await {
				log::debug!(
					target: "avenos::peeroxide",
					"post-link probe_transport_upgrade did={did}: {e}",
				);
			}
		});
	}

	async fn on_groove_link_lifecycle(
		&self,
		event: hyperswarm_groove_bridge::GrooveLinkLifecycle,
	) {
		let swarm = {
			let guard = self.inner.lock().await;
			guard.as_ref().map(|r| r.swarm.clone())
		};
		let Some(swarm) = swarm else {
			return;
		};
		match event {
			hyperswarm_groove_bridge::GrooveLinkLifecycle::Up(pk) => {
				if let Err(e) = swarm.note_peer_connected(pk).await {
					log::debug!(
						target: "avenos::peeroxide",
						"note_peer_connected: {e}",
					);
				}
				self.schedule_post_link_upgrade_probe(pk);
			}
			hyperswarm_groove_bridge::GrooveLinkLifecycle::Down(pk) => {
				if let Ok(did) = crate::did::peer_did_from_ed25519(&pk) {
					log::info!(
						target: "avenos::peeroxide",
						"peer_heal: link_down did={did}",
					);
					self.connect_ui_tracker
						.note_disconnected_pk_with_reason(&pk, "link_down");
				}
				if let Err(e) = swarm.note_peer_disconnected(pk).await {
					log::debug!(
						target: "avenos::peeroxide",
						"note_peer_disconnected: {e}",
					);
				}
			}
		}
	}

	/// Update the set of remote DIDs allowed to connect on per-pair topics, then join those topics.
	pub async fn set_allowlist_and_join_pair_topics(
		&self,
		local_did: &str,
		active_remote_dids: &[String],
	) -> Result<(), String> {
		{
			let mut w = self.allowed_remote_dids.write().await;
			w.clear();
			for d in active_remote_dids {
				w.insert(d.trim().to_string());
			}
		}

		let swarm = {
			let guard = self.inner.lock().await;
			let Some(running) = guard.as_ref() else {
				if !active_remote_dids.is_empty() {
					*self.pending_allowlist.lock().await = Some((
						local_did.to_string(),
						active_remote_dids
							.iter()
							.map(|d| d.trim().to_string())
							.collect(),
					));
					log::info!(
						target: "avenos::peeroxide",
						"set_allowlist: queued {} peer(s) until Hyperswarm is up",
						active_remote_dids.len(),
					);
				}
				return Ok(());
			};
			running.swarm.clone()
		};

		let want: std::collections::HashSet<[u8; 32]> = active_remote_dids
			.iter()
			.map(|r| pair_topic_from_dids(local_did, r.trim()))
			.collect();

		let mut joined = self.joined_pair_topics.lock().await;
		let stale: Vec<[u8; 32]> = joined
			.iter()
			.copied()
			.filter(|t| !want.contains(t))
			.collect();
		let mut topics_changed = !stale.is_empty();
		let want_count = want.len();
		for t in stale {
			let _ = swarm.leave(t).await;
			joined.remove(&t);
		}

		for t in want {
			if !joined.contains(&t) {
				// Same fast connect backoff as invite pairing — previously paired DIDs should relink quickly.
				join_topic(&swarm, t, pairing_join_opts()).await?;
				joined.insert(t);
				topics_changed = true;
			}
		}
		if topics_changed {
			log::info!(
				target: "avenos::peeroxide",
				"set_allowlist: joined {want_count} durable pair topic(s)",
			);
		}
		// Capped mandatory round like invite pairing — background-only flush left session 2+ stuck.
		if want_count > 0 {
			let _ =
				flush_swarm_for_pairing(&swarm, "reconnect allowlisted peers").await;
		}
		Ok(())
	}

	/// Apply allowlist saved while Hyperswarm was still starting.
	pub async fn apply_pending_allowlist(&self) -> Result<(), String> {
		let pending = self.pending_allowlist.lock().await.take();
		let Some((local_did, allow)) = pending else {
			return Ok(());
		};
		if allow.is_empty() {
			return Ok(());
		}
		log::info!(
			target: "avenos::peeroxide",
			"apply_pending_allowlist: {} trusted peer(s)",
			allow.len(),
		);
		let mut sorted: Vec<String> = allow
			.into_iter()
			.map(|s| s.trim().to_string())
			.filter(|s| !s.is_empty())
			.collect();
		sorted.sort();
		sorted.dedup();
		self.set_allowlist_and_join_pair_topics(&local_did, &sorted)
			.await?;
		*self.applied_peer_allow_sorted.lock().await = Some(sorted);
		Ok(())
	}

	/// Join the durable per-DID sync topic as soon as pairing connects (before DB upsert).
	#[cfg(any(target_os = "macos", target_os = "ios"))]
	async fn ensure_durable_pair_topic_for_remote(&self, remote_did: &str) -> Result<(), String> {
		let remote = remote_did.trim().to_string();
		{
			let mut allow = self.allowed_remote_dids.write().await;
			allow.insert(remote.clone());
		}

		let local_did = self.local_peer_did().await?;
		let topic = pair_topic_from_dids(&local_did, &remote);

		if self.joined_pair_topics.lock().await.contains(&topic) {
			return Ok(());
		}

		let mut guard = self.inner.lock().await;
		let Some(running) = guard.as_mut() else {
			log::debug!(
				target: "avenos::peeroxide",
				"per-pair topic join deferred (swarm not up) remote={remote}",
			);
			return Ok(());
		};

		join_topic(&running.swarm, topic, pairing_join_opts()).await?;
		let swarm = running.swarm.clone();
		drop(guard);

		self.invalidate_allowlist_peer_table_cache().await;
		let _ = flush_swarm_for_pairing(&swarm, "per-pair early join").await;

		self.joined_pair_topics.lock().await.insert(topic);
		log::info!(
			target: "avenos::peeroxide",
			"per-pair topic joined early for {remote}",
		);
		Ok(())
	}

	#[cfg(any(target_os = "macos", target_os = "ios"))]
	async fn local_peer_did(&self) -> Result<String, String> {
		let guard = self.inner.lock().await;
		let running = guard
			.as_ref()
			.ok_or_else(|| "Hyperswarm is not running".to_string())?;
		let pk = running.swarm.key_pair().public_key;
		crate::did::peer_did_from_ed25519(&pk)
	}

	async fn apply_prefer_lan(&self, prefer_lan: bool) {
		self.prefer_lan.store(prefer_lan, Ordering::Release);
		let guard = self.inner.lock().await;
		if let Some(r) = guard.as_ref() {
			r.swarm.set_prefer_lan(prefer_lan);
		}
	}

	pub(crate) async fn peer_invite_create(&self) -> Result<String, String> {
		let code = generate_pair_code();
		let normalized = normalize_pair_code(&code)?;
		let topic = pair_topic_hash(&normalized);

		let advertised = pairing_advertised_label(&self.app_handle);

		let swarm = {
			let mut inner = self.inner.lock().await;
			let Some(running) = inner.as_mut() else {
				return Err("Hyperswarm is not running yet — unlock identity and wait a moment.".into());
			};

			let mut pairing = self.pairing_session.lock().await;
			if let Some(prev) = pairing.take() {
				let _ = running.swarm.leave(prev.topic).await;
			}

			*pairing = Some(PairSession {
				topic,
				code: normalized.clone(),
				my_advertised_label: advertised,
			});
			running.swarm.clone()
		};

		join_pairing_topic(&swarm, topic, "peer_invite_create").await?;

		log::info!(
			target: "avenos::peeroxide",
			"peer_invite_create ready code={normalized} topic={} (DHT flushed — share with other device)",
			hex::encode(&topic[..8])
		);

		let _ = self.app_handle.emit("peer:mesh-push", ());
		Ok(normalized)
	}

	pub(crate) async fn peer_invite_accept(
		&self,
		raw_code: String,
	) -> Result<(), String> {
		let normalized = normalize_pair_code(&raw_code)?;
		let topic = pair_topic_hash(&normalized);

		let my_label = pairing_advertised_label(&self.app_handle);

		let swarm = {
			let mut inner = self.inner.lock().await;
			let Some(running) = inner.as_mut() else {
				return Err("Hyperswarm is not running yet — unlock identity and wait a moment.".into());
			};

			{
				let mut pairing = self.pairing_session.lock().await;
				if let Some(prev) = pairing.take() {
					if prev.topic != topic {
						let _ = running.swarm.leave(prev.topic).await;
					}
				}
				*pairing = Some(PairSession {
					topic,
					code: normalized.clone(),
					my_advertised_label: my_label,
				});
			}
			running.swarm.clone()
		};

		join_pairing_topic(&swarm, topic, "peer_invite_accept").await?;

		log::info!(
			target: "avenos::peeroxide",
			"peer_invite_accept ready code={normalized} topic={} (DHT flushed — awaiting host)",
			hex::encode(&topic[..8])
		);

		let _ = self.app_handle.emit("peer:mesh-push", ());
		Ok(())
	}

	pub async fn peer_invite_cancel(&self) -> Result<(), String> {
		let mut inner = self.inner.lock().await;
		let Some(running) = inner.as_mut() else {
			let mut pairing = self.pairing_session.lock().await;
			pairing.take();
			return Ok(());
		};

		let mut pairing = self.pairing_session.lock().await;
		if let Some(prev) = pairing.take() {
			running
				.swarm
				.leave(prev.topic)
				.await
				.map_err(|e| format!("pair leave failed: {e}"))?;
			log::debug!(target: "avenos::peeroxide", "peer_invite_cancel left pairing topic");
		}
		let _ = self.app_handle.emit("peer:mesh-push", ());
		Ok(())
	}

	async fn tear_down(&self) {
		network_path::stop_network_path_monitor();
		let _ = self.peer_invite_cancel().await;
		*self.applied_peer_allow_sorted.lock().await = None;
		{
			let mut j = self.joined_pair_topics.lock().await;
			j.clear();
		}
		{
			let mut w = self.allowed_remote_dids.write().await;
			w.clear();
		}
		if let Err(e) = self.jazz_hyperswarm.shutdown().await {
			log::warn!(target: "avenos::peeroxide", "Groove peer transport shutdown: {e:?}");
		}
		let mut g = self.inner.lock().await;
		let Some(running) = g.take() else {
			return;
		};
		running.conns_worker.abort();
		let _ = running.swarm.destroy().await;
		let _ = running.actor_join.await;
		log::info!(target: "avenos::peeroxide", "hyperswarm_stopped");
	}
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
	use tauri::{generate_handler, plugin::Builder};
	Builder::new("peer")
		.invoke_handler(generate_handler![
			commands_stub::peer_transport_status,
			commands_stub::peer_invite_create,
			commands_stub::peer_invite_accept,
			commands_stub::peer_invite_cancel,
		])
		.build()
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
	Builder::new("peer")
		.invoke_handler(generate_handler![
			commands_macos::peer_transport_status,
			commands_macos::peer_swarm_retry,
			commands_macos::peer_invite_create,
			commands_macos::peer_invite_accept,
			commands_macos::peer_invite_cancel,
		])
		.setup(|app, _plugin| {
			let jazz_hyperswarm = HyperswarmGrooveBridge::new();
			let app_mesh = app.clone();
			let connect_ui_tracker = Arc::new(peer_connect_ui::PeerConnectUiTracker::new(Some(
				Arc::new(move || {
					let hh = app_mesh.clone();
					tauri::async_runtime::spawn(async move {
						let _ = hh.emit("peer:connect-ui-changed", ());
					});
				}),
			)));
			jazz_hyperswarm.attach_connect_ui(Arc::clone(&connect_ui_tracker));

			app.manage(jazz_hyperswarm.clone());

			let app_h = app.clone();
			let ctl = Arc::new(PeerCtl {
				inner: Arc::new(tokio::sync::Mutex::new(None)),
				swarm_starting: Arc::new(AtomicBool::new(false)),
				swarm_start_notify: Arc::new(tokio::sync::Notify::new()),
				jazz_hyperswarm,
				pairing_session: Arc::new(tokio::sync::Mutex::new(None)),
				app_handle: app_h,
				allowed_remote_dids: Arc::new(tokio::sync::RwLock::new(std::collections::HashSet::new())),
				joined_pair_topics: Arc::new(tokio::sync::Mutex::new(std::collections::HashSet::new())),
				pending_allowlist: Arc::new(tokio::sync::Mutex::new(None)),
				applied_peer_allow_sorted: Arc::new(tokio::sync::Mutex::new(None)),
				last_upgrade_probe_at: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
				swarm_start_error: Arc::new(tokio::sync::Mutex::new(None)),
				p2p_diagnostics: Arc::new(tokio::sync::RwLock::new(P2pDiagnostics {
					central_mode: aven_relay_central_mode(),
					dht_bootstrap: String::new(),
					joined_topic_count: 0,
					allowlist_count: 0,
					linked_count: 0,
					pairing_session_active: false,
					pairing_topic_hex: None,
					relay_https_probe: None,
					dht_bootstrap_closest_seen: None,
					last_path_change_at_ms: None,
					last_foreground_heal_at_ms: None,
					heal_in_progress: false,
					prefer_lan: true,
					network_interfaces: Vec::new(),
				})),
				connect_ui_tracker,
				prefer_lan: Arc::new(AtomicBool::new(true)),
				last_network_interfaces: Arc::new(tokio::sync::RwLock::new(Vec::new())),
			});

			let h = app.clone();
			let ctl_unlock = ctl.clone();
			let id_unlock = app.listen("self:did-unlock", move |_e| {
				let hh = h.clone();
				let c = ctl_unlock.clone();
				tauri::async_runtime::spawn(async move {
					if let Err(err) = c.start_swarm(hh).await {
						log::warn!(target: "avenos::peeroxide", "spawn_after_unlock_failed: {err}");
					}
				});
			});

			let ctl_lock = ctl.clone();
			let id_lock = app.listen("self:did-lock", move |_e| {
				let c = ctl_lock.clone();
				tauri::async_runtime::spawn(async move {
					c.tear_down().await;
				});
			});

			let ctl_link = ctl.clone();
			ctl.jazz_hyperswarm.set_link_lifecycle_hook(Arc::new(
				move |event| {
					let c = ctl_link.clone();
					tauri::async_runtime::spawn(async move {
						c.on_groove_link_lifecycle(event).await;
					});
				},
			));

			network_path::start_network_path_monitor(app.clone());

			let ctl_path = ctl.clone();
			let id_path = app.listen("peer:network-path-changed", move |event| {
				let c = ctl_path.clone();
				let payload: network_path::NetworkPathChangedPayload =
					serde_json::from_str(event.payload()).unwrap_or(
						network_path::NetworkPathChangedPayload {
							satisfied: true,
							expensive: false,
							constrained: false,
							interfaces: vec![],
						},
					);
				tauri::async_runtime::spawn(async move {
					if let Err(e) = c.on_network_path_changed(&payload).await {
						log::debug!(target: "avenos::peeroxide", "path heal: {e}");
					}
				});
			});

			let ctl_fg = ctl.clone();
			let id_fg = app.listen("peer:app-foreground", move |_event| {
				let c = ctl_fg.clone();
				tauri::async_runtime::spawn(async move {
					if let Err(e) = c.on_app_foreground().await {
						log::debug!(target: "avenos::peeroxide", "foreground heal: {e}");
					}
				});
			});

			app.manage(PeerListenGuards {
				_unlock: id_unlock,
				_lock: id_lock,
				_path: id_path,
				_foreground: id_fg,
			});

			app.manage(ctl.clone());

			log::info!(target: "avenos::peeroxide", "peer plugin ready (Hyperswarm starts after unlock)");

			if app.state::<tauri_plugin_self::state::SelfState>().is_unlocked() {
				let hh = app.clone();
				let c = ctl.clone();
				tauri::async_runtime::spawn(async move {
					if let Err(err) = c.start_swarm(hh).await {
						log::warn!(
							target: "avenos::peeroxide",
							"spawn_warm_start_failed_already_unlocked: {err}",
						);
					}
				});
			}

			Ok(())
		})
		.build()
}

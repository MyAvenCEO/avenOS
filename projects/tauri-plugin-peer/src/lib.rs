//! `tauri-plugin-peer` — Hyperswarm when AvenOS unlocks (`self:did-unlock`).
//!
//! The swarm static key uses the **same Ed25519 seed** as plugin-self / Jazz
//! (`HKDFExpand` with info `ceo.aven.os/identity/ed25519/v1` over the device root secret).

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_os = "macos")]
mod did;
#[cfg(target_os = "macos")]
mod pairing_label;
#[cfg(target_os = "macos")]
mod hyperswarm_groove_bridge;
#[cfg(target_os = "macos")]
mod commands_macos;

#[cfg(target_os = "macos")]
pub use hyperswarm_groove_bridge::HyperswarmGrooveBridge;

#[cfg(not(target_os = "macos"))]
mod commands_stub;

#[cfg(target_os = "macos")]
use tauri::generate_handler;
#[cfg(target_os = "macos")]
use tauri::Listener;
#[cfg(target_os = "macos")]
use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri::plugin::Builder;
#[cfg(target_os = "macos")]
use groove::PeerTransport as _;
#[cfg(target_os = "macos")]
use tauri::Emitter;

struct PeerListenGuards {
	#[allow(dead_code)]
	_unlock: tauri::EventId,
	#[allow(dead_code)]
	_lock: tauri::EventId,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerTransportStatusReply {
	pub hyperswarm_running: bool,
	pub local_pk_prefix_hex: String,
	/// Groove runtime ids for live Hyperswarm links (diagnostics).
	pub linked_peer_ids: Vec<String>,
	/// `did:key` of each live link — use for UI row state (matches Jazz `peers.peer_did`).
	pub linked_peer_dids: Vec<String>,
	pub pairing_code_pending: Option<String>,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PeerInviteCreateReply {
	pub code: String,
}

#[cfg(target_os = "macos")]
struct PairSession {
	topic: [u8; 32],
	code: String,
	/// This device's advertised pairing label (`first/device`).
	my_advertised_label: String,
}

#[cfg(target_os = "macos")]
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
}

#[cfg(target_os = "macos")]
struct RunningSwarm {
	swarm: peeroxide::SwarmHandle,
	actor_join: tokio::task::JoinHandle<()>,
	conns_worker: tokio::task::JoinHandle<()>,
}

#[cfg(target_os = "macos")]
const PAIR_CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

#[cfg(target_os = "macos")]
fn hex_pk_prefix(pk: &[u8]) -> String {
	pk.iter().take(8).fold(String::new(), |acc, b| acc + &format!("{b:02x}"))
}

/// Optional Hyperswarm tuning from the process environment (lab / self-hosted relays).
///
/// - `AVENOS_DHT_BOOTSTRAP`: comma-separated bootstrap strings (`ip@host:port` HyperDHT form).
/// - `AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX`: 64 hex chars → `relay_through`.
/// - `AVENOS_HYPERSWARM_RELAY_ADDR`: socket address for `relay_address` (pairs with pubkey).
/// - `AVENOS_HYPERSWARM_MAX_PARALLEL` / `AVENOS_HYPERSWARM_MAX_PEERS`: positive integers.
#[cfg(target_os = "macos")]
fn apply_avensos_swarm_env(cfg: &mut peeroxide::SwarmConfig) -> Result<(), String> {
	use std::str::FromStr;

	if let Ok(raw) = std::env::var("AVENOS_DHT_BOOTSTRAP") {
		let extras: Vec<String> = raw
			.split(',')
			.map(|s| s.trim().to_string())
			.filter(|s| !s.is_empty())
			.collect();
		let n = extras.len();
		for s in extras.into_iter().rev() {
			cfg.dht.dht.bootstrap.insert(0, s);
		}
		if n > 0 {
			log::info!(
				target: "avenos::peeroxide",
				"prepended {n} DHT bootstrap node(s) from AVENOS_DHT_BOOTSTRAP"
			);
		}
	}

	if let Ok(hex_pk) = std::env::var("AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX") {
		let bytes = hex::decode(hex_pk.trim())
			.map_err(|e| format!("AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX: invalid hex ({e})"))?;
		let arr: [u8; 32] = bytes.try_into().map_err(|_| {
			"AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX: expected exactly 32 bytes (64 hex chars)".to_string()
		})?;
		cfg.relay_through = Some(arr);
		log::info!(target: "avenos::peeroxide", "relay_through set from AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX");
	}

	if let Ok(addr_s) = std::env::var("AVENOS_HYPERSWARM_RELAY_ADDR") {
		let addr = std::net::SocketAddr::from_str(addr_s.trim())
			.map_err(|e| format!("AVENOS_HYPERSWARM_RELAY_ADDR: invalid address ({e})"))?;
		cfg.relay_address = Some(addr);
		log::info!(target: "avenos::peeroxide", "relay_address set from AVENOS_HYPERSWARM_RELAY_ADDR");
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

	Ok(())
}

#[cfg(target_os = "macos")]
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

#[cfg(target_os = "macos")]
fn pair_topic_hash(normalized_code: &str) -> [u8; 32] {
	let mut buf = Vec::with_capacity(b"aven:pair:v1:".len() + normalized_code.len());
	buf.extend_from_slice(b"aven:pair:v1:");
	buf.extend_from_slice(normalized_code.as_bytes());
	peeroxide::discovery_key(&buf)
}

/// Per-pair durable sync topic: `discovery_key("aven:peer-pair:v1:" + sort(didA,didB))`.
#[cfg(target_os = "macos")]
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

#[cfg(target_os = "macos")]
fn generate_pair_code() -> String {
	use rand::Rng;
	let mut rng = rand::thread_rng();
	(0..6)
		.map(|_| PAIR_CODE_ALPHABET[rng.gen_range(0..PAIR_CODE_ALPHABET.len())] as char)
		.collect()
}

#[cfg(target_os = "macos")]
fn pairing_advertised_label(app: &tauri::AppHandle) -> String {
	let vault = app.state::<tauri_plugin_self::vault::ActiveVault>();
	tauri_plugin_self::vault::pairing_label_for_app(app, &*vault).unwrap_or_else(|| "Peer".into())
}

/// Short-lived invite topics: fast DHT refresh + capped connect backoff in vendored peeroxide.
#[cfg(target_os = "macos")]
fn pairing_join_opts() -> peeroxide::JoinOpts {
	peeroxide::JoinOpts::fast_refresh()
}

#[cfg(target_os = "macos")]
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
#[cfg(target_os = "macos")]
async fn flush_swarm(swarm: &peeroxide::SwarmHandle) -> Result<(), String> {
	swarm
		.clone()
		.flush()
		.await
		.map_err(|e| format!("flush after join: {e}"))
}

/// Return to the UI immediately; DHT flush continues without blocking other Tauri IPC.
#[cfg(target_os = "macos")]
fn spawn_flush_background(swarm: peeroxide::SwarmHandle, label: &'static str) {
	tokio::spawn(async move {
		if let Err(e) = flush_swarm(&swarm).await {
			log::warn!(target: "avenos::peeroxide", "{label} background flush failed: {e}");
		}
	});
}

/// Pairing **requires** at least one DHT announce/lookup cycle; background-only flush broke rendezvous.
#[cfg(target_os = "macos")]
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

#[cfg(target_os = "macos")]
async fn join_pairing_topic(
	swarm: &peeroxide::SwarmHandle,
	topic: [u8; 32],
	flush_label: &'static str,
) -> Result<(), String> {
	join_topic(swarm, topic, pairing_join_opts()).await?;
	flush_swarm_for_pairing(swarm, flush_label).await
}

#[cfg(target_os = "macos")]
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

		let seed_z = app
			.state::<tauri_plugin_self::state::SelfState>()
			.with_root(|root| derive_ed25519_seed(root))?;
		let seed: [u8; 32] = *seed_z;

		let kp = peeroxide::KeyPair::from_seed(seed);
		let mut cfg = peeroxide::SwarmConfig::with_public_bootstrap();
		cfg.key_pair = Some(kp);
		cfg.max_parallel = 8;
		apply_avensos_swarm_env(&mut cfg)?;

		let (actor_join, swarm, mut conn_rx) =
			peeroxide::spawn(cfg).await.map_err(|e| format!("peeroxide spawn: {e}"))?;

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
		Ok(())
	}

	async fn handle_incoming_swarm_conn(&self, mut conn: peeroxide::SwarmConnection) {
		let remote_pk = conn.remote_public_key();
		let Ok(remote_did) = crate::did::peer_did_from_ed25519(remote_pk) else {
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
		}

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

		PeerTransportStatusReply {
			hyperswarm_running,
			local_pk_prefix_hex,
			linked_peer_ids,
			linked_peer_dids,
			pairing_code_pending,
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

	/// Force one DHT announce/lookup round when paired but Hyperswarm has no live relay yet (`SEARCHING`).
	pub async fn nudge_allowlisted_discovery(&self) -> Result<(), String> {
		if !self.jazz_hyperswarm.snapshot_remote_clients().await.is_empty() {
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
		flush_swarm_for_pairing(&swarm, "nudge allowlisted discovery").await
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
	#[cfg(target_os = "macos")]
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

	#[cfg(target_os = "macos")]
	async fn local_peer_did(&self) -> Result<String, String> {
		let guard = self.inner.lock().await;
		let running = guard
			.as_ref()
			.ok_or_else(|| "Hyperswarm is not running".to_string())?;
		let pk = running.swarm.key_pair().public_key;
		crate::did::peer_did_from_ed25519(&pk)
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
			"peer_invite_create ready code={normalized} (DHT flushed — share with other device)"
		);

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
			"peer_invite_accept ready code={normalized} (DHT flushed — awaiting host)"
		);

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
		Ok(())
	}

	async fn tear_down(&self) {
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

#[cfg(not(target_os = "macos"))]
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

#[cfg(target_os = "macos")]
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
	Builder::new("peer")
		.invoke_handler(generate_handler![
			commands_macos::peer_transport_status,
			commands_macos::peer_invite_create,
			commands_macos::peer_invite_accept,
			commands_macos::peer_invite_cancel,
		])
		.setup(|app, _plugin| {
			let jazz_hyperswarm = HyperswarmGrooveBridge::new();

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

			app.manage(PeerListenGuards {
				_unlock: id_unlock,
				_lock: id_lock,
			});

			app.manage(ctl.clone());

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

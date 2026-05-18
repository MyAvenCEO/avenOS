//! `tauri-plugin-peer` — Hyperswarm when AvenOS unlocks (`self:did-unlock`).
//!
//! The swarm static key uses the **same Ed25519 seed** as plugin-self / Jazz
//! (`HKDFExpand` with info `ceo.aven.os/identity/ed25519/v1` over the device root secret).

use std::sync::Arc;

#[cfg(target_os = "macos")]
mod did;
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
pub(crate) struct PeerTransportStatusReply {
	pub hyperswarm_running: bool,
	pub local_pk_prefix_hex: String,
	pub linked_peer_ids: Vec<String>,
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
	/// Label this device uses for the remote peer once the invite completes.
	my_label_for_remote: String,
}

#[cfg(target_os = "macos")]
#[derive(Clone)]
pub struct PeerCtl {
	inner: Arc<tokio::sync::Mutex<Option<RunningSwarm>>>,
	jazz_hyperswarm: HyperswarmGrooveBridge,
	pairing_session: Arc<tokio::sync::Mutex<Option<PairSession>>>,
	app_handle: tauri::AppHandle,
	allowed_remote_dids: Arc<tokio::sync::RwLock<std::collections::HashSet<String>>>,
	joined_pair_topics: Arc<tokio::sync::Mutex<std::collections::HashSet<[u8; 32]>>>,
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
impl PeerCtl {
	async fn start_swarm(&self, _app: tauri::AppHandle) -> Result<(), String> {
		use tauri_plugin_self::derive::derive_ed25519_seed;

		let mut guard = self.inner.lock().await;
		if guard.is_some() {
			return Ok(());
		}

		let seed_z = _app
			.state::<tauri_plugin_self::state::SelfState>()
			.with_root(|root| derive_ed25519_seed(root))?;
		let seed: [u8; 32] = *seed_z;

		let kp = peeroxide::KeyPair::from_seed(seed);
		let mut cfg = peeroxide::SwarmConfig::with_public_bootstrap();
		cfg.key_pair = Some(kp);

		let (actor_join, swarm, mut conn_rx) =
			peeroxide::spawn(cfg).await.map_err(|e| format!("peeroxide spawn: {e}"))?;

		// No shared dev topic — per-pair topics are joined via [`Self::refresh_pair_topics`].
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
		Ok(())
	}

	async fn handle_incoming_swarm_conn(&self, conn: peeroxide::SwarmConnection) {
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
			let label = {
				let pairing = self.pairing_session.lock().await;
				pairing
					.as_ref()
					.map(|s| s.my_label_for_remote.clone())
					.unwrap_or_else(|| "Peer".into())
			};
			if let Err(e) = self.app_handle.emit(
				"peer:invite-paired",
				serde_json::json!({
					"remoteDid": remote_did,
					"label": label,
				}),
			) {
				log::warn!(target: "avenos::peeroxide", "emit peer:invite-paired failed: {e}");
			}
		}

		self.jazz_hyperswarm.on_swarm_connection(conn).await;
	}

	pub(crate) async fn peer_transport_status(&self) -> PeerTransportStatusReply {
		let inner = self.inner.lock().await;
		let (hyperswarm_running, local_pk_prefix_hex) = match inner.as_ref() {
			Some(r) => {
				let pk = r.swarm.key_pair().public_key;
				(true, hex_pk_prefix(&pk))
			}
			None => (false, String::new()),
		};
		drop(inner);

		let linked_peer_ids: Vec<String> = self
			.jazz_hyperswarm
			.snapshot_remote_clients()
			.await
			.into_iter()
			.map(|id| id.to_string())
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
			pairing_code_pending,
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

		let mut guard = self.inner.lock().await;
		let Some(running) = guard.as_mut() else {
			return Ok(());
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
		for t in stale {
			let _ = running.swarm.leave(t).await;
			joined.remove(&t);
		}

		for t in want {
			if !joined.contains(&t) {
				running
					.swarm
					.clone()
					.join(t, peeroxide::JoinOpts::default())
					.await
					.map_err(|e| format!("join per-pair topic: {e}"))?;
				joined.insert(t);
			}
		}
		Ok(())
	}

	pub(crate) async fn peer_invite_create(&self) -> Result<String, String> {
		let code = generate_pair_code();
		let normalized = normalize_pair_code(&code)?;
		let topic = pair_topic_hash(&normalized);

		let mut inner = self.inner.lock().await;
		let Some(running) = inner.as_mut() else {
			return Err("Hyperswarm is not running yet — unlock identity and wait a moment.".into());
		};

		let mut pairing = self.pairing_session.lock().await;
		if let Some(prev) = pairing.take() {
			let _ = running.swarm.leave(prev.topic).await;
		}

		running
			.swarm
			.clone()
			.join(topic, peeroxide::JoinOpts::default())
			.await
			.map_err(|e| format!("pair topic join failed: {e}"))?;

		*pairing = Some(PairSession {
			topic,
			code: normalized.clone(),
			my_label_for_remote: "Peer".into(),
		});

		log::info!(
			target: "avenos::peeroxide",
			"peer_invite_create topic_joined code={normalized} (share this code with the other device)"
		);

		Ok(normalized)
	}

	pub(crate) async fn peer_invite_accept(
		&self,
		raw_code: String,
		label_for_remote: String,
	) -> Result<(), String> {
		let normalized = normalize_pair_code(&raw_code)?;
		let topic = pair_topic_hash(&normalized);

		let mut inner = self.inner.lock().await;
		let Some(running) = inner.as_mut() else {
			return Err("Hyperswarm is not running yet — unlock identity and wait a moment.".into());
		};

		// Leave a different pending pairing topic, if any.
		{
			let mut pairing = self.pairing_session.lock().await;
			if let Some(prev) = pairing.take() {
				if prev.topic != topic {
					let _ = running.swarm.leave(prev.topic).await;
				}
			}
		}

		running
			.swarm
			.clone()
			.join(topic, peeroxide::JoinOpts::default())
			.await
			.map_err(|e| format!("pair accept join failed: {e}"))?;

		drop(inner);

		let mut pairing = self.pairing_session.lock().await;
		*pairing = Some(PairSession {
			topic,
			code: normalized.clone(),
			my_label_for_remote: label_for_remote,
		});

		log::info!(
			target: "avenos::peeroxide",
			"peer_invite_accept joined pairing topic for code {normalized}"
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
				jazz_hyperswarm,
				pairing_session: Arc::new(tokio::sync::Mutex::new(None)),
				app_handle: app_h,
				allowed_remote_dids: Arc::new(tokio::sync::RwLock::new(std::collections::HashSet::new())),
				joined_pair_topics: Arc::new(tokio::sync::Mutex::new(std::collections::HashSet::new())),
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

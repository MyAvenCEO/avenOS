use std::collections::VecDeque;
use std::fmt::Write as _;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};

use tracing::{
	field::{Field, Visit},
	span::{Attributes, Id, Record},
	Event, Level, Metadata, Subscriber,
};

/// Bumped above the previous 200 so we don't lose context across a single
/// pairing attempt — aven-p2p tracing chatters once we bridge it into `log`.
const MAX_LINES: usize = 600;

static RING: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();

/// Set once aven-p2p DHT RPC layer emits "DHT node bootstrapped" — proves a UDP
/// reply to the bootstrap node ROUND-TRIPPED. On iOS we routinely see `closest=0`
/// without ever observing this, which means UDP outbound was silently dropped.
static DHT_BOOTSTRAPPED: AtomicBool = AtomicBool::new(false);

/// Saturating count of `aven_p2p::peer_discovery: announce complete closest=N` lines we
/// have seen. Stays at `0` when announce had no reachable nodes (router/firewall ate UDP).
static LAST_ANNOUNCE_CLOSEST: AtomicUsize = AtomicUsize::new(0);

/// Last `peer_count` field seen on `aven_p2p::peer_discovery: lookup result ... peer_count=N`.
/// Includes self-announce, so `1` on a quiet topic = "only me", `>=2` = "found someone else".
static LAST_LOOKUP_PEER_COUNT: AtomicUsize = AtomicUsize::new(0);

/// Total `discovered peer pk=...` lines (across all topics & relookups). A counter, not a state.
static DISCOVERED_PEER_TOTAL: AtomicU64 = AtomicU64::new(0);

/// DHT forwarded a `PEER_HANDSHAKE` between two peers (`aven_p2p::dht::hyperdht`, INFO).
static HANDSHAKE_RELAY_FORWARD_TOTAL: AtomicU64 = AtomicU64::new(0);

/// Outbound `aven_p2p::swarm` path established a UDX connection (`peer connected`, DEBUG).
static SWARM_PEER_CONNECTED_TOTAL: AtomicU64 = AtomicU64::new(0);

/// Tri-state for last `aven_p2p::dht::hyperdht`: `handshake complete, deciding connection path`
/// structured fields (`0` unseen, `1` false, `2` true).
static LAST_HS_PATH_RELAYED: AtomicU8 = AtomicU8::new(0);
static LAST_HS_REMOTE_HOLEPUNCHABLE: AtomicU8 = AtomicU8::new(0);

/// Count of blind-relay fallbacks (`holepunch failed — falling back to blind relay`, DEBUG).
static BLIND_RELAY_FALLBACK_TOTAL: AtomicU64 = AtomicU64::new(0);

const TRI_FALSE: u8 = 1;
const TRI_TRUE: u8 = 2;

#[inline]
fn tri_load_bool(v: u8) -> Option<bool> {
	match v {
		TRI_TRUE => Some(true),
		TRI_FALSE => Some(false),
		_ => None,
	}
}

#[inline]
fn tri_store_bool(a: &AtomicU8, b: bool) {
	a.store(if b { TRI_TRUE } else { TRI_FALSE }, Ordering::Relaxed);
}

/// Snapshot of the DHT-side counters used by `peer_transport_status` diagnostics.
pub struct DhtTraceSnapshot {
	pub bootstrapped: bool,
	pub last_announce_closest: usize,
	pub last_lookup_peer_count: usize,
	pub discovered_peer_total: u64,
	pub handshake_relay_forward_total: u64,
	pub swarm_peer_connected_total: u64,
	/// Last `relayed=` from `hyperdht` “deciding connection path” (after Noise completes).
	pub last_connect_relayed: Option<bool>,
	/// Last `remote_holepunchable=` from the same line.
	pub last_remote_holepunchable: Option<bool>,
	/// How often we fell back to blind relay after holepunch failure.
	pub blind_relay_fallback_total: u64,
}

pub fn dht_trace_snapshot() -> DhtTraceSnapshot {
	DhtTraceSnapshot {
		bootstrapped: DHT_BOOTSTRAPPED.load(Ordering::Relaxed),
		last_announce_closest: LAST_ANNOUNCE_CLOSEST.load(Ordering::Relaxed),
		last_lookup_peer_count: LAST_LOOKUP_PEER_COUNT.load(Ordering::Relaxed),
		discovered_peer_total: DISCOVERED_PEER_TOTAL.load(Ordering::Relaxed),
		handshake_relay_forward_total: HANDSHAKE_RELAY_FORWARD_TOTAL.load(Ordering::Relaxed),
		swarm_peer_connected_total: SWARM_PEER_CONNECTED_TOTAL.load(Ordering::Relaxed),
		last_connect_relayed: tri_load_bool(LAST_HS_PATH_RELAYED.load(Ordering::Relaxed)),
		last_remote_holepunchable: tri_load_bool(
			LAST_HS_REMOTE_HOLEPUNCHABLE.load(Ordering::Relaxed),
		),
		blind_relay_fallback_total: BLIND_RELAY_FALLBACK_TOTAL
			.load(Ordering::Relaxed),
	}
}

fn ring() -> &'static Mutex<VecDeque<String>> {
	RING.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_LINES)))
}

pub fn push_line(line: String) {
	let mut guard = ring()
		.lock()
		.unwrap_or_else(|poisoned| poisoned.into_inner());
	if guard.len() >= MAX_LINES {
		guard.pop_front();
	}
	guard.push_back(line);
}

pub fn recent_lines() -> Vec<String> {
	ring()
		.lock()
		.unwrap_or_else(|poisoned| poisoned.into_inner())
		.iter()
		.cloned()
		.collect()
}

#[derive(Default)]
struct MessageVisitor {
	buf: String,
	/// Captured field values for DHT lifecycle scraping (only populated when the
	/// event's target / level indicates we might care).
	closest: Option<u64>,
	peer_count: Option<u64>,
	relayed: Option<bool>,
	remote_holepunchable: Option<bool>,
}

impl Visit for MessageVisitor {
	fn record_u64(&mut self, field: &Field, value: u64) {
		match field.name() {
			"closest" => self.closest = Some(value),
			"peer_count" => self.peer_count = Some(value),
			_ => {}
		}
		let _ = write!(self.buf, " {}={value}", field.name());
	}

	fn record_bool(&mut self, field: &Field, value: bool) {
		match field.name() {
			"relayed" => self.relayed = Some(value),
			"remote_holepunchable" => self.remote_holepunchable = Some(value),
			_ => {}
		}
		let _ = write!(self.buf, " {}={value}", field.name());
	}

	fn record_i64(&mut self, field: &Field, value: i64) {
		let _ = write!(self.buf, " {}={value}", field.name());
	}

	fn record_str(&mut self, field: &Field, value: &str) {
		if field.name() == "message" {
			self.buf.push_str(value);
		} else {
			let _ = write!(self.buf, " {}={value}", field.name());
		}
	}

	fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
		if field.name() == "message" {
			let _ = write!(self.buf, "{value:?}");
		} else {
			let _ = write!(self.buf, " {}={value:?}", field.name());
		}
	}
}

/// `aven-p2p` and `groove` use `tracing::debug!`/`warn!` for the
/// announce / lookup / connect lifecycle. With no `tracing` subscriber installed,
/// those events vanish — so the diagnostics panel never showed pairing flow logs.
///
/// This subscriber forwards every event into the `log` crate. The Apple `log::Log`
/// implementation in `lib.rs` then routes the message into `log_ring` (for the
/// in-app diagnostics buffer) and `os_log` (subsystem `ceo.aven.os`).
pub struct LogForwardSubscriber;

static SPAN_ID: AtomicU64 = AtomicU64::new(1);

impl Subscriber for LogForwardSubscriber {
	fn enabled(&self, metadata: &Metadata<'_>) -> bool {
		let target = metadata.target();
		let level = *metadata.level();

		// `groove::query_manager` emits a debug line per subscription creation/delta —
		// they flood the in-app ring buffer before any P2P pairing logs land. Keep warn+.
		if target.starts_with("groove::query_manager") && level > Level::WARN {
			return false;
		}

		// `aven_p2p::dht::io` is the per-datagram RPC layer (encode/decode). Way too chatty
		// at debug; we only care about `send_to failed` etc.
		if target.starts_with("aven_p2p::dht::io") && level > Level::WARN {
			return false;
		}

		// Standalone DHT query trace is also too chatty.
		if target.starts_with("aven_p2p::dht::query") && level > Level::INFO {
			return false;
		}

		true
	}

	fn new_span(&self, _: &Attributes<'_>) -> Id {
		Id::from_u64(SPAN_ID.fetch_add(1, Ordering::Relaxed))
	}

	fn record(&self, _: &Id, _: &Record<'_>) {}
	fn record_follows_from(&self, _: &Id, _: &Id) {}

	fn event(&self, event: &Event<'_>) {
		let meta = event.metadata();
		let level = match *meta.level() {
			Level::TRACE => log::Level::Trace,
			Level::DEBUG => log::Level::Debug,
			Level::INFO => log::Level::Info,
			Level::WARN => log::Level::Warn,
			Level::ERROR => log::Level::Error,
		};
		let target = meta.target();
		let mut visitor = MessageVisitor::default();
		event.record(&mut visitor);

		// Scrape DHT lifecycle counters so peer_transport_status can surface them in JSON.
		// `peer_transport_status` reads atomics via `dht_trace_snapshot()`.
		if target == "aven_p2p::dht::rpc" && visitor.buf.contains("DHT node bootstrapped") {
			DHT_BOOTSTRAPPED.store(true, Ordering::Relaxed);
		}
		if target == "aven_p2p::peer_discovery" {
			if let Some(closest) = visitor.closest {
				if visitor.buf.starts_with("announce complete") {
					LAST_ANNOUNCE_CLOSEST.store(closest as usize, Ordering::Relaxed);
				}
			}
			if let Some(peer_count) = visitor.peer_count {
				if visitor.buf.starts_with("lookup result") {
					LAST_LOOKUP_PEER_COUNT.store(peer_count as usize, Ordering::Relaxed);
				}
			}
			if visitor.buf.starts_with("discovered peer") {
				DISCOVERED_PEER_TOTAL.fetch_add(1, Ordering::Relaxed);
			}
		}
		if target == "aven_p2p::dht::hyperdht" && visitor.buf.contains("handshake RELAY — forwarding between peers") {
			HANDSHAKE_RELAY_FORWARD_TOTAL.fetch_add(1, Ordering::Relaxed);
		}
		if target == "aven_p2p::dht::hyperdht" && *meta.level() == Level::DEBUG {
			if let Some(v) = visitor.relayed {
				tri_store_bool(&LAST_HS_PATH_RELAYED, v);
			}
			if let Some(v) = visitor.remote_holepunchable {
				tri_store_bool(&LAST_HS_REMOTE_HOLEPUNCHABLE, v);
			}
			if visitor.buf.contains("blind-relay pair failed")
				|| (visitor.buf.contains("holepunch failed") && visitor.buf.contains("blind relay"))
			{
				BLIND_RELAY_FALLBACK_TOTAL.fetch_add(1, Ordering::Relaxed);
			}
		}
		if target == "aven_p2p::swarm" && visitor.buf.contains("peer connected") {
			SWARM_PEER_CONNECTED_TOTAL.fetch_add(1, Ordering::Relaxed);
		}

		let message = visitor.buf;

		log::logger().log(
			&log::Record::builder()
				.level(level)
				.target(target)
				.args(format_args!("{message}"))
				.build(),
		);
	}

	fn enter(&self, _: &Id) {}
	fn exit(&self, _: &Id) {}
}

/// Install the tracing → log bridge. Safe to call multiple times; only the first
/// call wins (`set_global_default` is one-shot).
pub fn init_tracing_bridge() {
	let _ = tracing::subscriber::set_global_default(LogForwardSubscriber);
}

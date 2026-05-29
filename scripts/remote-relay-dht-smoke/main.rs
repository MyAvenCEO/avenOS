//! Quick remote-relay DHT smoke: role `a` announces, role `b` looks up.
//!
//!   RUST_LOG=info cargo run -q --manifest-path scripts/Cargo.remote-relay-dht.toml --bin test-remote-relay-dht
//!   ROLE=a BOOTSTRAP=relay.aven.ceo:49737 ... &
//!   ROLE=b BOOTSTRAP=relay.aven.ceo:49737 ...

use aven_p2p::dht::crypto::hash;
use aven_p2p::dht::hyperdht::{spawn, HyperDhtConfig, KeyPair};
use aven_p2p::dht::messages::Ipv4Peer;
use aven_p2p::dht::rpc::DhtConfig;
use libudx::UdxRuntime;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
	tracing_subscriber::fmt()
		.with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
		.init();

	let bootstrap = std::env::var("BOOTSTRAP").unwrap_or_else(|_| "relay.aven.ceo:49737".into());
	let role = std::env::var("ROLE").unwrap_or_else(|_| "a".into());
	let topic = hash(b"aven-remote-relay-smoke");

	let mut dht_cfg = DhtConfig::default();
	dht_cfg.bootstrap = vec![bootstrap.clone()];
	let mut cfg = HyperDhtConfig::default();
	cfg.dht = dht_cfg;

	let rt = UdxRuntime::new()?;
	let (_j, dht, _srv) = spawn(&rt, cfg).await?;
	dht.bootstrapped().await?;
	let local_port = dht.dht().local_port().await?;
	eprintln!("[{role}] bootstrapped via {bootstrap} (local_udp={local_port})");

	let kp = KeyPair::generate();
	let relays = vec![Ipv4Peer {
		host: "127.0.0.1".into(),
		port: local_port,
	}];

	let ping_host = bootstrap
		.rsplit_once(':')
		.map(|(h, _)| h.split('@').next().unwrap_or(h))
		.unwrap_or("relay.aven.ceo");
	let ping_port: u16 = bootstrap
		.rsplit(':')
		.next()
		.and_then(|p| p.parse().ok())
		.unwrap_or(49737);
	match dht.dht().ping(ping_host, ping_port).await {
		Ok(_r) => eprintln!("[{role}] ping {ping_host}:{ping_port} ok"),
		Err(e) => eprintln!("[{role}] ping {ping_host}:{ping_port} FAILED: {e}"),
	}
	let (sent, recv) = dht.wire_stats();
	eprintln!("[{role}] wire_stats after ping: sent={sent} recv={recv}");

	if role == "a" {
		let ann = dht.announce(topic, &kp, &relays).await?;
		eprintln!(
			"[a] announce ok closest_nodes={} topic={}",
			ann.closest_nodes.len(),
			hex::encode(topic)
		);
		for n in &ann.closest_nodes {
			eprintln!("[a]   closest {}:{}", n.host, n.port);
		}
		if ann.closest_nodes.is_empty() {
			eprintln!("[a] FAIL: no closest nodes — bootstrap DHT unreachable?");
		}
		tokio::time::sleep(std::time::Duration::from_secs(20)).await;
	} else {
		tokio::time::sleep(std::time::Duration::from_secs(4)).await;
		for i in 0..8 {
			let res = dht.lookup(topic).await?;
			let peers: usize = res.iter().map(|r| r.peers.len()).sum();
			eprintln!("[b] lookup #{i} result_groups={} peers={}", res.len(), peers);
			if peers > 0 {
				eprintln!("[b] SUCCESS — remote DHT rendezvous works");
				return Ok(());
			}
			tokio::time::sleep(std::time::Duration::from_secs(2)).await;
		}
		eprintln!("[b] FAIL: lookup never found announced peer");
	}
	Ok(())
}

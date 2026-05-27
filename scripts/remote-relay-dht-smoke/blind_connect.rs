//! Smoke: Rust HyperDHT client → Fly co-hosted blind-relay (UDP 49737).
//!
//!   RUST_LOG=peeroxide_dht=debug cargo run -q --manifest-path scripts/remote-relay-dht-smoke/Cargo.toml --bin test-remote-relay-blind

use peeroxide_dht::hyperdht::{spawn, HyperDhtConfig, KeyPair};
use peeroxide_dht::rpc::DhtConfig;
use libudx::UdxRuntime;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
	tracing_subscriber::fmt()
		.with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
		.init();

	let bootstrap = std::env::var("BOOTSTRAP").unwrap_or_else(|_| "137.66.21.59@relay.aven.ceo:49737".into());
	let relay_pk_hex = std::env::var("RELAY_PK").expect("RELAY_PK (64 hex)");
	let relay_addr: std::net::SocketAddr = std::env::var("RELAY_ADDR")
		.unwrap_or_else(|_| "137.66.21.59:49737".into())
		.parse()?;

	let mut pk = [0u8; 32];
	let bytes = hex::decode(relay_pk_hex.trim())?;
	pk.copy_from_slice(&bytes[..32]);

	let mut dht_cfg = DhtConfig::default();
	dht_cfg.bootstrap = vec![bootstrap.clone()];
	let mut cfg = HyperDhtConfig::default();
	cfg.dht = dht_cfg;

	let rt = UdxRuntime::new()?;
	let (_j, dht, _srv) = spawn(&rt, cfg).await?;
	dht.bootstrapped().await?;
	eprintln!("[blind] bootstrapped via {bootstrap}");

	let kp = KeyPair::generate();
	for attempt in 0..5 {
		eprintln!("[blind] connect_to attempt {attempt} → {relay_addr}");
		let fut = dht.connect_to(&kp, pk, relay_addr, &rt);
		match tokio::time::timeout(std::time::Duration::from_secs(15), fut).await {
			Ok(Ok(conn)) => {
				eprintln!(
					"[blind] SUCCESS remote_addr={:?} pk={}",
					conn.remote_addr,
					hex::encode(&conn.remote_public_key[..8])
				);
				return Ok(());
			}
			Ok(Err(e)) => eprintln!("[blind] connect_to err: {e}"),
			Err(_) => eprintln!("[blind] connect_to timeout (15s)"),
		}
		tokio::time::sleep(std::time::Duration::from_secs(2)).await;
	}

	eprintln!("[blind] FAIL — could not reach blind-relay at {relay_addr}");
	std::process::exit(1);
}

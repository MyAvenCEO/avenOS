//! aven-p2p — peeroxide Hyperswarm transport for AvenOS spark sync.
//!
//! Two things live here:
//!  - swarm **config + topic** helpers (`spark_topic`, `device_keypair`,
//!    `local_bootstrap_config`, `member_config`) used by the app and `aven-server`
//!    to join the mesh against a local or public HyperDHT bootstrap;
//!  - [`HyperswarmTransport`] (P1) — one `impl groove::SyncTransport` over
//!    peeroxide, swapped in exactly where the dev TCP transport wired in.
//!
//! Identity is the free win (plan §2.7): the swarm `KeyPair` is derived from the
//! device's 32-byte Ed25519 root seed, so a peer's Noise-authenticated
//! `remote_public_key()` *is* its biscuit-subject did:key.

#![forbid(unsafe_code)]

use peeroxide::{discovery_key, JoinOpts, KeyPair, SwarmConfig};

mod transport;
pub use transport::HyperswarmTransport;

/// Build `JoinOpts` (a `#[non_exhaustive]` struct) from server/client flags.
/// `server` announces on the topic (avens); `client` looks up (devices).
pub fn join_opts(server: bool, client: bool) -> JoinOpts {
    let mut opts = JoinOpts::default();
    opts.server = server;
    opts.client = client;
    opts
}

/// Derive the 32-byte swarm topic for a spark URN (e.g. `"spark:<UUID>"`).
/// BLAKE2b-256 via peeroxide's `discovery_key` — never roll our own.
pub fn spark_topic(spark_urn: &str) -> [u8; 32] {
    discovery_key(spark_urn.as_bytes())
}

/// The device identity for the swarm: Ed25519 derived from the 32-byte root
/// seed. `key_pair.public_key` equals the device's did:key pubkey, so the
/// Noise-authenticated `remote_public_key()` of a peer *is* its biscuit DID.
pub fn device_keypair(root_seed: &[u8; 32]) -> KeyPair {
    KeyPair::from_seed(*root_seed)
}

/// Config for a **local bootstrap DHT node** bound to `127.0.0.1:port` — empty
/// bootstrap (it is the DHT root) and non-ephemeral (it serves queries). This is
/// the offline dev DHT both `dev:app2x` instances point at; no public network.
pub fn local_bootstrap_config(port: u16) -> SwarmConfig {
    // peeroxide's config structs are `#[non_exhaustive]` — construct via the
    // crate's own ctors and mutate public fields (no struct literals).
    let mut cfg = SwarmConfig::default();
    cfg.dht.dht.bootstrap = vec![];
    cfg.dht.dht.host = "127.0.0.1".to_string();
    cfg.dht.dht.port = port;
    cfg.dht.dht.ephemeral = Some(false);
    cfg.dht.dht.firewalled = false;
    cfg
}

/// Config for a swarm **member** (device or aven). `seed` binds the swarm
/// identity to the device root key. An empty `bootstrap` uses the public
/// HyperDHT; otherwise it bootstraps to the given addresses (e.g.
/// `["127.0.0.1:49737"]` for the offline dev mesh).
pub fn member_config(seed: [u8; 32], bootstrap: Vec<String>) -> SwarmConfig {
    let mut cfg = if bootstrap.is_empty() {
        SwarmConfig::with_public_bootstrap()
    } else {
        let mut c = SwarmConfig::default();
        c.dht.dht.bootstrap = bootstrap;
        c.dht.dht.host = "127.0.0.1".to_string();
        c.dht.dht.port = 0;
        c.dht.dht.ephemeral = Some(false);
        c.dht.dht.firewalled = false;
        c
    };
    cfg.key_pair = Some(KeyPair::from_seed(seed));
    cfg
}

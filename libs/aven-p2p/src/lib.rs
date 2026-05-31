#![forbid(unsafe_code)]
#![deny(missing_docs)]
#![deny(clippy::all)]

//! AvenOS vendored Hyperswarm / HyperDHT stack (peeroxide@1.3.1 + AvenOS patches).
//!
//! - [`dht`] — HyperDHT, Noise, blind-relay (always available)
//! - Swarm API (`spawn`, `SwarmConfig`, …) — enabled with the `swarm` feature (default)

/// HyperDHT protocol stack.
pub mod dht;

mod util;

#[cfg(feature = "swarm")]
mod connection_set;
#[cfg(feature = "swarm")]
mod error;
#[cfg(feature = "swarm")]
mod peer_discovery;
#[cfg(feature = "swarm")]
mod peer_info;
#[cfg(feature = "swarm")]
mod swarm;

#[cfg(feature = "swarm")]
pub use error::SwarmError;
#[cfg(feature = "swarm")]
pub use peer_info::{PeerInfo, Priority};
#[cfg(feature = "swarm")]
pub use swarm::{spawn, JoinOpts, SwarmConfig, SwarmConnection, SwarmHandle};

#[cfg(feature = "swarm")]
pub use dht::crypto::hash as discovery_key;
#[cfg(feature = "swarm")]
pub use dht::hyperdht::{
	HyperDhtHandle, ImmutablePutResult, KeyPair, MutableGetResult, MutablePutResult,
	DEFAULT_BOOTSTRAP,
};

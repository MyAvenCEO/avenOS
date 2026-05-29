//! HyperDHT protocol stack (fork of peeroxide-dht@1.3.1).

/// Blind relay for proxying encrypted traffic between peers behind restrictive NATs.
pub mod blind_relay;
/// Optional connect-progress hooks for UI surfaces.
pub mod connect_ui;
/// Compact binary encoding primitives compatible with the
/// [compact-encoding](https://github.com/holepunchto/compact-encoding) wire format.
pub mod compact_encoding;
/// BLAKE2b hashing, Ed25519 signing, and namespace derivation helpers.
pub mod crypto;
/// High-level HyperDHT node: peer discovery, announce/unannounce, mutable/immutable
/// storage, and Noise-encrypted connections.
pub mod hyperdht;
/// Wire-format message types for HyperDHT peer handshake, holepunch, and relay
/// operations.
pub mod hyperdht_messages;
/// DHT RPC request/response message encoding and decoding.
pub mod messages;
/// Noise IK handshake for establishing shared secrets between peers.
pub mod noise;
/// Noise handshake wrapper that adds framing and key splitting for stream encryption.
pub mod noise_wrap;
/// Lightweight multiplexer for running multiple channels over a single connection.
pub mod protomux;
/// DHT RPC transport layer: request dispatch, reply handling, and node communication.
pub mod rpc;
/// Noise-encrypted bidirectional byte stream over any `AsyncRead + AsyncWrite` transport.
pub mod secret_stream;

#[doc(hidden)]
pub mod holepuncher;
/// Local LAN IPv4 enumeration for Noise `addresses4`.
pub mod local_addresses;
#[doc(hidden)]
pub mod io;
#[doc(hidden)]
pub mod nat;
#[doc(hidden)]
pub mod peer;
#[doc(hidden)]
pub mod persistent;
#[doc(hidden)]
pub mod query;
#[doc(hidden)]
pub mod router;
#[doc(hidden)]
pub mod routing_table;
#[doc(hidden)]
pub mod secretstream;
#[doc(hidden)]
pub mod secure_payload;
#[doc(hidden)]
pub mod socket_pool;

//! AvenOS authenticated sync transport.
//!
//! Two `impl groove::SyncTransport`s over one encrypted TLS wire (plan §2):
//!
//! - [`ServerSyncTransport`] — the **client** side a device dials with. It opens
//!   a TLS connection (server authenticated by its cert), completes a **did:key
//!   challenge** (the device proves it holds its DID private key, bound to the
//!   TLS session), then runs the length-prefixed frame pump.
//! - [`ServerListener`] — the **server** side the always-on aven runs. It accepts
//!   N clients on one TLS listener, runs the challenge per connection, and
//!   maintains a `PeerId → connection` registry; its `SyncTransport` routes /
//!   fans frames out by target.
//!
//! Security model (never conflated — plan §2.7): **TLS** encrypts the channel and
//! authenticates the *server*; the **did:key challenge** authenticates the
//! *client*; the engine's biscuit gate (`may_sync`) still authorizes every frame.

#![forbid(unsafe_code)]

pub mod challenge;
pub mod tls;
pub mod transport;
pub mod ws_client;

pub use challenge::ChallengeParams;
pub use tls::{generate_self_signed, ServerTls, ServerTrust};
pub use transport::{ServerListener, ServerSyncTransport};
pub use ws_client::WsClientTransport;

/// Errors from the transport + handshake.
#[derive(Debug, thiserror::Error)]
pub enum P2pError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("tls: {0}")]
    Tls(String),
    #[error("handshake: {0}")]
    Handshake(String),
    #[error("config: {0}")]
    Config(String),
}

pub type Result<T> = std::result::Result<T, P2pError>;

//! Back-compat re-exports — [`PeerLinkCoordinator`] owns link phase authority.

#![cfg(any(target_os = "macos", target_os = "ios"))]

pub use crate::peer_link::LiveLinkRegistry;

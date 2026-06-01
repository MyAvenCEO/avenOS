//! Placeholder crate — future sync transport implementations live here.
//!
//! The app and `aven-db` use [`groove::NullSyncTransport`] for local-only mode.
//! When networking returns, implement [`groove::SyncTransport`] in a new crate and
//! wire it from the app host.

#![forbid(unsafe_code)]

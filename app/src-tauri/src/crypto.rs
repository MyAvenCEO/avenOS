//! Per-spark DEK envelopes + cell sealing.
//!
//! Moved to the shared [`aven_caps::crypto`] crate (single source of truth, also
//! used by the `aven-server`). Re-exported here so existing `crate::crypto::…`
//! call sites are unchanged. See `docs/ServerRootedAvenCeoPlan.md`.

pub use aven_caps::crypto::*;

//! AvenOS shared capability + keyshare primitives.
//!
//! The single source of truth for biscuit-based capabilities ([`caps`]) and the
//! per-spark DEK keyshare crypto ([`crypto`]), shared by the device app
//! (`app/src-tauri`) and the `aven-server` so both mint/verify caps and wrap
//! keyshares with **one** implementation (DRY). See
//! `docs/CryptoOwnershipExecutionPlan.md`.

pub mod caps;
pub mod crypto;
pub mod ownership;

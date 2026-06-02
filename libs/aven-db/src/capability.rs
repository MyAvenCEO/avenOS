//! Capability gate for peer sync — **the single authorizer**.
//!
//! Replaces the coarse `SyncAuthorizer::may_deliver(target, payload)` and the
//! deleted ReBAC path with one structured question: may `subject` perform `op`
//! on `resource`? The result is **three-state** so the pairing / bootstrap
//! window is correct — `Pending` (ACL not hydrated yet) DEFERS, it never drops.
//!
//! The engine knows nothing about biscuits or sparks: the app's
//! `BiscuitCapabilityResolver` is the only capability-aware implementation.

use crate::frontier::FrontierDag;
use crate::object::ObjectId;
use crate::sync_targets::SyncTargetId;

/// Access operation a peer is attempting over a resource.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccOp {
    Read,
    Write,
    Delete,
    /// Blind store-and-forward: the peer may **hold and relay** a resource's
    /// (encrypted) batches without being a member — it never receives a keyshare,
    /// so it cannot decrypt. Granted to server avens added as replication peers.
    Replicate,
}

/// Gate decision.
///
/// `Pending` means "the ACL for this resource is not hydrated yet" → the caller
/// must DEFER (re-ask later), never drop the frame. Only `DenyPermanent` is terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapDecision {
    Allow,
    DenyPermanent,
    Pending,
}

/// Opaque hierarchical resource coordinate (e.g. `"spark:S:todos:ROW"`).
///
/// The engine treats `urn` as **opaque** — spark / table / row granularity lives
/// entirely in how the app builds the URN and mints grants. Adding a level is a
/// grant + URN-builder change with zero engine change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceCoord {
    pub urn: String,
    pub table: String,
    pub row_id: ObjectId,
}

impl ResourceCoord {
    pub fn new(urn: impl Into<String>, table: impl Into<String>, row_id: ObjectId) -> Self {
        Self {
            urn: urn.into(),
            table: table.into(),
            row_id,
        }
    }
}

/// The one gate. Every outbound peer frame passes exactly one `may_sync`, at every hop.
pub trait CapabilityResolver: Send + Sync {
    fn may_sync(&self, subject: &SyncTargetId, op: AccOp, res: &ResourceCoord) -> CapDecision;
}

/// Permissive default — local-only mode and tests.
#[derive(Debug, Default, Clone, Copy)]
pub struct AllowAllResolver;

impl CapabilityResolver for AllowAllResolver {
    fn may_sync(&self, _subject: &SyncTargetId, _op: AccOp, _res: &ResourceCoord) -> CapDecision {
        CapDecision::Allow
    }
}

/// Deny-all default — local-only mode at the transport layer.
#[derive(Debug, Default, Clone, Copy)]
pub struct DenyAllResolver;

impl CapabilityResolver for DenyAllResolver {
    fn may_sync(&self, _subject: &SyncTargetId, _op: AccOp, _res: &ResourceCoord) -> CapDecision {
        CapDecision::DenyPermanent
    }
}

/// Per-hop gated reconcile (§6 "Gate") — the one integration point of gate ⨯ tracker.
///
/// Transfer the batches `subject` is owed from `source` **only** when `may_sync`
/// returns `Allow`. `DenyPermanent` and `Pending` transfer **nothing new** and
/// **never delete** what `dest` already holds — revoke is not retroactive
/// (it stops future changes; a peer keeps what it already received). Applying the
/// gate here, at every hop, means a batch only flows along fully-authorized paths.
///
/// Returns the number of batches transferred (0 when gated off).
pub fn gated_pull(
    dest: &mut FrontierDag,
    source: &FrontierDag,
    resolver: &dyn CapabilityResolver,
    subject: &SyncTargetId,
    res: &ResourceCoord,
) -> usize {
    match resolver.may_sync(subject, AccOp::Read, res) {
        CapDecision::Allow => dest.pull_from(source),
        // Deny terminates; Pending defers to a later round — neither sends now,
        // neither touches already-held batches.
        CapDecision::DenyPermanent | CapDecision::Pending => 0,
    }
}

// Tests live in `tests/capability_gate.rs` (integration target, `client-p2p`).

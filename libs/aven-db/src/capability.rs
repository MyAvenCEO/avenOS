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

/// Row-metadata key the **owner-binding** travels under (base64), read back as opaque
/// `proof` bytes by [`CapabilityResolver::verify_on_apply`] on the inbound apply path.
/// Must match `aven_caps::ownership::OWNER_BINDING_META_KEY` — the engine cannot depend
/// on `aven-caps` (the dependency points the other way), so the literal is duplicated and
/// kept in sync by this note.
pub const OWNER_BINDING_META_KEY: &str = "_owner_binding";

/// The one gate. Every outbound peer frame passes exactly one `may_sync`, at every hop.
pub trait CapabilityResolver: Send + Sync {
    fn may_sync(&self, subject: &SyncTargetId, op: AccOp, res: &ResourceCoord) -> CapDecision;

    /// Inbound apply gate (§Phase 2 of the Ownership & Caps master plan): verify a
    /// received batch **before it is persisted**, so a forged or relabeled batch from a
    /// malicious peer is rejected — not merely withheld outbound. The engine stays
    /// crypto-agnostic: it passes the sender `subject`, the `op`, the `res`ource, the
    /// content `digest` **it computed itself**, and the opaque `proof` bytes that
    /// travelled with the batch (the app's serialized author edit-signature + signed
    /// owner-binding). The app's `BiscuitCapabilityResolver` deserializes + verifies them
    /// via `aven-caps` (`authorize_signed_edit`).
    ///
    /// Three-state like [`may_sync`]: `Allow` → persist; `DenyPermanent` → reject;
    /// `Pending` → defer (vault/ACL not hydrated yet), never drop. **Default is `Allow`**
    /// so permissive/local engines and tests are unchanged; production installs a
    /// resolver that denies by default and only allows on a valid proof.
    fn verify_on_apply(
        &self,
        subject: &SyncTargetId,
        op: AccOp,
        res: &ResourceCoord,
        digest: &[u8; 32],
        proof: Option<&[u8]>,
    ) -> CapDecision {
        let _ = (subject, op, res, digest, proof);
        CapDecision::Allow
    }

    /// Per-resource **inbound storage quota** (an aven-node relay policy; clients return
    /// `None`). Given a row's metadata, returns `(quota_key, limit_bytes)` — the engine
    /// accumulates **distinct-row** bytes per key and **rejects** (never deletes) inbound
    /// writes that would push a key over its limit. Default `None` = unbounded (unchanged).
    fn quota_for(&self, proof: Option<&[u8]>) -> Option<(String, u64)> {
        let _ = proof;
        None
    }
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
    /// Fail-closed on inbound apply too: a peer with no real resolver installed
    /// rejects every inbound batch rather than silently accepting (M4 hardening).
    fn verify_on_apply(
        &self,
        _subject: &SyncTargetId,
        _op: AccOp,
        _res: &ResourceCoord,
        _digest: &[u8; 32],
        _proof: Option<&[u8]>,
    ) -> CapDecision {
        CapDecision::DenyPermanent
    }
}

/// May a peer **hold** (store/receive) a resource's batches? True for a member
/// (`Write`) OR a blind replication peer (`Replicate`) — a server aven that
/// stores & forwards the (encrypted) batches without a keyshare. `Replicate` is
/// only consulted when membership doesn't already authorize, and the membership
/// decision is preserved otherwise so `Pending` still DEFERS (never drops). This
/// is the forwarding gate's single decision (`ship_frontier_diff`).
pub fn may_hold(
    resolver: &dyn CapabilityResolver,
    subject: &SyncTargetId,
    res: &ResourceCoord,
) -> CapDecision {
    match resolver.may_sync(subject, AccOp::Write, res) {
        CapDecision::Allow => CapDecision::Allow,
        write => match resolver.may_sync(subject, AccOp::Replicate, res) {
            CapDecision::Allow => CapDecision::Allow,
            // Not a replica either → keep the membership verdict (Pending defers).
            _ => write,
        },
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

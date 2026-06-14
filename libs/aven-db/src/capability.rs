//! Capability gate for peer sync — **the single authorizer**.
//!
//! Replaces the coarse `SyncAuthorizer::may_deliver(target, payload)` and the
//! deleted ReBAC path with one structured question: may `subject` perform `op`
//! on `resource`? The result is **three-state** so the pairing / bootstrap
//! window is correct — `Pending` (ACL not hydrated yet) DEFERS, it never drops.
//!
//! The engine knows nothing about biscuits or sparks: the app's
//! `BiscuitCapabilityResolver` is the only capability-aware implementation.

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

/// Project the owning SAFE's UUID out of an [`OWNER_BINDING_META_KEY`] metadata string,
/// WITHOUT verifying the signature (verification is the app's job on the apply path via
/// `aven-caps`). The engine needs the owner only as a **query discriminator** — ownership
/// truth still lives solely in the signed binding; this is a read-only projection of it,
/// not a second source. It lets `filter_eq("$owner", …)` resolve against the immutable
/// header instead of a mutable `owner` data column (board 0037).
///
/// Layout (must match `aven_caps::ownership::OwnerBinding::encode`, kept in sync by this
/// note — the engine cannot depend on `aven-caps`): base64(no-pad) of
/// `value_id(16) ‖ owner(16) ‖ sig(64) ‖ author_did`, so the owner is bytes `[16..32]`.
pub fn owner_uuid_from_binding_meta(meta: &str) -> Option<uuid::Uuid> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(meta.as_bytes())
        .ok()?;
    let owner = bytes.get(16..32)?;
    uuid::Uuid::from_slice(owner).ok()
}

/// Row-metadata key the per-row **edit signature** travels under (base64) — an Ed25519
/// signature by the authoring device over the row's content digest, read back as opaque
/// proof by [`CapabilityResolver::verify_on_apply`].
///
/// Must match `aven_caps::ownership::EDIT_SIG_META_KEY` (kept in sync by this note, same
/// as [`OWNER_BINDING_META_KEY`]).
///
/// **Excluded from [`crate::row_histories::compute_row_digest`]**: the edit-sig *signs*
/// that digest, so it cannot itself be hashed into it (chicken-and-egg). Excluding a key
/// that no pre-edit-sig row carries is a no-op for every existing digest.
pub const EDIT_SIG_META_KEY: &str = "_edit_sig";

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
    /// `proof` is the serialized signed **owner-binding** ([`OWNER_BINDING_META_KEY`]);
    /// `edit_sig` is the serialized author **edit-signature** ([`EDIT_SIG_META_KEY`]) over
    /// the `digest` the engine computed itself. Together they let the app's resolver run
    /// `aven_caps::ownership::authorize_signed_edit` so a relay that tampered with the
    /// row's `data`/`metadata` (which the owner-binding does NOT cover) is rejected.
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
        edit_sig: Option<&[u8]>,
    ) -> CapDecision {
        let _ = (subject, op, res, digest, proof, edit_sig);
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

/// App-installed signer for the **local write path** (`set_edit_signer`). The engine stays
/// crypto-agnostic: after it assembles a locally-authored row batch it calls
/// [`EditSigner::sign_row`] with the batch's content `digest` (which EXCLUDES the
/// [`EDIT_SIG_META_KEY`] slot, so stamping the result back does not perturb it). The app
/// signs the digest with the authoring device key and returns the `(metadata_key,
/// base64_value)` to stamp into the row, so the author's signature travels with the batch
/// and is verified by [`CapabilityResolver::verify_on_apply`] on every receiving peer.
///
/// Returns `None` to skip stamping (signer not ready). Mirrors the `set_resolver` /
/// `CapabilityResolver` split: the engine owns the hook point, the app owns the crypto.
pub trait EditSigner: Send + Sync {
    fn sign_row(&self, row_id: ObjectId, digest: &[u8; 32]) -> Option<(String, String)>;
}

/// App-installed minter for the **owner-binding** ([`OWNER_BINDING_META_KEY`]) — the lowest-level,
/// non-bypassable counterpart of [`EditSigner`]. The engine stays crypto-agnostic: at the single
/// deep author funnel, for **every owner-scoped row** it calls [`OwnerBinder::bind_row`] with the
/// row id + its `owner`, and stamps the returned `(metadata_key, value)` into the batch **before**
/// the edit-sig digest is computed — so the owner-binding is itself integrity-signed and travels
/// E2E, verified by every peer's fail-closed [`CapabilityResolver::verify_on_apply`].
///
/// This is the *private-first / 100%-at-the-DB-level* invariant: just as the [`crate::Sealer`] seam
/// makes "no plaintext on disk" a property of the engine (not a call-site discipline), the binder
/// makes **"no unbound owner-scoped row, ever"** a property of the write core. A syncing engine with
/// an owner-scoped write but **no** binder installed (or a binder that returns `None`) **fails the
/// write** — an unbound owned row cannot be authored, by construction.
///
/// Returns `None` only when the device key isn't ready; the engine treats that as fail-closed on
/// owner-scoped tables. Non-owner-scoped (local/non-E2E) rows never invoke the binder.
pub trait OwnerBinder: Send + Sync {
    /// Mint the owner-binding for a row of `owner` identified by `row_id`. Returns
    /// `(OWNER_BINDING_META_KEY, base64_value)` to stamp, or `None` if not ready.
    fn bind_row(&self, row_id: ObjectId, owner: uuid::Uuid) -> Option<(String, String)>;
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
        _edit_sig: Option<&[u8]>,
    ) -> CapDecision {
        CapDecision::DenyPermanent
    }
}

/// May a peer **hold** (store/receive) a resource's batches? True for any of:
/// a **reader** (`Read` — a delegated/`reads` Member that holds a keyshare and is
/// entitled to receive the rows it can decrypt), an **owner** (`Write`), OR a blind
/// **replication** peer (`Replicate` — a server aven that stores & forwards the
/// encrypted batches without a keyshare). Authorized via ANY of the three caps,
/// checked in that order and short-circuiting on the first `Allow`.
///
/// Invariant: if nothing authorizes outright but ANY check is still `Pending` (the
/// ACL/shell isn't hydrated yet), the verdict is `Pending` so the caller DEFERS and
/// never drops a frame it may later be allowed to ship. Only an all-`Deny` verdict is
/// terminal. This is the forwarding gate's single decision (`ship_frontier_diff`).
///
/// NOTE: `Read` was historically omitted here — only `Write`/`Replicate` were checked
/// — so a `reads`/Member grant silently withheld EVERY row of the identity (data,
/// genesis, AND keyshares) from the grantee: the cap was minted but never delivered,
/// so the member could not decrypt anything. Owners worked (they hold `Write`); the
/// avenCEO member bundle worked only because it also grants a row-scoped `write`.
pub fn may_hold(
    resolver: &dyn CapabilityResolver,
    subject: &SyncTargetId,
    res: &ResourceCoord,
) -> CapDecision {
    let write = resolver.may_sync(subject, AccOp::Write, res);
    if write == CapDecision::Allow {
        return CapDecision::Allow;
    }
    let read = resolver.may_sync(subject, AccOp::Read, res);
    if read == CapDecision::Allow {
        return CapDecision::Allow;
    }
    let replicate = resolver.may_sync(subject, AccOp::Replicate, res);
    if replicate == CapDecision::Allow {
        return CapDecision::Allow;
    }
    // None authorize. Defer (never drop) if any check is awaiting ACL hydration.
    if write == CapDecision::Pending
        || read == CapDecision::Pending
        || replicate == CapDecision::Pending
    {
        CapDecision::Pending
    } else {
        CapDecision::DenyPermanent
    }
}

// Tests live in `tests/capability_gate.rs` (integration target, `client-p2p`).

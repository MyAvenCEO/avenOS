//! Capability gate — plan §9 T1 (the three-state authorizer).
//!
//! Requires `client-p2p`: the gate's subject (`SyncTargetId`, a peer `did:key:`)
//! is part of the peer-sync seam. `may_sync` is the single authorizer — there is
//! no second policy check beside it (ReBAC was removed in M0).

use std::collections::HashSet;

use groove::object::ObjectId;
use groove::row_histories::BatchId;
use groove::sync_targets::SyncTargetId;
use groove::{
    AccOp, AllowAllResolver, CapDecision, CapabilityResolver, DenyAllResolver, FrontierDag,
    ResourceCoord, gated_pull,
};

/// Minimal biscuit-shaped resolver: granted → Allow, revoked → DenyPermanent,
/// and (while the ACL is not hydrated) unknown subjects → Pending.
struct TestResolver {
    granted: HashSet<String>,
    revoked: HashSet<String>,
    hydrated: bool,
}

impl CapabilityResolver for TestResolver {
    fn may_sync(&self, subject: &SyncTargetId, _op: AccOp, _res: &ResourceCoord) -> CapDecision {
        let did = subject.as_peer_did().unwrap_or("");
        if self.revoked.contains(did) {
            return CapDecision::DenyPermanent;
        }
        if self.granted.contains(did) {
            return CapDecision::Allow;
        }
        if !self.hydrated {
            return CapDecision::Pending;
        }
        CapDecision::DenyPermanent
    }
}

/// T1 — Allow / DenyPermanent / Pending for granted / revoked / un-hydrated.
/// Locks: three-state; `Pending` defers (never drops); only `DenyPermanent` is terminal.
#[test]
fn resolver_three_state() {
    let resolver = TestResolver {
        granted: HashSet::from(["did:key:alice".to_string()]),
        revoked: HashSet::from(["did:key:bob".to_string()]),
        hydrated: false,
    };
    let res = ResourceCoord::new("spark:S:todos:ROW", "todos", ObjectId::new());

    assert_eq!(
        resolver.may_sync(&SyncTargetId::peer_did("did:key:alice"), AccOp::Write, &res),
        CapDecision::Allow,
    );
    assert_eq!(
        resolver.may_sync(&SyncTargetId::peer_did("did:key:bob"), AccOp::Write, &res),
        CapDecision::DenyPermanent,
    );
    // Un-hydrated unknown subject DEFERS — the pairing/bootstrap window stays correct.
    assert_eq!(
        resolver.may_sync(&SyncTargetId::peer_did("did:key:carol"), AccOp::Read, &res),
        CapDecision::Pending,
    );
}

#[test]
fn builtin_resolvers_are_total() {
    let res = ResourceCoord::new("spark:S", "todos", ObjectId::new());
    let who = SyncTargetId::peer_did("did:key:anyone");
    assert_eq!(
        AllowAllResolver.may_sync(&who, AccOp::Read, &res),
        CapDecision::Allow
    );
    assert_eq!(
        DenyAllResolver.may_sync(&who, AccOp::Write, &res),
        CapDecision::DenyPermanent
    );
}

fn bid(n: u8) -> BatchId {
    let mut bytes = [0u8; 16];
    bytes[0] = n;
    BatchId(bytes)
}

/// T8 — the per-hop gate. A granted subject converges; a revoked subject gets
/// **nothing new** and **keeps** whatever it already held (revoke is not retroactive).
#[test]
fn capability_gates_every_hop() {
    // A blind hub holds the full history A <- B.
    let mut hub = FrontierDag::new();
    hub.insert(bid(1), vec![]);
    hub.insert(bid(2), vec![bid(1)]);
    let res = ResourceCoord::new("spark:S", "todos", ObjectId::new());

    let resolver = TestResolver {
        granted: HashSet::from(["did:key:granted".to_string()]),
        revoked: HashSet::from(["did:key:revoked".to_string()]),
        hydrated: true,
    };

    // Granted peer: the hop forwards → converges to the hub frontier.
    let mut granted_peer = FrontierDag::new();
    let transferred = gated_pull(
        &mut granted_peer,
        &hub,
        &resolver,
        &SyncTargetId::peer_did("did:key:granted"),
        &res,
    );
    assert_eq!(transferred, 2);
    assert_eq!(granted_peer.heads(), hub.heads());

    // Revoked peer that already holds the old batch: the hop forwards NOTHING new,
    // and the already-held batch is untouched (not retro-deleted).
    let mut revoked_peer = FrontierDag::new();
    revoked_peer.insert(bid(1), vec![]);
    let before = revoked_peer.len();
    let transferred = gated_pull(
        &mut revoked_peer,
        &hub,
        &resolver,
        &SyncTargetId::peer_did("did:key:revoked"),
        &res,
    );
    assert_eq!(transferred, 0, "revoke stops new batches");
    assert_eq!(revoked_peer.len(), before, "no new batches delivered");
    assert!(
        revoked_peer.contains(&bid(1)),
        "already-held batch is kept — revoke is not retroactive"
    );
}

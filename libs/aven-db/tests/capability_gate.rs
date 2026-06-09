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
    ResourceCoord, may_hold,
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

/// Op-aware resolver: distinguishes membership (`Write`) from blind replication
/// (`Replicate`), the way the biscuit resolver does (members hold a `write` right
/// + a keyshare; a replication peer holds only a `replicate` right, no keyshare).
struct RoleResolver {
    members: HashSet<String>,
    replicas: HashSet<String>,
    hydrated: bool,
}

impl CapabilityResolver for RoleResolver {
    fn may_sync(&self, subject: &SyncTargetId, op: AccOp, _res: &ResourceCoord) -> CapDecision {
        let did = subject.as_peer_did().unwrap_or("");
        match op {
            AccOp::Replicate => {
                if self.replicas.contains(did) {
                    CapDecision::Allow
                } else {
                    CapDecision::DenyPermanent
                }
            }
            _ => {
                if self.members.contains(did) {
                    CapDecision::Allow
                } else if self.hydrated {
                    CapDecision::DenyPermanent
                } else {
                    CapDecision::Pending
                }
            }
        }
    }
}

/// Replication gate (`may_hold`) — the forwarding decision behind a server aven
/// added as a blind replication peer. A member ships via `Write`; a replication
/// peer ships via `Replicate` *without* being a member; an outsider ships via
/// neither; and an un-hydrated member still DEFERS (`Pending`, never dropped).
#[test]
fn replication_peer_may_hold_without_membership() {
    let resolver = RoleResolver {
        members: HashSet::from(["did:key:member".to_string()]),
        replicas: HashSet::from(["did:key:server".to_string()]),
        hydrated: true,
    };
    let res = ResourceCoord::new("spark:S:todos:ROW", "todos", ObjectId::new());

    // Member → holds via Write.
    assert_eq!(
        may_hold(&resolver, &SyncTargetId::peer_did("did:key:member"), &res),
        CapDecision::Allow,
    );
    // Server aven (replica) → holds via Replicate, though it is NOT a member
    // (a Write-only check would deny it — that was the regression).
    assert_eq!(
        resolver.may_sync(&SyncTargetId::peer_did("did:key:server"), AccOp::Write, &res),
        CapDecision::DenyPermanent,
        "the replica is deliberately not a member",
    );
    assert_eq!(
        may_hold(&resolver, &SyncTargetId::peer_did("did:key:server"), &res),
        CapDecision::Allow,
        "but it MAY hold the spark's encrypted batches via its replicate grant",
    );
    // Outsider → neither member nor replica → denied.
    assert_eq!(
        may_hold(&resolver, &SyncTargetId::peer_did("did:key:outsider"), &res),
        CapDecision::DenyPermanent,
    );

    // A would-be member whose ACL is not hydrated yet still DEFERS (the replicate
    // check must not turn a membership `Pending` into a permanent Deny).
    let pending = RoleResolver {
        members: HashSet::new(),
        replicas: HashSet::new(),
        hydrated: false,
    };
    assert_eq!(
        may_hold(&pending, &SyncTargetId::peer_did("did:key:bootstrapping"), &res),
        CapDecision::Pending,
    );
}

/// End-to-end relay shape: a member writes, a **blind replica hub** stores &
/// forwards, and a second member converges through it — the `dev:app2x`
/// "A → server → B" path, at the tracker level. The hub holds the ciphertext
/// (batches) but, in the real system, no keyshare — so it relays what it cannot
/// read. (Membership/replicate authorization is proven by `may_hold` above; the
/// biscuit grant by `spark_acc`; here we lock the convergence math.)
#[test]
fn member_to_replica_to_member_converges() {
    // Member A has the spark history.
    let mut a = FrontierDag::new();
    a.insert(bid(1), vec![]);
    a.insert(bid(2), vec![bid(1)]);

    // The replica hub pulls everything A is owed (it `may_hold` via Replicate).
    let mut hub = FrontierDag::new();
    assert_eq!(hub.pull_from(&a), 2, "replica stores the encrypted batches");
    assert_eq!(hub.heads(), a.heads());

    // Member B — initially empty, never directly connected to A — converges
    // through the hub.
    let mut b = FrontierDag::new();
    assert_eq!(b.pull_from(&hub), 2, "B converges via the replica");
    assert_eq!(b.heads(), a.heads());

    // Idempotent: a second round ships nothing new (frontier dedup).
    assert_eq!(b.pull_from(&hub), 0);
}


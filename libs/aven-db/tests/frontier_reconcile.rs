//! Pure frontier reconciliation — plan §9 T2 + T6 (the resilience proofs).
//!
//! Runs under default features: `frontier_diff` / `FrontierDag` are storage-free
//! and depend only on `BatchId`, so the convergence guarantees are provable with
//! zero networking and zero heavy deps.

use aven_db::object::ObjectId;
use aven_db::row_histories::BatchId;
use aven_db::{FrontierDag, frontier_diff, heads_for};

fn bid(n: u8) -> BatchId {
    let mut bytes = [0u8; 16];
    bytes[0] = n;
    BatchId(bytes)
}

/// T2 — `frontier_diff` is pure over a linear history: exact missing batches,
/// empty when converged, parents-before-children order.
#[test]
fn frontier_diff_is_pure_linear() {
    // A <- B <- C (C is the head).
    let mut dag = FrontierDag::new();
    dag.insert(bid(1), vec![]);
    dag.insert(bid(2), vec![bid(1)]);
    dag.insert(bid(3), vec![bid(2)]);

    assert_eq!(dag.heads(), vec![bid(3)]);
    assert_eq!(frontier_diff(&dag, &[]), vec![bid(1), bid(2), bid(3)]);
    assert_eq!(frontier_diff(&dag, &[bid(3)]), Vec::<BatchId>::new());
    assert_eq!(frontier_diff(&dag, &[bid(2)]), vec![bid(3)]);
}

/// T2 (DAG case) — multi-head merge history requires an ancestor walk, not a
/// scalar length compare.
#[test]
fn frontier_diff_walks_dag_ancestors() {
    // A; B<-A; C<-A; D<-(B,C). D is the single merge head.
    let mut dag = FrontierDag::new();
    dag.insert(bid(1), vec![]);
    dag.insert(bid(2), vec![bid(1)]);
    dag.insert(bid(3), vec![bid(1)]);
    dag.insert(bid(4), vec![bid(2), bid(3)]);

    assert_eq!(dag.heads(), vec![bid(4)]);
    // Remote holds only B (hence A): owes C then D, parents first.
    assert_eq!(frontier_diff(&dag, &[bid(2)]), vec![bid(3), bid(4)]);
    assert_eq!(frontier_diff(&dag, &[bid(4)]), Vec::<BatchId>::new());
}

/// T6 (pure half) — losing all cached per-peer state forces a re-diff that
/// resends zero already-held batches. Stateless diff == no erroneous resend ==
/// crash/restart safe by construction.
#[test]
fn redirect_after_cache_loss_no_resend() {
    let mut dag = FrontierDag::new();
    dag.insert(bid(1), vec![]);
    dag.insert(bid(2), vec![bid(1)]);

    // Peer converged to our heads. With no ledger at all, a fresh diff is empty.
    let converged = dag.heads();
    assert_eq!(frontier_diff(&dag, &converged), Vec::<BatchId>::new());
    // Idempotent: re-diffing again (state dropped) still resends nothing.
    assert_eq!(frontier_diff(&dag, &converged), Vec::<BatchId>::new());
}

/// T5 — one anti-entropy round converges an empty peer to the source heads;
/// a second round transfers nothing (idempotent reconcile).
#[test]
fn a_to_b_converges() {
    let mut a = FrontierDag::new();
    a.insert(bid(1), vec![]);
    a.insert(bid(2), vec![bid(1)]);
    a.insert(bid(3), vec![bid(2)]);

    let mut b = FrontierDag::new();
    assert_eq!(b.pull_from(&a), 3);
    assert_eq!(b.heads(), a.heads());
    assert_eq!(b.pull_from(&a), 0); // converged → nothing owed
}

/// T7 — convergence via a blind hub (no direct A↔B), and 2-path dedup by batch
/// id: a batch arriving via a second path is never re-applied.
#[test]
fn multi_hop_via_blind_hub_converges_and_dedups() {
    let mut a = FrontierDag::new();
    a.insert(bid(1), vec![]);
    a.insert(bid(2), vec![bid(1)]);
    a.insert(bid(3), vec![bid(2)]);

    let mut hub = FrontierDag::new(); // blind mirror: stores, relays
    let mut b = FrontierDag::new();

    hub.pull_from(&a); // A → H
    b.pull_from(&hub); // H → B
    assert_eq!(b.heads(), a.heads());
    assert_eq!(b.len(), 3);

    // Second path (e.g. another relay carrying the same batches) — dedup, zero re-apply.
    assert_eq!(b.pull_from(&hub), 0);
    assert_eq!(b.pull_from(&a), 0);
    assert_eq!(b.len(), 3);
}

/// T9 — a partition heals on reconnect by pulling both ways; both sides converge
/// to the union of divergent histories with the same head set.
#[test]
fn partition_heals_on_reconnect() {
    // Shared root, then diverge offline.
    let mut a = FrontierDag::new();
    a.insert(bid(1), vec![]);
    let mut b = a.clone();

    a.insert(bid(2), vec![bid(1)]); // A's branch
    a.insert(bid(3), vec![bid(2)]);
    b.insert(bid(4), vec![bid(1)]); // B's branch

    // Reconnect: reconcile both directions.
    a.pull_from(&b);
    b.pull_from(&a);

    let mut a_heads = a.heads();
    let mut b_heads = b.heads();
    a_heads.sort_by_key(|x| x.0);
    b_heads.sort_by_key(|x| x.0);
    assert_eq!(a_heads, b_heads, "both sides converge to the same frontier");
    assert_eq!(a.len(), 4);
    assert_eq!(b.len(), 4);
    assert_eq!(a_heads, vec![bid(3), bid(4)], "divergent tips are the heads");
}

/// T3 — the resource frontier is the **union of the per-row stored have-sets**
/// (`load_visible_region_frontier`), deduped. Proves `heads_for` derives the
/// frontier from storage rather than maintaining a separate tracker.
#[test]
fn heads_for_matches_union_of_storage_frontiers() {
    let r1 = ObjectId::new();
    let r2 = ObjectId::new();

    // Stand-in for `storage.load_visible_region_frontier(table, branch, row)`:
    // r1's stored have-set is {1,2}, r2's is {2,3} — batch 2 is shared.
    let stored_frontier = |row: ObjectId| -> Vec<BatchId> {
        if row == r1 {
            vec![bid(1), bid(2)]
        } else if row == r2 {
            vec![bid(2), bid(3)]
        } else {
            vec![]
        }
    };

    // Resource frontier = union of both rows, deduped + ordered.
    assert_eq!(
        heads_for(&[r1, r2], stored_frontier),
        vec![bid(1), bid(2), bid(3)]
    );
    // Empty resource → empty frontier.
    assert_eq!(heads_for(&[], |_| vec![]), Vec::<BatchId>::new());
}

#![cfg(feature = "client-p2p")]

use groove::delivery_ledger::{DeliveryLedger, RowBatchKey};
use groove::object::{BranchName, ObjectId};
use groove::row_histories::BatchId;
use groove::sync_authorizer::{AllowAllSyncAuthorizer, DenyAllSyncAuthorizer, SyncAuthorizer};
use groove::sync_manager::SyncPayload;
use groove::sync_targets::SyncTargetId;

fn sample_key() -> RowBatchKey {
    RowBatchKey {
        object_id: ObjectId::default(),
        branch_name: BranchName::new("main"),
        batch_id: BatchId(1),
    }
}

fn sample_payload() -> SyncPayload {
    SyncPayload::Error(groove::sync_manager::SyncError::SessionRequired {
        object_id: ObjectId::default(),
        branch_name: BranchName::new("main"),
    })
}

#[test]
fn deny_authorizer_does_not_advance_ledger() {
    let mut ledger = DeliveryLedger::new();
    let target = SyncTargetId::peer_did("did:key:z6Mkpeer");
    let key = sample_key();
    let payload = sample_payload();
    ledger.queue(target.clone(), key);

    let deny = DenyAllSyncAuthorizer;
    assert!(!ledger.try_deliver(&deny, target.clone(), key, &payload));
    assert!(!ledger.is_delivered(&target, &key));
    assert_eq!(ledger.pending_for(&target), 1);
}

#[test]
fn allow_authorizer_marks_delivered() {
    let mut ledger = DeliveryLedger::new();
    let target = SyncTargetId::peer_did("did:key:z6Mkpeer");
    let key = sample_key();
    let payload = sample_payload();
    ledger.queue(target.clone(), key);

    let allow = AllowAllSyncAuthorizer;
    assert!(ledger.try_deliver(&allow, target.clone(), key, &payload));
    assert!(ledger.is_delivered(&target, &key));
    assert_eq!(ledger.pending_for(&target), 0);
}

#[test]
fn invalidate_object_clears_batches() {
    let mut ledger = DeliveryLedger::new();
    let target = SyncTargetId::peer_did("did:key:z6Mkpeer");
    let key = sample_key();
    let allow = AllowAllSyncAuthorizer;
    let payload = sample_payload();
    assert!(ledger.try_deliver(&allow, target.clone(), key, &payload));
    ledger.invalidate_object(&target, key.object_id);
    assert!(!ledger.is_delivered(&target, &key));
}

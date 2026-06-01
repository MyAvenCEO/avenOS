#![cfg(feature = "client-p2p")]

use groove::object::{BranchName, ObjectId};
use groove::sync_manager::{ClientId, DurabilityTier, QueryId, SyncError, SyncPayload};
use groove::sync_targets::SyncTargetId;
use groove::{decode_length_prefixed, encode_length_prefixed};

#[test]
fn length_prefixed_roundtrip_errors_on_trailer() {
    let cid = ClientId::new();
    let target = SyncTargetId::Client(cid);
    let payload = SyncPayload::Error(SyncError::SessionRequired {
        object_id: ObjectId::default(),
        branch_name: BranchName::new("main"),
    });
    let mut buf = encode_length_prefixed(target.clone(), &payload).expect("encode");
    let (t2, p2) = decode_length_prefixed(&buf).expect("decode");
    assert_eq!(t2, target);
    assert_eq!(p2, payload);

    buf.push(0);
    assert!(decode_length_prefixed(&buf).is_err());
}

#[test]
fn query_settled_roundtrips() {
    let cid = ClientId::new();
    let target = SyncTargetId::Client(cid);
    let payload = SyncPayload::QuerySettled {
        query_id: QueryId(7),
        tier: DurabilityTier::EdgeServer,
        scope: Vec::new(),
        through_seq: 0,
    };
    let buf = encode_length_prefixed(target.clone(), &payload).unwrap();
    let (t2, p2) = decode_length_prefixed(&buf).unwrap();
    assert_eq!(t2, target);
    assert_eq!(p2, payload);
}

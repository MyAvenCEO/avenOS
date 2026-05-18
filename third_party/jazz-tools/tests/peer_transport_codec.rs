#![cfg(feature = "peer-transport")]

use groove::object::BranchName;
use groove::object::ObjectId;
use groove::{decode_length_prefixed, encode_length_prefixed};
use groove::sync_manager::{ClientId, PersistenceTier, QueryId, SyncError, SyncPayload};

#[test]
fn length_prefixed_roundtrip_errors_on_trailer() {
    let cid = ClientId::new();
    let payload = SyncPayload::Error(SyncError::SessionRequired {
        object_id: ObjectId::default(),
        branch_name: BranchName::new("main"),
    });
    let mut buf = encode_length_prefixed(cid, &payload).expect("encode");
    let (c2, p2) = decode_length_prefixed(&buf).expect("decode");
    assert_eq!(c2, cid);
    assert_eq!(p2, payload);

    buf.push(0);
    assert!(decode_length_prefixed(&buf).is_err());
}

#[test]
fn query_settled_roundtrips() {
    let cid = ClientId::new();
    let payload = SyncPayload::QuerySettled {
        query_id: QueryId(7),
        tier: PersistenceTier::Worker,
    };
    let buf = encode_length_prefixed(cid, &payload).unwrap();
    let (c2, p2) = decode_length_prefixed(&buf).unwrap();
    assert_eq!(c2, cid);
    assert_eq!(p2, payload);
}

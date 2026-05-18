//! P2P / side-channel framing for relaying [`groove::sync_manager::SyncPayload`] between Jazz peers.
//!
//! Callers attach a [`PeerTransport`] when building a [`crate::JazzClient`] via
//! [`crate::JazzClient::connect_with_peer_transport`] so outbound `Destination::Client` payloads are
//! forwarded over an encrypted swarm link (outside this crate).

use async_trait::async_trait;
use groove::sync_manager::{ClientId, InboxEntry, SyncPayload};
use serde::{Deserialize, Serialize};

/// Hard cap per frame (decoded); bounds hostile peers / accidental OOM during bincode decoding.
const BINCODE_PAYLOAD_LIMIT_BYTES: usize = 128 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
struct SyncFrameV1 {
    pub target_client_id: ClientId,
    pub payload: SyncPayload,
}

/// Length-prefixed bincode capsule (u32 LE length excluding the prefix itself).
///
/// Intended as the on-wire framing for hyperswarm / QUIC-style streams carrying Jazz sync payloads.
pub fn encode_length_prefixed(target: ClientId, payload: &SyncPayload) -> Result<Vec<u8>, String> {
    let frame = SyncFrameV1 {
        target_client_id: target,
        payload: payload.clone(),
    };
    let body = encode_sync_frame_bincode(&frame)?;
    let len: u32 = body
        .len()
        .try_into()
        .map_err(|_| "sync payload: frame body length overflow")?;
    let mut out = Vec::with_capacity(4 + body.len());
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(&body);
    Ok(out)
}

/// Decode [`SyncPayload`] produced by [`encode_length_prefixed`].
pub fn decode_length_prefixed(buf: &[u8]) -> Result<(ClientId, SyncPayload), String> {
    if buf.len() < 4 {
        return Err("sync frame: truncated length prefix".into());
    }
    let len = u32::from_le_bytes(buf[..4].try_into().unwrap()) as usize;
    let body_end = 4usize
        .checked_add(len)
        .ok_or_else(|| "sync frame: overflow".to_string())?;
    if buf.len() < body_end {
        return Err("sync frame: truncated body".into());
    }
    if buf.len() != body_end {
        return Err("sync frame: trailing bytes".into());
    }
    let frame: SyncFrameV1 = decode_sync_frame_bincode(&buf[4..body_end])?;
    Ok((frame.target_client_id, frame.payload))
}

fn encode_sync_frame_bincode(frame: &SyncFrameV1) -> Result<Vec<u8>, String> {
    bincode::serde::encode_to_vec(
        frame,
        bincode::config::standard().with_limit::<BINCODE_PAYLOAD_LIMIT_BYTES>(),
    )
    .map_err(|e| format!("sync frame encode: {e}"))
}

fn decode_sync_frame_bincode(buf: &[u8]) -> Result<SyncFrameV1, String> {
    let (frame, read) =
        bincode::serde::decode_from_slice::<SyncFrameV1, _>(
            buf,
            bincode::config::standard().with_limit::<BINCODE_PAYLOAD_LIMIT_BYTES>(),
        )
        .map_err(|e| format!("sync frame decode: {e}"))?;
    if read != buf.len() {
        return Err(format!(
            "sync frame decode: unconsumed trailing bytes ({read} decoded, {} total)",
            buf.len()
        ));
    }
    Ok(frame)
}

#[async_trait]
pub trait PeerTransport: Send + Sync {
    /// Push a replicated payload toward `peer`'s Jazz runtime (serialized by the impl).
    async fn send_to(&self, peer: ClientId, payload: SyncPayload) -> crate::Result<()>;

    /// Inbound deliveries from peers. `None` means the receiver is permanently closed — the
    /// JazzClient drain task should exit.
    async fn recv_inbound(&self) -> Option<InboxEntry>;

    /// Close sockets / peers; inbox should soon yield `None`.
    async fn shutdown(&self) -> crate::Result<()> {
        Ok(())
    }
}

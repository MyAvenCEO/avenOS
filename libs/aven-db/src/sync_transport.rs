//! Pluggable sync transport — length-prefixed framing over any byte channel.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::sync_manager::{ClientId, InboxEntry, SyncPayload};
use crate::sync_targets::SyncTargetId;

const BINCODE_PAYLOAD_LIMIT_BYTES: usize = 128 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
struct SyncFrameV1 {
    pub target: SyncTargetId,
    pub payload: SyncPayload,
}

pub fn encode_length_prefixed(
    target: SyncTargetId,
    payload: &SyncPayload,
) -> Result<Vec<u8>, String> {
    let frame = SyncFrameV1 {
        target,
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

pub fn decode_length_prefixed(buf: &[u8]) -> Result<(SyncTargetId, SyncPayload), String> {
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
    Ok((frame.target, frame.payload))
}

/// Legacy helper — maps ClientId targets for existing Groove peer paths.
pub fn encode_length_prefixed_client(
    target: ClientId,
    payload: &SyncPayload,
) -> Result<Vec<u8>, String> {
    encode_length_prefixed(SyncTargetId::Client(target), payload)
}

pub fn decode_length_prefixed_client(buf: &[u8]) -> Result<(ClientId, SyncPayload), String> {
    let (target, payload) = decode_length_prefixed(buf)?;
    match target {
        SyncTargetId::Client(c) => Ok((c, payload)),
        other => Err(format!("sync frame: expected Client target, got {other:?}")),
    }
}

fn encode_sync_frame_bincode(frame: &SyncFrameV1) -> Result<Vec<u8>, String> {
    bincode::serde::encode_to_vec(
        frame,
        bincode::config::standard().with_limit::<BINCODE_PAYLOAD_LIMIT_BYTES>(),
    )
    .map_err(|e| format!("sync frame encode: {e}"))
}

fn decode_sync_frame_bincode(buf: &[u8]) -> Result<SyncFrameV1, String> {
    let (frame, read) = bincode::serde::decode_from_slice::<SyncFrameV1, _>(
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
pub trait SyncTransport: Send + Sync {
    async fn send_to(&self, target: SyncTargetId, payload: SyncPayload) -> crate::Result<()>;

    async fn recv_inbound(&self) -> Option<InboxEntry>;

    async fn shutdown(&self) -> crate::Result<()> {
        Ok(())
    }
}

/// Local-only mode — no bytes leave the device.
#[derive(Debug, Default, Clone, Copy)]
pub struct NullSyncTransport;

#[async_trait]
impl SyncTransport for NullSyncTransport {
    async fn send_to(
        &self,
        _target: SyncTargetId,
        _payload: SyncPayload,
    ) -> crate::Result<()> {
        Ok(())
    }

    async fn recv_inbound(&self) -> Option<InboxEntry> {
        None
    }
}

/// Back-compat alias for code that still names the old trait.
pub type PeerTransport = dyn SyncTransport;

//! Peer-mesh UI types — the single shape the webview consumes for sync status.
//!
//! Built from real trusted-peer rows + live transport registration in
//! `jazz::build_peer_mesh_status` (no demo data).

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncBootstrapPhase {
    TransportPending,
    Ready,
}

/// States the backend determines from transport registration + frontier
/// convergence (§10.2): `Searching` (no live link), `Syncing` (linked,
/// exchanging), `Ready` (linked + last frontier diff empty = up to date).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PeerMeshPhase {
    Searching,
    Syncing,
    Ready,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PeerUsability {
    Connecting,
    LiveSyncing,
    Usable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkHealth {
    None,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct P2pDiagnostics {
    pub central_mode: bool,
    pub dht_bootstrap: String,
    pub joined_topic_count: u32,
    pub allowlist_count: u32,
    pub linked_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pairing_session_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefer_relay_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_health: Option<LinkHealth>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerMeshPeerState {
    pub id: String,
    pub signer_did: String,
    pub device_label: String,
    pub db_status: String,
    pub added_at_ms: u64,
    pub phase: PeerMeshPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usability: Option<PeerUsability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bootstrap: Option<SyncBootstrapPhase>,
}

/// Single source of truth for mesh UI (`avenos:runtime` + `meshStatus` IPC).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerMeshStatusReply {
    pub hyperswarm_running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hyperswarm_start_error: Option<String>,
    pub local_pk_prefix_hex: String,
    pub p2p_diagnostics: P2pDiagnostics,
    pub peers: Vec<PeerMeshPeerState>,
}

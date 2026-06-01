//! Demo mesh snapshot for UI — no live transport.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncBootstrapPhase {
    TransportPending,
    Ready,
}

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
    pub peer_did: String,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoMeshPeer {
    pub id: String,
    pub peer_did: String,
    pub device_label: String,
    pub db_status: String,
    pub added_at_ms: u64,
    pub phase: PeerMeshPhase,
    pub bootstrap: SyncBootstrapPhase,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoMeshSnapshot {
    pub local_pk_prefix_hex: String,
    pub peers: Vec<DemoMeshPeer>,
}

fn demo_peer_usability(phase: PeerMeshPhase) -> PeerUsability {
    match phase {
        PeerMeshPhase::Ready => PeerUsability::Usable,
        PeerMeshPhase::Syncing => PeerUsability::LiveSyncing,
        PeerMeshPhase::Searching => PeerUsability::Connecting,
    }
}

/// Map demo snapshot → IPC / webview `PeerMeshStatusReply` (mirrors TS `demoMeshToStatusReply`).
pub fn demo_mesh_status_reply() -> PeerMeshStatusReply {
    let snap = demo_mesh_snapshot();
    let ready_count = snap
        .peers
        .iter()
        .filter(|p| p.phase == PeerMeshPhase::Ready)
        .count() as u32;
    PeerMeshStatusReply {
        hyperswarm_running: false,
        hyperswarm_start_error: None,
        local_pk_prefix_hex: snap.local_pk_prefix_hex,
        p2p_diagnostics: P2pDiagnostics {
            central_mode: false,
            dht_bootstrap: "demo (local-only)".into(),
            joined_topic_count: 0,
            allowlist_count: snap.peers.len() as u32,
            linked_count: ready_count,
            pairing_session_active: Some(false),
            prefer_relay_only: Some(true),
            link_health: Some(LinkHealth::None),
        },
        peers: snap
            .peers
            .into_iter()
            .map(|p| PeerMeshPeerState {
                id: p.id,
                peer_did: p.peer_did,
                device_label: p.device_label,
                db_status: p.db_status,
                added_at_ms: p.added_at_ms,
                phase: p.phase,
                usability: Some(demo_peer_usability(p.phase)),
                bootstrap: Some(p.bootstrap),
            })
            .collect(),
    }
}

/// Hardcoded demo peers showing internal phases mapped to user-facing states.
pub fn demo_mesh_snapshot() -> DemoMeshSnapshot {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    DemoMeshSnapshot {
        local_pk_prefix_hex: "demo0000".into(),
        peers: vec![
            DemoMeshPeer {
                id: "demo-connecting".into(),
                peer_did: "did:key:z6MkDemoConnecting".into(),
                device_label: "Jamie's MacBook".into(),
                db_status: "active".into(),
                added_at_ms: now.saturating_sub(120_000),
                phase: PeerMeshPhase::Searching,
                bootstrap: SyncBootstrapPhase::TransportPending,
            },
            DemoMeshPeer {
                id: "demo-syncing".into(),
                peer_did: "did:key:z6MkDemoSyncing".into(),
                device_label: "Jamie's iPhone".into(),
                db_status: "active".into(),
                added_at_ms: now.saturating_sub(300_000),
                phase: PeerMeshPhase::Syncing,
                bootstrap: SyncBootstrapPhase::Ready,
            },
            DemoMeshPeer {
                id: "demo-ok".into(),
                peer_did: "did:key:z6MkDemoOk".into(),
                device_label: "Studio iPad".into(),
                db_status: "active".into(),
                added_at_ms: now.saturating_sub(86400_000),
                phase: PeerMeshPhase::Ready,
                bootstrap: SyncBootstrapPhase::Ready,
            },
        ],
    }
}

#[tauri::command]
pub fn demo_peer_mesh_status() -> DemoMeshSnapshot {
    demo_mesh_snapshot()
}

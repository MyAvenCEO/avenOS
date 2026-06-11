//! Peer mesh status / publishing for the webview.

use aven_db::{AvenDbClient, PeerId};
use crate::mesh::{
	LinkHealth, P2pDiagnostics, PeerMeshPeerState, PeerMeshPhase, PeerMeshStatusReply, PeerUsability,
	SyncBootstrapPhase,
};
use tauri_plugin_self::derive::ed25519_public;
use tauri_plugin_self::state::SelfState;

use super::*;

/// Emit `{ kind: "table", table: "signers" }` from canonical allowlisted remote rows.
pub(super) fn emit_peers_table_snapshot(
	avendb: &ManagedAvenDb,
	app: &tauri::AppHandle,
	rows: &[crate::signers::SignerRowReply],
) -> Result<bool, String> {
	let encoded = serde_json::to_string(rows).map_err(|e| e.to_string())?;
	{
		let mut last = avendb
			.last_table_snapshots
			.write()
			.expect("last_table_snapshots poisoned");
		if last.get("signers").is_some_and(|prev| prev == &encoded) {
			return Ok(false);
		}
		last.insert("signers".to_string(), encoded);
	}
	emit_avenos_runtime(
		app,
		serde_json::json!({
			"kind": "table",
			"table": "signers",
			"rows": rows,
		}),
	);
	Ok(true)
}

/// Single fetch of trusted remote peers → table push (if subscribed) + mesh snapshot.
pub(crate) async fn publish_trusted_peers_ui(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	ss: &SelfState,
) -> Result<(), String> {
	let (rows, snap) = if ss.is_unlocked() {
		let client = with_connected_client(avendb, app, ss).await?;
		let rows = crate::signers::list_signer_rows(client.as_ref()).await?;
		let registered = registered_peer_dids(client.as_ref());
		let converged = converged_peer_dids(client.as_ref());
		let local_pk_prefix = local_pk_prefix_hex(ss);
		let snap = build_peer_mesh_status(&rows, &registered, &converged, local_pk_prefix);
		(rows, snap)
	} else {
		(
			vec![],
			build_peer_mesh_status(&[], &Default::default(), &Default::default(), String::new()),
		)
	};

	if avendb.table_ui_ref_count("signers").await > 0 {
		let _ = emit_peers_table_snapshot(avendb, app, &rows);
	}

	emit_mesh_snapshot(app, avendb, snap)
}

/// did:key set for peer clients with a live registered sync link.
fn registered_peer_dids(client: &AvenDbClient) -> std::collections::HashSet<String> {
	client
		.peer_client_ids()
		.unwrap_or_default()
		.iter()
		.filter_map(|pid| crate::avendb_auth::signer_did_from_ed25519(&pid.0).ok())
		.collect()
}

/// did:key set for peers whose frontier is converged from our side ("Up to date").
fn converged_peer_dids(client: &AvenDbClient) -> std::collections::HashSet<String> {
	client
		.converged_peer_ids()
		.unwrap_or_default()
		.iter()
		.filter_map(|pid| crate::avendb_auth::signer_did_from_ed25519(&pid.0).ok())
		.collect()
}

/// First 4 bytes of the local Ed25519 pubkey, hex — for the mesh diagnostics line.
fn local_pk_prefix_hex(ss: &SelfState) -> String {
	let Ok(root) = ss.with_root(|r| Ok(*r)) else {
		return String::new();
	};
	match ed25519_public(&root) {
		Ok(pk) => format!("{:02x}{:02x}{:02x}{:02x}", pk[0], pk[1], pk[2], pk[3]),
		Err(_) => String::new(),
	}
}

/// Real mesh status from the trusted-peer rows + live transport registration +
/// frontier convergence (§10.2). A registered+converged peer is `Ready` (up to
/// date); registered but still owed batches is `Syncing`; no live link is
/// `Searching`. No demo data.
fn build_peer_mesh_status(
	rows: &[crate::signers::SignerRowReply],
	registered_dids: &std::collections::HashSet<String>,
	converged_dids: &std::collections::HashSet<String>,
	local_pk_prefix: String,
) -> PeerMeshStatusReply {
	let peers: Vec<PeerMeshPeerState> = rows
		.iter()
		.filter(|r| r.status == "active")
		.map(|r| {
			let linked = registered_dids.contains(&r.signer_did);
			let converged = linked && converged_dids.contains(&r.signer_did);
			let (phase, usability, bootstrap) = if converged {
				(
					PeerMeshPhase::Ready,
					PeerUsability::Usable,
					SyncBootstrapPhase::Ready,
				)
			} else if linked {
				(
					PeerMeshPhase::Syncing,
					PeerUsability::LiveSyncing,
					SyncBootstrapPhase::Ready,
				)
			} else {
				(
					PeerMeshPhase::Searching,
					PeerUsability::Connecting,
					SyncBootstrapPhase::TransportPending,
				)
			};
			PeerMeshPeerState {
				id: r.id.clone(),
				signer_did: r.signer_did.clone(),
				device_label: r.device_label.clone(),
				db_status: r.status.clone(),
				added_at_ms: r.added_at_ms.max(0) as u64,
				phase,
				usability: Some(usability),
				bootstrap: Some(bootstrap),
			}
		})
		.collect();

	let linked_count = peers
		.iter()
		.filter(|p| p.bootstrap == Some(SyncBootstrapPhase::Ready))
		.count() as u32;

	PeerMeshStatusReply {
		hyperswarm_running: !registered_dids.is_empty(),
		hyperswarm_start_error: None,
		local_pk_prefix_hex: local_pk_prefix,
		p2p_diagnostics: P2pDiagnostics {
			central_mode: false,
			dht_bootstrap: "dev tcp transport".into(),
			joined_topic_count: 0,
			allowlist_count: peers.len() as u32,
			linked_count,
			pairing_session_active: Some(false),
			prefer_relay_only: Some(false),
			link_health: Some(LinkHealth::None),
		},
		peers,
	}
}

fn emit_mesh_snapshot(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	snap: PeerMeshStatusReply,
) -> Result<(), String> {
	let encoded = serde_json::to_string(&snap).map_err(|e| e.to_string())?;
	{
		let mut last = avendb
			.last_mesh_snapshot
			.write()
			.expect("last_mesh_snapshot poisoned");
		if last.as_ref() == Some(&encoded) {
			return Ok(());
		}
		*last = Some(encoded);
	}
	emit_avenos_runtime(
		app,
		serde_json::json!({ "kind": "mesh", "snapshot": snap }),
	);
	Ok(())
}

pub(super) async fn publish_peer_mesh_after_acl(app: &tauri::AppHandle) {
	runtime::avendb_actor(app).publish_mesh().await;
}

/// Actor-only: assemble + emit mesh snapshot (no re-enqueue). Skips emit when JSON unchanged.
pub(crate) async fn execute_publish_mesh(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	ss: &SelfState,
) {
	if let Err(e) = publish_trusted_peers_ui(app, avendb, ss).await {
		log::debug!(
			target: "avenos::avendb",
			"execute_publish_mesh: {e}",
		);
	}
}

/// Actor-only: real mesh UI snapshot for `meshStatus` IPC — trusted-peer rows
/// + live transport registration (same builder as the pushed snapshot).
pub(crate) async fn execute_mesh_snapshot(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	ss: &SelfState,
) -> Result<PeerMeshStatusReply, String> {
	if !ss.is_unlocked() {
		return Ok(build_peer_mesh_status(
			&[],
			&Default::default(),
			&Default::default(),
			String::new(),
		));
	}
	let client = with_connected_client(avendb, app, ss).await?;
	let rows = crate::signers::list_signer_rows(client.as_ref()).await?;
	let registered = registered_peer_dids(client.as_ref());
	let converged = converged_peer_dids(client.as_ref());
	Ok(build_peer_mesh_status(
		&rows,
		&registered,
		&converged,
		local_pk_prefix_hex(ss),
	))
}

pub(crate) async fn execute_mesh_refresh_full(
	_app: &tauri::AppHandle,
	_avendb: &ManagedAvenDb,
) -> Result<u32, String> {
	Ok(0)
}

pub(crate) async fn avendb_ipc_peer_list(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	self_state: &SelfState,
) -> Result<Vec<crate::signers::SignerRowReply>, String> {
	let client = with_connected_client(avendb, app, self_state).await?;
	crate::signers::list_signer_rows(client.as_ref()).await
}

/// First-contact / pairing: add a trusted peer (device DID) to My Network.
pub(crate) async fn avendb_ipc_peer_add(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	self_state: &SelfState,
	peer_did: String,
	device_label: String,
) -> Result<(), String> {
	let peer_did = peer_did.trim().to_string();
	if peer_did.is_empty() {
		return Err("peer_did is empty".into());
	}
	crate::avendb_auth::ed25519_public_from_signer_did(&peer_did)?;
	let client = with_connected_client(avendb, app, self_state).await?;
	let shell_arc = avendb_shell_ready(app, avendb, self_state, client.clone()).await?;
	if peer_did == shell_arc.as_ref().signer_did {
		return Err("cannot add your own DID as a peer".into());
	}
	crate::signers::add_remote_signer(client.as_ref(), &peer_did, &device_label).await?;

	// Resume sync immediately — e.g. re-adding a Forgotten peer. Idempotent with
	// the connect-time registration; harmless (queues until a transport exists)
	// when no live link to this peer is present yet.
	if let Ok(pk) = crate::avendb_auth::ed25519_public_from_signer_did(&peer_did) {
		if let Err(e) = client.register_peer_sync_client(PeerId(pk)) {
			log::warn!(target: "avenos::avendb", "peer_add register {peer_did}: {e}");
		}
	}

	// Reflect the new/reactivated peer in the list + mesh immediately.
	let _ = publish_trusted_peers_ui(app, avendb, self_state).await;
	Ok(())
}

pub(crate) async fn avendb_ipc_peer_revoke(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	self_state: &SelfState,
	peer_did: String,
) -> Result<(), String> {
	let client = with_connected_client(avendb, app, self_state).await?;
	crate::signers::set_signer_status(client.as_ref(), &peer_did, "revoked").await?;

	// Actually stop syncing: drop the registered peer client so we no longer
	// ship to it or accept its catch-up. Marking the row alone left the peer
	// live in the mesh — Forget appeared to do nothing.
	if let Ok(pk) = crate::avendb_auth::ed25519_public_from_signer_did(&peer_did) {
		match client.remove_peer_sync_client(PeerId(pk)) {
			Ok(true) => {}
			Ok(false) => log::warn!(
				target: "avenos::avendb",
				"peer_revoke {peer_did}: client had unprocessed inbox; deregister deferred"
			),
			Err(e) => log::warn!(target: "avenos::avendb", "peer_revoke {peer_did}: {e}"),
		}
	}

	// Re-publish the trusted-peer list + mesh snapshot so the row and its chip
	// disappear immediately (replaces the no-op execute_mesh_refresh_full).
	let _ = publish_trusted_peers_ui(app, avendb, self_state).await;
	let _ = avendb.change_tx.send("signers".to_string());
	Ok(())
}

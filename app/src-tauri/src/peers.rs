//! Trusted-peer list (`peers` Groove table, `kind=remote`). A flat set of device
//! DIDs I'm P2P-connected with — the trust set + spark-grant allowlist. Local-only
//! via `nosync` metadata; no `humans` coupling.

use groove::query_manager::types::Value;
use groove::JazzClient;
use serde_json::{Map, Value as JsonValue};

use crate::jazz::jazz_engine;

/// Load active remote peer DIDs referenced from the singleton `humans.my_devices` allowlist.
pub async fn list_active_peer_dids(client: &JazzClient) -> Result<Vec<String>, String> {
	let rows = jazz_engine::exec_list_rows(client, "peers").await?;
	let schema = jazz_engine::resolved_table_schema(client, "peers").await?;
	let did_ix = jazz_engine::col_ix(&schema, "peer_did")?;
	let status_ix = jazz_engine::col_ix(&schema, "status")?;
	let kind_ix = jazz_engine::col_ix(&schema, "kind")?;
	let mut dids = Vec::new();
	for (_oid, vals) in rows {
		let kind = vals
			.get(kind_ix)
			.and_then(value_as_text)
			.unwrap_or("");
		if kind != "remote" {
			continue;
		}
		let status = vals
			.get(status_ix)
			.and_then(value_as_text)
			.unwrap_or("");
		if status != "active" {
			continue;
		}
		let did = vals
			.get(did_ix)
			.and_then(value_as_text)
			.ok_or_else(|| "peers: missing peer_did".to_string())?;
		dids.push(did.trim().to_string());
	}
	Ok(dids)
}

fn value_as_text(v: &Value) -> Option<&str> {
	match v {
		Value::Text(s) => Some(s.as_str()),
		_ => None,
	}
}

/// One row for IPC — mirrors `peers` table (remote rows only for trusted-device UI).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerRowReply {
	pub id: String,
	pub peer_did: String,
	pub device_label: String,
	pub kind: String,
	pub added_at_ms: i64,
	pub status: String,
}

pub async fn list_peer_rows(client: &JazzClient) -> Result<Vec<PeerRowReply>, String> {
	let rows = jazz_engine::exec_list_rows(client, "peers").await?;
	let schema = jazz_engine::resolved_table_schema(client, "peers").await?;
	let did_ix = jazz_engine::col_ix(&schema, "peer_did")?;
	let label_ix = jazz_engine::col_ix(&schema, "device_label")?;
	let kind_ix = jazz_engine::col_ix(&schema, "kind")?;
	let status_ix = jazz_engine::col_ix(&schema, "status")?;
	let added_ix = jazz_engine::col_ix(&schema, "added_at_ms")?;
	let mut out = Vec::new();
	for (oid, vals) in rows {
		let kind = vals
			.get(kind_ix)
			.and_then(value_as_text)
			.unwrap_or("");
		if kind != "remote" {
			continue;
		}
		let status = vals
			.get(status_ix)
			.and_then(value_as_text)
			.unwrap_or("");
		if status == "revoked" {
			continue;
		}
		out.push(PeerRowReply {
			id: oid.uuid().to_string(),
			peer_did: vals
				.get(did_ix)
				.and_then(value_as_text)
				.unwrap_or("")
				.to_string(),
			device_label: vals
				.get(label_ix)
				.and_then(value_as_text)
				.unwrap_or("")
				.to_string(),
			kind: kind.to_string(),
			added_at_ms: vals
				.get(added_ix)
				.and_then(peer_timestamp_ms)
				.unwrap_or(0),
			status: vals
				.get(status_ix)
				.and_then(value_as_text)
				.unwrap_or("")
				.to_string(),
		});
	}
	Ok(out)
}

fn peer_timestamp_ms(v: &Value) -> Option<i64> {
	match v {
		Value::BigInt(i) => Some(*i),
		Value::Integer(i) => Some(*i as i64),
		Value::Text(s) => s.trim().parse().ok(),
		_ => None,
	}
}

/// Add a trusted peer (a device DID I'm P2P-connected with) to the local
/// `peers` table (`kind=remote`, `status=active`). This flat list IS the trust
/// set — no `humans` coupling. First-contact / pairing primitive (plan §8 step
/// 10 — the dev paste-DID shortcut). Idempotent: re-adding active peer is a no-op.
pub async fn add_remote_peer(
	client: &JazzClient,
	peer_did: &str,
	device_label: &str,
) -> Result<(), String> {
	let peer_did = peer_did.trim();
	if peer_did.is_empty() {
		return Err("peer_did is empty".into());
	}
	if is_allowlisted(client, peer_did).await? {
		return Ok(());
	}

	let schema = jazz_engine::resolved_table_schema(client, "peers").await?;
	let now_ms: i64 = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0);
	let label = {
		let l = device_label.trim();
		if l.is_empty() { "Peer" } else { l }.to_string()
	};
	let mut values: Map<String, JsonValue> = Map::new();
	values.insert("peer_did".into(), JsonValue::String(peer_did.to_string()));
	values.insert("device_label".into(), JsonValue::String(label));
	values.insert("kind".into(), JsonValue::String("remote".into()));
	values.insert("added_at_ms".into(), JsonValue::Number(now_ms.into()));
	values.insert("status".into(), JsonValue::String("active".into()));
	let row_vals = crate::jazz::insert_values("peers", &schema, values)?;
	client
		.create("peers", row_vals)
		.await
		.map_err(crate::jazz::format_jazz_err)?;
	Ok(())
}

pub async fn set_peer_status(
	client: &JazzClient,
	peer_did: &str,
	status: &str,
) -> Result<(), String> {
	let rows = jazz_engine::exec_list_rows(client, "peers").await?;
	let schema = jazz_engine::resolved_table_schema(client, "peers").await?;
	let did_ix = jazz_engine::col_ix(&schema, "peer_did")?;
	let peer_did = peer_did.trim();
	for (oid, vals) in rows {
		let existing = vals
			.get(did_ix)
			.and_then(value_as_text)
			.unwrap_or("");
		if existing.trim() == peer_did {
			let mut patch = Map::new();
			patch.insert(
				"status".into(),
				JsonValue::String(status.to_string()),
			);
			let ops = crate::jazz::patch_updates(&schema, patch)?;
			client
				.update(oid, ops)
				.await
				.map_err(crate::jazz::format_jazz_err)?;
			return Ok(());
		}
	}
	Err("peer_did not found in allowlist".into())
}

/// Returns true if `did` is an active allowlisted remote peer.
pub async fn is_allowlisted(client: &JazzClient, did: &str) -> Result<bool, String> {
	let dids = list_active_peer_dids(client).await?;
	let t = did.trim();
	Ok(dids.iter().any(|x| x == t))
}

//! Human-owned peer allowlist (`peers` Groove table). Local-only via `nosync` metadata on inserts (see jazz-tools `QueryManager::insert`).

use groove::query_manager::types::Value;
use groove::JazzClient;
use serde_json::{Map, Value as JsonValue};

use crate::jazz::jazz_engine;

/// Load active peer DIDs from the `peers` table.
pub async fn list_active_peer_dids(client: &JazzClient) -> Result<Vec<String>, String> {
	let rows = jazz_engine::exec_list_rows(client, "peers").await?;
	let schema = jazz_engine::resolved_table_schema(client, "peers").await?;
	let did_ix = jazz_engine::col_ix(&schema, "peer_did")?;
	let status_ix = jazz_engine::col_ix(&schema, "status")?;
	let mut dids = Vec::new();
	for (_oid, vals) in rows {
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

/// One row for IPC — mirrors `peers` table.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerRowReply {
	pub id: String,
	pub peer_did: String,
	pub label: String,
	pub added_at_ms: i64,
	pub status: String,
}

pub async fn list_peer_rows(client: &JazzClient) -> Result<Vec<PeerRowReply>, String> {
	let rows = jazz_engine::exec_list_rows(client, "peers").await?;
	let schema = jazz_engine::resolved_table_schema(client, "peers").await?;
	let did_ix = jazz_engine::col_ix(&schema, "peer_did")?;
	let label_ix = jazz_engine::col_ix(&schema, "label")?;
	let status_ix = jazz_engine::col_ix(&schema, "status")?;
	let added_ix = jazz_engine::col_ix(&schema, "added_at_ms")?;
	let mut out = Vec::new();
	for (oid, vals) in rows {
		out.push(PeerRowReply {
			id: oid.uuid().to_string(),
			peer_did: vals
				.get(did_ix)
				.and_then(value_as_text)
				.unwrap_or("")
				.to_string(),
			label: vals
				.get(label_ix)
				.and_then(value_as_text)
				.unwrap_or("")
				.to_string(),
			added_at_ms: vals
				.get(added_ix)
				.and_then(value_bigint)
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

fn value_bigint(v: &Value) -> Option<i64> {
	match v {
		Value::BigInt(i) => Some(*i),
		Value::Integer(i) => Some(*i as i64),
		_ => None,
	}
}

pub fn now_ms() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
		.unwrap_or(0)
}

/// Upsert by `peer_did`: updates first matching row or creates.
pub async fn upsert_peer_row(
	client: &JazzClient,
	peer_did: &str,
	label: &str,
	status: &str,
) -> Result<(), String> {
	let peer_did = peer_did.trim();
	crate::jazz_auth::ed25519_public_from_peer_did(peer_did)?;

	let rows = jazz_engine::exec_list_rows(client, "peers").await?;
	let schema = jazz_engine::resolved_table_schema(client, "peers").await?;
	let did_ix = jazz_engine::col_ix(&schema, "peer_did")?;

	for (oid, vals) in rows {
		let existing = vals
			.get(did_ix)
			.and_then(value_as_text)
			.unwrap_or("");
		if existing.trim() == peer_did {
			let mut patch = Map::new();
			patch.insert("label".into(), JsonValue::String(label.to_string()));
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

	let vals: Vec<Value> = vec![
		Value::Text(peer_did.to_string()),
		Value::Text(label.to_string()),
		Value::BigInt(now_ms()),
		Value::Text(status.to_string()),
	];
	client
		.create("peers", vals)
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

/// Returns true if `did` is an active allowlisted peer.
pub async fn is_allowlisted(client: &JazzClient, did: &str) -> Result<bool, String> {
	let dids = list_active_peer_dids(client).await?;
	let t = did.trim();
	Ok(dids.iter().any(|x| x == t))
}

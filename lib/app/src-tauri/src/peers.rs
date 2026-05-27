//! Human-owned peer allowlist (`peers` Groove table). Local-only via `nosync` metadata on inserts.

use std::collections::HashSet;

use groove::query_manager::types::Value;
use groove::{JazzClient, ObjectId};
use serde_json::{Map, Value as JsonValue};

use crate::jazz::jazz_engine;

/// Load active remote peer DIDs referenced from the singleton `humans.my_devices` allowlist.
pub async fn list_active_peer_dids(client: &JazzClient) -> Result<Vec<String>, String> {
	let allowed = human_allowed_peer_object_ids(client).await?;
	if allowed.is_empty() {
		return Ok(Vec::new());
	}
	let rows = jazz_engine::exec_list_rows(client, "peers").await?;
	let schema = jazz_engine::resolved_table_schema(client, "peers").await?;
	let did_ix = jazz_engine::col_ix(&schema, "peer_did")?;
	let status_ix = jazz_engine::col_ix(&schema, "status")?;
	let kind_ix = jazz_engine::col_ix(&schema, "kind")?;
	let mut dids = Vec::new();
	for (oid, vals) in rows {
		if !allowed.contains(&oid) {
			continue;
		}
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

async fn human_allowed_peer_object_ids(client: &JazzClient) -> Result<HashSet<ObjectId>, String> {
	let rows = jazz_engine::exec_list_rows(client, "humans").await?;
	if rows.is_empty() {
		return Ok(HashSet::new());
	}
	let schema = jazz_engine::resolved_table_schema(client, "humans").await?;
	let dev_ix = jazz_engine::col_ix(&schema, "my_devices")?;
	let (_oid, vals) = rows
		.first()
		.ok_or_else(|| "humans: empty table".to_string())?;
	let cell = vals.get(dev_ix).ok_or_else(|| "humans: missing my_devices".to_string())?;
	let mut out = HashSet::new();
	match cell {
		Value::Array(items) => {
			for v in items {
				match v {
					Value::Uuid(oid) => {
						out.insert(*oid);
					}
					Value::Text(s) => {
						let u = uuid::Uuid::parse_str(s.trim())
							.map_err(|e| format!("humans.my_devices uuid parse: {e}"))?;
						out.insert(ObjectId::from_uuid(u));
					}
					_ => {}
				}
			}
		}
		_ => return Err("humans.my_devices: expected array".into()),
	}
	Ok(out)
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
	let allowed = human_allowed_peer_object_ids(client).await?;
	let rows = jazz_engine::exec_list_rows(client, "peers").await?;
	let schema = jazz_engine::resolved_table_schema(client, "peers").await?;
	let did_ix = jazz_engine::col_ix(&schema, "peer_did")?;
	let label_ix = jazz_engine::col_ix(&schema, "device_label")?;
	let kind_ix = jazz_engine::col_ix(&schema, "kind")?;
	let status_ix = jazz_engine::col_ix(&schema, "status")?;
	let added_ix = jazz_engine::col_ix(&schema, "added_at_ms")?;
	let mut out = Vec::new();
	for (oid, vals) in rows {
		if !allowed.contains(&oid) {
			continue;
		}
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

async fn human_singleton_oid(client: &JazzClient) -> Result<ObjectId, String> {
	let rows = jazz_engine::exec_list_rows(client, "humans").await?;
	let (oid, _) = rows
		.first()
		.ok_or_else(|| "humans row missing: re-onboard this vault".to_string())?;
	Ok(*oid)
}

async fn append_peer_to_human(client: &JazzClient, peer_row: ObjectId) -> Result<(), String> {
	let hum_oid = human_singleton_oid(client).await?;
	let schema = jazz_engine::resolved_table_schema(client, "humans").await?;
	let dev_ix = jazz_engine::col_ix(&schema, "my_devices")?;
	let rows = jazz_engine::exec_list_rows(client, "humans").await?;
	let vals = rows
		.iter()
		.find(|(o, _)| *o == hum_oid)
		.map(|(_, v)| v.as_slice())
		.ok_or_else(|| "humans singleton not found".to_string())?;
	let cell = vals.get(dev_ix).ok_or_else(|| "humans: missing my_devices".to_string())?;
	let mut list: Vec<Value> = match cell {
		Value::Array(items) => items.clone(),
		_ => return Err("humans.my_devices: expected array".into()),
	};
	let needle = Value::Uuid(peer_row);
	if !list.iter().any(|v| v == &needle) {
		list.push(needle);
	}
	let mut patch = Map::new();
	patch.insert(
		"my_devices".into(),
		JsonValue::Array(list.iter().map(value_to_json).collect()),
	);
	let ops = crate::jazz::patch_updates(&schema, patch)?;
	client
		.update(hum_oid, ops)
		.await
		.map_err(crate::jazz::format_jazz_err)?;
	Ok(())
}

fn value_to_json(v: &Value) -> JsonValue {
	match v {
		Value::Text(s) => JsonValue::String(s.clone()),
		Value::BigInt(i) => JsonValue::Number((*i).into()),
		Value::Integer(i) => JsonValue::Number((*i).into()),
		Value::Boolean(b) => JsonValue::Bool(*b),
		Value::Uuid(oid) => JsonValue::String(oid.uuid().to_string()),
		Value::Null => JsonValue::Null,
		Value::Array(a) => JsonValue::Array(a.iter().map(value_to_json).collect()),
		Value::Row(r) => JsonValue::Array(r.iter().map(value_to_json).collect()),
		Value::Timestamp(t) => JsonValue::Number((*t).into()),
	}
}

/// Upsert by `peer_did` for a **remote** peer; appends new row id to `humans.my_devices`.
pub async fn upsert_remote_peer_row(
	client: &JazzClient,
	peer_did: &str,
	device_label: &str,
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
			patch.insert(
				"device_label".into(),
				JsonValue::String(device_label.to_string()),
			);
			patch.insert("status".into(), JsonValue::String(status.to_string()));
			let ops = crate::jazz::patch_updates(&schema, patch)?;
			client
				.update(oid, ops)
				.await
				.map_err(crate::jazz::format_jazz_err)?;
			append_peer_to_human(client, oid).await?;
			return Ok(());
		}
	}

	let mut row = Map::new();
	row.insert("peer_did".into(), JsonValue::String(peer_did.to_string()));
	row.insert(
		"device_label".into(),
		JsonValue::String(device_label.to_string()),
	);
	row.insert("kind".into(), JsonValue::String("remote".into()));
	row.insert("added_at_ms".into(), JsonValue::Number(now_ms().into()));
	row.insert("status".into(), JsonValue::String(status.to_string()));
	let vals = crate::jazz::insert_values(&schema, row)?;
	let oid = client
		.create("peers", vals)
		.await
		.map_err(crate::jazz::format_jazz_err)?;
	append_peer_to_human(client, oid).await?;
	Ok(())
}

async fn remove_peer_from_human(client: &JazzClient, peer_row: ObjectId) -> Result<(), String> {
	let hum_oid = human_singleton_oid(client).await?;
	let schema = jazz_engine::resolved_table_schema(client, "humans").await?;
	let dev_ix = jazz_engine::col_ix(&schema, "my_devices")?;
	let rows = jazz_engine::exec_list_rows(client, "humans").await?;
	let vals = rows
		.iter()
		.find(|(o, _)| *o == hum_oid)
		.map(|(_, v)| v.as_slice())
		.ok_or_else(|| "humans singleton not found".to_string())?;
	let cell = vals.get(dev_ix).ok_or_else(|| "humans: missing my_devices".to_string())?;
	let list: Vec<Value> = match cell {
		Value::Array(items) => items
			.iter()
			.filter(|v| match v {
				Value::Uuid(oid) => *oid != peer_row,
				Value::Text(s) => uuid::Uuid::parse_str(s.trim())
					.ok()
					.map(|u| ObjectId::from_uuid(u) != peer_row)
					.unwrap_or(true),
				_ => true,
			})
			.cloned()
			.collect(),
		_ => return Err("humans.my_devices: expected array".into()),
	};
	let mut patch = Map::new();
	patch.insert(
		"my_devices".into(),
		JsonValue::Array(list.iter().map(value_to_json).collect()),
	);
	let ops = crate::jazz::patch_updates(&schema, patch)?;
	client
		.update(hum_oid, ops)
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
			if status == "revoked" {
				remove_peer_from_human(client, oid).await?;
			}
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

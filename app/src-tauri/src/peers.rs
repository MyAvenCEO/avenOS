//! Trusted-peer list (`peers` avenDB table, `kind=remote`). A flat set of device
//! DIDs I'm P2P-connected with — the trust set + identity-grant allowlist. Local-only
//! via `nosync` metadata; no `humans` coupling.

use aven_db::query_manager::types::Value;
use aven_db::AvenDbClient;
use serde_json::{Map, Value as JsonValue};

use crate::avendb::avendb_engine;

/// Load active remote peer DIDs referenced from the singleton `humans.my_devices` allowlist.
pub async fn list_active_signer_dids(client: &AvenDbClient) -> Result<Vec<String>, String> {
	let rows = engine::exec_list_rows(client, "peers").await?;
	let schema = engine::resolved_table_schema(client, "peers").await?;
	let did_ix = engine::col_ix(&schema, "signer_did")?;
	let status_ix = engine::col_ix(&schema, "status")?;
	let kind_ix = engine::col_ix(&schema, "kind")?;
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
			.ok_or_else(|| "peers: missing signer_did".to_string())?;
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

/// The device's default identity id (lowest `owner`, matching `hydrate_shell`'s
/// `default_identity` selection). `peers` is now a identity-scoped table (caps-only
/// sync): trust-set rows live in the device's own default identity, so they sync
/// across the user's own devices but stay invisible to a paired peer who doesn't
/// hold that identity. Returns `None` before any identity exists (pre-bootstrap).
pub async fn default_spark_id(client: &AvenDbClient) -> Result<Option<uuid::Uuid>, String> {
	let rows = engine::exec_list_rows(client, "identities").await?;
	let schema = engine::resolved_table_schema(client, "identities").await?;
	let identity_ix = engine::col_ix(&schema, "owner")?;
	let mut ids: Vec<uuid::Uuid> = Vec::new();
	for (_oid, vals) in rows {
		if let Ok(sid) = engine::uuid_cell_at(vals.as_slice(), identity_ix) {
			ids.push(sid);
		}
	}
	ids.sort();
	Ok(ids.into_iter().next())
}

/// One row for IPC — mirrors `peers` table (remote rows only for trusted-device UI).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerRowReply {
	pub id: String,
	pub signer_did: String,
	pub device_label: String,
	pub kind: String,
	pub added_at_ms: i64,
	pub status: String,
}

pub async fn list_peer_rows(client: &AvenDbClient) -> Result<Vec<PeerRowReply>, String> {
	let rows = engine::exec_list_rows(client, "peers").await?;
	let schema = engine::resolved_table_schema(client, "peers").await?;
	let did_ix = engine::col_ix(&schema, "signer_did")?;
	let label_ix = engine::col_ix(&schema, "device_label")?;
	let kind_ix = engine::col_ix(&schema, "kind")?;
	let status_ix = engine::col_ix(&schema, "status")?;
	let added_ix = engine::col_ix(&schema, "added_at_ms")?;
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
			signer_did: vals
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
	client: &AvenDbClient,
	signer_did: &str,
	device_label: &str,
) -> Result<(), String> {
	let signer_did = signer_did.trim();
	if signer_did.is_empty() {
		return Err("signer_did is empty".into());
	}
	if is_allowlisted(client, signer_did).await? {
		return Ok(());
	}
	// Re-adding a previously Forgotten peer: reactivate its row instead of
	// creating a duplicate (a leftover revoked row would keep it deregistered).
	if is_peer_revoked(client, signer_did).await? {
		return set_peer_status(client, signer_did, "active").await;
	}

	let schema = engine::resolved_table_schema(client, "peers").await?;
	let now_ms: i64 = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0);
	// Store the caller's label verbatim (empty allowed). Grant-side callers pass an
	// empty label because they don't know the peer's real name — the UI then falls back
	// to the short DID (and to the roster name once the peer self-publishes) instead of
	// showing a misleading role word like "Replication Server" as if it were the device.
	let label = device_label.trim().to_string();
	let mut values: Map<String, JsonValue> = Map::new();
	// Scope the trust-set row to the device's default identity so it syncs across the
	// user's own devices (caps-only). If no identity exists yet it stays null = local.
	if let Some(sid) = default_spark_id(client).await? {
		values.insert("owner".into(), JsonValue::String(sid.to_string()));
	}
	values.insert("signer_did".into(), JsonValue::String(signer_did.to_string()));
	values.insert("device_label".into(), JsonValue::String(label));
	values.insert("kind".into(), JsonValue::String("remote".into()));
	values.insert("added_at_ms".into(), JsonValue::Number(now_ms.into()));
	values.insert("status".into(), JsonValue::String("active".into()));
	let row_vals = crate::avendb::insert_values("peers", &schema, values)?;
	client
		.create("peers", row_vals)
		.await
		.map_err(crate::avendb::format_avendb_err)?;
	Ok(())
}

pub async fn set_peer_status(
	client: &AvenDbClient,
	signer_did: &str,
	status: &str,
) -> Result<(), String> {
	let rows = engine::exec_list_rows(client, "peers").await?;
	let schema = engine::resolved_table_schema(client, "peers").await?;
	let did_ix = engine::col_ix(&schema, "signer_did")?;
	let signer_did = signer_did.trim();
	// Update EVERY matching row, not just the first: earlier add/forget cycles can
	// leave duplicate rows for one DID. A lingering `revoked` dup would otherwise
	// keep is_peer_revoked() true after re-granting → the connect gate skips
	// registration → the peer stays "Offline" and never syncs.
	let mut matched = false;
	for (oid, vals) in rows {
		let existing = vals
			.get(did_ix)
			.and_then(value_as_text)
			.unwrap_or("");
		if existing.trim() == signer_did {
			matched = true;
			let mut patch = Map::new();
			patch.insert(
				"status".into(),
				JsonValue::String(status.to_string()),
			);
			let ops = crate::avendb::patch_updates(&schema, patch)?;
			client
				.update(oid, ops)
				.await
				.map_err(crate::avendb::format_avendb_err)?;
		}
	}
	if matched {
		Ok(())
	} else {
		Err("signer_did not found in allowlist".into())
	}
}

/// Returns true if `did` is an active allowlisted remote peer.
pub async fn is_allowlisted(client: &AvenDbClient, did: &str) -> Result<bool, String> {
	let dids = list_active_signer_dids(client).await?;
	let t = did.trim();
	Ok(dids.iter().any(|x| x == t))
}

/// True if `did` is Forgotten: it has a `revoked` row AND **no** active row.
/// The "no active row" guard self-heals duplicate rows from earlier add/forget
/// cycles — a lingering revoked dup alongside an active row must NOT keep the
/// peer deregistered (that left it stuck "Offline"). Distinct from "unknown"
/// (no row) so first-contact stays permissive while a true Forget persists.
pub async fn is_peer_revoked(client: &AvenDbClient, did: &str) -> Result<bool, String> {
	let rows = engine::exec_list_rows(client, "peers").await?;
	let schema = engine::resolved_table_schema(client, "peers").await?;
	let did_ix = engine::col_ix(&schema, "signer_did")?;
	let status_ix = engine::col_ix(&schema, "status")?;
	let t = did.trim();
	let mut has_revoked = false;
	let mut has_active = false;
	for (_oid, vals) in rows {
		let row_did = vals.get(did_ix).and_then(value_as_text).unwrap_or("").trim();
		if row_did != t {
			continue;
		}
		match vals.get(status_ix).and_then(value_as_text).unwrap_or("") {
			"revoked" => has_revoked = true,
			"active" => has_active = true,
			_ => {}
		}
	}
	Ok(has_revoked && !has_active)
}

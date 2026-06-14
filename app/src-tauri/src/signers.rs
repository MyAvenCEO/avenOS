//! Trusted-peer list (`peers` avenDB table, `kind=remote`). A flat set of device
//! DIDs I'm P2P-connected with — the trust set + identity-grant allowlist. Local-only
//! via `nosync` metadata; no `humans` coupling.

use aven_db::query_manager::types::Value;
use aven_db::AvenDbClient;
use serde_json::{Map, Value as JsonValue};

use crate::avendb::engine;

/// Load active remote peer DIDs referenced from the singleton `humans.my_devices` allowlist.
pub async fn list_active_signer_dids(client: &AvenDbClient) -> Result<Vec<String>, String> {
	let rows = engine::exec_list_rows(client, "signers").await?;
	let schema = engine::resolved_table_schema(client, "signers").await?;
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
	let rows = engine::exec_list_rows(client, "safes").await?;
	let schema = engine::resolved_table_schema(client, "safes").await?;
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
pub struct SignerRowReply {
	pub id: String,
	pub signer_did: String,
	pub device_label: String,
	pub kind: String,
	/// How the key is held — apple_se | env_seed | … (None = apple_se). Surfaced as the
	/// signer-type label in the Members UI.
	pub signer_type: Option<String>,
	pub added_at_ms: i64,
	pub status: String,
}

pub async fn list_signer_rows(client: &AvenDbClient) -> Result<Vec<SignerRowReply>, String> {
	let rows = engine::exec_list_rows(client, "signers").await?;
	let schema = engine::resolved_table_schema(client, "signers").await?;
	let did_ix = engine::col_ix(&schema, "signer_did")?;
	let label_ix = engine::col_ix(&schema, "device_label")?;
	let kind_ix = engine::col_ix(&schema, "kind")?;
	let status_ix = engine::col_ix(&schema, "status")?;
	let added_ix = engine::col_ix(&schema, "added_at_ms")?;
	let signer_type_ix = engine::col_ix(&schema, "signer_type").ok();
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
		out.push(SignerRowReply {
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
			signer_type: signer_type_ix
				.and_then(|ix| vals.get(ix))
				.and_then(value_as_text)
				.map(str::to_string)
				.filter(|s| !s.is_empty()),
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
/// Trust-set rows deferred because no SAFE existed yet to own them (board 0037): we never author
/// an ownerless owned row, so the pairing/grant DID is queued here and replayed by
/// [`drain_pending_signers`] once the device has an identity. In-memory — a restart mid-onboarding
/// drops the queue, but the user-initiated pairing/grant that produced it is idempotent and re-runs.
static PENDING_SIGNERS: std::sync::OnceLock<std::sync::Mutex<Vec<(String, String)>>> =
	std::sync::OnceLock::new();

fn pending_signers() -> &'static std::sync::Mutex<Vec<(String, String)>> {
	PENDING_SIGNERS.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

/// Replay any deferred trust-set rows now that the device may have an identity (board 0037). A no-op
/// until a SAFE exists. Safe to call from any path that establishes or observes the default identity
/// (it is also called at the top of every [`add_remote_signer`], so an onboarding backlog drains as
/// soon as one signer-add runs after the SAFE lands).
pub async fn drain_pending_signers(client: &AvenDbClient) -> Result<(), String> {
	if default_spark_id(client).await?.is_none() {
		return Ok(());
	}
	let queued: Vec<(String, String)> = {
		let mut guard = pending_signers()
			.lock()
			.map_err(|_| "pending signers lock".to_string())?;
		std::mem::take(&mut *guard)
	};
	for (did, label) in queued {
		add_remote_signer_inner(client, &did, &label).await?;
	}
	Ok(())
}

/// Add a trusted peer (a device DID I'm P2P-connected with) to the local
/// `signers` table (`kind=remote`, `status=active`). This flat list IS the trust
/// set — no `humans` coupling. First-contact / pairing primitive. Idempotent.
pub async fn add_remote_signer(
	client: &AvenDbClient,
	signer_did: &str,
	device_label: &str,
) -> Result<(), String> {
	// Replay anything deferred before this call — onboarding fires several signer-adds, so a
	// backlog queued before the SAFE existed lands as soon as one does (board 0037).
	drain_pending_signers(client).await?;
	add_remote_signer_inner(client, signer_did, device_label).await
}

async fn add_remote_signer_inner(
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
	if is_signer_revoked(client, signer_did).await? {
		return set_signer_status(client, signer_did, "active").await;
	}

	// Store the caller's label verbatim (empty allowed). Grant-side callers pass an
	// empty label because they don't know the peer's real name — the UI then falls back
	// to the short DID (and to the roster name once the peer self-publishes) instead of
	// showing a misleading role word like "Replication Server" as if it were the device.
	let label = device_label.trim().to_string();
	// Every owner-scoped row belongs to a SAFE (board 0037): scope the trust-set row to the
	// device's default identity. If none exists yet there is nothing to own it — DEFER rather than
	// author an ownerless owned row (which the fail-closed funnel would reject anyway).
	let Some(owner) = default_spark_id(client).await? else {
		pending_signers()
			.lock()
			.map_err(|_| "pending signers lock".to_string())?
			.push((signer_did.to_string(), label));
		log::info!(
			target: "avenos::signers",
			"deferred remote signer {signer_did} — no SAFE owner yet (replays once an identity exists)"
		);
		return Ok(());
	};

	let schema = engine::resolved_table_schema(client, "signers").await?;
	let now_ms: i64 = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0);
	let mut values: Map<String, JsonValue> = Map::new();
	values.insert("owner".into(), JsonValue::String(owner.to_string()));
	values.insert("signer_did".into(), JsonValue::String(signer_did.to_string()));
	values.insert("device_label".into(), JsonValue::String(label));
	values.insert("kind".into(), JsonValue::String("remote".into()));
	values.insert("added_at_ms".into(), JsonValue::Number(now_ms.into()));
	values.insert("status".into(), JsonValue::String("active".into()));
	let row_vals = crate::avendb::insert_values("signers", &schema, values)?;
	client
		.create_checked("signers", row_vals)
		.await
		.map_err(crate::avendb::format_avendb_err)?;
	Ok(())
}

pub async fn set_signer_status(
	client: &AvenDbClient,
	signer_did: &str,
	status: &str,
) -> Result<(), String> {
	let rows = engine::exec_list_rows(client, "signers").await?;
	let schema = engine::resolved_table_schema(client, "signers").await?;
	let did_ix = engine::col_ix(&schema, "signer_did")?;
	let signer_did = signer_did.trim();
	// Update EVERY matching row, not just the first: earlier add/forget cycles can
	// leave duplicate rows for one DID. A lingering `revoked` dup would otherwise
	// keep is_signer_revoked() true after re-granting → the connect gate skips
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
pub async fn is_signer_revoked(client: &AvenDbClient, did: &str) -> Result<bool, String> {
	let rows = engine::exec_list_rows(client, "signers").await?;
	let schema = engine::resolved_table_schema(client, "signers").await?;
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

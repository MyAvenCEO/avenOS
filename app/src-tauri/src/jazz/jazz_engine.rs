//! Shell: vault, DEKs, sealed text columns (submodule of `jazz`).

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;

use base64::Engine;
use groove::{
	query_manager::types::{ColumnType, TableName, TableSchema},
	JazzClient,
	ObjectId,
	QueryBuilder,
	Value,
};
use serde_json::{json, Map, Value as JsonValue};
use tauri_plugin_self::paths;
use tauri_plugin_self::vault::VaultManifest;
use uuid::Uuid;

use crate::{
	crypto::{
		cell_seal_aad, column_type_slug, groove_value_to_canonical_utf8, ipc_json_from_opened_sensitive_plaintext,
		decrypt_keyshare_payload, derive_kek_x25519, open_text_cell_payload,
		keyshare_wrap_aad, seal_text_cell_payload, Dek, CELL_ENVELOPE_V1,
	},
	jazz_auth,
	schema_manifest,
	identity_acc::{self, AccOp},
};

pub(crate) struct ShellState {
	pub(crate) peer_did: String,
	pub(crate) vault: identity_acc::BiscuitVault,
	#[allow(dead_code)]
	pub(crate) signing_key: ed25519_dalek::SigningKey,
	pub(crate) default_identity: Uuid,
	pub(crate) deks: HashMap<(Uuid, i64), Dek>,
	pub(crate) identity_versions: HashMap<Uuid, i64>,
	/// Groove write branch (`JazzClient` uses SchemaManager `"client"` / `"main"`). List queries must
	/// use this branch only; empty `Query.branches` expands to **all live schema branches**, so merged
	/// reads can expose rows whose tips are not writable on `current_branch()` (ObjectNotFound).
	pub(crate) groove_write_branch: String,
}

fn jazz_cell_json(cell: &Value) -> JsonValue {
	match cell {
		Value::Integer(i) => JsonValue::Number((*i).into()),
		Value::BigInt(i) => JsonValue::Number((*i).into()),
		Value::Boolean(b) => JsonValue::Bool(*b),
		Value::Text(s) => JsonValue::String(s.clone()),
		Value::Timestamp(ts) => JsonValue::Number((*ts).into()),
		Value::Uuid(oid) => JsonValue::String(oid.uuid().to_string()),
		Value::Null => JsonValue::Null,
		Value::Array(items) => JsonValue::Array(items.iter().map(jazz_cell_json).collect()),
		Value::Row { values: items, .. } => {
			JsonValue::Array(items.iter().map(jazz_cell_json).collect())
		}
		Value::Double(d) => JsonValue::Number(
			serde_json::Number::from_f64(*d).map(Into::into).unwrap_or(0.into()),
		),
		Value::BatchId(id) => JsonValue::String(hex::encode(id)),
		Value::Bytea(b) => JsonValue::String(base64::engine::general_purpose::STANDARD.encode(b)),
		Value::Vector(v) => JsonValue::Array(
			v.iter()
				.map(|f| {
					serde_json::Number::from_f64(*f as f64)
						.map(Into::into)
						.unwrap_or(JsonValue::Null)
				})
				.collect(),
		),
	}
}

pub(crate) fn secrets_for_table(table: &str) -> Option<&'static HashSet<String>> {
	secret_manifest().get(table)
}

fn secret_manifest() -> &'static HashMap<String, HashSet<String>> {
	static M: OnceLock<HashMap<String, HashSet<String>>> = OnceLock::new();
	M.get_or_init(|| {
		schema_manifest::manifest_secret_columns().expect("aven-schema manifest secret columns")
	})
}

pub(crate) fn col_ix(tbl: &TableSchema, name: &str) -> Result<usize, String> {
	tbl.columns
		.columns
		.iter()
		.position(|c| c.name_str() == name)
		.ok_or_else(|| format!("manifest_missing_col:{name}"))
}

pub(crate) fn uuid_cell_at(vals: &[Value], ix: usize) -> Result<Uuid, String> {
	match vals.get(ix).ok_or("col_ix_oob")? {
		Value::Uuid(oid) => Ok(*oid.uuid()),
		Value::Text(s) => Uuid::parse_str(s.trim()).map_err(|e| format!("uuid_parse:{e}")),
		x => Err(format!("expected_uuid_cell:{x:?}")),
	}
}

pub(super) fn bigint_i64(v: &Value) -> Result<i64, String> {
	match v {
		Value::BigInt(i) => Ok(*i),
		Value::Integer(i) => Ok(*i as i64),
		x => Err(format!("expected_bigint_cell:{x:?}")),
	}
}

fn open_sealed_text_for_identity(
	deks: &HashMap<(Uuid, i64), Dek>,
	identity: Uuid,
	raw: &str,
) -> Result<String, String> {
	if !raw.starts_with(CELL_ENVELOPE_V1) {
		return Ok(raw.to_string());
	}
	let mut vers: Vec<i64> = deks
		.keys()
		.filter(|(s, _)| *s == identity)
		.map(|(_, v)| *v)
		.collect();
	vers.sort_unstable();
	for dv in vers {
		let Some(dek) = deks.get(&(identity, dv)) else {
			continue;
		};
		if let Ok((opened, _)) = open_text_cell_payload(dek.expose(), raw) {
			return Ok(opened);
		}
	}
	Err(format!("hydrate_open_sealed:{identity}"))
}

fn hydrate_text_at(
	deks: &HashMap<(Uuid, i64), Dek>,
	identity: Uuid,
	cell: &Value,
) -> Result<String, String> {
	match cell {
		Value::Text(s) => open_sealed_text_for_identity(deks, identity, s.as_str()),
		Value::Bytea(b) => {
			let s = std::str::from_utf8(b.as_slice()).map_err(|_| "hydrate_bytea_utf8".to_string())?;
			open_sealed_text_for_identity(deks, identity, s)
		}
		x => Err(format!("hydrate_text_bad:{x:?}")),
	}
}

fn hydrate_i64_at(
	deks: &HashMap<(Uuid, i64), Dek>,
	identity: Uuid,
	cell: &Value,
	storage_ty: &ColumnType,
) -> Result<i64, String> {
	match cell {
		Value::BigInt(i) => Ok(*i),
		Value::Integer(i) => Ok(*i as i64),
		Value::Text(_) | Value::Bytea(_) => {
			let opened = hydrate_text_at(deks, identity, cell)?;
			if let Ok(n) = opened.trim().parse::<i64>() {
				return Ok(n);
			}
			let ipc = ipc_json_from_opened_sensitive_plaintext(&opened, storage_ty)?;
			if let Some(n) = ipc.as_i64() {
				return Ok(n);
			}
			if let Some(s) = ipc.as_str() {
				return s
					.trim()
					.parse::<i64>()
					.map_err(|_| format!("hydrate_i64_not_number:{opened}"));
			}
			Err(format!("hydrate_i64_not_number:{opened}"))
		}
		x => Err(format!("hydrate_i64_bad:{x:?}")),
	}
}

pub(super) fn identity_uuid_row(schema: &TableSchema, vals: &[Value]) -> Result<Uuid, String> {
	let ix = col_ix(schema, "owner")?;
	uuid_cell_at(vals, ix)
}

pub(super) fn authorize_gate(
	state: &ShellState,
	table: &str,
	op: AccOp,
	owner: Uuid,
	row_uuid: Option<Uuid>,
) -> Result<(), String> {
	identity_acc::authorize(&state.vault, owner, op, table, row_uuid, &state.peer_did)
}

fn now_unix_ms_i64() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
		.unwrap_or(0i64)
}

pub(super) fn short_peer_did(did: &str) -> String {
	match did.strip_prefix("did:key:") {
		Some(rest) => {
			let head: String = rest.chars().take(12).collect();
			format!("did:key:{head}…")
		}
		None => did.chars().take(24).collect(),
	}
}

pub(super) fn identity_urn(id: Uuid) -> String {
	format!("identity:{id}")
}

pub(super) fn identity_uuid_from_json_row(
	tbl: &TableSchema,
	row: &Map<String, JsonValue>,
) -> Result<Uuid, String> {
	let ix = col_ix(tbl, "owner")?;
	let desc = tbl.columns.columns.get(ix).ok_or("identity_desc_ix")?;
	let raw = row
		.get("owner")
		.ok_or_else(|| "missing_spark_id".to_string())?;
	let v =
		super::json_cell_to_jazz(raw, &desc.column_type, desc.nullable)?;
	match v {
		Value::Uuid(oid) => Ok(*oid.uuid()),
		Value::Text(s) => {
			Uuid::parse_str(s.trim()).map_err(|e| format!("uuid_parse:{e}"))
		}
		x => Err(format!("expected_uuid_cell:{x:?}")),
	}
}

pub(super) fn place_secrets_for_insert(
	tbl: &TableSchema,
	table: &str,
	values: &mut Map<String, JsonValue>,
	plaintext_out: &mut HashMap<String, String>,
	phase1: &str,
) -> Result<(), String> {
	let Some(secrets) = secret_manifest().get(table) else {
		return Ok(());
	};
	for desc in tbl.columns.columns.iter() {
		let key = desc.name_str();
		if !secrets.contains(key) {
			continue;
		}
		match values.get_mut(key) {
			None => {
				if !desc.nullable {
					return Err(format!("missing_secret_column:{key}"));
				}
			}
			Some(raw) => {
				if raw.is_null() {
					if !desc.nullable {
						return Err(format!("null_secret_disallowed:{key}"));
					}
					continue;
				}
				let gv = if let Some(expose) =
					crate::schema_manifest::expose_ts_for(table, key)
				{
					super::json_cell_to_jazz(raw, expose, desc.nullable)?
				} else {
					super::json_cell_to_jazz(raw, &desc.column_type, desc.nullable)?
				};
				let canon = groove_value_to_canonical_utf8(&gv)?;
				plaintext_out.insert(key.to_string(), canon);
				*raw = JsonValue::String(phase1.into());
			}
		}
	}
	Ok(())
}

pub(super) fn inject_default_identity(
	values: &mut Map<String, JsonValue>,
	tbl: &TableSchema,
	default: Uuid,
) -> Result<(), String> {
	if col_ix(tbl, "owner").is_err() {
		return Ok(());
	}
	if values.contains_key("owner") {
		return Ok(());
	}
	values.insert(
		"owner".into(),
		JsonValue::String(default.to_string()),
	);
	Ok(())
}

fn current_dek_version(state: &ShellState, identity: Uuid) -> Result<i64, String> {
	let claimed = state
		.identity_versions
		.get(&identity)
		.cloned()
		.ok_or_else(|| format!("unknown_spark_version:{identity}"))?;
	// Downgrade defense: `current_dek_version` rides as a PLAINTEXT column, so a relay could
	// tamper it DOWN to make new writes seal under an old DEK a revoked peer still holds.
	// Rotation always hands remaining holders the new version, so the newest DEK THIS device
	// holds is the true current one — never seal under anything older than that.
	let max_held = state
		.deks
		.keys()
		.filter(|(sid, _)| *sid == identity)
		.map(|(_, v)| *v)
		.max()
		.unwrap_or(claimed);
	Ok(claimed.max(max_held))
}

pub(super) fn seal_column_plain(
	state: &ShellState,
	table: &str,
	col_name: &str,
	storage_ty: &ColumnType,
	identity: Uuid,
	row: Uuid,
	canonical_plaintext_utf8: &str,
) -> Result<String, String> {
	let v = current_dek_version(state, identity)?;
	let dek_entry = state
		.deks
		.get(&(identity, v))
		.ok_or_else(|| format!("missing_dek_cached:{identity}|{v}"))?;
	let urn = identity_urn(identity);
	let slug = column_type_slug(storage_ty);
	let aad = cell_seal_aad(&urn, table, col_name, row, v, slug);
	seal_text_cell_payload(dek_entry.expose(), &aad, canonical_plaintext_utf8)
}

fn map_sensitive_storage_cell(
	state: &ShellState,
	col: &str,
	storage_ty: &ColumnType,
	identity: Uuid,
	raw: &str,
	miss: &mut Vec<String>,
) -> JsonValue {
	if !raw.starts_with(CELL_ENVELOPE_V1) {
		return ipc_json_from_opened_sensitive_plaintext(raw, storage_ty)
			.unwrap_or_else(|_| JsonValue::String(raw.into()));
	}
	for ((sp, _dv), dek) in &state.deks {
		if *sp != identity {
			continue;
		}
		if let Ok((opened, _ver)) = open_text_cell_payload(dek.expose(), raw) {
			return ipc_json_from_opened_sensitive_plaintext(&opened, storage_ty).unwrap_or_else(|_| {
				JsonValue::String(opened.into())
			});
		}
	}
	// DIAG: a sealed cell we received but cannot open — either we hold no DEK for this
	// identity (keyshare never arrived/unwrapped) or only a wrong-version one.
	let held: Vec<i64> = state
		.deks
		.keys()
		.filter(|(s, _)| *s == identity)
		.map(|(_, v)| *v)
		.collect();
	log::warn!(
		target: "avenos::jazz",
		"KSDIAG decrypt-MISS: identity={identity} col={col} held_dek_versions={held:?}",
	);
	miss.push(col.into());
	JsonValue::Null
}

pub(super) fn row_to_public_map(
	state: &ShellState,
	table: &str,
	schema: &TableSchema,
	oid: ObjectId,
	vals: &[Value],
	meta_key: &str,
) -> Result<Map<String, JsonValue>, String> {
	let secrets = secret_manifest().get(table);
	let identity = identity_uuid_row(schema, vals).unwrap_or(state.default_identity);
	let mut miss = Vec::new();
	let cols = &schema.columns.columns;
	let mut m = Map::new();
	m.insert("id".into(), JsonValue::String(oid.uuid().to_string()));
	for (desc, cell) in cols.iter().zip(vals.iter()) {
		let name = desc.name_str();
		let jv = if let Some(set) = secrets {
			if set.contains(name) {
				let ipc_ty = crate::schema_manifest::expose_ts_for(table, name)
					.unwrap_or(&desc.column_type);
				match cell {
					Value::Text(s) => map_sensitive_storage_cell(
						state,
						name,
						ipc_ty,
						identity,
						s.as_str(),
						&mut miss,
					),
					Value::Bytea(b) => {
						let s = std::str::from_utf8(b.as_slice())
							.map_err(|_| format!("secret_col_bytea_utf8:{name}"))?;
						map_sensitive_storage_cell(
							state,
							name,
							ipc_ty,
							identity,
							s,
							&mut miss,
						)
					}
					Value::Null if desc.nullable => JsonValue::Null,
					_ => return Err(format!("secret_col_bad_storage:{name}:{cell:?}")),
				}
			} else {
				jazz_cell_json(cell)
			}
		} else {
			jazz_cell_json(cell)
		};
		m.insert(name.to_string(), jv);
	}
	if !miss.is_empty() {
		m.insert(meta_key.into(), json!(miss));
	}
	Ok(m)
}

pub(crate) async fn resolved_table_schema(client: &JazzClient, table: &str) -> Result<TableSchema, String> {
	let sch = client.schema().await.map_err(super::format_jazz_err)?;
	let tn = TableName::new(table);
	sch.get(&tn)
		.cloned()
		.ok_or_else(|| format!("unknown_table: {table}"))
}

/// Canonical Jazz read pattern — **no** `.branch()` override.
///
/// Per the Jazz docs ("Branches" → "Schema versions are merged automatically"):
/// reads auto-merge across **all known schema-version branches** in the current
/// env/userBranch; writes go to the current schema branch. Earlier AvenOS code
/// forced `.branch(groove_write_branch)`, which:
///   * silently scoped reads to a single branch (no lens activation),
///   * and only loaded `obj.branches[write_branch]` into `ObjectManager`, so
///     when the row's commits lived on any **other** loaded branch, the
///     subsequent `client.update`/`client.delete` saw the row in memory but
///     `add_commit` on `current_branch()` could not find the right tip and
///     returned a `BranchNotFound`/`ParentNotFound` that jazz-tools maps to
///     the misleading `QueryError::ObjectNotFound(id)`.
pub(crate) async fn exec_list_rows(
	client: &JazzClient,
	table: &str,
) -> Result<Vec<(ObjectId, Vec<Value>)>, String> {
	let q = QueryBuilder::new(TableName::new(table)).build();
	client.query(q, None).await.map_err(super::format_jazz_err)
}

/// Map Groove `(table, object_id)` → identity UUID for sync ACL on patch commits.
///
/// MUST include soft-deleted rows. This map is the resource→identity lookup the peer-sync
/// gate (`BiscuitCapabilityResolver::may_sync`) uses to authorize shipping a batch. A
/// soft-deleted object still belongs to its identity and its DELETE batch still needs to be
/// shipped to peers. Building the map from visible rows only (the default list excludes
/// `_id_deleted`) dropped deleted objects out of scope, so `may_sync` returned `Pending`
/// and the delete batch was withheld forever — that was the "deletes never sync across
/// devices, even after reconnect" bug. Soft-delete keeps the row's data, so `owner` is
/// still readable for a deleted row.
pub(super) async fn build_object_owner_map(
	client: &JazzClient,
) -> Result<HashMap<(String, ObjectId), Uuid>, String> {
	let mut out = HashMap::new();
	for table in crate::identity_sync::identity_scoped_table_names() {
		let schema = resolved_table_schema(client, table).await?;
		let identity_ix = col_ix(&schema, "owner")?;
		let q = QueryBuilder::new(TableName::new(table))
			.include_deleted()
			.build();
		let rows = client.query(q, None).await.map_err(super::format_jazz_err)?;
		for (oid, vals) in rows {
			if let Ok(sid) = uuid_cell_at(vals.as_slice(), identity_ix) {
				out.insert((table.clone(), oid), sid);
			}
		}
	}
	Ok(out)
}

/// Map keyshares `object_id` → `recipient_did`. Drives the recipient-scoped sync gate: a
/// keyshare (E2E-encrypted to one recipient) may always be forwarded to the peer it names,
/// so a grantee receives its DEK without depending on broad membership evaluation or the
/// ungated bootstrap. Includes soft-deleted rows so a revoked keyshare's tombstone still
/// reaches its (former) recipient. Built alongside [`build_object_owner_map`].
pub(super) async fn build_keyshare_recipient_map(
	client: &JazzClient,
) -> Result<HashMap<ObjectId, String>, String> {
	let mut out = HashMap::new();
	let schema = resolved_table_schema(client, "keyshares").await?;
	let recip_ix = col_ix(&schema, "recipient_did")?;
	let q = QueryBuilder::new(TableName::new("keyshares"))
		.include_deleted()
		.build();
	let rows = client.query(q, None).await.map_err(super::format_jazz_err)?;
	for (oid, vals) in rows {
		if let Some(Value::Text(did)) = vals.get(recip_ix) {
			out.insert(oid, did.clone());
		}
	}
	Ok(out)
}

pub(super) async fn query_table_publish(
	client: &JazzClient,
	state: &ShellState,
	table: &str,
	meta_key: &str,
) -> Result<(Vec<Map<String, JsonValue>>, usize), String> {
	let table_schema = resolved_table_schema(client, table).await?;
	let rows = exec_list_rows(client, table).await?;
	let mut out = Vec::with_capacity(rows.len());
	let mut skipped_unauthorized_rows = 0usize;
	for (oid, vals) in rows {
		let identity_row = identity_uuid_row(&table_schema, &vals).unwrap_or(state.default_identity);
		match authorize_gate(state, table, AccOp::Read, identity_row, Some(*oid.uuid())) {
			Ok(()) => {}
			Err(_) => {
				skipped_unauthorized_rows = skipped_unauthorized_rows.saturating_add(1);
				continue;
			}
		}
		out.push(row_to_public_map(
			state,
			table,
			&table_schema,
			oid,
			&vals,
			meta_key,
		)?);
	}
	Ok((out, skipped_unauthorized_rows))
}

/// Diagnostic-only re-derivation of the writable Groove branch from the connected client's
/// current schema. Failures are logged and converted to the literal "<unavailable>" rather than
/// propagated, so this is safe to call inside write IPC paths purely for log enrichment.
pub(super) async fn groove_write_branch_from_connected_schema_or_log(client: &JazzClient) -> String {
	match super::groove_write_branch_from_connected_schema(client).await {
		Ok(b) => b,
		Err(e) => {
			log::warn!(
				target: "avenos::jazz",
				"groove_write_branch_from_connected_schema failed (logging only): {e}"
			);
			"<unavailable>".to_string()
		}
	}
}

/// Look up `(ObjectId, values)` for a row across **all** known schema branches
/// (no `.branch()` override). Reading via the canonical multi-branch path also
/// populates `ObjectManager` with every branch the row lives on, which is what
/// `client.update` / `client.delete` need so `add_commit` can resolve tips on
/// `current_branch()` without spuriously returning `BranchNotFound` (surfaced
/// upstream as the misleading `ObjectNotFound`).
pub(super) async fn find_row_snapshot(
	client: &JazzClient,
	table: &str,
	_schema: &TableSchema,
	id: Uuid,
) -> Result<Option<(ObjectId, Vec<Value>)>, String> {
	for (oid, vals) in exec_list_rows(client, table).await? {
		if *oid.uuid() == id {
			return Ok(Some((oid, vals)));
		}
	}
	Ok(None)
}

/// System-extracted device name for the local peer's `device_label`. Device
/// membership is governed by biscuit caps + the `peers` roster now (no `my_devices`
/// allowlist), so each device just self-publishes its OS name into the roster.
pub(super) fn system_device_name() -> String {
	let base = std::process::Command::new("scutil")
		.args(["--get", "ComputerName"])
		.output()
		.ok()
		.and_then(|o| String::from_utf8(o.stdout).ok())
		.map(|s| s.trim().to_string())
		.filter(|s| !s.is_empty())
		.unwrap_or_else(|| "This Device".to_string());
	// Dev A/B harness disambiguation (see host_device_label_inner). Empty in prod.
	let suffix = std::env::var("AVEN_PEER_SUFFIX").unwrap_or_default();
	format!("{base}{suffix}")
}

pub(super) async fn hydrate_shell(
	client: &JazzClient,
	root: &[u8; 32],
	vault_files: &Path,
) -> Result<ShellState, String> {
	let mut vault = identity_acc::build_vault_from_root(root)?;
	let signing_key = jazz_auth::signing_key_from_device_root(root)?;
	let biscuit_root_pub = vault.biscuit_kp.public();

	let groove_write_branch =
		super::groove_write_branch_from_connected_schema(client).await?;
	if let Ok(manifest_branch) = super::groove_write_branch_for_manifest_schema() {
		if manifest_branch != groove_write_branch {
			log::warn!(
				target: "avenos::jazz",
				"Groove writable branch from connected schema differs from raw-manifest branch (writes use runtime): manifest_branch={manifest_branch} runtime_branch={groove_write_branch}"
			);
		}
	}

	let sparks_schema = resolved_table_schema(client, "identities").await?;
	let identity_id_ix = col_ix(&sparks_schema, "owner")?;
	let issuer_ix = col_ix(&sparks_schema, "issuer_pubkey_b64")?;
	let genesis_ix = col_ix(&sparks_schema, "genesis_b64")?;
	let ver_ix = col_ix(&sparks_schema, "current_dek_version")?;

	let mut identity_versions = HashMap::new();
	let sparks_rows = exec_list_rows(client, "identities").await?;
	let ver_storage_ty = sparks_schema
		.columns
		.columns
		.get(ver_ix)
		.map(|d| d.column_type.clone())
		.ok_or("sparks_ver_col")?;

	let manifest_opt: Option<VaultManifest> = std::fs::read_to_string(
		paths::manifest_path(vault_files),
	)
	.ok()
	.and_then(|raw| serde_json::from_str(&raw).ok());

	let mut deks: HashMap<(Uuid, i64), Dek> = HashMap::new();

	if !sparks_rows.is_empty() {
		let ks_schema = resolved_table_schema(client, "keyshares").await?;
		let ks_spark_ix = col_ix(&ks_schema, "owner")?;
		let ks_ver_ix = col_ix(&ks_schema, "dek_version")?;
		let ks_recip_ix = col_ix(&ks_schema, "recipient_did")?;
		let ks_wrapper_ix = col_ix(&ks_schema, "wrapper_did")?;
		let ks_wrap_ix = col_ix(&ks_schema, "wrapped_dek")?;

		// DIAG: the member-decrypt bug lives here or upstream. Log the whole keyshare
		// picture so one repro pinpoints it: total rows synced in, which are addressed to
		// THIS device, which unwrap, and the final DEK set. (target avenos::jazz, INFO.)
		let all_keyshares = exec_list_rows(client, "keyshares").await?;
		let mut ks_for_me = 0usize;
		log::info!(
			target: "avenos::jazz",
			"KSDIAG hydrate: {} keyshare row(s) in store; me={}",
			all_keyshares.len(), vault.peer_did,
		);
		for (_oid, vals) in all_keyshares {
			let sid = uuid_cell_at(vals.as_slice(), ks_spark_ix)?;
			let dv = bigint_i64(vals.get(ks_ver_ix).ok_or("ks_missing_ver")?)?;
			if deks.contains_key(&(sid, dv)) {
				continue;
			}
			let recipient = match vals.get(ks_recip_ix).ok_or("ks_missing_recip")? {
				Value::Text(s) => s.as_str(),
				_ => return Err("ks_recip_bad".into()),
			};
			if recipient != vault.peer_did {
				log::debug!(
					target: "avenos::jazz",
					"KSDIAG not-for-me: identity={sid} v={dv} recipient={recipient}",
				);
				continue;
			}
			ks_for_me += 1;
			let wrapper_did = match vals.get(ks_wrapper_ix).ok_or("ks_missing_wrapper")? {
				Value::Text(s) if !s.trim().is_empty() => s.trim(),
				_ => {
					log::debug!(
						target: "avenos::jazz",
						"skip keyshare missing wrapper_did: owner={sid}",
					);
					continue;
				}
			};
			let wrapped = match vals.get(ks_wrap_ix).ok_or("ks_missing_wrap")? {
				Value::Text(s) => s.as_str(),
				_ => return Err("ks_wrap_bad".into()),
			};
			let urn = identity_urn(sid);
			let wrapper_pk = jazz_auth::ed25519_public_from_peer_did(wrapper_did)?;
			let kek = derive_kek_x25519(&signing_key, &wrapper_pk)?;
			let aad = keyshare_wrap_aad(&urn, recipient, wrapper_did, dv);
			match decrypt_keyshare_payload(wrapped, &kek, &aad) {
				Ok(raw32) => {
					log::info!(
						target: "avenos::jazz",
						"KSDIAG unlocked DEK: identity={sid} v={dv} wrapper={wrapper_did}",
					);
					deks.insert((sid, dv), Dek::from_plain_32(raw32));
				}
				Err(e) => {
					log::warn!(
						target: "avenos::jazz",
						"KSDIAG unwrap_FAIL: identity={sid} v={dv} wrapper={wrapper_did}: {e}",
					);
				}
			}
		}
		log::info!(
			target: "avenos::jazz",
			"KSDIAG done: {ks_for_me} keyshare(s) addressed to me → {} DEK(s) unlocked",
			deks.len(),
		);

		for (_oid, vals) in &sparks_rows {
			let sid = match uuid_cell_at(vals.as_slice(), identity_id_ix) {
				Ok(s) => s,
				Err(e) => {
					log::warn!(target: "avenos::jazz", "hydrate_shell: skip identity row (owner): {e}");
					continue;
				}
			};
			let genesis_cell = match vals.get(genesis_ix) {
				Some(c) => c,
				None => {
					log::warn!(target: "avenos::jazz", "hydrate_shell: skip identity {sid} (missing genesis)");
					continue;
				}
			};
			let genesis_b64 = match hydrate_text_at(&deks, sid, genesis_cell) {
				Ok(g) => g,
				Err(e) => {
					log::warn!(
						target: "avenos::jazz",
						"hydrate_shell: skip identity {sid} (genesis open): {e}",
					);
					continue;
				}
			};
			let issuer_opened = match vals.get(issuer_ix) {
				Some(cell) => match hydrate_text_at(&deks, sid, cell) {
					Ok(s) => Some(s),
					Err(e) => {
						log::debug!(
							target: "avenos::jazz",
							"hydrate_shell: identity {sid} issuer open failed, using local biscuit root: {e}",
						);
						None
					}
				},
				None => None,
			};
			if let Err(e) = identity_acc::ingest_genesis_opened(
				&mut vault,
				sid,
				&genesis_b64,
				issuer_opened.as_deref(),
				biscuit_root_pub,
			) {
				log::warn!(
					target: "avenos::jazz",
					"hydrate_shell: skip identity {sid} (biscuit ingest): {e}",
				);
				continue;
			}
			let ver_cell = match vals.get(ver_ix) {
				Some(c) => c,
				None => {
					log::warn!(
						target: "avenos::jazz",
						"hydrate_shell: skip identity {sid} (missing current_dek_version)",
					);
					continue;
				}
			};
			let v = match hydrate_i64_at(&deks, sid, ver_cell, &ver_storage_ty) {
				Ok(v) => v,
				Err(e) => {
					log::warn!(
						target: "avenos::jazz",
						"hydrate_shell: skip identity {sid} (dek version): {e}",
					);
					continue;
				}
			};
			identity_versions.insert(sid, v);
		}
	} else {
		// No bootstrap identity: the app works with zero identities. The user creates
		// one (+ New) or is added via caps after the network invite; avenCEO is minted
		// on the aven-node, never defaulted on a device. We only ensure this device
		// has its own local `peers` row (presence + auto device label), idempotently —
		// this branch re-runs every hydrate until the first identity exists.
		let peers_schema_seed = resolved_table_schema(client, "peers").await?;
		let did_ix = col_ix(&peers_schema_seed, "peer_did")?;
		let existing_peers = exec_list_rows(client, "peers").await.unwrap_or_default();
		let has_local = existing_peers
			.iter()
			.any(|(_o, vals)| matches!(vals.get(did_ix), Some(Value::Text(s)) if s == &vault.peer_did));
		if !has_local {
			let device_label = manifest_opt
				.as_ref()
				.map(|m| m.device_label.trim().to_string())
				.filter(|s| !s.is_empty())
				.unwrap_or_else(system_device_name);
			let peer_vals = super::insert_values(
				"peers",
				&peers_schema_seed,
				vec![
					("peer_did".into(), JsonValue::String(vault.peer_did.clone())),
					("device_label".into(), JsonValue::String(device_label)),
					("kind".into(), JsonValue::String("local".into())),
					("added_at_ms".into(), JsonValue::Number(now_unix_ms_i64().into())),
					("status".into(), JsonValue::String("active".into())),
				]
				.into_iter()
				.collect(),
			)?;
			client
				.create("peers", peer_vals)
				.await
				.map_err(super::format_jazz_err)?;
		}
	}

	let mut identity_keys: Vec<Uuid> = vault.identities.keys().cloned().collect();
	identity_keys.sort();
	// Zero identities is valid: the user creates one (+ New) or is added via caps after
	// the invite. `default_identity` is a nil sentinel until then (no fallback owner).
	let default_identity = identity_keys.first().copied().unwrap_or_else(Uuid::nil);

	log::debug!(
		target: "avenos::jazz",
		"hydrate_shell ready groove_write_branch={groove_write_branch} default_identity={default_identity}"
	);

	Ok(ShellState {
		peer_did: vault.peer_did.clone(),
		vault,
		signing_key,
		default_identity,
		deks,
		identity_versions,
		groove_write_branch,
	})
}

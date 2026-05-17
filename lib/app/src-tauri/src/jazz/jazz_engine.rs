//! Shell: vault, DEKs, sealed text columns (submodule of `jazz`).

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use groove::{
	query_manager::types::{ColumnType, TableName, TableSchema},
	JazzClient,
	ObjectId,
	QueryBuilder,
	Value,
};
use serde_json::{json, Map, Value as JsonValue};
use uuid::Uuid;

use crate::{
	crypto::{
		cell_seal_aad, column_type_slug, groove_value_to_canonical_utf8, ipc_json_from_opened_sensitive_plaintext,
		decrypt_keyshare_payload, derive_kek_x25519, encrypt_keyshare_payload, open_text_cell_payload,
		keyshare_wrap_aad, random_spark_dek, seal_text_cell_payload, Dek, CELL_ENVELOPE_V1,
	},
	jazz_auth,
	schema_manifest,
	spark_acc::{self, AccOp},
};

pub(crate) struct ShellState {
	pub(crate) peer_did: String,
	pub(crate) vault: spark_acc::BiscuitVault,
	#[allow(dead_code)]
	pub(crate) signing_key: ed25519_dalek::SigningKey,
	pub(crate) default_spark: Uuid,
	pub(crate) deks: HashMap<(Uuid, i64), Dek>,
	pub(crate) spark_versions: HashMap<Uuid, i64>,
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
		Value::Row(items) => JsonValue::Array(items.iter().map(jazz_cell_json).collect()),
	}
}

pub(crate) fn secrets_for_table(table: &str) -> Option<&'static HashSet<String>> {
	secret_manifest().get(table)
}

fn secret_manifest() -> &'static HashMap<String, HashSet<String>> {
	static M: OnceLock<HashMap<String, HashSet<String>>> = OnceLock::new();
	M.get_or_init(|| {
		schema_manifest::manifest_secret_columns().expect("jazz-schema manifest secret columns")
	})
}

pub(super) fn col_ix(tbl: &TableSchema, name: &str) -> Result<usize, String> {
	tbl.descriptor
		.columns
		.iter()
		.position(|c| c.name_str() == name)
		.ok_or_else(|| format!("manifest_missing_col:{name}"))
}

fn uuid_cell_at(vals: &[Value], ix: usize) -> Result<Uuid, String> {
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

pub(super) fn spark_uuid_row(schema: &TableSchema, vals: &[Value]) -> Result<Uuid, String> {
	let ix = col_ix(schema, "spark_id")?;
	uuid_cell_at(vals, ix)
}

pub(super) fn authorize_gate(
	state: &ShellState,
	table: &str,
	op: AccOp,
	spark_id: Uuid,
	row_uuid: Option<Uuid>,
) -> Result<(), String> {
	spark_acc::authorize(&state.vault, spark_id, op, table, row_uuid, &state.peer_did)
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

pub(super) fn spark_urn(id: Uuid) -> String {
	format!("spark:{id}")
}

pub(super) fn spark_uuid_from_json_row(
	tbl: &TableSchema,
	row: &Map<String, JsonValue>,
) -> Result<Uuid, String> {
	let ix = col_ix(tbl, "spark_id")?;
	let desc = tbl.descriptor.columns.get(ix).ok_or("spark_desc_ix")?;
	let raw = row
		.get("spark_id")
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
	for desc in tbl.descriptor.columns.iter() {
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
				let gv =
					super::loose_json_to_sealable_value(raw, &desc.column_type, desc.nullable)?;
				let canon = groove_value_to_canonical_utf8(&gv)?;
				plaintext_out.insert(key.to_string(), canon);
				*raw = JsonValue::String(phase1.into());
			}
		}
	}
	Ok(())
}

pub(super) fn inject_default_spark(
	values: &mut Map<String, JsonValue>,
	tbl: &TableSchema,
	default: Uuid,
) -> Result<(), String> {
	if col_ix(tbl, "spark_id").is_err() {
		return Ok(());
	}
	if values.contains_key("spark_id") {
		return Ok(());
	}
	values.insert(
		"spark_id".into(),
		JsonValue::String(default.to_string()),
	);
	Ok(())
}

fn current_dek_version(state: &ShellState, spark: Uuid) -> Result<i64, String> {
	state
		.spark_versions
		.get(&spark)
		.cloned()
		.ok_or_else(|| format!("unknown_spark_version:{spark}"))
}

pub(super) fn seal_column_plain(
	state: &ShellState,
	table: &str,
	col_name: &str,
	storage_ty: &ColumnType,
	spark: Uuid,
	row: Uuid,
	canonical_plaintext_utf8: &str,
) -> Result<String, String> {
	let v = current_dek_version(state, spark)?;
	let dek_entry = state
		.deks
		.get(&(spark, v))
		.ok_or_else(|| format!("missing_dek_cached:{spark}|{v}"))?;
	let urn = spark_urn(spark);
	let slug = column_type_slug(storage_ty);
	let aad = cell_seal_aad(&urn, table, col_name, row, v, slug);
	seal_text_cell_payload(dek_entry.expose(), &aad, canonical_plaintext_utf8)
}

fn map_sensitive_storage_cell(
	state: &ShellState,
	col: &str,
	storage_ty: &ColumnType,
	spark: Uuid,
	raw: &str,
	miss: &mut Vec<String>,
) -> JsonValue {
	if !raw.starts_with(CELL_ENVELOPE_V1) {
		return ipc_json_from_opened_sensitive_plaintext(raw, storage_ty)
			.unwrap_or_else(|_| JsonValue::String(raw.into()));
	}
	for ((sp, _dv), dek) in &state.deks {
		if *sp != spark {
			continue;
		}
		if let Ok((opened, _ver)) = open_text_cell_payload(dek.expose(), raw) {
			return ipc_json_from_opened_sensitive_plaintext(&opened, storage_ty).unwrap_or_else(|_| {
				JsonValue::String(opened.into())
			});
		}
	}
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
	let spark = spark_uuid_row(schema, vals).unwrap_or(state.default_spark);
	let mut miss = Vec::new();
	let cols = &schema.descriptor.columns;
	let mut m = Map::new();
	m.insert("id".into(), JsonValue::String(oid.uuid().to_string()));
	for (desc, cell) in cols.iter().zip(vals.iter()) {
		let name = desc.name_str();
		let jv = if let Some(set) = secrets {
			if set.contains(name) {
				match cell {
					Value::Text(s) => map_sensitive_storage_cell(
						state,
						name,
						&desc.column_type,
						spark,
						s.as_str(),
						&mut miss,
					),
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

pub(super) async fn resolved_table_schema(client: &JazzClient, table: &str) -> Result<TableSchema, String> {
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
pub(super) async fn exec_list_rows(
	client: &JazzClient,
	table: &str,
) -> Result<Vec<(ObjectId, Vec<Value>)>, String> {
	let q = QueryBuilder::new(TableName::new(table)).build();
	client.query(q, None).await.map_err(super::format_jazz_err)
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
		let spark_row = spark_uuid_row(&table_schema, &vals).unwrap_or(state.default_spark);
		match authorize_gate(state, table, AccOp::Read, spark_row, Some(*oid.uuid())) {
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

pub(super) async fn hydrate_shell(client: &JazzClient, root: &[u8; 32]) -> Result<ShellState, String> {
	let mut vault = spark_acc::build_vault_from_root(root)?;
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

	let sparks_schema = resolved_table_schema(client, "sparks").await?;
	let spark_id_ix = col_ix(&sparks_schema, "spark_id")?;
	let genesis_ix = col_ix(&sparks_schema, "genesis_b64")?;
	let ver_ix = col_ix(&sparks_schema, "current_dek_version")?;

	let mut spark_versions = HashMap::new();
	let sparks_rows = exec_list_rows(client, "sparks").await?;

	for (_oid, vals) in &sparks_rows {
		spark_acc::ingest_genesis_row(
			&mut vault,
			spark_id_ix,
			genesis_ix,
			vals.as_slice(),
			biscuit_root_pub,
		)?;
		let sid = uuid_cell_at(vals.as_slice(), spark_id_ix)?;
		let v = bigint_i64(vals.get(ver_ix).ok_or("sparks_missing_version")?)?;
		spark_versions.insert(sid, v);
	}

	let mut deks: HashMap<(Uuid, i64), Dek> = HashMap::new();

	if !sparks_rows.is_empty() {
		let ks_schema = resolved_table_schema(client, "keyshares").await?;
		let ks_spark_ix = col_ix(&ks_schema, "spark_id")?;
		let ks_ver_ix = col_ix(&ks_schema, "dek_version")?;
		let ks_recip_ix = col_ix(&ks_schema, "recipient_did")?;
		let ks_wrap_ix = col_ix(&ks_schema, "wrapped_dek")?;

		for (_oid, vals) in exec_list_rows(client, "keyshares").await? {
			let sid = uuid_cell_at(vals.as_slice(), ks_spark_ix)?;
			let dv = bigint_i64(vals.get(ks_ver_ix).ok_or("ks_missing_ver")?)?;
			let recipient = match vals.get(ks_recip_ix).ok_or("ks_missing_recip")? {
				Value::Text(s) => s.as_str(),
				_ => return Err("ks_recip_bad".into()),
			};
			if recipient != vault.peer_did {
				continue;
			}
			let wrapped = match vals.get(ks_wrap_ix).ok_or("ks_missing_wrap")? {
				Value::Text(s) => s.as_str(),
				_ => return Err("ks_wrap_bad".into()),
			};
			let urn = spark_urn(sid);
			let kek = derive_kek_x25519(&signing_key, &vault.ed25519_public)?;
			let aad = keyshare_wrap_aad(&urn, recipient, dv);
			let raw32 = decrypt_keyshare_payload(wrapped, &kek, &aad)?;
			deks.insert((sid, dv), Dek::from_plain_32(raw32));
		}
	} else {
		let spark_id = Uuid::new_v4();
		let biscuit_gen = spark_acc::mint_genesis_spark(&vault, spark_id)?;
		let genesis_b64 = URL_SAFE_NO_PAD.encode(
			biscuit_gen
				.to_vec()
				.map_err(|e| format!("genesis_encode:{e:?}"))?,
		);

		let mut row = Map::new();
		row.insert(
			"spark_id".into(),
			JsonValue::String(spark_id.to_string()),
		);
		row.insert("name".into(), JsonValue::String("My spark".into()));
		row.insert("genesis_b64".into(), JsonValue::String(genesis_b64));
		row.insert(
			"current_dek_version".into(),
			JsonValue::Number(1.into()),
		);
		row.insert(
			"created_at_ms".into(),
			JsonValue::Number(now_unix_ms_i64().into()),
		);
		let sparks_vals = super::insert_values(&sparks_schema, row)?;
		client
				.create("sparks", sparks_vals)
				.await
				.map_err(super::format_jazz_err)?;

		vault.sparks.insert(
			spark_id,
			spark_acc::BiscuitSpark {
				spark_id,
				biscuit: biscuit_gen.clone(),
			},
		);

		let dek_ver = 1i64;
		spark_versions.insert(spark_id, dek_ver);

		let urn = spark_urn(spark_id);
		let kek = derive_kek_x25519(&signing_key, &vault.ed25519_public)?;
		let aad_enc = keyshare_wrap_aad(&urn, &vault.peer_did, dek_ver);
		let dek_plain = random_spark_dek();
		let wrapped =
			encrypt_keyshare_payload(&kek, dek_plain.expose(), &aad_enc)?;

		let mut ks = Map::new();
		ks.insert("spark_id".into(), JsonValue::String(spark_id.to_string()));
		ks.insert("dek_version".into(), JsonValue::Number(dek_ver.into()));
		ks.insert(
			"recipient_did".into(),
			JsonValue::String(vault.peer_did.clone()),
		);
		ks.insert("wrapped_dek".into(), JsonValue::String(wrapped));
		let ks_schema = resolved_table_schema(client, "keyshares").await?;
		let ks_vals = super::insert_values(&ks_schema, ks)?;
		client
				.create("keyshares", ks_vals)
				.await
				.map_err(super::format_jazz_err)?;

		deks.insert((spark_id, dek_ver), dek_plain);
	}

	let mut spark_keys: Vec<Uuid> = vault.sparks.keys().cloned().collect();
	spark_keys.sort();
	let default_spark =
		spark_keys
			.first()
			.copied()
			.ok_or_else(|| "shell_no_sparks".to_string())?;

	log::info!(
		target: "avenos::jazz",
		"hydrate_shell ready groove_write_branch={groove_write_branch} default_spark={default_spark}"
	);

	Ok(ShellState {
		peer_did: vault.peer_did.clone(),
		vault,
		signing_key,
		default_spark,
		deks,
		spark_versions,
		groove_write_branch,
	})
}

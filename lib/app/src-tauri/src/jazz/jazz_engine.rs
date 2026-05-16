//! Shell: vault, DEKs, sealed text columns (submodule of `jazz`).

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use groove::{
	query_manager::types::{TableName, TableSchema},
	JazzClient,
	ObjectId,
	QueryBuilder,
	Value,
};
use serde_json::{json, Map, Value as JsonValue};
use uuid::Uuid;

use crate::{
	crypto::{
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

pub(super) fn acc_skip_table(table: &str) -> bool {
	matches!(table, "sparks" | "keyshares")
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
	if acc_skip_table(table) {
		return Ok(());
	}
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
	for col in secrets {
		let Some(desc) = tbl.descriptor.column(col) else {
			continue;
		};
		let Some(raw) = values.get(col) else {
			if desc.nullable {
				continue;
			}
			return Err(format!("missing_secret_column:{col}"));
		};
		if raw.is_null() {
			if !desc.nullable {
				return Err(format!("null_secret_disallowed:{col}"));
			}
			continue;
		}
		let s = raw
			.as_str()
			.ok_or_else(|| format!("secret_not_string:{col}"))?
			.to_string();
		plaintext_out.insert(col.clone(), s);
		values.insert(col.clone(), JsonValue::String(phase1.into()));
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
	spark: Uuid,
	row: Uuid,
	plaintext: &str,
) -> Result<String, String> {
	let v = current_dek_version(state, spark)?;
	let dek_entry = state
		.deks
		.get(&(spark, v))
		.ok_or_else(|| format!("missing_dek_cached:{spark}|{v}"))?;
	let urn = spark_urn(spark);
	let aad = format!("{urn}|{table}|{col_name}|{row}|{v}").into_bytes();
	seal_text_cell_payload(dek_entry.expose(), &aad, plaintext)
}

fn map_secret_text_cell(
	state: &ShellState,
	_table: &str,
	col: &str,
	spark: Uuid,
	_row: Uuid,
	raw: &str,
	miss: &mut Vec<String>,
) -> JsonValue {
	if !raw.starts_with(CELL_ENVELOPE_V1) {
		return JsonValue::String(raw.into());
	}
	for ((sp, _dv), dek) in &state.deks {
		if *sp != spark {
			continue;
		}
		if let Ok((s, _ver)) = open_text_cell_payload(dek.expose(), raw) {
			return JsonValue::String(s);
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
				let t = match cell {
					Value::Text(s) => s.as_str(),
					Value::Null => "",
					_ => return Err(format!("secret_col_bad_storage:{name}")),
				};
				map_secret_text_cell(state, table, name, spark, *oid.uuid(), t, &mut miss)
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
	let sch = client.schema().await.map_err(|e| format!("schema: {e}"))?;
	let tn = TableName::new(table);
	sch.get(&tn)
		.cloned()
		.ok_or_else(|| format!("unknown_table: {table}"))
}

pub(super) async fn exec_list_rows(
	client: &JazzClient,
	table: &str,
) -> Result<Vec<(ObjectId, Vec<Value>)>, String> {
	let q = QueryBuilder::new(TableName::new(table)).build();
	client.query(q, None).await.map_err(|e| format!("{e}"))
}

pub(super) async fn query_table_publish(
	client: &JazzClient,
	state: &ShellState,
	table: &str,
	meta_key: &str,
) -> Result<Vec<Map<String, JsonValue>>, String> {
	let table_schema = resolved_table_schema(client, table).await?;
	let rows = exec_list_rows(client, table).await?;
	let mut out = Vec::with_capacity(rows.len());
	for (oid, vals) in rows {
		let spark_row = spark_uuid_row(&table_schema, &vals).unwrap_or(state.default_spark);
		if !acc_skip_table(table) {
			authorize_gate(state, table, AccOp::Read, spark_row, Some(*oid.uuid()))?;
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
	Ok(out)
}

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
			.map_err(|e| format!("{e}"))?;

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
			.map_err(|e| format!("{e}"))?;

		deks.insert((spark_id, dek_ver), dek_plain);
	}

	let mut spark_keys: Vec<Uuid> = vault.sparks.keys().cloned().collect();
	spark_keys.sort();
	let default_spark =
		spark_keys
			.first()
			.copied()
			.ok_or_else(|| "shell_no_sparks".to_string())?;

	Ok(ShellState {
		peer_did: vault.peer_did.clone(),
		vault,
		signing_key,
		default_spark,
		deks,
		spark_versions,
	})
}

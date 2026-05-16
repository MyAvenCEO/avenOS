//! Generic Jazz CRUD over Tauri IPC. Schema mirrors `libs/jazz-schema/schema.manifest.json`.

use std::collections::HashMap;
use std::sync::RwLock;

use groove::{
	query_manager::types::{ColumnType, TableName, TableSchema},
	AppContext,
	AppId,
	ClientId,
	JazzClient,
	ObjectId,
	QueryBuilder,
	Value,
};
use serde_json::{Map, Value as JsonValue};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};
use tauri_plugin_self::derive::ed25519_public;
use tauri_plugin_self::state::SelfState;
use tokio::sync::{broadcast, Mutex};
use uuid::Uuid;

pub type JsonRow = Map<String, JsonValue>;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JazzStatusReply {
	pub ready: bool,
	pub tables: Vec<String>,
}

#[derive(Default)]
pub struct ManagedJazz {
	client: Mutex<Option<std::sync::Arc<JazzClient>>>,
	table_txs: RwLock<HashMap<String, broadcast::Sender<Vec<JsonRow>>>>,
}

impl ManagedJazz {
	fn broadcaster(&self, table: &str) -> broadcast::Sender<Vec<JsonRow>> {
		let mut w = self.table_txs.write().expect("table_txs poisoned");
		if let Some(tx) = w.get(table).cloned() {
			return tx;
		}
		let (tx, _rx) = broadcast::channel(64);
		w.insert(table.to_string(), tx.clone());
		tx
	}

	pub async fn snapshot_broadcast(&self, client: &JazzClient, table: &str) -> Result<(), String> {
		let snap = query_table_maps(client, table).await?;
		let r = self.table_txs.read().expect("table_txs poisoned");
		if let Some(tx) = r.get(table) {
			if tx.receiver_count() > 0 {
				let _ = tx.send(snap);
			}
		}
		Ok(())
	}
}

async fn resolved_table_schema(client: &JazzClient, table: &str) -> Result<TableSchema, String> {
	let sch = client.schema().await.map_err(|e| format!("schema: {e}"))?;
	let tn = TableName::new(table);
	sch.get(&tn)
		.cloned()
		.ok_or_else(|| format!("unknown_table: {table}"))
}

fn jazz_cell_to_json(cell: &Value) -> JsonValue {
	match cell {
		Value::Integer(i) => JsonValue::Number((*i).into()),
		Value::BigInt(i) => JsonValue::Number((*i).into()),
		Value::Boolean(b) => JsonValue::Bool(*b),
		Value::Text(s) => JsonValue::String(s.clone()),
		Value::Timestamp(ts) => JsonValue::Number((*ts).into()),
		Value::Uuid(oid) => JsonValue::String(oid.uuid().to_string()),
		Value::Null => JsonValue::Null,
		Value::Array(items) => JsonValue::Array(items.iter().map(jazz_cell_to_json).collect()),
		Value::Row(items) => JsonValue::Array(items.iter().map(jazz_cell_to_json).collect()),
	}
}

fn row_to_map(table_schema: &TableSchema, oid: ObjectId, vals: &[Value]) -> Result<JsonRow, String> {
	let cols = &table_schema.descriptor.columns;
	if vals.len() != cols.len() {
		return Err(format!(
			"row len {} ≠ schema {}",
			vals.len(),
			cols.len(),
		));
	}
	let mut m = JsonRow::new();
	m.insert("id".into(), JsonValue::String(oid.uuid().to_string()));
	for (desc, cell) in cols.iter().zip(vals.iter()) {
		m.insert(desc.name_str().to_string(), jazz_cell_to_json(cell));
	}
	Ok(m)
}

fn json_cell_to_jazz(cell: &JsonValue, col_ty: &ColumnType, nullable: bool) -> Result<Value, String> {
	if cell.is_null() || *cell == JsonValue::Null {
		return nullable
			.then(|| Value::Null)
			.ok_or_else(|| "null not permitted".into());
	}
	match col_ty {
		ColumnType::Text => cell
			.as_str()
			.map(|s| Value::Text(s.to_string()))
			.ok_or_else(|| "expected JSON string column".into()),
		ColumnType::Boolean => cell
			.as_bool()
			.map(Value::Boolean)
			.ok_or_else(|| "expected JSON boolean column".into()),
		ColumnType::Integer => cell
			.as_i64()
			.and_then(|n| i32::try_from(n).ok())
			.map(Value::Integer)
			.ok_or_else(|| "expected JSON i32-compatible integer column".into()),
		ColumnType::BigInt => cell
			.as_i64()
			.map(Value::BigInt)
			.ok_or_else(|| "expected JSON i64-compatible integer column".into()),
		ColumnType::Timestamp => cell
			.as_u64()
			.map(Value::Timestamp)
			.ok_or_else(|| "expected JSON u64 timestamp column".into()),
		ColumnType::Uuid => cell
			.as_str()
			.and_then(|s| Uuid::parse_str(s).ok())
			.map(|u| Value::Uuid(ObjectId::from_uuid(u)))
			.ok_or_else(|| "expected UUID string column".into()),
		ColumnType::Array(_) | ColumnType::Row(_) => Err(format!(
			"nested {:?} unsupported through JSON IPC for now",
			col_ty,
		)),
	}
}

async fn exec_list_rows(client: &JazzClient, table: &str) -> Result<Vec<(ObjectId, Vec<Value>)>, String> {
	// Leave `Query.branches` empty so Jazz expands to `schema_context.all_branch_names()`
	// (composed branches like `client#…`). A literal `.branch("main")` misses rows written by the client.
	let q = QueryBuilder::new(TableName::new(table)).build();

	client.query(q, None).await.map_err(|e| format!("{e}"))
}

async fn query_table_maps(client: &JazzClient, table: &str) -> Result<Vec<JsonRow>, String> {
	let table_schema = resolved_table_schema(client, table).await?;
	let rows = exec_list_rows(client, table).await?;
	let mut out = Vec::with_capacity(rows.len());
	for (oid, vals) in rows {
		out.push(row_to_map(&table_schema, oid, &vals)?);
	}
	Ok(out)
}

fn insert_values(table_schema: &TableSchema, values: JsonRow) -> Result<Vec<Value>, String> {
	let cols = &table_schema.descriptor.columns;
	let mut row = Vec::with_capacity(cols.len());
	for cd in cols {
		let key = cd.name_str();
		let cv = values.get(key);
		let val = match cv {
			None if cd.nullable => Value::Null,
			None => return Err(format!("missing column `{key}`")),
			Some(js) => json_cell_to_jazz(js, &cd.column_type, cd.nullable)?,
		};
		row.push(val);
	}
	Ok(row)
}

fn patch_updates(table_schema: &TableSchema, patch: JsonRow) -> Result<Vec<(String, Value)>, String> {
	let mut ops = Vec::new();
	let desc = &table_schema.descriptor;

	for (k, raw_js) in &patch {
		if k == "id" {
			continue;
		}
		let col = desc.column(k).ok_or_else(|| format!("unknown_column: {k}"))?;
		let v = json_cell_to_jazz(raw_js, &col.column_type, col.nullable)?;
		ops.push((k.clone(), v));
	}
	if ops.is_empty() {
		return Err("empty patch".into());
	}
	Ok(ops)
}

async fn jazz_connect(
	app: &tauri::AppHandle,
	self_state: &SelfState,
) -> Result<JazzClient, String> {
	let root = self_state
		.with_root(|r| Ok(*r))
		.map_err(|_| "locked: unlock AvenOS identity first".to_string())?;

	let schema = crate::schema_manifest::load_jazz_schema_from_manifest()?;
	let pk = ed25519_public(&root)?;

	let mut digest = Sha256::new();
	digest.update(b"ceo.aven.os/jazz/client-id-v1");
	digest.update(pk.as_slice());
	let hash16: [u8; 16] = digest.finalize()[..16]
		.try_into()
		.map_err(|_| "truncate hash failed")?;

	let deterministic = Uuid::from_bytes(hash16);

	let ctx = AppContext {
		app_id: AppId::from_name("ceo.aven.os"),
		client_id: Some(ClientId(deterministic)),
		schema,
		server_url: String::new(),
		data_dir: app
			.path()
			.app_data_dir()
			.map_err(|e| e.to_string())?
			.join("jazz"),
		jwt_token: None,
		backend_secret: None,
		admin_secret: None,
	};

	JazzClient::connect(ctx)
		.await
		.map_err(|e| format!("{e}"))
}

async fn ensure_arc(
	app: &tauri::AppHandle,
	self_state: &SelfState,
	mj: &ManagedJazz,
) -> Result<std::sync::Arc<JazzClient>, String> {
	let mut g = mj.client.lock().await;
	if let Some(existing) = g.as_ref() {
		return Ok(std::sync::Arc::clone(existing));
	}
	let client = jazz_connect(app, self_state).await?;
	let arc = std::sync::Arc::new(client);
	*g = Some(std::sync::Arc::clone(&arc));
	Ok(arc)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_status(
	_app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	_self_state: tauri::State<'_, SelfState>,
) -> Result<JazzStatusReply, String> {
	let arc_opt = jazz.client.lock().await.clone();

	if let Some(c) = arc_opt {
		let sch = c.schema().await.map_err(|e| format!("{e}"))?;
		let mut names: Vec<String> = sch.keys().map(|k| k.to_string()).collect();
		names.sort();
		return Ok(JazzStatusReply {
			ready: true,
			tables: names,
		});
	}

	Ok(JazzStatusReply {
		ready: false,
		tables: vec![],
	})
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_bootstrap(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
) -> Result<JazzStatusReply, String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;

	let sch = c.schema().await.map_err(|e| format!("{e}"))?;
	let mut tables: Vec<String> = sch.keys().map(|k| k.to_string()).collect();
	tables.sort();
	Ok(JazzStatusReply {
		ready: true,
		tables,
	})
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_list(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	table: String,
) -> Result<Vec<JsonRow>, String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;
	query_table_maps(std::sync::Arc::as_ref(&c), &table).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_get(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	table: String,
	id: String,
) -> Result<JsonRow, String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;
	let uuid = Uuid::parse_str(&id).map_err(|e| format!("invalid id UUID: {e}"))?;

	for row in query_table_maps(std::sync::Arc::as_ref(&c), &table).await? {
		let rid = row
			.get("id")
			.and_then(|v| v.as_str())
			.and_then(|s| Uuid::parse_str(s).ok());
		if rid == Some(uuid) {
			return Ok(row);
		}
	}
	Err(format!("row not found table={table} id={uuid}"))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_create(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	table: String,
	values: JsonRow,
) -> Result<JsonRow, String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;
	let tbl = resolved_table_schema(std::sync::Arc::as_ref(&c), &table).await?;
	let vals = insert_values(&tbl, values)?;
	let oid = std::sync::Arc::as_ref(&c)
		.create(&table, vals.clone())
		.await
		.map_err(|e| format!("{e}"))?;

	let reply = row_to_map(&tbl, oid, &vals).map_err(|e| format!("{e}"))?;

	jazz.snapshot_broadcast(std::sync::Arc::as_ref(&c), &table).await?;

	Ok(reply)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_update(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	table: String,
	id: String,
	patch: JsonRow,
) -> Result<JsonRow, String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;
	let tbl = resolved_table_schema(std::sync::Arc::as_ref(&c), &table).await?;
	let uuid =
		uuid::Uuid::parse_str(&id).map_err(|e| format!("invalid id UUID parse: {e}"))?;

	let oid = ObjectId::from_uuid(uuid);

	let ops = patch_updates(&tbl, patch)?;

	std::sync::Arc::as_ref(&c)
		.update(oid, ops)
		.await
		.map_err(|e| format!("{e}"))?;

	jazz.snapshot_broadcast(std::sync::Arc::as_ref(&c), &table).await?;

	jazz_get(app.clone(), jazz, self_state, table, id.to_string()).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_delete(
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	table: String,
	id: String,
) -> Result<(), String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;
	let uuid =
		uuid::Uuid::parse_str(&id).map_err(|e| format!("invalid UUID: {e}"))?;
	let oid = ObjectId::from_uuid(uuid);
	std::sync::Arc::as_ref(&c)
		.delete(oid)
		.await
		.map_err(|e| format!("{e}"))?;
	jazz.snapshot_broadcast(std::sync::Arc::as_ref(&c), &table).await?;
	Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn jazz_subscribe(
	window: tauri::Window,
	app: tauri::AppHandle,
	jazz: tauri::State<'_, ManagedJazz>,
	self_state: tauri::State<'_, SelfState>,
	table: String,
) -> Result<(), String> {
	let c = ensure_arc(&app, &self_state, &jazz).await?;

	let evt = format!("jazz:{}:changed", table);
	let first = query_table_maps(std::sync::Arc::as_ref(&c), &table).await?;
	window.emit(&evt, first).map_err(|e| e.to_string())?;

	let tx = jazz.broadcaster(&table);
	let mut rx = tx.subscribe();
	let window_emit = window.clone();

	tauri::async_runtime::spawn(async move {
		let evt_owned = evt;
		loop {
			match rx.recv().await {
				Ok(snap) => {
					if window_emit.emit(&evt_owned, snap).is_err() {
						break;
					}
				}
				Err(broadcast::error::RecvError::Closed) => break,
				Err(broadcast::error::RecvError::Lagged(_)) => continue,
			}
		}
	});

	Ok(())
}

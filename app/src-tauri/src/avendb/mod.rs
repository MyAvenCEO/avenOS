//! Generic AvenDb CRUD over Tauri IPC. Schema mirrors `libs/aven-schema/schema.manifest.json`.

pub(crate) mod engine;
pub mod runtime;
pub mod ui_drain;

mod conn;
mod drain;
mod mesh_ui;
pub mod brain_ipc;
mod caps_ipc;
mod crud_ipc;

pub use conn::*;
pub use drain::*;
pub(crate) use mesh_ui::*;
pub use caps_ipc::*;
pub(crate) use crud_ipc::*;

use std::fs;
use std::sync::atomic::Ordering;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use aven_db::{
	query_manager::types::{ColumnType, SchemaHash, TableSchema},
	AppContext,
	AppId,
	PeerId,
	AvenDbClient,
	metadata::MetadataKey,
	ObjectId,
	PeerInboundParkedHook,
	SyncPayload,
	SyncTransport,
	Value,
};
use crate::identity_sync;
use serde_json::Value as JsonValue;
use tauri::{Emitter, Manager};
use tauri_plugin_self::derive::ed25519_public;
use tauri_plugin_self::state::SelfState;
use tauri_plugin_self::vault::ActiveVault;
use uuid::Uuid;

fn decode_json_bytea(s: &str) -> Result<Vec<u8>, String> {
	use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};
	use base64::Engine;

	if s == PHASE1_SECRET_PLACEHOLDER || s.starts_with(crate::crypto::CELL_ENVELOPE_V1) {
		return Ok(s.as_bytes().to_vec());
	}
	if let Ok(b) = URL_SAFE_NO_PAD.decode(s) {
		return Ok(b);
	}
	if let Ok(b) = STANDARD.decode(s) {
		return Ok(b);
	}
	if let Ok(b) = URL_SAFE.decode(s) {
		return Ok(b);
	}
	Err("expected base64 bytea column".to_string())
}

fn is_sealed_or_phase1_storage_string(s: &str) -> bool {
	s == PHASE1_SECRET_PLACEHOLDER || s.starts_with(crate::crypto::CELL_ENVELOPE_V1)
}

pub(super) fn json_cell_to_avendb(cell: &JsonValue, col_ty: &ColumnType, nullable: bool) -> Result<Value, String> {
	if cell.is_null() || *cell == JsonValue::Null {
		return nullable
			.then(|| Ok(Value::Null))
			.unwrap_or_else(|| Err("null not permitted".to_string()));
	}
	if let Some(s) = cell.as_str() {
		if is_sealed_or_phase1_storage_string(s) {
			// Keep avenDB column types aligned with the manifest (e.g. `files.content` is bytea).
			return if matches!(col_ty, ColumnType::Bytea) {
				decode_json_bytea(s).map(Value::Bytea)
			} else {
				Ok(Value::Text(s.to_string()))
			};
		}
	}
	match col_ty {
		ColumnType::Text => cell
			.as_str()
			.map(|s| Value::Text(s.to_string()))
			.ok_or_else(|| "expected JSON string column".to_string()),
		ColumnType::Boolean => cell
			.as_bool()
			.map(Value::Boolean)
			.ok_or_else(|| "expected JSON boolean column".to_string()),
		ColumnType::Integer => cell
			.as_i64()
			.and_then(|n| i32::try_from(n).ok())
			.map(Value::Integer)
			.ok_or_else(|| "expected JSON i32-compatible integer column".to_string()),
		ColumnType::BigInt => cell
			.as_i64()
			.map(Value::BigInt)
			.ok_or_else(|| "expected JSON i64-compatible integer column".to_string()),
		ColumnType::Timestamp => cell
			.as_u64()
			.map(Value::Timestamp)
			.ok_or_else(|| "expected JSON u64 timestamp column".to_string()),
		ColumnType::Uuid => cell
			.as_str()
			.and_then(|s| Uuid::parse_str(s).ok())
			.map(|u| Value::Uuid(ObjectId::from_uuid(u)))
			.ok_or_else(|| "expected UUID string column".to_string()),
		ColumnType::Array { element: inner } => {
			let arr = cell
				.as_array()
				.ok_or_else(|| format!("expected JSON array column (inner={inner:?})"))?;
			let mut elems = Vec::with_capacity(arr.len());
			for item in arr {
				elems.push(json_cell_to_avendb(item, inner.as_ref(), false)?);
			}
			Ok(Value::Array(elems))
		}
		ColumnType::Bytea => cell
			.as_str()
			.ok_or_else(|| "expected JSON string bytea column".to_string())
			.and_then(|s| decode_json_bytea(s).map(Value::Bytea)),
		ColumnType::Double => cell
			.as_f64()
			.map(Value::Double)
			.ok_or_else(|| "expected JSON number double column".to_string()),
		ColumnType::Json { .. } => {
			let s = serde_json::to_string(cell).map_err(|e| format!("json column encode: {e}"))?;
			Ok(Value::Text(s))
		}
		ColumnType::Enum { variants } => {
			let s = cell
				.as_str()
				.ok_or_else(|| "expected JSON string enum column".to_string())?;
			if !variants.iter().any(|v| v == s) {
				return Err(format!("enum variant `{s}` not in {variants:?}"));
			}
			Ok(Value::Text(s.to_string()))
		}
		ColumnType::BatchId => {
			let s = cell
				.as_str()
				.ok_or_else(|| "expected JSON string batch_id column".to_string())?;
			let bytes = hex::decode(s.trim()).map_err(|e| format!("batch_id hex: {e}"))?;
			if bytes.len() != 16 {
				return Err(format!("batch_id length {} (expected 16)", bytes.len()));
			}
			let mut arr = [0u8; 16];
			arr.copy_from_slice(&bytes);
			Ok(Value::BatchId(arr))
		}
		// Nested `Row` types are engine-only until a structured JSON IPC contract exists.
		ColumnType::Row { .. } => Err(format!(
			"row {col_ty:?} unsupported through JSON IPC (engine-only; use flat columns)",
			col_ty = col_ty,
		)),
		// Vector (embedding) column: a JSON array of numbers -> packed f32.
		ColumnType::Vector { .. } => {
			let arr = cell
				.as_array()
				.ok_or_else(|| "expected JSON array column for vector".to_string())?;
			let mut v = Vec::with_capacity(arr.len());
			for item in arr {
				let f = item
					.as_f64()
					.ok_or_else(|| "expected JSON number in vector column".to_string())?;
				v.push(f as f32);
			}
			Ok(Value::Vector(v))
		}
	}
}

/// Encode IPC JSON into a avenDB `Text` cell (storage is always `text` for sealed columns).
///
/// When the manifest sets `exposeTs`, the logical value is encoded as canonical JSON inside the
/// text cell (then sealed on the write path). Plain `text` columns without `exposeTs` store UTF-8 strings.
pub(super) fn json_to_text_storage_cell(
	table: &str,
	column: &str,
	cell: &JsonValue,
	nullable: bool,
) -> Result<Value, String> {
	if cell.is_null() || *cell == JsonValue::Null {
		return nullable
			.then(|| Ok(Value::Null))
			.unwrap_or_else(|| Err("null not permitted".to_string()));
	}
	if let Some(expose) = crate::schema_manifest::expose_ts_for(table, column) {
		let gv = json_cell_to_avendb(cell, expose, nullable)?;
		let canon = crate::crypto::avendb_value_to_canonical_utf8(&gv)?;
		return Ok(Value::Text(canon));
	}
	if let Some(s) = cell.as_str() {
		if is_sealed_or_phase1_storage_string(s) {
			return Ok(Value::Text(s.to_string()));
		}
		return Ok(Value::Text(s.to_string()));
	}
	Err(format!(
		"column `{table}.{column}`: expected JSON string for text storage (or use exposeTs logical type)"
	))
}

/// JSON boundary → name-keyed cells for the universal schema-checked create
/// (`create_checked*`, board 0020). This only decodes JSON per the column's type;
/// row resolution (missing-required error, nullable Null-fill) is owned by
/// aven-db's `resolve_named_row`. Unknown keys error here — never silently dropped.
pub(super) fn insert_values(
	table: &str,
	table_schema: &TableSchema,
	values: JsonRow,
) -> Result<std::collections::HashMap<String, Value>, String> {
	let row_desc = &table_schema.columns;
	let mut row = std::collections::HashMap::with_capacity(values.len());
	for (key, js) in &values {
		if key == "id" {
			// Reserved: the row id is engine-assigned, not a column (mirrors patch_updates).
			continue;
		}
		let cd = row_desc
			.column(key)
			.ok_or_else(|| format!("create {table}: unknown column `{key}` (not in schema)"))?;
		let val = if matches!(cd.column_type, ColumnType::Text) {
			json_to_text_storage_cell(table, key, js, cd.nullable)?
		} else {
			json_cell_to_avendb(js, &cd.column_type, cd.nullable)?
		};
		row.insert(key.clone(), val);
	}
	Ok(row)
}

pub(crate) fn patch_updates(table_schema: &TableSchema, patch: JsonRow) -> Result<Vec<(String, Value)>, String> {
	let mut ops = Vec::new();
	let row_desc = &table_schema.columns;

	for (k, raw_js) in &patch {
		if k == "id" {
			continue;
		}
		let col = row_desc.column(k).ok_or_else(|| format!("unknown_column: {k}"))?;
		let v = json_cell_to_avendb(raw_js, &col.column_type, col.nullable)?;
		ops.push((k.clone(), v));
	}
	if ops.is_empty() {
		return Err("empty patch".into());
	}
	Ok(ops)
}

/// Dial the hosted aven-node over a WebSocket and complete the nonce-bound
/// did:key challenge. Returns the transport + the server's authenticated peer id.
///
/// The endpoint is `AVENOS_SERVER_WS_URL` (e.g. `wss://aven-ceo-bmrha.sprites.app/sync`,
/// or `ws://127.0.0.1:8080/sync` for a local relay). Reaching the hosted relay is
/// just the public Sprite URL — no `sprite proxy` — and TLS is the Sprites proxy's,
/// so there is no cert to pin. The URL is resolved from the runtime env (dev), else
/// a value baked at build time via `option_env!` (release pipeline), else `None` →
/// local-only. The dial retries briefly so the app tolerates the relay waking a
/// beat late (the first request wakes a hibernated Sprite).
async fn try_server_transport(
	signing_key: ed25519_dalek::SigningKey,
) -> Option<(Arc<dyn SyncTransport>, PeerId, Arc<tokio::sync::Notify>)> {
	let url = match server_ws_url() {
		Some(u) => {
			log::info!("server sync URL resolved: {u} (dialing relay)");
			u
		}
		None => {
			log::info!(
				"server sync URL unset (no AVENOS_SERVER_WS_URL baked or in env) — running local-only"
			);
			return None;
		}
	};
	// Dial until connected — no give-up window. A hibernated relay wakes on the
	// request; on a slow/just-coming-up network (e.g. cellular after a switch) we
	// keep retrying with capped backoff instead of silently falling back to
	// local-only. The caller (`spawn_dev_peer_sync`) re-enters this on disconnect.
	let mut backoff = Duration::from_millis(400);
	loop {
		match aven_p2p::WsClientTransport::connect(&url, signing_key.clone()).await {
			Ok(t) => {
				let server = t.server_peer_id();
				let disconnected = t.disconnected();
				log::info!("server transport established (aven {server})");
				return Some((Arc::new(t), server, disconnected));
			}
			Err(e) => {
				log::debug!("server ws dial not ready ({url}): {e}");
				tokio::time::sleep(backoff).await;
				backoff = (backoff * 2).min(Duration::from_secs(5));
			}
		}
	}
}

/// The sync server WebSocket URL: runtime `AVENOS_SERVER_WS_URL` (dev) →
/// compile-time `option_env!` (baked by the release pipeline) → `None`
/// (local-only). No connection is attempted when unset.
fn server_ws_url() -> Option<String> {
	if let Ok(u) = std::env::var("AVENOS_SERVER_WS_URL") {
		let u = u.trim().to_string();
		if !u.is_empty() {
			return Some(u);
		}
	}
	match option_env!("AVENOS_SERVER_WS_URL") {
		Some(u) if !u.trim().is_empty() => Some(u.trim().to_string()),
		_ => None,
	}
}

/// The sync transport for this client, or `None` to run local-only (no
/// `AVENOS_SERVER_SYNC`, or the relay was unreachable). Yields
/// `(transport, server-peer-to-register)`.
async fn try_any_peer_transport(
	root: &[u8; 32],
) -> Option<(Arc<dyn SyncTransport>, PeerId, Arc<tokio::sync::Notify>)> {
	let sk = crate::avendb_auth::signing_key_from_device_root(root).ok()?;
	try_server_transport(sk).await
}

async fn avendb_connect(
	app: &tauri::AppHandle,
	self_state: &SelfState,
	mj: &ManagedAvenDb,
) -> Result<AvenDbClient, String> {
	let root = self_state
		.with_root(|r| Ok(*r))
		.map_err(|_| "locked: unlock AvenOS identity first".to_string())?;

	let schema = crate::schema_manifest::load_avendb_schema_from_manifest()?;
	let pk = ed25519_public(&root)?;
	let peer_id = PeerId(pk);
	let avendb_hash = *SchemaHash::compute(&schema).as_bytes();

	let user_root = vault_user_root(app)?;
	let data_dir = user_root.join(AVEN_OS_AVENDB_DATA_DIR);
	let live_schemas =
		reconcile_avendb_identity_cache_dir(&data_dir, peer_id, &avendb_hash, &schema)?;

	let ctx = AppContext {
		app_id: AppId::from_name("ceo.aven.os"),
		client_id: Some(peer_id),
		schema: schema.clone(),
		live_schemas,
		data_dir: data_dir.clone(),
	};

	let _ = app;
	// Connect avenDB LOCALLY only — this is the sole thing sign-in waits on. The
	// sync transport (the aven-node relay over TLS) is established and attached
	// in the BACKGROUND (see `spawn_dev_peer_sync`), so bootstrap can never block
	// waiting for the relay to appear.
	let client = AvenDbClient::connect(ctx).await.map_err(format_avendb_err)?;
	// Install the biscuit-backed sync gate (replaces the `AllowAll` default).
	// It reads the live shell vault + identity ACL handles, so it authorizes from
	// real biscuits the moment the shell hydrates; until then it returns
	// `Pending` (defer, never drop) and a later catch-up re-asks.
	let resolver = std::sync::Arc::new(crate::biscuit_resolver::BiscuitCapabilityResolver::new(
		mj.sync_shell.clone(),
		mj.sync_acl.clone(),
	));
	if let Err(e) = client.set_resolver(resolver) {
		log::warn!("install biscuit sync gate: {e}");
	}

	// Install the author edit-signer (audit #29): every locally-authored row is signed over
	// its content digest with the device key, so `data` + `metadata` are authenticated and a
	// relay that tampers with a sealed cell / keyshare column is rejected on apply by every
	// peer. Installed at connect (before any identity row is authored) so no row ships
	// unsigned. The key is the same device key that mints owner-bindings.
	match crate::avendb_auth::signing_key_from_device_root(&root) {
		Ok(signing_key) => {
			let signer =
				std::sync::Arc::new(crate::biscuit_resolver::AppEditSigner::new(signing_key));
			if let Err(e) = client.set_edit_signer(signer) {
				log::warn!("install author edit-signer: {e}");
			}
		}
		Err(e) => log::warn!("derive signing key for edit-signer: {e}"),
	}

	crate::schema_migrations::stamp_current_vault_snapshot(&data_dir, &schema)?;
	Ok(client)
}

/// Establish the sync transport (the aven-node relay over TLS) in the BACKGROUND
/// and attach it to an already-connected (local) client. Never blocks sign-in:
/// avenDB is connected locally first, and this only wires sync once the relay is
/// reachable. A no-op when sync is unconfigured (`try_any_peer_transport` returns
/// `None` immediately when `AVENOS_SERVER_SYNC` is unset).
fn spawn_dev_peer_sync(
	self_state: &SelfState,
	client: Arc<AvenDbClient>,
	change_tx: tokio::sync::mpsc::UnboundedSender<String>,
	relay_did_slot: Arc<RwLock<Option<String>>>,
) {
	// Capture the unlocked root up front (the transport signs the did:key challenge
	// with it); bail if locked.
	let root = match self_state.with_root(|r| Ok(*r)) {
		Ok(r) => r,
		Err(_) => return,
	};
	// Start clean: clear any stale relay until this attempt establishes one (so a
	// local-only run correctly reports "no relay connected").
	if let Ok(mut slot) = relay_did_slot.write() {
		*slot = None;
	}
	// Inbound peer-sync deltas must drive the SAME drain that local IPC writes use
	// (`change_tx` → `run_table_change_drain` → `execute_drain_batch`). Without this
	// hook, a synced `identities`/`keyshares` change — e.g. a identity-admin grant arriving
	// from a peer — never invalidates the vault shell or refreshes the sync ACL, so
	// the newly granted identity's data won't decrypt or live-sync until the next app
	// restart. Built once and reused across reconnects.
	let on_inbound: PeerInboundParkedHook = Arc::new(move |payload: &SyncPayload| {
		// The table name lives in the payload-level `metadata` (built by
		// `metadata_from_row_locator`), NOT in `row.metadata` — a row's own metadata is
		// provenance only and never carries `table`.
		let table = match payload {
			SyncPayload::RowBatchCreated { metadata, .. }
			| SyncPayload::RowBatchNeeded { metadata, .. } => Some(
				metadata
					.as_ref()
					.and_then(|m| m.metadata.get(MetadataKey::Table.as_str()).cloned()),
			),
			_ => None,
		};
		// Peer-synced deltas forwarded by a blind relay don't always preserve the
		// payload-level table; then a synced grant/keyshare only re-hydrates after an app
		// restart (M8 B2/B3: subject_not_owner + missing_dek_cached). When a RowBatch has
		// no table, poke the vault-shell tables so a re-hydrate is CONSIDERED; the content-
		// digest guard makes identical re-deliveries a no-op (no re-hydrate loop).
		match table {
			Some(Some(table)) => {
				let _ = change_tx.send(table);
			}
			Some(None) => {
				for t in ["safes", "keyshares", "signers"] {
					let _ = change_tx.send(t.to_string());
				}
			}
			None => {}
		}
	});
	// Supervisor: (re)dial → attach → register → wait for the connection to drop →
	// repeat. This is what makes sync recover on the fly after a network switch,
	// hibernate, or idle close — not only on app restart. Re-registering on each
	// reconnect re-triggers the engine's frontier catch-up, so missed batches resync.
	tokio::spawn(async move {
		loop {
			let Some((transport, remote, disconnected)) = try_any_peer_transport(&root).await
			else {
				return; // local-only (no relay URL) — nothing to supervise
			};
			// Record the authenticated relay DID so the UI can offer a one-click
			// "replicate this identity to the connected relay".
			if let Ok(did) = crate::avendb_auth::signer_did_from_ed25519(&remote.0) {
				if let Ok(mut slot) = relay_did_slot.write() {
					*slot = Some(did);
				}
			}
			client.attach_sync_transport(transport, Some(on_inbound.clone()));
			// Don't re-register a peer the user has Forgotten (revoked) — that is what
			// makes Forget persist across reconnect/restart. Only an explicit revoke is
			// skipped; unknown peers stay permissive (first-contact).
			let remote_did = crate::avendb_auth::signer_did_from_ed25519(&remote.0).ok();
			let revoked = match &remote_did {
				Some(did) => crate::signers::is_signer_revoked(&client, did)
					.await
					.unwrap_or(false),
				None => false,
			};
			if revoked {
				log::info!("dev peer {remote} is Forgotten (revoked); not registering for sync");
			} else if let Err(e) = client.register_peer_sync_client(remote) {
				log::warn!("register dev peer {remote}: {e}");
			}
			// Block until the live connection drops, then loop to reconnect + resync.
			disconnected.notified().await;
			log::info!("relay connection lost — reconnecting to resync");
			tokio::time::sleep(Duration::from_millis(500)).await;
		}
	});
}

/// Flip shell gate after local vault shell is ready (demo mesh — no live transport reconcile).
fn mark_shell_local_ready_for_mesh(_app: &tauri::AppHandle, mj: &ManagedAvenDb) {
	mj.mesh_local_shell_gate.store(true, Ordering::Release);
}

async fn pairing_session_active(_app: &tauri::AppHandle) -> bool {
	false
}

async fn avendb_shell_ready(
	app: &tauri::AppHandle,
	mj: &ManagedAvenDb,
	self_state: &SelfState,
	client: Arc<AvenDbClient>,
) -> Result<std::sync::Arc<engine::ShellState>, String> {
	avendb_shell_ready_inner(app, mj, self_state, client, false).await
}

/// Shell hydrate for UI table drains — no mesh reconcile, ACL bootstrap, or pairing-sensitive flush side effects.
async fn avendb_shell_for_ui(
	app: &tauri::AppHandle,
	mj: &ManagedAvenDb,
	self_state: &SelfState,
	client: Arc<AvenDbClient>,
) -> Result<std::sync::Arc<engine::ShellState>, String> {
	avendb_shell_ready_inner(app, mj, self_state, client, true).await
}

async fn avendb_shell_ready_inner(
	app: &tauri::AppHandle,
	mj: &ManagedAvenDb,
	self_state: &SelfState,
	client: Arc<AvenDbClient>,
	for_ui_drain: bool,
) -> Result<std::sync::Arc<engine::ShellState>, String> {
	if !mj.shell_vault_stale.load(Ordering::Acquire) {
		if let Some(cached) = mj.shell.lock().await.clone() {
			if !for_ui_drain {
				mark_shell_local_ready_for_mesh(app, mj);
			}
			return Ok(cached);
		}
	}

	let _hydrate_guard = mj.shell_hydrate.lock().await;
	if !mj.shell_vault_stale.load(Ordering::Acquire) {
		if let Some(cached) = mj.shell.lock().await.clone() {
			if !for_ui_drain {
				mark_shell_local_ready_for_mesh(app, mj);
			}
			return Ok(cached);
		}
	}

	let root = self_state
		.with_root(|r| Ok(*r))
		.map_err(|_| "locked: unlock AvenOS identity first".to_string())?;
	let vault_files = vault_user_root(app)?;
	// Full hydrate when vault tables change (identities/keyshares/peers) or on first use after unlock.
	let hydrated = engine::hydrate_shell(client.as_ref(), &root, &vault_files).await?;
	mj.shell_vault_stale.store(false, Ordering::Release);
	let arc = std::sync::Arc::new(hydrated);
	let mut slot = mj.shell.lock().await;
	*slot = Some(std::sync::Arc::clone(&arc));
	// Mirror into the std-lock handle read by the biscuit sync gate.
	*mj.sync_shell.write().expect("sync_shell poisoned") = Some(std::sync::Arc::clone(&arc));
	let object_owner = engine::build_object_owner_map(client.as_ref()).await?;
	let keyshare_recipient = engine::build_keyshare_recipient_map(client.as_ref()).await?;
	let snap = identity_sync::build_sync_acl_snapshot(object_owner, keyshare_recipient);
	*mj.sync_acl.write().expect("sync_acl poisoned") = Some(snap);
	if !for_ui_drain {
		let first_mesh_publish = !mj.mesh_acl_rebroadcast_done.swap(true, Ordering::AcqRel);
		if first_mesh_publish {
			publish_peer_mesh_after_acl(app).await;
		}
		mark_shell_local_ready_for_mesh(app, mj);
	}
	Ok(arc)
}

pub(crate) async fn avendb_ipc_status(
	_app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	self_state: &SelfState,
) -> Result<AvenDbStatusReply, String> {
	if !self_state.is_unlocked() {
		avendb.reset_connection().await;
		return Ok(AvenDbStatusReply {
			ready: false,
			tables: vec![],
			session: None,
			message: None,
		});
	}

	let desired = desired_root_client_uuid(&self_state)?;

	let jc = avendb.conn.lock().await;
	if jc.linked_identity != Some(desired) {
		let stale = jc.client.is_some() || jc.linked_identity.is_some();
		drop(jc);
		if stale {
			avendb.reset_connection().await;
		}
		return Ok(AvenDbStatusReply {
			ready: false,
			tables: vec![],
			session: None,
			message: None,
		});
	}

	let client = match jc.client.clone() {
		Some(c) => c,
		None => {
			return Ok(AvenDbStatusReply {
				ready: false,
				tables: vec![],
				session: None,
				message: None,
			});
		}
	};
	let shell_ready = !avendb.shell_vault_stale.load(Ordering::Acquire)
		&& avendb.shell.lock().await.is_some();
	drop(jc);

	let sch = client.schema().await.map_err(format_avendb_err)?;
	let mut names: Vec<String> = sch.keys().map(|k| k.to_string()).collect();
	names.sort();
	Ok(AvenDbStatusReply {
		ready: shell_ready,
		tables: names,
		session: None,
		message: None,
	})
}

fn avendb_session_reply_from_shell(shell: &engine::ShellState) -> AvenDbSessionReply {
	AvenDbSessionReply {
		signer_did: shell.signer_did.clone(),
		signer_did_short: engine::short_signer_did(&shell.signer_did),
		default_spark_urn: engine::safe_urn(shell.default_identity),
		// This shell-only path has no relay handle; the live relay DID is filled
		// by `avendb_ipc_session` (which can read `ManagedAvenDb`).
		relay_did: None,
	}
}

/// Internal vault tables that carry no UI rows — skipped when force-publishing initial
/// snapshots (their contents hydrate the shell, they are never painted directly).
const NON_UI_TABLES: &[&str] = &["keyshares"];

pub(crate) async fn avendb_ipc_bootstrap(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	self_state: &SelfState,
) -> Result<AvenDbStatusReply, String> {
	let client = with_connected_client(avendb, app, self_state).await?;
	let sch = client.schema().await.map_err(format_avendb_err)?;
	let mut tables: Vec<String> = sch.keys().map(|k| k.to_string()).collect();
	tables.sort();

	let client_arc = client.clone();
	match avendb_shell_ready(app, avendb, self_state, client).await {
		Ok(shell) => {
			let session = avendb_session_reply_from_shell(shell.as_ref());
			emit_avenos_runtime(app, serde_json::json!({
				"kind": "session",
				"phase": "ready",
				"avendbReady": true,
				"signerDid": session.signer_did,
				"defaultSparkUrn": session.default_spark_urn,
				"tables": tables.clone(),
			}));
			// Generic: force-publish an initial snapshot for EVERY table in the connected
			// schema (minus internal vault tables), so first paint is reactive for any
			// present or future table without a hardcoded list to maintain.
			for table in &tables {
				if NON_UI_TABLES.contains(&table.as_str()) {
					continue;
				}
				if let Err(e) = avendb
					.publish_table_snapshot_force(
						app,
						client_arc.as_ref(),
						shell.as_ref(),
						table,
					)
					.await
				{
					log::warn!(
						target: "avenos::avendb",
						"bootstrap snapshot {table}: {e}",
					);
				}
			}
			#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
			{
				if let Err(e) = execute_mesh_refresh_full(app, avendb).await {
					log::debug!(
						target: "avenos::avendb",
						"post-bootstrap mesh refresh: {e}",
					);
				}
			}
			Ok(AvenDbStatusReply {
				ready: true,
				tables,
				session: Some(session),
				message: None,
			})
		}
		Err(e) => {
			log::warn!(target: "avenos::avendb", "avendb_bootstrap shell_ready: {e}");
			emit_avenos_runtime(app, serde_json::json!({
				"kind": "session",
				"phase": "bootstrapping",
				"avendbReady": false,
				"message": e,
			}));
			Ok(AvenDbStatusReply {
				ready: false,
				tables,
				session: None,
				message: Some(e),
			})
		}
	}
}

pub(crate) async fn avendb_ipc_session(
	app: &tauri::AppHandle,
	avendb: &ManagedAvenDb,
	self_state: &SelfState,
) -> Result<AvenDbSessionReply, String> {
	let client = with_connected_client(avendb, app, self_state).await?;
	let shell = avendb_shell_ready(app, avendb, self_state, client.clone()).await?;
	let relay_did = avendb
		.connected_relay_did
		.read()
		.ok()
		.and_then(|slot| slot.clone());
	Ok(AvenDbSessionReply {
		signer_did: shell.signer_did.clone(),
		signer_did_short: engine::short_signer_did(&shell.signer_did),
		default_spark_urn: engine::safe_urn(shell.default_identity),
		relay_did,
	})
}

/// Demo mesh — no live avenDB peer registration.
pub(crate) async fn avendb_ipc_peer_mesh_refresh(
	_app: &tauri::AppHandle,
	_avendb: &ManagedAvenDb,
	_self_state: &SelfState,
) -> Result<AvenDbPeerMeshRefreshReply, String> {
	Ok(AvenDbPeerMeshRefreshReply {
		registered_count: 0,
	})
}

/// Multiplexed IPC: one entry for avenDB session, tables, mesh, and peer admin.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AvenDbRuntimeEnvelope {
	pub op: String,
	#[serde(default)]
	pub payload: serde_json::Value,
}

pub(crate) async fn avendb_runtime_dispatch(
	app: &tauri::AppHandle,
	_window: tauri::Window,
	mj: &ManagedAvenDb,
	ss: &SelfState,
	envelope: AvenDbRuntimeEnvelope,
) -> Result<serde_json::Value, String> {
	let op = envelope.op.trim().to_ascii_lowercase();
	let pj = envelope.payload;

	match op.as_str() {
		"bootstrap" => serde_json::to_value(avendb_ipc_bootstrap(app, mj, ss).await?).map_err(|e| e.to_string()),
		"status" => serde_json::to_value(avendb_ipc_status(app, mj, ss).await?).map_err(|e| e.to_string()),
		"session" => serde_json::to_value(avendb_ipc_session(app, mj, ss).await?).map_err(|e| e.to_string()),
		"list" => {
			let table = pj_str(&pj, "table")?;
			serde_json::to_value(avendb_ipc_avendb_list(app, mj, ss, table).await?).map_err(|e| e.to_string())
		}
		"explorerlist" => {
			let table = pj_str(&pj, "table")?;
			serde_json::to_value(avendb_ipc_avendb_explorer_list(app, mj, ss, table).await?)
				.map_err(|e| e.to_string())
		}
		"brainstatus" => brain_ipc::brain_ipc_status(app, mj, ss, pj_str(&pj, "identity")?).await,
		"braindream" => brain_ipc::brain_ipc_dream(app, mj, ss, pj_str(&pj, "identity")?).await,
		"braindreamstep" => {
			let cursor = pj.get("cursor").and_then(|v| v.as_i64()).unwrap_or(0);
			brain_ipc::brain_ipc_dream_step(app, mj, ss, pj_str(&pj, "identity")?, cursor).await
		}
		"brainreembed" => brain_ipc::brain_ipc_reembed(app, mj, ss, pj_str(&pj, "identity")?).await,
		"brainbackfill" => brain_ipc::brain_ipc_backfill(app, mj, ss, pj_str(&pj, "identity")?).await,
		"brainentities" => brain_ipc::brain_ipc_entities(app, mj, ss, pj_str(&pj, "identity")?).await,
		"brainentitycard" => {
			brain_ipc::brain_ipc_entity_card(
				app,
				mj,
				ss,
				pj_str(&pj, "identity")?,
				pj_str(&pj, "name")?,
			)
			.await
		}
		"braningest" | "braineingest" | "brainingest" => {
			brain_ipc::brain_ipc_ingest(
				app,
				mj,
				ss,
				pj_str(&pj, "identity")?,
				pj_str(&pj, "content")?,
				pj_opt_str(&pj, "stream"),
				pj_opt_str(&pj, "authorRole"),
				pj_opt_str(&pj, "source"),
				pj.get("contentDateMs").and_then(|v| v.as_i64()),
				pj_opt_str(&pj, "veracity"),
				pj.get("importance").and_then(|v| v.as_f64()),
			)
			.await
		}
		"brainlink" => {
			brain_ipc::brain_ipc_link(
				app,
				mj,
				ss,
				pj_str(&pj, "identity")?,
				pj_str(&pj, "from")?,
				pj_str(&pj, "to")?,
			)
			.await
		}
		"brainattest" => {
			brain_ipc::brain_ipc_attest(app, mj, ss, pj_str(&pj, "identity")?, pj_str(&pj, "id")?)
				.await
		}
		"brainforget" => {
			brain_ipc::brain_ipc_forget(app, mj, ss, pj_str(&pj, "identity")?, pj_str(&pj, "id")?)
				.await
		}
		"brainsearch" => {
			brain_ipc::brain_ipc_search(
				app,
				mj,
				ss,
				pj_str(&pj, "identity")?,
				pj_str(&pj, "query")?,
				pj.get("k").and_then(|v| v.as_u64()).unwrap_or(8) as usize,
				pj_opt_str(&pj, "stream"),
			)
			.await
		}
		"brainassemblecontext" => {
			brain_ipc::brain_ipc_assemble_context(
				app,
				mj,
				ss,
				pj_str(&pj, "identity")?,
				pj_str(&pj, "query")?,
				pj.get("workingN").and_then(|v| v.as_u64()).map(|n| n as usize),
				pj.get("recallK").and_then(|v| v.as_u64()).map(|n| n as usize),
				pj.get("budgetChars").and_then(|v| v.as_u64()).map(|n| n as usize),
				pj_opt_str(&pj, "stream"),
			)
			.await
		}
		"get" => {
			let table = pj_str(&pj, "table")?;
			let id = pj_str(&pj, "id")?;
			serde_json::to_value(avendb_ipc_avendb_get(app, mj, ss, table, id).await?).map_err(|e| e.to_string())
		}
		"create" => {
			let table = pj_str(&pj, "table")?;
			let values: JsonRow = serde_json::from_value(
				pj.get("values")
					.cloned()
					.ok_or_else(|| "avendb_runtime: missing `values`".to_string())?,
			)
			.map_err(|e| format!("avendb_runtime: values: {e}"))?;
			let created = avendb_ipc_avendb_create(app, mj, ss, table.clone(), values).await?;
			announce_local_write_to_peers(app, mj, ss, &table).await;
			serde_json::to_value(created).map_err(|e| e.to_string())
		}
		"update" => {
			let table = pj_str(&pj, "table")?;
			let id = pj_str(&pj, "id")?;
			let patch: JsonRow = serde_json::from_value(
				pj.get("patch")
					.cloned()
					.ok_or_else(|| "avendb_runtime: missing `patch`".to_string())?,
			)
			.map_err(|e| format!("avendb_runtime: patch: {e}"))?;
			let updated = avendb_ipc_avendb_update(app, mj, ss, table.clone(), id, patch).await?;
			announce_local_write_to_peers(app, mj, ss, &table).await;
			serde_json::to_value(updated).map_err(|e| e.to_string())
		}
		"delete" => {
			let table = pj_str(&pj, "table")?;
			let id = pj_str(&pj, "id")?;
			avendb_ipc_avendb_delete(app, mj, ss, table.clone(), id).await?;
			announce_local_write_to_peers(app, mj, ss, &table).await;
			Ok(serde_json::Value::Null)
		}
		"subscribe" => {
			let table = pj_str(&pj, "table")?;
			avendb_ipc_avendb_subscribe(app, mj, ss, table).await?;
			Ok(serde_json::Value::Null)
		}
		"unsubscribe" => {
			let table = pj_str(&pj, "table")?;
			avendb_ipc_avendb_unsubscribe(mj, table).await?;
			Ok(serde_json::Value::Null)
		}
		"peermeshrefresh" => {
			serde_json::to_value(avendb_ipc_peer_mesh_refresh(app, mj, ss).await?)
				.map_err(|e| e.to_string())
		}
		"meshstatus" => {
			let snap = execute_mesh_snapshot(app, mj, ss).await?;
			serde_json::to_value(snap).map_err(|e| e.to_string())
		}
		"peerlist" => serde_json::to_value(avendb_ipc_peer_list(app, mj, ss).await?).map_err(|e| e.to_string()),
		"peeradd" => {
			let signer_did = pj_str(&pj, "signerDid")?;
			let label = pj
				.get("label")
				.and_then(|v| v.as_str())
				.unwrap_or("")
				.to_string();
			avendb_ipc_peer_add(app, mj, ss, signer_did, label).await?;
			Ok(serde_json::Value::Null)
		}
		"peerrevoke" => {
			let signer_did = pj_str(&pj, "signerDid")?;
			avendb_ipc_peer_revoke(app, mj, ss, signer_did).await?;
			Ok(serde_json::Value::Null)
		}
		"sparkadminadd" => {
			let owner = pj_str(&pj, "identityId")?;
			let signer_did = pj_str(&pj, "signerDid")?;
			avendb_ipc_spark_admin_add(app, mj, ss, owner, signer_did).await?;
			Ok(serde_json::Value::Null)
		}
		"sparkreplicateadd" => {
			let owner = pj_str(&pj, "identityId")?;
			let signer_did = pj_str(&pj, "signerDid")?;
			avendb_ipc_spark_replicate_add(app, mj, ss, owner, signer_did).await?;
			Ok(serde_json::Value::Null)
		}
		"sparkreaderadd" => {
			let owner = pj_str(&pj, "identityId")?;
			let signer_did = pj_str(&pj, "signerDid")?;
			avendb_ipc_spark_reader_add(app, mj, ss, owner, signer_did).await?;
			Ok(serde_json::Value::Null)
		}
		"avenceoclaim" => {
			let id = avendb_ipc_aven_ceo_claim(app, mj, ss).await?;
			Ok(serde_json::Value::String(id))
		}
		"createidentity" => {
			let name = pj_str(&pj, "name")?;
			let kind = pj_str(&pj, "type").unwrap_or_else(|_| "aven".to_string());
			let id = avendb_ipc_create_identity(app, mj, ss, name, kind).await?;
			Ok(serde_json::Value::String(id))
		}
		"creategroup" => {
			let identity = pj_str(&pj, "identityId")?;
			let label = pj_str(&pj, "label")?;
			let id = avendb_ipc_create_collection_group(app, mj, ss, identity, label).await?;
			Ok(serde_json::Value::String(id))
		}
		"avenceoaddmember" => {
			let signer_did = pj_str(&pj, "signerDid")?;
			avendb_ipc_aven_ceo_add_member(app, mj, ss, signer_did).await?;
			Ok(serde_json::Value::Null)
		}
		"avenceopublishprofile" => {
			let account_name = pj_str(&pj, "accountName")?;
			let device_label = pj_str(&pj, "deviceLabel")?;
			avendb_ipc_aven_ceo_publish_profile(app, mj, ss, account_name, device_label).await?;
			Ok(serde_json::Value::Null)
		}
		"avenceomembership" => {
			let m = avendb_ipc_aven_ceo_membership(app, mj, ss).await?;
			Ok(serde_json::Value::String(m))
		}
		"sparkadminlist" => {
			let owner = pj_str(&pj, "identityId")?;
			serde_json::to_value(avendb_ipc_spark_admin_list(app, mj, ss, owner).await?)
				.map_err(|e| e.to_string())
		}
		"sparkadminrevoke" => {
			let owner = pj_str(&pj, "identityId")?;
			let signer_did = pj_str(&pj, "signerDid")?;
			avendb_ipc_spark_admin_revoke(app, mj, ss, owner, signer_did).await?;
			Ok(serde_json::Value::Null)
		}
		other => Err(format!(
			"avendb_runtime: unknown op `{other}` — valid ops: bootstrap, status, session, list, explorerList, get, create, update, delete, subscribe, unsubscribe, peerMeshRefresh, meshStatus, peerList, peerAdd, peerRevoke, sparkAdminAdd, sparkAdminList, sparkAdminRevoke, sparkReplicateAdd, sparkReaderAdd, avenCeoClaim"
		)),
	}
}

#[tauri::command(rename_all = "camelCase")]
pub async fn avendb_runtime(
	window: tauri::Window,
	_app: tauri::AppHandle,
	actor: tauri::State<'_, runtime::AvenDbActorHandle>,
	op: String,
	payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
	let envelope = AvenDbRuntimeEnvelope {
		op,
		payload: payload.unwrap_or_else(|| serde_json::json!({})),
	};
	actor.runtime_invoke(window, envelope).await
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfStoragePathsReply {
	pub root: String,
	pub app_base: String,
	pub db_dir: String,
	pub self_identity_dir: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn self_storage_paths(app: tauri::AppHandle) -> Result<SelfStoragePathsReply, String> {
	let app_base = tauri_plugin_self::paths::aven_os_app_base(&app)?;
	let app_base_str = app_base.to_string_lossy().into_owned();
	match vault_user_root(&app) {
		Ok(root) => {
			let db_dir = tauri_plugin_self::paths::db_dir(&root);
			let crypto_dir = tauri_plugin_self::paths::identity_crypto_dir(&root);
			Ok(SelfStoragePathsReply {
				root: root.to_string_lossy().into_owned(),
				app_base: app_base_str,
				db_dir: db_dir.to_string_lossy().into_owned(),
				self_identity_dir: crypto_dir.to_string_lossy().into_owned(),
			})
		}
		Err(_) => Ok(SelfStoragePathsReply {
			root: String::new(),
			app_base: app_base_str,
			db_dir: String::new(),
			self_identity_dir: String::new(),
		}),
	}
}

/// Deletes the local avenDB store (`db/` under AvenOS user root, plus legacy `avendb/` if present).
#[tauri::command(rename_all = "camelCase")]
pub async fn self_clear_avendb_database(
	app: tauri::AppHandle,
	avendb: tauri::State<'_, ManagedAvenDb>,
) -> Result<(), String> {
	avendb.reset_connection().await;
	let root = vault_user_root(&app)?;
	let p = root.join(AVEN_OS_AVENDB_DATA_DIR);
	if p.exists() {
		fs::remove_dir_all(&p).map_err(|e| format!("remove {}: {e}", p.display()))?;
	}
	Ok(())
}

/// Lock, tear down avenDB, and delete the entire `.avenOS` tree (all vaults, identity, schema cache).
#[tauri::command(rename_all = "camelCase")]
pub async fn self_clear_aven_os_data(
	app: tauri::AppHandle,
	avendb: tauri::State<'_, ManagedAvenDb>,
) -> Result<(), String> {
	avendb.reset_connection().await;

	let self_state: tauri::State<'_, SelfState> = app.state();
	self_state.clear();
	let vault: tauri::State<'_, ActiveVault> = app.state();
	vault.clear()?;
	let _ = app.emit("self:did-lock", ());

	let base = tauri_plugin_self::paths::aven_os_app_base(&app)?;
	if base.exists() {
		fs::remove_dir_all(&base).map_err(|e| format!("remove {}: {e}", base.display()))?;
	}
	Ok(())
}

#[cfg(test)]
mod json_cell_tests {
	use super::*;
	use aven_db::query_manager::types::ColumnType;
	use serde_json::json;

	#[test]
	fn json_cell_to_avendb_bytea_standard_base64() {
		let cell = json!("aGVsbG8=");
		let v = json_cell_to_avendb(&cell, &ColumnType::Bytea, false).unwrap();
		assert_eq!(v, Value::Bytea(b"hello".to_vec()));
	}

	#[test]
	fn json_cell_to_avendb_phase1_and_sealed_bytea_stay_bytea() {
		let phase1 = json!(PHASE1_SECRET_PLACEHOLDER);
		let v = json_cell_to_avendb(&phase1, &ColumnType::Bytea, false).unwrap();
		assert_eq!(v, Value::Bytea(PHASE1_SECRET_PLACEHOLDER.as_bytes().to_vec()));

		let sealed = format!("{}abc", crate::crypto::CELL_ENVELOPE_V1);
		let v = json_cell_to_avendb(&json!(sealed), &ColumnType::Bytea, false).unwrap();
		assert!(matches!(v, Value::Bytea(b) if b.starts_with(crate::crypto::CELL_ENVELOPE_V1.as_bytes())));
	}

	#[test]
	fn sealed_bytea_canonical_roundtrip_ipc() {
		use base64::Engine;
		use crate::crypto::{
			avendb_value_to_canonical_utf8, ipc_json_from_opened_sensitive_plaintext,
		};
		let payload = b"fake-image-bytes".to_vec();
		let canon = avendb_value_to_canonical_utf8(&Value::Bytea(payload.clone())).unwrap();
		let ipc = ipc_json_from_opened_sensitive_plaintext(&canon, &ColumnType::Bytea).unwrap();
		let b64 = ipc.as_str().expect("bytea ipc is base64 string");
		assert_eq!(
			base64::engine::general_purpose::STANDARD.decode(b64).unwrap(),
			payload,
		);
	}

	#[test]
	fn json_cell_to_avendb_double_batch_id_enum() {
		let d = json_cell_to_avendb(&json!(1.5), &ColumnType::Double, false).unwrap();
		assert_eq!(d, Value::Double(1.5));

		let bid = json_cell_to_avendb(
			&json!("0102030405060708090a0b0c0d0e0f10"),
			&ColumnType::BatchId,
			false,
		)
		.unwrap();
		assert_eq!(bid, Value::BatchId([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));

		let en = ColumnType::Enum {
			variants: vec!["a".into(), "b".into()],
		};
		let v = json_cell_to_avendb(&json!("a"), &en, false).unwrap();
		assert_eq!(v, Value::Text("a".into()));
	}

	#[test]
	fn json_cell_to_avendb_json_column() {
		let cell = json!({"k": 1});
		let v = json_cell_to_avendb(&cell, &ColumnType::Json { schema: None }, false).unwrap();
		assert_eq!(v, Value::Text(r#"{"k":1}"#.into()));
	}

	#[test]
	fn json_cell_to_avendb_rejects_row_type() {
		let row_ty = ColumnType::Row {
			columns: Box::new(aven_db::query_manager::types::RowDescriptor::new(vec![])),
		};
		let err = json_cell_to_avendb(&json!([]), &row_ty, false).unwrap_err();
		assert!(err.contains("engine-only"));
	}

	#[test]
	fn json_cell_to_avendb_sealed_bigint_stored_as_text() {
		let sealed = format!("{}abc", crate::crypto::CELL_ENVELOPE_V1);
		let v = json_cell_to_avendb(&json!(sealed), &ColumnType::Text, false).unwrap();
		assert!(matches!(v, Value::Text(s) if s.starts_with(crate::crypto::CELL_ENVELOPE_V1)));
	}

	#[test]
	fn sealed_bigint_canonical_roundtrip_ipc() {
		use crate::crypto::{avendb_value_to_canonical_utf8, ipc_json_from_opened_sensitive_plaintext};
		let canon = avendb_value_to_canonical_utf8(&Value::BigInt(1_704_000_000_000)).unwrap();
		let ipc = ipc_json_from_opened_sensitive_plaintext(&canon, &ColumnType::Text).unwrap();
		assert_eq!(ipc.as_i64(), Some(1_704_000_000_000));
	}
}

//! Brain IPC (plan 0018, E2): a per-SAFE [`Brain`] over the shared avenDB client.
//!
//! Ops (via `avendb_runtime`): `brainStatus`, `brainIngest`, `brainSearch`,
//! `brainEntities`, `brainEntityCard`, `brainAssembleContext`, `brainBackfill`,
//! `brainDream`.
//!
//! Sealed at rest (board 0021): every brain row is written through the identity's
//! DEK-backed [`aven_brain::KeySealer`] — same `cell_seal_aad` coordinates as the
//! device seal path, so the app's hydrate / DB viewer opens brain cells like any
//! other sealed cell. Remaining E3 hardening: owner-binding stamps on brain rows.

use std::sync::Arc;

use aven_brain::{Brain, ContextOptions, Filter, KeySealer, RememberOptions, StubEmbedder, EMBED_DIM};
use aven_db::{AvenDbClient, ObjectId, QueryBuilder, Value};
use serde_json::json;
use tauri_plugin_self::state::SelfState;
use uuid::Uuid;

use super::conn::{with_connected_client, ManagedAvenDb, ENCRYPTED_META};
use super::engine;

/// Wrap the shared connected client as `identity`'s brain (stub embedder until E7),
/// sealed with the identity's current DEK — no DEK, no brain (fail closed: a brain
/// that cannot seal must not write plaintext).
fn brain_over(
	client: Arc<AvenDbClient>,
	shell: &engine::ShellState,
	identity: &str,
) -> Result<(Brain<StubEmbedder>, ObjectId), String> {
	let owner_uuid = Uuid::parse_str(identity.trim()).map_err(|e| format!("identity uuid: {e}"))?;
	let ver = *shell
		.identity_versions
		.get(&owner_uuid)
		.ok_or("brain: no DEK version for this identity (keyshare not arrived?)")?;
	let dek = shell
		.deks
		.get(&(owner_uuid, ver))
		.ok_or("brain: identity DEK not held — cannot seal")?;
	let sealer = Arc::new(KeySealer::new(*dek.expose(), owner_uuid, ver));
	let owner = ObjectId::from_uuid(owner_uuid);
	Ok((
		Brain::over(client, owner, StubEmbedder::new(EMBED_DIM), sealer),
		owner,
	))
}

async fn owner_count(
	client: &AvenDbClient,
	table: &str,
	owner: ObjectId,
) -> Result<usize, String> {
	client
		.query(
			QueryBuilder::new(table)
				.filter_eq("owner", Value::Uuid(owner))
				.build(),
			None,
		)
		.await
		.map(|rows| rows.len())
		.map_err(|e| format!("{e:?}"))
}

pub(crate) async fn brain_ipc_status(
	app: &tauri::AppHandle,
	mj: &ManagedAvenDb,
	ss: &SelfState,
	identity: String,
) -> Result<serde_json::Value, String> {
	let client = with_connected_client(mj, app, ss).await?;
	let shell = super::avendb_shell_ready(app, mj, ss, client.clone()).await?;
	let (brain, owner) = brain_over(client.clone(), &shell, &identity)?;
	Ok(json!({
		"ready": true,
		"embedder": brain.embedder_name(),
		"embedDim": EMBED_DIM,
		"memories": owner_count(client.as_ref(), "memories", owner).await?,
		"entities": owner_count(client.as_ref(), "entities", owner).await?,
		"links": owner_count(client.as_ref(), "links", owner).await?,
	}))
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn brain_ipc_ingest(
	app: &tauri::AppHandle,
	mj: &ManagedAvenDb,
	ss: &SelfState,
	identity: String,
	content: String,
	stream: Option<String>,
	author_role: Option<String>,
	source: Option<String>,
	content_date_ms: Option<i64>,
	veracity: Option<String>,
) -> Result<serde_json::Value, String> {
	let client = with_connected_client(mj, app, ss).await?;
	let shell = super::avendb_shell_ready(app, mj, ss, client.clone()).await?;
	let (brain, _) = brain_over(client, &shell, &identity)?;
	let opts = RememberOptions {
		stream: stream.unwrap_or_else(|| "talk".to_string()),
		author_role: author_role.unwrap_or_else(|| "user".to_string()),
		source,
		content_date_ms,
		veracity,
		..Default::default()
	};
	let id = brain
		.remember_with(&content, &opts)
		.await
		.map_err(|e| e.to_string())?;
	Ok(json!({ "id": id.uuid().to_string() }))
}

pub(crate) async fn brain_ipc_search(
	app: &tauri::AppHandle,
	mj: &ManagedAvenDb,
	ss: &SelfState,
	identity: String,
	query: String,
	k: usize,
	stream: Option<String>,
) -> Result<serde_json::Value, String> {
	let client = with_connected_client(mj, app, ss).await?;
	let shell = super::avendb_shell_ready(app, mj, ss, client.clone()).await?;
	let (brain, _) = brain_over(client, &shell, &identity)?;
	let filter = Filter {
		stream,
		..Default::default()
	};
	let hits = brain
		.search_traced(&query, k.clamp(1, 50), &filter)
		.await
		.map_err(|e| e.to_string())?;
	serde_json::to_value(hits).map_err(|e| e.to_string())
}

pub(crate) async fn brain_ipc_entities(
	app: &tauri::AppHandle,
	mj: &ManagedAvenDb,
	ss: &SelfState,
	identity: String,
) -> Result<serde_json::Value, String> {
	let client = with_connected_client(mj, app, ss).await?;
	let shell = super::avendb_shell_ready(app, mj, ss, client.clone()).await?;
	let (brain, _) = brain_over(client, &shell, &identity)?;
	let entities = brain.entities().await.map_err(|e| e.to_string())?;
	serde_json::to_value(entities).map_err(|e| e.to_string())
}

pub(crate) async fn brain_ipc_entity_card(
	app: &tauri::AppHandle,
	mj: &ManagedAvenDb,
	ss: &SelfState,
	identity: String,
	name: String,
) -> Result<serde_json::Value, String> {
	let client = with_connected_client(mj, app, ss).await?;
	let shell = super::avendb_shell_ready(app, mj, ss, client.clone()).await?;
	let (brain, _) = brain_over(client, &shell, &identity)?;
	let card = brain.entity_card(&name).await.map_err(|e| e.to_string())?;
	serde_json::to_value(card).map_err(|e| e.to_string())
}

pub(crate) async fn brain_ipc_assemble_context(
	app: &tauri::AppHandle,
	mj: &ManagedAvenDb,
	ss: &SelfState,
	identity: String,
	query: String,
	working_n: Option<usize>,
	recall_k: Option<usize>,
	budget_chars: Option<usize>,
	stream: Option<String>,
) -> Result<serde_json::Value, String> {
	let client = with_connected_client(mj, app, ss).await?;
	let shell = super::avendb_shell_ready(app, mj, ss, client.clone()).await?;
	let (brain, _) = brain_over(client, &shell, &identity)?;
	let mut opts = ContextOptions::default();
	if let Some(n) = working_n {
		opts.working_n = n.clamp(1, 32);
	}
	if let Some(k) = recall_k {
		opts.recall_k = k.clamp(1, 24);
	}
	if let Some(b) = budget_chars {
		opts.budget_chars = b.clamp(500, 64_000);
	}
	opts.filter = Filter {
		stream: Some(stream.unwrap_or_else(|| "talk".to_string())),
		..Default::default()
	};
	let bundle = brain
		.assemble_context(&query, &opts)
		.await
		.map_err(|e| e.to_string())?;
	serde_json::to_value(bundle).map_err(|e| e.to_string())
}

/// One-shot backfill: ingest this identity's existing `messages` history into the
/// brain (idempotent — `content_hash` dedups re-runs). Bodies are read through the
/// shell's hydration (sealed columns opened with the identity DEK).
pub(crate) async fn brain_ipc_backfill(
	app: &tauri::AppHandle,
	mj: &ManagedAvenDb,
	ss: &SelfState,
	identity: String,
) -> Result<serde_json::Value, String> {
	let client = with_connected_client(mj, app, ss).await?;
	let shell = super::avendb_shell_ready(app, mj, ss, client.clone()).await?;
	let (rows, _skipped) =
		engine::query_table_publish(client.as_ref(), &shell, "messages", ENCRYPTED_META).await?;

	let (brain, _) = brain_over(client, &shell, &identity)?;
	let ident_norm = identity.trim().to_ascii_lowercase();
	let mut scanned = 0usize;
	let mut ingested = 0usize;
	for row in rows {
		let owner = row
			.get("owner")
			.and_then(|v| v.as_str())
			.unwrap_or_default()
			.to_ascii_lowercase();
		if owner != ident_norm {
			continue;
		}
		let Some(body) = row.get("body").and_then(|v| v.as_str()) else {
			continue;
		};
		if body.trim().is_empty() {
			continue;
		}
		scanned += 1;
		let role = row
			.get("role")
			.and_then(|v| v.as_str())
			.unwrap_or("user")
			.to_string();
		let source = row.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
		let content_date_ms = row.get("created_at_ms").and_then(|v| v.as_i64());
		let opts = RememberOptions {
			stream: "talk".to_string(),
			author_role: role.clone(),
			source,
			content_date_ms,
			veracity: Some(if role == "agent" { "inferred" } else { "stated" }.to_string()),
			..Default::default()
		};
		if brain.remember_with(body, &opts).await.is_ok() {
			ingested += 1;
		}
	}
	Ok(json!({ "scanned": scanned, "ingested": ingested }))
}

pub(crate) async fn brain_ipc_dream(
	app: &tauri::AppHandle,
	mj: &ManagedAvenDb,
	ss: &SelfState,
	identity: String,
) -> Result<serde_json::Value, String> {
	let client = with_connected_client(mj, app, ss).await?;
	let shell = super::avendb_shell_ready(app, mj, ss, client.clone()).await?;
	let (brain, _) = brain_over(client, &shell, &identity)?;
	let report = brain.dream().await.map_err(|e| e.to_string())?;
	serde_json::to_value(report).map_err(|e| e.to_string())
}

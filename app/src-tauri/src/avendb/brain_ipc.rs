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

use aven_brain::{
	Brain, ContextOptions, Embedder, Filter, KeySealer, RememberOptions, StubEmbedder, EMBED_DIM,
};
use aven_db::{AvenDbClient, ObjectId, QueryBuilder, Value};
use serde_json::json;
use tauri_plugin_self::state::SelfState;
use uuid::Uuid;

use super::conn::{with_connected_client, ManagedAvenDb, ENCRYPTED_META};
use super::engine;

/// The app's brain embedder: EmbeddingGemma-300m when the `brain-gemma` feature is on
/// AND the model + onnxruntime dylib are present; otherwise the deterministic stub.
/// Enum dispatch because [`Embedder`] uses `async fn` (not dyn-safe).
pub(crate) enum AppEmbedder {
	Stub(StubEmbedder),
	#[cfg(feature = "brain-gemma")]
	Gemma(Arc<aven_brain::GemmaEmbedder>),
}

impl Embedder for AppEmbedder {
	fn dim(&self) -> usize {
		match self {
			AppEmbedder::Stub(e) => e.dim(),
			#[cfg(feature = "brain-gemma")]
			AppEmbedder::Gemma(e) => e.dim(),
		}
	}

	async fn embed(&self, text: &str) -> Vec<f32> {
		match self {
			AppEmbedder::Stub(e) => e.embed(text).await,
			#[cfg(feature = "brain-gemma")]
			AppEmbedder::Gemma(e) => e.embed(text).await,
		}
	}

	fn name(&self) -> &'static str {
		match self {
			AppEmbedder::Stub(e) => e.name(),
			#[cfg(feature = "brain-gemma")]
			AppEmbedder::Gemma(e) => e.name(),
		}
	}
}

/// Resolve the bundled onnxruntime dylib (same lookup as the llm/tts paths):
/// `AVENOS_ORT_DYLIB` env → app resources → models dir.
#[cfg(feature = "brain-gemma")]
fn resolve_ort_dylib(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
	use tauri::Manager;
	if let Ok(p) = std::env::var("AVENOS_ORT_DYLIB") {
		let p = std::path::PathBuf::from(p);
		if p.is_file() {
			return Ok(p);
		}
	}
	let name = if cfg!(target_os = "windows") {
		"onnxruntime.dll"
	} else {
		"libonnxruntime.dylib"
	};
	if let Ok(res) = app.path().resource_dir() {
		let p = res.join("onnxruntime").join(name);
		if p.is_file() {
			return Ok(p);
		}
	}
	let models = tauri_plugin_self::paths::models_dir(app)?;
	let p = models.join("onnxruntime").join(name);
	if p.is_file() {
		return Ok(p);
	}
	Err(format!("onnxruntime dylib not found ({})", p.display()))
}

/// Lazily load EmbeddingGemma once per process (blocking mmap on a worker thread).
/// Any failure (missing weights / dylib) logs once and falls back to the stub —
/// observable via `brain_status.embedder`.
#[cfg(feature = "brain-gemma")]
async fn gemma_embedder(app: &tauri::AppHandle) -> Option<Arc<aven_brain::GemmaEmbedder>> {
	use tokio::sync::OnceCell;
	static GEMMA: OnceCell<Option<Arc<aven_brain::GemmaEmbedder>>> = OnceCell::const_new();
	let app = app.clone();
	GEMMA
		.get_or_init(|| async move {
			let models = match tauri_plugin_self::paths::models_dir(&app) {
				Ok(p) => p,
				Err(e) => {
					log::warn!(target: "avenos::brain", "gemma: models dir: {e}");
					return None;
				}
			};
			let dylib = match resolve_ort_dylib(&app) {
				Ok(p) => p,
				Err(e) => {
					log::warn!(target: "avenos::brain", "gemma: {e} → stub embedder");
					return None;
				}
			};
			match tokio::task::spawn_blocking(move || {
				aven_brain::GemmaEmbedder::load(&models, &dylib)
			})
			.await
			{
				Ok(Ok(e)) => {
					log::info!(target: "avenos::brain", "EmbeddingGemma loaded (dim {})", e.dim());
					Some(Arc::new(e))
				}
				Ok(Err(e)) => {
					log::warn!(target: "avenos::brain", "gemma load failed → stub: {e}");
					None
				}
				Err(e) => {
					log::warn!(target: "avenos::brain", "gemma load join error → stub: {e}");
					None
				}
			}
		})
		.await
		.clone()
}

/// Pick the best available embedder for this process. NOTE: all devices of an
/// identity must embed with one model — mixed stub/gemma stores degrade recall
/// across the boundary (re-embed pass = the E7 maintenance item).
async fn app_embedder(app: &tauri::AppHandle) -> AppEmbedder {
	#[cfg(feature = "brain-gemma")]
	if let Some(g) = gemma_embedder(app).await {
		return AppEmbedder::Gemma(g);
	}
	let _ = app;
	AppEmbedder::Stub(StubEmbedder::new(EMBED_DIM))
}

/// Wrap the shared connected client as `identity`'s brain (EmbeddingGemma when
/// available, stub otherwise), sealed with the identity's current DEK — no DEK,
/// no brain (fail closed: a brain that cannot seal must not write plaintext).
async fn brain_over(
	app: &tauri::AppHandle,
	client: Arc<AvenDbClient>,
	shell: &engine::ShellState,
	identity: &str,
) -> Result<(Brain<AppEmbedder>, ObjectId), String> {
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
		Brain::over(client, owner, app_embedder(app).await, sealer),
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
	let (brain, owner) = brain_over(app, client.clone(), &shell, &identity).await?;
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
	let (brain, _) = brain_over(app, client, &shell, &identity).await?;
	let opts = RememberOptions {
		stream: stream.unwrap_or_else(|| "talk".to_string()),
		author_role: author_role.unwrap_or_else(|| "user".to_string()),
		source,
		content_date_ms,
		veracity,
		..Default::default()
	};
	// Chunk long pastes (match reports, articles) into passage-sized memories so recall can
	// surface the specific relevant passage; short content stays one memory. The first chunk is
	// the primary id surfaced to the roundtrip aside.
	let ids = brain
		.remember_chunked(&content, &opts)
		.await
		.map_err(|e| e.to_string())?;
	let primary = ids
		.first()
		.map(|id| id.uuid().to_string())
		.unwrap_or_default();
	Ok(json!({ "id": primary, "chunks": ids.len() }))
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
	let (brain, _) = brain_over(app, client, &shell, &identity).await?;
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
	let (brain, _) = brain_over(app, client, &shell, &identity).await?;
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
	let (brain, _) = brain_over(app, client, &shell, &identity).await?;
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
	let (brain, _) = brain_over(app, client, &shell, &identity).await?;
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

	let (brain, _) = brain_over(app, client, &shell, &identity).await?;
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

pub(crate) async fn brain_ipc_reembed(
	app: &tauri::AppHandle,
	mj: &ManagedAvenDb,
	ss: &SelfState,
	identity: String,
) -> Result<serde_json::Value, String> {
	let client = with_connected_client(mj, app, ss).await?;
	let shell = super::avendb_shell_ready(app, mj, ss, client.clone()).await?;
	let (brain, _) = brain_over(app, client, &shell, &identity).await?;
	let n = brain.re_embed_all().await.map_err(|e| e.to_string())?;
	Ok(json!({ "reembedded": n, "embedder": brain.embedder_name() }))
}

pub(crate) async fn brain_ipc_dream(
	app: &tauri::AppHandle,
	mj: &ManagedAvenDb,
	ss: &SelfState,
	identity: String,
) -> Result<serde_json::Value, String> {
	let client = with_connected_client(mj, app, ss).await?;
	let shell = super::avendb_shell_ready(app, mj, ss, client.clone()).await?;
	let (brain, _) = brain_over(app, client, &shell, &identity).await?;
	let report = brain.dream().await.map_err(|e| e.to_string())?;
	serde_json::to_value(report).map_err(|e| e.to_string())
}

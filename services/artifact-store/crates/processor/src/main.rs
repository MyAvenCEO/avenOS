use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use aven_artifact_processor::{
    ArtifactStoreClient, ProcessingEngine, ProcessingRepository, VisionAdapter,
};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use axum::{Json, Router};
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::{Mutex, RwLock};
use tokio::time::MissedTickBehavior;
use tracing::{error, info, warn};
use uuid::Uuid;

const DATABASE_HEADER: &str = "x-aven-artifact-database";

#[derive(Clone)]
struct FixedApiState {
    repository: ProcessingRepository,
    store: ArtifactStoreClient,
    scope_id: Uuid,
    bearer_tokens: Arc<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TenantBinding {
    #[serde(rename = "environmentId")]
    _environment_id: String,
    database_name: String,
    scope_id: Uuid,
}

struct TenantRuntime {
    repository: ProcessingRepository,
    engine: ProcessingEngine,
}

struct DirectoryState {
    bindings: BTreeMap<Uuid, TenantBinding>,
    unchecked_tenants: BTreeSet<Uuid>,
    tenant_errors: BTreeMap<Uuid, String>,
    last_success: Instant,
    last_error: Option<String>,
}

struct TenantSupervisor {
    client: Client,
    directory_url: String,
    directory_token: String,
    cluster_database_url: String,
    store_base_url: String,
    store_bearer_token: String,
    connections_per_tenant: u32,
    max_tenant_pools: usize,
    refresh_interval: Duration,
    vision: Option<VisionAdapter>,
    directory: RwLock<DirectoryState>,
    runtimes: Mutex<BTreeMap<Uuid, Arc<TenantRuntime>>>,
    next_tenant: AtomicUsize,
}

#[derive(Clone)]
struct TenantApiState {
    supervisor: Arc<TenantSupervisor>,
    bearer_tokens: Arc<Vec<String>>,
}

#[derive(Clone)]
struct ProvisionerState {
    cluster_database_url: String,
    runtime_role: String,
    bearer_token: Arc<str>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "aven_artifact_processor=info,tower_http=info".into()),
        )
        .init();
    let command = env::args().nth(1).unwrap_or_else(|| "serve".into());
    match command.as_str() {
        "migrate" => migrate().await?,
        "serve" | "serve-mocks" if env_bool("ARTIFACT_PROCESSOR_TENANT_MODE") => {
            serve_tenants().await?;
        }
        "serve" | "serve-mocks" => serve_fixed().await?,
        "serve-provisioner" => serve_provisioner().await?,
        "drain" | "drain-mocks" => drain().await?,
        _ => return Err(format!("unknown command {command}").into()),
    }
    Ok(())
}

async fn migrate() -> Result<(), Box<dyn std::error::Error>> {
    let repository =
        ProcessingRepository::connect(&required("ARTIFACT_PROCESSOR_DATABASE_URL")?, 2).await?;
    repository
        .migrate(&required("ARTIFACT_PROCESSOR_RUNTIME_ROLE")?)
        .await?;
    if let Ok(scope) = env::var("ARTIFACT_PROCESSOR_SCOPE_ID") {
        repository.ensure_scope(scope.parse()?).await?;
    }
    info!("artifact processing schema is current");
    Ok(())
}

async fn fixed_runtime() -> Result<
    (
        ProcessingRepository,
        ArtifactStoreClient,
        ProcessingEngine,
        Uuid,
    ),
    Box<dyn std::error::Error>,
> {
    let repository =
        ProcessingRepository::connect(&required("ARTIFACT_PROCESSOR_DATABASE_URL")?, 4).await?;
    let scope_id = required("ARTIFACT_PROCESSOR_SCOPE_ID")?.parse()?;
    let store = ArtifactStoreClient::new(
        &required("ARTIFACT_STORE_BASE_URL")?,
        &required("ARTIFACT_STORE_BEARER_TOKEN")?,
        &required("ARTIFACT_STORE_DATABASE_NAME")?,
    );
    let engine = ProcessingEngine::new(repository.clone(), store.clone(), scope_id)
        .with_vision_adapter(VisionAdapter::from_env()?);
    Ok((repository, store, engine, scope_id))
}

async fn drain() -> Result<(), Box<dyn std::error::Error>> {
    let (repository, _, engine, _) = fixed_runtime().await?;
    repository.ready().await?;
    let ticks = engine.drain(1_000).await?;
    info!(ticks, "artifact processing queue drained");
    Ok(())
}

async fn serve_fixed() -> Result<(), Box<dyn std::error::Error>> {
    let (repository, store, engine, scope_id) = fixed_runtime().await?;
    repository.ready().await?;
    let state = FixedApiState {
        repository,
        store,
        scope_id,
        bearer_tokens: runtime_bearer_tokens()?.into(),
    };
    let app = Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(fixed_ready))
        .route(
            "/v1/scopes/{scope_id}/artifacts/{artifact_id}/processing",
            get(fixed_status),
        )
        .with_state(state);
    tokio::spawn(run_fixed_engine(engine));
    let listen = listen("ARTIFACT_PROCESSOR_LISTEN", "0.0.0.0:8089")?;
    let listener = tokio::net::TcpListener::bind(listen).await?;
    info!(%listen, %scope_id, "artifact processor listening in fixed-tenant mode");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn run_fixed_engine(engine: ProcessingEngine) {
    let mut interval = tokio::time::interval(Duration::from_millis(200));
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        if let Err(error) = engine.tick().await {
            error!(error = %error, "artifact processing tick failed");
        }
    }
}

async fn serve_tenants() -> Result<(), Box<dyn std::error::Error>> {
    let refresh_interval =
        Duration::from_secs(env_u64("ARTIFACT_PROCESSOR_TENANT_REFRESH_SECONDS", 30)?);
    let supervisor = Arc::new(TenantSupervisor {
        client: Client::builder().timeout(Duration::from_secs(10)).build()?,
        directory_url: required("ARTIFACT_PROCESSOR_DIRECTORY_URL")?,
        directory_token: validated_secret("ARTIFACT_PROCESSOR_DIRECTORY_BEARER_TOKEN")?,
        cluster_database_url: required("ARTIFACT_PROCESSOR_DATABASE_URL")?,
        store_base_url: required("ARTIFACT_STORE_BASE_URL")?,
        store_bearer_token: required("ARTIFACT_STORE_BEARER_TOKEN")?,
        connections_per_tenant: env_u32("ARTIFACT_PROCESSOR_CONNECTIONS_PER_TENANT", 2)?,
        max_tenant_pools: env_usize("ARTIFACT_PROCESSOR_MAX_TENANT_POOLS", 64)?,
        refresh_interval,
        vision: VisionAdapter::from_env()?,
        directory: RwLock::new(DirectoryState {
            bindings: BTreeMap::new(),
            unchecked_tenants: BTreeSet::new(),
            tenant_errors: BTreeMap::new(),
            last_success: Instant::now(),
            last_error: None,
        }),
        runtimes: Mutex::new(BTreeMap::new()),
        next_tenant: AtomicUsize::new(0),
    });
    supervisor
        .refresh_directory()
        .await
        .map_err(|error| error.to_string())?;

    let state = TenantApiState {
        supervisor: supervisor.clone(),
        bearer_tokens: runtime_bearer_tokens()?.into(),
    };
    let app = Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(tenant_ready))
        .route(
            "/v1/scopes/{scope_id}/artifacts/{artifact_id}/processing",
            get(tenant_status),
        )
        .with_state(state);
    tokio::spawn(supervisor_loop(supervisor));
    let listen = listen("ARTIFACT_PROCESSOR_LISTEN", "0.0.0.0:8089")?;
    let listener = tokio::net::TcpListener::bind(listen).await?;
    info!(%listen, "artifact processor listening in tenant mode");
    axum::serve(listener, app).await?;
    Ok(())
}

impl TenantSupervisor {
    async fn refresh_directory(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let response = self
            .client
            .get(&self.directory_url)
            .bearer_auth(&self.directory_token)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(format!("tenant directory returned HTTP {}", response.status()).into());
        }
        let bindings: Vec<TenantBinding> = response.json().await?;
        let mut next = BTreeMap::new();
        for binding in bindings {
            validate_database_name(&binding.database_name)?;
            if next.insert(binding.scope_id, binding).is_some() {
                return Err("tenant directory returned a duplicate scope".into());
            }
        }
        let active = next.keys().copied().collect::<Vec<_>>();
        {
            let mut directory = self.directory.write().await;
            let previously_active = directory.bindings.keys().copied().collect::<BTreeSet<_>>();
            directory
                .unchecked_tenants
                .retain(|scope| active.contains(scope));
            directory
                .tenant_errors
                .retain(|scope, _| active.contains(scope));
            directory.unchecked_tenants.extend(
                active
                    .iter()
                    .copied()
                    .filter(|scope| !previously_active.contains(scope)),
            );
            directory.bindings = next;
            directory.last_success = Instant::now();
            directory.last_error = None;
        }
        self.runtimes
            .lock()
            .await
            .retain(|scope, _| active.contains(scope));
        Ok(())
    }

    async fn runtime_for(
        &self,
        binding: &TenantBinding,
    ) -> Result<Arc<TenantRuntime>, Box<dyn std::error::Error + Send + Sync>> {
        if let Some(runtime) = self.runtimes.lock().await.get(&binding.scope_id).cloned() {
            return Ok(runtime);
        }
        let database_url = tenant_database_url(&self.cluster_database_url, &binding.database_name)?;
        let repository =
            ProcessingRepository::connect(&database_url, self.connections_per_tenant).await?;
        repository.ready().await?;
        if !repository.has_scope(binding.scope_id).await? {
            return Err("processor scope is not provisioned in the selected database".into());
        }
        let store = ArtifactStoreClient::new(
            &self.store_base_url,
            &self.store_bearer_token,
            &binding.database_name,
        );
        store.context().await?;
        let runtime = Arc::new(TenantRuntime {
            engine: ProcessingEngine::new(repository.clone(), store, binding.scope_id)
                .with_vision_adapter(self.vision.clone()),
            repository,
        });
        let mut runtimes = self.runtimes.lock().await;
        if runtimes.len() >= self.max_tenant_pools {
            if let Some(scope) = runtimes.keys().next().copied() {
                runtimes.remove(&scope);
            }
        }
        runtimes.insert(binding.scope_id, runtime.clone());
        Ok(runtime)
    }

    async fn binding(&self, scope_id: Uuid, database_name: &str) -> Option<TenantBinding> {
        self.directory
            .read()
            .await
            .bindings
            .get(&scope_id)
            .filter(|binding| binding.database_name == database_name)
            .cloned()
    }

    async fn tick_one(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let bindings = self
            .directory
            .read()
            .await
            .bindings
            .values()
            .cloned()
            .collect::<Vec<_>>();
        if bindings.is_empty() {
            return Ok(());
        }
        let index = self.next_tenant.fetch_add(1, Ordering::Relaxed) % bindings.len();
        let binding = &bindings[index];
        let result = async {
            let runtime = self.runtime_for(binding).await?;
            {
                let mut directory = self.directory.write().await;
                directory.unchecked_tenants.remove(&binding.scope_id);
            }
            runtime.engine.tick().await?;
            Ok::<_, Box<dyn std::error::Error + Send + Sync>>(())
        }
        .await;
        let mut directory = self.directory.write().await;
        match result {
            Ok(()) => {
                directory.tenant_errors.remove(&binding.scope_id);
                Ok(())
            }
            Err(error) => {
                directory
                    .tenant_errors
                    .insert(binding.scope_id, error.to_string());
                Err(error)
            }
        }
    }
}

async fn supervisor_loop(supervisor: Arc<TenantSupervisor>) {
    let mut tick = tokio::time::interval(Duration::from_millis(200));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut refresh = tokio::time::interval(supervisor.refresh_interval);
    refresh.set_missed_tick_behavior(MissedTickBehavior::Skip);
    refresh.tick().await;
    loop {
        tokio::select! {
            _ = refresh.tick() => {
                if let Err(error) = supervisor.refresh_directory().await {
                    warn!(%error, "artifact processor tenant directory refresh failed");
                    supervisor.directory.write().await.last_error = Some(error.to_string());
                }
            }
            _ = tick.tick() => {
                if let Err(error) = supervisor.tick_one().await {
                    error!(%error, "artifact processor tenant tick failed");
                }
            }
        }
    }
}

async fn serve_provisioner() -> Result<(), Box<dyn std::error::Error>> {
    let state = ProvisionerState {
        cluster_database_url: required("ARTIFACT_PROCESSOR_PROVISIONER_DATABASE_URL")?,
        runtime_role: required("ARTIFACT_PROCESSOR_RUNTIME_ROLE")?,
        bearer_token: validated_secret("ARTIFACT_PROCESSOR_PROVISIONER_BEARER_TOKEN")?.into(),
    };
    let app = Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(provisioner_ready))
        .route(
            "/internal/v1/databases/{database_name}/scopes/{scope_id}",
            put(provision_scope),
        )
        .with_state(state);
    let listen = listen("ARTIFACT_PROCESSOR_PROVISIONER_LISTEN", "0.0.0.0:8090")?;
    let listener = tokio::net::TcpListener::bind(listen).await?;
    info!(%listen, "artifact processor provisioner listening");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn live() -> Json<serde_json::Value> {
    Json(json!({ "status": "live" }))
}

async fn fixed_ready(State(state): State<FixedApiState>) -> Response {
    match (state.repository.ready().await, state.store.context().await) {
        (Ok(()), Ok(_)) => Json(json!({ "status": "ready" })).into_response(),
        _ => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "not-ready" })),
        )
            .into_response(),
    }
}

async fn tenant_ready(State(state): State<TenantApiState>) -> Response {
    let directory = state.supervisor.directory.read().await;
    let fresh =
        directory.last_success.elapsed() <= state.supervisor.refresh_interval.saturating_mul(3);
    let ready =
        fresh && directory.unchecked_tenants.is_empty() && directory.tenant_errors.is_empty();
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        status,
        Json(json!({
            "status": if ready { "ready" } else { "not-ready" },
            "tenantCount": directory.bindings.len(),
            "uncheckedTenantCount": directory.unchecked_tenants.len(),
            "failedTenantCount": directory.tenant_errors.len(),
            "directoryError": directory.last_error,
        })),
    )
        .into_response()
}

async fn fixed_status(
    State(state): State<FixedApiState>,
    Path((scope_id, artifact_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Response {
    if !authorized_any(&headers, &state.bearer_tokens) {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    if scope_id != state.scope_id {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }
    status_response(&state.repository, scope_id, artifact_id).await
}

async fn tenant_status(
    State(state): State<TenantApiState>,
    Path((scope_id, artifact_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Response {
    if !authorized_any(&headers, &state.bearer_tokens) {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    let Some(database_name) = headers
        .get(DATABASE_HEADER)
        .and_then(|value| value.to_str().ok())
    else {
        return (
            StatusCode::BAD_REQUEST,
            "database routing header is required",
        )
            .into_response();
    };
    let Some(binding) = state.supervisor.binding(scope_id, database_name).await else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    match state.supervisor.runtime_for(&binding).await {
        Ok(runtime) => status_response(&runtime.repository, scope_id, artifact_id).await,
        Err(error) => {
            error!(%error, %scope_id, "processing status tenant resolution failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "processing tenant unavailable",
            )
                .into_response()
        }
    }
}

async fn status_response(
    repository: &ProcessingRepository,
    scope_id: Uuid,
    artifact_id: Uuid,
) -> Response {
    match repository.status(scope_id, artifact_id).await {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, "processing case not found").into_response(),
        Err(error) => {
            error!(%error, "processing status lookup failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "processing status unavailable",
            )
                .into_response()
        }
    }
}

async fn provisioner_ready(State(state): State<ProvisionerState>) -> Response {
    match ProcessingRepository::connect(&state.cluster_database_url, 1).await {
        Ok(_) => Json(json!({ "status": "ready" })).into_response(),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "not-ready" })),
        )
            .into_response(),
    }
}

async fn provision_scope(
    State(state): State<ProvisionerState>,
    headers: HeaderMap,
    Path((database_name, scope_id)): Path<(String, Uuid)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !authorized(&headers, &state.bearer_token) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    if validate_database_name(&database_name).is_err() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let result = provision_processor_scope(&state, &database_name, scope_id).await;
    match result {
        Ok(()) => Ok(Json(json!({
            "status": "ready",
            "schemaVersion": 5,
            "scopeId": scope_id
        }))),
        Err(error) => {
            error!(%error, %database_name, %scope_id, "artifact processor provisioning failed");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn provision_processor_scope(
    state: &ProvisionerState,
    database_name: &str,
    scope_id: Uuid,
) -> Result<(), String> {
    let url = tenant_database_url(&state.cluster_database_url, database_name)
        .map_err(|error| error.to_string())?;
    let repository = ProcessingRepository::connect(&url, 2)
        .await
        .map_err(|error| error.to_string())?;
    repository
        .migrate(&state.runtime_role)
        .await
        .map_err(|error| error.to_string())?;
    repository
        .ensure_scope(scope_id)
        .await
        .map_err(|error| error.to_string())?;
    repository
        .ready()
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn authorized(headers: &HeaderMap, token: &str) -> bool {
    let expected = format!("Bearer {token}");
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        == Some(expected.as_str())
}

fn authorized_any(headers: &HeaderMap, tokens: &[String]) -> bool {
    let Some(value) = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return false;
    };
    tokens.iter().any(|token| token == value)
}

fn runtime_bearer_tokens() -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let primary = validated_secret("ARTIFACT_PROCESSOR_BEARER_TOKEN")?;
    let intent_service = validated_secret("INTENT_SERVICE_PROCESSOR_BEARER_TOKEN")?;
    if primary == intent_service {
        return Err("processor API and intent-service credentials must differ".into());
    }
    Ok(vec![primary, intent_service])
}

fn tenant_database_url(
    cluster_url: &str,
    database_name: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    validate_database_name(database_name)?;
    let mut url = reqwest::Url::parse(cluster_url)?;
    url.set_path(&format!("/{database_name}"));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.to_string())
}

fn validate_database_name(value: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if value.len() > 63
        || !value.starts_with("cust_")
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err("invalid customer database name".into());
    }
    Ok(())
}

fn validated_secret(name: &str) -> Result<String, Box<dyn std::error::Error>> {
    let value = required(name)?;
    if !(32..=128).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err(format!("{name} must be 32-128 URL-safe characters").into());
    }
    Ok(value)
}

fn required(name: &str) -> Result<String, Box<dyn std::error::Error>> {
    env::var(name).map_err(|_| format!("required environment variable {name} is missing").into())
}

fn env_bool(name: &str) -> bool {
    env::var(name).is_ok_and(|value| value == "true")
}

fn env_u64(name: &str, default: u64) -> Result<u64, Box<dyn std::error::Error>> {
    let value = env::var(name).map_or(Ok(default), |value| value.parse())?;
    if value == 0 {
        return Err(format!("{name} must be a positive integer").into());
    }
    Ok(value)
}

fn env_u32(name: &str, default: u32) -> Result<u32, Box<dyn std::error::Error>> {
    let value = env_u64(name, u64::from(default))?;
    u32::try_from(value).map_err(|_| format!("{name} is too large").into())
}

fn env_usize(name: &str, default: usize) -> Result<usize, Box<dyn std::error::Error>> {
    let value = env::var(name).map_or(Ok(default), |value| value.parse())?;
    if value == 0 {
        return Err(format!("{name} must be a positive integer").into());
    }
    Ok(value)
}

fn listen(name: &str, default: &str) -> Result<SocketAddr, Box<dyn std::error::Error>> {
    Ok(env::var(name).unwrap_or_else(|_| default.into()).parse()?)
}

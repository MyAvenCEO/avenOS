mod engine;
mod repository;
mod store;

use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use engine::IntentEngine;
use repository::{
    AppendContribution, CreateIntent, IntentRepository, MergeCommand, UpdateIntent, VersionCommand,
};
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use store::{ArtifactStoreClient, ProcessorClient};
use tokio::sync::{Mutex, RwLock};
use tokio::time::MissedTickBehavior;
use tracing::{error, info, warn};
use uuid::Uuid;

const DATABASE_HEADER: &str = "x-aven-artifact-database";

#[derive(Clone)]
enum ApiState {
    Fixed {
        repository: IntentRepository,
        store: ArtifactStoreClient,
        scope_id: Uuid,
        bearer_token: Arc<str>,
    },
    Tenant {
        supervisor: Arc<TenantSupervisor>,
        bearer_token: Arc<str>,
    },
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
    repository: IntentRepository,
    engine: IntentEngine,
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
    processor_base_url: String,
    processor_bearer_token: String,
    connections_per_tenant: u32,
    max_tenant_pools: usize,
    refresh_interval: Duration,
    directory: RwLock<DirectoryState>,
    runtimes: Mutex<BTreeMap<Uuid, Arc<TenantRuntime>>>,
    next_tenant: AtomicUsize,
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
                .unwrap_or_else(|_| "aven_intent_service=info".into()),
        )
        .init();
    match env::args().nth(1).as_deref().unwrap_or("serve") {
        "migrate" => migrate().await?,
        "serve" if env_bool("INTENT_SERVICE_TENANT_MODE") => serve_tenants().await?,
        "serve" => serve_fixed().await?,
        "serve-provisioner" => serve_provisioner().await?,
        command => return Err(format!("unknown command {command}").into()),
    }
    Ok(())
}

async fn migrate() -> Result<(), Box<dyn std::error::Error>> {
    let repository =
        IntentRepository::connect(&required("INTENT_SERVICE_DATABASE_URL")?, 2).await?;
    repository
        .migrate(&required("INTENT_SERVICE_RUNTIME_ROLE")?)
        .await?;
    if let Ok(scope) = env::var("INTENT_SERVICE_SCOPE_ID") {
        repository.ensure_scope(scope.parse()?).await?;
    }
    info!("intent schema is current");
    Ok(())
}

async fn serve_fixed() -> Result<(), Box<dyn std::error::Error>> {
    let repository =
        IntentRepository::connect(&required("INTENT_SERVICE_DATABASE_URL")?, 4).await?;
    repository.ready().await?;
    let scope_id = required("INTENT_SERVICE_SCOPE_ID")?.parse()?;
    let database_name = required("ARTIFACT_STORE_DATABASE_NAME")?;
    let store = ArtifactStoreClient::new(
        &required("ARTIFACT_STORE_BASE_URL")?,
        &required("ARTIFACT_STORE_BEARER_TOKEN")?,
        &database_name,
    )?;
    let engine = IntentEngine::new(
        repository.clone(),
        store.clone(),
        ProcessorClient::new(
            &required("ARTIFACT_PROCESSOR_BASE_URL")?,
            &required("INTENT_SERVICE_PROCESSOR_BEARER_TOKEN")?,
            &database_name,
        )?,
        scope_id,
    );
    let state = ApiState::Fixed {
        repository,
        store,
        scope_id,
        bearer_token: validated_secret("INTENT_SERVICE_BEARER_TOKEN")?.into(),
    };
    tokio::spawn(run_fixed_engine(engine));
    serve_api(state, "fixed-tenant").await
}

async fn serve_tenants() -> Result<(), Box<dyn std::error::Error>> {
    let refresh_interval =
        Duration::from_secs(env_u64("INTENT_SERVICE_TENANT_REFRESH_SECONDS", 30)?);
    let supervisor = Arc::new(TenantSupervisor {
        client: Client::builder().timeout(Duration::from_secs(10)).build()?,
        directory_url: required("INTENT_SERVICE_DIRECTORY_URL")?,
        directory_token: validated_secret("INTENT_SERVICE_DIRECTORY_BEARER_TOKEN")?,
        cluster_database_url: required("INTENT_SERVICE_DATABASE_URL")?,
        store_base_url: required("ARTIFACT_STORE_BASE_URL")?,
        store_bearer_token: validated_secret("ARTIFACT_STORE_BEARER_TOKEN")?,
        processor_base_url: required("ARTIFACT_PROCESSOR_BASE_URL")?,
        processor_bearer_token: validated_secret("INTENT_SERVICE_PROCESSOR_BEARER_TOKEN")?,
        connections_per_tenant: env_u32("INTENT_SERVICE_CONNECTIONS_PER_TENANT", 2)?,
        max_tenant_pools: env_usize("INTENT_SERVICE_MAX_TENANT_POOLS", 64)?,
        refresh_interval,
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
    let state = ApiState::Tenant {
        supervisor: supervisor.clone(),
        bearer_token: validated_secret("INTENT_SERVICE_BEARER_TOKEN")?.into(),
    };
    tokio::spawn(supervisor_loop(supervisor));
    serve_api(state, "multi-tenant").await
}

async fn serve_api(state: ApiState, mode: &str) -> Result<(), Box<dyn std::error::Error>> {
    let app = Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .route(
            "/v1/scopes/{scope_id}/intents",
            get(list_intents).post(create_intent),
        )
        .route(
            "/v1/scopes/{scope_id}/intents/{intent_id}",
            get(get_intent).patch(update_intent).delete(delete_intent),
        )
        .route(
            "/v1/scopes/{scope_id}/intents/{intent_id}/contributions",
            post(append_contribution),
        )
        .route(
            "/v1/scopes/{scope_id}/intents/{intent_id}/archive",
            post(archive_intent),
        )
        .route(
            "/v1/scopes/{scope_id}/intents/{intent_id}/restore",
            post(restore_intent),
        )
        .route(
            "/v1/scopes/{scope_id}/intents/{intent_id}/merge",
            post(merge_intents),
        )
        .with_state(state);
    let listen = listen("INTENT_SERVICE_LISTEN", "0.0.0.0:8091")?;
    let listener = tokio::net::TcpListener::bind(listen).await?;
    info!(%listen, %mode, "intent service listening");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn run_fixed_engine(engine: IntentEngine) {
    let mut interval = tokio::time::interval(Duration::from_millis(500));
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        if let Err(error) = engine.tick().await {
            error!(%error, "intent engine tick failed");
        }
    }
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
        let active = next.keys().copied().collect::<BTreeSet<_>>();
        {
            let mut directory = self.directory.write().await;
            let old = directory.bindings.keys().copied().collect::<BTreeSet<_>>();
            directory
                .unchecked_tenants
                .retain(|scope| active.contains(scope));
            directory
                .tenant_errors
                .retain(|scope, _| active.contains(scope));
            directory
                .unchecked_tenants
                .extend(active.difference(&old).copied());
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

    async fn binding(&self, scope_id: Uuid, database_name: &str) -> Option<TenantBinding> {
        self.directory
            .read()
            .await
            .bindings
            .get(&scope_id)
            .filter(|binding| binding.database_name == database_name)
            .cloned()
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
            IntentRepository::connect(&database_url, self.connections_per_tenant).await?;
        repository.ready().await?;
        if !repository.has_scope(binding.scope_id).await? {
            return Err("intent scope is not provisioned in the selected database".into());
        }
        let store = ArtifactStoreClient::new(
            &self.store_base_url,
            &self.store_bearer_token,
            &binding.database_name,
        )?;
        store.context().await?;
        let runtime = Arc::new(TenantRuntime {
            engine: IntentEngine::new(
                repository.clone(),
                store,
                ProcessorClient::new(
                    &self.processor_base_url,
                    &self.processor_bearer_token,
                    &binding.database_name,
                )?,
                binding.scope_id,
            ),
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
        let binding = &bindings[self.next_tenant.fetch_add(1, Ordering::Relaxed) % bindings.len()];
        let result = async {
            let runtime = self.runtime_for(binding).await?;
            self.directory
                .write()
                .await
                .unchecked_tenants
                .remove(&binding.scope_id);
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
    let mut tick = tokio::time::interval(Duration::from_millis(500));
    let mut refresh = tokio::time::interval(supervisor.refresh_interval);
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    refresh.set_missed_tick_behavior(MissedTickBehavior::Skip);
    refresh.tick().await;
    loop {
        tokio::select! {
            _ = refresh.tick() => if let Err(error) = supervisor.refresh_directory().await {
                warn!(%error, "intent tenant directory refresh failed");
                supervisor.directory.write().await.last_error = Some(error.to_string());
            },
            _ = tick.tick() => if let Err(error) = supervisor.tick_one().await {
                error!(%error, "intent tenant tick failed");
            },
        }
    }
}

async fn live() -> Json<serde_json::Value> {
    Json(json!({ "status": "live" }))
}

async fn ready(State(state): State<ApiState>) -> Response {
    match state {
        ApiState::Fixed {
            repository, store, ..
        } => match (repository.ready().await, store.context().await) {
            (Ok(()), Ok(_)) => Json(json!({ "status": "ready" })).into_response(),
            _ => (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "status": "not-ready" })),
            )
                .into_response(),
        },
        ApiState::Tenant { supervisor, .. } => {
            let directory = supervisor.directory.read().await;
            let fresh =
                directory.last_success.elapsed() <= supervisor.refresh_interval.saturating_mul(3);
            let is_ready = fresh
                && directory.unchecked_tenants.is_empty()
                && directory.tenant_errors.is_empty();
            (
                if is_ready {
                    StatusCode::OK
                } else {
                    StatusCode::SERVICE_UNAVAILABLE
                },
                Json(json!({
                    "status": if is_ready { "ready" } else { "not-ready" },
                    "tenantCount": directory.bindings.len(),
                    "uncheckedTenantCount": directory.unchecked_tenants.len(),
                    "failedTenantCount": directory.tenant_errors.len(),
                    "directoryError": directory.last_error,
                })),
            )
                .into_response()
        }
    }
}

async fn repository_for(
    state: &ApiState,
    scope_id: Uuid,
    headers: &HeaderMap,
) -> Result<IntentRepository, Response> {
    let token = match state {
        ApiState::Fixed { bearer_token, .. } | ApiState::Tenant { bearer_token, .. } => {
            bearer_token
        }
    };
    if !authorized(headers, token) {
        return Err((StatusCode::UNAUTHORIZED, "unauthorized").into_response());
    }
    match state {
        ApiState::Fixed {
            repository,
            scope_id: fixed_scope,
            ..
        } => {
            if scope_id == *fixed_scope {
                Ok(repository.clone())
            } else {
                Err((StatusCode::NOT_FOUND, "not found").into_response())
            }
        }
        ApiState::Tenant { supervisor, .. } => {
            let Some(database_name) = headers
                .get(DATABASE_HEADER)
                .and_then(|value| value.to_str().ok())
            else {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "database routing header is required",
                )
                    .into_response());
            };
            let Some(binding) = supervisor.binding(scope_id, database_name).await else {
                return Err((StatusCode::NOT_FOUND, "not found").into_response());
            };
            supervisor
                .runtime_for(&binding)
                .await
                .map(|runtime| runtime.repository.clone())
                .map_err(|error| {
                    error!(%error, %scope_id, "intent tenant resolution failed");
                    (StatusCode::SERVICE_UNAVAILABLE, "intent tenant unavailable").into_response()
                })
        }
    }
}

async fn list_intents(
    State(state): State<ApiState>,
    Path(scope_id): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    let repository = match repository_for(&state, scope_id, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    match repository.list(scope_id).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => internal(&error, "intent list unavailable"),
    }
}

async fn create_intent(
    State(state): State<ApiState>,
    Path(scope_id): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<CreateIntent>,
) -> Response {
    let repository = match repository_for(&state, scope_id, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    match repository.create(scope_id, &input).await {
        Ok(Some(value)) => (StatusCode::CREATED, Json(value)).into_response(),
        Ok(None) => (StatusCode::BAD_REQUEST, "invalid intent").into_response(),
        Err(error) => internal(&error, "intent creation unavailable"),
    }
}

async fn get_intent(
    State(state): State<ApiState>,
    Path((scope_id, intent_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Response {
    let repository = match repository_for(&state, scope_id, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    match repository.detail(scope_id, intent_id).await {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, "not found").into_response(),
        Err(error) => internal(&error, "intent unavailable"),
    }
}

async fn update_intent(
    State(state): State<ApiState>,
    Path((scope_id, intent_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(input): Json<UpdateIntent>,
) -> Response {
    let repository = match repository_for(&state, scope_id, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    mutation_response(
        repository.update(scope_id, intent_id, &input).await,
        &repository,
        scope_id,
        intent_id,
    )
    .await
}

async fn append_contribution(
    State(state): State<ApiState>,
    Path((scope_id, intent_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(input): Json<AppendContribution>,
) -> Response {
    let repository = match repository_for(&state, scope_id, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    match repository.append(scope_id, intent_id, &input).await {
        Ok(Some(value)) => (StatusCode::CREATED, Json(value)).into_response(),
        Ok(None) => (StatusCode::BAD_REQUEST, "invalid or unknown contribution").into_response(),
        Err(error) => internal(&error, "intent contribution unavailable"),
    }
}

async fn archive_intent(
    State(state): State<ApiState>,
    Path((scope_id, intent_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(input): Json<VersionCommand>,
) -> Response {
    lifecycle(state, scope_id, intent_id, headers, input, false).await
}

async fn restore_intent(
    State(state): State<ApiState>,
    Path((scope_id, intent_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(input): Json<VersionCommand>,
) -> Response {
    lifecycle(state, scope_id, intent_id, headers, input, true).await
}

async fn lifecycle(
    state: ApiState,
    scope_id: Uuid,
    intent_id: Uuid,
    headers: HeaderMap,
    input: VersionCommand,
    restore: bool,
) -> Response {
    if input.id != intent_id {
        return (StatusCode::BAD_REQUEST, "intent id mismatch").into_response();
    }
    let repository = match repository_for(&state, scope_id, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    mutation_response(
        repository
            .archive_or_restore(scope_id, intent_id, &input, restore)
            .await,
        &repository,
        scope_id,
        intent_id,
    )
    .await
}

async fn delete_intent(
    State(state): State<ApiState>,
    Path((scope_id, intent_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(input): Json<VersionCommand>,
) -> Response {
    let repository = match repository_for(&state, scope_id, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if input.id != intent_id {
        return (StatusCode::BAD_REQUEST, "intent id mismatch").into_response();
    }
    match repository.tombstone(scope_id, intent_id, &input).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (StatusCode::CONFLICT, "unknown intent or version conflict").into_response(),
        Err(error) => internal(&error, "intent deletion unavailable"),
    }
}

async fn merge_intents(
    State(state): State<ApiState>,
    Path((scope_id, intent_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(input): Json<MergeCommand>,
) -> Response {
    let repository = match repository_for(&state, scope_id, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    mutation_response(
        repository.merge(scope_id, intent_id, &input).await,
        &repository,
        scope_id,
        intent_id,
    )
    .await
}

async fn mutation_response(
    result: Result<bool, repository::RepositoryError>,
    repository: &IntentRepository,
    scope_id: Uuid,
    intent_id: Uuid,
) -> Response {
    match result {
        Ok(true) => match repository.detail(scope_id, intent_id).await {
            Ok(Some(value)) => Json(value).into_response(),
            Ok(None) => (StatusCode::NOT_FOUND, "not found").into_response(),
            Err(error) => internal(&error, "intent refresh unavailable"),
        },
        Ok(false) => (
            StatusCode::CONFLICT,
            "invalid transition or version conflict",
        )
            .into_response(),
        Err(error) => internal(&error, "intent mutation unavailable"),
    }
}

fn internal(error: &repository::RepositoryError, message: &'static str) -> Response {
    error!(%error, %message);
    (StatusCode::INTERNAL_SERVER_ERROR, message).into_response()
}

async fn serve_provisioner() -> Result<(), Box<dyn std::error::Error>> {
    let state = ProvisionerState {
        cluster_database_url: required("INTENT_SERVICE_PROVISIONER_DATABASE_URL")?,
        runtime_role: required("INTENT_SERVICE_RUNTIME_ROLE")?,
        bearer_token: validated_secret("INTENT_SERVICE_PROVISIONER_BEARER_TOKEN")?.into(),
    };
    let app = Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(provisioner_ready))
        .route(
            "/internal/v1/databases/{database_name}/scopes/{scope_id}",
            put(provision_scope),
        )
        .with_state(state);
    let listen = listen("INTENT_SERVICE_PROVISIONER_LISTEN", "0.0.0.0:8092")?;
    let listener = tokio::net::TcpListener::bind(listen).await?;
    info!(%listen, "intent provisioner listening");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn provisioner_ready(State(state): State<ProvisionerState>) -> Response {
    match IntentRepository::connect(&state.cluster_database_url, 1).await {
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
    let url = tenant_database_url(&state.cluster_database_url, &database_name)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let repository = IntentRepository::connect(&url, 2)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    repository
        .migrate(&state.runtime_role)
        .await
        .map_err(|error| {
            error!(%error, %database_name, "intent migration failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    repository
        .ensure_scope(scope_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    repository
        .ready()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        json!({ "status": "ready", "schemaVersion": 1, "scopeId": scope_id }),
    ))
}

fn authorized(headers: &HeaderMap, token: &str) -> bool {
    let expected = format!("Bearer {token}");
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        == Some(expected.as_str())
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
    u32::try_from(env_u64(name, u64::from(default))?)
        .map_err(|_| format!("{name} is too large").into())
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

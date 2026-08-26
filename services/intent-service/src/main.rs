mod engine;
mod repository;
mod store;

use std::env;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use aven_tenant_runtime::{
    authorized, env_bool, env_u32, env_u64, env_usize, listen, provisioner_router, required,
    routed_database, validated_secret, ManagedTenantRuntime, ProvisionerAdapter, ProvisionerConfig,
    RailResult, TenantBinding, TenantRuntimeFactory, TenantSupervisor, TenantSupervisorConfig,
};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use engine::IntentEngine;
use repository::{
    AppendContribution, CreateIntent, IntentRepository, MergeCommand, UpdateIntent, VersionCommand,
};
use serde_json::json;
use store::{ArtifactStoreClient, ProcessorClient};
use tokio::time::MissedTickBehavior;
use tracing::{error, info};
use uuid::Uuid;

const INTENT_SCHEMA_VERSION: u32 = 1;

#[derive(Clone)]
enum ApiState {
    Fixed {
        repository: IntentRepository,
        store: ArtifactStoreClient,
        scope_id: Uuid,
        bearer_token: Arc<str>,
    },
    Tenant {
        supervisor: Arc<IntentSupervisor>,
        bearer_token: Arc<str>,
    },
}

struct IntentTenantRuntime {
    repository: IntentRepository,
    engine: IntentEngine,
}

#[async_trait]
impl ManagedTenantRuntime for IntentTenantRuntime {
    async fn tick(&self) -> RailResult<()> {
        self.engine.tick().await?;
        Ok(())
    }
}

struct IntentRuntimeFactory {
    store_base_url: String,
    store_bearer_token: String,
    processor_base_url: String,
    processor_bearer_token: String,
    connections_per_tenant: u32,
}

#[derive(Clone)]
struct IntentProvisioner {
    runtime_role: String,
}

#[async_trait]
impl TenantRuntimeFactory for IntentRuntimeFactory {
    type Runtime = IntentTenantRuntime;

    async fn open(&self, binding: &TenantBinding, database_url: &str) -> RailResult<Self::Runtime> {
        let repository =
            IntentRepository::connect(database_url, self.connections_per_tenant).await?;
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
        Ok(IntentTenantRuntime {
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
        })
    }
}

#[async_trait]
impl ProvisionerAdapter for IntentProvisioner {
    fn component_name(&self) -> &'static str {
        "intent-service"
    }

    fn schema_version(&self) -> u32 {
        INTENT_SCHEMA_VERSION
    }

    async fn ready(&self, cluster_database_url: &str) -> RailResult<()> {
        IntentRepository::connect(cluster_database_url, 1).await?;
        Ok(())
    }

    async fn provision(&self, database_url: &str, scope_id: Uuid) -> RailResult<()> {
        let repository = IntentRepository::connect(database_url, 2).await?;
        repository.migrate(&self.runtime_role).await?;
        repository.ensure_scope(scope_id).await?;
        repository.ready().await?;
        Ok(())
    }
}

type IntentSupervisor = TenantSupervisor<IntentRuntimeFactory>;

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
    let factory = IntentRuntimeFactory {
        store_base_url: required("ARTIFACT_STORE_BASE_URL")?,
        store_bearer_token: validated_secret("ARTIFACT_STORE_BEARER_TOKEN")?,
        processor_base_url: required("ARTIFACT_PROCESSOR_BASE_URL")?,
        processor_bearer_token: validated_secret("INTENT_SERVICE_PROCESSOR_BEARER_TOKEN")?,
        connections_per_tenant: env_u32("INTENT_SERVICE_CONNECTIONS_PER_TENANT", 2)?,
    };
    let supervisor = Arc::new(
        TenantSupervisor::new(
            TenantSupervisorConfig {
                service_name: "intent-service",
                directory_url: required("INTENT_SERVICE_DIRECTORY_URL")?,
                directory_token: validated_secret("INTENT_SERVICE_DIRECTORY_BEARER_TOKEN")?,
                cluster_database_url: required("INTENT_SERVICE_DATABASE_URL")?,
                max_tenant_pools: env_usize("INTENT_SERVICE_MAX_TENANT_POOLS", 64)?,
                refresh_interval,
                tick_interval: Duration::from_millis(500),
            },
            factory,
        )
        .map_err(|error| error.to_string())?,
    );
    supervisor
        .refresh_directory()
        .await
        .map_err(|error| error.to_string())?;
    let state = ApiState::Tenant {
        supervisor: supervisor.clone(),
        bearer_token: validated_secret("INTENT_SERVICE_BEARER_TOKEN")?.into(),
    };
    tokio::spawn(supervisor.clone().run());
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
        ApiState::Tenant { supervisor, .. } => supervisor.readiness().await.into_response(),
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
            let Some(database_name) = routed_database(headers) else {
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
    let app = provisioner_router(
        ProvisionerConfig {
            cluster_database_url: required("INTENT_SERVICE_PROVISIONER_DATABASE_URL")?,
            bearer_token: validated_secret("INTENT_SERVICE_PROVISIONER_BEARER_TOKEN")?,
        },
        IntentProvisioner {
            runtime_role: required("INTENT_SERVICE_RUNTIME_ROLE")?,
        },
    )
    .map_err(|error| error.to_string())?;
    let listen = listen("INTENT_SERVICE_PROVISIONER_LISTEN", "0.0.0.0:8092")?;
    let listener = tokio::net::TcpListener::bind(listen).await?;
    info!(%listen, "intent provisioner listening");
    axum::serve(listener, app).await?;
    Ok(())
}

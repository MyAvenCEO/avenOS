use std::env;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use aven_artifact_processor::{
    ArtifactStoreClient, ProcessingEngine, ProcessingRepository, VisionAdapter,
};
use aven_tenant_runtime::{
    authorized_any, env_bool, env_u32, env_u64, env_usize, listen, provisioner_router, required,
    routed_database, validated_secret, ManagedTenantRuntime, ProvisionerAdapter, ProvisionerConfig,
    RailResult, TenantBinding, TenantRuntimeFactory, TenantSupervisor, TenantSupervisorConfig,
};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use tokio::time::MissedTickBehavior;
use tracing::{error, info};
use uuid::Uuid;

const PROCESSOR_SCHEMA_VERSION: u32 = 5;

#[derive(Clone)]
struct FixedApiState {
    repository: ProcessingRepository,
    store: ArtifactStoreClient,
    scope_id: Uuid,
    bearer_tokens: Arc<Vec<String>>,
}

struct ProcessorTenantRuntime {
    repository: ProcessingRepository,
    engine: ProcessingEngine,
}

#[async_trait]
impl ManagedTenantRuntime for ProcessorTenantRuntime {
    async fn tick(&self) -> RailResult<()> {
        self.engine.tick().await?;
        Ok(())
    }
}

struct ProcessorRuntimeFactory {
    store_base_url: String,
    store_bearer_token: String,
    connections_per_tenant: u32,
    vision: Option<VisionAdapter>,
}

#[async_trait]
impl TenantRuntimeFactory for ProcessorRuntimeFactory {
    type Runtime = ProcessorTenantRuntime;

    async fn open(&self, binding: &TenantBinding, database_url: &str) -> RailResult<Self::Runtime> {
        let repository =
            ProcessingRepository::connect(database_url, self.connections_per_tenant).await?;
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
        Ok(ProcessorTenantRuntime {
            engine: ProcessingEngine::new(repository.clone(), store, binding.scope_id)
                .with_vision_adapter(self.vision.clone()),
            repository,
        })
    }
}

#[derive(Clone)]
struct ProcessorProvisioner {
    runtime_role: String,
}

#[async_trait]
impl ProvisionerAdapter for ProcessorProvisioner {
    fn component_name(&self) -> &'static str {
        "artifact-processor"
    }

    fn schema_version(&self) -> u32 {
        PROCESSOR_SCHEMA_VERSION
    }

    async fn ready(&self, cluster_database_url: &str) -> RailResult<()> {
        ProcessingRepository::connect(cluster_database_url, 1).await?;
        Ok(())
    }

    async fn provision(&self, database_url: &str, scope_id: Uuid) -> RailResult<()> {
        let repository = ProcessingRepository::connect(database_url, 2).await?;
        repository.migrate(&self.runtime_role).await?;
        repository.ensure_scope(scope_id).await?;
        repository.ready().await?;
        Ok(())
    }
}

type ProcessorSupervisor = TenantSupervisor<ProcessorRuntimeFactory>;

#[derive(Clone)]
struct TenantApiState {
    supervisor: Arc<ProcessorSupervisor>,
    bearer_tokens: Arc<Vec<String>>,
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
    let factory = ProcessorRuntimeFactory {
        store_base_url: required("ARTIFACT_STORE_BASE_URL")?,
        store_bearer_token: required("ARTIFACT_STORE_BEARER_TOKEN")?,
        connections_per_tenant: env_u32("ARTIFACT_PROCESSOR_CONNECTIONS_PER_TENANT", 2)?,
        vision: VisionAdapter::from_env()?,
    };
    let supervisor = Arc::new(
        TenantSupervisor::new(
            TenantSupervisorConfig {
                service_name: "artifact-processor",
                directory_url: required("ARTIFACT_PROCESSOR_DIRECTORY_URL")?,
                directory_token: validated_secret("ARTIFACT_PROCESSOR_DIRECTORY_BEARER_TOKEN")?,
                cluster_database_url: required("ARTIFACT_PROCESSOR_DATABASE_URL")?,
                max_tenant_pools: env_usize("ARTIFACT_PROCESSOR_MAX_TENANT_POOLS", 64)?,
                refresh_interval,
                tick_interval: Duration::from_millis(200),
            },
            factory,
        )
        .map_err(|error| error.to_string())?,
    );
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
    tokio::spawn(supervisor.clone().run());
    let listen = listen("ARTIFACT_PROCESSOR_LISTEN", "0.0.0.0:8089")?;
    let listener = tokio::net::TcpListener::bind(listen).await?;
    info!(%listen, "artifact processor listening in tenant mode");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn serve_provisioner() -> Result<(), Box<dyn std::error::Error>> {
    let app = provisioner_router(
        ProvisionerConfig {
            cluster_database_url: required("ARTIFACT_PROCESSOR_PROVISIONER_DATABASE_URL")?,
            bearer_token: validated_secret("ARTIFACT_PROCESSOR_PROVISIONER_BEARER_TOKEN")?,
        },
        ProcessorProvisioner {
            runtime_role: required("ARTIFACT_PROCESSOR_RUNTIME_ROLE")?,
        },
    )
    .map_err(|error| error.to_string())?;
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
    state.supervisor.readiness().await.into_response()
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
    let Some(database_name) = routed_database(&headers) else {
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

fn runtime_bearer_tokens() -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let primary = validated_secret("ARTIFACT_PROCESSOR_BEARER_TOKEN")?;
    let intent_service = validated_secret("INTENT_SERVICE_PROCESSOR_BEARER_TOKEN")?;
    if primary == intent_service {
        return Err("processor API and intent-service credentials must differ".into());
    }
    Ok(vec![primary, intent_service])
}

//! Shared infrastructure for Rust services that operate across approved customer databases.
//!
//! The rail owns tenant-directory refresh, bounded lazy runtime pools, fair background
//! scheduling, readiness accounting, database routing, and the component-provisioner HTTP
//! contract. Domain repositories and processing logic stay in the consuming service.

use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::error::Error;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use axum::{Json, Router};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{Mutex, RwLock};
use tokio::time::MissedTickBehavior;
use tracing::{error, warn};
use url::Url;
use uuid::Uuid;

pub const TENANT_DATABASE_HEADER: &str = "x-aven-artifact-database";

pub type RailError = Box<dyn Error + Send + Sync>;
pub type RailResult<T> = Result<T, RailError>;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantBinding {
    pub environment_id: String,
    pub database_name: String,
    pub scope_id: Uuid,
}

pub struct TenantSupervisorConfig {
    pub service_name: &'static str,
    pub directory_url: String,
    pub directory_token: String,
    pub cluster_database_url: String,
    pub max_tenant_pools: usize,
    pub refresh_interval: Duration,
    pub tick_interval: Duration,
}

#[async_trait]
pub trait ManagedTenantRuntime: Send + Sync + 'static {
    async fn tick(&self) -> RailResult<()>;
}

#[async_trait]
pub trait TenantRuntimeFactory: Send + Sync + 'static {
    type Runtime: ManagedTenantRuntime;

    async fn open(&self, binding: &TenantBinding, database_url: &str) -> RailResult<Self::Runtime>;
}

struct DirectoryState {
    bindings: BTreeMap<Uuid, TenantBinding>,
    unchecked_tenants: BTreeSet<Uuid>,
    tenant_errors: BTreeMap<Uuid, String>,
    last_success: Instant,
    last_error: Option<String>,
}

pub struct TenantSupervisor<F: TenantRuntimeFactory> {
    service_name: &'static str,
    client: Client,
    directory_url: String,
    directory_token: String,
    cluster_database_url: String,
    max_tenant_pools: usize,
    refresh_interval: Duration,
    tick_interval: Duration,
    directory: RwLock<DirectoryState>,
    runtimes: Mutex<BTreeMap<Uuid, Arc<F::Runtime>>>,
    next_tenant: AtomicUsize,
    factory: F,
}

impl<F: TenantRuntimeFactory> TenantSupervisor<F> {
    /// Creates a supervisor without contacting the tenant directory.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid intervals, credentials, URLs, or HTTP client setup.
    pub fn new(config: TenantSupervisorConfig, factory: F) -> RailResult<Self> {
        if config.max_tenant_pools == 0
            || config.refresh_interval.is_zero()
            || config.tick_interval.is_zero()
        {
            return Err("tenant supervisor intervals and pool limit must be positive".into());
        }
        validate_secret(&config.directory_token, "tenant directory bearer token")?;
        let directory_url = Url::parse(&config.directory_url)?;
        if !matches!(directory_url.scheme(), "http" | "https") {
            return Err("tenant directory URL must use HTTP or HTTPS".into());
        }
        validate_cluster_database_url(&config.cluster_database_url)?;
        Ok(Self {
            service_name: config.service_name,
            client: Client::builder().timeout(Duration::from_secs(10)).build()?,
            directory_url: config.directory_url,
            directory_token: config.directory_token,
            cluster_database_url: config.cluster_database_url,
            max_tenant_pools: config.max_tenant_pools,
            refresh_interval: config.refresh_interval,
            tick_interval: config.tick_interval,
            directory: RwLock::new(DirectoryState {
                bindings: BTreeMap::new(),
                unchecked_tenants: BTreeSet::new(),
                tenant_errors: BTreeMap::new(),
                last_success: Instant::now(),
                last_error: None,
            }),
            runtimes: Mutex::new(BTreeMap::new()),
            next_tenant: AtomicUsize::new(0),
            factory,
        })
    }

    /// Replaces the approved binding snapshot returned by the configured directory.
    ///
    /// # Errors
    ///
    /// Returns an error when the request, response, or any returned binding is invalid.
    pub async fn refresh_directory(&self) -> RailResult<()> {
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

    pub async fn binding(&self, scope_id: Uuid, database_name: &str) -> Option<TenantBinding> {
        self.directory
            .read()
            .await
            .bindings
            .get(&scope_id)
            .filter(|binding| binding.database_name == database_name)
            .cloned()
    }

    /// Gets or lazily opens the domain runtime for an approved binding.
    ///
    /// # Errors
    ///
    /// Returns an error when database routing or the consumer's runtime factory fails.
    pub async fn runtime_for(&self, binding: &TenantBinding) -> RailResult<Arc<F::Runtime>> {
        if let Some(runtime) = self.runtimes.lock().await.get(&binding.scope_id).cloned() {
            return Ok(runtime);
        }
        let database_url = tenant_database_url(&self.cluster_database_url, &binding.database_name)?;
        let runtime = Arc::new(self.factory.open(binding, &database_url).await?);
        let mut runtimes = self.runtimes.lock().await;
        if runtimes.len() >= self.max_tenant_pools {
            if let Some(scope) = runtimes.keys().next().copied() {
                runtimes.remove(&scope);
            }
        }
        runtimes.insert(binding.scope_id, runtime.clone());
        Ok(runtime)
    }

    pub async fn readiness(&self) -> TenantReadiness {
        let directory = self.directory.read().await;
        let fresh = directory.last_success.elapsed() <= self.refresh_interval.saturating_mul(3);
        TenantReadiness {
            ready: fresh
                && directory.unchecked_tenants.is_empty()
                && directory.tenant_errors.is_empty(),
            tenant_count: directory.bindings.len(),
            unchecked_tenant_count: directory.unchecked_tenants.len(),
            failed_tenant_count: directory.tenant_errors.len(),
            directory_error: directory.last_error.clone(),
        }
    }

    pub async fn run(self: Arc<Self>) {
        let mut tick = tokio::time::interval(self.tick_interval);
        let mut refresh = tokio::time::interval(self.refresh_interval);
        tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
        refresh.set_missed_tick_behavior(MissedTickBehavior::Skip);
        refresh.tick().await;
        loop {
            tokio::select! {
                _ = refresh.tick() => if let Err(error) = self.refresh_directory().await {
                    warn!(%error, service = self.service_name, "tenant directory refresh failed");
                    self.directory.write().await.last_error = Some(error.to_string());
                },
                _ = tick.tick() => if let Err(error) = self.tick_one().await {
                    error!(%error, service = self.service_name, "tenant tick failed");
                },
            }
        }
    }

    async fn tick_one(&self) -> RailResult<()> {
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
            runtime.tick().await
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

pub struct TenantReadiness {
    ready: bool,
    tenant_count: usize,
    unchecked_tenant_count: usize,
    failed_tenant_count: usize,
    directory_error: Option<String>,
}

impl TenantReadiness {
    #[must_use]
    pub fn into_response(self) -> Response {
        let status = if self.ready {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        };
        (
            status,
            Json(json!({
                "status": if self.ready { "ready" } else { "not-ready" },
                "tenantCount": self.tenant_count,
                "uncheckedTenantCount": self.unchecked_tenant_count,
                "failedTenantCount": self.failed_tenant_count,
                "directoryError": self.directory_error,
            })),
        )
            .into_response()
    }
}

#[async_trait]
pub trait ProvisionerAdapter: Clone + Send + Sync + 'static {
    fn component_name(&self) -> &'static str;
    fn schema_version(&self) -> u32;
    async fn ready(&self, cluster_database_url: &str) -> RailResult<()>;
    async fn provision(&self, database_url: &str, scope_id: Uuid) -> RailResult<()>;
}

pub struct ProvisionerConfig {
    pub cluster_database_url: String,
    pub bearer_token: String,
}

#[derive(Clone)]
struct ProvisionerState<P: ProvisionerAdapter> {
    cluster_database_url: String,
    bearer_token: Arc<str>,
    adapter: P,
}

/// Builds the standard liveness, readiness, and idempotent provisioning routes.
///
/// # Errors
///
/// Returns an error when the cluster URL or provisioner credential is invalid.
pub fn provisioner_router<P: ProvisionerAdapter>(
    config: ProvisionerConfig,
    adapter: P,
) -> RailResult<Router> {
    validate_cluster_database_url(&config.cluster_database_url)?;
    validate_secret(&config.bearer_token, "provisioner bearer token")?;
    let state = ProvisionerState {
        cluster_database_url: config.cluster_database_url,
        bearer_token: config.bearer_token.into(),
        adapter,
    };
    Ok(Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(provisioner_ready::<P>))
        .route(
            "/internal/v1/databases/{database_name}/scopes/{scope_id}",
            put(provision_scope::<P>),
        )
        .with_state(state))
}

async fn live() -> Json<serde_json::Value> {
    Json(json!({ "status": "live" }))
}

async fn provisioner_ready<P: ProvisionerAdapter>(
    State(state): State<ProvisionerState<P>>,
) -> Response {
    match state.adapter.ready(&state.cluster_database_url).await {
        Ok(()) => Json(json!({ "status": "ready" })).into_response(),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "not-ready" })),
        )
            .into_response(),
    }
}

async fn provision_scope<P: ProvisionerAdapter>(
    State(state): State<ProvisionerState<P>>,
    headers: HeaderMap,
    Path((database_name, scope_id)): Path<(String, Uuid)>,
) -> Response {
    if !authorized(&headers, &state.bearer_token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(database_url) = tenant_database_url(&state.cluster_database_url, &database_name) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match state.adapter.provision(&database_url, scope_id).await {
        Ok(()) => Json(json!({
            "status": "ready",
            "schemaVersion": state.adapter.schema_version(),
            "scopeId": scope_id,
        }))
        .into_response(),
        Err(error) => {
            error!(
                %error,
                %database_name,
                %scope_id,
                component = state.adapter.component_name(),
                "tenant component provisioning failed"
            );
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[must_use]
pub fn authorized(headers: &HeaderMap, token: &str) -> bool {
    let expected = format!("Bearer {token}");
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        == Some(expected.as_str())
}

#[must_use]
pub fn authorized_any(headers: &HeaderMap, tokens: &[String]) -> bool {
    let Some(value) = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return false;
    };
    tokens.iter().any(|token| token == value)
}

#[must_use]
pub fn routed_database(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(TENANT_DATABASE_HEADER)
        .and_then(|value| value.to_str().ok())
}

/// Replaces the database path in a `PostgreSQL` cluster URL with a validated tenant database.
///
/// # Errors
///
/// Returns an error for an invalid URL, scheme, or customer database name.
pub fn tenant_database_url(cluster_url: &str, database_name: &str) -> RailResult<String> {
    validate_database_name(database_name)?;
    let mut url = Url::parse(cluster_url)?;
    if !matches!(url.scheme(), "postgres" | "postgresql") {
        return Err("tenant cluster URL must use PostgreSQL".into());
    }
    url.set_path(&format!("/{database_name}"));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.to_string())
}

/// Validates the `cust_*` `PostgreSQL` database naming contract.
///
/// # Errors
///
/// Returns an error when the name is too long, has the wrong prefix, or contains unsafe bytes.
pub fn validate_database_name(value: &str) -> RailResult<()> {
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

fn validate_cluster_database_url(value: &str) -> RailResult<()> {
    let url = Url::parse(value)?;
    if !matches!(url.scheme(), "postgres" | "postgresql") {
        return Err("tenant cluster URL must use PostgreSQL".into());
    }
    Ok(())
}

fn validate_secret(value: &str, label: &str) -> RailResult<()> {
    if !(32..=128).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err(format!("{label} must be 32-128 URL-safe characters").into());
    }
    Ok(())
}

/// Reads and validates a URL-safe service credential from the environment.
///
/// # Errors
///
/// Returns an error when the variable is absent or does not satisfy the credential contract.
pub fn validated_secret(name: &str) -> Result<String, Box<dyn Error>> {
    let value = required(name)?;
    validate_secret(&value, name).map_err(|error| error.to_string())?;
    Ok(value)
}

/// Reads a required environment variable.
///
/// # Errors
///
/// Returns an error when the variable is absent.
pub fn required(name: &str) -> Result<String, Box<dyn Error>> {
    env::var(name).map_err(|_| format!("required environment variable {name} is missing").into())
}

#[must_use]
pub fn env_bool(name: &str) -> bool {
    env::var(name).is_ok_and(|value| value == "true")
}

/// Reads a positive `u64` environment value or uses the supplied default.
///
/// # Errors
///
/// Returns an error when the value is zero or is not a `u64`.
pub fn env_u64(name: &str, default: u64) -> Result<u64, Box<dyn Error>> {
    let value = env::var(name).map_or(Ok(default), |value| value.parse())?;
    if value == 0 {
        return Err(format!("{name} must be a positive integer").into());
    }
    Ok(value)
}

/// Reads a positive `u32` environment value or uses the supplied default.
///
/// # Errors
///
/// Returns an error when the value is zero, malformed, or too large.
pub fn env_u32(name: &str, default: u32) -> Result<u32, Box<dyn Error>> {
    u32::try_from(env_u64(name, u64::from(default))?)
        .map_err(|_| format!("{name} is too large").into())
}

/// Reads a positive `usize` environment value or uses the supplied default.
///
/// # Errors
///
/// Returns an error when the value is zero or is not a `usize`.
pub fn env_usize(name: &str, default: usize) -> Result<usize, Box<dyn Error>> {
    let value = env::var(name).map_or(Ok(default), |value| value.parse())?;
    if value == 0 {
        return Err(format!("{name} must be a positive integer").into());
    }
    Ok(value)
}

/// Reads a socket address from the environment or parses the supplied default.
///
/// # Errors
///
/// Returns an error when the selected value is not a socket address.
pub fn listen(name: &str, default: &str) -> Result<SocketAddr, Box<dyn Error>> {
    Ok(env::var(name).unwrap_or_else(|_| default.into()).parse()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::{Method, Request};
    use serde_json::Value;
    use tokio::task::JoinHandle;
    use tower::ServiceExt;

    #[derive(Clone)]
    struct TestFactory {
        opened: Arc<Mutex<Vec<(Uuid, String)>>>,
        ticks: Arc<AtomicUsize>,
    }

    struct TestRuntime {
        ticks: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl ManagedTenantRuntime for TestRuntime {
        async fn tick(&self) -> RailResult<()> {
            self.ticks.fetch_add(1, Ordering::Relaxed);
            Ok(())
        }
    }

    #[async_trait]
    impl TenantRuntimeFactory for TestFactory {
        type Runtime = TestRuntime;

        async fn open(
            &self,
            binding: &TenantBinding,
            database_url: &str,
        ) -> RailResult<Self::Runtime> {
            self.opened
                .lock()
                .await
                .push((binding.scope_id, database_url.into()));
            Ok(TestRuntime {
                ticks: self.ticks.clone(),
            })
        }
    }

    #[derive(Clone)]
    struct TestProvisioner {
        calls: Arc<Mutex<Vec<(String, Uuid)>>>,
    }

    #[async_trait]
    impl ProvisionerAdapter for TestProvisioner {
        fn component_name(&self) -> &'static str {
            "test-component"
        }

        fn schema_version(&self) -> u32 {
            7
        }

        async fn ready(&self, _cluster_database_url: &str) -> RailResult<()> {
            Ok(())
        }

        async fn provision(&self, database_url: &str, scope_id: Uuid) -> RailResult<()> {
            self.calls
                .lock()
                .await
                .push((database_url.into(), scope_id));
            Ok(())
        }
    }

    async fn tenant_directory(
        bindings: Vec<TenantBinding>,
        token: String,
    ) -> (String, JoinHandle<()>) {
        let app = Router::new().route(
            "/directory",
            get(move |headers: HeaderMap| {
                let bindings = bindings.clone();
                let token = token.clone();
                async move {
                    if authorized(&headers, &token) {
                        Json(bindings).into_response()
                    } else {
                        StatusCode::UNAUTHORIZED.into_response()
                    }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}/directory"), task)
    }

    #[test]
    fn tenant_database_names_are_strict() {
        for valid in ["cust_", "cust_acme_42"] {
            assert!(validate_database_name(valid).is_ok(), "rejected {valid}");
        }
        for invalid in ["aven", "cust_A", "cust-hyphen", "cust_../aven"] {
            assert!(
                validate_database_name(invalid).is_err(),
                "accepted {invalid}"
            );
        }
    }

    #[test]
    fn tenant_database_url_replaces_only_the_database() {
        assert_eq!(
            tenant_database_url(
                "postgres://runtime:secret@db:5432/postgres?sslmode=require#ignored",
                "cust_acme"
            )
            .unwrap(),
            "postgres://runtime:secret@db:5432/cust_acme"
        );
        assert!(tenant_database_url("https://db.example/postgres", "cust_acme").is_err());
    }

    #[test]
    fn bearer_authorization_is_exact() {
        let token = "a".repeat(32);
        let mut headers = HeaderMap::new();
        headers.insert("authorization", format!("Bearer {token}").parse().unwrap());
        assert!(authorized(&headers, &token));
        assert!(authorized_any(&headers, &["b".repeat(32), token]));
        assert!(!authorized(&headers, &"c".repeat(32)));
    }

    #[tokio::test]
    async fn supervisor_refreshes_ticks_and_bounds_lazy_runtimes() {
        let token = "d".repeat(32);
        let first_scope = Uuid::from_u128(1);
        let second_scope = Uuid::from_u128(2);
        let bindings = vec![
            TenantBinding {
                environment_id: "environment-one".into(),
                database_name: "cust_one".into(),
                scope_id: first_scope,
            },
            TenantBinding {
                environment_id: "environment-two".into(),
                database_name: "cust_two".into(),
                scope_id: second_scope,
            },
        ];
        let (directory_url, server) = tenant_directory(bindings, token.clone()).await;
        let opened = Arc::new(Mutex::new(Vec::new()));
        let ticks = Arc::new(AtomicUsize::new(0));
        let supervisor = TenantSupervisor::new(
            TenantSupervisorConfig {
                service_name: "test-service",
                directory_url,
                directory_token: token,
                cluster_database_url: "postgres://runtime:secret@db:5432/postgres".into(),
                max_tenant_pools: 1,
                refresh_interval: Duration::from_secs(30),
                tick_interval: Duration::from_millis(10),
            },
            TestFactory {
                opened: opened.clone(),
                ticks: ticks.clone(),
            },
        )
        .unwrap();

        supervisor.refresh_directory().await.unwrap();
        let before_ticks = supervisor.readiness().await;
        assert!(!before_ticks.ready);
        assert_eq!(before_ticks.unchecked_tenant_count, 2);
        assert!(supervisor.binding(first_scope, "cust_one").await.is_some());
        assert!(supervisor.binding(first_scope, "cust_two").await.is_none());

        supervisor.tick_one().await.unwrap();
        supervisor.tick_one().await.unwrap();
        let after_ticks = supervisor.readiness().await;
        assert!(after_ticks.ready);
        assert_eq!(ticks.load(Ordering::Relaxed), 2);
        assert_eq!(opened.lock().await.len(), 2);

        let first = supervisor.binding(first_scope, "cust_one").await.unwrap();
        supervisor.runtime_for(&first).await.unwrap();
        let opened = opened.lock().await;
        assert_eq!(
            opened.len(),
            3,
            "the one-entry pool should evict the first tenant"
        );
        assert_eq!(
            opened.last().unwrap().1,
            "postgres://runtime:secret@db:5432/cust_one"
        );
        server.abort();
    }

    #[tokio::test]
    async fn provisioner_router_enforces_auth_and_preserves_the_contract() {
        let token = "p".repeat(32);
        let scope_id = Uuid::from_u128(42);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let app = provisioner_router(
            ProvisionerConfig {
                cluster_database_url: "postgres://provisioner:secret@db:5432/postgres".into(),
                bearer_token: token.clone(),
            },
            TestProvisioner {
                calls: calls.clone(),
            },
        )
        .unwrap();
        let path = format!("/internal/v1/databases/cust_acme/scopes/{scope_id}");

        let unauthorized = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::PUT)
                    .uri(&path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::PUT)
                    .uri(&path)
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 16 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(body["status"], "ready");
        assert_eq!(body["schemaVersion"], 7);
        assert_eq!(body["scopeId"], scope_id.to_string());
        assert_eq!(
            calls.lock().await.as_slice(),
            &[(
                "postgres://provisioner:secret@db:5432/cust_acme".into(),
                scope_id
            )]
        );
    }
}

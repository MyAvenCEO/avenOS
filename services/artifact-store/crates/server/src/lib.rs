//! Stand-alone HTTP adapter for the artifact-store kernel.

use std::collections::BTreeSet;
use std::sync::Arc;

use aven_artifact_store_contract::{
    parse_canonical, BlobAuthority, ErrorCode, Problem, PublicationBody, PublicationSubmission,
    RequestContext, StablePublisher, TypeKey, UploadDeclaration,
};
use aven_artifact_store_core::{prepare_publication, Limits, TypeCatalog};
use aven_artifact_store_postgres::{PostgresStore, StoreError};
use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use axum::{Json, Router};
use serde::Deserialize;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

const MAX_BODY_BYTES: usize = 100 * 1024 * 1024;

#[derive(Clone)]
pub struct FixedServiceAuth {
    bearer_token: Arc<str>,
    publisher: StablePublisher,
    scope_id: Uuid,
}

impl FixedServiceAuth {
    /// Create the explicit fixed-publisher preview authentication adapter.
    ///
    /// # Errors
    ///
    /// Returns an error for an empty credential or invalid stable publisher.
    pub fn new(
        bearer_token: impl Into<Arc<str>>,
        publisher: StablePublisher,
        scope_id: Uuid,
    ) -> Result<Self, ApiError> {
        publisher
            .validate()
            .map_err(|error| ApiError::malformed(error.to_string()))?;
        let bearer_token = bearer_token.into();
        if bearer_token.is_empty() {
            return Err(ApiError::malformed("bearer token cannot be empty"));
        }
        Ok(Self {
            bearer_token,
            publisher,
            scope_id,
        })
    }

    fn authorize(
        &self,
        headers: &HeaderMap,
        route_scope: Option<Uuid>,
    ) -> Result<RequestContext, ApiError> {
        let expected = format!("Bearer {}", self.bearer_token);
        let supplied = headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok());
        if supplied != Some(expected.as_str()) {
            return Err(ApiError::new(
                StatusCode::UNAUTHORIZED,
                ErrorCode::AuthenticationRequired,
                "a valid bearer credential is required",
            ));
        }
        if route_scope.is_some_and(|scope| scope != self.scope_id) {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                ErrorCode::ScopeDenied,
                "the authenticated service cannot use this scope",
            ));
        }
        Ok(RequestContext {
            publisher: self.publisher.clone(),
            scope_id: self.scope_id,
            decision_expires_at: OffsetDateTime::now_utc() + Duration::minutes(1),
        })
    }
}

#[derive(Clone)]
pub struct AppState {
    store: PostgresStore,
    catalog: TypeCatalog,
    limits: Limits,
    auth: FixedServiceAuth,
}

impl AppState {
    #[must_use]
    pub fn new(store: PostgresStore, catalog: TypeCatalog, auth: FixedServiceAuth) -> Self {
        Self {
            store,
            catalog,
            limits: Limits::default(),
            auth,
        }
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .route("/v1/context", get(context))
        .route("/v1/types/{type_key}/versions/{version}", get(get_type))
        .route(
            "/v1/scopes/{scope_id}/uploads/{claim_id}",
            put(stage_upload),
        )
        .route(
            "/v1/scopes/{scope_id}/publications/{publication_id}",
            put(publish),
        )
        .route("/v1/scopes/{scope_id}/publications", get(read_feed))
        .route(
            "/v1/scopes/{scope_id}/artifacts/{artifact_id}",
            get(get_artifact),
        )
        .route(
            "/v1/scopes/{scope_id}/artifacts/{artifact_id}/content",
            get(get_content).head(head_content),
        )
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(state)
}

async fn live() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn ready(State(state): State<AppState>) -> Result<StatusCode, ApiError> {
    state.store.context().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn context(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    state.auth.authorize(&headers, None)?;
    Ok(Json(state.store.context().await?))
}

async fn get_type(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((type_key, version)): Path<(String, u32)>,
) -> Result<Response, ApiError> {
    state.auth.authorize(&headers, None)?;
    let type_key =
        TypeKey::new(type_key).map_err(|error| ApiError::malformed(error.to_string()))?;
    let registered = state
        .catalog
        .get(&type_key, version)
        .ok_or_else(ApiError::unavailable)?;
    Ok(Json(registered).into_response())
}

async fn stage_upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((scope_id, claim_id)): Path<(Uuid, Uuid)>,
    body: Bytes,
) -> Result<Response, ApiError> {
    let context = state.auth.authorize(&headers, Some(scope_id))?;
    let sha256 = required_header(&headers, "x-expected-sha256")?.to_owned();
    let length = required_header(&headers, "content-length")?
        .parse::<u64>()
        .map_err(|_| ApiError::malformed("Content-Length must be an unsigned integer"))?;
    let declared_media_type = required_header(&headers, "content-type")?.to_owned();
    let declaration = UploadDeclaration {
        sha256,
        length,
        declared_media_type,
    };
    let result = state
        .store
        .stage_upload(
            OffsetDateTime::now_utc(),
            &context.publisher,
            scope_id,
            claim_id,
            &declaration,
            &body,
            Duration::hours(24),
        )
        .await?;
    Ok((StatusCode::CREATED, Json(result)).into_response())
}

async fn publish(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((scope_id, publication_id)): Path<(Uuid, Uuid)>,
    body: Bytes,
) -> Result<Response, ApiError> {
    let context = state.auth.authorize(&headers, Some(scope_id))?;
    let expected_epoch = required_header(&headers, "if-artifact-store-epoch")?
        .parse::<Uuid>()
        .map_err(|_| ApiError::malformed("If-Artifact-Store-Epoch must be a UUID"))?;
    let canonical =
        parse_canonical(&body, true).map_err(|error| ApiError::malformed(error.to_string()))?;
    let submission: PublicationSubmission = serde_json::from_slice(&canonical.canonical_bytes())
        .map_err(|error| ApiError::malformed(error.to_string()))?;
    if submission.intent.scope_id != scope_id || submission.intent.publication_id != publication_id
    {
        return Err(ApiError::malformed(
            "route scope/publication identity differs from the intent",
        ));
    }
    let ids = external_artifact_ids(&submission);
    let existing = state.store.existing_artifacts(scope_id, ids).await?;
    let prepared = prepare_publication(
        OffsetDateTime::now_utc(),
        context,
        submission,
        &state.catalog,
        &existing,
        &state.limits,
    )
    .map_err(|error| ApiError::from_core(&error))?;
    let result = state
        .store
        .publish(OffsetDateTime::now_utc(), expected_epoch, &prepared)
        .await?;
    let mut response = Json(result.clone()).into_response();
    response.headers_mut().insert(
        "artifact-store-epoch",
        result
            .committed_store_epoch
            .to_string()
            .parse()
            .expect("UUID is a valid header value"),
    );
    Ok(response)
}

async fn get_artifact(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((scope_id, artifact_id)): Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    state.auth.authorize(&headers, Some(scope_id))?;
    let artifact = state
        .store
        .get_artifact(scope_id, artifact_id)
        .await?
        .ok_or_else(ApiError::unavailable)?;
    Ok(Json(artifact).into_response())
}

async fn get_content(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((scope_id, artifact_id)): Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    state.auth.authorize(&headers, Some(scope_id))?;
    let content = state
        .store
        .get_content(scope_id, artifact_id)
        .await?
        .ok_or_else(ApiError::unavailable)?;
    let full_length = content.len();
    let range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(|value| parse_byte_range(value, full_length))
        .transpose()?;
    let (status, selected, content_range) = if let Some((start, end_exclusive)) = range {
        (
            StatusCode::PARTIAL_CONTENT,
            content[start..end_exclusive].to_vec(),
            Some(format!("bytes {start}-{}/{full_length}", end_exclusive - 1)),
        )
    } else {
        (StatusCode::OK, content, None)
    };
    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(header::CONTENT_DISPOSITION, "attachment")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, selected.len())
        .body(Body::from(selected))
        .expect("static response headers are valid");
    if let Some(content_range) = content_range {
        response.headers_mut().insert(
            header::CONTENT_RANGE,
            content_range
                .parse()
                .expect("validated byte range is a valid header"),
        );
    }
    Ok(response)
}

async fn head_content(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((scope_id, artifact_id)): Path<(Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    state.auth.authorize(&headers, Some(scope_id))?;
    let artifact = state
        .store
        .get_artifact(scope_id, artifact_id)
        .await?
        .ok_or_else(ApiError::unavailable)?;
    let length = artifact.blob.ok_or_else(ApiError::unavailable)?.length;
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(header::CONTENT_DISPOSITION, "attachment")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, length)
        .body(Body::empty())
        .expect("static response headers are valid"))
}

fn parse_byte_range(value: &str, length: usize) -> Result<(usize, usize), ApiError> {
    let range = value.strip_prefix("bytes=").ok_or_else(ApiError::range)?;
    if range.contains(',') {
        return Err(ApiError::range());
    }
    let (start, end) = range.split_once('-').ok_or_else(ApiError::range)?;
    let (start, end_exclusive) = if start.is_empty() {
        let suffix = end.parse::<usize>().map_err(|_| ApiError::range())?;
        if suffix == 0 || length == 0 {
            return Err(ApiError::range());
        }
        (length.saturating_sub(suffix), length)
    } else {
        let start = start.parse::<usize>().map_err(|_| ApiError::range())?;
        let end_exclusive = if end.is_empty() {
            length
        } else {
            end.parse::<usize>()
                .map_err(|_| ApiError::range())?
                .checked_add(1)
                .ok_or_else(ApiError::range)?
        };
        (start, end_exclusive.min(length))
    };
    if start >= end_exclusive || start >= length {
        return Err(ApiError::range());
    }
    Ok((start, end_exclusive))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FeedQuery {
    store_epoch: Uuid,
    #[serde(default)]
    after_sequence: i64,
    #[serde(default = "default_feed_limit")]
    limit: u32,
}

const fn default_feed_limit() -> u32 {
    100
}

async fn read_feed(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(scope_id): Path<Uuid>,
    Query(query): Query<FeedQuery>,
) -> Result<Response, ApiError> {
    state.auth.authorize(&headers, Some(scope_id))?;
    let page = state
        .store
        .read_feed(
            scope_id,
            query.store_epoch,
            query.after_sequence,
            query.limit,
        )
        .await
        .map_err(|error| match error {
            StoreError::EpochChanged { expected, actual } => ApiError::new(
                StatusCode::CONFLICT,
                ErrorCode::FeedRebootstrapRequired,
                format!("feed epoch {expected} differs from current epoch {actual}"),
            ),
            other => ApiError::from(other),
        })?;
    Ok(Json(page).into_response())
}

fn external_artifact_ids(submission: &PublicationSubmission) -> BTreeSet<Uuid> {
    let mut ids = BTreeSet::new();
    if let PublicationBody::Run { run } = &submission.intent.body {
        ids.extend(run.inputs.iter().map(|input| input.artifact_id));
    }
    for artifact in &submission.intent.artifacts {
        for reference in &artifact.references {
            if let aven_artifact_store_contract::ReferenceTarget::Existing { artifact_id } =
                reference.target
            {
                ids.insert(artifact_id);
            }
        }
    }
    for authority in submission.blob_authorities.values() {
        if let BlobAuthority::SourceArtifact { artifact_id } = authority {
            ids.insert(*artifact_id);
        }
    }
    ids
}

fn required_header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, ApiError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::malformed(format!("missing or invalid {name} header")))
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    problem: Problem,
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.problem.detail)
    }
}

impl std::error::Error for ApiError {}

impl ApiError {
    fn new(status: StatusCode, code: ErrorCode, detail: impl Into<String>) -> Self {
        let detail = detail.into();
        let mut problem = Problem::new(
            status.as_u16(),
            code,
            status.canonical_reason().unwrap_or("request failed"),
        );
        problem.detail = detail;
        Self { status, problem }
    }

    fn malformed(detail: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, ErrorCode::MalformedRequest, detail)
    }

    fn unavailable() -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            ErrorCode::ResourceUnavailable,
            "resource is unknown or unavailable",
        )
    }

    fn range() -> Self {
        Self::new(
            StatusCode::RANGE_NOT_SATISFIABLE,
            ErrorCode::ContentRangeNotSatisfiable,
            "requested byte range is outside the exact content",
        )
    }

    fn from_core(error: &aven_artifact_store_core::CoreError) -> Self {
        use aven_artifact_store_core::CoreError;
        match error {
            CoreError::Schema { .. } => Self::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                ErrorCode::SchemaValidationFailed,
                error.to_string(),
            ),
            CoreError::ArtifactUnavailable(_) => Self::new(
                StatusCode::CONFLICT,
                ErrorCode::InputUnavailable,
                "input or reference is unavailable",
            ),
            _ => Self::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                ErrorCode::MalformedRequest,
                error.to_string(),
            ),
        }
    }
}

impl From<StoreError> for ApiError {
    fn from(error: StoreError) -> Self {
        match error {
            StoreError::Reconciling => Self::new(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorCode::StoreReconciliationRequired,
                error.to_string(),
            ),
            StoreError::EpochChanged { .. } => Self::new(
                StatusCode::CONFLICT,
                ErrorCode::StoreEpochChanged,
                error.to_string(),
            ),
            StoreError::PublicationConflict => Self::new(
                StatusCode::CONFLICT,
                ErrorCode::PublicationConflict,
                error.to_string(),
            ),
            StoreError::PublicationDataLost => Self::new(
                StatusCode::GONE,
                ErrorCode::PublicationDataLost,
                error.to_string(),
            ),
            StoreError::UploadConflict => Self::new(
                StatusCode::CONFLICT,
                ErrorCode::UploadConflict,
                error.to_string(),
            ),
            StoreError::UploadExpired => Self::new(
                StatusCode::GONE,
                ErrorCode::UploadExpired,
                error.to_string(),
            ),
            StoreError::UploadDigestMismatch => Self::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                ErrorCode::UploadDigestMismatch,
                error.to_string(),
            ),
            StoreError::InputUnavailable => Self::new(
                StatusCode::CONFLICT,
                ErrorCode::InputUnavailable,
                error.to_string(),
            ),
            StoreError::Database(_)
            | StoreError::Migration(_)
            | StoreError::Json(_)
            | StoreError::Integrity(_) => Self::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                ErrorCode::IntegrityFailure,
                "the store could not safely complete the operation",
            ),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            [
                (header::CONTENT_TYPE, "application/problem+json"),
                (header::CACHE_CONTROL, "private, no-store"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            Json(self.problem),
        )
            .into_response()
    }
}

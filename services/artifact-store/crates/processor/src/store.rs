use aven_artifact_store_contract::{
    ArtifactEnvelope, PublicationFeedPage, PublicationResult, PublicationSubmission, StoreContext,
    UploadClaimResult, UploadDeclaration,
};
use reqwest::{Client, StatusCode};
use thiserror::Error;
use uuid::Uuid;

const DATABASE_HEADER: &str = "x-aven-artifact-database";

#[derive(Clone)]
pub struct ArtifactStoreClient {
    client: Client,
    base_url: String,
    bearer_token: String,
    database_name: String,
}

#[derive(Debug, Error)]
pub enum ArtifactStoreClientError {
    #[error("artifact store request failed: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("artifact store returned HTTP {status}: {detail}")]
    Response { status: StatusCode, detail: String },
}

impl ArtifactStoreClientError {
    #[must_use]
    pub fn retryable(&self) -> bool {
        match self {
            Self::Transport(_) => true,
            Self::Response { status, .. } => {
                status.is_server_error() || *status == StatusCode::TOO_MANY_REQUESTS
            }
        }
    }

    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::Transport(_) => "artifact-store-transport",
            Self::Response { status, .. } if status.is_server_error() => "artifact-store-server",
            Self::Response { status, .. } if *status == StatusCode::TOO_MANY_REQUESTS => {
                "artifact-store-throttled"
            }
            Self::Response { .. } => "artifact-store-rejected-publication",
        }
    }
}

impl ArtifactStoreClient {
    #[must_use]
    pub fn new(base_url: &str, bearer_token: &str, database_name: &str) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.trim_end_matches('/').to_owned(),
            bearer_token: bearer_token.to_owned(),
            database_name: database_name.to_owned(),
        }
    }

    pub async fn context(&self) -> Result<StoreContext, ArtifactStoreClientError> {
        self.get_json("/v1/context").await
    }

    pub async fn read_feed(
        &self,
        scope_id: Uuid,
        store_epoch: Uuid,
        after_sequence: i64,
        limit: u32,
    ) -> Result<PublicationFeedPage, ArtifactStoreClientError> {
        let path = format!(
            "/v1/scopes/{scope_id}/publications?storeEpoch={store_epoch}&afterSequence={after_sequence}&limit={limit}"
        );
        self.get_json(&path).await
    }

    pub async fn get_artifact(
        &self,
        scope_id: Uuid,
        artifact_id: Uuid,
    ) -> Result<ArtifactEnvelope, ArtifactStoreClientError> {
        self.get_json(&format!("/v1/scopes/{scope_id}/artifacts/{artifact_id}"))
            .await
    }

    pub async fn get_content(
        &self,
        scope_id: Uuid,
        artifact_id: Uuid,
    ) -> Result<Vec<u8>, ArtifactStoreClientError> {
        let response = self
            .authorized(self.client.get(format!(
                "{}/v1/scopes/{scope_id}/artifacts/{artifact_id}/content",
                self.base_url
            )))
            .send()
            .await?;
        Ok(expect_success(response).await?.bytes().await?.to_vec())
    }

    pub async fn stage_upload(
        &self,
        scope_id: Uuid,
        claim_id: Uuid,
        declaration: &UploadDeclaration,
        bytes: Vec<u8>,
    ) -> Result<UploadClaimResult, ArtifactStoreClientError> {
        let response = self
            .authorized(
                self.client
                    .put(format!(
                        "{}/v1/scopes/{scope_id}/uploads/{claim_id}",
                        self.base_url
                    ))
                    .header("x-expected-sha256", &declaration.sha256)
                    .header("content-type", &declaration.declared_media_type)
                    .header("content-length", declaration.length)
                    .body(bytes),
            )
            .send()
            .await?;
        Ok(expect_success(response).await?.json().await?)
    }

    pub async fn publish(
        &self,
        scope_id: Uuid,
        publication_id: Uuid,
        store_epoch: Uuid,
        submission: &PublicationSubmission,
    ) -> Result<PublicationResult, ArtifactStoreClientError> {
        let response = self
            .authorized(
                self.client
                    .put(format!(
                        "{}/v1/scopes/{scope_id}/publications/{publication_id}",
                        self.base_url
                    ))
                    .header("content-type", "application/json")
                    .header("if-artifact-store-epoch", store_epoch.to_string())
                    .json(submission),
            )
            .send()
            .await?;
        Ok(expect_success(response).await?.json().await?)
    }

    async fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<T, ArtifactStoreClientError> {
        let response = self
            .authorized(self.client.get(format!("{}{}", self.base_url, path)))
            .send()
            .await?;
        Ok(expect_success(response).await?.json().await?)
    }

    fn authorized(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        builder
            .bearer_auth(&self.bearer_token)
            .header(DATABASE_HEADER, &self.database_name)
    }
}

async fn expect_success(
    response: reqwest::Response,
) -> Result<reqwest::Response, ArtifactStoreClientError> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let detail = response
        .text()
        .await
        .unwrap_or_else(|_| "response body unavailable".to_owned());
    Err(ArtifactStoreClientError::Response { status, detail })
}

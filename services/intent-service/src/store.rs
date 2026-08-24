use aven_artifact_store_contract::{ArtifactEnvelope, PublicationFeedPage, StoreContext};
use reqwest::{Client, StatusCode};
use std::time::Duration;
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
pub enum ClientError {
    #[error("request failed: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("service returned HTTP {status}: {detail}")]
    Response { status: StatusCode, detail: String },
}

impl ArtifactStoreClient {
    pub fn new(
        base_url: &str,
        bearer_token: &str,
        database_name: &str,
    ) -> Result<Self, ClientError> {
        Ok(Self {
            client: Client::builder().timeout(Duration::from_secs(30)).build()?,
            base_url: base_url.trim_end_matches('/').to_owned(),
            bearer_token: bearer_token.to_owned(),
            database_name: database_name.to_owned(),
        })
    }

    pub async fn context(&self) -> Result<StoreContext, ClientError> {
        self.get_json("/v1/context").await
    }

    pub async fn read_feed(
        &self,
        scope_id: Uuid,
        store_epoch: Uuid,
        after_sequence: i64,
        limit: u32,
    ) -> Result<PublicationFeedPage, ClientError> {
        self.get_json(&format!(
            "/v1/scopes/{scope_id}/publications?storeEpoch={store_epoch}&afterSequence={after_sequence}&limit={limit}"
        ))
        .await
    }

    pub async fn artifact(
        &self,
        scope_id: Uuid,
        artifact_id: Uuid,
    ) -> Result<ArtifactEnvelope, ClientError> {
        self.get_json(&format!("/v1/scopes/{scope_id}/artifacts/{artifact_id}"))
            .await
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, ClientError> {
        let response = self
            .client
            .get(format!("{}{}", self.base_url, path))
            .bearer_auth(&self.bearer_token)
            .header(DATABASE_HEADER, &self.database_name)
            .send()
            .await?;
        if response.status().is_success() {
            return Ok(response.json().await?);
        }
        let status = response.status();
        let detail = response
            .text()
            .await
            .unwrap_or_else(|_| "response body unavailable".into());
        Err(ClientError::Response { status, detail })
    }
}

#[derive(Clone)]
pub struct ProcessorClient {
    client: Client,
    base_url: String,
    bearer_token: String,
    database_name: String,
}

impl ProcessorClient {
    pub fn new(
        base_url: &str,
        bearer_token: &str,
        database_name: &str,
    ) -> Result<Self, ClientError> {
        Ok(Self {
            client: Client::builder().timeout(Duration::from_secs(30)).build()?,
            base_url: base_url.trim_end_matches('/').to_owned(),
            bearer_token: bearer_token.to_owned(),
            database_name: database_name.to_owned(),
        })
    }

    pub async fn status(
        &self,
        scope_id: Uuid,
        source_artifact_id: Uuid,
    ) -> Result<Option<serde_json::Value>, ClientError> {
        let response = self
            .client
            .get(format!(
                "{}/v1/scopes/{scope_id}/artifacts/{source_artifact_id}/processing",
                self.base_url
            ))
            .bearer_auth(&self.bearer_token)
            .header(DATABASE_HEADER, &self.database_name)
            .send()
            .await?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if response.status().is_success() {
            return Ok(Some(response.json().await?));
        }
        let status = response.status();
        let detail = response
            .text()
            .await
            .unwrap_or_else(|_| "response body unavailable".into());
        Err(ClientError::Response { status, detail })
    }
}

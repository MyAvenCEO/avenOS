use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

use crate::repository::{DiscoveredIntent, IntentRepository, RepositoryError};
use crate::store::{ArtifactStoreClient, ClientError, ProcessorClient};

const FEED_LIMIT: u32 = 100;

#[derive(Clone)]
pub struct IntentEngine {
    repository: IntentRepository,
    store: ArtifactStoreClient,
    processor: ProcessorClient,
    scope_id: Uuid,
}

#[derive(Debug, Error)]
pub enum EngineError {
    #[error(transparent)]
    Repository(#[from] RepositoryError),
    #[error(transparent)]
    Client(#[from] ClientError),
    #[error("intent feed invariant failed: {0}")]
    Invariant(String),
}

impl IntentEngine {
    #[must_use]
    pub fn new(
        repository: IntentRepository,
        store: ArtifactStoreClient,
        processor: ProcessorClient,
        scope_id: Uuid,
    ) -> Self {
        Self {
            repository,
            store,
            processor,
            scope_id,
        }
    }

    pub async fn tick(&self) -> Result<(), EngineError> {
        self.consume_feed().await?;
        for source in self.repository.pending_file_sources(self.scope_id).await? {
            match self.processor.status(self.scope_id, source).await {
                Ok(Some(presentation)) => {
                    self.repository
                        .sync_file_presentation(self.scope_id, source, &presentation)
                        .await?;
                }
                Ok(None) => {}
                Err(error) => {
                    tracing::warn!(%error, %source, "processor presentation sync deferred");
                }
            }
        }
        Ok(())
    }

    async fn consume_feed(&self) -> Result<(), EngineError> {
        let context = self.store.context().await?;
        let after = self
            .repository
            .initialize_cursor(self.scope_id, context.store_epoch)
            .await?;
        let page = self
            .store
            .read_feed(self.scope_id, context.store_epoch, after, FEED_LIMIT)
            .await?;
        let mut intents = Vec::new();
        for item in &page.items {
            let source = item
                .artifacts
                .iter()
                .find(|artifact| artifact.type_key.as_str() == "core.file");
            let declaration = item
                .artifacts
                .iter()
                .find(|artifact| artifact.type_key.as_str() == "intent.declaration");
            let (Some(source), Some(declaration)) = (source, declaration) else {
                continue;
            };
            let source_envelope = self
                .store
                .artifact(self.scope_id, source.artifact_id)
                .await?;
            let source_payload = serde_json::to_value(source_envelope.payload)
                .map_err(|error| EngineError::Invariant(error.to_string()))?;
            if !matches!(
                source_payload.get("sourceKind").and_then(Value::as_str),
                Some("processing-mock" | "processing-real" | "desktop-drop")
            ) {
                continue;
            }
            let envelope = self
                .store
                .artifact(self.scope_id, declaration.artifact_id)
                .await?;
            let payload = serde_json::to_value(envelope.payload)
                .map_err(|error| EngineError::Invariant(error.to_string()))?;
            let id = required_string(&payload, "intentId")?
                .parse()
                .map_err(|_| EngineError::Invariant("invalid intentId".into()))?;
            let title = required_string(&payload, "title")?.to_owned();
            intents.push(DiscoveredIntent {
                id,
                declaration_artifact_id: declaration.artifact_id,
                source_artifact_id: source.artifact_id,
                title,
                created_at: item.committed_at,
            });
        }
        self.repository
            .record_feed_page(
                self.scope_id,
                context.store_epoch,
                after,
                page.next_after_sequence.unwrap_or(after),
                &intents,
            )
            .await?;
        Ok(())
    }
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, EngineError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::Invariant(format!("intent declaration has no {key}")))
}

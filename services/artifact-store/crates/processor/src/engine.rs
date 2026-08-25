use std::collections::BTreeMap;

use serde_json::{json, Value};
use thiserror::Error;
use time::Duration;
use uuid::Uuid;

use crate::executor::{execute, generated_uploads, ExecutorError, MaterializedInput};
use crate::model::{
    CaseSnapshot, DerivedArtifact, ProcessingStage, ProcessingStatus, ProcessingWarning,
    StepSnapshot, StoredOutput, PROCESSING_PROJECTION_VERSION,
};
use crate::repository::{ModelCallLease, ProcessingRepository, RepositoryError};
use crate::store::{ArtifactStoreClient, ArtifactStoreClientError};
use crate::vision::VisionAdapter;

const FEED_LIMIT: u32 = 100;
const MAX_ATTEMPTS: i32 = 3;
const ATTEMPT_LEASE: Duration = Duration::seconds(30);

#[derive(Clone)]
pub struct ProcessingEngine {
    repository: ProcessingRepository,
    store: ArtifactStoreClient,
    scope_id: Uuid,
    vision: Option<VisionAdapter>,
}

#[derive(Clone, Debug, Default)]
pub struct TickResult {
    pub discovered: usize,
    pub planned: usize,
    pub published: usize,
    pub executed: usize,
    pub recovered: u64,
    pub failed_cases: u64,
}

impl TickResult {
    #[must_use]
    pub const fn made_progress(&self) -> bool {
        self.discovered > 0
            || self.planned > 0
            || self.published > 0
            || self.executed > 0
            || self.recovered > 0
            || self.failed_cases > 0
    }
}

#[derive(Debug, Error)]
pub enum EngineError {
    #[error(transparent)]
    Repository(#[from] RepositoryError),
    #[error(transparent)]
    Store(#[from] ArtifactStoreClientError),
    #[error(transparent)]
    Executor(#[from] ExecutorError),
    #[error("processing invariant failed: {0}")]
    Invariant(String),
}

impl ProcessingEngine {
    #[must_use]
    pub const fn new(
        repository: ProcessingRepository,
        store: ArtifactStoreClient,
        scope_id: Uuid,
    ) -> Self {
        Self {
            repository,
            store,
            scope_id,
            vision: None,
        }
    }

    #[must_use]
    pub fn with_vision_adapter(mut self, vision: Option<VisionAdapter>) -> Self {
        self.vision = vision;
        self
    }

    #[must_use]
    pub const fn repository(&self) -> &ProcessingRepository {
        &self.repository
    }

    pub async fn tick(&self) -> Result<TickResult, EngineError> {
        let mut result = TickResult::default();
        result.recovered = self.repository.recover_expired(MAX_ATTEMPTS).await?;
        result.discovered = self.discover().await?;

        for case_id in self.repository.active_cases().await? {
            result.planned += self.plan_case(case_id).await?;
            self.refresh_presentation(case_id).await?;
        }

        if self.publish_one().await? {
            result.published = 1;
        } else if self.execute_one().await? {
            result.executed = 1;
        }

        let failed_cases = self.repository.fail_cases_with_terminal_steps().await?;
        result.failed_cases = failed_cases.len() as u64;
        for case_id in failed_cases {
            self.refresh_presentation(case_id).await?;
        }
        Ok(result)
    }

    pub async fn drain(&self, max_ticks: usize) -> Result<usize, EngineError> {
        let mut ticks = 0;
        let mut idle = 0;
        while ticks < max_ticks && idle < 2 {
            let result = self.tick().await?;
            ticks += 1;
            if result.made_progress() {
                idle = 0;
            } else {
                idle += 1;
            }
        }
        if ticks == max_ticks {
            return Err(EngineError::Invariant(format!(
                "drain exceeded {max_ticks} ticks"
            )));
        }
        Ok(ticks)
    }

    async fn discover(&self) -> Result<usize, EngineError> {
        let context = self.store.context().await?;
        let after = self
            .repository
            .initialize_cursor(self.scope_id, context.store_epoch)
            .await?;
        let page = self
            .store
            .read_feed(self.scope_id, context.store_epoch, after, FEED_LIMIT)
            .await?;
        let mut sources = Vec::new();
        for item in &page.items {
            let source = item
                .artifacts
                .iter()
                .find(|artifact| artifact.type_key.as_str() == "core.file");
            if let Some(artifact) = source {
                let envelope = self
                    .store
                    .get_artifact(self.scope_id, artifact.artifact_id)
                    .await?;
                let payload = serde_json::to_value(&envelope.payload)
                    .map_err(|error| EngineError::Invariant(error.to_string()))?;
                if matches!(
                    payload.get("sourceKind").and_then(Value::as_str),
                    Some("processing-mock" | "processing-real" | "desktop-drop")
                ) {
                    sources.push(artifact.artifact_id);
                }
            }
        }
        let next = page.next_after_sequence.unwrap_or(after);
        let inserted = self
            .repository
            .record_feed_page(self.scope_id, context.store_epoch, after, next, &sources)
            .await?;
        Ok(inserted.len())
    }

    #[allow(clippy::too_many_lines)]
    async fn plan_case(&self, case_id: Uuid) -> Result<usize, EngineError> {
        let snapshot = self.repository.case_snapshot(case_id).await?;
        let source = self
            .store
            .get_artifact(snapshot.scope_id, snapshot.source_artifact_id)
            .await?;
        let payload = serde_json::to_value(&source.payload)
            .map_err(|error| EngineError::Invariant(error.to_string()))?;
        if payload.get("sourceKind").and_then(Value::as_str) == Some("processing-mock") {
            self.plan_mock_case(case_id).await
        } else {
            self.plan_real_case(case_id).await
        }
    }

    #[allow(clippy::too_many_lines)]
    async fn plan_mock_case(&self, case_id: Uuid) -> Result<usize, EngineError> {
        let snapshot = self.repository.case_snapshot(case_id).await?;
        let source = snapshot.source_artifact_id;
        let mut created = 0;
        created += self
            .ensure(
                &snapshot,
                "inspect",
                "mock.inspect",
                &[source],
                json!({}),
                &[],
            )
            .await?;
        created += self
            .ensure(
                &snapshot,
                "classify-content-broad",
                "mock.classify-content",
                &[source],
                json!({}),
                &[],
            )
            .await?;

        let snapshot = self.repository.case_snapshot(case_id).await?;
        if succeeded(&snapshot, "inspect") {
            let inspection = required_output(&snapshot, "inspect", "core.file-inspection")?;
            created += self
                .ensure(
                    &snapshot,
                    "decompose-pages",
                    "mock.decompose-pages",
                    &[source, inspection.artifact_id],
                    json!({}),
                    &["inspect"],
                )
                .await?;
        }

        let snapshot = self.repository.case_snapshot(case_id).await?;
        if succeeded(&snapshot, "decompose-pages") {
            let mut pages = outputs_of_type(&snapshot, "docs.page");
            pages.sort_by(|left, right| left.local_key.cmp(&right.local_key));
            for (index, page) in pages.iter().enumerate() {
                let page_number = index + 1;
                let key = format!("classify-page-{page_number:03}");
                created += self
                    .ensure(
                        &snapshot,
                        &key,
                        "mock.classify-page",
                        &[source, page.artifact_id],
                        json!({ "page": page_number }),
                        &["decompose-pages"],
                    )
                    .await?;
            }
        }

        let snapshot = self.repository.case_snapshot(case_id).await?;
        let page_classifiers = matching_steps(&snapshot, "classify-page-");
        for classifier in &page_classifiers {
            if classifier.state != "succeeded" {
                continue;
            }
            let suffix = classifier.step_key.trim_start_matches("classify-page-");
            let page_number: usize = suffix
                .parse()
                .map_err(|_| EngineError::Invariant("invalid page step key".into()))?;
            let page = outputs_of_type(&snapshot, "docs.page")
                .into_iter()
                .find(|output| output.local_key == format!("page-{page_number:03}"))
                .ok_or_else(|| EngineError::Invariant("decomposed page is missing".into()))?;
            let classification = classifier
                .outputs
                .iter()
                .find(|output| output.type_key == "core.content-classification")
                .ok_or_else(|| EngineError::Invariant("page classification is missing".into()))?;
            let key = format!("represent-page-{page_number:03}");
            created += self
                .ensure(
                    &snapshot,
                    &key,
                    "mock.represent-page",
                    &[source, page.artifact_id, classification.artifact_id],
                    json!({ "page": page_number }),
                    &[classifier.step_key.as_str()],
                )
                .await?;
        }

        let snapshot = self.repository.case_snapshot(case_id).await?;
        let page_classifiers = matching_steps(&snapshot, "classify-page-");
        if !page_classifiers.is_empty()
            && page_classifiers
                .iter()
                .all(|step| step.state == "succeeded")
        {
            let mut inputs = vec![source];
            inputs.extend(page_classifiers.iter().flat_map(|step| {
                step.outputs
                    .iter()
                    .filter(|output| output.type_key == "core.content-classification")
                    .map(|output| output.artifact_id)
            }));
            let dependencies = page_classifiers
                .iter()
                .map(|step| step.step_key.as_str())
                .collect::<Vec<_>>();
            created += self
                .ensure(
                    &snapshot,
                    "classify-content-refined",
                    "mock.refine-content",
                    &inputs,
                    json!({}),
                    &dependencies,
                )
                .await?;
        }

        let page_representations = matching_steps(&snapshot, "represent-page-");
        if !page_representations.is_empty()
            && page_representations
                .iter()
                .all(|step| step.state == "succeeded")
        {
            let mut inputs = vec![source];
            for step in &page_representations {
                let mut outputs = step.outputs.iter().collect::<Vec<_>>();
                outputs.sort_by_key(|output| match output.type_key.as_str() {
                    "docs.extracted-text" => 0,
                    "docs.text-layout" => 1,
                    _ => 2,
                });
                inputs.extend(outputs.into_iter().map(|output| output.artifact_id));
            }
            let dependencies = page_representations
                .iter()
                .map(|step| step.step_key.as_str())
                .collect::<Vec<_>>();
            created += self
                .ensure(
                    &snapshot,
                    "assemble-text",
                    "mock.assemble-text",
                    &inputs,
                    json!({}),
                    &dependencies,
                )
                .await?;
        }

        let snapshot = self.repository.case_snapshot(case_id).await?;
        if succeeded(&snapshot, "classify-content-refined") && succeeded(&snapshot, "assemble-text")
        {
            let mut inputs = vec![source];
            inputs.extend(
                outputs_for_step(&snapshot, "classify-content-refined")
                    .iter()
                    .chain(outputs_for_step(&snapshot, "assemble-text").iter())
                    .map(|output| output.artifact_id),
            );
            inputs.extend(
                outputs_of_type(&snapshot, "core.content-description")
                    .iter()
                    .map(|output| output.artifact_id),
            );
            created += self
                .ensure(
                    &snapshot,
                    "classify-document",
                    "mock.classify-document",
                    &inputs,
                    json!({}),
                    &["classify-content-refined", "assemble-text"],
                )
                .await?;
        }

        let snapshot = self.repository.case_snapshot(case_id).await?;
        if succeeded(&snapshot, "classify-document") {
            let classification = required_output(
                &snapshot,
                "classify-document",
                "core.document-classification",
            )?;
            if classification
                .payload
                .get("resolvedKind")
                .and_then(Value::as_str)
                == Some("invoice")
            {
                let mut inputs = vec![source, classification.artifact_id];
                inputs.extend(
                    outputs_for_step(&snapshot, "assemble-text")
                        .iter()
                        .map(|output| output.artifact_id),
                );
                created += self
                    .ensure(
                        &snapshot,
                        "extract-invoice",
                        "mock.extract-invoice",
                        &inputs,
                        json!({}),
                        &["classify-document"],
                    )
                    .await?;
            } else {
                self.repository.complete_case(case_id).await?;
            }
        }

        let snapshot = self.repository.case_snapshot(case_id).await?;
        if succeeded(&snapshot, "extract-invoice") {
            let candidate = required_output(
                &snapshot,
                "extract-invoice",
                "bookkeeping.invoice-candidate",
            )?;
            created += self
                .ensure(
                    &snapshot,
                    "validate-invoice",
                    "mock.validate-invoice",
                    &[source, candidate.artifact_id],
                    json!({}),
                    &["extract-invoice"],
                )
                .await?;
        }

        let snapshot = self.repository.case_snapshot(case_id).await?;
        if succeeded(&snapshot, "validate-invoice") {
            self.repository.complete_case(case_id).await?;
        }
        Ok(created)
    }

    #[allow(clippy::too_many_lines)]
    async fn plan_real_case(&self, case_id: Uuid) -> Result<usize, EngineError> {
        let snapshot = self.repository.case_snapshot(case_id).await?;
        let source = snapshot.source_artifact_id;
        let mut created = self
            .ensure(
                &snapshot,
                "inspect",
                "core.inspect-file",
                &[source],
                json!({}),
                &[],
            )
            .await?;

        let snapshot = self.repository.case_snapshot(case_id).await?;
        if succeeded(&snapshot, "inspect") {
            let inspection = required_output(&snapshot, "inspect", "core.file-inspection")?;
            if inspection.payload.get("outcome").and_then(Value::as_str) != Some("ok") {
                self.repository.needs_review_case(case_id).await?;
                return Ok(created);
            }
            created += self
                .ensure(
                    &snapshot,
                    "decompose-pages",
                    "docs.decompose-pages",
                    &[source, inspection.artifact_id],
                    json!({}),
                    &["inspect"],
                )
                .await?;
        }

        let snapshot = self.repository.case_snapshot(case_id).await?;
        if succeeded(&snapshot, "decompose-pages") {
            let mut pages = outputs_of_type(&snapshot, "docs.page");
            pages.sort_by(|left, right| left.local_key.cmp(&right.local_key));
            for (index, page) in pages.iter().enumerate() {
                let page_number = index + 1;
                created += self
                    .ensure(
                        &snapshot,
                        &format!("extract-native-page-{page_number:03}"),
                        "docs.extract-native-text",
                        &[source, page.artifact_id],
                        json!({ "page": page_number }),
                        &["decompose-pages"],
                    )
                    .await?;
            }
        }

        let snapshot = self.repository.case_snapshot(case_id).await?;
        let extractors = matching_steps(&snapshot, "extract-native-page-");
        let page_count = extractors.len();
        if self
            .vision
            .as_ref()
            .is_some_and(|adapter| page_count > adapter.max_pages())
        {
            self.repository.needs_review_case(case_id).await?;
            return Ok(created);
        }

        // Finance understanding consumes the original document plus any cheap native text.
        // Page OCR/layout is useful enrichment, but must not be a correctness or availability
        // gate for document classification and extraction.
        if let Some(adapter) = &self.vision {
            if !extractors.is_empty() && extractors.iter().all(|step| step.state == "succeeded") {
                let mut inputs = vec![source];
                inputs.extend(
                    extractors
                        .iter()
                        .flat_map(|step| step.outputs.iter().map(|output| output.artifact_id)),
                );
                let dependencies = extractors
                    .iter()
                    .map(|step| step.step_key.as_str())
                    .collect::<Vec<_>>();
                created += self
                    .ensure(
                        &snapshot,
                        "classify-document",
                        "model.classify-document",
                        &inputs,
                        json!({
                            "pageCount": page_count,
                            "modelDeployment": adapter.model(),
                            "modelProfile": adapter.profile().as_str(),
                            "contractVersion": "aven-finance-vision-v2"
                        }),
                        &dependencies,
                    )
                    .await?;
            }
        }

        for extractor in &extractors {
            if extractor.state != "succeeded" {
                continue;
            }
            let suffix = extractor
                .step_key
                .trim_start_matches("extract-native-page-");
            let page_number: usize = suffix
                .parse()
                .map_err(|_| EngineError::Invariant("invalid native-text step key".into()))?;
            let page = outputs_of_type(&snapshot, "docs.page")
                .into_iter()
                .find(|output| output.local_key == format!("page-{page_number:03}"))
                .ok_or_else(|| EngineError::Invariant("decomposed page is missing".into()))?;
            let mut inputs = vec![source, page.artifact_id];
            inputs.extend(extractor.outputs.iter().map(|output| output.artifact_id));
            let (key, procedure, parameters) = if let Some(adapter) = &self.vision {
                (
                    format!("analyze-page-{page_number:03}"),
                    "model.analyze-page",
                    json!({
                        "page": page_number,
                        "pageCount": page_count,
                        "modelDeployment": adapter.model(),
                        "modelProfile": adapter.profile().as_str(),
                        "contractVersion": "aven-finance-vision-v2",
                        "required": false
                    }),
                )
            } else {
                (
                    format!("classify-page-{page_number:03}"),
                    "core.classify-page-signals",
                    json!({ "page": page_number }),
                )
            };
            created += self
                .ensure(
                    &snapshot,
                    &key,
                    procedure,
                    &inputs,
                    parameters,
                    &[extractor.step_key.as_str()],
                )
                .await?;
        }

        let snapshot = self.repository.case_snapshot(case_id).await?;
        let representations = if self.vision.is_some() {
            matching_steps(&snapshot, "analyze-page-")
        } else {
            matching_steps(&snapshot, "extract-native-page-")
        };
        if !representations.is_empty()
            && representations.iter().all(|step| step.state == "succeeded")
        {
            let mut inputs = vec![source];
            for representation in &representations {
                let mut outputs = representation.outputs.iter().collect::<Vec<_>>();
                outputs.sort_by_key(|output| match output.type_key.as_str() {
                    "docs.extracted-text" => 0,
                    "docs.text-layout" => 1,
                    _ => 2,
                });
                inputs.extend(outputs.into_iter().map(|output| output.artifact_id));
            }
            let dependencies = representations
                .iter()
                .map(|step| step.step_key.as_str())
                .collect::<Vec<_>>();
            created += self
                .ensure(
                    &snapshot,
                    "assemble-document",
                    "docs.assemble-document-representation",
                    &inputs,
                    json!({ "required": false }),
                    &dependencies,
                )
                .await?;
        }

        let snapshot = self.repository.case_snapshot(case_id).await?;
        let classifiers = if self.vision.is_some() {
            matching_steps(&snapshot, "analyze-page-")
        } else {
            matching_steps(&snapshot, "classify-page-")
        };
        if !classifiers.is_empty()
            && classifiers.iter().all(|step| step.state == "succeeded")
            && succeeded(&snapshot, "assemble-document")
        {
            let mut inputs = vec![source];
            inputs.extend(classifiers.iter().flat_map(|step| {
                step.outputs
                    .iter()
                    .filter(|output| output.type_key == "core.content-classification")
                    .map(|output| output.artifact_id)
            }));
            let mut dependencies = classifiers
                .iter()
                .map(|step| step.step_key.as_str())
                .collect::<Vec<_>>();
            dependencies.push("assemble-document");
            created += self
                .ensure(
                    &snapshot,
                    "aggregate-content",
                    "core.aggregate-content-classification",
                    &inputs,
                    json!({ "required": false }),
                    &dependencies,
                )
                .await?;
        }

        let snapshot = self.repository.case_snapshot(case_id).await?;
        if self.vision.is_none() && succeeded(&snapshot, "aggregate-content") {
            self.repository.complete_case(case_id).await?;
        }

        let snapshot = self.repository.case_snapshot(case_id).await?;
        if let (Some(adapter), true) = (&self.vision, succeeded(&snapshot, "classify-document")) {
            let classification = required_output(
                &snapshot,
                "classify-document",
                "core.document-classification",
            )?;
            let kind = classification
                .payload
                .get("resolvedKind")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let mut inputs = vec![source, classification.artifact_id];
            inputs.extend(
                matching_steps(&snapshot, "extract-native-page-")
                    .iter()
                    .flat_map(|step| step.outputs.iter().map(|output| output.artifact_id)),
            );
            let parameters = json!({
                "pageCount": page_count,
                "modelDeployment": adapter.model(),
                "modelProfile": adapter.profile().as_str(),
                "contractVersion": "aven-finance-vision-v2"
            });
            if matches!(
                kind,
                "invoice"
                    | "credit-note"
                    | "receipt"
                    | "self-issued-receipt"
                    | "mandate"
                    | "order-confirmation"
                    | "offer"
                    | "reminder"
            ) {
                created += self
                    .ensure(
                        &snapshot,
                        "extract-invoice",
                        "model.extract-invoice",
                        &inputs,
                        parameters,
                        &["classify-document"],
                    )
                    .await?;
            } else if matches!(kind, "bank-statement" | "payment-receipt") {
                created += self
                    .ensure(
                        &snapshot,
                        "extract-statement",
                        "model.extract-statement",
                        &inputs,
                        parameters,
                        &["classify-document"],
                    )
                    .await?;
            } else if real_enrichment_settled(&snapshot, page_count) {
                self.repository.needs_review_case(case_id).await?;
            }
        }

        let snapshot = self.repository.case_snapshot(case_id).await?;
        if succeeded(&snapshot, "extract-invoice") {
            let candidate = required_output(
                &snapshot,
                "extract-invoice",
                "bookkeeping.invoice-candidate",
            )?;
            created += self
                .ensure(
                    &snapshot,
                    "validate-invoice",
                    "bookkeeping.validate-invoice",
                    &[source, candidate.artifact_id],
                    json!({}),
                    &["extract-invoice"],
                )
                .await?;
        }
        if succeeded(&snapshot, "extract-statement") {
            let candidate = required_output(
                &snapshot,
                "extract-statement",
                "banking.account-statement-candidate",
            )?;
            created += self
                .ensure(
                    &snapshot,
                    "validate-statement",
                    "banking.validate-statement",
                    &[source, candidate.artifact_id],
                    json!({}),
                    &["extract-statement"],
                )
                .await?;
        }

        let snapshot = self.repository.case_snapshot(case_id).await?;
        if (succeeded(&snapshot, "validate-invoice") || succeeded(&snapshot, "validate-statement"))
            && real_enrichment_settled(&snapshot, page_count)
        {
            self.repository.complete_case(case_id).await?;
        }
        Ok(created)
    }

    async fn ensure(
        &self,
        snapshot: &CaseSnapshot,
        step_key: &str,
        procedure_key: &str,
        inputs: &[Uuid],
        parameters: Value,
        dependencies: &[&str],
    ) -> Result<usize, EngineError> {
        if snapshot.steps.iter().any(|step| step.step_key == step_key) {
            return Ok(0);
        }
        self.repository
            .ensure_step(
                snapshot.id,
                step_key,
                procedure_key,
                inputs,
                &parameters,
                dependencies,
            )
            .await?;
        Ok(1)
    }

    async fn execute_one(&self) -> Result<bool, EngineError> {
        let Some(step) = self.repository.claim_step(ATTEMPT_LEASE).await? else {
            return Ok(false);
        };
        let mut inputs = Vec::new();
        for artifact_id in &step.input_artifact_ids {
            let envelope = self.store.get_artifact(step.scope_id, *artifact_id).await?;
            let content = if envelope.blob.is_some() {
                Some(self.store.get_content(step.scope_id, *artifact_id).await?)
            } else {
                None
            };
            inputs.push(MaterializedInput { envelope, content });
            self.repository
                .heartbeat_attempt(&step, ATTEMPT_LEASE)
                .await?;
        }
        if step.procedure_key.starts_with("model.") {
            self.execute_model_step(&step, &inputs).await?;
            return Ok(true);
        }
        let execution_step = step.clone();
        let mut execution = tokio::task::spawn_blocking(move || execute(&execution_step, &inputs));
        let execution_result = loop {
            tokio::select! {
                result = &mut execution => {
                    break result.map_err(|error| {
                        EngineError::Executor(ExecutorError::Internal(format!(
                            "adapter task failed: {error}"
                        )))
                    })?;
                }
                () = tokio::time::sleep(std::time::Duration::from_secs(10)) => {
                    self.repository.heartbeat_attempt(&step, ATTEMPT_LEASE).await?;
                }
            }
        };
        match execution_result {
            Ok(output) => self.repository.save_outbox(&step, &output).await?,
            Err(error) => {
                self.repository
                    .fail_attempt(
                        &step,
                        error.code(),
                        &error.to_string(),
                        error.retryable(),
                        MAX_ATTEMPTS,
                    )
                    .await?;
            }
        }
        Ok(true)
    }

    #[allow(clippy::too_many_lines)]
    async fn execute_model_step(
        &self,
        step: &crate::model::ClaimedStep,
        inputs: &[MaterializedInput],
    ) -> Result<(), EngineError> {
        let Some(adapter) = &self.vision else {
            let error = ExecutorError::Unsupported("vision adapter is disabled".into());
            self.repository
                .fail_attempt(step, error.code(), &error.to_string(), false, MAX_ATTEMPTS)
                .await?;
            return Ok(());
        };
        let prepared = match adapter.prepare(step, inputs).await {
            Ok(prepared) => prepared,
            Err(error) => {
                self.repository
                    .fail_attempt(
                        step,
                        error.code(),
                        &error.to_string(),
                        error.retryable(),
                        MAX_ATTEMPTS,
                    )
                    .await?;
                return Ok(());
            }
        };
        match self
            .repository
            .lease_model_call(step, &prepared, adapter.ledger_lease())
            .await?
        {
            ModelCallLease::Cached(completed) => {
                match adapter.materialize(step, inputs, &completed) {
                    Ok(output) => self.repository.save_outbox(step, &output).await?,
                    Err(error) => {
                        self.repository
                            .fail_attempt(
                                step,
                                error.code(),
                                &error.to_string(),
                                false,
                                MAX_ATTEMPTS,
                            )
                            .await?;
                    }
                }
            }
            ModelCallLease::Busy => {
                let error = ExecutorError::Unavailable(
                    "the exact model request is already leased by another attempt".into(),
                );
                self.repository
                    .fail_attempt(step, error.code(), &error.to_string(), true, MAX_ATTEMPTS)
                    .await?;
                return Ok(());
            }
            ModelCallLease::Acquired { fencing_token } => {
                // Keep the durable exact-request identity stable, but give each bounded
                // provider retry its own idempotency key so a corrected retry cannot be
                // pinned to a provider-cached malformed answer.
                let provider_attempt_key = format!("{}-{fencing_token}", prepared.request_key);
                let mut call = std::pin::pin!(adapter.call(&prepared, &provider_attempt_key));
                let result = loop {
                    tokio::select! {
                        result = &mut call => break result,
                        () = tokio::time::sleep(std::time::Duration::from_secs(10)) => {
                            self.repository.heartbeat_attempt(step, ATTEMPT_LEASE).await?;
                        }
                    }
                };
                match result {
                    Ok(completed) => {
                        // A provider response is reusable only after both schema validation
                        // and domain materialization succeed. Otherwise a single bad paid call
                        // would poison every exact retry forever.
                        match adapter.materialize(step, inputs, &completed) {
                            Ok(output) => {
                                self.repository
                                    .complete_model_call(step, &prepared, fencing_token, &completed)
                                    .await?;
                                self.repository.save_outbox(step, &output).await?;
                            }
                            Err(error) => {
                                self.repository
                                    .fail_model_call(step, &prepared, fencing_token, error.code())
                                    .await?;
                                self.repository
                                    .fail_attempt(
                                        step,
                                        error.code(),
                                        &error.to_string(),
                                        true,
                                        MAX_ATTEMPTS,
                                    )
                                    .await?;
                            }
                        }
                    }
                    Err(error) => {
                        self.repository
                            .fail_model_call(step, &prepared, fencing_token, error.code())
                            .await?;
                        self.repository
                            .fail_attempt(
                                step,
                                error.code(),
                                &error.to_string(),
                                error.retryable(),
                                MAX_ATTEMPTS,
                            )
                            .await?;
                        return Ok(());
                    }
                }
            }
        }
        Ok(())
    }

    async fn publish_one(&self) -> Result<bool, EngineError> {
        let Some(mut outbox) = self.repository.pending_outbox().await? else {
            return Ok(false);
        };
        if outbox.state == "pending" {
            for (claim_id, declaration, bytes) in
                generated_uploads(&crate::model::ExecutionOutput {
                    submission: outbox.submission.clone(),
                    blobs: outbox.blobs.clone(),
                })
            {
                if let Err(error) = self
                    .store
                    .stage_upload(outbox.scope_id, claim_id, &declaration, bytes)
                    .await
                {
                    self.repository
                        .record_outbox_failure(
                            &outbox,
                            error.code(),
                            error.retryable(),
                            MAX_ATTEMPTS,
                        )
                        .await?;
                    return Ok(true);
                }
            }
            self.repository.mark_outbox_publishing(outbox.id).await?;
            outbox.state = "publishing".into();
        }
        let context = match self.store.context().await {
            Ok(context) => context,
            Err(error) => {
                self.repository
                    .record_outbox_failure(&outbox, error.code(), error.retryable(), MAX_ATTEMPTS)
                    .await?;
                return Ok(true);
            }
        };
        let result = match self
            .store
            .publish(
                outbox.scope_id,
                outbox.publication_id,
                context.store_epoch,
                &outbox.submission,
            )
            .await
        {
            Ok(result) => result,
            Err(error) => {
                self.repository
                    .record_outbox_failure(&outbox, error.code(), error.retryable(), MAX_ATTEMPTS)
                    .await?;
                return Ok(true);
            }
        };
        let mut envelopes = Vec::new();
        for artifact in &result.artifacts {
            match self
                .store
                .get_artifact(outbox.scope_id, artifact.artifact_id)
                .await
            {
                Ok(envelope) => envelopes.push(envelope),
                Err(error) => {
                    self.repository
                        .record_outbox_failure(
                            &outbox,
                            error.code(),
                            error.retryable(),
                            MAX_ATTEMPTS,
                        )
                        .await?;
                    return Ok(true);
                }
            }
        }
        self.repository
            .acknowledge(&outbox, &result, &envelopes)
            .await?;
        self.refresh_presentation(outbox.case_id).await?;
        Ok(true)
    }

    async fn refresh_presentation(&self, case_id: Uuid) -> Result<(), EngineError> {
        let snapshot = self.repository.case_snapshot(case_id).await?;
        let source = self
            .store
            .get_artifact(snapshot.scope_id, snapshot.source_artifact_id)
            .await?;
        let source_payload = serde_json::to_value(&source.payload)
            .map_err(|error| EngineError::Invariant(error.to_string()))?;
        let status = build_presentation(&snapshot, &source_payload);
        self.repository
            .save_presentation(case_id, snapshot.source_artifact_id, &status)
            .await?;
        Ok(())
    }
}

fn succeeded(snapshot: &CaseSnapshot, key: &str) -> bool {
    snapshot
        .steps
        .iter()
        .any(|step| step.step_key == key && step.state == "succeeded")
}

fn terminal(step: &StepSnapshot) -> bool {
    matches!(
        step.state.as_str(),
        "succeeded" | "failed" | "skipped" | "needs_review" | "unsupported"
    )
}

fn real_enrichment_settled(snapshot: &CaseSnapshot, page_count: usize) -> bool {
    let analyses = matching_steps(snapshot, "analyze-page-");
    if analyses.len() != page_count || !analyses.iter().all(|step| terminal(step)) {
        return false;
    }
    if analyses.iter().any(|step| step.state != "succeeded") {
        return true;
    }
    let Some(assembly) = snapshot
        .steps
        .iter()
        .find(|step| step.step_key == "assemble-document")
    else {
        return false;
    };
    if !terminal(assembly) {
        return false;
    }
    if assembly.state != "succeeded" {
        return true;
    }
    snapshot
        .steps
        .iter()
        .find(|step| step.step_key == "aggregate-content")
        .is_some_and(terminal)
}

fn matching_steps<'a>(snapshot: &'a CaseSnapshot, prefix: &str) -> Vec<&'a StepSnapshot> {
    snapshot
        .steps
        .iter()
        .filter(|step| step.step_key.starts_with(prefix))
        .collect()
}

fn outputs_for_step<'a>(snapshot: &'a CaseSnapshot, key: &str) -> &'a [StoredOutput] {
    snapshot
        .steps
        .iter()
        .find(|step| step.step_key == key)
        .map_or(&[], |step| step.outputs.as_slice())
}

fn outputs_of_type<'a>(snapshot: &'a CaseSnapshot, type_key: &str) -> Vec<&'a StoredOutput> {
    snapshot
        .steps
        .iter()
        .flat_map(|step| &step.outputs)
        .filter(|output| output.type_key == type_key)
        .collect()
}

fn required_output<'a>(
    snapshot: &'a CaseSnapshot,
    step_key: &str,
    type_key: &str,
) -> Result<&'a StoredOutput, EngineError> {
    outputs_for_step(snapshot, step_key)
        .iter()
        .find(|output| output.type_key == type_key)
        .ok_or_else(|| EngineError::Invariant(format!("{step_key} produced no {type_key}")))
}

#[allow(clippy::too_many_lines)]
fn build_presentation(snapshot: &CaseSnapshot, source: &Value) -> ProcessingStatus {
    let mut preferred_type = "file".to_owned();
    let mut label = source
        .get("originalName")
        .and_then(Value::as_str)
        .unwrap_or("File")
        .to_owned();
    let mut summary = None;
    let mut metadata = json!({});
    if let Some(inspection) = outputs_of_type(snapshot, "core.file-inspection").last() {
        if let Some(value) = inspection
            .payload
            .get("detectedMediaType")
            .and_then(Value::as_str)
        {
            value.clone_into(&mut preferred_type);
        }
    }
    if let Some(classification) = outputs_of_type(snapshot, "core.content-classification").last() {
        if let Some(value) = classification
            .payload
            .get("primaryKind")
            .and_then(Value::as_str)
        {
            value.clone_into(&mut preferred_type);
        }
    }
    if let Some(classification) = outputs_of_type(snapshot, "core.document-classification").last() {
        if let Some(value) = classification
            .payload
            .get("resolvedKind")
            .and_then(Value::as_str)
        {
            value.clone_into(&mut preferred_type);
        }
    }
    if let Some(invoice) = outputs_of_type(snapshot, "bookkeeping.invoice-candidate").last() {
        let document_kind = outputs_of_type(snapshot, "bookkeeping.invoice-details")
            .last()
            .and_then(|details| details.payload.get("documentKind"))
            .and_then(Value::as_str)
            .or_else(|| {
                outputs_of_type(snapshot, "core.document-classification")
                    .last()
                    .and_then(|classification| classification.payload.get("resolvedKind"))
                    .and_then(Value::as_str)
            })
            .unwrap_or("invoice");
        document_kind.clone_into(&mut preferred_type);
        let identifier = invoice
            .payload
            .get("invoiceNumber")
            .and_then(Value::as_str)
            .unwrap_or("");
        let title = match document_kind {
            "credit-note" => "Credit note",
            "receipt" => "Receipt",
            "self-issued-receipt" => "Self-issued receipt",
            "order-confirmation" => "Order confirmation",
            "offer" => "Offer",
            "reminder" => "Reminder",
            "mandate" => "Mandate",
            _ => "Invoice",
        };
        label = if identifier.is_empty() {
            title.to_owned()
        } else {
            format!("{title} {identifier}")
        };
        summary = invoice
            .payload
            .get("summary")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        metadata = invoice.payload.clone();
    }
    if let Some(statement) = outputs_of_type(snapshot, "banking.account-statement-candidate").last()
    {
        statement
            .payload
            .get("statementKind")
            .and_then(Value::as_str)
            .unwrap_or("bank-statement")
            .clone_into(&mut preferred_type);
        label = if preferred_type == "payment-receipt" {
            "Payment receipt".into()
        } else {
            "Account statement".into()
        };
        summary = statement
            .payload
            .get("summary")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        metadata = statement.payload.clone();
    }
    let mut warnings = snapshot
        .steps
        .iter()
        .filter(|step| step.state == "failed")
        .map(|step| ProcessingWarning {
            code: step
                .terminal_code
                .clone()
                .unwrap_or_else(|| "processing-failed".into()),
            message: format!(
                "Stage {} failed; the last valid presentation is retained.",
                step.step_key
            ),
            retryable: false,
        })
        .collect::<Vec<_>>();
    if let Some(step) = snapshot.steps.iter().find(|step| {
        matches!(
            step.step_key.as_str(),
            "extract-invoice" | "extract-statement"
        ) && step.state == "succeeded"
    }) {
        if let Some(status) = step
            .receipt
            .as_ref()
            .and_then(|receipt| receipt.pointer("/grounding/status"))
            .and_then(Value::as_str)
            .filter(|status| *status != "complete")
        {
            warnings.push(ProcessingWarning {
                code: "extraction-grounding-incomplete".into(),
                message: format!(
                    "Core fields were extracted, but source grounding is {status}; ungrounded fields must not drive automatic actions."
                ),
                retryable: false,
            });
        }
    }
    if let Some(inspection) = outputs_of_type(snapshot, "core.file-inspection").last() {
        if let Some(outcome) = inspection.payload.get("outcome").and_then(Value::as_str) {
            if outcome != "ok" {
                warnings.push(ProcessingWarning {
                    code: format!("file-{outcome}"),
                    message: format!(
                        "File inspection ended as {outcome}; no narrower representation was attempted."
                    ),
                    retryable: false,
                });
            }
        }
    }
    if snapshot.state == "needs_review"
        && outputs_of_type(snapshot, "core.content-classification")
            .last()
            .is_some_and(|classification| {
                classification
                    .payload
                    .get("complete")
                    .and_then(Value::as_bool)
                    != Some(true)
            })
    {
        warnings.push(ProcessingWarning {
            code: "semantic-analysis-incomplete".into(),
            message: "The last deterministic representation is valid, but OCR or semantic analysis is still required.".into(),
            retryable: false,
        });
    }
    if let Some(validation) = outputs_of_type(snapshot, "bookkeeping.invoice-validation").last() {
        match validation.payload.get("status").and_then(Value::as_str) {
            Some("inconsistent") => warnings.push(ProcessingWarning {
                code: "invoice-inconsistent".into(),
                message: "Invoice checks found a contradiction.".into(),
                retryable: false,
            }),
            Some("insufficient-coverage") => warnings.push(ProcessingWarning {
                code: "invoice-validation-incomplete".into(),
                message: "Core fields were extracted, but some invoice checks need explicit adjustment coverage.".into(),
                retryable: false,
            }),
            _ => {}
        }
    }
    if let Some(validation) = outputs_of_type(snapshot, "banking.statement-validation").last() {
        if validation.payload.get("status").and_then(Value::as_str) == Some("inconsistent") {
            warnings.push(ProcessingWarning {
                code: "statement-inconsistent".into(),
                message: "Statement consistency checks found a contradiction.".into(),
                retryable: false,
            });
        }
    }
    let stages = snapshot
        .steps
        .iter()
        .map(|step| ProcessingStage {
            key: step.step_key.clone(),
            state: step.state.clone(),
            procedure_key: step.procedure_key.clone(),
            depends_on: step.dependencies.clone(),
            attempt_count: step.attempt_count,
            terminal_code: step.terminal_code.clone(),
        })
        .collect();
    let mut deduplicated = BTreeMap::new();
    for step in &snapshot.steps {
        for output in &step.outputs {
            deduplicated.insert(
                output.artifact_id,
                DerivedArtifact {
                    artifact_id: output.artifact_id,
                    type_key: output.type_key.clone(),
                    type_version: output.type_version,
                    stage_key: step.step_key.clone(),
                },
            );
        }
    }
    ProcessingStatus {
        source_artifact_id: snapshot.source_artifact_id,
        case_id: snapshot.id,
        state: snapshot.state.clone(),
        plan_key: snapshot.plan_key.clone(),
        plan_version: snapshot.plan_version.clone(),
        projection_version: PROCESSING_PROJECTION_VERSION.into(),
        preferred_type,
        label,
        summary,
        metadata,
        warnings,
        stages,
        derived_artifacts: deduplicated.into_values().collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_projection_starts_as_file() {
        let snapshot = CaseSnapshot {
            id: Uuid::new_v4(),
            scope_id: Uuid::new_v4(),
            source_artifact_id: Uuid::new_v4(),
            plan_key: "artifact-understanding-local".into(),
            plan_version: "2".into(),
            state: "active".into(),
            steps: vec![],
        };
        let status = build_presentation(&snapshot, &json!({"originalName":"scan.pdf"}));
        assert_eq!(status.preferred_type, "file");
        assert_eq!(status.label, "scan.pdf");
    }

    #[test]
    fn projection_exposes_the_runtime_step_graph() {
        let snapshot = CaseSnapshot {
            id: Uuid::new_v4(),
            scope_id: Uuid::new_v4(),
            source_artifact_id: Uuid::new_v4(),
            plan_key: "artifact-understanding-local".into(),
            plan_version: "2".into(),
            state: "active".into(),
            steps: vec![
                StepSnapshot {
                    id: Uuid::new_v4(),
                    step_key: "inspect".into(),
                    procedure_key: "core.inspect-file".into(),
                    state: "succeeded".into(),
                    dependencies: vec![],
                    attempt_count: 1,
                    terminal_code: None,
                    receipt: None,
                    outputs: vec![],
                },
                StepSnapshot {
                    id: Uuid::new_v4(),
                    step_key: "decompose-pages".into(),
                    procedure_key: "docs.decompose-pages".into(),
                    state: "running".into(),
                    dependencies: vec!["inspect".into()],
                    attempt_count: 2,
                    terminal_code: None,
                    receipt: None,
                    outputs: vec![],
                },
            ],
        };
        let status = build_presentation(&snapshot, &json!({"originalName":"scan.pdf"}));
        assert_eq!(status.projection_version, PROCESSING_PROJECTION_VERSION);
        assert_eq!(status.stages[1].depends_on, vec!["inspect"]);
        assert_eq!(status.stages[1].procedure_key, "docs.decompose-pages");
        assert_eq!(status.stages[1].attempt_count, 2);

        let json = serde_json::to_value(status).expect("processing status serializes");
        assert_eq!(json["stages"][1]["dependsOn"][0], "inspect");
        assert!(json["stages"][0].get("dependsOn").is_none());
    }
}

use aven_artifact_store_contract::PublicationSubmission;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub const PROCESSING_PROJECTION_VERSION: &str = "artifact-presentation-v3";

#[derive(Clone, Debug)]
pub struct ClaimedStep {
    pub id: Uuid,
    pub case_id: Uuid,
    pub scope_id: Uuid,
    pub source_artifact_id: Uuid,
    pub step_key: String,
    pub procedure_key: String,
    pub publication_id: Uuid,
    pub input_artifact_ids: Vec<Uuid>,
    pub parameters: Value,
    pub attempt_id: Uuid,
    pub fencing_token: Uuid,
    pub attempt_number: i32,
}

#[derive(Clone, Debug)]
pub struct GeneratedBlob {
    pub local_key: String,
    pub claim_id: Uuid,
    pub media_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct ExecutionOutput {
    pub submission: PublicationSubmission,
    pub blobs: Vec<GeneratedBlob>,
}

#[derive(Clone, Debug)]
pub struct PendingOutbox {
    pub id: Uuid,
    pub step_id: Uuid,
    pub case_id: Uuid,
    pub scope_id: Uuid,
    pub publication_id: Uuid,
    pub state: String,
    pub submission: PublicationSubmission,
    pub blobs: Vec<GeneratedBlob>,
}

#[derive(Clone, Debug)]
pub struct CaseSnapshot {
    pub id: Uuid,
    pub scope_id: Uuid,
    pub source_artifact_id: Uuid,
    pub plan_key: String,
    pub plan_version: String,
    pub state: String,
    pub steps: Vec<StepSnapshot>,
}

#[derive(Clone, Debug)]
pub struct StepSnapshot {
    pub id: Uuid,
    pub step_key: String,
    pub procedure_key: String,
    pub state: String,
    pub dependencies: Vec<String>,
    pub attempt_count: i32,
    pub terminal_code: Option<String>,
    pub receipt: Option<Value>,
    pub outputs: Vec<StoredOutput>,
}

#[derive(Clone, Debug)]
pub struct StoredOutput {
    pub local_key: String,
    pub artifact_id: Uuid,
    pub type_key: String,
    pub type_version: i32,
    pub payload: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingStatus {
    pub source_artifact_id: Uuid,
    pub case_id: Uuid,
    pub state: String,
    pub plan_key: String,
    pub plan_version: String,
    pub projection_version: String,
    pub preferred_type: String,
    pub label: String,
    pub summary: Option<String>,
    pub metadata: Value,
    pub warnings: Vec<ProcessingWarning>,
    pub stages: Vec<ProcessingStage>,
    pub derived_artifacts: Vec<DerivedArtifact>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingWarning {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingStage {
    pub key: String,
    pub state: String,
    #[serde(default)]
    pub procedure_key: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub attempt_count: i32,
    #[serde(default)]
    pub terminal_code: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedArtifact {
    pub artifact_id: Uuid,
    pub type_key: String,
    pub type_version: i32,
    pub stage_key: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MockDocument {
    pub title: String,
    pub document_kind: String,
    pub pages: Vec<MockPage>,
    pub invoice: Option<MockInvoice>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MockPage {
    #[serde(default)]
    pub facets: Vec<String>,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub visual_summary: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MockInvoice {
    pub supplier: String,
    pub invoice_number: String,
    pub currency: String,
    pub net_minor: i64,
    pub tax_minor: i64,
    pub gross_minor: i64,
    pub due_date: Option<String>,
}

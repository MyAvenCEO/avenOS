use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentAttachmentInput {
	pub filename: String,
	#[serde(default)]
	pub media_role: Option<String>,
	#[serde(default)]
	pub mime_type: Option<String>,
	pub bytes_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentListProjection {
	pub id: String,
	pub title: String,
	pub summary: String,
	pub status: String,
	pub updated_at_ms: u64,
	#[serde(default)]
	pub last_work_duration_ms: Option<u64>,
	pub open_communication_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentRuntimeSnapshot {
	pub intents: Vec<IntentListProjection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentRuntimeEnvelope {
	pub id: String,
	pub op: String,
	#[serde(default)]
	pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentRuntimeResponse {
	#[serde(default)]
	pub id: Option<String>,
	#[serde(default)]
	pub ok: Option<bool>,
	#[serde(default)]
	pub result: Option<Value>,
	#[serde(default)]
	pub error: Option<String>,
	#[serde(default)]
	pub event: Option<Value>,
}

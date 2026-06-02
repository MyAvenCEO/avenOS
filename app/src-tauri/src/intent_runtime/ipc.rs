use serde_json::{json, Value};

use super::manager::IntentRuntimeManager;

pub async fn intent_status(manager: &IntentRuntimeManager) -> Result<Value, String> {
	manager.request("intentStatus", json!({})).await
}

pub async fn intent_list(manager: &IntentRuntimeManager) -> Result<Value, String> {
	manager.request("intentList", json!({})).await
}

pub async fn intent_get(manager: &IntentRuntimeManager, intent_id: String) -> Result<Value, String> {
	manager.request("intentGet", json!({ "intentId": intent_id })).await
}

pub async fn intent_start(
	manager: &IntentRuntimeManager,
	message: String,
	attachments: Value,
) -> Result<Value, String> {
	manager
		.request(
			"intentStart",
			json!({
				"message": message,
				"attachments": attachments,
			}),
		)
		.await
}

pub async fn intent_retrain(
	manager: &IntentRuntimeManager,
	intent_id: String,
	communication_id: String,
	feedback: String,
	attachments: Value,
) -> Result<Value, String> {
	manager
		.request(
			"intentRetrain",
			json!({
				"intentId": intent_id,
				"communicationId": communication_id,
				"feedback": feedback,
				"attachments": attachments,
			}),
		)
		.await
}

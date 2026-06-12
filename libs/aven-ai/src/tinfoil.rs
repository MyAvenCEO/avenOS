//! Confidential CLOUD chat via the Tinfoil enclave SDK — the cloud counterpart to the
//! on-device [`crate::llama`] path. One stateless primitive: a single OpenAI-style chat
//! completion round ([`chat`]) over `messages` + `tools`. The TOOL LOOP lives in the
//! caller (the webview executes tool calls against avenDB and re-calls with appended
//! `role:"tool"` results), so this module stays Tauri-free and side-effect-free.
//!
//! The SDK (`tinfoil` crate, git-only, wraps `async-openai`) reads `TINFOIL_API_KEY`
//! from the environment and performs enclave attestation on first connect; the client
//! is cached for the process so attestation runs once.

use serde::Serialize;
use serde_json::Value;
use tinfoil::Client;
use tokio::sync::OnceCell;

/// Default chat model — Gemma 4 31B (native function calling, 256K context).
pub const DEFAULT_MODEL: &str = "gemma4-31b";

/// One tool call the model requested this round. `arguments` is the parsed JSON object
/// (`Value::Null` when the model emitted unparseable arguments — the caller surfaces it).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallOut {
	pub id: String,
	pub name: String,
	pub arguments: Value,
}

/// The result of one chat completion round. `assistant_raw` is the raw
/// `/choices/0/message` value so the caller can re-append the assistant turn verbatim
/// (tool-call ids intact) before sending the `role:"tool"` results back.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurn {
	pub content: Option<String>,
	pub tool_calls: Vec<ToolCallOut>,
	pub assistant_raw: Value,
	/// Total tokens billed for this round (prompt + completion) from the response's
	/// usage block; 0 when the endpoint omits it. Surfaced per-step in the dreaming
	/// panel for the extractor path.
	pub total_tokens: i64,
}

/// Whether the cloud path can run at all: `TINFOIL_API_KEY` is set and non-empty.
pub fn available() -> bool {
	std::env::var("TINFOIL_API_KEY")
		.map(|v| !v.trim().is_empty())
		.unwrap_or(false)
}

/// Process-wide client: built once (env key + enclave discovery + attestation), reused.
async fn client() -> Result<&'static Client, String> {
	static CLIENT: OnceCell<Client> = OnceCell::const_new();
	CLIENT
		.get_or_try_init(|| async {
			Client::new_default()
				.await
				.map_err(|e| format!("tinfoil client init: {e}"))
		})
		.await
}

/// Run ONE chat completion round. `messages` is the full OpenAI conversation so far
/// (system / user / assistant / tool entries, verbatim JSON); `tools` is the OpenAI
/// `tools` array (pass an empty array to force a plain-text final reply).
pub async fn chat(messages: Vec<Value>, tools: Value, model: &str) -> Result<ChatTurn, String> {
	let client = client().await?;
	let mut body = client.chat_relaxed().request().model(model).messages(messages);
	let has_tools = tools.as_array().map(|a| !a.is_empty()).unwrap_or(false);
	if has_tools {
		body = body.set("tools", tools);
	}
	let response = tokio::time::timeout(
		std::time::Duration::from_secs(60),
		client.chat_relaxed().create(body),
	)
	.await
	.map_err(|_| "tinfoil chat: request timed out after 60 s".to_string())?
	.map_err(|e| format!("tinfoil chat: {e}"))?;

	let assistant_raw = response
		.raw()
		.pointer("/choices/0/message")
		.cloned()
		.unwrap_or(Value::Null);
	let total_tokens = response
		.raw()
		.pointer("/usage/total_tokens")
		.and_then(Value::as_i64)
		.unwrap_or(0);
	let content = response.content().map(|s| s.to_string());
	let tool_calls = response
		.typed_tool_calls()
		.iter()
		.map(|call| ToolCallOut {
			id: call.id.clone().unwrap_or_default(),
			name: call.function_name.clone().unwrap_or_default(),
			arguments: serde_json::from_str(&call.arguments_raw).unwrap_or(Value::Null),
		})
		.collect();

	Ok(ChatTurn { content, tool_calls, assistant_raw, total_tokens })
}

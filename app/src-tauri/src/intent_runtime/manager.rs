use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

use super::types::{IntentRuntimeEnvelope, IntentRuntimeResponse};

struct IntentRuntimeProcess {
	stdin: ChildStdin,
	child: Child,
	requests: Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>,
}

#[derive(Clone)]
pub struct IntentRuntimeManager {
	app: AppHandle,
	inner: Arc<Mutex<Option<IntentRuntimeProcess>>>,
	state_dir: PathBuf,
	bun_path: PathBuf,
	node_path: PathBuf,
}

impl IntentRuntimeManager {
	pub fn new(app: &AppHandle) -> Self {
		let state_dir = app
			.path()
			.app_local_data_dir()
			.unwrap_or_else(|_| PathBuf::from(".avenos-intent-runtime"))
			.join("intent-runtime");
		Self {
			app: app.clone(),
			inner: Arc::new(Mutex::new(None)),
			state_dir,
			bun_path: PathBuf::from("/home/daniel/.bun/bin/bun"),
			node_path: PathBuf::from("node"),
		}
	}

	async fn ensure_started(&self) -> Result<(), String> {
		let mut guard = self.inner.lock().await;
		if guard.is_some() {
			log::debug!(target: "avenos::intent_runtime", "adapter already started");
			return Ok(());
		}
		std::fs::create_dir_all(&self.state_dir)
			.map_err(|e| format!("intent runtime state dir: {e}"))?;
		let requests: Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>> =
			Arc::new(Mutex::new(HashMap::new()));
		let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
			.parent()
			.and_then(|path| path.parent())
			.ok_or_else(|| "intent runtime repo root not found".to_string())?
			.to_path_buf();
		let external_llm_config = PathBuf::from("/home/daniel/src/jaensen/aven-os-runtime-no-node-modules-20260522-012649/apps/tree-explorer/config/llm-providers.local.json");
		let adapter_dist = repo_root.join("packages/tauri-intent-runtime-adapter/dist/main.mjs");
		let adapter_src = repo_root.join("packages/tauri-intent-runtime-adapter/src/main.ts");
		log::info!(
			target: "avenos::intent_runtime",
			"starting adapter repo_root={} state_dir={} llm_config={} dist_exists={}",
			repo_root.display(),
			self.state_dir.display(),
			external_llm_config.display(),
			adapter_dist.exists(),
		);
		let mut command = if adapter_dist.exists() {
			let mut cmd = Command::new(&self.node_path);
			cmd.arg(adapter_dist);
			cmd
		} else {
			let mut cmd = Command::new(&self.bun_path);
			cmd.arg(adapter_src);
			cmd
		};
		let mut child = command
			.arg("--state-dir")
			.arg(&self.state_dir)
			.current_dir(&repo_root)
			.stdin(std::process::Stdio::piped())
			.stdout(std::process::Stdio::piped())
			.stderr(std::process::Stdio::piped())
			.env("AVEN_LLM_CONFIG", &external_llm_config)
			.spawn()
			.map_err(|e| format!("spawn intent runtime adapter: {e}"))?;
		let stdin = child.stdin.take().ok_or_else(|| "intent runtime stdin unavailable".to_string())?;
		let stdout = child.stdout.take().ok_or_else(|| "intent runtime stdout unavailable".to_string())?;
		let stderr = child.stderr.take().ok_or_else(|| "intent runtime stderr unavailable".to_string())?;
		let app = self.app.clone();
		let requests_for_reader = Arc::clone(&requests);
		tauri::async_runtime::spawn(async move {
			let mut lines = BufReader::new(stderr).lines();
			while let Ok(Some(line)) = lines.next_line().await {
				if line.trim().is_empty() {
					continue;
				}
				log::warn!(target: "avenos::intent_runtime::adapter_stderr", "{line}");
			}
		});
		tauri::async_runtime::spawn(async move {
			let mut lines = BufReader::new(stdout).lines();
			while let Ok(Some(line)) = lines.next_line().await {
				if line.trim().is_empty() {
					continue;
				}
				let parsed: Result<IntentRuntimeResponse, _> = serde_json::from_str(&line);
				match parsed {
					Ok(message) => {
						if let Some(event) = message.event {
							log::debug!(target: "avenos::intent_runtime", "adapter event: {}", event);
							let _ = app.emit("avenos:runtime", event);
							continue;
						}
						if let Some(id) = message.id {
							log::debug!(
								target: "avenos::intent_runtime",
								"adapter response id={} ok={:?} error={:?}",
								id,
								message.ok,
								message.error,
							);
							if let Some(tx) = requests_for_reader.lock().await.remove(&id) {
								let result = if message.ok.unwrap_or(false) {
									Ok(message.result.unwrap_or(Value::Null))
								} else {
									Err(message.error.unwrap_or_else(|| "intent runtime request failed".to_string()))
								};
								let _ = tx.send(result);
							}
						}
					}
					Err(error) => {
						log::warn!(target: "avenos::intent_runtime", "adapter stdout parse failed: {error}");
					}
				}
			}
		});
		*guard = Some(IntentRuntimeProcess { stdin, child, requests });
		log::info!(target: "avenos::intent_runtime", "adapter started successfully");
		Ok(())
	}

	pub async fn request(&self, op: &str, payload: Value) -> Result<Value, String> {
		self.ensure_started().await?;
		let mut guard = self.inner.lock().await;
		let process = guard.as_mut().ok_or_else(|| "intent runtime process missing".to_string())?;
		let id = uuid::Uuid::new_v4().to_string();
		let envelope = IntentRuntimeEnvelope {
			id: id.clone(),
			op: op.to_string(),
			payload,
		};
		log::info!(
			target: "avenos::intent_runtime",
			"sending request id={} op={} payload={}",
			id,
			op,
			envelope.payload,
		);
		let (tx, rx) = oneshot::channel();
		process.requests.lock().await.insert(id.clone(), tx);
		let line = format!("{}\n", serde_json::to_string(&envelope).map_err(|e| e.to_string())?);
		process
			.stdin
			.write_all(line.as_bytes())
			.await
			.map_err(|e| format!("intent runtime stdin write: {e}"))?;
		process.stdin.flush().await.map_err(|e| format!("intent runtime stdin flush: {e}"))?;
		drop(guard);
		match tokio::time::timeout(Duration::from_secs(30), rx).await {
			Ok(Ok(result)) => {
				match &result {
					Ok(value) => log::info!(target: "avenos::intent_runtime", "request id={} op={} succeeded result={}", id, op, value),
					Err(error) => log::warn!(target: "avenos::intent_runtime", "request id={} op={} failed error={}", id, op, error),
				}
				result
			}
			Ok(Err(_)) => {
				log::warn!(target: "avenos::intent_runtime", "request id={} op={} response channel dropped", id, op);
				Err("intent runtime response channel dropped".to_string())
			}
			Err(_) => {
				log::warn!(target: "avenos::intent_runtime", "request id={} op={} timed out", id, op);
				Err("intent runtime request timed out".to_string())
			}
		}
	}
}

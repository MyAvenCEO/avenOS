//! Tauri-owned lifecycle bridge for the private .NET stdio sidecar (`Aven.Sidecar`).
//!
//! Responsibilities (STDIO_RPC_SPEC.md §17, milestone plan M3):
//!  - spawn / stop / restart the .NET child process
//!  - speak `Content-Length` framed JSON on its stdin/stdout (matches M1 framing)
//!  - correlate requests and responses by `id`
//!  - forward sidecar `event` envelopes to the webview as `agent-sidecar:event`
//!  - drain sidecar stderr into the Rust log ring
//!  - preserve STRUCTURED errors (`code`/`message`/`retryable`/`data`) end to end
//!
//! The webview never touches the child process directly — it only calls the
//! `agent_sidecar_*` Tauri commands. All process/path logic is isolated here so
//! packaging changes (M9) never reach UI code.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

/// Webview event name carrying raw sidecar `event` envelopes (D4 passthrough).
pub const SIDECAR_EVENT: &str = "agent-sidecar:event";

const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const STOP_GRACE: Duration = Duration::from_secs(3);

// ---------------------------------------------------------------------------
// Structured error preserved across .NET -> Rust -> TS
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarErr {
	pub code: String,
	pub message: String,
	pub retryable: bool,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub data: Option<Value>,
}

impl SidecarErr {
	fn new(code: &str, message: impl Into<String>, retryable: bool) -> Self {
		Self { code: code.to_string(), message: message.into(), retryable, data: None }
	}

	fn value(&self) -> Value {
		serde_json::to_value(self).unwrap_or_else(|_| json!({ "code": self.code, "message": self.message }))
	}

	fn from_response(v: &Value) -> Self {
		Self {
			code: v.get("code").and_then(Value::as_str).unwrap_or("internal_error").to_string(),
			message: v.get("message").and_then(Value::as_str).unwrap_or_default().to_string(),
			retryable: v.get("retryable").and_then(Value::as_bool).unwrap_or(false),
			data: v.get("data").cloned(),
		}
	}
}

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

type RpcOutcome = Result<Value, SidecarErr>;
type PendingMap = HashMap<String, oneshot::Sender<RpcOutcome>>;
type EventSink = Arc<dyn Fn(Value) + Send + Sync>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
	/// "stopped" | "starting" | "ready" | "crashed"
	pub state: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub capabilities: Option<Value>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub last_error: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub last_exit_code: Option<i32>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub pid: Option<u32>,
}

impl Default for SidecarStatus {
	fn default() -> Self {
		Self { state: "stopped".into(), capabilities: None, last_error: None, last_exit_code: None, pid: None }
	}
}

struct Proc {
	child: Option<Child>,
	stdin: Option<ChildStdin>,
	epoch: u64,
}

impl Default for Proc {
	fn default() -> Self {
		Self { child: None, stdin: None, epoch: 0 }
	}
}

struct Inner {
	proc: Mutex<Proc>,
	pending: std::sync::Mutex<PendingMap>,
	status: std::sync::Mutex<SidecarStatus>,
	next_id: AtomicU64,
}

impl Default for Inner {
	fn default() -> Self {
		Self {
			proc: Mutex::new(Proc::default()),
			pending: std::sync::Mutex::new(HashMap::new()),
			status: std::sync::Mutex::new(SidecarStatus::default()),
			next_id: AtomicU64::new(0),
		}
	}
}

impl Inner {
	fn status_snapshot(&self) -> SidecarStatus {
		self.status.lock().unwrap().clone()
	}

	fn state_name(&self) -> String {
		self.status.lock().unwrap().state.clone()
	}

	fn set_state(&self, state: &str) {
		self.status.lock().unwrap().state = state.to_string();
	}

	fn mark_ready(&self, capabilities: Option<Value>, pid: Option<u32>) {
		let mut s = self.status.lock().unwrap();
		s.state = "ready".into();
		s.capabilities = capabilities;
		s.pid = pid;
		s.last_error = None;
	}

	fn mark_error(&self, state: &str, message: impl Into<String>) {
		let mut s = self.status.lock().unwrap();
		s.state = state.to_string();
		s.last_error = Some(message.into());
	}

	/// Fail every outstanding request — used when the child dies.
	fn fail_all_pending(&self, err: &SidecarErr) {
		let drained: Vec<_> = {
			let mut map = self.pending.lock().unwrap();
			map.drain().map(|(_, tx)| tx).collect()
		};
		for tx in drained {
			let _ = tx.send(Err(err.clone()));
		}
	}
}

/// Tauri-managed handle. Cheaply cloneable so reader tasks can hold the runtime.
#[derive(Default)]
pub struct AgentSidecarState(Arc<Inner>);

impl AgentSidecarState {
	fn shared(&self) -> Arc<Inner> {
		self.0.clone()
	}
}

// ---------------------------------------------------------------------------
// Content-Length framing over the child's stdio
// ---------------------------------------------------------------------------

async fn read_frame<R: AsyncBufReadExt + Unpin>(reader: &mut R) -> std::io::Result<Option<Vec<u8>>> {
	let mut content_length: Option<usize> = None;
	let mut saw_header = false;
	loop {
		let mut line = Vec::new();
		let n = reader.read_until(b'\n', &mut line).await?;
		if n == 0 {
			return if saw_header || content_length.is_some() {
				Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "eof in header block"))
			} else {
				Ok(None) // clean EOF on a message boundary
			};
		}

		while matches!(line.last(), Some(b'\n') | Some(b'\r')) {
			line.pop();
		}
		if line.is_empty() {
			break; // blank line: end of headers
		}
		saw_header = true;

		if let Some(colon) = line.iter().position(|&b| b == b':') {
			let (name, rest) = line.split_at(colon);
			if name.eq_ignore_ascii_case(b"Content-Length") {
				let value = String::from_utf8_lossy(&rest[1..]);
				content_length = value.trim().parse::<usize>().ok();
			}
		}
	}

	let len = content_length
		.ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "missing Content-Length"))?;
	let mut body = vec![0u8; len];
	reader.read_exact(&mut body).await?;
	Ok(Some(body))
}

async fn write_frame<W: AsyncWriteExt + Unpin>(writer: &mut W, body: &[u8]) -> std::io::Result<()> {
	let header = format!("Content-Length: {}\r\n\r\n", body.len());
	writer.write_all(header.as_bytes()).await?;
	writer.write_all(body).await?;
	writer.flush().await?;
	Ok(())
}

// ---------------------------------------------------------------------------
// Process command resolution (kept isolated so packaging changes stay here)
// ---------------------------------------------------------------------------

fn resolve_command() -> Result<Command, SidecarErr> {
	// 1. A fully-built self-contained binary (production / M9 packaging sets this).
	if let Ok(bin) = std::env::var("AVEN_SIDECAR_BIN") {
		if !bin.trim().is_empty() && std::path::Path::new(&bin).exists() {
			return Ok(Command::new(bin));
		}
	}
	// 2. A framework-dependent dll run via `dotnet` (dev path / M9 dev scripts set this).
	if let Ok(dll) = std::env::var("AVEN_SIDECAR_DLL") {
		if !dll.trim().is_empty() {
			let mut cmd = Command::new("dotnet");
			cmd.arg(dll);
			return Ok(cmd);
		}
	}
	// 3. A self-contained binary shipped NEXT TO the app executable (production bundle).
	//    The M9 build step publishes `Aven.Sidecar` (self-contained, per target) into the
	//    bundle so the installed app finds it with no env vars.
	if let Ok(exe) = std::env::current_exe() {
		if let Some(dir) = exe.parent() {
			for name in ["Aven.Sidecar", "aven-sidecar", "Aven.Sidecar.exe"] {
				let candidate = dir.join(name);
				if candidate.exists() {
					return Ok(Command::new(candidate));
				}
			}
		}
	}
	Err(SidecarErr::new(
		"startup_failed",
		"sidecar executable not found; set AVEN_SIDECAR_BIN (self-contained), AVEN_SIDECAR_DLL (dotnet <dll>), or ship Aven.Sidecar next to the app",
		false,
	))
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async fn ensure_started(inner: &Arc<Inner>, sink: &EventSink) -> Result<(), SidecarErr> {
	{
		let proc = inner.proc.lock().await;
		if proc.child.is_some() {
			let state = inner.state_name();
			if state == "ready" || state == "starting" {
				return Ok(());
			}
		}
	}

	inner.set_state("starting");

	let mut cmd = resolve_command()?;
	cmd.stdin(Stdio::piped())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.kill_on_drop(true);

	let mut child = cmd
		.spawn()
		.map_err(|e| SidecarErr::new("startup_failed", format!("failed to spawn sidecar: {e}"), false))?;

	let pid = child.id();
	let stdout = child.stdout.take().expect("piped stdout");
	let stderr = child.stderr.take().expect("piped stderr");
	let stdin = child.stdin.take().expect("piped stdin");

	let epoch = {
		let mut proc = inner.proc.lock().await;
		proc.epoch += 1;
		proc.child = Some(child);
		proc.stdin = Some(stdin);
		proc.epoch
	};

	spawn_stdout_reader(inner.clone(), stdout, sink.clone(), epoch);
	spawn_stderr_reader(stderr);

	// Handshake: the frontend must not treat the sidecar as ready until hello succeeds.
	match send_request(inner, "session.hello", json!({ "client": { "name": "avenos-tauri", "version": "0.1.0" } }), HELLO_TIMEOUT).await {
		Ok(result) => {
			let capabilities = result.get("capabilities").cloned();
			inner.mark_ready(capabilities, pid);
			log::info!(target: "avenos::agent_sidecar", "sidecar ready (pid {:?})", pid);
			Ok(())
		}
		Err(err) => {
			inner.mark_error("crashed", format!("hello failed: {}", err.message));
			let _ = stop_inner(inner).await;
			Err(err)
		}
	}
}

fn spawn_stdout_reader(inner: Arc<Inner>, stdout: tokio::process::ChildStdout, sink: EventSink, epoch: u64) {
	tauri::async_runtime::spawn(async move {
		let mut reader = BufReader::new(stdout);
		loop {
			match read_frame(&mut reader).await {
				Ok(Some(body)) => match serde_json::from_slice::<Value>(&body) {
					Ok(envelope) => handle_inbound(&inner, &sink, envelope),
					Err(e) => log::warn!(target: "avenos::agent_sidecar", "non-JSON frame from sidecar: {e}"),
				},
				Ok(None) => {
					log::info!(target: "avenos::agent_sidecar", "sidecar stdout closed");
					break;
				}
				Err(e) => {
					log::error!(target: "avenos::agent_sidecar", "sidecar stdout read error: {e}");
					break;
				}
			}
		}
		on_reader_exit(&inner, &sink, epoch).await;
	});
}

fn handle_inbound(inner: &Arc<Inner>, sink: &EventSink, envelope: Value) {
	match envelope.get("kind").and_then(Value::as_str) {
		Some("event") => {
			if envelope.get("method").and_then(Value::as_str) == Some("runtime.health") {
				if let Some(msg) = envelope.get("event").and_then(|e| e.get("message")).and_then(Value::as_str) {
					inner.status.lock().unwrap().last_error = Some(msg.to_string());
				}
			}
			sink(envelope);
		}
		Some("response") => {
			let Some(id) = envelope.get("id").and_then(Value::as_str) else {
				return;
			};
			let responder = inner.pending.lock().unwrap().remove(id);
			if let Some(tx) = responder {
				let outcome = if let Some(err) = envelope.get("error") {
					Err(SidecarErr::from_response(err))
				} else {
					Ok(envelope.get("result").cloned().unwrap_or_else(|| json!({})))
				};
				let _ = tx.send(outcome);
			}
		}
		_ => {}
	}
}

async fn on_reader_exit(inner: &Arc<Inner>, sink: &EventSink, epoch: u64) {
	// Only act if this reader belongs to the CURRENT child (a newer start bumps the epoch).
	let mut exit_code = None;
	{
		let mut proc = inner.proc.lock().await;
		if proc.epoch != epoch {
			return;
		}
		if let Some(mut child) = proc.child.take() {
			exit_code = match child.try_wait() {
				Ok(Some(status)) => status.code(),
				_ => match tokio::time::timeout(STOP_GRACE, child.wait()).await {
					Ok(Ok(status)) => status.code(),
					_ => {
						let _ = child.start_kill();
						None
					}
				},
			};
		}
		proc.stdin = None;
	}

	// "stopped" means an intentional stop already ran; don't flap it to "crashed".
	let crashed = inner.state_name() != "stopped";
	if crashed {
		inner.mark_error("crashed", "sidecar process exited unexpectedly");
	}
	inner.status.lock().unwrap().last_exit_code = exit_code;
	inner.fail_all_pending(&SidecarErr::new("sidecar_crashed", "sidecar process exited", true));

	// Surface an unexpected exit to the webview so the UI can react (M9: crash event to UI).
	if crashed {
		sink(serde_json::json!({
			"v": 1,
			"kind": "event",
			"method": "runtime.health",
			"event": {
				"status": "crashed",
				"message": "sidecar process exited unexpectedly",
				"exitCode": exit_code,
			},
		}));
	}
}

fn spawn_stderr_reader(stderr: tokio::process::ChildStderr) {
	tauri::async_runtime::spawn(async move {
		let mut lines = BufReader::new(stderr).lines();
		while let Ok(Some(line)) = lines.next_line().await {
			// Sidecar logs are already `[level] message`; mirror into the Rust log ring.
			log::info!(target: "avenos::agent_sidecar", "{line}");
			crate::log_ring::push_line(format!("sidecar: {line}"));
		}
	});
}

async fn send_request(inner: &Arc<Inner>, method: &str, params: Value, timeout: Duration) -> RpcOutcome {
	let id = format!("rs_{}", inner.next_id.fetch_add(1, Ordering::SeqCst));
	let (tx, rx) = oneshot::channel();
	inner.pending.lock().unwrap().insert(id.clone(), tx);

	let envelope = json!({ "v": 1, "kind": "request", "id": id, "method": method, "params": params });
	let body = serde_json::to_vec(&envelope).map_err(|e| {
		inner.pending.lock().unwrap().remove(&id);
		SidecarErr::new("internal_error", format!("encode failed: {e}"), false)
	})?;

	{
		let mut proc = inner.proc.lock().await;
		match proc.stdin.as_mut() {
			Some(stdin) => {
				if let Err(e) = write_frame(stdin, &body).await {
					inner.pending.lock().unwrap().remove(&id);
					return Err(SidecarErr::new("io_error", format!("stdin write failed: {e}"), true));
				}
			}
			None => {
				inner.pending.lock().unwrap().remove(&id);
				return Err(SidecarErr::new("runtime_not_ready", "sidecar is not running", true));
			}
		}
	}

	match tokio::time::timeout(timeout, rx).await {
		Ok(Ok(outcome)) => outcome,
		Ok(Err(_canceled)) => Err(SidecarErr::new("sidecar_crashed", "sidecar closed before responding", true)),
		Err(_elapsed) => {
			inner.pending.lock().unwrap().remove(&id);
			Err(SidecarErr::new("timeout", format!("request '{method}' timed out"), true))
		}
	}
}

async fn stop_inner(inner: &Arc<Inner>) {
	// Mark stopped FIRST so the reader's EOF handler doesn't relabel it "crashed".
	inner.set_state("stopped");

	let child = {
		let mut proc = inner.proc.lock().await;
		// Dropping stdin gives the sidecar a clean EOF → its loop exits gracefully.
		proc.stdin = None;
		proc.child.take()
	};

	if let Some(mut child) = child {
		match tokio::time::timeout(STOP_GRACE, child.wait()).await {
			Ok(Ok(status)) => {
				inner.status.lock().unwrap().last_exit_code = status.code();
			}
			_ => {
				let _ = child.start_kill();
				let _ = child.wait().await;
			}
		}
	}

	inner.fail_all_pending(&SidecarErr::new("sidecar_crashed", "sidecar stopped", true));
}

fn make_sink(app: AppHandle) -> EventSink {
	Arc::new(move |envelope: Value| {
		if let Err(e) = app.emit(SIDECAR_EVENT, envelope) {
			log::warn!(target: "avenos::agent_sidecar", "failed to emit {SIDECAR_EVENT}: {e}");
		}
	})
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_sidecar_status(state: State<'_, AgentSidecarState>) -> SidecarStatus {
	state.shared().status_snapshot()
}

#[tauri::command]
pub async fn agent_sidecar_start(
	app: AppHandle,
	state: State<'_, AgentSidecarState>,
) -> Result<SidecarStatus, Value> {
	let inner = state.shared();
	ensure_started(&inner, &make_sink(app)).await.map_err(|e| e.value())?;
	Ok(inner.status_snapshot())
}

#[tauri::command]
pub async fn agent_sidecar_stop(state: State<'_, AgentSidecarState>) -> Result<SidecarStatus, Value> {
	let inner = state.shared();
	stop_inner(&inner).await;
	Ok(inner.status_snapshot())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn agent_sidecar_invoke(
	app: AppHandle,
	state: State<'_, AgentSidecarState>,
	method: String,
	params: Option<Value>,
) -> Result<Value, Value> {
	let inner = state.shared();
	ensure_started(&inner, &make_sink(app)).await.map_err(|e| e.value())?;
	send_request(&inner, &method, params.unwrap_or_else(|| json!({})), REQUEST_TIMEOUT)
		.await
		.map_err(|e| e.value())
}

/// Drain the sidecar during app shutdown (called from the `ExitRequested` handler,
/// blocking on the main thread alongside the avenDB drain). Bounded by [`STOP_GRACE`].
pub fn drain_blocking(app: &AppHandle) {
	let inner = app.state::<AgentSidecarState>().shared();
	tauri::async_runtime::block_on(async move {
		stop_inner(&inner).await;
	});
}

/// Async drain for the SIGINT/SIGTERM path (which runs inside a tokio task and so
/// cannot block_on). Bounded by [`STOP_GRACE`].
pub async fn drain(app: &AppHandle) {
	let inner = app.state::<AgentSidecarState>().shared();
	stop_inner(&inner).await;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
	use super::*;
	use std::io::Cursor;

	async fn roundtrip(bodies: &[&str]) -> Vec<String> {
		let mut buf = Vec::new();
		for b in bodies {
			let mut w = Vec::new();
			write_frame(&mut w, b.as_bytes()).await.unwrap();
			buf.extend_from_slice(&w);
		}
		let mut reader = BufReader::new(Cursor::new(buf));
		let mut out = Vec::new();
		while let Some(frame) = read_frame(&mut reader).await.unwrap() {
			out.push(String::from_utf8(frame).unwrap());
		}
		out
	}

	#[tokio::test]
	async fn frames_round_trip_single() {
		let out = roundtrip(&[r#"{"v":1,"kind":"response","id":"a","result":{}}"#]).await;
		assert_eq!(out.len(), 1);
		assert!(out[0].contains("\"id\":\"a\""));
	}

	#[tokio::test]
	async fn frames_round_trip_multiple_back_to_back() {
		let out = roundtrip(&[r#"{"x":1}"#, r#"{"y":"line\nbreak"}"#, r#"{"z":3}"#]).await;
		assert_eq!(out.len(), 3);
		assert!(out[1].contains("line\\nbreak"));
	}

	#[tokio::test]
	async fn missing_content_length_is_error() {
		let bytes = b"Content-Type: application/json\r\n\r\n{}".to_vec();
		let mut reader = BufReader::new(Cursor::new(bytes));
		assert!(read_frame(&mut reader).await.is_err());
	}

	#[tokio::test]
	async fn clean_eof_returns_none() {
		let mut reader = BufReader::new(Cursor::new(Vec::new()));
		assert!(read_frame(&mut reader).await.unwrap().is_none());
	}

	#[test]
	fn resolve_command_requires_configuration() {
		// With neither env var set, resolution yields a structured startup error.
		std::env::remove_var("AVEN_SIDECAR_BIN");
		std::env::remove_var("AVEN_SIDECAR_DLL");
		let err = resolve_command().err().expect("should error without config");
		assert_eq!(err.code, "startup_failed");
	}

	/// Real end-to-end against the built sidecar. Skipped unless `AVEN_SIDECAR_DLL`
	/// points at `Aven.Sidecar.dll`, so plain `cargo test` stays self-contained.
	#[tokio::test]
	async fn e2e_against_real_sidecar_when_configured() {
		let Ok(dll) = std::env::var("AVEN_SIDECAR_DLL") else {
			eprintln!("skip e2e: AVEN_SIDECAR_DLL not set");
			return;
		};
		assert!(std::path::Path::new(&dll).exists(), "dll path must exist");

		let inner = Arc::new(Inner::default());
		let sink: EventSink = Arc::new(|_| {});
		ensure_started(&inner, &sink).await.expect("sidecar should start + hello");
		assert_eq!(inner.state_name(), "ready");

		let pong = send_request(&inner, "session.ping", json!({}), Duration::from_secs(5)).await.expect("ping");
		assert_eq!(pong["ok"], json!(true));

		let skills = send_request(&inner, "skills.list", json!({}), Duration::from_secs(5)).await.expect("skills");
		assert!(skills["skills"].is_array());

		let bad = send_request(&inner, "does.not.exist", json!({}), Duration::from_secs(5)).await;
		assert_eq!(bad.err().expect("unknown method should error").code, "unknown_method");

		stop_inner(&inner).await;
		assert_eq!(inner.state_name(), "stopped");
	}
}

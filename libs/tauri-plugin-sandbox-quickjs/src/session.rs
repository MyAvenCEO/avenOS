//! QuickJS session manager for @avenos/aven-ui fixture logic.

use rquickjs::{Context, Runtime};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Deserialize, Default)]
pub struct InterfaceDef {
	#[serde(default)]
	pub properties: Option<HashMap<String, Value>>,
}

impl InterfaceDef {
	pub fn allows(&self, send: &str) -> bool {
		self.properties
			.as_ref()
			.is_some_and(|props| props.contains_key(send))
	}
}

pub struct SessionManager {
	sessions: Mutex<HashMap<String, Session>>,
}

impl Default for SessionManager {
	fn default() -> Self {
		Self {
			sessions: Mutex::new(HashMap::new()),
		}
	}
}

pub struct Session {
	pub state: Value,
	pub logic: String,
	pub interface: InterfaceDef,
}

impl SessionManager {
	pub fn mount(
		&self,
		logic: String,
		source: Value,
		interface: InterfaceDef,
	) -> Result<(String, Value), String> {
		let state = run_init_state(&logic, &source)?;
		let session_id = uuid::Uuid::new_v4().to_string();
		let session = Session {
			state,
			logic,
			interface,
		};
		let state = session.state.clone();
		self.sessions
			.lock()
			.map_err(|e| e.to_string())?
			.insert(session_id.clone(), session);
		Ok((session_id, state))
	}

	pub fn dispatch(
		&self,
		session_id: &str,
		send: &str,
		payload: Value,
	) -> Result<Value, String> {
		let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
		let session = sessions
			.get_mut(session_id)
			.ok_or_else(|| format!("session not found: {session_id}"))?;

		if !session.interface.allows(send) {
			return Err(format!("event not allowed by interface: {send}"));
		}

		let next = run_handle_event(&session.logic, send, &payload, &session.state)?;
		session.state = next.clone();
		Ok(next)
	}

	pub fn unmount(&self, session_id: &str) -> Result<(), String> {
		self.sessions
			.lock()
			.map_err(|e| e.to_string())?
			.remove(session_id);
		Ok(())
	}
}

fn run_init_state(logic: &str, source: &Value) -> Result<Value, String> {
	let runtime = Runtime::new().map_err(|e| e.to_string())?;
	let context = Context::full(&runtime).map_err(|e| e.to_string())?;
	let json: String = context
		.with(|ctx| -> Result<String, String> {
			ctx.eval::<(), _>(logic).map_err(|e| e.to_string())?;
			let source_json = serde_json::to_string(source).map_err(|e| e.to_string())?;
			let script = format!(
				"JSON.stringify(initState(JSON.parse({})))",
				serde_json::to_string(&source_json).map_err(|e| e.to_string())?
			);
			ctx.eval::<String, _>(script).map_err(|e| e.to_string())
		})
		.map_err(|e| e.to_string())?;
	serde_json::from_str(&json).map_err(|e| e.to_string())
}

fn run_handle_event(logic: &str, send: &str, payload: &Value, state: &Value) -> Result<Value, String> {
	let runtime = Runtime::new().map_err(|e| e.to_string())?;
	let context = Context::full(&runtime).map_err(|e| e.to_string())?;
	let json: String = context
		.with(|ctx| -> Result<String, String> {
			ctx.eval::<(), _>(logic).map_err(|e| e.to_string())?;
			let script = format!(
				"(function() {{ if (typeof handleEvent !== 'function') return ''; var r = handleEvent({}, {}, {}); return r == null ? '' : JSON.stringify(r); }})()",
				serde_json::to_string(send).map_err(|e| e.to_string())?,
				serde_json::to_string(payload).map_err(|e| e.to_string())?,
				serde_json::to_string(state).map_err(|e| e.to_string())?
			);
			ctx.eval::<String, _>(script).map_err(|e| e.to_string())
		})
		.map_err(|e| e.to_string())?;
	if json.is_empty() {
		return Ok(state.clone());
	}
	serde_json::from_str(&json).map_err(|e| e.to_string())
}
